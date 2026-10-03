/**
 * core/clock.ts (ADR 0033): the game clock.
 * One universal time (UT) per player, persisted through the save store as section 'core.clock'; one warp authority;
 * background catch-up is explicit and capped.
 *
 * `createClock()` returns two capabilities (ADR 0033, STD-SIM-3):
 *   - `clock: GameClock`, the service every module receives. It cannot step time.
 *   - `driver: ClockDriver` (`advance`, `resumeFromAway`, `snapshot`, `restore`), held only by the FrameLoop and
 *     the save store (lint `clock-driver`).
 * Installed by core.clock through the shared-loop player-clock runtime.
 */
import type {ClockState} from './clock-section';

export interface Clock {
  /** Player game time: float64 seconds on the game's timeline (a new player starts at the real date in Unix seconds).
   *  Advances only while playing, and only through the driver. */
  readonly ut: number;
  /** 0 while paused, otherwise the granted rate (a WARP_STEPS value, capped by the policy). */
  readonly warp: number;
  /** The ONLY wall-clock access allowed outside core (ms since the Unix epoch). */
  readonly realNow: () => number;
  schedule(atUt: number, fn: () => void, signal?: AbortSignal): void;
}

export type WarpMode = 'physics' | 'rails';
export interface WarpRequest {
  owner: string;
  rate: number;
  mode: WarpMode;
}
/**
 * An activity's warp limits (e.g. a strategic map allows rails 100000×; a precise interaction allows physics 4× at most).
 * The driver re-asks at the start of every advance and after every event, so a cap that depends on UT (an alarm
 * approaching) takes effect in the same frame.
 */
export interface WarpPolicy {
  maxRate(ut: number, mode: WarpMode): number;
}
export interface ClockTick {
  from: number;
  to: number;
  realDt: number;
  warp: number;
  clampedBy?: number;
}
export interface CatchUp {
  awayRealS: number;
  cappedS: number;
  reason: 'load' | 'visible';
}

export interface GameClock extends Clock {
  readonly paused: boolean;
  /** A set of owners, not a boolean (covered layers, dialogs, the hidden tab each hold their own). */
  pause(owner: string): void;
  resume(owner: string): void;
  /** Returns the granted rate after the policy. Throws for a rate that is not in WARP_STEPS. The highest request wins. */
  requestWarp(req: WarpRequest): number;
  releaseWarp(owner: string): void;
  /** The active activity's policy (null: rails up to 1e6). */
  setPolicy(policy: WarpPolicy | null): void;
  /** Warp towards `ut`, dropping out `lead` s before it, and release at the target. */
  warpTo(ut: number, opts?: {lead?: number; owner?: string}): void;
  /** Systems that simulate "while you were away" subscribe; the clock itself never jumps UT. */
  onCatchUp(fn: (c: CatchUp) => void, signal?: AbortSignal): () => void;
  /** The real date, for calendar-driven content (tests set it through `realNow`). */
  calendar(): Date;
  /** The real date on the game timeline: for views that declare they show real time rather than game time. */
  realUt(): number;
}

export interface ClockDriver {
  /** Called by the one frame loop only. Advances UT, clamping at the next scheduled event that changes warp.
   * A restore during a callback ends this advance: returns a zero-duration tick at the restored UT. */
  advance(realDt: number): ClockTick;
  resumeFromAway(reason: CatchUp['reason']): void;
  snapshot(): ClockState;
  /** Loads another player's time. Pending schedules and warp requests belonged to the previous timeline and are dropped. */
  restore(state: ClockState): void;
}

export interface ClockOptions {
  /** Wall clock in ms since the Unix epoch. Default `Date.now`, the one sanctioned wall-clock read (ADR 0033). */
  realNow?: () => number;
  /** The player's saved time. Absent for a new player, whose UT starts at the real date (ADR 0033). */
  state?: ClockState;
  /** Called with the new snapshot when the driver resumes from time away. */
  persist?: (s: ClockState) => void;
}

export const WARP_STEPS = [1, 2, 4, 10, 20, 100, 1000, 10000, 100000, 1000000] as const;
export const MAX_CATCH_UP_S = 7 * 24 * 3600;
/** A frame longer than this is clamped, so a stalled frame never teleports the world. */
export const MAX_FRAME_S = 0.25;

/** Game seconds for a wall-clock instant: the default timeline is Unix seconds, so a new player starts "now". */
export function gameSeconds(unixMs: number): number {
  return unixMs / 1000;
}

export {clockSection, type ClockState} from './clock-section';

/**
 * The wall clock alone, for code that needs "now" before the game boots through createApp (e.g. first-seen times). The same sanctioned read `createClock` defaults to; a test passes its own `{ realNow }`.
 */
export const wallClock: Pick<GameClock, 'realNow' | 'calendar'> = Object.freeze({
  realNow: () => Date.now(),
  calendar: () => new Date(wallClock.realNow()),
});

