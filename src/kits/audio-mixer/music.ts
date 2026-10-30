/**
 * Adaptive music: a quantized musical clock (tempo, meter, phrase length) and a director that layers stems by named
 * states and intensity, changing state only on beat, bar or phrase boundaries with a beat-based fade. Pure: the
 * creator starts the stems together (e.g. `ctx.playMusic(stem, {at, loop})` with one shared `at`) and applies the
 * gains the director returns to each voice (`voice.setGain(g)`). Time is any one monotonic timebase in seconds
 * (audio-context time from `ctx.audioClock()` or a song's `songTime`).
 */
export type Quantum = 'beat' | 'bar' | 'phrase';

const fail = (message: string): never => {
  throw new RangeError(`audio-mixer: ${message}`);
};
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9;

export interface MusicClock {
  readonly bpm: number;
  readonly beatsPerBar: number;
  readonly barsPerPhrase: number;
  /** Time of beat 0. */
  readonly origin: number;
  /** Beats since the origin (fractional; negative before it). */
  beatAt(time: number): number;
  /** The time of a beat number. */
  timeOfBeat(beat: number): number;
  /** The first boundary of `quantum` at or after `time` (strictly after when `strict`). */
  next(time: number, quantum: Quantum, strict?: boolean): number;
  /** Position at `time`: whole bar, beat in bar and phrase indices. */
  position(time: number): {readonly bar: number; readonly beat: number; readonly phrase: number};
}

export function createMusicClock(options: {
  readonly bpm: number;
  readonly beatsPerBar?: number;
  readonly barsPerPhrase?: number;
  readonly origin: number;
}): MusicClock {
  if (typeof options !== 'object' || options === null) fail('options must be an object');
  const {bpm, origin} = options;
  const beatsPerBar = options.beatsPerBar ?? 4,
    barsPerPhrase = options.barsPerPhrase ?? 4;
  if (!finite(bpm) || bpm < 20 || bpm > 400) fail('bpm must be in [20, 400]');
  if (!Number.isSafeInteger(beatsPerBar) || beatsPerBar < 1 || beatsPerBar > 32) fail('beatsPerBar must be 1-32');
  if (!Number.isSafeInteger(barsPerPhrase) || barsPerPhrase < 1 || barsPerPhrase > 64)
    fail('barsPerPhrase must be 1-64');
  if (!finite(origin)) fail('origin must be finite');
  const spb = 60 / bpm;
  const span: Record<Quantum, number> = {beat: 1, bar: beatsPerBar, phrase: beatsPerBar * barsPerPhrase};
  const time = (t: unknown) => (finite(t) ? t : fail('time must be finite'));
  const clock: MusicClock = {
    bpm,
    beatsPerBar,
    barsPerPhrase,
    origin,
    beatAt: t => (time(t) - origin) / spb,
    timeOfBeat: b => origin + time(b) * spb,
    next(t, quantum, strict = false) {
      const n = span[quantum] ?? fail('quantum must be beat, bar or phrase');
      const beats = (time(t) - origin) / spb;
      // A boundary within 1e-9 beats of `t` counts as now, so rounding never skips a whole bar.
      let k = Math.ceil(beats / n - 1e-9);
      if (strict && origin + k * n * spb <= t) k++;
      return origin + k * n * spb;
    },
    position(t) {
      const beat = Math.floor((time(t) - origin) / spb + 1e-9);
      const bar = Math.floor(beat / beatsPerBar);
      return Object.freeze({bar, beat: beat - bar * beatsPerBar, phrase: Math.floor(bar / barsPerPhrase)});
    },
  };
  return Object.freeze(clock);
}

export interface MusicState {
  /** Stem gains in [0, 1]; stems not listed are silent. */
  readonly stems: Readonly<Record<string, number>>;
  /** Lowest intensity that selects this state. Only states with a `minIntensity` take part in `setIntensity`. */
  readonly minIntensity?: number;
}

export interface MusicDirectorOptions {
  readonly clock: MusicClock;
  /** Stem names in a fixed order (1-16). */
  readonly stems: readonly string[];
  /** Named states (1-32). */
  readonly states: Readonly<Record<string, MusicState>>;
  readonly initial: string;
  /** Boundary transitions wait for (default 'bar') and fade length in beats (default 2, 0 = cut). */
  readonly quantum?: Quantum;
  readonly fadeBeats?: number;
  /** Intensity hysteresis: leaving a state needs intensity below its minIntensity minus this. Default 0.05. */
  readonly hysteresis?: number;
}

export interface MusicChange {
  readonly kind: 'scheduled' | 'started' | 'settled';
  readonly state: string;
  readonly at: number;
}

