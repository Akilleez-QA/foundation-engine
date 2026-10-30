/**
 * kits/rewind/history.ts: bounded per-subject sample history with time-addressed, never-extrapolating queries.
 *
 * An authoritative host records numeric samples (positions, extents, orientation, anything the creator chooses) for
 * each subject at its own simulation times. When a command arrives that was decided against an older picture of the
 * world (what a remote observer was shown), the host asks what a subject looked like at that time and tests the
 * command against the answer. Nothing here moves, restores or owns live state: a query writes into a caller buffer.
 *
 * Pure: no clock, timer, scheduler, network, ECS or renderer. Time is a caller-supplied finite number in any unit
 * (seconds, ticks); one history uses one unit. Memory is bounded by `maxSubjects * maxSamples * (width + 1)` numbers.
 */

export type RewindSubject = string | number;

export interface RewindLimits {
  /** Numbers per sample, 1 to 64. */
  readonly width: number;
  /** Distinct subjects retained at once. */
  readonly maxSubjects: number;
  /** Samples retained per subject (a ring; the oldest is overwritten). At least 2. */
  readonly maxSamples: number;
  /** Longest look-back, in the history's time unit. `trim(now)` drops samples older than `now - maxRewind`. */
  readonly maxRewind: number;
}

/** Writes the blend of `from` and `to` at fraction `t` (0 < t < 1) into `out`. Must be finite. */
export type RewindBlend = (
  from: Readonly<Float64Array>,
  to: Readonly<Float64Array>,
  t: number,
  out: Float64Array,
) => void;

export interface RewindOptions {
  readonly limits: RewindLimits;
  /** Optional creator interpolation (e.g. angles or quaternions). Default: componentwise linear. */
  readonly blend?: RewindBlend;
}

export type RewindRecordStatus = 'recorded' | 'replaced' | 'unchanged' | 'out-of-order' | 'saturated' | 'retired';

export type RewindSampleResult =
  | {readonly status: 'exact' | 'current'; readonly time: number}
  | {readonly status: 'interpolated'; readonly time: number; readonly from: number; readonly to: number}
  | {readonly status: 'absent' | 'before-history' | 'discontinuous' | 'retired'};

export interface RewindStats {
  readonly subjects: number;
  readonly samples: number;
  /** Samples overwritten because a subject's ring was full (history shorter than `maxRewind`). */
  readonly evicted: number;
  /** Samples removed by `trim`. */
  readonly trimmed: number;
  /** New subjects refused because `maxSubjects` was reached. */
  readonly refused: number;
}

export interface RewindHistory {
  readonly limits: RewindLimits;
  /**
   * Appends a sample at `time`. `discontinuity: true` marks that the subject did not travel continuously from its
   * previous sample (teleport, respawn, a new life): queries never blend across it and refuse to look past it.
   * A subject's first sample has no predecessor, so looking before it reports `before-history`.
   * Equal time is `unchanged` (the stored sample is kept), except with `discontinuity`: then the newest sample's values
   * are `replaced` and it is cut from its predecessor (a jump inside one step). Older time is `out-of-order` and stores
   * nothing. Times must differ from the newest sample by a finite amount.
   */
  record(
    subject: RewindSubject,
    time: number,
    values: ArrayLike<number>,
    options?: {readonly discontinuity?: boolean},
  ): RewindRecordStatus;
  /**
   * Writes the subject's state at `time` into `out` (length >= width). `out` is written only for `exact`, `current`
   * (time at or after the newest sample: the newest sample, never extrapolated) and `interpolated`.
   */
  sample(subject: RewindSubject, time: number, out: Float64Array): RewindSampleResult;
  /**
   * Drops samples older than `now - maxRewind`, keeping one bracketing sample, and forgets subjects whose newest sample
   * is older than that (they were not recorded within the window). Returns how many samples were dropped.
   */
  trim(now: number): number;
  /** Forgets one subject (it no longer exists). */
  remove(subject: RewindSubject): boolean;
  /** Forgets every subject; counters are kept. */
  clear(): void;
  /** Terminal: frees everything; later records report `retired`. */
  dispose(): void;
  stats(): RewindStats;
}

