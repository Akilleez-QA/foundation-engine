/**
 * kits/entity-pool/pool.ts: a bounded membership pool with creator-declared eviction classes.
 *
 * A game declares classes of pooled things (effects, debris, ambient creatures, pickups, enemies) with a priority, a
 * cost, an optional per-class cap and an eviction order. The pool admits ids (ECS entities or any nonnegative safe
 * integer) under a creator cap on member count and total cost. When admission would exceed a cap, members of
 * expendable (`evictable`) classes with a lower priority than the requester are evicted, lowest priority first, then
 * in each class's deterministic order (oldest, newest or lowest score, ties by admission order). A class with
 * `replaceOwn` may also evict its own members, after the lower classes. Pinned members are never evicted. Admission
 * is atomic: either the whole eviction plan fits the limits and is applied, or nothing changes and the result says
 * why.
 *
 * The caller owns what a member is, creating and destroying it (the World adapter in ./world.ts does that for ECS
 * entities and emits events), what an eviction means to the game, and the cap values (a scene's budget, a device
 * profile). Nothing here schedules, reads a clock or calls back. Tables are allocated at construction; steady-state
 * admit, release, pin and setScore allocate nothing beyond the id map's own bounded entries.
 */

export type EvictionOrder = 'oldest' | 'newest' | 'score';

export interface PoolClass {
  /** Higher survives longer. A request may evict only lower-priority evictable classes (and itself with replaceOwn). Integer 0..1e6. */
  readonly priority: number;
  /** Members of this class may be evicted by higher-priority requests. Default false. */
  readonly evictable?: boolean;
  /** Units each member charges against `maxCost` (draws, triangles, update slots: the creator's unit). Integer 1..1e6, default 1. */
  readonly cost?: number;
  /** Most live members of this class. Integer 1..maxMembers, default maxMembers. */
  readonly max?: number;
  /** Which member of this class goes first. Default 'oldest'. 'score' evicts the lowest `setScore` value first. */
  readonly order?: EvictionOrder;
  /** A full pool or class may evict this class's own members (after lower classes) to admit a new one. Default false. */
  readonly replaceOwn?: boolean;
}

export interface EntityPoolLimits {
  /** Most live members in total. Positive safe integer <= POOL_CEILING.members. */
  readonly maxMembers: number;
  /** Most total cost. Positive safe integer; default: no cost cap beyond maxMembers × the largest class cost. */
  readonly maxCost?: number;
  /** Most members one admission may evict; a larger plan is refused. Integer 1..maxMembers, default min(16, maxMembers). */
  readonly maxEvictionsPerAdmit?: number;
  /** The classes, by name. 1..POOL_CEILING.classes entries; declaration order breaks priority ties. */
  readonly classes: Readonly<Record<string, PoolClass>>;
}

export const POOL_CEILING = Object.freeze({members: 1 << 20, classes: 64, priority: 1_000_000, cost: 1_000_000});

/**
 * - `admitted`: the id is a member; `count` ids were evicted to make room (listed in `evicted`).
 * - `refused`: nothing changed; `reason` says which limit could not be met.
 * - `duplicate`: the id is already a member; nothing changed.
 * - `closed`: disposed; nothing changed.
 */
export type PoolStatus = 'admitted' | 'refused' | 'duplicate' | 'closed';
/**
 * - `none`: not refused.
 * - `class-full`: the class is at its `max` and cannot replace its own members.
 * - `capacity`: the member count or cost cap cannot be met by evicting eligible members.
 * - `eviction-limit`: meeting the caps would evict more than `maxEvictionsPerAdmit`.
 */
export type PoolRefusal = 'none' | 'class-full' | 'capacity' | 'eviction-limit';

export interface PoolResult {
  status: PoolStatus;
  reason: PoolRefusal;
  /** Evicted ids in eviction order (`admit`), or the number that would be evicted (`check`, ids not filled). */
  readonly evicted: Float64Array;
  /** The class name of each evicted id. */
  readonly evictedClass: string[];
  count: number;
}

