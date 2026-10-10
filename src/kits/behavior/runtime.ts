import {
  BehaviorError,
  isBehaviorName,
  isBlackboardValue,
  type BehaviorTree,
  type BlackboardValue,
  type FlatNode,
} from './tree';

export type BehaviorStatus = 'success' | 'failure' | 'running';

/** What a leaf handler sees. `first` is true on the tick the leaf starts (not when it resumes). */
export interface LeafContext {
  readonly agent: string;
  readonly now: number;
  readonly node: number;
  readonly name: string | null;
  readonly args: BlackboardValue;
  readonly first: boolean;
  get(key: string): BlackboardValue | undefined;
  set(key: string, value: BlackboardValue): void;
  delete(key: string): boolean;
  /** The tick's random source (throws when the tick was given none). */
  random(): number;
}
export type ActionHandler =
  | ((ctx: LeafContext) => BehaviorStatus)
  | {readonly tick: (ctx: LeafContext) => BehaviorStatus; readonly abort?: (ctx: LeafContext) => void};
export interface BehaviorHandlers {
  readonly actions?: Readonly<Record<string, ActionHandler>>;
  readonly conditions?: Readonly<Record<string, (ctx: LeafContext) => boolean>>;
}
export interface TraceRow {
  readonly node: number;
  readonly name: string | null;
  readonly type: FlatNode['type'];
  readonly status: BehaviorStatus | 'aborted';
}
export interface BehaviorSnapshot {
  readonly version: 1;
  readonly signature: string;
  readonly agent: string;
  readonly now: number | null;
  readonly blackboard: readonly (readonly [string, BlackboardValue])[];
  readonly memory: readonly Readonly<{
    node: number;
    cursor: number;
    count: number;
    since: number;
    order: readonly number[] | null;
    results: readonly number[] | null;
  }>[];
  readonly cooldowns: readonly Readonly<{node: number; until: number}>[];
}

interface Memory {
  cursor: number;
  count: number;
  since: number;
  order: number[] | null;
  /** Parallel: 0 pending, 1 success, 2 failure per child. */
  results: number[] | null;
}

const STATUSES = new Set<unknown>(['success', 'failure', 'running']);

/**
 * One agent's running tree. Each tick visits every node at most once (decorators that repeat run their child once
 * per tick), so a tick's work is bounded by the tree size plus the creator's handlers. A tick's memory and
 * blackboard changes publish only when the tick completes; a throwing handler restores them (its own external side
 * effects, and abort handlers already called, are not undone).
 */