const MAX_WIDTH = 64;
const MAX_NUMBERS = 1 << 24;
const MAX_SUBJECT_LENGTH = 256;

interface Track {
  times: Float64Array;
  values: Float64Array;
  breaks: Uint8Array;
  /** Index of the oldest sample. */
  start: number;
  count: number;
}

function positiveInt(n: number, max: number) {
  return Number.isSafeInteger(n) && n >= 1 && n <= max;
}

function checkLimits(limits: RewindLimits): RewindLimits {
  const {width, maxSubjects, maxSamples, maxRewind} = limits ?? ({} as RewindLimits);
  if (!positiveInt(width, MAX_WIDTH)) throw new RangeError(`rewind: width must be an integer 1..${MAX_WIDTH}`);
  if (!positiveInt(maxSubjects, MAX_NUMBERS)) throw new RangeError('rewind: maxSubjects must be a positive integer');
  if (!positiveInt(maxSamples, MAX_NUMBERS) || maxSamples < 2)
    throw new RangeError('rewind: maxSamples must be an integer >= 2');
  if (!(typeof maxRewind === 'number' && Number.isFinite(maxRewind) && maxRewind > 0))
    throw new RangeError('rewind: maxRewind must be a positive finite number');
  if (maxSubjects * maxSamples * (width + 1) > MAX_NUMBERS)
    throw new RangeError(`rewind: maxSubjects * maxSamples * (width + 1) exceeds ${MAX_NUMBERS} numbers`);
  return Object.freeze({width, maxSubjects, maxSamples, maxRewind});
}

function checkSubject(subject: RewindSubject) {
  if (typeof subject === 'number') {
    if (!Number.isSafeInteger(subject) || subject < 0)
      throw new TypeError('rewind: a numeric subject must be a nonnegative safe integer');
  } else if (typeof subject !== 'string' || subject.length === 0 || subject.length > MAX_SUBJECT_LENGTH) {
    throw new TypeError(`rewind: a subject must be a nonempty string of at most ${MAX_SUBJECT_LENGTH} code units`);
  }
}

function checkTime(time: number, name: string) {
  if (typeof time !== 'number' || !Number.isFinite(time)) throw new TypeError(`rewind: ${name} must be finite`);
}

/** Reads a typed-array slot whose index is in range by construction (ring arithmetic below). */
function get(a: Readonly<Float64Array> | Uint8Array | ArrayLike<number>, i: number): number {
  return a[i]!;
}

function linear(from: Readonly<Float64Array>, to: Readonly<Float64Array>, t: number, out: Float64Array) {
  for (let i = 0; i < out.length; i++) out[i] = get(from, i) + (get(to, i) - get(from, i)) * t;
}

