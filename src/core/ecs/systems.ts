/**
 * core/ecs/systems.ts: running systems in a fixed order, with a fixed-step lane (STD-SIM-11: simulations step at a
 * fixed rate, identical on every machine) and a per-frame lane.
 *
 * - `fixed` systems run zero or more times per frame at `step` seconds each (an accumulator; at most `maxSteps` per
 *   frame, the rest is dropped and reported), so physics and rules do not depend on the frame rate.
 * - `frame` systems run once per frame with the frame's elapsed time (presentation, cameras, UI).
 * Systems run in declaration order within their lane. A throwing system is reported and skipped for that frame; the
 * others still run.
 * - `beforeStep` runs before each fixed step and `beforeFrameLane` before the per-frame lane, so an owner can address
 *   input to the tick that consumes it (STD-SIM-12). They must not throw.
 * - `afterSystem` runs after each system run (the authored runtime flushes world observers there); an error it throws
 *   is reported under that system's id like a system error.
 * - `sinceLastRun` wraps a system with a per-world change cursor: the system sees changes made since its last
 *   successful run.
 */
import type {ChangeCursor} from './world-tracking';
import type {World} from './world';
export interface SystemSpec<C> {
  id: string;
  /** 'fixed' (default): the fixed-step lane. 'frame': once per frame. */
  phase?: 'fixed' | 'frame';
  run(ctx: C, dt: number): void;
}

export interface RunnerStats {
  frames: number;
  steps: number;
  dropped: number;
  errors: number;
}

export interface SystemRunner<C> {
  /** Advance by finite `dt` seconds; invalid or unsafe numeric accounting throws before any frame work. */
  frame(ctx: C, dt: number): number;
  readonly stats: RunnerStats;
  /** Fraction of a step left after a completed frame, in [0, 1) (for interpolation). */
  readonly alpha: number;
}

export function createSystemRunner<C>(
  systems: readonly SystemSpec<C>[],
  o: {
    /** Finite positive seconds. A frame must have a representable safe-integer whole-step count. */
    step?: number;
    /** Nonnegative safe integer; zero drops all due whole steps and still runs the frame lane. */
    maxSteps?: number;
    report?: (id: string, error: unknown) => void;
    after?: () => void;
    beforeStep?: () => void;
    beforeFrameLane?: () => void;
    afterSystem?: (id: string) => void;
  } = {},
): SystemRunner<C> {
  const step = o.step ?? 1 / 60,
    maxSteps = o.maxSteps ?? 5;
  if (!Number.isFinite(step) || !(step > 0)) throw Error('the fixed step must be finite and positive');
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 0) throw Error('maxSteps must be a nonnegative safe integer');
  const ids = new Set<string>();
  for (const s of systems) {
    if (ids.has(s.id)) throw Error(`two systems are called ${s.id}`);
    ids.add(s.id);
  }
  const fixed = systems.filter(s => (s.phase ?? 'fixed') === 'fixed'),
    perFrame = systems.filter(s => s.phase === 'frame');
  const stats: RunnerStats = {frames: 0, steps: 0, dropped: 0, errors: 0};
  let acc = 0,
    correction = 0;
  const fail = (s: SystemSpec<C>, error: unknown) => {
    stats.errors++;
    try {
      (o.report ?? ((id, e) => console.error(`system ${id} failed`, e)))(s.id, error);
    } catch {
      /* Diagnostics must not interrupt sibling systems or accumulator bookkeeping. */
    }
  };
  const after = o.afterSystem;
  const run = (s: SystemSpec<C>, ctx: C, dt: number) => {
    try {
      s.run(ctx, dt);
    } catch (error) {
      fail(s, error);
    }
    if (!after) return;
    try {
      after(s.id);
    } catch (error) {
      fail(s, error);
    }
  };
  return {
    stats,
    get alpha() {
      return acc / step;
    },
    frame(ctx, dt) {
      if (!Number.isFinite(dt)) throw Error('frame time must be finite');
      // Carry rounding lost by addition/subtraction across frames rather than
      // repeatedly converting the retained phase between seconds and ticks.
      const elapsed = Math.max(0, Math.min(dt, 1)) - correction;
      const total = acc + elapsed;
      const addedCorrection = total - acc - elapsed;
      const quotient = total / step;
      if (!Number.isFinite(quotient) || quotient > Number.MAX_SAFE_INTEGER)
        throw Error('frame step count exceeds safe numeric accounting');
      // Correct only a few rounding bits at a whole-step boundary, in step units.
      // An absolute seconds tolerance can manufacture ticks when step is tiny.
      const nearest = Math.round(quotient);
      const due = nearest >= 1 && Math.abs(quotient - nearest) <= 64 * Number.EPSILON ? nearest : Math.floor(quotient);
      const count = Math.min(due, maxSteps);
      const dropped = due - count;
      if (
        !Number.isSafeInteger(stats.frames + 1) ||
        !Number.isSafeInteger(stats.steps + count) ||
        !Number.isSafeInteger(stats.dropped + dropped)
      )
        throw Error('runner counters exceed safe numeric accounting');
      const spent = due * step + addedCorrection;
      const remainder = total - spent;
      const nextCorrection = remainder - total + spent;
      stats.frames++;
      acc = total;
      let n = 0;
      while (n < count) {
        o.beforeStep?.();
        for (const s of fixed) run(s, ctx, step);
        acc = Math.max(0, acc - step);
        n++;
      }
      acc = Math.max(0, remainder);
      correction = remainder <= 0 ? 0 : nextCorrection;
      stats.dropped += dropped;
      stats.steps += n;
      o.beforeFrameLane?.();
      for (const s of perFrame) run(s, ctx, dt);
      o.after?.();
      return n;
    },
  };
}

/**
 * A system that receives a change cursor for `world(ctx)`: changes recorded after its previous successful run pass
 * `added`/`changed` filters. Its first run on a world sees every tracked component as added and changed (nothing is
 * missed however late the system first runs). The cursor advances only when `run` returns, so a throwing run sees the
 * same changes again. One cursor per world (a scene's next visit gets a fresh one); each counts toward `maxCursors`.
 */
export function sinceLastRun<C>(spec: {
  id: string;
  phase?: 'fixed' | 'frame';
  world: (ctx: C) => World;
  run(ctx: C, dt: number, since: ChangeCursor): void;
}): SystemSpec<C> {
  const cursors = new WeakMap<World, ChangeCursor>();
  return {
    id: spec.id,
    phase: spec.phase ?? 'fixed',
    run(ctx, dt) {
      const world = spec.world(ctx);
      let cursor = cursors.get(world);
      if (!cursor) cursors.set(world, (cursor = world.changeCursor({fromStart: true})));
      spec.run(ctx, dt, cursor);
      cursor.advance();
    },
  };
}
