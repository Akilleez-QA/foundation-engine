/**
 * Time of day, weather and HUD counters: pure, deterministic helpers driven by the caller's simulation time.
 * - A day clock maps game time to a time of day (0..1) with a creator-chosen day length.
 * - Cyclic keyframe curves sample numbers and colours over the day (sun angle, light colour, haze, exposure).
 * - A weather director blends named weather states over seconds and exposes numeric parameters for fog, particles,
 *   wind and lighting hooks.
 * - A roll-up animates a displayed counter toward its true value at a bounded rate.
 * None of them writes the scene: the creator applies the values (e.g. to `ctx.view.environment`).
 */

const fail = (message: string): never => {
  throw new RangeError(`presentation: ${message}`);
};
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e12;

// ---------------------------------------------------------------------------------------------- Day clock

export interface DayClock {
  readonly dayLength: number;
  /** Time of day in [0, 1) at simulation time `t` (0 = midnight, 0.5 = noon by convention). */
  timeOfDay(t: number): number;
  /** Whole days elapsed at `t` (can be negative before the origin). */
  day(t: number): number;
  /** The simulation time at which time of day `fraction` next occurs at or after `t`. */
  nextAt(t: number, fraction: number): number;
}

/** `dayLength` simulation seconds per day (1 to 1e7); `startFraction` is the time of day at t = 0 (default 0.25). */
export function createDayClock(options: {readonly dayLength: number; readonly startFraction?: number}): DayClock {
  if (typeof options !== 'object' || options === null) fail('options must be an object');
  const {dayLength} = options;
  const start = options.startFraction ?? 0.25;
  if (!finite(dayLength) || dayLength < 1 || dayLength > 1e7) fail('dayLength must be in [1, 1e7] seconds');
  if (!finite(start) || start < 0 || start >= 1) fail('startFraction must be in [0, 1)');
  const t0 = (t: unknown): number => (finite(t) ? t : fail('time must be finite'));
  const position = (t: number) => t0(t) / dayLength + start;
  const clock: DayClock = {
    dayLength,
    timeOfDay: t => {
      const p = position(t);
      const f = p - Math.floor(p);
      return f >= 1 ? 0 : f;
    },
    day: t => Math.floor(position(t)),
    nextAt(t, fraction) {
      if (!finite(fraction) || fraction < 0 || fraction >= 1) fail('fraction must be in [0, 1)');
      const p = position(t);
      let target = Math.floor(p) + fraction;
      if (target < p - 1e-12) target += 1;
      return (target - start) * dayLength;
    },
  };
  return Object.freeze(clock);
}

// ---------------------------------------------------------------------------------------------- Curves

export type CurveValue = number | readonly number[];
export interface CurveKey<V extends CurveValue> {
  /** Position in [0, 1). */
  readonly at: number;
  readonly value: V;
}

/**
 * A cyclic keyframe curve over [0, 1) (wrapping from the last key to the first), sampled with linear or smoothstep
 * interpolation. Values are numbers or fixed-length number tuples (e.g. RGB in 0..1). 1 to 64 keys, strictly
 * increasing `at`.
 */
