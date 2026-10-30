/**
 * core/player-clock.ts: the GameClock bound to the save store's players (ADR 0033).
 *
 * - Each player has their own UT, in section 'core.clock'. A player whose time never started begins at the real date.
 * - UT is recorded into the section every `recordEveryS` seconds of running time, when the clock resumes from time
 *   away, and for the previous player on a player switch. The section is 'lazy', so the store writes it at its flush
 *   points (pagehide, a hidden page, a scene entered, a player switch, export), never per frame.
 * - A player switch loads the new player's time (`driver.restore`): the previous timeline's schedules and warp end.
 *
 * The driver goes to the one frame loop only (`FrameLoop({clock})`); every other module receives `clock`.
 */
import {createClock, gameSeconds, wallClock, MAX_FRAME_S, type ClockDriver, type GameClock} from './clock';
import {clockSection, type ClockState} from './clock-section';
import type {PlayerId, SaveStore} from './save/section';

/** Seconds of running time between records: what a closed tab can lose at most. */
export const CLOCK_RECORD_EVERY_S = 10;

export interface PlayerClockOptions {
  /** Wall clock in ms since the Unix epoch (default: the core wall clock). */
  realNow?: () => number;
  recordEveryS?: number;
}

export interface PlayerClock {
  clock: GameClock;
  driver: ClockDriver;
  /** Records the active player's UT now (the store writes it at its next flush point). */
  record(): void;
  /** Stops following player switches. */
  dispose(): void;
}

export function createPlayerClock(store: SaveStore, opts: PlayerClockOptions = {}): PlayerClock {
  const realNow = opts.realNow ?? wallClock.realNow,
    every = opts.recordEveryS ?? CLOCK_RECORD_EVERY_S;
  const saved = (p: PlayerId): ClockState =>
    store.section(clockSection).of(p).get() ?? {ut: gameSeconds(realNow()), lastRealMs: null};
  let player = store.activePlayer(),
    running = 0,
    writing = false;
  const initialState = saved(player);
  let initialUt = initialState.ut;
  const {clock, driver: inner} = createClock({realNow, state: initialState, persist: () => record(player)});
  function record(p: PlayerId, now = false) {
    running = 0;
    const handle = store.section(clockSection).of(p),
      snapshot = inner.snapshot();
    // A fresh player gains a clock section only once game time actually runs.
    if (handle.get() === null && snapshot.ut === initialUt) return;
    writing = true;
    try {
      handle.replace(snapshot, {now});
    } finally {
      writing = false;
    }
  }
  const follow = () =>
    store
      .section(clockSection)
      .of(player)
      .subscribe(value => {
        if (writing) return;
        // Import/reset/storage replacement: adopt the new timeline without retaining its predecessor's warp or alarms.
        const state = value ?? {ut: gameSeconds(realNow()), lastRealMs: null};
        initialUt = state.ut;
        running = 0;
        clock.setPolicy(null);
        inner.restore(state);
      });
  let unfollow = follow();
  const driver: ClockDriver = {
    advance(realDt) {
      const tick = inner.advance(realDt);
      if (tick.to !== tick.from && (running += Math.min(realDt, MAX_FRAME_S)) >= every) record(player);
      return tick;
    },
    resumeFromAway: reason => inner.resumeFromAway(reason),
    snapshot: () => inner.snapshot(),
    restore: s => inner.restore(s),
  };
  const off = store.onPlayerChanged((id, previous) => {
    unfollow();
    if (previous === player) record(previous, true);
    player = id;
    running = 0;
    const state = saved(id);
    initialUt = state.ut;
    clock.setPolicy(null);
    inner.restore(state);
    unfollow = follow();
  });
  return {
    clock,
    driver,
    record: () => record(player),
    dispose() {
      unfollow();
      off();
    },
  };
}
