/**
 * kits/input-history/playback.ts: scripted input playback for tests, demos and attract mode.
 *
 * A timeline of action events (press, release, tap, axis value) at ticks is played one fixed tick per `step` into an
 * `InputSource`, the same shape `ctx.input` has, so systems read scripted actions exactly as they read a player's:
 * through `testScene({ input: playback.source })` in a test, or through `playback.over(ctx.input)` in a running
 * scene. Playback is deterministic per tick, may loop, and cancels itself on real user input when `step` is given the
 * live input to watch (an attract mode exits when the user touches anything). `timelineFromHistory` converts an
 * input-history recording into a timeline, so a recorded session can be played back and recorded again unchanged.
 *
 * Owns no clock, device, timer or global service: the caller decides when a tick happens.
 */
import type {InputSource, InputState} from '../../author';
import type {InputHistory} from './types';

export const PLAYBACK_LIMITS = Object.freeze({
  /** Largest `maxEvents`. */
  events: 65_536,
  /** Longest timeline, ticks (one hour at 60 Hz). */
  ticks: 216_000,
  /** Most distinct actions in a timeline, and most watched actions. */
  actions: 64,
  /** Action id length. */
  idLength: 64,
});

/** One timeline event, at a tick (or at `t` seconds, rounded to the nearest tick of `step`). */
export type PlaybackEvent = (
  | Readonly<{action: string; kind: 'press' | 'release' | 'tap'}>
  | Readonly<{action: string; kind: 'axis'; value: number}>
) &
  (Readonly<{tick: number; t?: undefined}> | Readonly<{t: number; tick?: undefined}>);

export interface PlaybackOptions {
  /**
   * Events in any order; within one tick they apply in the given order. `press` holds until `release`; `tap` is
   * pressed and held for its tick only; `axis` sets a value in [-1, 1] until changed. An action is either a button
   * or an axis, never both. A `press` and `release` in the same tick is a tap.
   */
  readonly events: readonly PlaybackEvent[];
  /** Ticks in the timeline, at least the last event's tick + 1 (default exactly that), at most 216,000. */
  readonly length?: number;
  /** Start again from tick 0 (all released) after the last tick (default false). */
  readonly loop?: boolean;
  /** Seconds per tick for events given in `t` (default 1/60, the fixed step). */
  readonly step?: number;
  /** Most events, 1..65,536 (default 4096); more throws RangeError. */
  readonly maxEvents?: number;
  /** Live actions that cancel playback when held, pressed or (axis) beyond `deadzone` (default: the timeline's). */
  readonly watch?: readonly string[];
  /** |axis| above this counts as input, [0, 1) (default 0.2). */
  readonly deadzone?: number;
  /** A live pointer press or held pointer also cancels (default true). */
  readonly watchPointer?: boolean;
}

export type PlaybackStatus = 'ready' | 'playing' | 'finished' | 'cancelled';
export type PlaybackStep = Readonly<{
  status: PlaybackStatus;
  /** The tick now current (-1 before the first step; the last played tick after the end). */
  tick: number;
  /** Completed loops. */
  loops: number;
  /** Why playback ended early: 'input' (live input seen) or the caller's reason. Null otherwise. */
  reason: string | null;
}>;

export interface InputPlayback {
  /** The scripted input alone: the current tick's actions; idle before the first step and after the end. */
  readonly source: InputSource;
  /**
   * Scripted while ready or playing, `live` once finished or cancelled (the cancelling input reaches systems on the
   * same tick). `describe` always reads `live`.
   */
  over(live: InputSource): InputState;
  /**
   * Advance one tick. With `live`, any watched live input first cancels playback (status 'cancelled', reason
   * 'input', every scripted action released). After the last tick: loop, or 'finished' with everything released.
   */
  step(live?: InputSource): PlaybackStep;
  /** End playback now (idempotent), releasing every scripted action. */
  cancel(reason?: string): PlaybackStep;
  /** Back to 'ready' at tick -1 with nothing held. */
  restart(): void;
  state(): PlaybackStep;
  /** Ticks in the timeline. */
  readonly length: number;
}

