#!/usr/bin/env node
/**
 * npm run strings (ADR 0021, ADR 0043). Merges the `en` string shards into
 *   - the key types `src/core/i18n/keys.gen.ts`, so `t()` requires exactly each key's variables;
 *   - the narration catalogue `src/generated/strings/en/narration.json` (every `narration.*` key → its text), which the
 *     game fetches before the first spoken line instead of bundling it in the first-load chunk;
 *   - `src/generated/strings/compact-ids.json`, the production builds' short id per key (compact-keys.mjs).
 *
 * Shards (all `en`; other locales are translations of these keys and never add keys), in any layer folder
 * (`src/{platform,kits,features,packs}` and the starter under `examples/*\/src`):
 *   <folder>/strings/en.json   and  <folder>/strings/<module>/en.json    full keys, e.g. "shell.map.open"
 *   <folder>/narration/en.json                                           narration keys, stored as "narration.<key>"
 * `key@detailed` is the detailed reading-level variant of `key` (STD-STR-3): it needs its base key and may use only
 * the base key's variables. A key defined by two shards is an error that names both files.
 *
 * Usage: node scripts/strings.mjs [--root <repo>] [--out <keys file>] [--narration-out <file>] [--ids-out <file>] [--check]
 *   --check  exit 1 (writing nothing) when an output file is missing or stale.
 * The outputs are generated and not committed (ADR 0043). The Vite plugin in vite.config.ts runs this script at the
 * start of every build and dev server, so `npm run build`, the gate and the deploy guard always see current files.
 */
import './lib/node-version.mjs';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Loaded after the Node version guard: a static `.ts` import would fail on older Node before the guard could run.
const { parseMessage, messageVars } = await import('../src/core/i18n/format.ts');

const DETAILED = '@detailed';

function option(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }

/** The shard files under `root`, as {file, kind}. Sorted, so the output is stable. */
export function findShards(root) {
  const shards = [];
  const dirs = ['features', 'packs', 'kits', 'platform'].map(layer => join(root, 'src', layer));
  const examples = join(root, 'examples');
  if (existsSync(examples)) for (const e of readdirSync(examples).sort()) dirs.push(join(examples, e, 'src'));
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    // Nested owners keep their own shards.
    for (const rel of readdirSync(dir, {recursive:true}).sort()) {
      const match = /(?:^|[/\\])(strings|narration)[/\\](?:.*[/\\])?en\.json$/.exec(rel);
      if (match) shards.push({file:join(dir,rel),kind:match[1]});
    }
  }
  return shards;
}

