/**
 * kits/spatial/interest.ts: bounded per-observer interest sets over a borrowed spatial grid.
 *
 * An observer (a connection, a team camera, a sensor) has a position. Each `update` answers "which entities are
 * relevant to it now", ranked deterministically (priority tier, then distance, then id), capped at `maxRelevant`,
 * with enter/leave changes since its previous update. Hysteresis: an entity enters inside `enterRadius` and stays
 * until it is beyond `exitRadius`, optionally held for `holdUpdates` further updates. Incomplete candidate scans
 * fail closed: no new entity is admitted and unseen members leave at once.
 *
 * The caller owns the grid (positions, insert/remove), the observers' meaning, what an id discloses, and when to
 * update. Nothing here calls back into the caller, schedules or sends. All tables and scratch are allocated at
 * construction; a steady-state `update` allocates nothing (only the limits/result records and `stats` do).
 */
import type { IdBuffer, QueryResult, SpatialGrid } from './grid';
import { createQueryResult } from './grid';

export interface InterestLimits {
  /** An entity becomes relevant within this distance (inclusive). Finite, >= 0. */
  readonly enterRadius: number;
  /** A relevant entity stays relevant until beyond this distance. Finite, >= enterRadius. */
  readonly exitRadius: number;
  /** Extra updates a member beyond `exitRadius` (but still in the grid) stays relevant. Safe integer 0..1,000,000. */
  readonly holdUpdates: number;
  /** Most observers. */
  readonly maxObservers: number;
  /** Send budget: most relevant ids per observer (keep <= the view protocol's maxEntities). */
  readonly maxRelevant: number;
  /** Most candidate ids one scan may return; a fuller scan is incomplete and fails closed. */
  readonly maxCandidates: number;
  /** Most ids with a non-default priority tier. */
  readonly maxPrioritized: number;
}

/** Hard ceilings of this implementation (eager typed-array allocation). */
export const INTEREST_CEILING = Object.freeze({ observerSlots: 1 << 22, maxCandidates: 1 << 20, maxPrioritized: 1 << 20, holdUpdates: 1_000_000 });

/**
 * - `complete`: every qualifying entity was considered and fits the budget.
 * - `over-budget`: more entities qualified than `maxRelevant`; `dropped` lowest-ranked ones are not relevant.
 * - `incomplete`: the candidate scan was truncated or refused; no new entity entered and unseen members left.
 * - `unavailable`: the borrowed grid is closed; every member left.
 * - `absent`: no such observer (the result buffers are untouched except counts, which are zero).
 * - `closed`: these interest sets were disposed.
 */
export type InterestStatus = 'complete' | 'over-budget' | 'incomplete' | 'unavailable' | 'absent' | 'closed';

/** A reusable result record; buffers are sized to `maxRelevant` by {@link createInterestResult}. */
export interface InterestResult {
  status: InterestStatus;
  /** The new relevant set, ranked: higher tier first, then nearer, then lower id. */
  readonly relevant: Float64Array;
  relevantCount: number;
  /** Ids that became relevant in this update, in rank order. */
  readonly entered: Float64Array;
  enteredCount: number;
  /** Ids that stopped being relevant, in their previous rank order. */
  readonly left: Float64Array;
  leftCount: number;
  /** Qualifying ids that did not fit the budget. */
  dropped: number;
  /** Candidate ids the grid scan returned. */
  candidates: number;
  /** The grid revision the scan observed (0 when no scan ran). */
  gridRevision: number;
}

export function createInterestResult(limits: Pick<InterestLimits, 'maxRelevant'>): InterestResult {
  const n = limits.maxRelevant;
  if (!Number.isSafeInteger(n) || n <= 0) throw new RangeError('interest result: maxRelevant must be a positive safe integer');
  return { status: 'complete', relevant: new Float64Array(n), relevantCount: 0, entered: new Float64Array(n), enteredCount: 0,
    left: new Float64Array(n), leftCount: 0, dropped: 0, candidates: 0, gridRevision: 0 };
}

export interface InterestStats {
  readonly observers: number;
  readonly prioritized: number;
  readonly closed: boolean;
}