interface Compiled {
  readonly tick: number;
  readonly action: string;
  readonly kind: 'press' | 'release' | 'tap' | 'axis';
  readonly value: number;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
function fail(message: string): never {
  throw new RangeError(`input playback: ${message}`);
}
const validId = (id: unknown): id is string =>
  typeof id === 'string' && id.length >= 1 && id.length <= PLAYBACK_LIMITS.idLength;
const IDLE_POINTER = Object.freeze({x: 0, y: 0, down: false, pressed: false});

export function createInputPlayback(options: PlaybackOptions): InputPlayback {
  if (options === null || typeof options !== 'object') fail('options must be an object');
  const maxEvents = options.maxEvents ?? 4096;
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > PLAYBACK_LIMITS.events)
    fail('maxEvents must be an integer in 1..65536');
  const step = options.step ?? 1 / 60;
  if (!finite(step) || step <= 0 || step > 1) fail('step must be in (0, 1] seconds');
  const input = options.events;
  if (!Array.isArray(input)) fail('events must be an array');
  if (input.length > maxEvents) fail(`${input.length} events exceed maxEvents ${maxEvents}`);
  const kindOf = new Map<string, 'button' | 'axis'>();
  const compiled: Compiled[] = input.map((e: PlaybackEvent, i) => {
    if (e === null || typeof e !== 'object') fail(`event ${i} must be an object`);
    if (!validId(e.action)) fail(`event ${i}: action must be 1..64 characters`);
    let tick: number;
    if (e.tick !== undefined) {
      if (e.t !== undefined) fail(`event ${i}: give tick or t, not both`);
      tick = e.tick;
    } else {
      if (!finite(e.t) || e.t < 0) fail(`event ${i}: t must be finite and >= 0`);
      tick = Math.round(e.t / step);
    }
    if (!Number.isSafeInteger(tick) || tick < 0 || tick >= PLAYBACK_LIMITS.ticks)
      fail(`event ${i}: tick must be an integer in 0..${PLAYBACK_LIMITS.ticks - 1}`);
    const kind = e.kind;
    if (kind !== 'press' && kind !== 'release' && kind !== 'tap' && kind !== 'axis')
      fail(`event ${i}: unknown kind '${String(kind)}'`);
    let value = 0;
    if (e.kind === 'axis') {
      value = e.value;
      if (!finite(value) || value < -1 || value > 1) fail(`event ${i}: axis value must be in [-1, 1]`);
    }
    const role = kind === 'axis' ? 'axis' : 'button';
    const known = kindOf.get(e.action);
    if (known && known !== role) fail(`action '${e.action}' is used as both a button and an axis`);
    kindOf.set(e.action, role);
    if (kindOf.size > PLAYBACK_LIMITS.actions) fail('more than 64 distinct actions');
    return Object.freeze({tick, action: e.action, kind, value});
  });
  // Stable by tick: within a tick the given order is kept.
  const events = compiled.map((e, i) => ({e, i})).sort((a, b) => a.e.tick - b.e.tick || a.i - b.i);
  const ordered = Object.freeze(events.map(x => x.e));
  const lastTick = ordered.length ? ordered[ordered.length - 1]!.tick : -1;
  const length = options.length ?? Math.max(1, lastTick + 1);
  if (!Number.isSafeInteger(length) || length < Math.max(1, lastTick + 1) || length > PLAYBACK_LIMITS.ticks)
    fail(`length must be an integer in ${Math.max(1, lastTick + 1)}..${PLAYBACK_LIMITS.ticks}`);
  const loop = options.loop ?? false;
  if (typeof loop !== 'boolean') fail('loop must be a boolean');
  const watchIn = options.watch ?? [...kindOf.keys()];
  if (!Array.isArray(watchIn) || watchIn.length > PLAYBACK_LIMITS.actions || !watchIn.every(validId))
    fail('watch must be at most 64 action ids');
  const watch = Object.freeze([...new Set(watchIn)]);
  const deadzone = options.deadzone ?? 0.2;
  if (!finite(deadzone) || deadzone < 0 || deadzone >= 1) fail('deadzone must be in [0, 1)');
  const watchPointer = options.watchPointer ?? true;
  if (typeof watchPointer !== 'boolean') fail('watchPointer must be a boolean');

  const held = new Set<string>(),
    pressed = new Set<string>(),
    tapped = new Set<string>(),
    axes = new Map<string, number>();
  let status: PlaybackStatus = 'ready',
    tick = -1,
    loops = 0,
    next = 0,
    reason: string | null = null;
  let current: PlaybackStep = snapshot();

