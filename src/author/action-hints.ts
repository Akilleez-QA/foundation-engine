import {actionOf} from './ids';
import type {ActionId} from '../platform/input/actions';
import type {ActionHint, InputDefinition, InputState} from './defs';

/** Resolve only author-declared local press IDs; an axis requires a separate two-sided presentation contract. */
export function sceneActionHints(
  inputs: readonly InputDefinition[],
  lookup: (id: ActionId) => ActionHint | null,
): InputState['describe'] {
  const ids = new Map(inputs.filter(input => !input.axis).map(input => [input.id, actionOf(input.id)]));
  return localId => {
    const id = ids.get(localId);
    return id === undefined ? null : lookup(id);
  };
}

/** Headless defaults only. Inject the real input service to exercise remaps or modal context. No device inference. */
export function defaultActionHints(inputs: readonly InputDefinition[]): (id: ActionId) => ActionHint | null {
  const descriptions = new Map(
    inputs
      .filter(input => !input.axis)
      .map(input => [
        actionOf(input.id),
        Object.freeze({
          labelKey: `game.input.${input.id}`,
          keys: Object.freeze([...(input.keys ?? [])]),
          pad: Object.freeze([...(input.pad ?? [])]),
          inContext: true,
        }),
      ]),
  );
  return id => descriptions.get(id) ?? null;
}