export function createCycleCurve<V extends CurveValue>(
  keys: readonly CurveKey<V>[],
  options: {readonly interpolation?: 'linear' | 'smooth'} = {},
): (at: number) => V {
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 64) fail('a curve needs 1 to 64 keys');
  const interpolation = options.interpolation ?? 'linear';
  if (interpolation !== 'linear' && interpolation !== 'smooth') fail('interpolation must be linear or smooth');
  const width = Array.isArray(keys[0]!.value) ? (keys[0]!.value as readonly number[]).length : -1;
  if (width === 0 || width > 16) fail('tuple values need 1 to 16 numbers');
  const captured = keys.map((k, i) => {
    if (typeof k !== 'object' || k === null) fail('keys must be objects');
    const {at, value} = k;
    if (!finite(at) || at < 0 || at >= 1) fail('key positions must be in [0, 1)');
    if (i > 0 && at <= keys[i - 1]!.at) fail('key positions must strictly increase');
    if (width < 0) {
      if (!finite(value)) fail('values must be finite numbers');
      return {at, v: [value as number]};
    }
    if (!Array.isArray(value) || value.length !== width || !value.every(finite))
      fail('tuple values must match in size');
    return {at, v: [...(value as readonly number[])]};
  });
  const out = (v: number[]) => (width < 0 ? v[0]! : Object.freeze(v)) as V;
  return (x: number) => {
    if (!finite(x)) fail('curve position must be finite');
    const p = x - Math.floor(x);
    if (captured.length === 1) return out(captured[0]!.v.slice());
    let i = captured.length - 1;
    for (let k = 0; k < captured.length; k++) if (captured[k]!.at <= p) i = k;
    const a = captured[i]!,
      b = captured[(i + 1) % captured.length]!;
    let span = b.at - a.at,
      d = p - a.at;
    if (span <= 0) span += 1;
    if (d < 0) d += 1;
    let f = Math.min(1, Math.max(0, d / span));
    if (interpolation === 'smooth') f = f * f * (3 - 2 * f);
    return out(a.v.map((va, j) => va + (b.v[j]! - va) * f));
  };
}

/** Pack an RGB tuple in 0..1 into a 0xRRGGBB number for environment colours. */
export function rgbToHex(rgb: readonly number[]): number {
  if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every(finite)) fail('rgb must be three numbers');
  const c = rgb.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255));
  return (c[0]! << 16) | (c[1]! << 8) | c[2]!;
}

// ---------------------------------------------------------------------------------------------- Weather

export interface WeatherDirectorOptions {
  /** Parameter names in a fixed order (1-32), e.g. ['fogDensity', 'rainRate', 'wind', 'sunDim']. */
  readonly params: readonly string[];
  /** Named weather states (1-32) giving every parameter a value; missing parameters are 0. */
  readonly states: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly initial: string;
}

export interface WeatherSample {
  /** Parameter values in `params` order and by name. */
  readonly values: readonly number[];
  readonly named: Readonly<Record<string, number>>;
  /** The state blended toward, and blend progress 0..1 (1 when settled). */
  readonly state: string;
  readonly progress: number;
}

/**
 * Blends between weather states over a chosen duration with smoothstep easing. A change requested mid-blend
 * starts from the values currently shown, so there is never a jump. `sample(now)` returns the values to apply.
 */
