/**
 * core/settings/features.ts: feature flags, resolved URL > device override > detect() > default (STD-SET-3).
 * Dev-stage flags are always off in production; a flag whose `requires` are off is off.
 */
import type {SaveSection} from '../save/section';

export interface FeatureDef {
  id: string; // 'ui.minimap', 'dev.test-api'
  stage: 'dev' | 'beta' | 'stable';
  default: boolean;
  description: string;
  requires?: string[]; // other flags
  /** Content-derived: on when registered content needs it (a content pack that uses a feature). */
  detect?: () => boolean;
}
export type FlagSource = 'url' | 'override' | 'detected' | 'default' | 'requires-off' | 'dev-only';
export interface Features {
  enabled(id: string): boolean;
  explain(): {id: string; on: boolean; source: FlagSource}[];
}

export function createFeatures(
  defs: readonly FeatureDef[],
  ctx: {dev: boolean; url: string; overrides: Readonly<Record<string, boolean>>},
): Features {
  const byId = new Map(defs.map(d => [d.id, d]));
  const fromUrl = new Map<string, boolean>();
  const q = new URL(ctx.url, 'http://x').searchParams.get('flags') ?? '';
  for (const t of q
    .split(',')
    .map(s => s.trim())
    .filter(Boolean))
    fromUrl.set(t.replace(/^-/, ''), !t.startsWith('-'));
  const memo = new Map<string, {on: boolean; source: FlagSource}>();
  const resolve = (id: string, seen = new Set<string>()): {on: boolean; source: FlagSource} => {
    const hit = memo.get(id);
    if (hit) return hit;
    const d = byId.get(id);
    if (!d || seen.has(id)) return {on: false, source: 'default'};
    seen.add(id);
    let r: {on: boolean; source: FlagSource} =
      fromUrl.has(id) && (ctx.dev || d.stage !== 'dev')
        ? {on: fromUrl.get(id)!, source: 'url'}
        : Object.hasOwn(ctx.overrides, id)
          ? {on: ctx.overrides[id]!, source: 'override'} // own key just checked
          : d.detect
            ? {on: d.detect(), source: 'detected'}
            : {on: d.default, source: 'default'};
    if (r.on && d.stage === 'dev' && !ctx.dev && r.source !== 'url') r = {on: false, source: 'dev-only'};
    if (r.on && d.requires?.some(x => !resolve(x, new Set(seen)).on)) r = {on: false, source: 'requires-off'};
    memo.set(id, r);
    return r;
  };
  return {enabled: id => resolve(id).on, explain: () => defs.map(d => ({id: d.id, ...resolve(d.id)}))};
}

/** Problems in a set of flag definitions: unique ids, and every `requires` names a known flag. */
export function featureProblems(defs: readonly FeatureDef[]): string[] {
  const ids = new Set<string>(),
    out: string[] = [];
  for (const d of defs) {
    if (ids.has(d.id)) out.push(`${d.id}: duplicate id`);
    ids.add(d.id);
  }
  for (const d of defs)
    for (const r of d.requires ?? []) if (!ids.has(r)) out.push(`${d.id}: requires unknown flag ${r}`);
  const visited = new Set<string>(),
    visiting = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      out.push(`${id}: cyclic feature requirement`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of defs.find(d => d.id === id)?.requires ?? []) visit(dep);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
  return out;
}

/** The device overrides (a settings or guardian screen; device scope, never exported): flag id to on/off. */
export const featureOverridesSection: SaveSection<Record<string, boolean>> = {
  id: 'settings.flags',
  scope: 'device',
  version: 1,
  initial: () => ({}),
  parse: raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid feature overrides');
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'boolean') out[k] = v;
    return out;
  },
};
