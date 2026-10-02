/**
 * Optional planned drain and capped connection lifetime (NW-08). Two pure, caller-driven state machines:
 *
 * - `createConnectionDrain` (host side) decides when each tracked connection is told to drain and when it is closed:
 *   on an operator drain with a bounded notice, or when an optional capped lifetime (randomly dithered earlier, never
 *   later) runs out. It stops admitting new work for a notified connection; it never cancels work already admitted.
 * - `createDrainFollower` (client side) validates a drain notice against the client's own bounds, stops new work,
 *   says when to close cooperatively, and holds the first reconnect until the host's announced return time. Pacing
 *   after the hold belongs to the caller's existing `createRetrySchedule`.
 *
 * Neither owns a timer, socket, clock, random source, credential or wire format; nothing in the engine constructs
 * them. See docs/guides/network-drain.md.
 */

/** Largest accepted notice, lifetime or return delay: one day. A creator chooses smaller bounds. */
export const MAX_DRAIN_WINDOW_MS = 86_400_000;
export const MAX_DRAIN_KEYS = 65_536;
/** Close code a reference host uses for a drain or lifetime close (RFC 6455 1012 "service restart"). Transient by default. */
export const DRAIN_CLOSE_CODE = 1012;

export type DrainCause = 'planned' | 'lifetime';
export type DrainKey = object | string;

export interface ConnectionLifetimeLimits {
  /** Cap on the scheduled close, measured from `track`. Emission waits for the next `poll` and its per-poll cap. */
  readonly maxLifetimeMs: number;
  /** Each connection closes uniformly in [maxLifetimeMs - jitterMs, maxLifetimeMs] after `track`. 0 disables dither. */
  readonly jitterMs: number;
  /** Notice before a lifetime close. Must leave room: noticeMs + jitterMs < maxLifetimeMs. */
  readonly noticeMs: number;
  /** Announced delay after the close before the client should reconnect (host not expected back sooner). */
  readonly reconnectAfterMs: number;
}

export interface ConnectionDrainLimits {
  /** Tracked connections; at most MAX_DRAIN_KEYS. Use the transport/intake connection bound. */
  readonly maxKeys: number;
  /** Largest notice an operator drain may give. */
  readonly maxNoticeMs: number;
  /** Largest return delay an operator drain may announce. */
  readonly maxReconnectAfterMs: number;
  /** Notify/close instructions returned by one `poll`; the rest wait for the next poll, earliest first. */
  readonly maxActionsPerPoll: number;
  /** Optional capped lifetime. Omitted: connections live until drained or closed by other policy. */
  readonly lifetime?: ConnectionLifetimeLimits;
}

export interface ConnectionDrainOptions {
  readonly limits: ConnectionDrainLimits;
  /** Uniform in [0, 1); used only for lifetime dither. Required when `lifetime` is configured. */
  readonly random?: () => number;
}

export interface DrainNotice { readonly cause: DrainCause; readonly closeInMs: number; readonly reconnectAfterMs: number }

export type DrainAction =
  | Readonly<{ key: DrainKey; action: 'notify'; notice: DrainNotice }>
  | Readonly<{ key: DrainKey; action: 'close'; cause: DrainCause }>;

export type DrainTrackResult =
  | Readonly<{ status: 'tracked'; closeAtMs: number | null }>
  | Readonly<{ status: 'refused'; reason: 'draining' | 'capacity' | 'duplicate' | 'invalid-key' | 'busy' | 'retired' }>;

export type DrainStartResult =
  | Readonly<{ status: 'draining'; connections: number; closeByMs: number }>
  | Readonly<{ status: 'refused'; reason: 'invalid' | 'busy' | 'retired' }>;

export interface ConnectionDrainState {
  readonly tracked: number;
  /** Notified, close not yet instructed. */
  readonly notified: number;
  /** Close instructed, `forget` not yet called. */
  readonly closing: number;
  /** An operator drain is in force: new connections are refused until `resume`. */
  readonly draining: boolean;
  readonly retired: string | null;
  readonly counts: Readonly<{ notices: number; closes: number; refusedDraining: number; refusedCapacity: number }>;
  readonly limits: ConnectionDrainLimits;
}