export function createPoolResult(limits: Pick<EntityPoolLimits, 'maxMembers' | 'maxEvictionsPerAdmit'>): PoolResult {
  const n = evictionLimit(limits);
  return {
    status: 'admitted',
    reason: 'none',
    evicted: new Float64Array(n),
    evictedClass: new Array<string>(n).fill(''),
    count: 0,
  };
}

export interface PoolClassStats {
  readonly live: number;
  readonly pinned: number;
  readonly admitted: number;
  readonly evicted: number;
  readonly refused: number;
  readonly released: number;
}

export interface PoolStats {
  readonly members: number;
  readonly cost: number;
  readonly closed: boolean;
  readonly classes: Readonly<Record<string, PoolClassStats>>;
}

export interface EntityPool {
  /** Class names in declaration order. */
  readonly classNames: readonly string[];
  /** Admit `id` into class `cls`, evicting as the classes allow. Writes `out`; returns `out.status`. */
  admit(id: number, cls: string, out: PoolResult): PoolStatus;
  /**
   * What `admit` of a new member of `cls` would do now, without changing membership: status, reason and `count`
   * evictions (ids not filled). With `countRefusal`, a refusal is added to the class's `refused` statistic (for owners
   * that check before creating the member, as `spawnPooled` does).
   */
  check(cls: string, out: PoolResult, countRefusal?: boolean): PoolStatus;
  /** Remove a member that ended for its own reasons (died, collected, scene left). False when not a member. */
  release(id: number): boolean;
  /** Protect a member from eviction (held, on screen, scripted) or end that protection. False when not a member. */
  pin(id: number, pinned?: boolean): boolean;
  /** Set the eviction score used by 'score' classes (lowest first). Finite. False when not a member. */
  setScore(id: number, score: number): boolean;
  has(id: number): boolean;
  classOf(id: number): string | undefined;
  readonly size: number;
  readonly cost: number;
  /**
   * Release members whose `alive(id)` is false (destroyed outside the pool), checking at most `maxChecks` members from
   * a rotating cursor. Returns the number released. Recovery for owners that forgot to call `release`.
   */
  sweep(alive: (id: number) => boolean, maxChecks: number): number;
  stats(): PoolStats;
  /** Terminal and idempotent; later calls report `closed` or false. */
  dispose(): void;
}

interface ClassRec {
  readonly name: string;
  readonly index: number;
  readonly priority: number;
  readonly evictable: boolean;
  readonly cost: number;
  readonly max: number;
  readonly order: EvictionOrder;
  readonly replaceOwn: boolean;
  /** Lower classes this class may evict, in eviction order (ascending priority, then declaration order). */
  victims: ClassRec[];
  /** Indexed binary heap of evictable (unpinned) slots of this class. */
  readonly heap: Int32Array;
  heapSize: number;
  live: number;
  pinned: number;
  admitted: number;
  evicted: number;
  refused: number;
  released: number;
}

function int(n: unknown, lo: number, hi: number, what: string): number {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < lo || n > hi)
    throw new RangeError(`entity pool: ${what} must be an integer ${lo}..${hi}`);
  return n;
}

function evictionLimit(limits: Pick<EntityPoolLimits, 'maxMembers' | 'maxEvictionsPerAdmit'>): number {
  const m = int(limits.maxMembers, 1, POOL_CEILING.members, 'maxMembers');
  return limits.maxEvictionsPerAdmit === undefined
    ? Math.min(16, m)
    : int(limits.maxEvictionsPerAdmit, 1, m, 'maxEvictionsPerAdmit');
}

function checkId(id: number): void {
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0)
    throw new RangeError('entity pool: id must be a nonnegative safe integer');
}