export interface InterestSets {
  readonly limits: InterestLimits;
  /** Admit an observer. `self` (optional) is an entity id never reported to this observer, such as its own avatar. */
  addObserver(id: number, x: number, y: number, self?: number): 'added' | 'duplicate' | 'saturated' | 'closed';
  moveObserver(id: number, x: number, y: number): 'moved' | 'absent' | 'closed';
  /** Forget an observer and its set; the caller retires whatever it disclosed to it. */
  removeObserver(id: number): 'removed' | 'absent' | 'closed';
  /** A priority tier (safe integer; higher ranks first, default 0) for an entity id. */
  setPriority(id: number, tier: number): 'set' | 'saturated' | 'closed';
  clearPriority(id: number): 'cleared' | 'absent' | 'closed';
  /** Recompute one observer's set into `out` (see {@link createInterestResult}) and return it. */
  update(observer: number, out: InterestResult): InterestResult;
  /** Copy an observer's current ranked set into `out`; returns the count (0 when absent or closed). */
  members(observer: number, out: IdBuffer): number;
  /** Terminal and idempotent. The borrowed grid is not disposed. */
  dispose(): void;
  readonly stats: InterestStats;
}

const KEYS = ['enterRadius', 'exitRadius', 'holdUpdates', 'maxObservers', 'maxRelevant', 'maxCandidates', 'maxPrioritized'] as const;
const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
function checkId(id: number, what = 'id'): void {
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) throw new TypeError(`interest sets: ${what} must be a nonnegative safe integer`);
}
function checkPoint(x: number, y: number): void {
  if (!finite(x) || !finite(y)) throw new TypeError('interest sets: coordinates must be finite numbers');
}