export function createWeatherDirector(options: WeatherDirectorOptions) {
  if (typeof options !== 'object' || options === null) fail('options must be an object');
  const params = options.params;
  if (!Array.isArray(params) || params.length < 1 || params.length > 32) fail('params must list 1-32 names');
  const names: string[] = [];
  for (const p of params) {
    if (typeof p !== 'string' || p.length < 1 || p.length > 64 || names.includes(p)) fail('param names must be unique');
    names.push(p);
  }
  const entries = Object.entries(options.states ?? {});
  if (entries.length < 1 || entries.length > 32) fail('states must define 1-32 states');
  const states = new Map<string, number[]>();
  for (const [name, values] of entries) {
    if (typeof values !== 'object' || values === null) fail(`state ${name} must be an object`);
    const v: Record<string, unknown> = {...values};
    for (const key of Object.keys(v)) if (!names.includes(key)) fail(`state ${name} names unknown param ${key}`);
    states.set(
      name,
      names.map(n => {
        const x = v[n] ?? 0;
        return finite(x) ? x : fail(`state ${name} param ${n} must be finite`);
      }),
    );
  }
  if (!states.has(options.initial)) fail('initial must name a state');
  let target = options.initial;
  let from = states.get(target)!.slice();
  let start = 0,
    duration = 0;
  let last = -Infinity;
  const time = (t: unknown): number => {
    if (!finite(t) || t < last) return fail('time must be finite and nondecreasing');
    last = t;
    return t;
  };
  const valuesAt = (t: number): {values: number[]; progress: number} => {
    const to = states.get(target)!;
    const f = duration === 0 ? 1 : Math.min(1, Math.max(0, (t - start) / duration));
    if (f >= 1) return {values: to.slice(), progress: 1};
    const e = f * f * (3 - 2 * f);
    return {values: to.map((v, i) => from[i]! + (v - from[i]!) * e), progress: f};
  };
  return {
    get state() {
      return target;
    },
    /** Blend to `state` over `seconds` (0 to 3600; 0 = immediately) starting now from the values shown now. */
    set(state: string, now: number, seconds: number): void {
      if (!states.has(state)) fail(`unknown weather state ${state}`);
      if (!finite(seconds) || seconds < 0 || seconds > 3600) fail('seconds must be in [0, 3600]');
      const t = time(now);
      from = valuesAt(t).values;
      target = state;
      start = t;
      duration = seconds;
    },
    sample(now: number): WeatherSample {
      const t = time(now);
      const {values, progress} = valuesAt(t);
      return Object.freeze({
        values: Object.freeze(values),
        named: Object.freeze(Object.fromEntries(names.map((n, i) => [n, values[i]!]))),
        state: target,
        progress,
      });
    },
  };
}
export type WeatherDirector = ReturnType<typeof createWeatherDirector>;

// ---------------------------------------------------------------------------------------------- Roll-up

/**
 * A HUD counter that rolls toward its true value: it covers the remaining difference in at most `maxSeconds`
 * (default 0.6) and at least `minRate` units per second (default 30), stepping in whole units, and snaps when the
 * true value decreases if `snapDown` (default true). `update(target, dt)` returns the integer to display.
 */
export function createRollup(
  options: {
    readonly maxSeconds?: number;
    readonly minRate?: number;
    readonly snapDown?: boolean;
    readonly initial?: number;
  } = {},
) {
  const maxSeconds = options.maxSeconds ?? 0.6,
    minRate = options.minRate ?? 30,
    snapDown = options.snapDown ?? true;
  if (!finite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 60) fail('maxSeconds must be in (0, 60]');
  if (!finite(minRate) || minRate <= 0) fail('minRate must be positive');
  if (typeof snapDown !== 'boolean') fail('snapDown must be a boolean');
  let shown = options.initial ?? 0;
  if (!Number.isSafeInteger(shown)) fail('initial must be a safe integer');
  let precise = shown;
  let rate = 0;
  let lastTarget = shown;
  return {
    get shown() {
      return shown;
    },
    /** Whether the displayed value still differs from the last target. */
    get rolling() {
      return shown !== lastTarget;
    },
    update(targetValue: number, dt: number): number {
      if (!Number.isSafeInteger(targetValue)) fail('target must be a safe integer');
      if (!finite(dt) || dt < 0 || dt > 10) fail('dt must be in [0, 10] seconds');
      if (targetValue !== lastTarget) {
        lastTarget = targetValue;
        rate = Math.max(minRate, Math.abs(targetValue - precise) / maxSeconds);
      }
      if (targetValue < precise && snapDown) precise = targetValue;
      else {
        const step = rate * dt;
        precise = targetValue > precise ? Math.min(targetValue, precise + step) : Math.max(targetValue, precise - step);
      }
      shown = targetValue > shown ? Math.floor(precise) : Math.ceil(precise);
      if (Math.abs(precise - targetValue) < 1e-9) shown = targetValue;
      return shown;
    },
    /** Jump straight to a value (e.g. on scene entry). */
    set(value: number): void {
      if (!Number.isSafeInteger(value)) fail('value must be a safe integer');
      shown = precise = lastTarget = value;
    },
  };
}
export type Rollup = ReturnType<typeof createRollup>;
