/**
 * Optional, caller-owned rate (token bucket) and concurrency admission for one process.
 * Constructs no timer, clock, socket or global service. Time is supplied by the caller on every call.
 */

/** Opaque object identity (e.g. an intake connection handle) or a bounded nonempty string. */
export type RateKey = object | string;

export interface RateAdmissionLimits {
  /** Tracked identities. A new key beyond this bound is refused unless an idle key can be reclaimed losslessly. */
  maxKeys: number;
  /** Bucket size: the largest burst admitted at once (tokens). Positive safe integer. */
  capacity: number;
  /** Sustained refill rate in tokens per second. Positive finite number, at most 1e9. */
  refillPerSecond: number;
  /** Optional per-key concurrency bound. Omitted means admission returns no lease. */
  maxInFlight?: number;
  /** Maximum UTF-16 length of a string key (default 256). */
  maxKeyLength?: number;
}

export interface RateLease {
  /** Returns the slot. True only for the first release of a lease whose key state is still current. */
  release(): boolean;
}

export type RateAdmissionResult =
  | { readonly status: 'admitted'; readonly lease: RateLease | null; readonly remaining: number }
  | { readonly status: 'limited'; readonly reason: 'rate'; readonly retryAfterMs: number }
  | { readonly status: 'limited'; readonly reason: 'concurrency'; readonly retryAfterMs: null }
  | { readonly status: 'refused'; readonly reason: RateRefusalReason };

export type RateRefusalReason = 'key-capacity' | 'invalid-key' | 'invalid-time' | 'invalid-cost' | 'disposed';

export interface RateKeyState { readonly tokens: number; readonly inFlight: number }

export interface RateAdmissionStats {
  readonly keys: number; readonly inFlight: number; readonly admitted: number;
  readonly limitedRate: number; readonly limitedConcurrency: number; readonly refusedKeyCapacity: number;
  readonly reclaimed: number; readonly clockRegressions: number; readonly disposed: boolean;
}

export interface RateAdmission {
  /** O(1). Never throws for overload; refusals are explicit results. A limited call consumes nothing. */
  admit(key: RateKey, now: number, cost?: number): RateAdmissionResult;
  /** Removes a key's state (e.g. on connection retirement). Outstanding leases become stale. */
  forget(key: RateKey): boolean;
  /** Detached view at `now` (or the latest observed time); null for unknown keys or invalid input. */
  read(key: RateKey, now?: number): RateKeyState | null;
  stats(): RateAdmissionStats;
  /** Idempotent. Clears all keys; later admission is refused and outstanding leases become stale. */
  dispose(): void;
}

type Bucket = { tat: number; inFlight: number };
/** Boundary tolerance in milliseconds; absorbs floating-point error in repeated interval addition. */
const EPSILON_MS = 1e-6;
const refusal = (reason: RateRefusalReason): RateAdmissionResult => Object.freeze({ status: 'refused', reason });
const REFUSED = {
  'key-capacity': refusal('key-capacity'), 'invalid-key': refusal('invalid-key'),
  'invalid-time': refusal('invalid-time'), 'invalid-cost': refusal('invalid-cost'), disposed: refusal('disposed'),
} as const;
const CONCURRENCY: RateAdmissionResult = Object.freeze({ status: 'limited', reason: 'concurrency', retryAfterMs: null });
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

/**
 * Generic cell-rate form of a token bucket: each key stores a theoretical arrival time (`tat`).
 * Admitting `cost` tokens advances `tat` by `cost * interval`; admission requires `tat - now <= capacity * interval`.
 * This is equivalent to a bucket of `capacity` tokens refilled at `refillPerSecond`, with no per-call refill drift.
 */
