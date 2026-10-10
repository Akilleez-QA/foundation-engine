import {defineSaveSection, type SaveSectionDef} from '../../author';
import {parseSequenceState, type SequenceDefinition, type SequenceState} from './sequence';

/** One saved run of one definition, or none. */
export interface SequenceRecord {
  run: SequenceState | null;
}

/**
 * A strict save section for one sequence definition. `id` is `<owner>.<name>` and is never renamed. A stored run of
 * another definition fingerprint, or any inconsistent state, throws in `parse`, so the save store quarantines it and
 * play continues from `{run: null}`. The session is not checked here: continue a saved run with its own
 * `run.session`. Edit a definition by giving it a new section or migrating explicitly.
 */
export function defineSequenceSection(
  id: string,
  definition: SequenceDefinition,
  options: {readonly scope?: 'player' | 'device'} = {},
): SaveSectionDef<SequenceRecord> {
  return defineSaveSection<SequenceRecord>({
    id,
    scope: options.scope ?? 'player',
    initial: {run: null},
    parse(raw: unknown): SequenceRecord {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype)
        throw Error('sequence section: not a plain object');
      const keys = Object.keys(raw);
      if (keys.length !== 1 || keys[0] !== 'run') throw Error('sequence section: unexpected fields');
      const run = (raw as {run: unknown}).run;
      return {run: run === null ? null : parseSequenceState(definition, run)};
    },
  });
}
