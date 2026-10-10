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
import {defineSystem, type InputSource, type InputState, type SystemDefinition} from '../../author';
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
   * pressed for its tick and never held (as a real press released within one tick reads: `pressed` true, `held`
   * false); `axis` sets a value in [-1, 1] until changed. An action is either a button or an axis, never both. A
   * `press` and `release` in the same tick is a tap.
   */
  readonly events: readonly PlaybackEvent[];
  /** Ticks in the timeline, at least the last event's tick + 1 (default exactly that), at most 216,000. */
  readonly length?: number;
  /**
   * Start again after the last tick (default false). The wrap is one rest step (tick -1, everything released), then
   * tick 0: a loop of `length` ticks takes `length + 1` steps, and a held action shows a release before its re-press.
   */
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
  /** The tick now current (-1 before the first step and on a loop's rest step; the last played tick after the end). */
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
   * same tick). `describe` always reads `live`. One view per live source, cached (no allocation per call).
   */
  over(live: InputSource): InputState;
  /**
   * Advance one tick. With `live`, any watched live input first cancels playback (status 'cancelled', reason
   * 'input', every scripted action released). After the last tick: loop, or 'finished' with everything released.
   * `live` must be the raw live input (`ctx.input`); passing this playback's own `source` or an `over()` view throws
   * RangeError (it would read the script as user input and cancel itself).
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
  const count = input.length;
  if (count > maxEvents) fail(`${count} events exceed maxEvents ${maxEvents}`);
  const kindOf = new Map<string, 'button' | 'axis'>();
  const compiled: Compiled[] = [];
  // Each field is read once into a local and only the locals are validated and used (a getter or proxy cannot
  // answer differently between the check and the use); the list is walked by index over its captured length.
  for (let i = 0; i < count; i++) {
    const e: unknown = input[i];
    if (e === null || typeof e !== 'object') fail(`event ${i} must be an object`);
    const {action, kind, tick: tickIn, t, value: valueIn} = e as Record<string, unknown>;
    if (!validId(action)) fail(`event ${i}: action must be 1..64 characters`);
    let tick: unknown;
    if (tickIn !== undefined) {
      if (t !== undefined) fail(`event ${i}: give tick or t, not both`);
      tick = tickIn;
    } else {
      if (!finite(t) || t < 0) fail(`event ${i}: t must be finite and >= 0`);
      tick = Math.round(t / step);
    }
    if (!Number.isSafeInteger(tick) || (tick as number) < 0 || (tick as number) >= PLAYBACK_LIMITS.ticks)
      fail(`event ${i}: tick must be an integer in 0..${PLAYBACK_LIMITS.ticks - 1}`);
    if (kind !== 'press' && kind !== 'release' && kind !== 'tap' && kind !== 'axis')
      fail(`event ${i}: unknown kind '${String(kind)}'`);
    let value = 0;
    if (kind === 'axis') {
      if (!finite(valueIn) || valueIn < -1 || valueIn > 1) fail(`event ${i}: axis value must be in [-1, 1]`);
      value = valueIn;
    }
    const role = kind === 'axis' ? 'axis' : 'button';
    const known = kindOf.get(action);
    if (known && known !== role) fail(`action '${action}' is used as both a button and an axis`);
    kindOf.set(action, role);
    if (kindOf.size > PLAYBACK_LIMITS.actions) fail('more than 64 distinct actions');
    compiled.push(Object.freeze({tick: tick as number, action, kind, value}));
  }
  // Stable by tick: within a tick the given order is kept.
  const events = compiled.map((e, i) => ({e, i})).sort((a, b) => a.e.tick - b.e.tick || a.i - b.i);
  const ordered = Object.freeze(events.map(x => x.e));
  const lastTick = ordered.length ? ordered[ordered.length - 1]!.tick : -1;
  const length = options.length ?? Math.max(1, lastTick + 1);
  if (!Number.isSafeInteger(length) || length < Math.max(1, lastTick + 1) || length > PLAYBACK_LIMITS.ticks)
    fail(`length must be an integer in ${Math.max(1, lastTick + 1)}..${PLAYBACK_LIMITS.ticks}`);
  const loop = options.loop ?? false;
  if (typeof loop !== 'boolean') fail('loop must be a boolean');
  const watchIn: unknown = options.watch ?? [...kindOf.keys()];
  if (!Array.isArray(watchIn)) fail('watch must be an array of action ids');
  const watchCount = watchIn.length,
    watchSet = new Set<string>();
  for (let i = 0; i < watchCount; i++) {
    const id: unknown = watchIn[i];
    if (!validId(id)) fail('watch ids must be 1..64 characters');
    watchSet.add(id);
    if (watchSet.size > PLAYBACK_LIMITS.actions) fail('watch must name at most 64 distinct action ids');
  }
  const watch = Object.freeze([...watchSet]);
  const deadzone = options.deadzone ?? 0.2;
  if (!finite(deadzone) || deadzone < 0 || deadzone >= 1) fail('deadzone must be in [0, 1)');
  const watchPointer = options.watchPointer ?? true;
  if (typeof watchPointer !== 'boolean') fail('watchPointer must be a boolean');

  const held = new Set<string>(),
    pressed = new Set<string>(),
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
    held: (id: string) => held.has(id),
    axis: (id: string) => axes.get(id) ?? 0,
    pointer: IDLE_POINTER,
  });

  // Views are cached per live source (no allocation per call) and remembered so `step` can refuse them.
  const views = new WeakMap<InputSource, InputState>();
  const own = new WeakSet<InputSource>([source]);

  return Object.freeze({
    source,
    length,
    over(live: InputSource): InputState {
      const cached = views.get(live);
      if (cached) return cached;
      const view: InputState = Object.freeze({
        describe: (id: string) => live.describe(id),
        pressed: (id: string) => (playing() ? source.pressed(id) : live.pressed(id)),
        pressedAt: (id: string) => (playing() ? null : (live.pressedAt?.(id) ?? null)),
        held: (id: string) => (playing() ? source.held(id) : live.held(id)),
        axis: (id: string) => (playing() ? source.axis(id) : live.axis(id)),
        get pointer() {
          return playing() ? IDLE_POINTER : live.pointer;
        },
      });
      views.set(live, view);
      own.add(view);
      return view;
    },
    step(live?: InputSource): PlaybackStep {
      if (!playing()) return current;
      if (live !== undefined && own.has(live))
        fail("step(live) needs the raw live input (ctx.input), not this playback's own source or over() view");
      if (live && liveActive(live)) return end('cancelled', 'input');
      pressed.clear();
      if (tick === length - 1) {
        if (!loop) return end('finished', null);
        // The wrap is one rest tick with everything released, so an action held at the end and pressed again at
        // tick 0 shows a release and a fresh press, as a recording of the same session would.
        clear();
        loops++;
        next = 0;
        tick = -1;
        status = 'playing';
        return (current = snapshot());
      }
      const at = tick + 1;
      for (; next < ordered.length && ordered[next]!.tick === at; next++) {
        const e = ordered[next]!;
        if (e.kind === 'axis') axes.set(e.action, e.value);
        else if (e.kind === 'release') held.delete(e.action);
        else {
          if (!held.has(e.action)) pressed.add(e.action);
          if (e.kind === 'press') held.add(e.action);
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
 * recorded frame and sampled with `sampleActions`, it records the same cleaned held masks and press/release edges
 * again (raw-input bookkeeping such as the latest raw press of a losing opposite action may differ). Consumption
 * marks are game decisions and are not part of the timeline.
 *
 * The result carries `maxEvents` (the event count, at least 1), so `createInputPlayback(timelineFromHistory(h))`
 * accepts it. A window with more than `PLAYBACK_LIMITS.events` edges throws RangeError: convert a shorter range.
 */
export function timelineFromHistory(
  history: InputHistory,
  range: {from?: number; to?: number} = {},
): {events: PlaybackEvent[]; length: number; maxEvents: number} {
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
      if (events.length > PLAYBACK_LIMITS.events)
        fail(`frames ${from}..${to} hold more than ${PLAYBACK_LIMITS.events} edges; convert a shorter range`);
    }
  }
  return {events, length: to - from + 1, maxEvents: Math.max(1, events.length)};
}

/**
 * A fixed-lane system that advances `playback` one tick per fixed tick. List it in the scene's `systems` before every
 * system that reads the scripted input (systems run in list order), so they all see the same tick. With
 * `watchLive: true` it passes `ctx.input` to `step` as the live input to watch; leave it false (the default) when
 * `ctx.input` is the playback itself, as in `testScene(scene, { input: playback.source })`.
 */
export function inputPlaybackSystem(
  playback: Pick<InputPlayback, 'step'>,
  o: {id?: string; watchLive?: boolean} = {},
): SystemDefinition {
  const watchLive = o.watchLive ?? false;
  return defineSystem({
    id: o.id ?? 'input-history-playback',
    run(ctx) {
      playback.step(watchLive ? ctx.input : undefined);
    },
  });
}