export function createRewindHistory(options: RewindOptions): RewindHistory {
  const limits = checkLimits(options?.limits);
  const blend = options.blend ?? linear;
  if (typeof blend !== 'function') throw new TypeError('rewind: blend must be a function');
  const {width, maxSubjects, maxSamples, maxRewind} = limits;
  const tracks = new Map<RewindSubject, Track>();
  const from = new Float64Array(width);
  const to = new Float64Array(width);
  const mixed = new Float64Array(width);
  const incoming = new Float64Array(width);
  let samples = 0;
  let evicted = 0;
  let trimmed = 0;
  let refused = 0;
  let disposed = false;
  let busy = false;

  const idle = (op: string) => {
    if (busy) throw new Error(`rewind: ${op} called from inside blend`);
  };
  const slot = (track: Track, k: number) => (track.start + k) % maxSamples;

  function copyOut(track: Track, k: number, out: Float64Array) {
    const base = slot(track, k) * width;
    for (let i = 0; i < width; i++) out[i] = get(track.values, base + i);
  }

  function record(
    subject: RewindSubject,
    time: number,
    values: ArrayLike<number>,
    opts?: {readonly discontinuity?: boolean},
  ): RewindRecordStatus {
    idle('record');
    checkSubject(subject);
    checkTime(time, 'time');
    if (!values || values.length !== width) throw new TypeError(`rewind: values must have length ${width}`);
    // Read each value exactly once into scratch, then validate the copy.
    for (let i = 0; i < width; i++) {
      const v: unknown = values[i];
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError('rewind: values must be finite numbers');
      incoming[i] = v;
    }
    const discontinuity = opts?.discontinuity === true;
    let track = tracks.get(subject);
    if (track && track.count > 0) {
      const newest = get(track.times, slot(track, track.count - 1));
      if (!Number.isFinite(time - newest)) throw new RangeError('rewind: time is too far from the newest sample');
      if (disposed) return 'retired';
      if (time === newest) {
        if (!discontinuity) return 'unchanged';
        // A jump inside one step: the post-jump state replaces the sample and is cut from its predecessor.
        const s = slot(track, track.count - 1);
        track.breaks[s] = 1;
        for (let i = 0; i < width; i++) track.values[s * width + i] = get(incoming, i);
        return 'replaced';
      }
      if (time < newest) return 'out-of-order';
    }
    if (disposed) return 'retired';
    if (!track) {
      if (tracks.size >= maxSubjects) {
        refused++;
        return 'saturated';
      }
      track = {
        times: new Float64Array(maxSamples),
        values: new Float64Array(maxSamples * width),
        breaks: new Uint8Array(maxSamples),
        start: 0,
        count: 0,
      };
      tracks.set(subject, track);
    }
    if (track.count === maxSamples) {
      track.start = (track.start + 1) % maxSamples;
      track.count--;
      samples--;
      evicted++;
    }
    const s = slot(track, track.count);
    track.times[s] = time;
    track.breaks[s] = track.count === 0 || discontinuity ? 1 : 0;
    for (let i = 0; i < width; i++) track.values[s * width + i] = get(incoming, i);
    track.count++;
    samples++;
    return 'recorded';
  }

  function sample(subject: RewindSubject, time: number, out: Float64Array): RewindSampleResult {
    idle('sample');
    checkSubject(subject);
    checkTime(time, 'time');
    if (!(out instanceof Float64Array) || out.length < width)
      throw new TypeError(`rewind: out must be a Float64Array of length >= ${width}`);
    if (disposed) return {status: 'retired'};
    const track = tracks.get(subject);
    if (!track || track.count === 0) return {status: 'absent'};
    const newestK = track.count - 1;
    const newest = get(track.times, slot(track, newestK));
    if (time >= newest) {
      copyOut(track, newestK, out);
      return {status: time === newest ? 'exact' : 'current', time: newest};
    }
    // Walk from newest to oldest; the newest sample at or before `time` is the lower bracket.
    for (let k = newestK; k >= 0; k--) {
      const s = slot(track, k);
      const at = get(track.times, s);
      if (at <= time) {
        if (at === time) {
          copyOut(track, k, out);
          return {status: 'exact', time: at};
        }
        const upper = slot(track, k + 1);
        // k + 1 exists: k < newestK because time < newest.
        if (track.breaks[upper]) return {status: 'discontinuous'};
        const next = get(track.times, upper);
        const t = (time - at) / (next - at);
        for (let i = 0; i < width; i++) {
          from[i] = get(track.values, s * width + i);
          to[i] = get(track.values, upper * width + i);
          mixed[i] = from[i]!; // a blend that leaves an entry unwritten yields the earlier sample, not stale scratch
        }
        busy = true;
        try {
          blend(from, to, t, mixed);
        } finally {
          busy = false;
        }
        for (let i = 0; i < width; i++)
          if (!Number.isFinite(get(mixed, i))) throw new TypeError('rewind: blend produced a non-finite value');
        out.set(mixed.subarray(0, width));
        return {status: 'interpolated', time, from: at, to: next};
      }
      if (track.breaks[s]) return k === 0 ? {status: 'before-history'} : {status: 'discontinuous'};
    }
    return {status: 'before-history'};
  }

  function trim(now: number): number {
    idle('trim');
    checkTime(now, 'now');
    if (disposed) return 0;
    const cutoff = now - maxRewind;
    let dropped = 0;
    for (const [subject, track] of tracks) {
      // A subject not recorded within the window has no history worth answering from: forget it.
      if (track.count > 0 && get(track.times, slot(track, track.count - 1)) < cutoff) {
        dropped += track.count;
        tracks.delete(subject);
        continue;
      }
      // Keep the newest sample older than the cutoff: it brackets queries at the cutoff itself.
      while (track.count >= 2 && get(track.times, slot(track, 1)) <= cutoff) {
        track.start = (track.start + 1) % maxSamples;
        track.count--;
        dropped++;
      }
      // A retained bracket that no longer interpolates into the window (a discontinuity follows it) is useless.
      if (track.count >= 2 && get(track.times, slot(track, 0)) < cutoff && track.breaks[slot(track, 1)]) {
        track.start = (track.start + 1) % maxSamples;
        track.count--;
        dropped++;
      }
      // The new oldest sample has no retained predecessor.
      if (track.count > 0) track.breaks[slot(track, 0)] = 1;
    }
    samples -= dropped;
    trimmed += dropped;
    return dropped;
  }

  function remove(subject: RewindSubject): boolean {
    idle('remove');
    checkSubject(subject);
    const track = tracks.get(subject);
    if (!track) return false;
    samples -= track.count;
    tracks.delete(subject);
    return true;
  }

  function clear() {
    idle('clear');
    tracks.clear();
    samples = 0;
  }

  return Object.freeze({
    limits,
    record,
    sample,
    trim,
    remove,
    clear,
    dispose() {
      idle('dispose');
      disposed = true;
      tracks.clear();
      samples = 0;
    },
    stats: (): RewindStats => Object.freeze({subjects: tracks.size, samples, evicted, trimmed, refused}),
  });
}

