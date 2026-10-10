/**
 * kits/playout/buffer.ts: presenting remote state a little in the past so motion between snapshots is smooth.
 *
 * Snapshots arrive irregularly (network jitter, a slow authority, a lost frame). Presenting the newest snapshot as
 * it arrives makes remote subjects stutter. A playout buffer keeps a short, bounded history per subject stamped with
 * the authority's time, and presents a render time `delay` behind the estimated remote clock, interpolating between
 * the two snapshots that bracket it. The delay adapts to measured lateness and jitter within creator bounds and
 * changes gradually; render time never goes backwards. Past the newest snapshot it extrapolates for a creator-capped
 * span, then holds. A creator-marked discontinuity is never blended across: presentation holds, then snaps.
 *
 * Pure: no clock, timer, network, ECS or renderer. Times are the authority's, in one unit chosen by the creator.
 */

export type PlayoutSubject = string | number;

export interface PlayoutLimits {
  /** Numbers per snapshot, 1 to 64. */
  readonly width: number;
  readonly maxSubjects: number;
  /** Snapshots retained per subject (ring), at least 2. */
  readonly maxSnapshots: number;
}

export interface PlayoutDelay {
  /** Smallest and largest presentation delay, in remote time units. */
  readonly min: number;
  readonly max: number;
  /** Deviations of lateness added as a safety margin (e.g. 2 to 4). */
  readonly jitterFactor: number;
  /** Largest change of the applied delay per unit of remote time elapsed (e.g. 0.1). */
  readonly adapt: number;
}

export type PlayoutBlend = (
  from: Readonly<Float64Array>,
  to: Readonly<Float64Array>,
  t: number,
  out: Float64Array,
) => void;

export interface PlayoutOptions {
  readonly limits: PlayoutLimits;
  readonly delay: PlayoutDelay;
  /** Longest span past the newest snapshot that is extrapolated before holding. 0 disables extrapolation. */
  readonly maxExtrapolation: number;
  /** Optional creator interpolation. `t` is in (0, 1) between snapshots and above 1 when extrapolating. */
  readonly blend?: PlayoutBlend;
}

export type PlayoutPushStatus = 'stored' | 'duplicate' | 'out-of-order' | 'saturated' | 'retired';

export type PlayoutSampleResult =
  | {readonly status: 'exact' | 'held'; readonly time: number}
  | {readonly status: 'interpolated'; readonly from: number; readonly to: number}
  | {readonly status: 'extrapolated'; readonly from: number; readonly to: number; readonly beyond: number}
  | {readonly status: 'absent' | 'retired'};

export interface PlayoutStats {
  readonly subjects: number;
  readonly snapshots: number;
  /** Applied and target presentation delay. */
  readonly delay: number;
  readonly target: number;
  /** Snapshots that arrived for a time already presented (the delay was too small then). */
  readonly late: number;
  readonly outOfOrder: number;
  readonly evicted: number;
  readonly refused: number;
}

export interface Playout {
  readonly options: PlayoutOptions;
  /**
   * Notes the arrival of a snapshot stamped `remoteTime` when the estimated remote clock reads `remoteNow`. Call once
   * per received frame (not per subject); it feeds the adaptive delay. Non-finite input is ignored.
   */
  observe(remoteTime: number, remoteNow: number): void;
  /** Advances presentation to `remoteNow` and returns the render time (never decreasing). */
  advance(remoteNow: number): number;
  push(
    subject: PlayoutSubject,
    remoteTime: number,
    values: ArrayLike<number>,
    options?: {readonly discontinuity?: boolean},
  ): PlayoutPushStatus;
  /** Writes the presented state at `renderTime` into `out` (length >= width); `out` is untouched for absent/retired. */
  sample(subject: PlayoutSubject, renderTime: number, out: Float64Array): PlayoutSampleResult;
  /** Drops snapshots no longer needed for `renderTime`, keeping one bracket and at least two. Returns how many. */
  trim(renderTime: number): number;
  remove(subject: PlayoutSubject): boolean;
  clear(): void;
  dispose(): void;
  stats(): PlayoutStats;
}

