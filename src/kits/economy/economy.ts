import {
  amount,
  amounts,
  EconomyError,
  id,
  isEconomyId,
  isEconomyRules,
  plain,
  type Amounts,
  type EconomyRules,
  type Item,
} from './rules';

/** Rates are per-mille: 1,000 is normal speed, 500 half, 0 paused. */
export const RATE_ONE = 1000;
const MAX_RATE = 1_000_000;

export interface EconomyOptions {
  /** Production queues (1–1,024, default 64). */
  readonly maxQueues?: number;
  /** Entries per queue (1–256, default 32). */
  readonly maxQueueLength?: number;
  /** Income, upkeep and storage sources together (1–16,384, default 1,024). */
  readonly maxSources?: number;
  /** Reclaimable pools (1–16,384, default 1,024). */
  readonly maxPools?: number;
  /** Active reclaimers (1–16,384, default 1,024). */
  readonly maxReclaimers?: number;
  /** Distinct unlock ids (1–4,096, default 256). */
  readonly maxUnlocks?: number;
  /** Largest `advance` (1–3,600 ticks, default 600). */
  readonly maxAdvance?: number;
}

export type QueueState = 'idle' | 'blocked' | 'waiting' | 'building' | 'paused';
export interface QueueView {
  readonly id: string;
  readonly rate: number;
  readonly state: QueueState;
  readonly entries: readonly Readonly<{item: string; repeat: boolean}>[];
  /** Head progress in work units (item work × 1,000 when complete). */
  readonly progress: number;
  readonly paid: Amounts;
}
export type EconomyEvent = Readonly<
  | {kind: 'started'; queue: string; item: string}
  | {kind: 'completed'; queue: string; item: string}
  | {kind: 'cancelled'; queue: string; item: string; refunded: Amounts; lost: Amounts}
  | {kind: 'pool-exhausted' | 'pool-decayed'; pool: string; lost: Amounts}
  | {kind: 'reclaimer-released'; reclaimer: string; pool: string}
>;
export interface TickReport {
  readonly tick: number;
  /** Net income and upkeep actually applied, overflow beyond storage, and upkeep that could not be paid. */
  readonly income: Amounts;
  readonly wasted: Amounts;
  readonly shortfall: Amounts;
  readonly spent: Amounts;
  readonly reclaimed: Amounts;
}

interface Queue {
  rate: number;
  entries: {item: string; repeat: boolean}[];
  progress: number;
  paid: Record<string, number>;
  started: boolean;
  state: QueueState;
}
interface Pool {
  total: Record<string, number>;
  extracted: Record<string, number>;
  work: number;
  done: number;
  expiresAt: number | null;
}
interface State {
  now: number;
  stock: Record<string, number>;
  sources: Map<string, {kind: 'income' | 'storage'; amounts: Amounts}>;
  queues: Map<string, Queue>;
  unlocks: Map<string, number>;
  pools: Map<string, Pool>;
  reclaimers: Map<string, {pool: string; rate: number}>;
}

const sorted = <T>(m: Map<string, T>) => [...m.keys()].sort();
const big = BigInt;
/** floor(cost × progress / total), exactly. */
const share = (cost: number, progress: number, total: number) => Number((big(cost) * big(progress)) / big(total));
/** The largest progress p with floor(cost × p / total) ≤ limit. */
const maxProgress = (cost: number, limit: number, total: number) =>
  Number(((big(limit) + 1n) * big(total) - 1n) / big(cost));

/**
 * One economy (a team, a player, a colony): stock with storage caps, income and upkeep sources, production queues
 * with prerequisites, reclaimable pools and reclaimers, on the caller's fixed tick. Every mutation validates first
 * and applies completely; `advance` work per tick is bounded by sources, queues and reclaimers.
 */