export interface ConnectionDrain {
  /** Start tracking a newly opened connection. Refused while draining or at capacity. */
  track(key: DrainKey, now: number): DrainTrackResult;
  /** True only for a tracked connection that has not been notified: admit new work for it. */
  admits(key: DrainKey): boolean;
  /**
   * Operator drain of every tracked connection, including ones already notified: the close only moves earlier, the
   * announced return only lengthens, the cause becomes `planned`, and a changed notice is re-sent once.
   */
  drain(now: number, request: { readonly noticeMs: number; readonly reconnectAfterMs: number }): DrainStartResult;
  /** Accept new connections again. Connections already notified keep their close. */
  resume(): boolean;
  /** Due instructions, at most `maxActionsPerPoll`, earliest first. A connection's notify always precedes its close. */
  poll(now: number): readonly DrainAction[];
  /** The connection is gone (closed by drain or anything else). Idempotent. */
  forget(key: DrainKey): boolean;
  read(): ConnectionDrainState;
  /** Terminal and idempotent: clears every connection; later calls refuse or return nothing. */
  dispose(): void;
}

const bounded = (value: unknown, min = 1): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= MAX_DRAIN_WINDOW_MS;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) =>
  required.every(key => Object.hasOwn(value, key)) &&
  Object.keys(value).every(key => required.includes(key) || optional.includes(key));

function captureLifetime(value: unknown): ConnectionLifetimeLimits {
  if (!isRecord(value) || !onlyKeys(value, ['maxLifetimeMs', 'jitterMs', 'noticeMs', 'reconnectAfterMs']))
    throw Error('connection drain: invalid lifetime');
  const { maxLifetimeMs, jitterMs, noticeMs, reconnectAfterMs } = value;
  if (!bounded(maxLifetimeMs) || !bounded(jitterMs, 0) || !bounded(noticeMs, 0) || !bounded(reconnectAfterMs, 0) ||
    (noticeMs as number) + (jitterMs as number) >= (maxLifetimeMs as number))
    throw Error('connection drain: invalid lifetime');
  return Object.freeze({ maxLifetimeMs, jitterMs, noticeMs, reconnectAfterMs }) as ConnectionLifetimeLimits;
}

function captureLimits(value: unknown): ConnectionDrainLimits {
  if (!isRecord(value) || !onlyKeys(value, ['maxKeys', 'maxNoticeMs', 'maxReconnectAfterMs', 'maxActionsPerPoll'], ['lifetime']))
    throw Error('connection drain: invalid limits');
  const { maxKeys, maxNoticeMs, maxReconnectAfterMs, maxActionsPerPoll } = value;
  if (!Number.isSafeInteger(maxKeys) || (maxKeys as number) < 1 || (maxKeys as number) > MAX_DRAIN_KEYS ||
    !bounded(maxNoticeMs, 0) || !bounded(maxReconnectAfterMs, 0) ||
    !Number.isSafeInteger(maxActionsPerPoll) || (maxActionsPerPoll as number) < 2 || (maxActionsPerPoll as number) > MAX_DRAIN_KEYS)
    throw Error('connection drain: invalid limits');
  const lifetime = value.lifetime === undefined ? undefined : captureLifetime(value.lifetime);
  return Object.freeze({ maxKeys, maxNoticeMs, maxReconnectAfterMs, maxActionsPerPoll,
    ...(lifetime ? { lifetime } : {}) }) as ConnectionDrainLimits;
}

const validKey = (key: unknown): key is DrainKey =>
  (typeof key === 'object' && key !== null) || typeof key === 'function' ||
  (typeof key === 'string' && key.length > 0 && key.length <= 256);

type Entry = {
  closeAt: number | null; noticeAt: number | null; cause: DrainCause; reconnectAfterMs: number;
  phase: 'live' | 'notified' | 'closing'; order: number;
  /** Notified, but a later operator drain changed what the client was told: send one superseding notice. */
  renotify: boolean;
};

