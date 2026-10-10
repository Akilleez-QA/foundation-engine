/**
 * kits/cadence/cadence.ts: bounded per-member update cadence on the caller's integer tick.
 *
 * Members (entities, agents, regions, connections) each have a period in ticks. `take(now, out)` returns the members
 * that are due, most overdue first, at most `maxDuePerTake` of them, together with the ticks elapsed since each was
 * last served; the rest stay due for the next take. Serving keeps the member on its phase grid: missed occurrences
 * are skipped, never replayed in a burst. New members are spread over their period deterministically (or at an
 * explicit phase) so a population added together does not run in lockstep.
 *
 * The caller owns the tick (a fixed-step counter), what serving means, the period policy (by distance, state or
 * importance; jitter via `ctx.random()` and `setPeriod`), and persistence (`snapshot`/`restore` through its own save
 * section). Nothing here schedules, calls back or reads a clock. Typed tables are allocated at construction (the id
 * map and free list are bounded by maxMembers); a steady-state `take` performs no table growth.
 */

export interface CadenceLimits {
  /** Most members. Positive safe integer <= CADENCE_CEILING.members. */
  readonly maxMembers: number;
  /** Most members returned by one take. Positive safe integer <= maxMembers. */
  readonly maxDuePerTake: number;
  /** Longest period in ticks. Positive safe integer <= CADENCE_CEILING.period. */
  readonly maxPeriod: number;
}

export const CADENCE_CEILING = Object.freeze({members: 1 << 20, period: 1 << 30});

/**
 * - `complete`: every due member was returned.
 * - `deferred`: `maxDuePerTake` was reached and at least one member is still due; it stays due (most overdue first).
 * - `closed`: disposed; nothing changed.
 */
export type CadenceStatus = 'complete' | 'deferred' | 'closed';

export interface CadenceTakeResult {
  status: CadenceStatus;
  /** Due member ids, earliest due first, ties by ascending id. */
  readonly ids: Float64Array;
  /** For each returned id: ticks since it was last served (or since it was added). */
  readonly elapsed: Float64Array;
  /** For each returned id: ticks it waited past its due tick (0 when served on time). */
  readonly late: Float64Array;
  count: number;
  /** The tick of this take. */
  now: number;
}

export function createCadenceResult(limits: Pick<CadenceLimits, 'maxDuePerTake'>): CadenceTakeResult {
  const n = limits.maxDuePerTake;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0)
    throw new RangeError('cadence result: maxDuePerTake must be a positive safe integer');
  return {
    status: 'complete',
    ids: new Float64Array(n),
    elapsed: new Float64Array(n),
    late: new Float64Array(n),
    count: 0,
    now: 0,
  };
}

/** Plain, JSON-safe state for a save section. Members are sorted by id. */
export interface CadenceSnapshot {
  readonly now: number;
  readonly members: readonly {
    readonly id: number;
    readonly period: number;
    readonly due: number;
    readonly last: number;
    /** The member's phase key: due ticks are congruent to `phase mod period`. */
    readonly phase: number;
  }[];
}

export interface CadenceStats {
  readonly members: number;
  readonly now: number;
  readonly closed: boolean;
}

export interface Cadence {
  readonly limits: CadenceLimits;
  /**
   * Add a member with a period. Its due ticks are the ticks congruent to `phase mod period`, where `phase` defaults
   * to the id (a deterministic spread that survives period changes). The first due tick is the next such tick after
   * `now` (the tick of the latest take), so it lies in `now+1 .. now+period`.
   */
  add(id: number, period: number, phase?: number): 'added' | 'duplicate' | 'saturated' | 'closed';
  remove(id: number): 'removed' | 'absent' | 'closed';
  has(id: number): boolean;
  /**
   * Change a member's period. The same period is a no-op. A member that is already due stays due. Otherwise its next
   * due tick is the first tick after its last serve congruent to `phase mod period`, or, if that has passed, the
   * first such tick after `now` (missed occurrences are skipped, as in `take`). The phase spread is preserved.
   */
  setPeriod(id: number, period: number): 'set' | 'absent' | 'closed';
  /** Return due members at tick `now` (a nondecreasing safe integer) into `out` and reschedule them. */
  take(now: number, out: CadenceTakeResult): CadenceTakeResult;
  snapshot(): CadenceSnapshot;
  /** Replace all state with a validated snapshot (throws before any change if it is malformed or over limits). */
  restore(snapshot: CadenceSnapshot): 'restored' | 'closed';
  /** Terminal and idempotent. */
  dispose(): void;
  readonly stats: CadenceStats;
}

const KEYS = ['maxMembers', 'maxDuePerTake', 'maxPeriod'] as const;
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const tick = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
/** Largest accepted tick: leaves room for a full period of arithmetic above it. */
export const MAX_CADENCE_TICK = Number.MAX_SAFE_INTEGER - 2 * CADENCE_CEILING.period;
const now_ = (n: unknown): n is number => tick(n) && n <= MAX_CADENCE_TICK;