export function createEconomy(rules: EconomyRules, options: EconomyOptions = {}) {
  if (!isEconomyRules(rules)) throw new EconomyError('use rules returned by defineEconomyRules');
  const o = plain(options, 'options');
  const limit = (v: unknown, fallback: number, max: number, what: string) =>
    amount(v === undefined ? fallback : v, what, 1, max);
  const maxQueues = limit(o.maxQueues, 64, 1024, 'maxQueues');
  const maxQueueLength = limit(o.maxQueueLength, 32, 256, 'maxQueueLength');
  const maxSources = limit(o.maxSources, 1024, 16384, 'maxSources');
  const maxPools = limit(o.maxPools, 1024, 16384, 'maxPools');
  const maxReclaimers = limit(o.maxReclaimers, 1024, 16384, 'maxReclaimers');
  const maxUnlocks = limit(o.maxUnlocks, 256, 4096, 'maxUnlocks');
  const maxAdvance = limit(o.maxAdvance, 600, 3600, 'maxAdvance');
  const resources = rules.resources.map(r => r.id);
  const known = new Set(resources);
  const items = new Map(rules.items.map(i => [i.id, i]));
  const item = (iid: string): Item => {
    const it = typeof iid === 'string' ? items.get(iid) : undefined;
    if (!it) throw new EconomyError(`unknown item ${String(iid)}`);
    return it;
  };

  let state: State = {
    now: 0,
    stock: Object.fromEntries(rules.resources.map(r => [r.id, r.initial])),
    sources: new Map(),
    queues: new Map(),
    unlocks: new Map(),
    pools: new Map(),
    reclaimers: new Map(),
  };
  const capacity = (s: State, r: string) => {
    let cap = rules.resources.find(x => x.id === r)!.capacity;
    for (const src of s.sources.values()) if (src.kind === 'storage') cap += src.amounts[r] ?? 0;
    return Math.min(cap, Number.MAX_SAFE_INTEGER);
  };
  const copy = (s: State): State => ({
    now: s.now,
    stock: {...s.stock},
    sources: new Map(s.sources),
    queues: new Map(
      [...s.queues].map(([k, q]) => [k, {...q, entries: q.entries.map(e => ({...e})), paid: {...q.paid}}]),
    ),
    unlocks: new Map(s.unlocks),
    pools: new Map([...s.pools].map(([k, p]) => [k, {...p, total: {...p.total}, extracted: {...p.extracted}}])),
    reclaimers: new Map([...s.reclaimers].map(([k, r]) => [k, {...r}])),
  });
  /** Run a mutation on a copy; publish when it returns without throwing. */
  const transact = <T>(f: (s: State) => T): T => {
    const draft = copy(state);
    const result = f(draft);
    state = draft;
    return result;
  };
  const deposit = (s: State, r: string, n: number) => {
    const room = capacity(s, r) - s.stock[r]!;
    const added = Math.max(0, Math.min(room, n));
    s.stock[r]! += added;
    return n - added;
  };
  const prerequisitesMet = (s: State, it: Item) => it.requires.every(u => (s.unlocks.get(u) ?? 0) > 0);
  const grant = (s: State, it: Item) => {
    for (const u of it.grants) {
      if (!s.unlocks.has(u) && s.unlocks.size >= maxUnlocks) throw new EconomyError('unlock capacity');
      s.unlocks.set(u, (s.unlocks.get(u) ?? 0) + 1);
    }
  };
  const view = (k: string, q: Queue): QueueView =>
    Object.freeze({
      id: k,
      rate: q.rate,
      state: q.state,
      entries: Object.freeze(q.entries.map(e => Object.freeze({...e}))),
      progress: q.progress,
      paid: Object.freeze({...q.paid}),
    });
  const refreshState = (s: State, q: Queue) => {
    const head = q.entries[0];
    if (!head) q.state = 'idle';
    else if (q.rate === 0) q.state = 'paused';
    else if (!q.started && !prerequisitesMet(s, item(head.item))) q.state = 'blocked';
    else if (
      !q.started &&
      rules.costModel === 'upfront' &&
      !resources.every(r => s.stock[r]! >= (item(head.item).cost[r] ?? 0))
    )
      q.state = 'waiting';
    else q.state = 'building';
  };

  const tick = (s: State, events: EconomyEvent[]): TickReport => {
    s.now++;
    const income: Record<string, number> = {},
      wasted: Record<string, number> = {},
      shortfall: Record<string, number> = {},
      spent: Record<string, number> = {},
      reclaimed: Record<string, number> = {};
    const add = (rec: Record<string, number>, r: string, n: number) => {
      if (n) rec[r] = (rec[r] ?? 0) + n;
    };
    // 1. Income and upkeep: the net per resource, clamped to [0, capacity].
    const sourceKeys = sorted(s.sources);
    for (const r of resources) {
      let net = 0;
      for (const k of sourceKeys) {
        const src = s.sources.get(k)!;
        if (src.kind === 'income') net += src.amounts[r] ?? 0;
      }
      if (net > 0) {
        const lost = deposit(s, r, net);
        add(income, r, net - lost);
        add(wasted, r, lost);
      } else if (net < 0) {
        const paid = Math.min(s.stock[r]!, -net);
        s.stock[r]! -= paid;
        add(income, r, -paid);
        add(shortfall, r, -net - paid);
      }
    }
    // 2. Reclaim, in reclaimer id order; extraction stops at free storage.
    for (const k of sorted(s.reclaimers)) {
      const rc = s.reclaimers.get(k)!;
      const pool = s.pools.get(rc.pool)!;
      const total = pool.work * RATE_ONE;
      let target = Math.min(total, pool.done + rc.rate);
      for (const r of Object.keys(pool.total)) {
        const free = capacity(s, r) - s.stock[r]!;
        target = Math.min(target, maxProgress(pool.total[r]!, pool.extracted[r]! + free, total));
      }
      if (target <= pool.done) continue;
      for (const r of Object.keys(pool.total)) {
        const n = share(pool.total[r]!, target, total) - pool.extracted[r]!;
        pool.extracted[r]! += n;
        s.stock[r]! += n;
        add(reclaimed, r, n);
      }
      pool.done = target;
      if (pool.done === total) {
        s.pools.delete(rc.pool);
        events.push(Object.freeze({kind: 'pool-exhausted', pool: rc.pool, lost: Object.freeze({})}));
        for (const other of sorted(s.reclaimers))
          if (s.reclaimers.get(other)!.pool === rc.pool) {
            s.reclaimers.delete(other);
            events.push(Object.freeze({kind: 'reclaimer-released', reclaimer: other, pool: rc.pool}));
          }
      }
    }
    for (const k of sorted(s.pools)) {
      const pool = s.pools.get(k)!;
      if (pool.expiresAt !== null && pool.expiresAt <= s.now) {
        const lost: Record<string, number> = {};
        for (const r of Object.keys(pool.total)) {
          const n = pool.total[r]! - pool.extracted[r]!;
          if (n) lost[r] = n;
        }
        s.pools.delete(k);
        events.push(Object.freeze({kind: 'pool-decayed', pool: k, lost: Object.freeze(lost)}));
        for (const other of sorted(s.reclaimers))
          if (s.reclaimers.get(other)!.pool === k) {
            s.reclaimers.delete(other);
            events.push(Object.freeze({kind: 'reclaimer-released', reclaimer: other, pool: k}));
          }
      }
    }
    // 3. Production, in queue id order.
    const active: {k: string; q: Queue; it: Item; dp: number}[] = [];
    for (const k of sorted(s.queues)) {
      const q = s.queues.get(k)!;
      const head = q.entries[0];
      if (!head || q.rate === 0) {
        refreshState(s, q);
        continue;
      }
      const it = item(head.item);
      if (!q.started) {
        if (!prerequisitesMet(s, it)) {
          q.state = 'blocked';
          continue;
        }
        if (rules.costModel === 'upfront') {
          if (!resources.every(r => s.stock[r]! >= (it.cost[r] ?? 0))) {
            q.state = 'waiting';
            continue;
          }
          for (const r of Object.keys(it.cost)) {
            s.stock[r]! -= it.cost[r]!;
            q.paid[r] = it.cost[r]!;
            add(spent, r, it.cost[r]!);
          }
        }
        q.started = true;
        events.push(Object.freeze({kind: 'started', queue: k, item: it.id}));
      }
      q.state = 'building';
      active.push({k, q, it, dp: Math.min(q.rate, it.work * RATE_ONE - q.progress)});
    }
    if (rules.costModel === 'streamed') {
      // Equal slowdown: the scarcest resource sets one fraction num/den for every queue this tick.
      const demand: Record<string, number> = {};
      for (const a of active)
        for (const r of Object.keys(a.it.cost)) {
          const total = a.it.work * RATE_ONE;
          demand[r] = (demand[r] ?? 0) + share(a.it.cost[r]!, a.q.progress + a.dp, total) - (a.q.paid[r] ?? 0);
        }
      let num = 1,
        den = 1;
      for (const r of Object.keys(demand).sort())
        if (demand[r]! > s.stock[r]! && s.stock[r]! * den < num * demand[r]!) {
          num = s.stock[r]!;
          den = demand[r]!;
        }
      for (const a of active) {
        const total = a.it.work * RATE_ONE;
        let dp = Number((big(a.dp) * big(num)) / big(den));
        // Rounding can make one queue's share exceed what is left: cap by the stock that remains.
        for (const r of Object.keys(a.it.cost))
          dp = Math.min(dp, maxProgress(a.it.cost[r]!, (a.q.paid[r] ?? 0) + s.stock[r]!, total) - a.q.progress);
        dp = Math.max(0, dp);
        for (const r of Object.keys(a.it.cost)) {
          const n = share(a.it.cost[r]!, a.q.progress + dp, total) - (a.q.paid[r] ?? 0);
          s.stock[r]! -= n;
          a.q.paid[r] = (a.q.paid[r] ?? 0) + n;
          add(spent, r, n);
        }
        a.dp = dp;
      }
    }
    for (const a of active) {
      a.q.progress += a.dp;
      if (a.q.progress < a.it.work * RATE_ONE) continue;
      const done = a.q.entries.shift()!;
      grant(s, a.it);
      events.push(Object.freeze({kind: 'completed', queue: a.k, item: a.it.id}));
      if (done.repeat) a.q.entries.push(done);
      a.q.progress = 0;
      a.q.paid = {};
      a.q.started = false;
      refreshState(s, a.q);
    }
    const freeze = (r: Record<string, number>) => Object.freeze(r);
    return Object.freeze({
      tick: s.now,
      income: freeze(income),
      wasted: freeze(wasted),
      shortfall: freeze(shortfall),
      spent: freeze(spent),
      reclaimed: freeze(reclaimed),
    });
  };

  const sourceId = (v: unknown) => id(v, 'source id');
  return Object.freeze({
    get now() {
      return state.now;
    },
    stock(): Amounts {
      return Object.freeze({...state.stock});
    },
    capacity(): Amounts {
      return Object.freeze(Object.fromEntries(resources.map(r => [r, capacity(state, r)])));
    },
    /** Add stock now (a reward, a refund from elsewhere). Returns what did not fit. */
    deposit(add: Amounts): Amounts {
      const parsed = amounts(add, known, 'deposit');
      return transact(s => {
        const lost: Record<string, number> = {};
        for (const r of Object.keys(parsed)) {
          const n = deposit(s, r, parsed[r]!);
          if (n) lost[r] = n;
        }
        return Object.freeze(lost);
      });
    },
    /** Take stock now if all of it is available; false changes nothing. */
    withdraw(take: Amounts): boolean {
      const parsed = amounts(take, known, 'withdraw');
      if (!Object.keys(parsed).every(r => state.stock[r]! >= parsed[r]!)) return false;
      transact(s => {
        for (const r of Object.keys(parsed)) s.stock[r]! -= parsed[r]!;
      });
      return true;
    },
    /** Set a keyed income (positive) or upkeep (negative) per tick, replacing that key. Empty amounts remove it. */
    setIncome(key: string, perTick: Amounts): boolean {
      const k = sourceId(key);
      const parsed = amounts(perTick, known, 'income', -1e9, 1e9);
      return setSource(k, 'income', parsed);
    },
    /** Set a keyed storage addition, replacing that key. Shrinking storage below stock keeps the stock (no loss). */
    setStorage(key: string, extra: Amounts): boolean {
      const k = sourceId(key);
      return setSource(k, 'storage', amounts(extra, known, 'storage'));
    },
    removeSource(key: string): boolean {
      if (!state.sources.has(key)) return false;
      transact(s => s.sources.delete(key));
      return true;
    },
    /** Create or re-rate a queue. Rate 0 pauses it (power off) and keeps its progress. */
    setQueue(queue: string, rate = RATE_ONE): boolean {
      const k = id(queue, 'queue id');
      amount(rate, 'rate', 0, MAX_RATE);
      if (!state.queues.has(k) && state.queues.size >= maxQueues) return false;
      transact(s => {
        const q = s.queues.get(k) ?? {
          rate,
          entries: [],
          progress: 0,
          paid: {},
          started: false,
          state: 'idle' as QueueState,
        };
        q.rate = rate;
        s.queues.set(k, q);
        refreshState(s, q);
      });
      return true;
    },
    /**
     * Append `count` entries of an item. Refused (false) when the queue is unknown or would exceed its length. The
     * prerequisites are checked when an entry starts, not here (`canBuild` tells the UI).
     */
    enqueue(queue: string, itemId: string, o2: {count?: number; repeat?: boolean} = {}): boolean {
      const it = item(itemId);
      const count = amount(o2.count ?? 1, 'count', 1, 256);
      const repeat = o2.repeat ?? false;
      if (typeof repeat !== 'boolean') throw new EconomyError('repeat must be boolean');
      const q = state.queues.get(queue);
      if (!q || q.entries.length + count > maxQueueLength) return false;
      transact(s => {
        const draft = s.queues.get(queue)!;
        for (let i = 0; i < count; i++) draft.entries.push({item: it.id, repeat});
        refreshState(s, draft);
      });
      return true;
    },
    /** Remove one entry. Cancelling the started head refunds `refundPercent` of what it paid (excess storage is lost). */
    cancel(queue: string, index: number): EconomyEvent | null {
      const q = state.queues.get(queue);
      if (!q || !Number.isSafeInteger(index) || index < 0 || index >= q.entries.length) return null;
      return transact(s => cancelIn(s, queue, index));
    },
    /** Remove a queue (its building was lost); every entry is cancelled, the started head with the refund rule. */
    removeQueue(queue: string): readonly EconomyEvent[] {
      if (!state.queues.has(queue)) return Object.freeze([]);
      return transact(s => {
        const events: EconomyEvent[] = [];
        while (s.queues.get(queue)!.entries.length)
          events.push(cancelIn(s, queue, s.queues.get(queue)!.entries.length - 1));
        s.queues.delete(queue);
        return Object.freeze(events);
      });
    },
    queue(queue: string): QueueView | null {
      const q = state.queues.get(queue);
      return q ? view(queue, q) : null;
    },
    queues(): readonly QueueView[] {
      return Object.freeze(sorted(state.queues).map(k => view(k, state.queues.get(k)!)));
    },
    /** Whether an item's prerequisites are met now (for menus). */
    canBuild(itemId: string): boolean {
      return prerequisitesMet(state, item(itemId));
    },
    unlocks(): Readonly<Record<string, number>> {
      return Object.freeze(Object.fromEntries(sorted(state.unlocks).map(k => [k, state.unlocks.get(k)!])));
    },
    /** Change an unlock count (a granting building was destroyed: -1). Counts never go below zero. */
    adjustUnlock(unlock: string, delta: number): number {
      const u = id(unlock, 'unlock id');
      amount(Math.abs(delta), 'delta', 0, 1_000_000);
      if (!Number.isInteger(delta)) throw new EconomyError('delta must be an integer');
      const next = Math.max(0, (state.unlocks.get(u) ?? 0) + delta);
      if (!state.unlocks.has(u) && next > 0 && state.unlocks.size >= maxUnlocks)
        throw new EconomyError('unlock capacity');
      transact(s => {
        if (next === 0) s.unlocks.delete(u);
        else s.unlocks.set(u, next);
        for (const q of s.queues.values()) refreshState(s, q);
      });
      return next;
    },
    /** Add a reclaimable pool (a wreck, a resource feature): `work` ticks at rate 1,000; optional decay tick count. */
    addPool(pool: string, o3: {amounts: Amounts; work: number; decayTicks?: number}): boolean {
      const k = id(pool, 'pool id');
      const total = amounts(o3.amounts, known, 'pool amounts');
      if (!Object.keys(total).length) throw new EconomyError('a pool needs some amount');
      const work = amount(o3.work, 'pool work', 1, 1e9);
      const decay = o3.decayTicks === undefined ? null : amount(o3.decayTicks, 'decayTicks', 1, 1e9);
      if (state.pools.has(k) || state.pools.size >= maxPools) return false;
      transact(s =>
        s.pools.set(k, {
          total: {...total},
          extracted: Object.fromEntries(Object.keys(total).map(r => [r, 0])),
          work,
          done: 0,
          expiresAt: decay === null ? null : s.now + decay,
        }),
      );
      return true;
    },
    /** Remove a pool without yielding it (it was destroyed); its reclaimers are released. */
    removePool(pool: string): readonly EconomyEvent[] {
      if (!state.pools.has(pool)) return Object.freeze([]);
      return transact(s => {
        s.pools.delete(pool);
        const events: EconomyEvent[] = [];
        for (const r of sorted(s.reclaimers))
          if (s.reclaimers.get(r)!.pool === pool) {
            s.reclaimers.delete(r);
            events.push(Object.freeze({kind: 'reclaimer-released', reclaimer: r, pool}));
          }
        return Object.freeze(events);
      });
    },
    pools(): readonly Readonly<{
      id: string;
      remaining: Amounts;
      done: number;
      work: number;
      expiresAt: number | null;
    }>[] {
      return Object.freeze(
        sorted(state.pools).map(k => {
          const p = state.pools.get(k)!;
          return Object.freeze({
            id: k,
            remaining: Object.freeze(
              Object.fromEntries(Object.keys(p.total).map(r => [r, p.total[r]! - p.extracted[r]!])),
            ),
            done: p.done,
            work: p.work * RATE_ONE,
            expiresAt: p.expiresAt,
          });
        }),
      );
    },
    /** Assign a reclaimer to a pool at a per-mille rate (replacing its previous assignment); rate 0 or no pool releases. */
    setReclaimer(reclaimer: string, pool: string | null, rate = RATE_ONE): boolean {
      const k = id(reclaimer, 'reclaimer id');
      if (pool === null) {
        if (!state.reclaimers.has(k)) return false;
        transact(s => s.reclaimers.delete(k));
        return true;
      }
      amount(rate, 'rate', 1, MAX_RATE);
      if (!state.pools.has(pool)) return false;
      if (!state.reclaimers.has(k) && state.reclaimers.size >= maxReclaimers) return false;
      transact(s => s.reclaimers.set(k, {pool, rate}));
      return true;
    },
    /** Advance whole ticks: income/upkeep, reclaim, pool decay, production. Returns one report per tick and the events. */
    advance(ticks = 1): Readonly<{reports: readonly TickReport[]; events: readonly EconomyEvent[]}> {
      amount(ticks, 'ticks', 1, maxAdvance);
      return transact(s => {
        const events: EconomyEvent[] = [];
        const reports: TickReport[] = [];
        for (let i = 0; i < ticks; i++) reports.push(tick(s, events));
        return Object.freeze({reports: Object.freeze(reports), events: Object.freeze(events)});
      });
    },
    snapshot(): EconomySnapshot {
      const s = state;
      return Object.freeze({
        version: 1 as const,
        signature: rules.signature,
        now: s.now,
        stock: Object.freeze({...s.stock}),
        sources: Object.freeze(
          sorted(s.sources).map(k =>
            Object.freeze({key: k, kind: s.sources.get(k)!.kind, amounts: s.sources.get(k)!.amounts}),
          ),
        ),
        queues: Object.freeze(
          sorted(s.queues).map(k => {
            const q = s.queues.get(k)!;
            return Object.freeze({
              id: k,
              rate: q.rate,
              entries: Object.freeze(q.entries.map(e => Object.freeze({...e}))),
              progress: q.progress,
              paid: Object.freeze({...q.paid}),
              started: q.started,
            });
          }),
        ),
        unlocks: Object.freeze(sorted(s.unlocks).map(k => Object.freeze([k, s.unlocks.get(k)!] as const))),
        pools: Object.freeze(
          sorted(s.pools).map(k => {
            const p = s.pools.get(k)!;
            return Object.freeze({
              id: k,
              total: Object.freeze({...p.total}),
              extracted: Object.freeze({...p.extracted}),
              work: p.work,
              done: p.done,
              expiresAt: p.expiresAt,
            });
          }),
        ),
        reclaimers: Object.freeze(sorted(s.reclaimers).map(k => Object.freeze({id: k, ...s.reclaimers.get(k)!}))),
      });
    },
    /** Replace all state from a snapshot of the same rules; validated completely before anything changes. */
    restore(raw: unknown): void {
      state = parseSnapshot(raw);
    },
  });

  function cancelIn(s: State, queue: string, index: number): EconomyEvent {
    const draft = s.queues.get(queue)!;
    const [entry] = draft.entries.splice(index, 1);
    const refunded: Record<string, number> = {},
      lost: Record<string, number> = {};
    if (index === 0 && draft.started) {
      for (const r of Object.keys(draft.paid).sort()) {
        const back = Math.floor((draft.paid[r]! * rules.refundPercent) / 100);
        const overflow = deposit(s, r, back);
        if (back - overflow) refunded[r] = back - overflow;
        if (draft.paid[r]! - back + overflow) lost[r] = draft.paid[r]! - back + overflow;
      }
      draft.progress = 0;
      draft.paid = {};
      draft.started = false;
    }
    refreshState(s, draft);
    return Object.freeze({
      kind: 'cancelled',
      queue,
      item: entry!.item,
      refunded: Object.freeze(refunded),
      lost: Object.freeze(lost),
    });
  }

  function setSource(k: string, kind: 'income' | 'storage', parsed: Amounts): boolean {
    const existing = state.sources.get(k);
    if (existing && existing.kind !== kind) throw new EconomyError(`source ${k} is a ${existing.kind} source`);
    if (!existing && state.sources.size >= maxSources) return false;
    transact(s => {
      if (Object.keys(parsed).length) s.sources.set(k, {kind, amounts: parsed});
      else s.sources.delete(k);
    });
    return true;
  }

  function parseSnapshot(raw: unknown): State {
    const fields = (v: unknown, names: readonly string[], what: string) => {
      const r = plain(v, what);
      if (Object.keys(r).length !== names.length || !names.every(n => Object.hasOwn(r, n)))
        throw new EconomyError(`${what} has unexpected fields`);
      return r;
    };
    const list = (v: unknown, max: number, what: string): unknown[] => {
      if (!Array.isArray(v) || v.length > max) throw new EconomyError(`${what} must be an array of at most ${max}`);
      return Array.from({length: v.length}, (_, i) => {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d || !('value' in d)) throw new EconomyError(`${what} must be dense data`);
        return d.value;
      });
    };
    const s = fields(
      raw,
      ['version', 'signature', 'now', 'stock', 'sources', 'queues', 'unlocks', 'pools', 'reclaimers'],
      'snapshot',
    );
    if (s.version !== 1) throw new EconomyError('unsupported snapshot version');
    if (s.signature !== rules.signature) throw new EconomyError('snapshot was saved with different rules');
    const next: State = {
      now: amount(s.now, 'now', 0, 2 ** 50),
      stock: {},
      sources: new Map(),
      queues: new Map(),
      unlocks: new Map(),
      pools: new Map(),
      reclaimers: new Map(),
    };
    for (const e of list(s.sources, maxSources, 'sources')) {
      const r = fields(e, ['key', 'kind', 'amounts'], 'source');
      const k = sourceId(r.key);
      if (next.sources.has(k) || (r.kind !== 'income' && r.kind !== 'storage'))
        throw new EconomyError('invalid source');
      const parsed =
        r.kind === 'income' ? amounts(r.amounts, known, 'income', -1e9, 1e9) : amounts(r.amounts, known, 'storage');
      if (!Object.keys(parsed).length) throw new EconomyError('empty source');
      next.sources.set(k, {kind: r.kind, amounts: parsed});
    }
    const stock = plain(s.stock, 'stock');
    if (Object.keys(stock).length !== resources.length) throw new EconomyError('stock must list every resource');
    for (const r of resources) next.stock[r] = amount(stock[r], `stock.${r}`, 0, Number.MAX_SAFE_INTEGER);
    for (const e of list(s.unlocks, maxUnlocks, 'unlocks')) {
      const pair = list(e, 2, 'unlock');
      const u = id(pair[0], 'unlock id');
      if (pair.length !== 2 || next.unlocks.has(u)) throw new EconomyError('invalid unlock');
      next.unlocks.set(u, amount(pair[1], 'unlock count', 1, Number.MAX_SAFE_INTEGER));
    }
    for (const e of list(s.queues, maxQueues, 'queues')) {
      const r = fields(e, ['id', 'rate', 'entries', 'progress', 'paid', 'started'], 'queue');
      const k = id(r.id, 'queue id');
      if (next.queues.has(k)) throw new EconomyError('duplicate queue');
      const entries = list(r.entries, maxQueueLength, 'entries').map(x => {
        const en = fields(x, ['item', 'repeat'], 'entry');
        if (typeof en.repeat !== 'boolean') throw new EconomyError('invalid entry');
        return {item: item(en.item as string).id, repeat: en.repeat};
      });
      if (typeof r.started !== 'boolean' || (r.started && !entries.length))
        throw new EconomyError('invalid started flag');
      const head = entries[0] ? item(entries[0].item) : null;
      const total = head ? head.work * RATE_ONE : 0;
      const progress = amount(r.progress, 'progress', 0, Math.max(0, total - 1));
      if (!r.started && progress !== 0) throw new EconomyError('progress without a started head');
      const paid = amounts(r.paid, known, 'paid');
      for (const res of Object.keys(paid)) {
        const cost = head?.cost[res] ?? 0;
        const expected = !r.started ? 0 : rules.costModel === 'upfront' ? cost : share(cost, progress, total);
        if (paid[res] !== expected) throw new EconomyError('paid does not match progress');
      }
      if (r.started && head)
        for (const res of Object.keys(head.cost)) {
          const expected = rules.costModel === 'upfront' ? head.cost[res]! : share(head.cost[res]!, progress, total);
          if ((paid[res] ?? 0) !== expected) throw new EconomyError('paid does not match progress');
        }
      const q: Queue = {
        rate: amount(r.rate, 'rate', 0, MAX_RATE),
        entries,
        progress,
        paid: {...paid},
        started: r.started,
        state: 'idle',
      };
      next.queues.set(k, q);
    }
    for (const q of next.queues.values()) refreshState(next, q);
    for (const e of list(s.pools, maxPools, 'pools')) {
      const r = fields(e, ['id', 'total', 'extracted', 'work', 'done', 'expiresAt'], 'pool');
      const k = id(r.id, 'pool id');
      if (next.pools.has(k)) throw new EconomyError('duplicate pool');
      const total = amounts(r.total, known, 'pool total');
      const work = amount(r.work, 'pool work', 1, 1e9);
      const done = amount(r.done, 'pool done', 0, work * RATE_ONE - 1);
      const extracted = plain(r.extracted, 'pool extracted');
      if (!Object.keys(total).length || Object.keys(extracted).length !== Object.keys(total).length)
        throw new EconomyError('invalid pool amounts');
      const ex: Record<string, number> = {};
      for (const res of Object.keys(total)) {
        ex[res] = amount(extracted[res], 'extracted', 0, total[res]!);
        if (ex[res] !== share(total[res]!, done, work * RATE_ONE))
          throw new EconomyError('extracted does not match progress');
      }
      const expiresAt = r.expiresAt === null ? null : amount(r.expiresAt, 'expiresAt', next.now + 1, 2 ** 51);
      next.pools.set(k, {total: {...total}, extracted: ex, work, done, expiresAt});
    }
    for (const e of list(s.reclaimers, maxReclaimers, 'reclaimers')) {
      const r = fields(e, ['id', 'pool', 'rate'], 'reclaimer');
      const k = id(r.id, 'reclaimer id');
      if (next.reclaimers.has(k) || !isEconomyId(r.pool) || !next.pools.has(r.pool))
        throw new EconomyError('invalid reclaimer');
      next.reclaimers.set(k, {pool: r.pool, rate: amount(r.rate, 'rate', 1, MAX_RATE)});
    }
    return next;
  }
}
export type Economy = ReturnType<typeof createEconomy>;

export interface EconomySnapshot {
  readonly version: 1;
  readonly signature: string;
  readonly now: number;
  readonly stock: Amounts;
  readonly sources: readonly Readonly<{key: string; kind: 'income' | 'storage'; amounts: Amounts}>[];
  readonly queues: readonly Readonly<{
    id: string;
    rate: number;
    entries: readonly Readonly<{item: string; repeat: boolean}>[];
    progress: number;
    paid: Amounts;
    started: boolean;
  }>[];
  readonly unlocks: readonly (readonly [string, number])[];
  readonly pools: readonly Readonly<{
    id: string;
    total: Amounts;
    extracted: Amounts;
    work: number;
    done: number;
    expiresAt: number | null;
  }>[];
  readonly reclaimers: readonly Readonly<{id: string; pool: string; rate: number}>[];
}