/** Validate and copy limits, check the scan fits the grid's per-query cell bound, and allocate everything once. */
export function createInterestSets(grid: SpatialGrid, input: InterestLimits): InterestSets {
  if (!grid || typeof grid.queryCircle !== 'function' || typeof grid.distanceSquared !== 'function') throw new TypeError('interest sets: grid must be a spatial grid');
  if (input === null || typeof input !== 'object') throw new TypeError('interest sets: limits must be an object');
  const extra = Object.keys(input).filter(k => !(KEYS as readonly string[]).includes(k));
  if (extra.length) throw new TypeError(`interest sets: unknown limit '${extra[0]}'`);
  const limits: InterestLimits = Object.freeze(Object.fromEntries(KEYS.map(k => [k, input[k]])) as unknown as InterestLimits);
  const { enterRadius, exitRadius, holdUpdates, maxObservers, maxRelevant, maxCandidates, maxPrioritized } = limits;
  if (!finite(enterRadius) || enterRadius < 0) throw new RangeError('interest sets: enterRadius must be finite and >= 0');
  if (!finite(exitRadius) || exitRadius < enterRadius || !Number.isFinite(exitRadius * exitRadius)) throw new RangeError('interest sets: exitRadius must be finite, >= enterRadius, with a finite square');
  if (typeof holdUpdates !== 'number' || !Number.isSafeInteger(holdUpdates) || holdUpdates < 0 || holdUpdates > INTEREST_CEILING.holdUpdates) {
    throw new RangeError(`interest sets: holdUpdates must be a safe integer 0..${INTEREST_CEILING.holdUpdates}`);
  }
  if (!count(maxObservers) || !count(maxRelevant) || maxObservers * maxRelevant > INTEREST_CEILING.observerSlots) {
    throw new RangeError(`interest sets: maxObservers and maxRelevant must be positive with a product <= ${INTEREST_CEILING.observerSlots}`);
  }
  if (!count(maxCandidates) || maxCandidates > INTEREST_CEILING.maxCandidates) throw new RangeError(`interest sets: maxCandidates must be a positive safe integer <= ${INTEREST_CEILING.maxCandidates}`);
  if (!count(maxPrioritized) || maxPrioritized > INTEREST_CEILING.maxPrioritized) throw new RangeError(`interest sets: maxPrioritized must be a positive safe integer <= ${INTEREST_CEILING.maxPrioritized}`);
  // Worst-case cells a radius-exitRadius circle can touch at any alignment; refusing here means scans never return too-wide.
  const span = Math.floor((2 * exitRadius) / grid.limits.cellSize) + 2;
  if (span * span > grid.limits.maxCellsPerQuery) {
    throw new RangeError(`interest sets: exitRadius ${exitRadius} can touch ${span * span} cells, above the grid's maxCellsPerQuery ${grid.limits.maxCellsPerQuery}`);
  }
  const enter2 = enterRadius * enterRadius;

  // Observer slots.
  const slotOf = new Map<number, number>();
  const freeSlots: number[] = [];
  for (let i = maxObservers - 1; i >= 0; i--) freeSlots.push(i);
  const ox = new Float64Array(maxObservers), oy = new Float64Array(maxObservers), self = new Float64Array(maxObservers).fill(-1);
  const memberCount = new Int32Array(maxObservers);
  const members = new Float64Array(maxObservers * maxRelevant), missed = new Int32Array(maxObservers * maxRelevant);
  const priority = new Map<number, number>();
  // Per-update scratch, shared by every observer (updates are synchronous and never nest).
  const cand = new Float64Array(maxCandidates), scan: QueryResult = createQueryResult();
  const seen = new Uint8Array(maxRelevant), kept = new Uint8Array(maxRelevant);
  const pickId = new Float64Array(maxRelevant), pickTier = new Float64Array(maxRelevant), pickD = new Float64Array(maxRelevant);
  const pickMissed = new Int32Array(maxRelevant);
  let picked = 0, qualifying = 0, closed = false;

  /** Bounded top-k insertion ordered by tier desc, distance asc, id asc. */
  /** True when pick `i` ranks below the candidate (tier, d2, id). */
  function worse(i: number, tier: number, d2: number, id: number): boolean {
    return pickTier[i]! < tier || (pickTier[i] === tier && (pickD[i]! > d2 || (pickD[i] === d2 && pickId[i]! > id)));
  }
  function consider(id: number, d2: number, miss: number): void {
    qualifying++;
    const tier = priority.get(id) ?? 0;
    if (picked === maxRelevant && !worse(maxRelevant - 1, tier, d2, id)) return;
    let i = picked < maxRelevant ? picked++ : maxRelevant - 1;
    while (i > 0 && worse(i - 1, tier, d2, id)) {
      pickId[i] = pickId[i - 1]!; pickTier[i] = pickTier[i - 1]!; pickD[i] = pickD[i - 1]!; pickMissed[i] = pickMissed[i - 1]!; i--;
    }
    pickId[i] = id; pickTier[i] = tier; pickD[i] = d2; pickMissed[i] = miss;
  }

  /** Previous-member index by linear scan over at most maxRelevant slots (no map churn, no allocation); -1 if absent. */
  function oldAt(base: number, n: number, id: number): number {
    for (let i = 0; i < n; i++) if (members[base + i] === id) return i;
    return -1;
  }
  function checkResult(out: InterestResult): void {
    if (!out || typeof out !== 'object' || Object.isFrozen(out)) throw new TypeError('interest sets: out must be a writable interest result');
    for (const b of [out.relevant, out.entered, out.left]) {
      if (!(b instanceof Float64Array) || b.length < maxRelevant) throw new TypeError('interest sets: result buffers must be Float64Arrays of at least maxRelevant');
    }
  }
  function empty(out: InterestResult, status: InterestStatus): InterestResult {
    out.status = status; out.relevantCount = 0; out.enteredCount = 0; out.leftCount = 0; out.dropped = 0; out.candidates = 0; out.gridRevision = 0;
    return out;
  }

  const sets: InterestSets = {
    limits,
    addObserver(id, x, y, own) {
      checkId(id, 'observer'); checkPoint(x, y); if (own !== undefined) checkId(own, 'self');
      if (closed) return 'closed';
      if (slotOf.has(id)) return 'duplicate';
      const slot = freeSlots.pop();
      if (slot === undefined) return 'saturated';
      slotOf.set(id, slot); ox[slot] = x; oy[slot] = y; self[slot] = own ?? -1; memberCount[slot] = 0;
      return 'added';
    },
    moveObserver(id, x, y) {
      checkId(id, 'observer'); checkPoint(x, y);
      if (closed) return 'closed';
      const slot = slotOf.get(id);
      if (slot === undefined) return 'absent';
      ox[slot] = x; oy[slot] = y;
      return 'moved';
    },
    removeObserver(id) {
      checkId(id, 'observer');
      if (closed) return 'closed';
      const slot = slotOf.get(id);
      if (slot === undefined) return 'absent';
      slotOf.delete(id); memberCount[slot] = 0; freeSlots.push(slot);
      return 'removed';
    },
    setPriority(id, tier) {
      checkId(id);
      if (typeof tier !== 'number' || !Number.isSafeInteger(tier)) throw new TypeError('interest sets: tier must be a safe integer');
      if (closed) return 'closed';
      if (tier === 0) { priority.delete(id); return 'set'; }
      if (!priority.has(id) && priority.size >= maxPrioritized) return 'saturated';
      priority.set(id, tier);
      return 'set';
    },
    clearPriority(id) {
      checkId(id);
      if (closed) return 'closed';
      return priority.delete(id) ? 'cleared' : 'absent';
    },
    update(observer, out) {
      checkId(observer, 'observer'); checkResult(out);
      if (closed) return empty(out, 'closed');
      const slot = slotOf.get(observer);
      if (slot === undefined) return empty(out, 'absent');
      const base = slot * maxRelevant, oldCount = memberCount[slot]!, x = ox[slot]!, y = oy[slot]!, own = self[slot]!;
      for (let i = 0; i < oldCount; i++) { seen[i] = 0; kept[i] = 0; }
      picked = 0; qualifying = 0;
      grid.queryCircle(x, y, exitRadius, cand, scan);
      let status: InterestStatus = 'complete';
      if (scan.status === 'closed') status = 'unavailable';
      else if (scan.status !== 'complete') status = 'incomplete';
      const incomplete = status !== 'complete';
      if (status !== 'unavailable') {
        for (let c = 0; c < scan.count; c++) {
          const id = cand[c]!;
          if (id === own) continue;
          const old = oldAt(base, oldCount, id);
          const d2 = grid.distanceSquared(id, x, y);
          if (old < 0 && (incomplete || d2 > enter2)) continue;  // fail closed: no new entries from a partial scan
          if (old >= 0) seen[old] = 1;
          consider(id, d2, 0);
        }
        // Members not seen: beyond exitRadius (complete scan) may be held while still indexed; otherwise they leave.
        if (!incomplete && holdUpdates > 0) {
          for (let i = 0; i < oldCount; i++) {
            if (seen[i]) continue;
            const id = members[base + i]!, d2 = grid.distanceSquared(id, x, y), miss = missed[base + i]! + 1;
            if (Number.isNaN(d2) || miss > holdUpdates) continue;
            consider(id, d2, miss);
          }
        }
      }
      let entered = 0, left = 0;
      for (let i = 0; i < picked; i++) {
        const id = pickId[i]!, old = oldAt(base, oldCount, id);
        out.relevant[i] = id;
        if (old < 0) out.entered[entered++] = id; else kept[old] = 1;
      }
      for (let i = 0; i < oldCount; i++) if (!kept[i]) out.left[left++] = members[base + i]!;
      for (let i = 0; i < picked; i++) { members[base + i] = pickId[i]!; missed[base + i] = pickMissed[i]!; }
      memberCount[slot] = picked;
      const dropped = qualifying - picked;
      if (status === 'complete' && dropped > 0) status = 'over-budget';
      out.status = status; out.relevantCount = picked; out.enteredCount = entered; out.leftCount = left;
      out.dropped = dropped; out.candidates = status === 'unavailable' ? 0 : scan.count; out.gridRevision = status === 'unavailable' ? 0 : scan.revision;
      return out;
    },
    members(observer, out) {
      checkId(observer, 'observer');
      if (!(out instanceof Float64Array) && !Array.isArray(out)) throw new TypeError('interest sets: out must be a Float64Array or number[]');
      const slot = closed ? undefined : slotOf.get(observer);
      if (slot === undefined) return 0;
      const n = Math.min(memberCount[slot]!, out.length);
      for (let i = 0; i < n; i++) out[i] = members[slot * maxRelevant + i]!;
      return n;
    },
    dispose() {
      if (closed) return;
      closed = true; slotOf.clear(); priority.clear(); freeSlots.length = 0;
    },
    get stats(): InterestStats { return { observers: slotOf.size, prioritized: priority.size, closed }; },
  };
  return Object.freeze(sets);
}