export function createBehavior(
  tree: BehaviorTree,
  handlers: BehaviorHandlers,
  options: {agent: string; blackboard?: Readonly<Record<string, BlackboardValue>>; maxKeys?: number},
) {
  const nodes = tree.nodes;
  const agent = options.agent;
  if (!isBehaviorName(agent)) throw new BehaviorError('agent must be a name');
  const maxKeys = options.maxKeys ?? 256;
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1 || maxKeys > 4096)
    throw new BehaviorError('maxKeys must be 1..4096');
  const actions = new Map<string, {tick: (ctx: LeafContext) => BehaviorStatus; abort?: (ctx: LeafContext) => void}>();
  for (const id of tree.actions) {
    const h = handlers.actions && Object.hasOwn(handlers.actions, id) ? handlers.actions[id] : undefined;
    if (typeof h === 'function') actions.set(id, {tick: h});
    else if (h && typeof h.tick === 'function')
      actions.set(id, h.abort === undefined ? {tick: h.tick} : {tick: h.tick, abort: h.abort});
    else throw new BehaviorError(`no handler for action ${id}`);
  }
  const conditions = new Map<string, (ctx: LeafContext) => boolean>();
  for (const id of tree.conditions) {
    const h = handlers.conditions && Object.hasOwn(handlers.conditions, id) ? handlers.conditions[id] : undefined;
    if (typeof h !== 'function') throw new BehaviorError(`no handler for condition ${id}`);
    conditions.set(id, h);
  }

  let blackboard = new Map<string, BlackboardValue>();
  const setKey = (board: Map<string, BlackboardValue>, key: string, value: BlackboardValue) => {
    if (!isBehaviorName(key)) throw new BehaviorError(`invalid blackboard key ${JSON.stringify(key)}`);
    if (!isBlackboardValue(value)) throw new BehaviorError(`invalid blackboard value for ${key}`);
    if (!board.has(key) && board.size >= maxKeys) throw new BehaviorError('blackboard is full');
    board.set(key, value);
  };
  for (const [k, v] of Object.entries(options.blackboard ?? {})) setKey(blackboard, k, v);
  let memory = new Map<number, Memory>();
  let cooldowns = new Map<number, number>();
  let lastNow: number | null = null;
  let busy = false;

  const guarded = <T>(f: () => T): T => {
    if (busy) throw new BehaviorError('reentrant call from a handler');
    busy = true;
    try {
      return f();
    } finally {
      busy = false;
    }
  };

  // One tick's working state.
  interface Tick {
    now: number;
    random: (() => number) | undefined;
    trace: TraceRow[] | null;
    board: Map<string, BlackboardValue>;
    mem: Map<number, Memory>;
    cool: Map<number, number>;
  }
  const context = (t: Tick, n: FlatNode, first: boolean): LeafContext =>
    Object.freeze({
      agent,
      now: t.now,
      node: n.index,
      name: n.name,
      args: n.args,
      first,
      get: (key: string) => t.board.get(key),
      set: (key: string, value: BlackboardValue) => setKey(t.board, key, value),
      delete: (key: string) => t.board.delete(key),
      random: () => {
        if (!t.random) throw new BehaviorError('this tick has no random source');
        const u = t.random();
        if (typeof u !== 'number' || !Number.isFinite(u) || u < 0 || u >= 1)
          throw new BehaviorError('random source must return a number in [0, 1)');
        return u;
      },
    });
  const record = (t: Tick, n: FlatNode, status: TraceRow['status']) => {
    if (t.trace) t.trace.push(Object.freeze({node: n.index, name: n.name, type: n.type, status}));
  };

  const abort = (t: Tick, index: number) => {
    const m = t.mem.get(index);
    if (!m) return;
    const n = nodes[index]!;
    for (const child of n.children) abort(t, child);
    if (n.type === 'action') actions.get(n.handler!)!.abort?.(context(t, n, false));
    t.mem.delete(index);
    record(t, n, 'aborted');
  };
  const finish = (t: Tick, n: FlatNode, status: BehaviorStatus): BehaviorStatus => {
    if (status === 'running') {
      record(t, n, status);
      return status;
    }
    for (const child of n.children) abort(t, child);
    t.mem.delete(n.index);
    record(t, n, status);
    return status;
  };
  const compare = (t: Tick, n: FlatNode): boolean => {
    const has = t.board.has(n.key!);
    const v = t.board.get(n.key!);
    switch (n.op) {
      case 'exists':
        return has;
      case 'missing':
        return !has;
      case 'eq':
        return has && v === n.value;
      case 'ne':
        return !has || v !== n.value;
      default: {
        if (typeof v !== 'number' || typeof n.value !== 'number') return false;
        if (n.op === 'lt') return v < n.value;
        if (n.op === 'le') return v <= n.value;
        if (n.op === 'gt') return v > n.value;
        return v >= n.value;
      }
    }
  };
  const order = (t: Tick, n: FlatNode): number[] => {
    if (!t.random) throw new BehaviorError('shuffle needs a random source');
    const left = n.children.map((_, i) => i);
    const weights = n.weights ? [...n.weights] : left.map(() => 1);
    const out: number[] = [];
    while (left.length > 1) {
      const total = weights.reduce((s, w) => s + w, 0);
      const u = context(t, n, false).random() * total;
      let pick = 0,
        acc = weights[0]!;
      while (pick < left.length - 1 && u >= acc) acc += weights[++pick]!;
      out.push(left[pick]!);
      left.splice(pick, 1);
      weights.splice(pick, 1);
    }
    out.push(left[0]!);
    return out;
  };

  const run = (t: Tick, index: number): BehaviorStatus => {
    const n = nodes[index]!;
    if (n.type === 'cooldown' && !t.mem.has(index)) {
      const until = t.cool.get(index);
      if (until !== undefined && t.now < until) return finish(t, n, 'failure');
    }
    let m = t.mem.get(index);
    const first = !m;
    if (!m) {
      m = {cursor: 0, count: 0, since: t.now, order: null, results: null};
      t.mem.set(index, m);
    }
    switch (n.type) {
      case 'sequence':
      case 'selector':
      case 'shuffle': {
        const stop = n.type === 'sequence' ? 'failure' : 'success';
        if (n.type === 'shuffle' && !m.order) m.order = order(t, n);
        const previous = first ? null : m.cursor;
        for (let c = n.reactive ? 0 : m.cursor; c < n.children.length; c++) {
          const child = n.children[m.order ? m.order[c]! : c]!;
          const s = run(t, child);
          if (s === 'running' || s === stop) {
            // A reactive composite that settles before its previously running child aborts that child.
            if (previous !== null && previous > c) abort(t, n.children[m.order ? m.order[previous]! : previous]!);
            if (s === 'running') {
              m.cursor = c;
              return finish(t, n, 'running');
            }
            return finish(t, n, s);
          }
        }
        return finish(t, n, stop === 'failure' ? 'success' : 'failure');
      }
      case 'parallel': {
        if (!m.results) m.results = n.children.map(() => 0);
        n.children.forEach((child, c) => {
          if (m.results![c] !== 0) return;
          const s = run(t, child);
          if (s !== 'running') m.results![c] = s === 'success' ? 1 : 2;
        });
        const succ = m.results.filter(r => r === 1).length,
          fail = m.results.filter(r => r === 2).length,
          all = n.children.length;
        if (n.fail === 'any' ? fail > 0 : fail === all) return finish(t, n, 'failure');
        if (n.succeed === 'any' ? succ > 0 : succ === all) return finish(t, n, 'success');
        if (succ + fail === all) return finish(t, n, 'failure');
        return finish(t, n, 'running');
      }
      case 'invert': {
        const s = run(t, n.children[0]!);
        return finish(t, n, s === 'running' ? s : s === 'success' ? 'failure' : 'success');
      }
      case 'succeed':
      case 'fail': {
        const s = run(t, n.children[0]!);
        return finish(t, n, s === 'running' ? s : n.type === 'succeed' ? 'success' : 'failure');
      }
      case 'repeat': {
        const s = run(t, n.children[0]!);
        if (s === 'running') return finish(t, n, s);
        if (s === 'failure') return finish(t, n, n.times === null ? 'success' : 'failure');
        m.count++;
        if (n.times !== null && m.count >= n.times) return finish(t, n, 'success');
        return finish(t, n, 'running');
      }
      case 'retry': {
        const s = run(t, n.children[0]!);
        if (s !== 'failure') return finish(t, n, s);
        m.count++;
        return finish(t, n, m.count >= n.times! ? 'failure' : 'running');
      }
      case 'timeout': {
        if (t.now - m.since >= n.ticks) return finish(t, n, 'failure');
        return finish(t, n, run(t, n.children[0]!));
      }
      case 'cooldown': {
        const s = run(t, n.children[0]!);
        if (s !== 'running') t.cool.set(index, t.now + n.ticks);
        return finish(t, n, s);
      }
      case 'guard': {
        const ok = conditions.get(n.handler!)!(context(t, n, first));
        if (typeof ok !== 'boolean') throw new BehaviorError(`condition ${n.handler} must return a boolean`);
        if (!ok) return finish(t, n, 'failure');
        return finish(t, n, run(t, n.children[0]!));
      }
      case 'action': {
        const s = actions.get(n.handler!)!.tick(context(t, n, first));
        if (!STATUSES.has(s)) throw new BehaviorError(`action ${n.handler} must return success, failure or running`);
        return finish(t, n, s);
      }
      case 'condition': {
        const ok = conditions.get(n.handler!)!(context(t, n, first));
        if (typeof ok !== 'boolean') throw new BehaviorError(`condition ${n.handler} must return a boolean`);
        return finish(t, n, ok ? 'success' : 'failure');
      }
      case 'wait':
        return finish(t, n, t.now - m.since >= n.ticks ? 'success' : 'running');
      case 'set':
        setKey(t.board, n.key!, n.value);
        return finish(t, n, 'success');
      case 'check':
        return finish(t, n, compare(t, n) ? 'success' : 'failure');
    }
  };

  const begin = (now: number, random?: () => number, trace = false): Tick => {
    if (!Number.isSafeInteger(now) || now < 0) throw new BehaviorError('now must be a non-negative integer tick');
    if (lastNow !== null && now < lastNow) throw new BehaviorError('time went backwards');
    if (random !== undefined && typeof random !== 'function') throw new BehaviorError('random must be a function');
    return {
      now,
      random,
      trace: trace ? [] : null,
      board: new Map(blackboard),
      mem: new Map(
        [...memory].map(([k, m]) => [k, {...m, order: m.order && [...m.order], results: m.results && [...m.results]}]),
      ),
      cool: new Map(cooldowns),
    };
  };
  const commit = (t: Tick) => {
    blackboard = t.board;
    memory = t.mem;
    cooldowns = t.cool;
    lastNow = t.now;
    for (const [k, until] of cooldowns) if (until <= t.now) cooldowns.delete(k);
  };

  return Object.freeze({
    agent,
    /** Run the tree once at tick `now` (non-decreasing). */
    tick(o: {
      now: number;
      random?: () => number;
      trace?: boolean;
    }): Readonly<{status: BehaviorStatus; trace: readonly TraceRow[] | null}> {
      return guarded(() => {
        const t = begin(o.now, o.random, o.trace === true);
        const status = run(t, 0);
        commit(t);
        return Object.freeze({status, trace: t.trace && Object.freeze(t.trace)});
      });
    },
    /** Abort everything running (scene exit, despawn, a new order). Abort handlers run in node order. */
    abort(now: number): readonly TraceRow[] {
      return guarded(() => {
        const t = begin(now, undefined, true);
        abort(t, 0);
        commit(t);
        return Object.freeze(t.trace!);
      });
    },
    /** Running node indices, root first: the resume chain a save carries. */
    running(): readonly number[] {
      return Object.freeze([...memory.keys()].sort((a, b) => a - b));
    },
    get(key: string): BlackboardValue | undefined {
      return blackboard.get(key);
    },
    /** Write the blackboard from outside a tick (sensors, orders). */
    set(key: string, value: BlackboardValue): void {
      guarded(() => setKey(blackboard, key, value));
    },
    delete(key: string): boolean {
      return guarded(() => blackboard.delete(key));
    },
    blackboard(): Readonly<Record<string, BlackboardValue>> {
      return Object.freeze(Object.fromEntries([...blackboard].sort(([a], [b]) => (a < b ? -1 : 1))));
    },
    snapshot(): BehaviorSnapshot {
      return Object.freeze({
        version: 1 as const,
        signature: tree.signature,
        agent,
        now: lastNow,
        blackboard: Object.freeze([...blackboard].sort(([a], [b]) => (a < b ? -1 : 1)).map(e => Object.freeze(e))),
        memory: Object.freeze(
          [...memory]
            .sort(([a], [b]) => a - b)
            .map(([node, m]) =>
              Object.freeze({
                node,
                cursor: m.cursor,
                count: m.count,
                since: m.since,
                order: m.order && Object.freeze([...m.order]),
                results: m.results && Object.freeze([...m.results]),
              }),
            ),
        ),
        cooldowns: Object.freeze(
          [...cooldowns].sort(([a], [b]) => a - b).map(([node, until]) => Object.freeze({node, until})),
        ),
      });
    },
    /** Replace all state from a snapshot of the same tree and agent, validated before anything changes. */
    restore(raw: unknown): void {
      guarded(() => {
        const parsed = parseSnapshot(raw, tree, agent, maxKeys);
        blackboard = parsed.blackboard;
        memory = parsed.memory;
        cooldowns = parsed.cooldowns;
        lastNow = parsed.now;
      });
    },
  });
}
export type Behavior = ReturnType<typeof createBehavior>;