/** Merge shards into one `en` catalogue. Returns {catalog, errors}. */
export function mergeShards(root, shards) {
  const catalog = new Map(), owner = new Map(), errors = [];
  for (const { file, kind } of shards) {
    const where = relative(root, file);
    let data;
    try { data = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { errors.push(`${where}: not valid JSON (${e.message})`); continue; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { errors.push(`${where}: must be a JSON object of key → text`); continue; }
    for (const [raw, text] of Object.entries(data)) {
      if (typeof text !== 'string') { errors.push(`${where}: "${raw}" must be a string`); continue; }
      const key = kind === 'narration' ? 'narration.' + raw : raw;
      if (!/^[a-z0-9][\w.\-]*(@detailed)?$/i.test(key) || (kind === 'strings' && key.startsWith('narration.'))) {
        errors.push(`${where}: "${raw}" is not a valid ${kind === 'strings' ? 'string' : 'narration'} key`); continue;
      }
      if (owner.has(key)) { errors.push(`${where}: "${key}" is already defined in ${owner.get(key)}`); continue; }
      owner.set(key, where); catalog.set(key, text);
    }
  }
  return { catalog, owner, errors };
}

/** Key → variables ({name: 'number' | 'text'}) for every base key, checking detailed variants against their base. */
export function keyParams(catalog, owner) {
  const params = new Map(), errors = [];
  const varsOf = key => { try { return messageVars(parseMessage(catalog.get(key))); } catch (e) { errors.push(`${owner.get(key)}: "${key}": ${e.message}`); return null; } };
  for (const key of [...catalog.keys()].filter(k => !k.endsWith(DETAILED)).sort()) { const v = varsOf(key); if (v) params.set(key, v); }
  for (const key of [...catalog.keys()].filter(k => k.endsWith(DETAILED)).sort()) {
    const base = key.slice(0, -DETAILED.length);
    if (!catalog.has(base)) { errors.push(`${owner.get(key)}: "${key}" has no base text "${base}"`); continue; }
    const v = varsOf(key), b = params.get(base);
    if (!v || !b) continue;
    for (const [name, type] of v) {
      if (!b.has(name)) errors.push(`${owner.get(key)}: "${key}" uses {${name}}, which "${base}" does not`);
      else if (type === 'number' && b.get(name) !== 'number') b.set(name, 'number');
    }
  }
  return { params, errors };
}

export function renderKeys(params) {
  const q = s => JSON.stringify(s);
  const lines = [
    '// GENERATED by scripts/strings.mjs from the en string and narration shards. Do not edit; run `node scripts/strings.mjs`.',
    '// Each key maps to exactly the variables its text uses; `never` means none.',
    'export interface StringParams {',
  ];
  for (const [key, vars] of params) {
    const body = vars.size ? '{ ' + [...vars].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([n, t]) => `${q(n)}: ${t === 'number' ? 'number' : 'string | number'}`).join('; ') + ' }' : 'never';
    lines.push(`  ${q(key)}: ${body};`);
  }
  lines.push('}', 'export type StringKey = keyof StringParams;',
    'export type NarrationCatalogKey = Extract<StringKey, `narration.${string}`>;',
    `export const stringKeyCount = ${params.size};`, '');
  return lines.join('\n');
}

/** The `en` narration catalogue: every `narration.*` key (and variant) → its text, in shard order. */
export function renderNarration(catalog) {
  const out = {};
  for (const [key, text] of catalog) if (key.startsWith('narration.')) out[key] = text;
  return JSON.stringify(out) + '\n';
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', DIGITS = LETTERS + '0123456789';
/** The n-th compact id: a letter, then letters or digits (a JS identifier, so a catalogue key needs no quotes). */
export function compactId(n) {
  let id = LETTERS[n % LETTERS.length];
  for (n = Math.floor(n / LETTERS.length); n > 0; n = Math.floor((n - 1) / DIGITS.length)) id += DIGITS[(n - 1) % DIGITS.length];
  return id;
}

/**
 * Compact ids for production builds: every string key except narration's maps to a short identifier, in
 * key order. `scripts/compact-keys.mjs` rewrites the keys to these ids in the shipped code and catalogues; dev and test
 * builds, and `keys.gen.ts`, keep the readable names. Narration keys stay readable (they are composed at run time).
 */
export function renderCompactIds(params) {
  const ids = {};
  let n = 0;
  for (const key of params.keys()) if (!key.startsWith('narration.')) ids[key] = compactId(n++);
  return JSON.stringify(ids) + '\n';
}

export function generate(root) {
  const shards = findShards(root);
  const merged = mergeShards(root, shards);
  const { params, errors } = keyParams(merged.catalog, merged.owner);
  return { source: renderKeys(params), narration: renderNarration(merged.catalog), ids: renderCompactIds(params), errors: [...merged.errors, ...errors], keys: params.size, shards: shards.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const root = resolve(option(args, '--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const out = resolve(option(args, '--out') ?? join(root, 'src/core/i18n/keys.gen.ts'));
  const narrationOut = resolve(option(args, '--narration-out') ?? join(root, 'src/generated/strings/en/narration.json'));
  const idsOut = resolve(option(args, '--ids-out') ?? join(root, 'src/generated/strings/compact-ids.json'));
  const { source, narration, ids, errors, keys, shards } = generate(root);
  if (errors.length) { console.error(`strings: ${errors.length} problem(s)\n  ` + errors.join('\n  ')); process.exit(1); }
  const outputs = [[out, source], [narrationOut, narration], [idsOut, ids]];
  const names = outputs.map(([file]) => relative(root, file)).join(', ');
  if (args.includes('--check')) {
    const stale = outputs.filter(([file, text]) => !existsSync(file) || readFileSync(file, 'utf8') !== text).map(([file]) => relative(root, file));
    if (stale.length) { console.error(`strings: ${stale.join(' and ')} missing or stale; run node scripts/strings.mjs`); process.exit(1); }
    console.log(`strings: ${names} current (${keys} keys from ${shards} shards)`);
  } else {
    // Unchanged files are not rewritten, so a dev server does not see a change it did not make.
    for (const [file, text] of outputs) {
      if (existsSync(file) && readFileSync(file, 'utf8') === text) continue;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    console.log(`strings: wrote ${names} (${keys} keys from ${shards} shards)`);
  }
}
