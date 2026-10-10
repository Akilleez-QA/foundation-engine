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
const MAX_NOW = 2 ** 52;

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
    board.set(key, value === 0 ? 0 : value); // one zero: -0 is stored as 0
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

  /** Reads outside a tick only: inside one they would show stale, pre-tick state. */
  const idle = () => {
    if (busy) throw new BehaviorError('reentrant call from a handler (use the leaf context)');
  };

  // One tick's working state.
  interface Tick {
    now: number;
    random: (() => number) | undefined;
    trace: TraceRow[] | null;
    board: Map<string, BlackboardValue>;
    mem: Map<number, Memory>;
    cool: Map<number, number>;
    /** Abort handlers to call after the tick commits, so a rolled-back tick never stops work it then resumes. */
    aborts: {handler: (ctx: LeafContext) => void; node: FlatNode}[];
    /** Contexts work only while their tick (or the abort phase) runs. */
    live: boolean;
  }
  const alive = (t: Tick) => {
    if (!t.live) throw new BehaviorError('a leaf context is used outside its tick');
  };
  const context = (t: Tick, n: FlatNode, first: boolean): LeafContext =>
    Object.freeze({
      agent,
      now: t.now,
      node: n.index,
      name: n.name,
      args: n.args,
      first,
      get: (key: string) => (alive(t), t.board.get(key)),
      set: (key: string, value: BlackboardValue) => (alive(t), setKey(t.board, key, value)),
      delete: (key: string) => (alive(t), t.board.delete(key)),
      random: () => {
        alive(t);
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
    const handler = n.type === 'action' ? actions.get(n.handler!)!.abort : undefined;
    if (handler) t.aborts.push({handler, node: n});
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
        if (n.type === 'shuffle' && !m.order) m.order = n.children.length > 1 ? order(t, n) : [0];
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
        const all = n.children.length;
        // Decide after each child: once the policy is met, later children are not started this tick.
        const decide = (): BehaviorStatus | null => {
          const succ = m!.results!.filter(r => r === 1).length,
            fail = m!.results!.filter(r => r === 2).length;
          if (n.fail === 'any' ? fail > 0 : fail === all) return 'failure';
          if (n.succeed === 'any' ? succ > 0 : succ === all) return 'success';
          if (succ + fail === all) return 'failure';
          return null;
        };
        for (let c = 0; c < all; c++) {
          if (m.results[c] !== 0) continue;
          const s = run(t, n.children[c]!);
          if (s !== 'running') m.results[c] = s === 'success' ? 1 : 2;
          const decided = decide();
          if (decided) return finish(t, n, decided);
        }
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
        if (s !== 'running') t.cool.set(index, t.now + n.ticks + 1);
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
    if (!Number.isSafeInteger(now) || now < 0 || now > MAX_NOW)
      throw new BehaviorError('now must be an integer tick in 0..2^52');
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
      aborts: [],
      live: true,
    };
  };
  /** After a commit: run the queued abort handlers against the live blackboard; rethrow the first error after all. */
  const runAborts = (t: Tick) => {
    t.live = false;
    if (!t.aborts.length) return;
    const phase: Tick = {...t, board: blackboard, live: true};
    let failure: unknown = null;
    for (const {handler, node} of t.aborts)
      try {
        handler(context(phase, node, false));
      } catch (error) {
        failure ??= error;
      }
    phase.live = false;
    if (failure !== null) throw failure;
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
        if (!o || typeof o !== 'object') throw new BehaviorError('tick takes {now, random?, trace?}');
        const t = begin(o.now, o.random, o.trace === true);
        let status: BehaviorStatus;
        try {
          status = run(t, 0);
        } finally {
          t.live = false;
        }
        commit(t);
        runAborts(t);
        return Object.freeze({status, trace: t.trace && Object.freeze(t.trace)});
      });
    },
    /** Abort everything running (scene exit, despawn, a new order). Abort handlers run in node order. */
    abort(now: number): readonly TraceRow[] {
      return guarded(() => {
        const t = begin(now, undefined, true);
        abort(t, 0);
        t.live = false;
        commit(t);
        runAborts(t);
        return Object.freeze(t.trace!);
      });
    },
    /** Running node indices, root first: the resume chain a save carries. */
    running(): readonly number[] {
      idle();
      return Object.freeze([...memory.keys()].sort((a, b) => a - b));
    },
    get(key: string): BlackboardValue | undefined {
      idle();
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
      idle();
      return Object.freeze(Object.fromEntries([...blackboard].sort(([a], [b]) => (a < b ? -1 : 1))));
    },
    snapshot(): BehaviorSnapshot {
      idle();
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
  if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype || v.length > max)
    throw new BehaviorError(`${what} must be an array of at most ${max}`);
  if (Reflect.ownKeys(v).length !== v.length + 1) throw new BehaviorError(`${what} must be dense data`);
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
  // Only states a tick can leave behind: each remembered node's remembered children match its kind.
  const COMPOSITE = new Set(['sequence', 'selector', 'shuffle']);
  const ONE_CHILD = new Set(['invert', 'succeed', 'fail', 'timeout', 'cooldown', 'guard']);
  const LEAF = new Set(['action', 'wait']);
  for (const [index, m] of memory) {
    const n = nodes[index]!;
    const kept = n.children.filter(c => memory.has(c));
    const wrong = (why: string) => new BehaviorError(`node ${index} (${n.type}): ${why}`);
    if (!COMPOSITE.has(n.type) && m.cursor !== 0) throw wrong('cursor without a composite');
    if (n.type !== 'repeat' && n.type !== 'retry' && m.count !== 0) throw wrong('count without repeat or retry');
    if (n.type === 'parallel' && !m.results) throw wrong('a running parallel needs its results');
    if (COMPOSITE.has(n.type)) {
      const expected = n.children[m.order ? m.order[m.cursor]! : m.cursor]!;
      if (kept.length !== 1 || kept[0] !== expected) throw wrong('exactly the child at the cursor must be running');
    } else if (n.type === 'parallel') {
      const pending = n.children.filter((_, c) => m.results![c] === 0);
      if (!pending.length || kept.length !== pending.length || kept.some(c => !pending.includes(c)))
        throw wrong('the running children must be exactly the pending ones');
      const succ = m.results!.filter(r => r === 1).length,
        fail = m.results!.filter(r => r === 2).length;
      if (
        (n.fail === 'any' ? fail > 0 : fail === n.children.length) ||
        (n.succeed === 'any' ? succ > 0 : succ === n.children.length)
      )
        throw wrong('a decided parallel cannot be running');
    } else if (ONE_CHILD.has(n.type)) {
      if (kept.length !== 1) throw wrong('its child must be running');
    } else if (n.type === 'repeat' || n.type === 'retry') {
      if (kept.length > 1) throw wrong('one child at most');
      if (n.times !== null && m.count >= n.times) throw wrong('count reached its limit');
    } else if (!LEAF.has(n.type)) throw wrong('this node kind never stays running');
  }
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