/** Construct one per host (or per listener). Construction reads no clock and draws no randomness. */
export function createConnectionDrain(options: ConnectionDrainOptions): ConnectionDrain {
  if (!isRecord(options) || !onlyKeys(options, ['limits'], ['random'])) throw Error('connection drain: invalid configuration');
  const limits = captureLimits(options.limits);
  const random = options.random;
  if (random !== undefined && typeof random !== 'function') throw Error('connection drain: invalid configuration');
  if (limits.lifetime && !random) throw Error('connection drain: lifetime requires a random port');

  const entries = new Map<DrainKey, Entry>();
  const counts = { notices: 0, closes: 0, refusedDraining: 0, refusedCapacity: 0 };
  let retired: string | null = null, draining = false, busy = false, lastNow = 0, order = 0;

  function time(now: number) {
    if (typeof now !== 'number' || !Number.isFinite(now) || now < 0 || now < lastNow)
      throw RangeError('connection drain: time must be finite, nonnegative and nondecreasing');
    lastNow = now;
  }
  function retire(reason: string) {
    if (retired !== null) return;
    retired = reason; entries.clear(); draining = false;
  }
  const refusedTrack = (reason: Extract<DrainTrackResult, { status: 'refused' }>['reason']) =>
    Object.freeze({ status: 'refused' as const, reason });

  return Object.freeze({
    track(key: DrainKey, now: number): DrainTrackResult {
      if (retired !== null) return refusedTrack('retired');
      if (busy) return refusedTrack('busy');
      time(now);
      if (!validKey(key)) return refusedTrack('invalid-key');
      if (entries.has(key)) return refusedTrack('duplicate');
      if (draining) { counts.refusedDraining++; return refusedTrack('draining'); }
      if (entries.size >= limits.maxKeys) { counts.refusedCapacity++; return refusedTrack('capacity'); }
      let closeAt: number | null = null, noticeAt: number | null = null, reconnectAfterMs = 0;
      const lifetime = limits.lifetime;
      if (lifetime) {
        let sample: unknown;
        busy = true;
        try { sample = (random as () => number)(); } catch { retire('random-failed'); return refusedTrack('retired'); } finally { busy = false; }
        if ((retired as string | null) !== null) return refusedTrack('retired');
        if (typeof sample !== 'number' || !(sample >= 0 && sample < 1)) { retire('random-invalid'); return refusedTrack('retired'); }
        const dither = Math.min(lifetime.jitterMs, Math.floor(sample * (lifetime.jitterMs + 1)));
        closeAt = now + lifetime.maxLifetimeMs - dither;
        noticeAt = closeAt - lifetime.noticeMs;
        reconnectAfterMs = lifetime.reconnectAfterMs;
      }
      entries.set(key, { closeAt, noticeAt, cause: 'lifetime', reconnectAfterMs, phase: 'live', order: order++, renotify: false });
      return Object.freeze({ status: 'tracked' as const, closeAtMs: closeAt });
    },
    admits(key: DrainKey) {
      return retired === null && entries.get(key)?.phase === 'live';
    },
    drain(now: number, request: { readonly noticeMs: number; readonly reconnectAfterMs: number }): DrainStartResult {
      if (retired !== null) return Object.freeze({ status: 'refused' as const, reason: 'retired' as const });
      if (busy) return Object.freeze({ status: 'refused' as const, reason: 'busy' as const });
      time(now);
      if (!isRecord(request) || !onlyKeys(request, ['noticeMs', 'reconnectAfterMs']) ||
        !bounded(request.noticeMs, 0) || request.noticeMs > limits.maxNoticeMs ||
        !bounded(request.reconnectAfterMs, 0) || request.reconnectAfterMs > limits.maxReconnectAfterMs)
        return Object.freeze({ status: 'refused' as const, reason: 'invalid' as const });
      draining = true;
      const closeBy = now + request.noticeMs;
      let connections = 0;
      for (const entry of entries.values()) {
        if (entry.phase === 'closing') continue;
        connections++;
        // Every open connection learns this drain: the close only ever moves earlier, the announced return only
        // ever lengthens, and the cause becomes `planned`, so a client already told of a lifetime close with a
        // short return does not reconnect straight into the draining host.
        const closeAt = entry.closeAt === null ? closeBy : Math.min(entry.closeAt, closeBy);
        const reconnectAfterMs = Math.max(entry.reconnectAfterMs, request.reconnectAfterMs);
        const changed = closeAt !== entry.closeAt || reconnectAfterMs !== entry.reconnectAfterMs || entry.cause !== 'planned';
        entry.closeAt = closeAt; entry.reconnectAfterMs = reconnectAfterMs; entry.cause = 'planned';
        if (entry.phase === 'live') entry.noticeAt = now;
        else if (changed) { entry.renotify = true; entry.noticeAt = now; }
      }
      return Object.freeze({ status: 'draining' as const, connections, closeByMs: closeBy });
    },
    resume() {
      if (retired !== null || busy || !draining) return false;
      draining = false;
      return true;
    },
    poll(now: number): readonly DrainAction[] {
      if (retired !== null || busy) return Object.freeze([]);
      time(now);
      const due: Array<[DrainKey, Entry, number]> = [];
      for (const [key, entry] of entries) {
        if ((entry.phase === 'live' || entry.renotify) && entry.noticeAt !== null && now >= entry.noticeAt)
          due.push([key, entry, entry.noticeAt]);
        else if (entry.phase === 'notified' && now >= (entry.closeAt as number)) due.push([key, entry, entry.closeAt as number]);
      }
      due.sort((a, b) => a[2] - b[2] || a[1].order - b[1].order);
      const actions: DrainAction[] = [];
      for (const [key, entry] of due) {
        if (actions.length >= limits.maxActionsPerPoll) break;
        if (entry.phase === 'live' || entry.renotify) {
          const closeAt = entry.closeAt as number;
          entry.phase = 'notified'; entry.renotify = false; counts.notices++;
          actions.push(Object.freeze({ key, action: 'notify' as const, notice: Object.freeze({
            cause: entry.cause, closeInMs: Math.max(0, Math.floor(closeAt - now)), reconnectAfterMs: entry.reconnectAfterMs }) }));
          // closeInMs is whole milliseconds rounded down, so a fractional host clock never announces a later close.
          // A notice delivered late (per-poll cap) does not postpone the close; a close already due follows at once.
          if (now < closeAt || actions.length >= limits.maxActionsPerPoll) continue;
        }
        entry.phase = 'closing'; counts.closes++;
        actions.push(Object.freeze({ key, action: 'close' as const, cause: entry.cause }));
      }
      return Object.freeze(actions);
    },
    forget(key: DrainKey) {
      if (retired !== null || busy) return false;
      return entries.delete(key);
    },
    read(): ConnectionDrainState {
      let notified = 0, closing = 0;
      for (const entry of entries.values()) {
        if (entry.phase === 'notified') notified++;
        else if (entry.phase === 'closing') closing++;
      }
      return Object.freeze({ tracked: entries.size, notified, closing, draining, retired,
        counts: Object.freeze({ ...counts }), limits });
    },
    dispose() { retire('disposed'); },
  });
}

