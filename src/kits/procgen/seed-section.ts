/**
 * A strict save section holding one generation root seed (or none). Store the root, not generated output:
 * every region, level or layer re-derives from it with `deriveSeed`. A malformed stored value throws in `parse`,
 * so the save store quarantines it and play continues from `{seed: null}` (STD-SAV-3). Clearing the seed
 * (`update(d => { d.seed = null; })`) is how a creator ends a run; whether that happens on failure is game policy.
 */
import { defineSaveSection, type SaveSectionDef } from '../../author';

export interface GenerationSeedRecord { seed: number | null }

export function parseGenerationSeed(raw: unknown): GenerationSeedRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) throw Error('generation seed: not a plain object');
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== 'seed') throw Error('generation seed: unexpected fields');
  const seed = (raw as { seed: unknown }).seed;
  if (seed !== null && !(typeof seed === 'number' && Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff)) throw Error('generation seed: not an unsigned 32-bit integer');
  return { seed };
}

/** `id` is `<owner>.<name>` and is never renamed. Default scope is `player`. */
export function defineGenerationSeedSection(id: string, scope: 'player' | 'device' = 'player'): SaveSectionDef<GenerationSeedRecord> {
  return defineSaveSection<GenerationSeedRecord>({ id, scope, initial: { seed: null }, parse: parseGenerationSeed });
}