export interface RewindTimeRequest {
  /** The host's current time. */
  readonly now: number;
  /** The time the remote party says it was looking at (untrusted; may be missing or malformed). */
  readonly claimed?: unknown;
  /** Longest permitted look-back (usually the history's `maxRewind`). */
  readonly maxRewind: number;
  /** Optional host estimate of how far behind `now` that party's view is (latency plus its display delay). */
  readonly behind?: number;
  /** With `behind`: largest accepted difference between the claim and the estimate; beyond it the estimate wins. */
  readonly maxSkew?: number;
}

export interface RewindTime {
  readonly time: number;
  /** Which input decided the time before clamping. */
  readonly basis: 'claim' | 'estimate' | 'now';
  /** True when the window [now - maxRewind, now] changed the result. */
  readonly clamped: boolean;
}

/**
 * Chooses the time to query: the remote claim, unless it is missing or disagrees with the host's own estimate by
 * more than `maxSkew`; then always clamped to [now - maxRewind, now], so a party cannot reach further back than
 * the creator allows, nor into the future.
 */
export function chooseRewindTime(request: RewindTimeRequest): RewindTime {
  const {now, claimed, maxRewind, behind, maxSkew} = request;
  checkTime(now, 'now');
  if (!(typeof maxRewind === 'number' && Number.isFinite(maxRewind) && maxRewind >= 0))
    throw new RangeError('rewind: maxRewind must be a nonnegative finite number');
  if (behind !== undefined && !(Number.isFinite(behind) && behind >= 0))
    throw new RangeError('rewind: behind must be a nonnegative finite number');
  if (maxSkew !== undefined && !(Number.isFinite(maxSkew) && maxSkew >= 0))
    throw new RangeError('rewind: maxSkew must be a nonnegative finite number');
  if (maxSkew !== undefined && behind === undefined) throw new RangeError('rewind: maxSkew requires behind');
  const estimate = behind === undefined ? undefined : now - behind;
  if (!Number.isFinite(now - maxRewind) || (estimate !== undefined && !Number.isFinite(estimate)))
    throw new RangeError('rewind: now, maxRewind and behind must keep the window finite');
  let time: number;
  let basis: RewindTime['basis'];
  if (typeof claimed === 'number' && Number.isFinite(claimed)) {
    if (estimate !== undefined && maxSkew !== undefined && Math.abs(claimed - estimate) > maxSkew) {
      time = estimate;
      basis = 'estimate';
    } else {
      time = claimed;
      basis = 'claim';
    }
  } else if (estimate !== undefined) {
    time = estimate;
    basis = 'estimate';
  } else {
    time = now;
    basis = 'now';
  }
  const low = now - maxRewind;
  const clampedTime = time < low ? low : time > now ? now : time;
  return Object.freeze({time: clampedTime, basis, clamped: clampedTime !== time});
}