export interface DrainFollowerLimits {
  /** Largest notice the client accepts; a larger value is invalid input, not a longer wait. */
  readonly maxNoticeMs: number;
  /** Largest return delay the client accepts. */
  readonly maxReconnectAfterMs: number;
}

export type DrainNoticeResult =
  | Readonly<{ status: 'draining'; cause: DrainCause; closeByMs: number; reconnectAfterMs: number }>
  | Readonly<{ status: 'updated'; cause: DrainCause; closeByMs: number; reconnectAfterMs: number }>
  | Readonly<{ status: 'duplicate'; closeByMs: number }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'retired' }>;

export type DrainCloseResult =
  | Readonly<{ status: 'hold'; untilMs: number; cause: DrainCause }>
  | Readonly<{ status: 'unplanned' }>
  | Readonly<{ status: 'retired' }>;

export interface DrainFollowerState {
  readonly state: 'idle' | 'draining' | 'holding' | 'retired';
  readonly cause: DrainCause | null;
  readonly closeByMs: number | null;
  readonly holdUntilMs: number | null;
  readonly limits: DrainFollowerLimits;
}

export interface DrainFollower {
  /**
   * Validate a decoded notice payload `{cause, closeInMs, reconnectAfterMs}`. A later notice in the same drain is
   * merged monotonically: it may bring the close earlier, lengthen the return delay or turn the cause to `planned`
   * (`updated`); it can never postpone the close or shorten the return (otherwise `duplicate`).
   */
  notice(payload: unknown, now: number): DrainNoticeResult;
  /** False while draining or holding: send no new work. Pending work settles normally. */
  admits(): boolean;
  /** True exactly once when the notice's close time is reached, so the client can close cooperatively. */
  closeDue(now: number): boolean;
  /** The transport closed. During a drain: hold reconnecting until `untilMs`; otherwise `unplanned`. */
  closed(now: number): DrainCloseResult;
  /** True exactly once when the hold ends; the caller then asks its retry schedule for a jittered wait. */
  release(now: number): boolean;
  /** Forget the drain (explicit disconnect, owner change or a successful fresh session). */
  reset(): void;
  read(): DrainFollowerState;
  /** Terminal and idempotent. */
  dispose(): void;
}

