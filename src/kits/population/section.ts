import {defineSaveSection, type SaveSectionDef} from '../../author';
import {parsePlacementState, type PlacementSet, type PlacementState} from './placements';

export interface PlacementRecord {
  state: PlacementState | null;
}

/**
 * A strict save section for one placement set's persistent depletion. `id` is `<owner>.<name>` and is never renamed.
 * A record for another set or an edited set (different fingerprint), or naming placements that cannot be depleted,
 * throws in `parse`, so the store quarantines it and play continues with nothing depleted. Editing the placements
 * therefore needs a new section or an explicit migration of the depleted ids.
 */
export function definePlacementSection(
  id: string,
  set: PlacementSet,
  options: {readonly scope?: 'player' | 'device'} = {},
): SaveSectionDef<PlacementRecord> {
  return defineSaveSection<PlacementRecord>({
    id,
    scope: options.scope ?? 'player',
    initial: {state: null},
    parse(raw: unknown): PlacementRecord {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype)
        throw Error('placement section: not a plain object');
      const keys = Object.keys(raw);
      if (keys.length !== 1 || keys[0] !== 'state') throw Error('placement section: unexpected fields');
      const state = (raw as {state: unknown}).state;
      return {state: state === null ? null : parsePlacementState(set, state)};
    },
  });
}