export function createMusicDirector(options: MusicDirectorOptions) {
  if (typeof options !== 'object' || options === null) fail('options must be an object');
  const {clock, initial} = options;
  if (typeof clock?.next !== 'function') fail('clock must come from createMusicClock');
  const stemsInput = options.stems;
  if (!Array.isArray(stemsInput) || stemsInput.length < 1 || stemsInput.length > 16) fail('stems must list 1-16 names');
  const stems: string[] = [];
  for (const s of stemsInput) {
    if (typeof s !== 'string' || s.length < 1 || s.length > 64 || stems.includes(s)) fail('stem names must be unique');
    stems.push(s);
  }
  const quantum = options.quantum ?? 'bar',
    fadeBeats = options.fadeBeats ?? 2,
    hysteresis = options.hysteresis ?? 0.05;
  if (!['beat', 'bar', 'phrase'].includes(quantum)) fail('quantum must be beat, bar or phrase');
  if (!finite(fadeBeats) || fadeBeats < 0 || fadeBeats > 64) fail('fadeBeats must be in [0, 64]');
  if (!finite(hysteresis) || hysteresis < 0 || hysteresis > 1) fail('hysteresis must be in [0, 1]');
  const states = new Map<string, {gains: number[]; minIntensity: number}>();
  const entries = Object.entries(options.states ?? {});
  if (entries.length < 1 || entries.length > 32) fail('states must define 1-32 states');
  for (const [name, st] of entries) {
    if (typeof st !== 'object' || st === null) fail(`state ${name} must be an object`);
    const stemGains: Record<string, unknown> = {...(st.stems ?? {})};
    for (const key of Object.keys(stemGains)) if (!stems.includes(key)) fail(`state ${name} names unknown stem ${key}`);
    const gains = stems.map(s => {
      const g = stemGains[s] ?? 0;
      if (!(typeof g === 'number' && g >= 0 && g <= 1)) fail(`state ${name} gain for ${s} must be in [0, 1]`);
      return g as number;
    });
    const minIntensity = st.minIntensity;
    if (minIntensity !== undefined && !finite(minIntensity)) fail(`state ${name} minIntensity must be finite`);
    states.set(name, {gains, minIntensity: minIntensity ?? NaN});
  }
  if (!states.has(initial)) fail('initial must name a state');
  const byIntensity = [...states.entries()]
    .filter(([, st]) => !Number.isNaN(st.minIntensity))
    .sort((a, b) => a[1].minIntensity - b[1].minIntensity);
  const spb = 60 / clock.bpm;

  let current = initial;
  let from = states.get(initial)!.gains.slice();
  let fadeStart = -Infinity,
    fadeEnd = -Infinity;
  let pending: {state: string; at: number} | null = null;
  let lastTime = -Infinity;
  let settledReported = true;

  const gainsAt = (t: number): number[] => {
    const to = states.get(current)!.gains;
    if (t >= fadeEnd) return to.slice();
    if (t < fadeStart) return from.slice();
    const f = (t - fadeStart) / (fadeEnd - fadeStart);
    return to.map((g, i) => from[i]! + (g - from[i]!) * f);
  };
  const check = (t: unknown): number => {
    if (!finite(t) || t < lastTime) return fail('time must be finite and nondecreasing');
    lastTime = t;
    return t;
  };

  const changes: MusicChange[] = [];
  /** Start a pending change whose boundary has passed (so a later request never delays a due change). */
  const advance = (t: number) => {
    if (pending && t >= pending.at) {
      from = gainsAt(pending.at);
      current = pending.state;
      fadeStart = pending.at;
      fadeEnd = pending.at + fadeBeats * spb;
      changes.push(Object.freeze({kind: 'started', state: current, at: pending.at}));
      pending = null;
      settledReported = false;
    }
    if (!settledReported && t >= fadeEnd) {
      settledReported = true;
      changes.push(Object.freeze({kind: 'settled', state: current, at: fadeEnd}));
    }
  };
  const director = {
    get state() {
      return current;
    },
    get pending(): string | null {
      return pending?.state ?? null;
    },
    /**
     * Request a state; it starts on the next `quantum` boundary (strictly after `now`) and fades over `fadeBeats`.
     * A newer request replaces a pending one. Requesting the current state cancels a pending change.
     */
    request(state: string, now: number, o: {readonly quantum?: Quantum} = {}): MusicChange | null {
      if (!states.has(state)) fail(`unknown state ${state}`);
      const t = check(now);
      advance(t);
      if (state === current && !pending) return null;
      if (state === current) {
        pending = null;
        return null;
      }
      const at = clock.next(t, o.quantum ?? quantum, true);
      pending = {state, at};
      return Object.freeze({kind: 'scheduled', state, at});
    },
    /** Choose the state for an intensity (highest minIntensity <= intensity, with hysteresis) and request it. */
    setIntensity(intensity: number, now: number): MusicChange | null {
      if (!finite(intensity)) fail('intensity must be finite');
      if (byIntensity.length === 0) fail('no state has a minIntensity');
      advance(check(now));
      const target = pending?.state ?? current;
      const targetMin = states.get(target)!.minIntensity;
      let choice: string | null = null;
      for (const [name, st] of byIntensity) if (st.minIntensity <= intensity) choice = name;
      // Below every rung: no ladder state applies, so nothing changes.
      if (choice === null) return null;
      // Stay in the current target while intensity is within its hysteresis band below it.
      const chosenMin = states.get(choice)!.minIntensity;
      // A target outside the intensity ladder (NaN) is left as soon as intensity selects a ladder state.
      if (chosenMin < targetMin && intensity >= targetMin - hysteresis) choice = target;
      if (choice === target || (chosenMin === targetMin && !Number.isNaN(targetMin))) return null;
      return director.request(choice, now);
    },
    /**
     * Advance to `now`: start a pending change whose boundary has passed and return the stem gains to apply now,
     * in `stems` order, with the changes that happened.
     */
    pump(now: number): {readonly gains: readonly number[]; readonly changes: readonly MusicChange[]} {
      const t = check(now);
      advance(t);
      const out = changes.splice(0);
      return Object.freeze({gains: Object.freeze(gainsAt(t)), changes: Object.freeze(out)});
    },
    /** Gains as `{stem: gain}` at `now` as of the last pump (read-only: no time check, no transition). */
    named(now: number): Readonly<Record<string, number>> {
      if (!finite(now)) fail('time must be finite');
      const g = gainsAt(now);
      return Object.freeze(Object.fromEntries(stems.map((s, i) => [s, g[i]!])));
    },
  };
  return director;
}
export type MusicDirector = ReturnType<typeof createMusicDirector>;