/** Construct one per connection owner (scene visit). It owns no timer and never opens or closes a transport. */
export function createDrainFollower(options: { readonly limits: DrainFollowerLimits }): DrainFollower {
  if (!isRecord(options) || !onlyKeys(options, ['limits']) || !isRecord(options.limits) ||
    !onlyKeys(options.limits, ['maxNoticeMs', 'maxReconnectAfterMs']) ||
    !bounded(options.limits.maxNoticeMs, 0) || !bounded(options.limits.maxReconnectAfterMs, 0))
    throw Error('drain follower: invalid limits');
  const limits = Object.freeze({ maxNoticeMs: options.limits.maxNoticeMs, maxReconnectAfterMs: options.limits.maxReconnectAfterMs });
  let state: DrainFollowerState['state'] = 'idle', cause: DrainCause | null = null;
  let closeBy: number | null = null, reconnectAfter = 0, holdUntil: number | null = null, closeSignalled = false, lastNow = 0;

  function time(now: number) {
    if (typeof now !== 'number' || !Number.isFinite(now) || now < 0 || now < lastNow)
      throw RangeError('drain follower: time must be finite, nonnegative and nondecreasing');
    lastNow = now;
  }
  function clear() { state = 'idle'; cause = null; closeBy = null; reconnectAfter = 0; holdUntil = null; closeSignalled = false; }

  return Object.freeze({
    notice(payload: unknown, now: number): DrainNoticeResult {
      if (state === 'retired') return Object.freeze({ status: 'retired' as const });
      time(now);
      if (!isRecord(payload) || !onlyKeys(payload, ['cause', 'closeInMs', 'reconnectAfterMs']) ||
        (payload.cause !== 'planned' && payload.cause !== 'lifetime') ||
        !bounded(payload.closeInMs, 0) || payload.closeInMs > limits.maxNoticeMs ||
        !bounded(payload.reconnectAfterMs, 0) || payload.reconnectAfterMs > limits.maxReconnectAfterMs)
        return Object.freeze({ status: 'invalid' as const });
      if (state === 'draining') {
        const nextClose = Math.min(closeBy as number, now + payload.closeInMs);
        const nextReturn = Math.max(reconnectAfter, payload.reconnectAfterMs);
        const nextCause: DrainCause = cause === 'planned' || payload.cause === 'planned' ? 'planned' : 'lifetime';
        if (nextClose === closeBy && nextReturn === reconnectAfter && nextCause === cause)
          return Object.freeze({ status: 'duplicate' as const, closeByMs: closeBy as number });
        closeBy = nextClose; reconnectAfter = nextReturn; cause = nextCause;
        return Object.freeze({ status: 'updated' as const, cause, closeByMs: closeBy, reconnectAfterMs: reconnectAfter });
      }
      if (state !== 'idle') return Object.freeze({ status: 'duplicate' as const, closeByMs: closeBy ?? now });
      state = 'draining'; cause = payload.cause; closeBy = now + payload.closeInMs; reconnectAfter = payload.reconnectAfterMs;
      return Object.freeze({ status: 'draining' as const, cause, closeByMs: closeBy, reconnectAfterMs: reconnectAfter });
    },
    admits() { return state === 'idle'; },
    closeDue(now: number) {
      if (state !== 'draining' || closeSignalled) return false;
      time(now);
      if (now < (closeBy as number)) return false;
      closeSignalled = true;
      return true;
    },
    closed(now: number): DrainCloseResult {
      if (state === 'retired') return Object.freeze({ status: 'retired' as const });
      time(now);
      if (state === 'holding') return Object.freeze({ status: 'hold' as const, untilMs: holdUntil as number, cause: cause as DrainCause });
      if (state !== 'draining') return Object.freeze({ status: 'unplanned' as const });
      state = 'holding'; holdUntil = now + reconnectAfter;
      return Object.freeze({ status: 'hold' as const, untilMs: holdUntil, cause: cause as DrainCause });
    },
    release(now: number) {
      if (state !== 'holding') return false;
      time(now);
      if (now < (holdUntil as number)) return false;
      clear();
      return true;
    },
    reset() { if (state !== 'retired') clear(); },
    read(): DrainFollowerState {
      return Object.freeze({ state, cause, closeByMs: closeBy, holdUntilMs: holdUntil, limits });
    },
    dispose() { clear(); state = 'retired'; },
  });
}