export function createRateAdmission(input: RateAdmissionLimits): RateAdmission {
  const limits = Object.freeze({
    maxKeys: input.maxKeys, capacity: input.capacity, refillPerSecond: input.refillPerSecond,
    maxInFlight: input.maxInFlight, maxKeyLength: input.maxKeyLength ?? 256,
  });
  if (!positive(limits.maxKeys) || !positive(limits.capacity) || !positive(limits.maxKeyLength))
    throw Error('rate-admission: invalid limits');
  if (typeof limits.refillPerSecond !== 'number' || !Number.isFinite(limits.refillPerSecond)
    || limits.refillPerSecond <= 0 || limits.refillPerSecond > 1e9)
    throw Error('rate-admission: invalid refill rate');
  if (limits.maxInFlight !== undefined && !positive(limits.maxInFlight))
    throw Error('rate-admission: invalid concurrency limit');
  const interval = 1000 / limits.refillPerSecond, span = limits.capacity * interval;
  // Insertion order doubles as least-recently-admitted order: every admit re-inserts its key.
  const buckets = new Map<RateKey, Bucket>();
  let latest = 0, disposed = false, inFlight = 0;
  let admitted = 0, limitedRate = 0, limitedConcurrency = 0, refusedKeyCapacity = 0, reclaimed = 0, clockRegressions = 0;

  const validKey = (key: unknown): key is RateKey =>
    (typeof key === 'object' && key !== null) || typeof key === 'function'
    || (typeof key === 'string' && key.length > 0 && key.length <= limits.maxKeyLength);
  const validTime = (now: unknown): now is number => typeof now === 'number' && Number.isFinite(now) && now >= 0;
  const tokensAt = (bucket: Bucket, t: number): number =>
    Math.min(limits.capacity, Math.max(0, Math.floor((span - Math.max(0, bucket.tat - t)) / interval + EPSILON_MS / interval)));

  /** Reclaims the least-recently-admitted key only when its bucket is full and it holds no lease (lossless). */
  function reclaim(t: number): boolean {
    const oldest = buckets.keys().next();
    if (oldest.done) return false;
    const bucket = buckets.get(oldest.value)!;
    if (bucket.inFlight !== 0 || bucket.tat > t + EPSILON_MS) return false;
    buckets.delete(oldest.value);
    reclaimed++;
    return true;
  }

  function lease(key: RateKey, bucket: Bucket): RateLease {
    let released = false;
    return Object.freeze({
      release(): boolean {
        if (released) return false;
        released = true;
        if (disposed || buckets.get(key) !== bucket || bucket.inFlight === 0) return false;
        bucket.inFlight--;
        inFlight--;
        return true;
      },
    });
  }

  return Object.freeze({
    admit(key: RateKey, now: number, cost: number = 1): RateAdmissionResult {
      if (disposed) return REFUSED.disposed;
      if (!validTime(now)) return REFUSED['invalid-time'];
      if (!positive(cost) || cost > limits.capacity) return REFUSED['invalid-cost'];
      if (!validKey(key)) return REFUSED['invalid-key'];
      // A backwards reading grants no refill: time is the high-water mark of all observed readings.
      if (now < latest) clockRegressions++;
      else latest = now;
      const t = latest;
      let bucket = buckets.get(key);
      if (bucket === undefined) {
        if (buckets.size >= limits.maxKeys && !reclaim(t)) { refusedKeyCapacity++; return REFUSED['key-capacity']; }
        bucket = { tat: t, inFlight: 0 };
      } else buckets.delete(key);
      buckets.set(key, bucket);
      if (limits.maxInFlight !== undefined && bucket.inFlight >= limits.maxInFlight) {
        limitedConcurrency++;
        return CONCURRENCY;
      }
      // A backlog within the boundary tolerance counts as empty, so rounding cannot accumulate across admissions.
      const next = (bucket.tat > t + EPSILON_MS ? bucket.tat : t) + cost * interval;
      const excess = next - t - span;
      if (excess > EPSILON_MS) {
        limitedRate++;
        return Object.freeze({ status: 'limited', reason: 'rate', retryAfterMs: Math.ceil(excess) });
      }
      bucket.tat = next;
      admitted++;
      let issued: RateLease | null = null;
      if (limits.maxInFlight !== undefined) {
        bucket.inFlight++;
        inFlight++;
        issued = lease(key, bucket);
      }
      return Object.freeze({ status: 'admitted', lease: issued, remaining: tokensAt(bucket, t) });
    },
    forget(key: RateKey): boolean {
      const bucket = buckets.get(key);
      if (bucket === undefined) return false;
      inFlight -= bucket.inFlight;
      buckets.delete(key);
      return true;
    },
    read(key: RateKey, now?: number): RateKeyState | null {
      if (now !== undefined && !validTime(now)) return null;
      const bucket = buckets.get(key);
      if (bucket === undefined) return null;
      return Object.freeze({ tokens: tokensAt(bucket, Math.max(now ?? latest, latest)), inFlight: bucket.inFlight });
    },
    stats(): RateAdmissionStats {
      return Object.freeze({ keys: buckets.size, inFlight, admitted, limitedRate, limitedConcurrency,
        refusedKeyCapacity, reclaimed, clockRegressions, disposed });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      buckets.clear();
      inFlight = 0;
    },
  });
}
