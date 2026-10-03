/**
 * platform/assets/manifest.ts: the asset definition schema (ADR 0023; STD-REN-30, STD-REN-31).
 *
 * Every shipped file-backed asset has one `AssetDef` in a pack (`content/assets/<pack>.assets.ts`, STD-MOD-9). A def names the
 * asset by id (code never addresses a path, STD-REN-31), carries its licence and provenance, and lists its variants
 * by resolution. Each variant is one file under `public/` with its sha256, which the generated lock records.
 *
 * The types live in `core/asset-def.ts` so content packs can import them (types only). `scripts/assets.mjs` runs this
 * validation over every pack. Nothing in the running game reads this module yet. Pure: no DOM, no three.js, no I/O.
 */

import {QUALITY_PRESETS, type QualityPreset} from '../../core/tiers.ts';
import type {AssetDef} from '../../core/asset-def.ts';

export type {
  AssetDef,
  AssetFormat,
  AssetKind,
  AssetPack,
  AssetProvenance,
  AssetVariant,
  LicenceId,
} from '../../core/asset-def.ts';

/** Presets, best first: `core/tiers.ts`, under the manifest's historical name. */
export const QUALITY_TIERS = QUALITY_PRESETS;
export type QualityTier = QualityPreset;

/** Identity helper for folder shards: `export default defineAssets([...])` keeps literal types checked. */
export function defineAssets<const T extends readonly AssetDef[]>(defs: T): T {
  return defs;
}

export interface AssetProblem {
  readonly id: string;
  readonly problem: string;
}

const ID_PATTERN = /^asset\.[a-z]+\.[a-z0-9][a-z0-9.-]*$/;
const SHA_PATTERN = /^[0-9a-f]{64}$/;

/** True when `tier` is no better than `cap` (so a variant capped at `cap` may serve it). */
export function tierAtOrBelow(tier: QualityTier, cap: QualityTier): boolean {
  return QUALITY_TIERS.indexOf(tier) >= QUALITY_TIERS.indexOf(cap);
}

/**
 * Structural checks the build gate runs over every def (STD-REN-30). Lock staleness and missing files are checked by
 * the generator against the file system; this function is pure.
 */
export function validateAssetDefs(defs: readonly AssetDef[]): AssetProblem[] {
  const problems: AssetProblem[] = [];
  const ids = new Set<string>();
  const paths = new Map<string, string>();
  for (const def of defs) {
    const report = (problem: string) => problems.push({id: def.id, problem});
    if (!ID_PATTERN.test(def.id)) report('id must be asset.<kind>.<name> in lower case');
    else if (def.id.split('.')[1] !== def.kind) report(`id segment does not match kind '${def.kind}'`);
    if (ids.has(def.id)) report('duplicate id');
    ids.add(def.id);
    if (!def.licence || def.licence === 'unknown') report('no licence');
    if (!def.title.trim()) report('no title');
    if (def.licence !== 'original' && !def.provenance.credit && !def.provenance.author && !def.provenance.source)
      report('third-party asset has no author, credit or source');
    if (def.variants.length === 0) report('no variants');
    const seen = new Set<string>();
    for (const v of def.variants) {
      if (v.path.startsWith('/') || v.path.includes('..'))
        report(`variant path '${v.path}' must be relative to public/`);
      const owner = paths.get(v.path);
      if (owner !== undefined && owner !== def.id) report(`variant '${v.path}' is also claimed by ${owner}`);
      paths.set(v.path, def.id);
      if (seen.has(v.path)) report(`variant '${v.path}' listed twice`);
      seen.add(v.path);
      const name = v.path.slice(v.path.lastIndexOf('/') + 1);
      const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
      const extOk = ext === v.format || (ext === 'jpeg' && v.format === 'jpg') || (ext === '' && v.format === 'txt');
      if (!extOk) report(`variant '${v.path}' is not ${v.format}`);
      if (v.sha256 !== undefined && !SHA_PATTERN.test(v.sha256)) report(`variant '${v.path}' has a malformed sha256`);
      if (def.kind === 'texture' && !(v.width && v.width > 0)) report(`texture variant '${v.path}' has no width`);
    }
  }
  return problems;
}