  function snapshot(): PlaybackStep {
    return Object.freeze({status, tick, loops, reason});
  }
  function clear() {
    held.clear();
    pressed.clear();
    tapped.clear();
    axes.clear();
  }
  function end(to: 'finished' | 'cancelled', why: string | null): PlaybackStep {
    clear();
    status = to;
    reason = why;
    return (current = snapshot());
  }
  function liveActive(live: InputSource): boolean {
    for (const id of watch) {
      if (live.held(id) || live.pressed(id)) return true;
      if (Math.abs(live.axis(id)) > deadzone) return true;
    }
    return watchPointer && (live.pointer.down || live.pointer.pressed);
  }
  const playing = () => status === 'ready' || status === 'playing';

  const source: InputSource = Object.freeze({
    describe: () => null,
    pressed: (id: string) => pressed.has(id),
    pressedAt: () => null,
    held: (id: string) => held.has(id) || tapped.has(id),
    axis: (id: string) => axes.get(id) ?? 0,
    pointer: IDLE_POINTER,
  });

  return Object.freeze({
    source,
    length,
    over(live: InputSource): InputState {
      return Object.freeze({
        describe: (id: string) => live.describe(id),
        pressed: (id: string) => (playing() ? source.pressed(id) : live.pressed(id)),
        pressedAt: (id: string) => (playing() ? null : (live.pressedAt?.(id) ?? null)),
        held: (id: string) => (playing() ? source.held(id) : live.held(id)),
        axis: (id: string) => (playing() ? source.axis(id) : live.axis(id)),
        get pointer() {
          return playing() ? IDLE_POINTER : live.pointer;
        },
      });
    },
    step(live?: InputSource): PlaybackStep {
      if (!playing()) return current;
      if (live && liveActive(live)) return end('cancelled', 'input');
      let at = tick + 1;
      if (at >= length) {
        if (!loop) {
          tick = length - 1;
          return end('finished', null);
        }
        at = 0;
        loops++;
        next = 0;
        clear();
      }
      pressed.clear();
      tapped.clear();
      for (; next < ordered.length && ordered[next]!.tick === at; next++) {
        const e = ordered[next]!;
        if (e.kind === 'axis') axes.set(e.action, e.value);
        else if (e.kind === 'release') {
          if (pressed.has(e.action)) tapped.add(e.action); // pressed and released in one tick: a tap
          held.delete(e.action);
        } else {
          if (!held.has(e.action) && !tapped.has(e.action)) pressed.add(e.action);
          if (e.kind === 'press') held.add(e.action);
          else tapped.add(e.action);
        }
      }
      tick = at;
      status = 'playing';
      return (current = snapshot());
    },
    cancel(why = 'cancelled'): PlaybackStep {
      if (!playing()) return current;
      return end('cancelled', String(why));
    },
    restart() {
      clear();
      status = 'ready';
      tick = -1;
      loops = 0;
      next = 0;
      reason = null;
      current = snapshot();
    },
    state: () => current,
  });
}

/**
 * Convert retained input-history frames into a playback timeline (tick 0 = `from`, default the oldest retained
 * frame; `to` default the latest). Actions already held at `from` become presses at tick 0. Played back one tick per
 * recorded frame and sampled with `sampleActions`, it records the same cleaned held masks again. Consumption marks
 * are game decisions and are not part of the timeline.
 */
export function timelineFromHistory(
  history: InputHistory,
  range: {from?: number; to?: number} = {},
): {events: PlaybackEvent[]; length: number} {
  if (history.latest() < 0) fail('the history is empty');
  const from = range.from ?? history.oldest(),
    to = range.to ?? history.latest();
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < history.oldest() || to > history.latest())
    fail('from and to must be retained frames');
  if (to < from) fail('to must not be before from');
  const events: PlaybackEvent[] = [];
  for (let f = from; f <= to; f++) {
    for (const action of history.actions) {
      const tick = f - from;
      if (f === from ? history.held(action, f) : history.pressed(action, f)) events.push({tick, action, kind: 'press'});
      else if (f !== from && history.released(action, f)) events.push({tick, action, kind: 'release'});
    }
  }
  return {events, length: to - from + 1};
}
