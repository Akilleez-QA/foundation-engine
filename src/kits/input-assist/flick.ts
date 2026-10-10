/**
 * kits/input-assist/flick.ts: flick detection over a stream of 2D action samples (a stick or pointer value with a
 * timestamp), as a small bounded state machine.
 *
 * A flick is a fast excursion: the value leaves the centre zone, reaches `threshold` within `maxDuration` of the
 * last centre sample, and (with `confirm: 'release'`, the default) returns inside `releaseRadius` within `maxHold`
 * of the crossing. `confirm: 'cross'` reports at the crossing instead (lower latency; a push-and-hold also reports).
 * A slow drag, a held push and every reported flick disarm the detector until the value comes back within
 * `rearmRadius` (hysteresis: noise around the centre cannot re-trigger, and one excursion reports at most once).
 *
 * Samples are processed online in O(1); only the last `historySize` flicks are kept. Time is the caller's (seconds,
 * non-decreasing); nothing reads a clock or a device. Directions assume +y is up: flip y for a y-down source.
 */
import {scalarMath, type ScalarMathMode} from '../../author';

export const FLICK_LIMITS = Object.freeze({
  /** Largest accepted |x| or |y| of a sample (square-gate sticks exceed 1 on diagonals). */
  axis: 2,
  /** Largest `threshold`. */
  threshold: 1.5,
  /** Largest `maxDuration` and `maxHold`, seconds. */
  seconds: 5,
  /** Largest `historySize`. */
  history: 256,
});

/** 8-way names by `dir8` index (0 = +x, counter-clockwise, +y up). `dir4` indexes the even entries / 2. */
export const FLICK_DIRECTIONS_8 = Object.freeze([
  'right',
  'up-right',
  'up',
  'up-left',
  'left',
  'down-left',
  'down',
  'down-right',
] as const);
export const FLICK_DIRECTIONS_4 = Object.freeze(['right', 'up', 'left', 'down'] as const);

export interface FlickOptions {
  /** Leaving this radius starts the timing; (0, threshold) (default 0.3). */
  readonly centreRadius?: number;
  /** Magnitude a flick must reach; (centreRadius, 1.5] (default 0.85). */
  readonly threshold?: number;
  /** Most seconds from the last centre sample to the threshold crossing; (0, 5] (default 0.12). */
  readonly maxDuration?: number;
  /** `'release'` (default) reports on the return to centre; `'cross'` at the threshold crossing. */
  readonly confirm?: 'release' | 'cross';
  /** With `confirm: 'release'`, the return counts inside this radius; (0, threshold) (default centreRadius). */
  readonly releaseRadius?: number;
  /** With `confirm: 'release'`, most seconds from crossing to return; (0, 5] (default 0.25). */
  readonly maxHold?: number;
  /** The detector re-arms only inside this radius; [0, centreRadius] (default 0.8 × centreRadius). */
  readonly rearmRadius?: number;
  /** Recent flicks kept, 1..256 (default 8). */
  readonly historySize?: number;
  readonly math?: ScalarMathMode;
}

export interface Flick {
  /** Ordinal since construction or `reset`, from 1. */
  readonly n: number;
  /** Time of the last centre sample before the excursion, of the threshold crossing, and of the report. */
  readonly start: number;
  readonly crossed: number;
  readonly t: number;
  /** Direction of the peak sample, radians in (-π, π], 0 = +x, counter-clockwise. */
  readonly angle: number;
  /** Quantised direction: index into FLICK_DIRECTIONS_4 / FLICK_DIRECTIONS_8. */
  readonly dir4: number;
  readonly dir8: number;
  /** Peak magnitude of the excursion, and peak / (crossed - start) in magnitude units per second (Infinity at 0 s). */
  readonly magnitude: number;
  readonly speed: number;
}

export type FlickPhase = 'disarmed' | 'armed' | 'leaving' | 'out';

export type FlickSampleResult =
  | Readonly<{status: 'flick'; flick: Flick}>
  /** `none`: accepted, nothing reported. `stale`: earlier than the last sample. `invalid`: non-finite or out of range. */
  | Readonly<{status: 'none' | 'stale' | 'invalid'}>;

