/**
 * core/ecs/systems.ts: running systems in a fixed order, with a fixed-step lane (STD-SIM-11: simulations step at a
 * fixed rate, identical on every machine) and a per-frame lane.
 *
 * - `fixed` systems run zero or more times per frame at `step` seconds each (an accumulator; at most `maxSteps` per
 *   frame, the rest is dropped and reported), so physics and rules do not depend on the frame rate.
 * - `frame` systems run once per frame with the frame's elapsed time (presentation, cameras, UI).
 * Systems run in declaration order within their lane. A throwing system is reported and skipped for that frame; the
 * others still run.
 */
export interface SystemSpec<C> {
  id: string;
  /** 'fixed' (default): the fixed-step lane. 'frame': once per frame. */
  phase?: 'fixed' | 'frame';
  run(ctx: C, dt: number): void;
}

export interface RunnerStats { frames: number; steps: number; dropped: number; errors: number }

export interface SystemRunner<C> {
  /** Advance by `dt` seconds of frame time; returns how many fixed steps ran. */
  frame(ctx: C, dt: number): number;
  readonly stats: RunnerStats;
  /** Fraction of a step left in the accumulator (for interpolation). */
  readonly alpha: number;
}

export function createSystemRunner<C>(systems: readonly SystemSpec<C>[], o: { step?: number; maxSteps?: number; report?: (id: string, error: unknown) => void; after?: () => void } = {}): SystemRunner<C> {
  const step = o.step ?? 1 / 60, maxSteps = o.maxSteps ?? 5;
  if (!(step > 0)) throw Error('the fixed step must be positive');
  const ids = new Set<string>();
  for (const s of systems) { if (ids.has(s.id)) throw Error(`two systems are called ${s.id}`); ids.add(s.id); }
  const fixed = systems.filter(s => (s.phase ?? 'fixed') === 'fixed'), perFrame = systems.filter(s => s.phase === 'frame');
  const stats: RunnerStats = { frames: 0, steps: 0, dropped: 0, errors: 0 };
  let acc = 0;
  const run = (s: SystemSpec<C>, ctx: C, dt: number) => {
    try { s.run(ctx, dt); }
    catch (error) {
      stats.errors++;
      try { (o.report ?? ((id, e) => console.error(`system ${id} failed`, e)))(s.id, error); }
      catch { /* Diagnostics must not interrupt sibling systems or accumulator bookkeeping. */ }
    }
  };
  return {
    stats,
    get alpha() { return acc / step; },
    frame(ctx, dt) {
      stats.frames++;
      acc += Math.max(0, Math.min(dt, 1));
      let n = 0;
      while (acc >= step - 1e-9 && n < maxSteps) { for (const s of fixed) run(s, ctx, step); acc -= step; n++; }
      if (acc >= step - 1e-9) { const extra = Math.floor(acc / step + 1e-9); stats.dropped += extra; acc -= extra * step; }
      stats.steps += n;
      for (const s of perFrame) run(s, ctx, dt);
      o.after?.();
      return n;
    },
  };
}
