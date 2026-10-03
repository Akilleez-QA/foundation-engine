/**
 * core/save/validate.ts: the `saveSections` registry's validation (boot phase 'validate'; STD-SAV-4, -5, -10).
 * Pure. The registry calls it as its `problems` hook; the save tests call it on example sections.
 */
import type {SaveSection} from './section';
import {savePrefixes, type SavePrefixes} from './prefixes';

/** Lowercase, namespaced by owner: 'inventory.items', 'progression.wallet', 'core.clock'. */
const SECTION_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;

/** Every problem with a set of section definitions; empty when the set is valid. `samplePlayer` fills per-player keys. */
export function sectionProblems(
  defs: readonly SaveSection<unknown>[],
  samplePlayer = '7',
  prefixes: SavePrefixes = savePrefixes(),
): string[] {
  const underPrefix = (k: string) => prefixes.reset.some(p => k.startsWith(p));
  const out: string[] = [];
  const ids = new Map<string, number>(),
    aliasOwner = new Map<string, string>();
  for (const d of defs) ids.set(d.id, (ids.get(d.id) ?? 0) + 1);
  for (const [id, n] of ids) if (n > 1) out.push(`${id}: ${n} sections share this id`);
  for (const d of defs) {
    const at = d.id + ': ';
    if (!SECTION_ID.test(d.id)) out.push(at + 'id must be lowercase and namespaced (owner.name)');
    if (d.id.includes('|')) out.push(at + "id must not contain '|' (the envelope key separator)");
    if (!Number.isInteger(d.version) || d.version < 1) out.push(at + 'version must be an integer ≥ 1');
    for (let v = 1; v < d.version; v++)
      if (typeof d.migrations?.[v] !== 'function') out.push(`${at}no migration from v${v} to v${v + 1}`);
    for (const a of d.aliases ?? []) {
      if (ids.has(a)) out.push(`${at}alias ${a} collides with a section id`);
      const other = aliasOwner.get(a);
      if (other && other !== d.id) out.push(`${at}alias ${a} is also an alias of ${other}`);
      aliasOwner.set(a, d.id);
    }
    const b = d.legacy;
    if (b) {
      if (!Number.isInteger(b.fromVersion) || b.fromVersion < 1 || b.fromVersion > d.version)
        out.push(at + 'legacy.fromVersion must be between 1 and version');
      if ((b.mode === 'live' || b.mirror) && typeof b.encode !== 'function')
        out.push(at + 'a live or mirrored legacy binding needs encode');
      if (b.mode === 'live' && d.aliases?.length) out.push(at + 'a live binding cannot have aliases');
    }
    const keys = [
      prefixes.envelope + (d.scope === 'player' ? 'p:' + samplePlayer : d.scope) + '|' + d.id,
      ...(b?.keys(d.scope === 'player' ? samplePlayer : '') ?? []),
      ...(d.legacyKeys ?? []),
    ];
    for (const k of keys)
      if (!underPrefix(k)) out.push(`${at}key ${k} is outside the reset prefixes ${prefixes.reset.join(', ')}`);
    if (b?.mode === 'live' && b.keys(samplePlayer).length !== 1)
      out.push(at + 'a live binding stores in exactly one key');
  }
  return out;
}
