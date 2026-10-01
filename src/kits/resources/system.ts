import { defineSystem, type SceneContext, type SystemDefinition } from '../../author';
import { createProduction, type ProductionOptions, type ProductionSnapshot } from './production';
import { integer } from './deposits';
/**
 * Prepare the model before scene activation. The frame system advances one job per
 * call and hands one complete snapshot to the owner's persistence adapter.
 */
export function resourceProductionSystem(config: {
  model: ReturnType<typeof createProduction>; options: ProductionOptions;
  nowTick(ctx: SceneContext): number; publish(snapshot: ProductionSnapshot, ctx: SceneContext): boolean;
  maxTicks?: number; maxCycles?: number;
}): SystemDefinition {
  const ids = config.options.jobs.map(job => job.id), maxTicks = config.maxTicks ?? 60, maxCycles = config.maxCycles ?? 16;
  integer(maxTicks, 1, 1_000_000); integer(maxCycles, 1, 1024);
  let cursor = 0, pending: ProductionSnapshot | undefined;
  const publish = (ctx: SceneContext): void => {
    if (!pending) return;
    if (config.publish(structuredClone(pending), ctx) !== true) throw Error('resources: snapshot publication was not accepted');
    pending = undefined;
  };
  return defineSystem({ id: 'resources-production', phase: 'frame', run(ctx) {
    if (pending) { publish(ctx); return; }
    if (!ids.length) return;
    const id = ids[cursor++ % ids.length]!, now = config.nowTick(ctx); integer(now);
    const before = config.model.snapshot().jobs[id]!;
    if (before.tick >= now) return;
    const result = config.model.apply({ kind: 'advance', id: `advance:${ids.indexOf(id)}:${before.tick}:${now}`, jobId: id, toTick: now, maxTicks, maxCycles }, config.model.epoch);
    if (!result.ok) throw Error(`resources: production failed: ${result.reason}`);
    // This callback owns the save envelope and must handle unavailable/quarantined
    // persistence. Publication failure is visible; it is never silently swallowed.
    pending = config.model.snapshot();
    publish(ctx);
  } });
}