export function createCadence(input: CadenceLimits): Cadence {
  if (input === null || typeof input !== 'object') throw new TypeError('cadence: limits must be an object');
  const extra = Object.keys(input).filter(k => !(KEYS as readonly string[]).includes(k));
  if (extra.length) throw new TypeError(`cadence: unknown limit '${extra[0]}'`);
  const limits: CadenceLimits = Object.freeze({
    maxMembers: input.maxMembers,
    maxDuePerTake: input.maxDuePerTake,
    maxPeriod: input.maxPeriod,
  });
  const {maxMembers, maxDuePerTake, maxPeriod} = limits;
  if (!positive(maxMembers) || maxMembers > CADENCE_CEILING.members)
    throw new RangeError(`cadence: maxMembers must be a positive safe integer <= ${CADENCE_CEILING.members}`);
  if (!positive(maxDuePerTake) || maxDuePerTake > maxMembers)
    throw new RangeError('cadence: maxDuePerTake must be a positive safe integer <= maxMembers');
  if (!positive(maxPeriod) || maxPeriod > CADENCE_CEILING.period)
    throw new RangeError(`cadence: maxPeriod must be a positive safe integer <= ${CADENCE_CEILING.period}`);

  // Slot tables and a binary min-heap of slots ordered by (due, id).
  const idOf = new Float64Array(maxMembers),
    periodOf = new Float64Array(maxMembers),
    dueOf = new Float64Array(maxMembers),
    lastOf = new Float64Array(maxMembers),
    phaseOf = new Float64Array(maxMembers),
    heapPos = new Int32Array(maxMembers),
    heap = new Int32Array(maxMembers);
  let size = 0;
  const slotOf = new Map<number, number>();
  const free: number[] = [];
  for (let i = maxMembers - 1; i >= 0; i--) free.push(i);
  let now = 0,
    closed = false;

  const before = (a: number, b: number) => dueOf[a]! < dueOf[b]! || (dueOf[a] === dueOf[b] && idOf[a]! < idOf[b]!);
  function place(at: number, slot: number) {
    heap[at] = slot;
    heapPos[slot] = at;
  }
  function up(at: number) {
    const slot = heap[at]!;
    while (at > 0) {
      const parent = (at - 1) >> 1,
        p = heap[parent]!;
      if (!before(slot, p)) break;
      place(at, p);
      at = parent;
    }
    place(at, slot);
  }
  function down(at: number) {
    const slot = heap[at]!;
    for (;;) {
      const l = 2 * at + 1;
      if (l >= size) break;
      const r = l + 1,
        c = r < size && before(heap[r]!, heap[l]!) ? r : l;
      if (!before(heap[c]!, slot)) break;
      place(at, heap[c]!);
      at = c;
    }
    place(at, slot);
  }
  function insert(slot: number) {
    place(size++, slot);
    up(size - 1);
  }
  function detach(slot: number) {
    const at = heapPos[slot]!,
      last = heap[--size]!;
    if (at === size) return;
    place(at, last);
    up(at);
    down(heapPos[last]!);
  }

  function checkId(id: number) {
    if (!tick(id)) throw new TypeError('cadence: id must be a nonnegative safe integer');
  }
  function checkPeriod(period: number) {
    if (!positive(period) || period > maxPeriod)
      throw new RangeError(`cadence: period must be a positive safe integer <= ${maxPeriod}`);
  }
  function checkResult(out: CadenceTakeResult) {
    if (!out || typeof out !== 'object' || Object.isFrozen(out))
      throw new TypeError('cadence: out must be a writable take result');
    for (const b of [out.ids, out.elapsed, out.late])
      if (!(b instanceof Float64Array) || b.length < maxDuePerTake)
        throw new TypeError('cadence: result buffers must be Float64Arrays of at least maxDuePerTake');
    if (
      out.ids.buffer === out.elapsed.buffer ||
      out.ids.buffer === out.late.buffer ||
      out.elapsed.buffer === out.late.buffer
    )
      throw new TypeError('cadence: result buffers must not share memory');
  }
  /** The first tick after `t` congruent to `phase` modulo `period`. */
  function gridAfter(t: number, period: number, phase: number): number {
    const base = t + 1,
      d = ((((phase % period) - (base % period)) % period) + period) % period;
    return base + d;
  }

  const owner: Cadence = {
    limits,
    add(id, period, phase) {
      checkId(id);
      checkPeriod(period);
      if (phase !== undefined && (!tick(phase) || phase >= period))
        throw new RangeError('cadence: phase must be a safe integer in 0..period-1');
      if (closed) return 'closed';
      if (slotOf.has(id)) return 'duplicate';
      const slot = free.pop();
      if (slot === undefined) return 'saturated';
      const key = phase ?? id;
      slotOf.set(id, slot);
      idOf[slot] = id;
      periodOf[slot] = period;
      phaseOf[slot] = key;
      lastOf[slot] = now;
      dueOf[slot] = gridAfter(now, period, key);
      insert(slot);
      return 'added';
    },
    remove(id) {
      checkId(id);
      if (closed) return 'closed';
      const slot = slotOf.get(id);
      if (slot === undefined) return 'absent';
      detach(slot);
      slotOf.delete(id);
      free.push(slot);
      return 'removed';
    },
    has(id) {
      checkId(id);
      return !closed && slotOf.has(id);
    },
    setPeriod(id, period) {
      checkId(id);
      checkPeriod(period);
      if (closed) return 'closed';
      const slot = slotOf.get(id);
      if (slot === undefined) return 'absent';
      if (periodOf[slot] === period) return 'set';
      periodOf[slot] = period;
      if (dueOf[slot]! <= now) return 'set'; // already due: stays due, served first
      // The first grid tick after the last serve; if that has passed, the next one after now (no catch-up burst).
      const next = gridAfter(lastOf[slot]!, period, phaseOf[slot]!);
      dueOf[slot] = next > now ? next : gridAfter(now, period, phaseOf[slot]!);
      up(heapPos[slot]!);
      down(heapPos[slot]!);
      return 'set';
    },
    take(t, out) {
      if (!now_(t)) throw new RangeError(`cadence: now must be a safe integer in 0..${MAX_CADENCE_TICK}`);
      checkResult(out);
      if (closed) {
        out.status = 'closed';
        out.count = 0;
        out.now = now;
        return out;
      }
      if (t < now) throw new RangeError(`cadence: now ${t} is before the previous tick ${now}`);
      now = t;
      let n = 0;
      while (n < maxDuePerTake && size > 0 && dueOf[heap[0]!]! <= t) {
        const slot = heap[0]!;
        out.ids[n] = idOf[slot]!;
        out.elapsed[n] = t - lastOf[slot]!;
        out.late[n] = t - dueOf[slot]!;
        n++;
        lastOf[slot] = t;
        dueOf[slot] = gridAfter(t, periodOf[slot]!, phaseOf[slot]!);
        down(0);
      }
      out.count = n;
      out.now = t;
      out.status = size > 0 && dueOf[heap[0]!]! <= t ? 'deferred' : 'complete';
      return out;
    },
    snapshot() {
      const members = [];
      for (const [id, slot] of slotOf)
        members.push(
          Object.freeze({id, period: periodOf[slot]!, due: dueOf[slot]!, last: lastOf[slot]!, phase: phaseOf[slot]!}),
        );
      members.sort((a, b) => a.id - b.id);
      return Object.freeze({now, members: Object.freeze(members)});
    },
    restore(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') throw new TypeError('cadence: malformed snapshot');
      const t = snapshot.now,
        members = snapshot.members;
      if (!now_(t) || !Array.isArray(members)) throw new TypeError('cadence: malformed snapshot');
      if (members.length > maxMembers) throw new RangeError('cadence: snapshot exceeds maxMembers');
      // Read every field exactly once into plain values, validate, then apply.
      const rows: [number, number, number, number, number][] = [];
      const seen = new Set<number>();
      for (const m of members) {
        if (!m || typeof m !== 'object') throw new TypeError('cadence: malformed snapshot member');
        const id = m.id,
          period = m.period,
          due = m.due,
          last = m.last,
          phase = m.phase;
        if (!tick(id) || seen.has(id))
          throw new TypeError('cadence: snapshot ids must be distinct nonnegative safe integers');
        seen.add(id);
        if (!positive(period) || period > maxPeriod) throw new RangeError('cadence: snapshot period out of range');
        if (!tick(phase)) throw new RangeError('cadence: snapshot phase must be a nonnegative safe integer');
        if (!tick(last) || last > t || !tick(due) || due <= last || due > t + period)
          throw new RangeError('cadence: snapshot must satisfy last <= now and last < due <= now + period');
        rows.push([id, period, due, last, phase]);
      }
      if (closed) return 'closed';
      slotOf.clear();
      free.length = 0;
      for (let i = maxMembers - 1; i >= 0; i--) free.push(i);
      size = 0;
      now = t;
      for (const [id, period, due, last, phase] of rows) {
        const slot = free.pop()!;
        slotOf.set(id, slot);
        idOf[slot] = id;
        periodOf[slot] = period;
        dueOf[slot] = due;
        lastOf[slot] = last;
        phaseOf[slot] = phase;
        insert(slot);
      }
      return 'restored';
    },
    dispose() {
      if (closed) return;
      closed = true;
      slotOf.clear();
      free.length = 0;
      size = 0;
    },
    get stats(): CadenceStats {
      return {members: slotOf.size, now, closed};
    },
  };
  return Object.freeze(owner);
}
