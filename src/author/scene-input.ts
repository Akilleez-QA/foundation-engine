import {actionOf} from './ids';
import type {InputSource, InputState} from './defs';
/** A full InputState over a caller-built source; a source without `pressedAt` reports no timestamps. */
export function completeInput(source: InputSource): InputState {
  return source.pressedAt
    ? (source as InputState)
    : {
        describe: id => source.describe(id),
        pressed: id => source.pressed(id),
        pressedAt: () => null,
        held: id => source.held(id),
        axis: id => source.axis(id),
        get pointer() {
          return source.pointer;
        },
      };
}
/** Covered previews may update visually, but never read another owner's held controls. `pressed.get` is the press's
 *  timestamp (page monotonic ms) under the same lane rules as `has` (the press latch, STD-SIM-12). */
export function sceneInput(
  owns: () => boolean,
  held: (id: ReturnType<typeof actionOf>) => boolean,
  pressed: Pick<ReadonlyMap<string, number>, 'has' | 'get'>,
  pointer: InputState['pointer'],
  describe: InputState['describe'] = () => null,
): InputState {
  return {
    describe,
    pressed: id => owns() && pressed.has(id),
    pressedAt: id => (owns() ? (pressed.get(id) ?? null) : null),
    held: id => owns() && held(actionOf(id)),
    axis: id => (owns() ? Number(held(actionOf(id, 'positive'))) - Number(held(actionOf(id, 'negative'))) : 0),
    pointer,
  };
}