export interface FlickDetector {
  readonly options: Readonly<Required<FlickOptions>>;
  /** Feed one sample. A refused sample (`stale`, `invalid`) changes nothing. */
  sample(t: number, x: number, y: number): FlickSampleResult;
  phase(): FlickPhase;
  /** Recent flicks, oldest first, at most `historySize`. */
  recent(): readonly Flick[];
  /** Forget state and history; the next sample must be inside `rearmRadius` to arm. */
  reset(): void;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
function fail(message: string): never {
  throw new RangeError(`flick: ${message}`);
}
function between(value: unknown, name: string, lo: number, hi: number, loOpen: boolean, hiOpen: boolean): number {
  if (!finite(value) || (loOpen ? value <= lo : value < lo) || (hiOpen ? value >= hi : value > hi))
    fail(`${name} must be in ${loOpen ? '(' : '['}${lo}, ${hi}${hiOpen ? ')' : ']'} (got ${String(value)})`);
  return value;
}

const NONE: FlickSampleResult = Object.freeze({status: 'none'});
const STALE: FlickSampleResult = Object.freeze({status: 'stale'});
const INVALID: FlickSampleResult = Object.freeze({status: 'invalid'});

export function createFlickDetector(options: FlickOptions = {}): FlickDetector {
  if (options === null || typeof options !== 'object') fail('options must be an object');
  const threshold = between(options.threshold ?? 0.85, 'threshold', 0, FLICK_LIMITS.threshold, true, false);
  const centre = between(options.centreRadius ?? 0.3, 'centreRadius', 0, threshold, true, true);
  const maxDuration = between(options.maxDuration ?? 0.12, 'maxDuration', 0, FLICK_LIMITS.seconds, true, false);
  const confirm = options.confirm ?? 'release';
  if (confirm !== 'release' && confirm !== 'cross') fail(`confirm must be 'release' or 'cross'`);
  const release = between(options.releaseRadius ?? centre, 'releaseRadius', 0, threshold, true, true);
  const maxHold = between(options.maxHold ?? 0.25, 'maxHold', 0, FLICK_LIMITS.seconds, true, false);
  const rearm = between(options.rearmRadius ?? centre * 0.8, 'rearmRadius', 0, centre, false, false);
  const historySize = between(options.historySize ?? 8, 'historySize', 1, FLICK_LIMITS.history, false, false);
  if (!Number.isInteger(historySize)) fail('historySize must be an integer');
  const mathMode = options.math ?? 'platform';
  const m = scalarMath(mathMode);
  const frozen = Object.freeze({
    centreRadius: centre,
    threshold,
    maxDuration,
    confirm,
    releaseRadius: release,
    maxHold,
    rearmRadius: rearm,
    historySize,
    math: mathMode,
  });

  let phase: FlickPhase = 'disarmed',
    last = -Infinity,
    centreAt = 0,
    crossAt = 0,
    peak = 0,
    peakX = 0,
    peakY = 0,
    count = 0;
  const history: Flick[] = [];

  const quantise = (angle: number, ways: number) => {
    const i = Math.round(angle / ((2 * Math.PI) / ways)) % ways;
    return i < 0 ? i + ways : i;
  };
  function report(t: number): FlickSampleResult {
    const angle = m.atan2(peakY, peakX),
      span = crossAt - centreAt;
    const flick: Flick = Object.freeze({
      n: ++count,
      start: centreAt,
      crossed: crossAt,
      t,
      angle,
      dir4: quantise(angle, 4),
      dir8: quantise(angle, 8),
      magnitude: peak,
      speed: span > 0 ? peak / span : Infinity,
    });
    history.push(flick);
    if (history.length > historySize) history.shift();
    return Object.freeze({status: 'flick', flick});
  }

  function sample(t: number, x: number, y: number): FlickSampleResult {
    if (!finite(t) || !finite(x) || !finite(y) || Math.abs(x) > FLICK_LIMITS.axis || Math.abs(y) > FLICK_LIMITS.axis)
      return INVALID;
    if (t < last) return STALE;
    last = t;
    const mag = m.hypot(x, y);
    const track = () => {
      if (mag > peak) {
        peak = mag;
        peakX = x;
        peakY = y;
      }
    };
    switch (phase) {
      case 'disarmed':
        if (mag <= rearm) {
          phase = 'armed';
          centreAt = t;
        }
        return NONE;
      case 'armed':
      case 'leaving':
        if (mag <= centre) {
          phase = 'armed';
          centreAt = t;
          return NONE;
        }
        if (t - centreAt > maxDuration) {
          phase = 'disarmed'; // too slow: a drag, not a flick
          return NONE;
        }
        if (phase === 'armed') {
          phase = 'leaving';
          peak = 0;
        }
        track();
        if (mag < threshold) return NONE;
        crossAt = t;
        if (confirm === 'cross') {
          phase = 'disarmed';
          return report(t);
        }
        phase = 'out';
        return NONE;
      case 'out':
        if (t - crossAt > maxHold) {
          phase = mag <= rearm ? 'armed' : 'disarmed'; // held too long: a push, not a flick
          if (phase === 'armed') centreAt = t;
          return NONE;
        }
        track();
        if (mag > release) return NONE;
        const flick = report(t);
        if (mag <= rearm) {
          phase = 'armed';
          centreAt = t;
        } else phase = 'disarmed';
        return flick;
    }
  }

  return Object.freeze({
    options: frozen,
    sample,
    phase: () => phase,
    recent: () => Object.freeze(history.slice()),
    reset() {
      phase = 'disarmed';
      last = -Infinity;
      count = 0;
      history.length = 0;
    },
  });
}
