/**
 * Update tiers: which tracked entities a fixed step should simulate, and with how much time.
 *
 * `always` entities get every step. `near` entities run only while an observer is near (enter radius, with an exit
 * radius for hysteresis) and are frozen otherwise. `background` entities run every step while near; while far they
 * are split across round-robin slots and each runs once per cycle with the time it accumulated (capped), so long
 * running simulation stays time-consistent at a fraction of the cost. Pure: the caller's systems ask `due(id)`.
 */
export type UpdatePolicy = 'always' | 'near' | 'background';
export interface UpdateTierLimits {
  readonly nearRadius: number;
  /** Default 1.25 × near. */
  readonly farRadius?: number;
  /** Round-robin slots for far background entities (default 4, 1-64). */
  readonly slots?: number;
  /** Default 4,096, at most 65,536. */
  readonly maxTracked?: number;
  /** Most seconds delivered to one entity in one step after a far stretch (default 1, at most 60). */
  readonly maxCatchUp?: number;
}
export interface TierStats {
  readonly steps: number;
  readonly tracked: number;
  /** Entities simulated this step (near, always, or their background slot came up). */
  readonly active: number;
  readonly frozen: number;
  /** Seconds discarded by the catch-up cap since creation. */
  readonly droppedSeconds: number;
}

function fail(message: string): never {
  throw new RangeError(`update tiers: ${message}`);
}

export function createUpdateTiers(limits: UpdateTierLimits) {
  const near = limits.nearRadius,
    far = limits.farRadius ?? near * 1.25,
    slots = limits.slots ?? 4,
    maxTracked = limits.maxTracked ?? 4096,
    maxCatchUp = limits.maxCatchUp ?? 1;
  if (!(typeof near === 'number' && Number.isFinite(near) && near > 0 && near <= 1e6))
    fail('nearRadius must be within (0, 1e6]');
  if (!(typeof far === 'number' && Number.isFinite(far) && far >= near && far <= 1e6))
    fail('farRadius must be within [nearRadius, 1e6]');
  if (!Number.isSafeInteger(slots) || slots < 1 || slots > 64) fail('slots must be an integer in [1, 64]');
  if (!Number.isSafeInteger(maxTracked) || maxTracked < 1 || maxTracked > 65536)
    fail('maxTracked must be an integer in [1, 65536]');
  if (!(typeof maxCatchUp === 'number' && Number.isFinite(maxCatchUp) && maxCatchUp > 0 && maxCatchUp <= 60))
    fail('maxCatchUp must be within (0, 60]');
  interface Entry {
    policy: UpdatePolicy;
    slot: number;
    near: boolean;
    owed: number;
    due: number;
  }
  const entries = new Map<number, Entry>(),
    population = new Array<number>(slots).fill(0);
  let steps = 0,
    stepDt = 0,
    active = 0,
    frozen = 0,
    dropped = 0;
  const checkId = (id: number) => {
    if (!Number.isSafeInteger(id) || id < 0) fail('ids must be nonnegative safe integers');
  };
  return {
    /** Start tracking an entity (for example on spawn). Background entities join the least-populated slot. */
    track(id: number, policy: UpdatePolicy): 'tracked' | 'duplicate' | 'full' {
      checkId(id);
      if (policy !== 'always' && policy !== 'near' && policy !== 'background') fail('unknown policy');
      if (entries.has(id)) return 'duplicate';
      if (entries.size >= maxTracked) return 'full';
      let slot = 0;
      for (let s = 1; s < slots; s++) if (population[s]! < population[slot]!) slot = s;
      if (policy === 'background') population[slot]!++;
      // A newly tracked entity counts as near until the next step decides, so it is never frozen before it is seen.
      entries.set(id, {policy, slot, near: true, owed: 0, due: 0});
      return 'tracked';
    },
    untrack(id: number): boolean {
      checkId(id);
      const e = entries.get(id);
      if (!e) return false;
      if (e.policy === 'background') population[e.slot]!--;
      entries.delete(id);
      return true;
    },
    /**
     * Decide this fixed step. `position(id)` returns the entity's plane position or null (treated as far). Call once
     * per step before the systems that consult `due`.
     */
    step(
      dt: number,
      position: (id: number) => {readonly x: number; readonly z: number} | null,
      observersIn: readonly {readonly x: number; readonly z: number}[],
    ): TierStats {
      if (!(typeof dt === 'number' && Number.isFinite(dt) && dt >= 0 && dt <= 60)) fail('dt must be within [0, 60]');
      if (!Array.isArray(observersIn) || observersIn.length > 8) fail('at most 8 observers');
      const observers = observersIn.map(o => {
        const x = o?.x,
          z = o?.z;
        if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z))
          fail('observer coordinates must be finite');
        return {x, z};
      });
      const slot = steps % slots;
      steps++;
      stepDt = dt;
      active = 0;
      frozen = 0;
      const deliver = (e: Entry, seconds: number) => {
        if (seconds > maxCatchUp) {
          dropped += seconds - maxCatchUp;
          seconds = maxCatchUp;
        }
        e.due = seconds;
        e.owed = 0;
        active++;
      };
      for (const [id, e] of entries) {
        if (e.policy === 'always') {
          e.due = dt;
          active++;
          continue;
        }
        const p = position(id);
        if (p !== null && (typeof p !== 'object' || !Number.isFinite(p.x) || !Number.isFinite(p.z)))
          fail('positions must be finite or null');
        const r = e.near ? far : near;
        e.near = p !== null && observers.some(o => (o.x - p.x) ** 2 + (o.z - p.z) ** 2 <= r * r);
        if (e.near) deliver(e, e.owed + dt);
        else if (e.policy === 'near') {
          e.due = 0;
          e.owed = 0;
          frozen++;
        } else {
          e.owed += dt;
          if (e.slot === slot) deliver(e, e.owed);
          else {
            e.due = 0;
            frozen++;
          }
        }
      }
      return Object.freeze({steps, tracked: entries.size, active, frozen, droppedSeconds: dropped});
    },
    /** Seconds to simulate `id` this step: 0 means skip it. An untracked id gets the full step. */
    due(id: number): number {
      checkId(id);
      const e = entries.get(id);
      return e ? e.due : stepDt;
    },
    policy(id: number): UpdatePolicy | null {
      return entries.get(id)?.policy ?? null;
    },
    stats(): TierStats {
      return Object.freeze({steps, tracked: entries.size, active, frozen, droppedSeconds: dropped});
    },
  };
}
export type UpdateTiers = ReturnType<typeof createUpdateTiers>;