const MAX_WIDTH = 64;
const MAX_NUMBERS = 1 << 24;
/** Smoothing gain for lateness mean/deviation and interval estimates (a conventional 1/8). */
const GAIN = 0.125;

interface Track {
  times: Float64Array;
  values: Float64Array;
  breaks: Uint8Array;
  start: number;
  count: number;
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}
function at(a: ArrayLike<number>, i: number): number {
  return a[i]!; // indices are in range by construction
}
function linear(from: Readonly<Float64Array>, to: Readonly<Float64Array>, t: number, out: Float64Array) {
  for (let i = 0; i < out.length; i++) out[i] = at(from, i) + (at(to, i) - at(from, i)) * t;
}

function checkSubject(subject: PlayoutSubject) {
  if (typeof subject === 'number') {
    if (!Number.isSafeInteger(subject) || subject < 0) throw new TypeError('playout: invalid numeric subject');
  } else if (typeof subject !== 'string' || subject.length === 0 || subject.length > 256) {
    throw new TypeError('playout: a subject is a nonempty string of at most 256 code units');
  }
}

export function createPlayout(options: PlayoutOptions): Playout {
  const {limits, delay, maxExtrapolation} = options ?? ({} as PlayoutOptions);
  const {width, maxSubjects, maxSnapshots} = limits ?? ({} as PlayoutLimits);
  if (!Number.isSafeInteger(width) || width < 1 || width > MAX_WIDTH)
    throw new RangeError(`playout: width must be an integer 1..${MAX_WIDTH}`);
  if (!Number.isSafeInteger(maxSubjects) || maxSubjects < 1) throw new RangeError('playout: maxSubjects must be >= 1');
  if (!Number.isSafeInteger(maxSnapshots) || maxSnapshots < 2)
    throw new RangeError('playout: maxSnapshots must be >= 2');
  if (maxSubjects * maxSnapshots * (width + 1) > MAX_NUMBERS)
    throw new RangeError(`playout: maxSubjects * maxSnapshots * (width + 1) exceeds ${MAX_NUMBERS}`);
  const {min, max, jitterFactor, adapt} = delay ?? ({} as PlayoutDelay);
  if (!finite(min) || min < 0 || !finite(max) || max < min) throw new RangeError('playout: need 0 <= delay.min <= max');
  if (!finite(jitterFactor) || jitterFactor < 0) throw new RangeError('playout: delay.jitterFactor must be >= 0');
  if (!finite(adapt) || adapt < 0 || adapt >= 1) throw new RangeError('playout: delay.adapt must be in [0, 1)');
  if (!finite(maxExtrapolation) || maxExtrapolation < 0) throw new RangeError('playout: maxExtrapolation must be >= 0');
  const blend = options.blend ?? linear;
  if (typeof blend !== 'function') throw new TypeError('playout: blend must be a function');
  const frozen: PlayoutOptions = Object.freeze({
    limits: Object.freeze({width, maxSubjects, maxSnapshots}),
    delay: Object.freeze({min, max, jitterFactor, adapt}),
    maxExtrapolation,
    ...(options.blend ? {blend} : {}),
  });

  const tracks = new Map<PlayoutSubject, Track>();
  const from = new Float64Array(width);
  const to = new Float64Array(width);
  const mixed = new Float64Array(width);
  const incoming = new Float64Array(width);
  let snapshots = 0,
    late = 0,
    outOfOrder = 0,
    evicted = 0,
    refused = 0,
    disposed = false,
    busy = false;
  // Adaptive delay state.
  let lateMean: number | null = null,
    lateDev = 0,
    interval: number | null = null,
    lastObserved: number | null = null,
    applied = min,
    lastNow: number | null = null,
    render = Number.NEGATIVE_INFINITY;

  const idle = (op: string) => {
    if (busy) throw new Error(`playout: ${op} called from inside blend`);
  };
  const slot = (t: Track, k: number) => (t.start + k) % maxSnapshots;
  const target = () =>
    lateMean === null ? min : Math.min(max, Math.max(min, lateMean + (interval ?? 0) + jitterFactor * lateDev));

  function copy(track: Track, k: number, out: Float64Array) {
    const base = slot(track, k) * width;
    for (let i = 0; i < width; i++) out[i] = at(track.values, base + i);
  }
  function mix(track: Track, a: number, b: number, t: number, out: Float64Array) {
    const sa = slot(track, a) * width,
      sb = slot(track, b) * width;
    for (let i = 0; i < width; i++) {
      from[i] = at(track.values, sa + i);
      to[i] = at(track.values, sb + i);
      mixed[i] = at(from, i); // entries a blend leaves unwritten take the earlier snapshot
    }
    busy = true;
    try {
      blend(from, to, t, mixed);
    } finally {
      busy = false;
    }
    for (let i = 0; i < width; i++)
      if (!finite(mixed[i])) throw new TypeError('playout: blend produced a non-finite value');
    out.set(mixed);
  }

  const api: Playout = {
    options: frozen,
    observe(remoteTime: number, remoteNow: number) {
      idle('observe');
      if (disposed || !finite(remoteTime) || !finite(remoteNow)) return;
      const lateness = remoteNow - remoteTime;
      if (lateMean === null) lateMean = lateness;
      else {
        const err = lateness - lateMean;
        lateMean += GAIN * err;
        lateDev += GAIN * (Math.abs(err) - lateDev);
      }
      if (lastObserved !== null && remoteTime > lastObserved) {
        const gap = remoteTime - lastObserved;
        interval = interval === null ? gap : interval + GAIN * (gap - interval);
      }
      if (lastObserved === null || remoteTime > lastObserved) lastObserved = remoteTime;
    },
    advance(remoteNow: number): number {
      idle('advance');
      if (!finite(remoteNow)) throw new TypeError('playout: remoteNow must be finite');
      const elapsed = lastNow === null ? 0 : Math.max(0, remoteNow - lastNow);
      lastNow = lastNow === null ? remoteNow : Math.max(lastNow, remoteNow);
      const goal = target();
      if (lateMean !== null && render === Number.NEGATIVE_INFINITY) applied = goal;
      else {
        const step = adapt * elapsed;
        const diff = goal - applied;
        applied += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
      }
      render = Math.max(render, remoteNow - applied);
      return render;
    },
    push(subject, remoteTime, values, opts) {
      idle('push');
      checkSubject(subject);
      if (!finite(remoteTime)) throw new TypeError('playout: remoteTime must be finite');
      if (!values || values.length !== width) throw new TypeError(`playout: values must have length ${width}`);
      for (let i = 0; i < width; i++) {
        const v: unknown = values[i];
        if (!finite(v)) throw new TypeError('playout: values must be finite numbers');
        incoming[i] = v;
      }
      if (disposed) return 'retired';
      let track = tracks.get(subject);
      if (track && track.count > 0) {
        const newest = at(track.times, slot(track, track.count - 1));
        if (!finite(remoteTime - newest)) throw new RangeError('playout: remoteTime too far from the newest snapshot');
        if (remoteTime === newest) return 'duplicate';
        if (remoteTime < newest) {
          outOfOrder++;
          return 'out-of-order';
        }
      }
      if (!track) {
        if (tracks.size >= maxSubjects) {
          refused++;
          return 'saturated';
        }
        track = {
          times: new Float64Array(maxSnapshots),
          values: new Float64Array(maxSnapshots * width),
          breaks: new Uint8Array(maxSnapshots),
          start: 0,
          count: 0,
        };
        tracks.set(subject, track);
      }
      if (track.count === maxSnapshots) {
        track.start = (track.start + 1) % maxSnapshots;
        track.count--;
        snapshots--;
        evicted++;
      }
      if (remoteTime < render) late++;
      const s = slot(track, track.count);
      track.times[s] = remoteTime;
      track.breaks[s] = track.count === 0 || opts?.discontinuity === true ? 1 : 0;
      for (let i = 0; i < width; i++) track.values[s * width + i] = at(incoming, i);
      track.count++;
      snapshots++;
      return 'stored';
    },
    sample(subject, renderTime, out): PlayoutSampleResult {
      idle('sample');
      checkSubject(subject);
      if (!finite(renderTime)) throw new TypeError('playout: renderTime must be finite');
      if (!(out instanceof Float64Array) || out.length < width)
        throw new TypeError(`playout: out must be a Float64Array of length >= ${width}`);
      if (disposed) return Object.freeze({status: 'retired'});
      const track = tracks.get(subject);
      if (!track || track.count === 0) return Object.freeze({status: 'absent'});
      const newestK = track.count - 1;
      const newest = at(track.times, slot(track, newestK));
      if (renderTime >= newest) {
        const beyond = renderTime - newest;
        if (beyond === 0) {
          copy(track, newestK, out);
          return Object.freeze({status: 'exact', time: newest});
        }
        const canExtrapolate = maxExtrapolation > 0 && newestK >= 1 && !track.breaks[slot(track, newestK)];
        if (!canExtrapolate) {
          copy(track, newestK, out);
          return Object.freeze({status: 'held', time: newest});
        }
        const prev = at(track.times, slot(track, newestK - 1));
        const span = Math.min(beyond, maxExtrapolation);
        mix(track, newestK - 1, newestK, 1 + span / (newest - prev), out);
        return Object.freeze({status: 'extrapolated', from: prev, to: newest, beyond: span});
      }
      for (let k = newestK - 1; k >= 0; k--) {
        const t0 = at(track.times, slot(track, k));
        if (t0 <= renderTime) {
          if (t0 === renderTime) {
            copy(track, k, out);
            return Object.freeze({status: 'exact', time: t0});
          }
          const t1 = at(track.times, slot(track, k + 1));
          // Across a discontinuity: hold the earlier state until the jump's time, then snap.
          if (track.breaks[slot(track, k + 1)]) {
            copy(track, k, out);
            return Object.freeze({status: 'held', time: t0});
          }
          mix(track, k, k + 1, (renderTime - t0) / (t1 - t0), out);
          return Object.freeze({status: 'interpolated', from: t0, to: t1});
        }
      }
      // Older than everything retained: show the oldest snapshot.
      copy(track, 0, out);
      return Object.freeze({status: 'held', time: at(track.times, slot(track, 0))});
    },
    trim(renderTime: number): number {
      idle('trim');
      if (!finite(renderTime)) throw new TypeError('playout: renderTime must be finite');
      if (disposed) return 0;
      let dropped = 0;
      for (const track of tracks.values()) {
        // Keep the bracket at or before renderTime, and always two snapshots so extrapolation stays possible.
        while (track.count >= 3 && at(track.times, slot(track, 1)) <= renderTime) {
          track.start = (track.start + 1) % maxSnapshots;
          track.count--;
          dropped++;
        }
        if (track.count > 0) track.breaks[slot(track, 0)] = 1;
      }
      snapshots -= dropped;
      return dropped;
    },
    remove(subject) {
      idle('remove');
      checkSubject(subject);
      const track = tracks.get(subject);
      if (!track) return false;
      snapshots -= track.count;
      tracks.delete(subject);
      return true;
    },
    clear() {
      idle('clear');
      tracks.clear();
      snapshots = 0;
    },
    dispose() {
      idle('dispose');
      disposed = true;
      tracks.clear();
      snapshots = 0;
    },
    stats: (): PlayoutStats =>
      Object.freeze({
        subjects: tracks.size,
        snapshots,
        delay: applied,
        target: target(),
        late,
        outOfOrder,
        evicted,
        refused,
      }),
  };
  return Object.freeze(api);
}