function fields(v: unknown, names: readonly string[], what: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new BehaviorError(`${what} must be a record`);
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) throw new BehaviorError(`${what} must be plain data`);
  const keys = Reflect.ownKeys(v);
  if (keys.length !== names.length || keys.some(k => typeof k !== 'string' || !names.includes(k)))
    throw new BehaviorError(`${what} has unexpected fields`);
  const out: Record<string, unknown> = Object.create(null);
  for (const k of names) {
    const d = Object.getOwnPropertyDescriptor(v, k)!;
    if (!('value' in d)) throw new BehaviorError(`${what} has an accessor`);
    out[k] = d.value;
  }
  return out;
}
function items(v: unknown, max: number, what: string): unknown[] {
  if (!Array.isArray(v) || v.length > max) throw new BehaviorError(`${what} must be an array of at most ${max}`);
  const out: unknown[] = [];
  for (let i = 0; i < v.length; i++) {
    const d = Object.getOwnPropertyDescriptor(v, String(i));
    if (!d || !('value' in d)) throw new BehaviorError(`${what} must be dense data`);
    out.push(d.value);
  }
  return out;
}
const isTick = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

function parseSnapshot(raw: unknown, tree: BehaviorTree, agent: string, maxKeys: number) {
  const s = fields(raw, ['version', 'signature', 'agent', 'now', 'blackboard', 'memory', 'cooldowns'], 'snapshot');
  if (s.version !== 1) throw new BehaviorError('unsupported snapshot version');
  if (s.signature !== tree.signature) throw new BehaviorError('snapshot was saved with a different tree');
  if (s.agent !== agent) throw new BehaviorError('snapshot belongs to another agent');
  if (s.now !== null && !isTick(s.now)) throw new BehaviorError('invalid now');
  const now = s.now as number | null;
  const blackboard = new Map<string, BlackboardValue>();
  for (const e of items(s.blackboard, maxKeys, 'blackboard')) {
    const pair = items(e, 2, 'blackboard entry');
    const [k, v] = pair;
    if (pair.length !== 2 || !isBehaviorName(k) || !isBlackboardValue(v) || blackboard.has(k))
      throw new BehaviorError('invalid blackboard entry');
    blackboard.set(k, v);
  }
  const nodes = tree.nodes;
  const memory = new Map<number, Memory>();
  for (const e of items(s.memory, nodes.length, 'memory')) {
    const m = fields(e, ['node', 'cursor', 'count', 'since', 'order', 'results'], 'memory');
    if (!isTick(m.node) || m.node >= nodes.length || memory.has(m.node)) throw new BehaviorError('invalid memory node');
    const n = nodes[m.node]!;
    if (!isTick(m.cursor) || !isTick(m.count) || !isTick(m.since) || (now !== null && m.since > now) || now === null)
      throw new BehaviorError('invalid memory counters');
    const k = n.children.length;
    if ((n.type === 'sequence' || n.type === 'selector' || n.type === 'shuffle') && m.cursor >= k)
      throw new BehaviorError('invalid cursor');
    let order: number[] | null = null;
    if (m.order !== null) {
      order = items(m.order, 64, 'order').map(x => (isTick(x) ? x : -1));
      if (n.type !== 'shuffle' || order.length !== k || new Set(order).size !== k || order.some(x => x < 0 || x >= k))
        throw new BehaviorError('invalid shuffle order');
    } else if (n.type === 'shuffle') throw new BehaviorError('a running shuffle needs its order');
    let results: number[] | null = null;
    if (m.results !== null) {
      results = items(m.results, 64, 'results').map(x => (x === 0 || x === 1 || x === 2 ? x : -1));
      if (n.type !== 'parallel' || results.length !== k || results.includes(-1))
        throw new BehaviorError('invalid results');
    }
    memory.set(m.node, {cursor: m.cursor, count: m.count, since: m.since, order, results});
  }
  // The running set must be a chain of ancestors: every remembered node except the root has a remembered parent.
  const parent = new Map<number, number>();
  for (const n of nodes) for (const c of n.children) parent.set(c, n.index);
  for (const index of memory.keys())
    if (index !== 0 && !memory.has(parent.get(index)!))
      throw new BehaviorError('running nodes must form ancestor chains');
  const cooldowns = new Map<number, number>();
  for (const e of items(s.cooldowns, nodes.length, 'cooldowns')) {
    const c = fields(e, ['node', 'until'], 'cooldown');
    if (!isTick(c.node) || c.node >= nodes.length || nodes[c.node]!.type !== 'cooldown' || !isTick(c.until))
      throw new BehaviorError('invalid cooldown');
    if (now === null || c.until <= now) throw new BehaviorError('stale cooldown');
    cooldowns.set(c.node, c.until);
  }
  return {now, blackboard, memory, cooldowns};
}
