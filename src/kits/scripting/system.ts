import {defineSystem, type SceneContext, type SystemDefinition} from '../../author';
import type {ScriptHost, ScriptTickReport} from './host';

/**
 * A fixed-phase system that advances a script host by one tick per fixed step, so script timers and `now()` follow
 * the simulation clock. `host` returns the scene's host (or null before it is ready / after it is disposed);
 * `report` receives each tick's report (failures, deferred timers) for the game's own handling.
 */
export function scriptTickSystem(
  host: (ctx: SceneContext) => ScriptHost | null,
  report?: (ctx: SceneContext, r: ScriptTickReport) => void,
  id = 'scripting-tick',
): SystemDefinition {
  return defineSystem({
    id,
    run(ctx) {
      const h = host(ctx);
      if (!h) return;
      const r = h.tick();
      report?.(ctx, r);
    },
  });
}
