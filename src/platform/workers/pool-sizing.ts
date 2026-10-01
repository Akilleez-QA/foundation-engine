/**
 * Pool sizing and admission limits (STD-RUN-39, STD-RUN-40; ADR 0059 decision 5 as amended by ADR 0062
 * decision 5). Hardware concurrency is a ceiling, never proof of safe residency: the application profile
 * declares positive slot and byte limits and the smaller wins.
 */

export interface WorkerProfile {
  /** Declared running-slot limit; hardware concurrency only lowers it. */
  readonly maxSlots: number;
  /** Declared pending-request limit (queued, not running). */
  readonly maxPending: number;
  /** Declared limit on reserved input + output + scratch bytes across pending and running jobs. */
  readonly maxReservedBytes: number;
  /** Warm minimum; defaults to 4. Never exceeds the cap. */
  readonly warm?: number;
  /** Idle workers beyond the warm minimum are released after this long; defaults to 30 s. */
  readonly idleReleaseMs?: number;
}

/**
 * **Provisional** default profile. Numeric memory limits and cancellation deadlines stay Provisional until
 * browser saturation tests establish them (ADR 0062 decision 5).
 */
export const PROVISIONAL_WORKER_PROFILE: WorkerProfile = {
  maxSlots: 30,
  maxPending: 64,
  maxReservedBytes: 256 * 1024 * 1024,
  warm: 4,
  idleReleaseMs: 30_000,
};

export interface PoolSize {
  readonly cap: number;
  readonly warm: number;
  readonly idleReleaseMs: number;
  readonly maxPending: number;
  readonly maxReservedBytes: number;
}

const positive = (name: string, v: number) => {
  if (!Number.isFinite(v) || v <= 0) throw new RangeError(`worker profile ${name} must be positive, got ${v}`);
  return v;
};

/** `cap = min(profile.maxSlots, max(1, floor(hardwareConcurrency) − 2))`, 1 if unknown; `warm = min(4, cap)`. */
export function sizePool(hardwareConcurrency: number | undefined, profile: WorkerProfile): PoolSize {
  const declared = Math.floor(positive('maxSlots', profile.maxSlots));
  const hc = hardwareConcurrency !== undefined && Number.isFinite(hardwareConcurrency) && hardwareConcurrency > 0
    ? Math.max(1, Math.floor(hardwareConcurrency) - 2)
    : 1;
  const cap = Math.max(1, Math.min(declared, hc));
  const warm = Math.max(0, Math.min(Math.floor(profile.warm ?? 4), cap));
  return {
    cap,
    warm,
    idleReleaseMs: positive('idleReleaseMs', profile.idleReleaseMs ?? 30_000),
    maxPending: Math.floor(positive('maxPending', profile.maxPending)),
    maxReservedBytes: positive('maxReservedBytes', profile.maxReservedBytes),
  };
}