export function createEntityPool(limits: EntityPoolLimits): EntityPool {
  if (!limits || typeof limits !== 'object') throw new TypeError('entity pool: limits must be an object');
  const maxMembers = int(limits.maxMembers, 1, POOL_CEILING.members, 'maxMembers');
  const maxEvict = evictionLimit(limits);
  const decl = limits.classes;
  if (!decl || typeof decl !== 'object') throw new TypeError('entity pool: classes must be an object');
  const names = Object.keys(decl);
  if (names.length < 1 || names.length > POOL_CEILING.classes)
    throw new RangeError(`entity pool: 1..${POOL_CEILING.classes} classes are required`);
  const classes: ClassRec[] = [];
  const byName = new Map<string, ClassRec>();
  let maxClassCost = 1;
  for (const name of names) {
    if (name.length === 0) throw new RangeError('entity pool: class names must be nonempty');
    const c = decl[name];
    if (!c || typeof c !== 'object') throw new TypeError(`entity pool: class ${name} must be an object`);
    const order = c.order ?? 'oldest';
    if (order !== 'oldest' && order !== 'newest' && order !== 'score')
      throw new RangeError(`entity pool: class ${name} order must be oldest, newest or score`);
    for (const k of ['evictable', 'replaceOwn'] as const)
      if (c[k] !== undefined && typeof c[k] !== 'boolean')
        throw new TypeError(`entity pool: class ${name} ${k} must be boolean`);
    const max = c.max === undefined ? maxMembers : int(c.max, 1, maxMembers, `class ${name} max`);
    const cost = c.cost === undefined ? 1 : int(c.cost, 1, POOL_CEILING.cost, `class ${name} cost`);
    maxClassCost = Math.max(maxClassCost, cost);
    const rec: ClassRec = {
      name,
      index: classes.length,
      priority: int(c.priority, 0, POOL_CEILING.priority, `class ${name} priority`),
      evictable: c.evictable === true,
      cost,
      max,
      order,
      replaceOwn: c.replaceOwn === true,
      victims: [],
      heap: new Int32Array(max),
      heapSize: 0,
      live: 0,
      pinned: 0,
      admitted: 0,
      evicted: 0,
      refused: 0,
      released: 0,
    };
    classes.push(rec);
    byName.set(name, rec);
  }
  for (const c of classes)
    c.victims = classes
      .filter(v => v.evictable && v.priority < c.priority)
      .sort((a, b) => a.priority - b.priority || a.index - b.index);
  const maxCost =
    limits.maxCost === undefined
      ? maxMembers * maxClassCost
      : int(limits.maxCost, 1, Number.MAX_SAFE_INTEGER, 'maxCost');

  // Slot tables.
  const slotId = new Float64Array(maxMembers);
  const slotClass = new Int32Array(maxMembers);
  const slotSeq = new Float64Array(maxMembers);
  const slotScore = new Float64Array(maxMembers);
  const slotPos = new Int32Array(maxMembers).fill(-1); // heap position, -1 when pinned or free
  const slotUsed = new Uint8Array(maxMembers);
  const free = new Int32Array(maxMembers);
  for (let i = 0; i < maxMembers; i++) free[i] = maxMembers - 1 - i;
  let freeTop = maxMembers;
  const slots = new Map<number, number>();
  let size = 0,
    cost = 0,
    seq = 0,
    cursor = 0,
    closed = false;
  // Plan scratch: evictions per class index.
  const plan = new Int32Array(classes.length);

  // a goes before b (evicted first) in class c.
  const before = (c: ClassRec, a: number, b: number): boolean => {
    if (c.order === 'score' && slotScore[a] !== slotScore[b]) return slotScore[a]! < slotScore[b]!;
    return c.order === 'newest' ? slotSeq[a]! > slotSeq[b]! : slotSeq[a]! < slotSeq[b]!;
  };
  const place = (c: ClassRec, pos: number, s: number) => {
    c.heap[pos] = s;
    slotPos[s] = pos;
  };
  const up = (c: ClassRec, pos: number) => {
    const s = c.heap[pos]!;
    while (pos > 0) {
      const p = (pos - 1) >> 1;
      const ps = c.heap[p]!;
      if (!before(c, s, ps)) break;
      place(c, pos, ps);
      pos = p;
    }
    place(c, pos, s);
  };
  const down = (c: ClassRec, pos: number) => {
    const s = c.heap[pos]!;
    for (;;) {
      const l = pos * 2 + 1;
      if (l >= c.heapSize) break;
      let m = l;
      const r = l + 1;
      if (r < c.heapSize && before(c, c.heap[r]!, c.heap[l]!)) m = r;
      if (!before(c, c.heap[m]!, s)) break;
      place(c, pos, c.heap[m]!);
      pos = m;
    }
    place(c, pos, s);
  };
  const heapPush = (c: ClassRec, s: number) => {
    c.heap[c.heapSize] = s;
    slotPos[s] = c.heapSize++;
    up(c, c.heapSize - 1);
  };
  const heapRemove = (c: ClassRec, s: number) => {
    const pos = slotPos[s]!;
    slotPos[s] = -1;
    const last = c.heap[--c.heapSize]!;
    if (pos === c.heapSize) return;
    place(c, pos, last);
    up(c, pos);
    down(c, slotPos[last]!);
  };
  const removeSlot = (s: number) => {
    const c = classes[slotClass[s]!]!;
    if (slotPos[s]! >= 0) heapRemove(c, s);
    else c.pinned--;
    c.live--;
    size--;
    cost -= c.cost;
    slots.delete(slotId[s]!);
    slotUsed[s] = 0;
    free[freeTop++] = s;
  };

  const classFor = (cls: string): ClassRec => {
    const c = typeof cls === 'string' ? byName.get(cls) : undefined;
    if (!c) throw new RangeError(`entity pool: unknown class ${String(cls)}`);
    return c;
  };

  /** Fill `plan`; return the refusal, or 'none' with the eviction total in `out.count`. */
  const makePlan = (c: ClassRec, out: PoolResult): PoolRefusal => {
    plan.fill(0);
    let total = 0;
    // A full class can only make room by replacing its own members.
    const ownNeed = Math.max(0, c.live + 1 - c.max);
    if (ownNeed > 0) {
      if (!c.replaceOwn || c.heapSize < ownNeed) return 'class-full';
      plan[c.index] = ownNeed;
      total = ownNeed;
    }
    let countNeed = Math.max(0, size + 1 - total - maxMembers);
    let costNeed = Math.max(0, cost + c.cost - total * c.cost - maxCost);
    const take = (v: ClassRec) => {
      const avail = v.heapSize - plan[v.index]!;
      if (avail <= 0 || (countNeed <= 0 && costNeed <= 0)) return;
      const n = Math.min(avail, Math.max(countNeed, Math.ceil(costNeed / v.cost)));
      plan[v.index]! += n;
      total += n;
      countNeed -= n;
      costNeed -= n * v.cost;
    };
    for (const v of c.victims) take(v);
    if (c.replaceOwn) take(c);
    if (countNeed > 0 || costNeed > 0) return 'capacity';
    if (total > maxEvict) return 'eviction-limit';
    out.count = total;
    return 'none';
  };

  const finish = (out: PoolResult, status: PoolStatus, reason: PoolRefusal): PoolStatus => {
    out.status = status;
    out.reason = reason;
    return status;
  };

  const checkOut = (out: PoolResult) => {
    if (!out || !(out.evicted instanceof Float64Array) || !Array.isArray(out.evictedClass))
      throw new TypeError('entity pool: result must come from createPoolResult');
    if (out.evicted.length < maxEvict || out.evictedClass.length < maxEvict)
      throw new RangeError('entity pool: result is smaller than maxEvictionsPerAdmit');
  };

  const pool: EntityPool = {
    classNames: Object.freeze(names.slice()),
    admit(id, cls, out) {
      checkOut(out);
      out.count = 0;
      if (closed) return finish(out, 'closed', 'none');
      checkId(id);
      const c = classFor(cls);
      if (slots.has(id)) return finish(out, 'duplicate', 'none');
      const reason = makePlan(c, out);
      if (reason !== 'none') {
        out.count = 0;
        c.refused++;
        return finish(out, 'refused', reason);
      }
      // Apply: own-class replacements first when the class was full, then victims in plan order.
      let k = 0;
      const evictFrom = (v: ClassRec, n: number) => {
        for (let i = 0; i < n; i++) {
          const s = v.heap[0]!;
          out.evicted[k] = slotId[s]!;
          out.evictedClass[k++] = v.name;
          v.evicted++;
          removeSlot(s);
        }
      };
      const ownForced = Math.max(0, c.live + 1 - c.max);
      evictFrom(c, ownForced);
      plan[c.index]! -= ownForced;
      for (const v of c.victims) evictFrom(v, plan[v.index]!);
      if (c.replaceOwn) evictFrom(c, plan[c.index]!);
      out.count = k;
      const s = free[--freeTop]!;
      slotUsed[s] = 1;
      slotId[s] = id;
      slotClass[s] = c.index;
      slotSeq[s] = seq++;
      slotScore[s] = 0;
      slots.set(id, s);
      heapPush(c, s);
      c.live++;
      c.admitted++;
      size++;
      cost += c.cost;
      return finish(out, 'admitted', 'none');
    },
    check(cls, out, countRefusal = false) {
      checkOut(out);
      out.count = 0;
      if (closed) return finish(out, 'closed', 'none');
      const c = classFor(cls);
      const reason = makePlan(c, out);
      if (reason !== 'none') {
        out.count = 0;
        if (countRefusal === true) c.refused++;
        return finish(out, 'refused', reason);
      }
      return finish(out, 'admitted', 'none');
    },
    release(id) {
      if (closed) return false;
      checkId(id);
      const s = slots.get(id);
      if (s === undefined) return false;
      classes[slotClass[s]!]!.released++;
      removeSlot(s);
      return true;
    },
    pin(id, pinned = true) {
      if (closed) return false;
      checkId(id);
      if (typeof pinned !== 'boolean') throw new TypeError('entity pool: pinned must be boolean');
      const s = slots.get(id);
      if (s === undefined) return false;
      const c = classes[slotClass[s]!]!;
      const isPinned = slotPos[s]! < 0;
      if (pinned && !isPinned) {
        heapRemove(c, s);
        c.pinned++;
      } else if (!pinned && isPinned) {
        c.pinned--;
        heapPush(c, s);
      }
      return true;
    },
    setScore(id, score) {
      if (closed) return false;
      checkId(id);
      if (typeof score !== 'number' || !Number.isFinite(score))
        throw new RangeError('entity pool: score must be finite');
      const s = slots.get(id);
      if (s === undefined) return false;
      slotScore[s] = score === 0 ? 0 : score; // fold -0
      const pos = slotPos[s]!;
      if (pos >= 0) {
        const c = classes[slotClass[s]!]!;
        up(c, pos);
        down(c, slotPos[s]!);
      }
      return true;
    },
    has(id) {
      return !closed && slots.has(id);
    },
    classOf(id) {
      if (closed) return undefined;
      const s = slots.get(id);
      return s === undefined ? undefined : classes[slotClass[s]!]!.name;
    },
    get size() {
      return closed ? 0 : size;
    },
    get cost() {
      return closed ? 0 : cost;
    },
    sweep(alive, maxChecks) {
      if (typeof alive !== 'function') throw new TypeError('entity pool: alive must be a function');
      int(maxChecks, 0, POOL_CEILING.members, 'maxChecks');
      if (closed) return 0;
      let released = 0;
      for (let i = 0; i < maxChecks && size > 0; i++) {
        // Visit used slots only: skip free ones without charging a check.
        let guard = maxMembers;
        while (!slotUsed[cursor] && guard-- > 0) cursor = (cursor + 1) % maxMembers;
        const s = cursor;
        cursor = (cursor + 1) % maxMembers;
        if (!slotUsed[s]) break;
        if (!alive(slotId[s]!)) {
          classes[slotClass[s]!]!.released++;
          removeSlot(s);
          released++;
        }
      }
      return released;
    },
    stats() {
      const per: Record<string, PoolClassStats> = {};
      for (const c of classes)
        per[c.name] = Object.freeze({
          live: closed ? 0 : c.live,
          pinned: closed ? 0 : c.pinned,
          admitted: c.admitted,
          evicted: c.evicted,
          refused: c.refused,
          released: c.released,
        });
      return Object.freeze({members: pool.size, cost: pool.cost, closed, classes: Object.freeze(per)});
    },
    dispose() {
      if (closed) return;
      closed = true;
      slots.clear();
    },
  };
  return pool;
}
