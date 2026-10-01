/**
 * Compact string keys in production builds (first-load budget). A key such as `shell.map.zoom-in` is written twice in
 * the first-load JS: at the `t()` call and in the bundled catalogue. A production build replaces both with the key's
 * short id from `src/generated/strings/compact-ids.json` (written by scripts/strings.mjs). Dev and test builds, tests and `keys.gen.ts` keep the readable names.
 *
 * Rules the rewrite relies on, checked on every production bundle (`generateBundle`):
 *   - a key is written whole, as a string literal (`t('shell.map.zoom-in')`), never composed (`shell.return.${id}`);
 *   - no readable key is left in the shipped JS.
 * Narration keys are not shortened: they are composed at run time and their catalogue is fetched, not bundled.
 */
import { readFileSync } from 'node:fs';

const DETAILED = '@detailed';
const QUOTED = /(['"`])([A-Za-z0-9][\w.\-]*\.[\w.\-]*(?:@detailed)?)\1/g;
const idOf = (ids, key) => {
  const base = key.endsWith(DETAILED) ? key.slice(0, -DETAILED.length) : key;
  return Object.hasOwn(ids, base) ? ids[base] + (base === key ? '' : DETAILED) : undefined;
};

/** Source with every quoted literal that is exactly a key (or its detailed variant) replaced by the key's id. */
export function compactSource(code, ids) {
  return code.replace(QUOTED, (whole, q, key) => { const id = idOf(ids, key); return id === undefined ? whole : q + id + q; });
}

/** A string shard (JSON text) with its keys replaced by their ids. A key without an id is an error. */
export function compactCatalog(json, ids, where = 'catalogue') {
  const out = {};
  for (const [key, text] of Object.entries(JSON.parse(json))) {
    const id = idOf(ids, key);
    if (id === undefined) throw new Error(`${where}: "${key}" has no compact id; run node scripts/strings.mjs`);
    out[id] = text;
  }
  return JSON.stringify(out);
}

/** Problems in shipped JS: readable keys left behind, and keys composed from a template (`shell.return.${…}`). */
export function compactProblems(code, ids) {
  const problems = [];
  for (const m of code.matchAll(QUOTED)) if (idOf(ids, m[2]) !== undefined) problems.push(`readable key "${m[2]}"`);
  const keys = Object.keys(ids);
  for (const m of code.matchAll(/`((?:[\w-]+\.)+[\w-]*)\$\{/g)) if (keys.some(k => k.startsWith(m[1]))) problems.push(`composed key \`${m[1]}\${…}\``);
  return problems;
}

const SHARD = /[\\/]src[\\/](?:(?:features|packs|kits|platform)[\\/])?(?:[\w-]+[\\/])*strings[\\/](?:[\w-]+[\\/])*[\w-]+\.json$/;
const SOURCE = /[\\/]src[\\/].*\.(?:ts|tsx|js|mjs)$/;

/** The Vite plugin: production builds only. `idsFile` is read when the first module is transformed. */
export function compactKeys(idsFile) {
  let on = false, ids = null;
  const load = () => (ids ??= JSON.parse(readFileSync(idsFile, 'utf8')));
  return {
    name: 'engine-compact-keys', enforce: 'pre', apply: 'build',
    configResolved(config) { on = config.mode === 'production'; },
    transform(code, id) {
      if (!on) return null;
      const file = id.split('?')[0];
      if (SHARD.test(file)) return { code: compactCatalog(code, load(), file), map: null };
      if (SOURCE.test(file) && !file.includes('/node_modules/')) { const out = compactSource(code, load()); return out === code ? null : { code: out, map: null }; }
      return null;
    },
    generateBundle(_options, bundle) {
      if (!on) return;
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        const problems = compactProblems(chunk.code, load());
        if (problems.length) this.error(`compact string keys: ${chunk.fileName}: ${[...new Set(problems)].slice(0, 12).join('; ')}`);
      }
    },
  };
}
