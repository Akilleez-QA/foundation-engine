/**
 * A strict save section holding one generation root seed (or none) and the content version it was generated with.
 * Store the root, not generated output: every region, level or layer re-derives from it with `deriveSeed`.
 * A malformed stored value throws in `parse`, so the save store quarantines it and play continues from the initial
 * value (STD-SAV-3). Clearing the seed (`d.seed = null`) is how a creator ends a run; whether that happens on
 * failure is game policy.
 *
 * `contentVersion` is the creator's number for "the generators and parameters that turn this seed into content".
 * The engine cannot detect a generator change: bump it yourself whenever the same seed would produce different
 * content, write it together with a new seed, and compare on load (`record.contentVersion !== current`) to choose
 * between keeping old-version content, starting fresh, or a migration of your own.
 */
import { defineSaveSection, type SaveSectionDef } from '../../author';

export interface GenerationSeedRecord { seed: number | null; contentVersion: number }

const u32 = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff;

export function parseGenerationSeed(raw: unknown): GenerationSeedRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) throw Error('generation seed: not a plain object');
  const keys = Object.keys(raw).sort();
  if (keys.length !== 2 || keys[0] !== 'contentVersion' || keys[1] !== 'seed') throw Error('generation seed: unexpected fields');
  const { seed, contentVersion } = raw as { seed: unknown; contentVersion: unknown };
  if (seed !== null && !u32(seed)) throw Error('generation seed: not an unsigned 32-bit integer');
  if (!(typeof contentVersion === 'number' && Number.isSafeInteger(contentVersion) && contentVersion >= 0)) throw Error('generation seed: invalid content version');
  return { seed: seed as number | null, contentVersion };
}

export interface GenerationSeedSectionOptions {
  /** Default `player`. */
  readonly scope?: 'player' | 'device';
  /** The content version a fresh record starts with. Default 0. */
  readonly contentVersion?: number;
}

/** `id` is `<owner>.<name>` and is never renamed. */
export function defineGenerationSeedSection(id: string, options: GenerationSeedSectionOptions = {}): SaveSectionDef<GenerationSeedRecord> {
  const { scope = 'player', contentVersion = 0 } = options;
  if (!Number.isSafeInteger(contentVersion) || contentVersion < 0) throw Error('generation seed: invalid content version');
  return defineSaveSection<GenerationSeedRecord>({ id, scope, initial: { seed: null, contentVersion }, parse: parseGenerationSeed });
}
