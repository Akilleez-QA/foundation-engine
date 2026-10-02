/**
 * Optional reconnect/retry pacing: capped exponential backoff with full jitter and a token-bucket retry budget.
 * Pure state machine. It owns no timer, socket, credential, clock or random source; the caller supplies monotonic
 * time and a random port, and decides what one "attempt" means. See docs/guides/network-retry.md.
 */

export interface RetryScheduleLimits {
  /** First backoff ceiling in milliseconds (attempt 1 waits uniformly in [0, baseMs]). */
  readonly baseMs: number;
  /** Largest backoff ceiling in milliseconds; at least `baseMs`. */
  readonly capMs: number;
  /** Retries per episode. An episode ends with `succeeded` or `cancel`. */
  readonly maxAttempts: number;
  /** Retry budget shared by every episode of this owner: one token per retry, one token regained per `refillEveryMs`. */
  readonly budget: { readonly capacity: number; readonly refillEveryMs: number };
}

export interface RetryScheduleOptions {
  readonly limits: RetryScheduleLimits;
  /** Uniform in [0, 1). Inject a seeded per-owner stream; do not share a gameplay stream. */
  readonly random: () => number;
}

export type RetryScheduleNext =
  | Readonly<{ status: 'wait'; attempt: number; delayMs: number; untilMs: number }>
  | Readonly<{ status: 'exhausted'; attempts: number }>
  | Readonly<{ status: 'budget-empty'; refillAtMs: number }>
  | Readonly<{ status: 'busy' }>
  | Readonly<{ status: 'retired'; reason: string }>;

export interface RetryScheduleState {
  readonly state: 'idle' | 'waiting' | 'attempting' | 'exhausted' | 'retired';
  /** Retries scheduled in the current episode. */
  readonly attempt: number;
  /** Budget tokens as of the last time-bearing call (read() does not advance time). */
  readonly tokens: number;
  readonly untilMs: number | null;
  readonly reason: string | null;
  readonly limits: RetryScheduleLimits;
}

export interface RetrySchedule {
  /** Report one failure and ask when to try again. A failure reported while already waiting returns that wait unchanged. */
  next(now: number): RetryScheduleNext;
  /** True exactly once when the outstanding wait has elapsed; the caller then makes one fresh attempt. */
  due(now: number): boolean;
  /** The attempt succeeded: end the episode and reset the attempt count. Tokens are not refunded. */
  succeeded(now: number): void;
  /** Abandon the current episode (for example an explicit user disconnect). Tokens are not refunded. */
  cancel(): void;
  read(): RetryScheduleState;
  /** Terminal and idempotent: later `next` returns `retired`, `due` returns false. */
  dispose(): void;
}

const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const exactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function captureLimits(supplied: unknown): RetryScheduleLimits {
  if (!exactKeys(supplied, ['baseMs', 'capMs', 'maxAttempts', 'budget']) ||
    !exactKeys(supplied.budget, ['capacity', 'refillEveryMs']))
    throw Error('retry schedule: invalid limits');
  const { baseMs, capMs, maxAttempts } = supplied;
  const { capacity, refillEveryMs } = supplied.budget;
  if (![baseMs, capMs, maxAttempts, capacity, refillEveryMs].every(positive) || (baseMs as number) > (capMs as number))
    throw Error('retry schedule: invalid limits');
  return Object.freeze({ baseMs, capMs, maxAttempts, budget: Object.freeze({ capacity, refillEveryMs }) }) as RetryScheduleLimits;
}

/** Construct one schedule per owner (scene visit, connection owner). Construction does no work and reads no clock. */
export function createRetrySchedule(options: RetryScheduleOptions): RetrySchedule {
  if (options === null || typeof options !== 'object') throw Error('retry schedule: invalid configuration');
  const limits = captureLimits(options.limits);
  const random = options.random;
  if (typeof random !== 'function') throw Error('retry schedule: invalid configuration');
  const { baseMs, capMs, maxAttempts, budget: { capacity, refillEveryMs } } = limits;

  let state: RetryScheduleState['state'] = 'idle', reason: string | null = null;
  let attempt = 0, tokens = capacity, refillAt: number | null = null, lastNow = 0, busy = false;
  let wait: Extract<RetryScheduleNext, { status: 'wait' }> | null = null;

  const retiredResult = () => Object.freeze({ status: 'retired' as const, reason: reason ?? 'disposed' });
  function retire(why: string) {
    if (state === 'retired') return;
    state = 'retired'; reason = why; wait = null;
  }
  function advance(now: number) {
    if (typeof now !== 'number' || !Number.isFinite(now) || now < 0 || now < lastNow)
      throw RangeError('retry schedule: time must be finite, nonnegative and nondecreasing');
    lastNow = now;
    if (refillAt === null || tokens >= capacity) { refillAt = now; return; }
    const gained = Math.floor((now - refillAt) / refillEveryMs);
    if (gained <= 0) return;
    tokens = Math.min(capacity, tokens + gained);
    refillAt = tokens >= capacity ? now : refillAt + gained * refillEveryMs;
  }

  return Object.freeze({
    next(now: number): RetryScheduleNext {
      if (state === 'retired') return retiredResult();
      if (busy) return Object.freeze({ status: 'busy' as const });
      advance(now);
      if (state === 'waiting' && wait) return wait;
      if (state === 'exhausted' || attempt >= maxAttempts) {
        state = 'exhausted';
        return Object.freeze({ status: 'exhausted' as const, attempts: attempt });
      }
      if (tokens < 1) return Object.freeze({ status: 'budget-empty' as const, refillAtMs: (refillAt as number) + refillEveryMs });
      // Ceiling doubles per attempt; 2 ** large is Infinity, which the cap absorbs.
      const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
      let sample: unknown;
      busy = true;
      try { sample = random(); } catch { retire('random-failed'); return retiredResult(); } finally { busy = false; }
      // The random port may have disposed this schedule; TypeScript cannot see that reentry.
      if ((state as RetryScheduleState['state']) === 'retired') return retiredResult();
      if (typeof sample !== 'number' || !(sample >= 0 && sample < 1)) { retire('random-invalid'); return retiredResult(); }
      const delayMs = Math.min(ceiling, Math.floor(sample * (ceiling + 1)));
      tokens -= 1; attempt += 1; state = 'waiting';
      wait = Object.freeze({ status: 'wait' as const, attempt, delayMs, untilMs: now + delayMs });
      return wait;
    },
    due(now: number) {
      if (state === 'retired' || busy) return false;
      advance(now);
      if (state !== 'waiting' || !wait || now < wait.untilMs) return false;
      state = 'attempting'; wait = null;
      return true;
    },
    succeeded(now: number) {
      if (state === 'retired' || busy) return;
      advance(now);
      state = 'idle'; attempt = 0; wait = null;
    },
    cancel() {
      if (state === 'retired' || busy) return;
      state = 'idle'; attempt = 0; wait = null;
    },
    read(): RetryScheduleState {
      return Object.freeze({ state, attempt, tokens, untilMs: wait?.untilMs ?? null, reason, limits });
    },
    dispose() { retire('disposed'); },
  });
}
