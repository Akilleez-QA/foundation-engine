/** author/scene-output-sync.ts: run-time change tracking for `ctx.view.output` (scene runtime only, so the first-load
 *  bundle carries just the validation in scene-output.ts). */
import {outputKey, validateSceneOutput, type SceneOutput} from './scene-output';

/**
 * Change tracking for `ctx.view.output`, run once per frame by the scene runtime. `sync(value)` applies a changed,
 * valid output through `apply` and returns true once (the frame must be drawn); an unchanged value returns false
 * without validating again. An invalid value is reported once per distinct value and the last valid output stays on
 * screen (recovery: assign a valid value).
 */
export function createOutputSync(
  initial: Readonly<SceneOutput>,
  apply: (o: Readonly<SceneOutput>) => void,
  report: (error: unknown) => void,
) {
  let seen: unknown = initial,
    key = outputKey(initial),
    refused = '';
  return {
    sync(value: unknown): boolean {
      if (value === seen) return false;
      seen = value;
      let next: SceneOutput;
      try {
        next = validateSceneOutput(value, 'ctx.view.output');
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        if (why !== refused) {
          refused = why;
          report(error);
        }
        return false;
      }
      refused = '';
      const nextKey = outputKey(next);
      if (nextKey === key) return false;
      key = nextKey;
      apply(next);
      return true;
    },
  };
}
