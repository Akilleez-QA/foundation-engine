/**
 * Optional, caller-owned rate (token bucket) and concurrency admission for one process.
 * Constructs no timer, clock, socket or global service. Time is supplied by the caller on every call.
 */

/** Opaque object identity (e.g. an intake connection handle) or a bounded nonempty string. */
export type RateKey = object | string;

export interface RateAdmissionLimits {
  /** Tracked identities. A new key beyond this bound is refused unless an idle key can be reclaimed losslessly. */
  maxKeys: number;
  /** Bucket size: the largest burst admitted at once (tokens). Positive safe integer, at most 1e9. */
  capacity: number;
  /** Sustained refill rate in tokens per second. Positive finite number, at most 1e6. */
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
  /** Detached view at `now` (never earlier than the latest observed time); null for unknown keys or invalid input. */
  read(key: RateKey, now?: number): RateKeyState | null;
  stats(): RateAdmissionStats;
  /** Idempotent. Clears all keys; later admission is refused and outstanding leases become stale. */
  dispose(): void;
}

/** `backlog`: milliseconds of refill owed at time `at` (0 = full bucket, `span` = empty). Kept small so arithmetic stays exact. */
type Bucket = { backlog: number; at: number; inFlight: number };
/** Boundary tolerance as a fraction of one token's refill interval (never an absolute time). */
const TOLERANCE = 1e-6;
/** Upper bounds that keep `interval` and `span` far from floating-point resolution limits. */
const MAX_REFILL_PER_SECOND = 1e6, MAX_CAPACITY = 1e9;
const refusal = (reason: RateRefusalReason): RateAdmissionResult => Object.freeze({ status: 'refused', reason });
const REFUSED = {
  'key-capacity': refusal('key-capacity'), 'invalid-key': refusal('invalid-key'),
  'invalid-time': refusal('invalid-time'), 'invalid-cost': refusal('invalid-cost'), disposed: refusal('disposed'),
} as const;
const CONCURRENCY: RateAdmissionResult = Object.freeze({ status: 'limited', reason: 'concurrency', retryAfterMs: null });
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

/**
 * Token bucket in backlog form: each key stores the refill time it still owes (`backlog`, ms) as of `at`.
 * Elapsed time repays backlog (never below zero); admitting `cost` adds `cost * interval`, and admission requires
 * the result to stay within `capacity * interval`. Only relative quantities are compared, so precision does not
 * degrade with the magnitude of caller timestamps.
 */
export function createRateAdmission(input: RateAdmissionLimits): RateAdmission {
  const limits = Object.freeze({
    maxKeys: input.maxKeys, capacity: input.capacity, refillPerSecond: input.refillPerSecond,
    maxInFlight: input.maxInFlight, maxKeyLength: input.maxKeyLength ?? 256,
  });
  if (!positive(limits.maxKeys) || !positive(limits.capacity) || limits.capacity > MAX_CAPACITY || !positive(limits.maxKeyLength))
    throw Error('rate-admission: invalid limits');
  if (typeof limits.refillPerSecond !== 'number' || !Number.isFinite(limits.refillPerSecond)
    || limits.refillPerSecond <= 0 || limits.refillPerSecond > MAX_REFILL_PER_SECOND)
    throw Error('rate-admission: invalid refill rate');
  if (limits.maxInFlight !== undefined && !positive(limits.maxInFlight))
    throw Error('rate-admission: invalid concurrency limit');
  const interval = 1000 / limits.refillPerSecond, span = limits.capacity * interval, tolerance = interval * TOLERANCE;
  // Insertion order doubles as least-recently-attempted order: every admit call for a valid key re-inserts it.
  const buckets = new Map<RateKey, Bucket>();
  let latest = 0, disposed = false, inFlight = 0;
  let admitted = 0, limitedRate = 0, limitedConcurrency = 0, refusedKeyCapacity = 0, reclaimed = 0, clockRegressions = 0;

  const validKey = (key: unknown): key is RateKey =>
    (typeof key === 'object' && key !== null) || typeof key === 'function'
    || (typeof key === 'string' && key.length > 0 && key.length <= limits.maxKeyLength);
  // Integral-precision range: beyond 2^53 ms adjacent readings collapse and elapsed time cannot be measured.
  const validTime = (now: unknown): now is number =>
    typeof now === 'number' && Number.isFinite(now) && now >= 0 && now <= Number.MAX_SAFE_INTEGER;
  /** Backlog owed at time `t` (t >= bucket.at). `t - at` is exact for nearby doubles of equal magnitude. */
  const owed = (bucket: Bucket, t: number): number => Math.max(0, bucket.backlog - (t - bucket.at));
  const tokensAt = (backlog: number): number =>
    Math.min(limits.capacity, Math.max(0, Math.floor((span - backlog) / interval + TOLERANCE)));

  /** Reclaims the least-recently-attempted key only when its bucket is full and it holds no lease (lossless). */
  function reclaim(t: number): boolean {
    const oldest = buckets.keys().next();
    if (oldest.done) return false;
    const bucket = buckets.get(oldest.value)!;
    if (bucket.inFlight !== 0 || owed(bucket, t) > tolerance) return false;
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
      // A forward jump repays at most the whole backlog, i.e. grants at most one full bucket.
      if (now < latest) clockRegressions++;
      else latest = now;
      const t = latest;
      let bucket = buckets.get(key);
      if (bucket === undefined) {
        if (buckets.size >= limits.maxKeys && !reclaim(t)) { refusedKeyCapacity++; return REFUSED['key-capacity']; }
        bucket = { backlog: 0, at: t, inFlight: 0 };
      } else buckets.delete(key);
      buckets.set(key, bucket);
      if (limits.maxInFlight !== undefined && bucket.inFlight >= limits.maxInFlight) {
        limitedConcurrency++;
        return CONCURRENCY;
      }
      const backlog = owed(bucket, t);
      bucket.backlog = backlog;
      bucket.at = t;
      const next = backlog + cost * interval;
      const excess = next - span;
      if (excess > tolerance) {
        limitedRate++;
        return Object.freeze({ status: 'limited', reason: 'rate', retryAfterMs: Math.max(1, Math.ceil(excess)) });
      }
      bucket.backlog = next;
      admitted++;
      let issued: RateLease | null = null;
      if (limits.maxInFlight !== undefined) {
        bucket.inFlight++;
        inFlight++;
        issued = lease(key, bucket);
      }
      return Object.freeze({ status: 'admitted', lease: issued, remaining: tokensAt(next) });
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
      return Object.freeze({ tokens: tokensAt(owed(bucket, Math.max(now ?? latest, latest))), inFlight: bucket.inFlight });
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