export function createClock(opts: ClockOptions = {}): {clock: GameClock; driver: ClockDriver} {
  const realNow = opts.realNow ?? wallClock.realNow;
  let ut = opts.state?.ut ?? gameSeconds(realNow()),
    lastReal = opts.state?.lastRealMs ?? null;
  let policy: WarpPolicy | null = null,
    granted = 1,
    timeline = 0;
  const pauses = new Set<string>(),
    warps = new Map<string, WarpRequest>(),
    catchUps = new Set<(c: CatchUp) => void>();
  type Ev = {at: number; fn: () => void; signal?: AbortSignal | undefined};
  let events: Ev[] = [];
  const regrant = () => {
    let best: WarpRequest | null = null;
    for (const r of warps.values()) if (!best || r.rate > best.rate) best = r;
    const want = best ? best.rate : 1,
      mode = best?.mode ?? 'physics';
    const identity = timeline;
    const cap = policy ? policy.maxRate(ut, mode) : 1e6;
    if (timeline !== identity) return granted;
    granted = Math.max(1, Math.min(want, cap));
    return granted;
  };
  const clock: GameClock = {
    get ut() {
      return ut;
    },
    get warp() {
      return pauses.size ? 0 : granted;
    },
    get paused() {
      return pauses.size > 0;
    },
    realNow,
    schedule(atUt, fn, signal) {
      if (signal?.aborted) return;
      // Stable order: events at the same UT fire in the order they were scheduled.
      let i = events.length;
      while (i > 0 && events[i - 1]!.at > atUt) i--; // i - 1 in [0, length)
      events.splice(i, 0, {at: atUt, fn, signal});
    },
    pause(owner) {
      pauses.add(owner);
    },
    resume(owner) {
      pauses.delete(owner);
    },
    requestWarp(req) {
      if (!WARP_STEPS.includes(req.rate as (typeof WARP_STEPS)[number]))
        throw Error('warp ' + req.rate + ' is not a step');
      warps.set(req.owner, req);
      return regrant();
    },
    releaseWarp(owner) {
      warps.delete(owner);
      regrant();
    },
    setPolicy(p) {
      policy = p;
      regrant();
    },
    warpTo(target, o) {
      const owner = o?.owner ?? 'warp-to',
        lead = o?.lead ?? 0,
        stopAt = target - lead;
      if (stopAt <= ut) return;
      const rate = [...WARP_STEPS].reverse().find(r => (stopAt - ut) / r >= 2) ?? 1; // at least ~2 s real time to arrive
      clock.requestWarp({owner, rate, mode: 'rails'});
      clock.schedule(stopAt, () => clock.releaseWarp(owner));
    },
    onCatchUp(fn, signal) {
      catchUps.add(fn);
      const off = () => {
        catchUps.delete(fn);
      };
      if (signal?.aborted) off();
      else signal?.addEventListener('abort', off, {once: true});
      return off;
    },
    calendar: () => new Date(realNow()),
    realUt: () => gameSeconds(realNow()),
  };
  const driver: ClockDriver = {
    advance(realDt) {
      const from = ut,
        identity = timeline;
      // A callback may load a different player's timeline. This advance then contributes no time to it.
      const interrupted = (): ClockTick => ({from: ut, to: ut, realDt: 0, warp: clock.warp});
      if (pauses.size || !(realDt > 0)) return {from, to: ut, realDt, warp: 0};
      regrant(); // the policy's cap may depend on UT
      if (timeline !== identity) return interrupted();
      const dt = Math.min(realDt, MAX_FRAME_S) * granted;
      let to = from + dt,
        clampedBy: number | undefined;
      const g0 = granted;
      while (events.length && events[0]!.at <= to) {
        // events[0] exists: length > 0
        const e = events.shift()!;
        if (e.signal?.aborted) continue;
        ut = Math.max(from, e.at);
        e.fn();
        if (timeline !== identity) return interrupted();
        regrant();
        if (timeline !== identity) return interrupted();
        if (granted !== g0 || pauses.size) {
          to = ut;
          clampedBy = e.at;
          break;
        } // an event changed warp or paused: the tick ends at it
      }
      ut = to;
      const real = realNow();
      if (timeline !== identity) return interrupted();
      lastReal = real;
      return {from, to, realDt, warp: granted, ...(clampedBy === undefined ? {} : {clampedBy})};
    },
    resumeFromAway(reason) {
      const now = realNow();
      if (lastReal !== null && now > lastReal) {
        const away = (now - lastReal) / 1000,
          c: CatchUp = {awayRealS: away, cappedS: Math.min(away, MAX_CATCH_UP_S), reason};
        for (const fn of catchUps) fn(c);
      }
      lastReal = now;
      opts.persist?.(driver.snapshot());
    },
    snapshot: () => ({ut, lastRealMs: lastReal}),
    restore(s) {
      timeline++;
      ut = s.ut;
      lastReal = s.lastRealMs;
      events = [];
      warps.clear();
      regrant();
    },
  };
  return {clock, driver};
}

/** Monotonic milliseconds for scheduling (not game time). The one sanctioned performance.now seam outside the frame loop. */
export const monotonicNow = (): number => globalThis.performance.now();
