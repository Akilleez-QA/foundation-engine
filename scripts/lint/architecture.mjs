#!/usr/bin/env node
// scripts/lint/architecture.mjs: the architecture ratchet (STANDARD §3 STD-LAY-9, STD-LAY-10; §16.3 STD-CNF-8).
//
// Counts each owned-global pattern outside the folder that owns it, plus the layer-rule violations of
// scripts/lint/layers.mjs, per top folder of src/. Known counts live in sharded baselines:
// lint-baseline/<rule>/<top-folder>.json. A count may fall but never rise: the script fails only when a folder's
// count is above its shard (a folder with no shard has a baseline of 0, STD-CNF-7). A `strict` rule has no baseline:
// any match outside `allow` fails. It also checks that every feature and pack manifest's static import closure holds
// only kernel types, core content and the folder's own content (STD-MOD-7).
//
//   node scripts/lint/architecture.mjs            report + ratchet check
//   node scripts/lint/architecture.mjs --lower    rewrite shards whose count fell (never raises)
//   node scripts/lint/architecture.mjs --init-rule=<name>   write the first shards of a NEW rule (never rewrites)
import {readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {check as layerCheck, sourceFiles} from './layers.mjs';
import {checkManifestClosures} from './manifests.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = join(ROOT, 'src');
const BASELINE = join(ROOT, 'lint-baseline');
const ROOT_SHARD = '_root'; // files directly under src/

const args = new Set(process.argv.slice(2));
const MODE = args.has('--lower') ? 'lower' : 'check';
const INIT_RULE = process.argv.find(a => a.startsWith('--init-rule='))?.slice('--init-rule='.length);

/**
 * Owned-global rules (STD-LAY-10). `allow` entries are src-relative paths; a trailing slash allows a folder.
 * Patterns run on source with comments removed.
 */
export const RULES = [
  // The frame loop is the only requestAnimationFrame (STD-RUN-1).
  {
    name: 'raf-outside-loop',
    strict: true,
    re: /\brequestAnimationFrame\s*\(/g,
    allow: ['core/activity/loop.ts', 'dev/'],
  },
  // Randomness and the wall clock belong to time (STD-SIM-4, STD-SIM-9).
  {name: 'math-random', strict: true, re: /\bMath\.random\s*\(/g, allow: ['core/rng.ts']},
  {
    name: 'wall-clock',
    strict: true,
    re: /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)/g,
    allow: ['core/clock.ts', 'core/save/'],
  },
  {
    name: 'perf-now',
    strict: true,
    re: /\bperformance\.now\s*\(/g,
    allow: ['core/clock.ts', 'core/activity/loop.ts', 'core/app.ts', 'dev/'],
  },
  // Test state is read on demand through probes, never serialised into the DOM (STD-TST-7).
  {name: 'dataset-json', strict: true, re: /\.dataset(?:\.[\w$]+|\[[^\]]+\])\s*=\s*JSON\.stringify\b/g, allow: []},
  // Cross-module notifications use the typed bus (STD-EVT-1).
  {name: 'custom-event', strict: true, re: /\bnew\s+(?:CustomEvent|HashChangeEvent)\s*[(<]/g, allow: []},
  // Persistent and session storage belong to the save store's storage port.
  {name: 'local-storage', strict: true, re: /\b(?:localStorage|sessionStorage)\b/g, allow: ['core/save/']},
  // Large-world binary records belong to the chunk port beside it (docs/recipes/store-large-world-records.md).
  {name: 'indexed-db', strict: true, re: /\bindexedDB\b/g, allow: ['core/save/chunk-port.ts']},
  // One render path (ADR 0034, STD-REN-1): WebGL2 only, contexts created only by the renderer pool.
  {
    name: 'three-webgpu',
    strict: true,
    re: /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"`]three\/(?:webgpu|tsl)['"`]/g,
    allow: [],
  },
  {
    name: 'webgl-renderer',
    strict: true,
    re: /\bnew\s+(?:[\w$]+\.)?WebGLRenderer\s*\(/g,
    allow: ['platform/render/renderer-pool.ts'],
  },
  // GPU context loss is recovered once, in render (STD-REN-5).
  {
    name: 'context-lost-listener',
    strict: true,
    re: /\baddEventListener\s*\(\s*['"`]webglcontextlost['"`]/g,
    allow: ['platform/render/'],
  },
  // Recurring timers for game work belong to nobody (the clock or the save store schedule).
  {name: 'set-interval', strict: true, re: /\bsetInterval\s*\(/g, allow: ['core/clock.ts']},
  // Motion reads Calm from the frame or the settings service, never the platform (STD-SET-2, STD-SET-4).
  {
    name: 'calm-read',
    strict: true,
    re: /\bmatchMedia\s*\(\s*['"`]\(\s*prefers-reduced-motion|\bclassList\.contains\s*\(\s*['"`]still-mode['"`]/g,
    allow: ['core/settings/'],
  },
  // Global key listeners belong to input and the UI shell (STD-RUN-26).
  {
    name: 'global-keydown',
    strict: true,
    re: /\b(?:window|document|ownerDocument)\.addEventListener\s*\(\s*['"`]keydown['"`]/g,
    allow: ['platform/ui/', 'platform/input/', 'dev/'],
  },
  // File loading and decoding belong to assets (STD-REN-31).
  {name: 'texture-loader', strict: true, re: /\bnew\s+(?:[\w$]+\.)?TextureLoader\s*\(/g, allow: ['platform/assets/']},
  // Thread creation belongs to workers (STD-RUN-35).
  {name: 'new-worker', strict: true, re: /\bnew\s+(?:SharedWorker|Worker)\s*\(/g, allow: ['platform/workers/']},
  // Audio contexts belong to audio (STD-SYS-16): one owner, so mute and the silent test flag hold everywhere.
  {
    name: 'audio-context',
    strict: true,
    re: /\bnew\s+(?:window\.)?(?:AudioContext|webkitAudioContext|OfflineAudioContext)\s*\(/g,
    allow: ['platform/audio/'],
  },
  // Build flags are read once (core/env.ts).
  {name: 'dev-flag-cast', strict: true, re: /\bimport\.meta\s+as\b/g, allow: ['core/env.ts']},
  // Literal user-facing text (STD-STR-1): words go through `t()`. Ratchet: a per-folder baseline that may only fall.
  {name: 'literal-ui-text', allow: ['dev/'], match: (code, rel) => literalUiText(code, rel)},
];

/** The source line that holds `index`. */
const lineAtIndex = (text, index) => {
  const end = text.indexOf('\n', index);
  return text.slice(text.lastIndexOf('\n', index) + 1, end < 0 ? text.length : end);
};

/** Matches of one rule in comment-free source, after its optional `keep(match, line)` filter. A rule with `match`
 *  finds its own matches (objects with `index`); `rel` is the src-relative path. */
export function ruleMatches(rule, code, rel = '') {
  if (rule.match) return rule.match(code, rel);
  const all = [...code.matchAll(rule.re)];
  return rule.keep ? all.filter(m => rule.keep(m[0], lineAtIndex(code, m.index))) : all;
}

/** Where literal text reaches a reader: DOM text and labels, HTML, and the words properties of feature and content rows. */
const TEXT_SINK =
  /(?:\.(?:textContent|innerText|title|placeholder|alt|ariaLabel|ariaDescription)\s*\+?=\s*|\.setAttribute\s*\(\s*['"](?:aria-(?:label|description|roledescription|valuetext|placeholder)|title|placeholder|alt)['"]\s*,\s*)(?=['"`])/g;
const HTML_SINK = /(?:\.(?:innerHTML|outerHTML)\s*\+?=\s*|\.insertAdjacentHTML\s*\(\s*['"][\w-]+['"]\s*,\s*)(?=['"`])/g;
const ROW_WORDS = /(?<![\w$.])(?:label|title|goal|name|copy|text)\s*:\s*(?=['"`])/g;
/** Attributes a reader meets (labels, not id references such as aria-labelledby): inside HTML they are words too. */
const HTML_WORD_ATTRS =
  /\s(?:aria-(?:label|description|roledescription|valuetext|placeholder)|alt|title|placeholder)\s*=\s*(["'])(.*?)\1/g;

/** The index just past the `}` closing the `${` hole that opens at `i` (nested strings and templates skipped). */
function holeEnd(code, i) {
  let depth = 1,
    j = i + 2;
  for (; j < code.length && depth; j++) {
    const d = code[j];
    if (d === '{') depth++;
    else if (d === '}') depth--;
    else if (d === "'" || d === '"' || d === '`') j = literalEnd(code, j);
  }
  return j;
}
/** The index of the closing quote of the literal starting at `i` (code.length if unterminated). */
function literalEnd(code, i) {
  const q = code[i];
  for (let j = i + 1; j < code.length; j++) {
    const c = code[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === q) return j;
    if (q === '`' && c === '$' && code[j + 1] === '{') j = holeEnd(code, j) - 1;
  }
  return code.length;
}
/** The text of the string or template literal starting at `i` (a quote), each `${…}` hole blanked. */
export function literalAt(code, i) {
  const q = code[i];
  let out = '';
  for (let j = i + 1; j < code.length; j++) {
    const c = code[j];
    if (c === '\\') {
      out += code[j + 1] ?? '';
      j++;
      continue;
    }
    if (c === q) break;
    if (q === '`' && c === '$' && code[j + 1] === '{') {
      j = holeEnd(code, j) - 1;
      out += ' ';
      continue;
    }
    out += c;
  }
  return out;
}
const hasWords = text => /[A-Za-z]{2}/.test(text);
/** The words of an HTML literal: its text between tags and its labelling attributes. */
const htmlWords = html =>
  html.replace(/<[^>]*>/g, tag => [...tag.matchAll(HTML_WORD_ATTRS)].map(m => ` ${m[2]} `).join(' ') || ' ');

/**
 * Literal user-facing text (STD-STR-1). A heuristic over comment-free source:
 * a string or template literal with a word (two letters in a row, outside `${…}` holes) written to `textContent`,
 * `innerText`, `title`, `placeholder`, `alt` or an ARIA label or description (property or `setAttribute`); an HTML literal
 * (`innerHTML`, `outerHTML`, `insertAdjacentHTML`) whose text or labelling attributes have a word; and, in
 * `features/**` and `content/**`, a `label`, `title`, `goal`, `name`, `copy` or `text` property given a literal
 * with a word. Only the literal right after the sink counts (not each arm of a ternary).
 */
export function literalUiText(code, rel = '') {
  const hits = [];
  const check = (re, words) => {
    for (const m of code.matchAll(re)) {
      if (hasWords(words(literalAt(code, m.index + m[0].length)))) hits.push({index: m.index, 0: m[0]});
    }
  };
  check(TEXT_SINK, t => t);
  check(HTML_SINK, htmlWords);
  // In rows, a dotted lowercase literal is a string key ('game.jump', 'engine.shell.menu@detailed'), not words.
  if (/^(?:features|content)\//.test(rel))
    check(ROW_WORDS, t => (/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+(?:@detailed)?$/.test(t) ? '' : t));
  return hits.sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------- source scan

/** Blank out comments, keeping strings, template literals, regex literals and newlines. */
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let prev = ''; // last significant char emitted, for regex-vs-divide
  const regexAfter = new Set([
    '',
    '(',
    ',',
    '=',
    ':',
    '[',
    '!',
    '&',
    '|',
    '?',
    '{',
    '}',
    ';',
    '+',
    '-',
    '*',
    '%',
    '<',
    '>',
    '~',
    '^',
  ]);
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++;
        else if (c !== '`' && src[j] === '\n') break;
        j++;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      prev = c;
      continue;
    }
    if (c === '/' && (regexAfter.has(prev) || /\b(?:return|typeof|case|in|of)\s*$/.test(out.slice(-8)))) {
      let j = i + 1;
      let cls = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) break;
        j++;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      prev = '/';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'generated' && name !== 'testing') walk(p, files);
    } else if (
      /\.(?:ts|tsx|js|mjs)$/.test(name) &&
      !/\.test\.[tj]sx?$/.test(name) &&
      !name.endsWith('.d.ts') &&
      !/^test-[\w-]+\.ts$/.test(name)
    )
      files.push(p);
  }
  return files;
}

const srcRel = p => relative(SRC, p).split(sep).join('/');
const topFolder = rel => (rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : ROOT_SHARD);
const allowed = (rel, allow) => allow.some(a => (a.endsWith('/') ? rel.startsWith(a) : rel === a));
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** counts[rule][folder] = {count, files: {rel: n}}, plus hits for messages. */
export function scanPatterns(root = SRC) {
  const counts = {};
  const hits = {};
  for (const r of RULES) {
    counts[r.name] = {};
    hits[r.name] = {};
  }
  if (!existsSync(root)) return {counts, hits};
  for (const file of walk(root).sort()) {
    const rel = relative(root, file).split(sep).join('/');
    const folder = topFolder(rel);
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const r of RULES) {
      if (allowed(rel, r.allow)) continue;
      for (const m of ruleMatches(r, code, rel)) {
        const bucket = (counts[r.name][folder] ??= {count: 0, files: {}});
        bucket.count++;
        bucket.files[rel] = (bucket.files[rel] ?? 0) + 1;
        (hits[r.name][folder] ??= []).push(`src/${rel}:${lineOf(code, m.index)}`);
      }
    }
  }
  return {counts, hits};
}

/** The layer rules' violations (scripts/lint/layers.mjs), counted like pattern rules (never strict: a legacy area
 *  a game adopts may start with a baseline; the engine itself has none). */
function scanLayers(counts, hits, names) {
  for (const v of layerCheck(sourceFiles())) {
    if (!counts[v.rule]) {
      counts[v.rule] = {};
      hits[v.rule] = {};
      names.push(v.rule);
    }
    const folder = topFolder(v.from);
    const bucket = (counts[v.rule][folder] ??= {count: 0, files: {}});
    bucket.count++;
    bucket.files[v.from] = (bucket.files[v.from] ?? 0) + 1;
    (hits[v.rule][folder] ??= []).push(`src/${v.from} → ${v.to}`);
  }
}

// ------------------------------------------------------------------ baselines

function readShards(rule) {
  const dir = join(BASELINE, rule);
  const shards = {};
  if (!existsSync(dir)) return shards;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    shards[f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  }
  return shards;
}

function writeShard(rule, folder, bucket) {
  const dir = join(BASELINE, rule);
  mkdirSync(dir, {recursive: true});
  const files = Object.fromEntries(Object.entries(bucket.files).sort(([a], [b]) => a.localeCompare(b)));
  const body = {rule, folder: folder === ROOT_SHARD ? 'src/*' : `src/${folder}/`, count: bucket.count, files};
  writeFileSync(join(dir, `${folder}.json`), `${JSON.stringify(body, null, 2)}\n`);
}

function removeShard(rule, folder) {
  rmSync(join(BASELINE, rule, `${folder}.json`), {force: true});
}

// ----------------------------------------------------------------------- main

function main() {
  const {counts, hits} = scanPatterns();
  const ruleNames = RULES.map(r => r.name);
  const layerRules = [];
  scanLayers(counts, hits, layerRules);
  const failures = checkManifestClosures(ROOT);
  const lowered = [];
  const pad = (s, w) => String(s).padEnd(w);
  const total = rule => Object.values(counts[rule] ?? {}).reduce((a, b) => a + b.count, 0);
  const fileCount = rule => new Set(Object.values(counts[rule] ?? {}).flatMap(b => Object.keys(b.files))).size;

  function ratchet(rule) {
    const strict = RULES.some(r => r.name === rule && r.strict);
    const shards = strict ? {} : readShards(rule);
    const initHere = !strict && INIT_RULE === rule && !Object.keys(shards).length;
    const folders = new Set([...Object.keys(shards), ...Object.keys(counts[rule] ?? {})]);
    let base = 0;
    for (const folder of [...folders].sort()) {
      const now = counts[rule]?.[folder] ?? {count: 0, files: {}};
      const was = shards[folder]?.count ?? 0;
      base += was;
      if (initHere) {
        if (now.count > 0) writeShard(rule, folder, now);
        continue;
      }
      if (now.count > was) {
        const added = Object.entries(now.files)
          .filter(([f, n]) => n > (shards[folder]?.files?.[f] ?? 0))
          .map(([f]) => f);
        failures.push(
          `${rule}${strict ? ' (error mode)' : ''} in ${folder === ROOT_SHARD ? 'src/*' : `src/${folder}/`}: ${now.count} > baseline ${was}` +
            (added.length ? ` (grew in: ${added.map(f => `src/${f}`).join(', ')})` : '') +
            `\n      ${(hits[rule]?.[folder] ?? [])
              .filter(h => added.some(f => h.includes(`src/${f}`)))
              .slice(0, 12)
              .join('\n      ')}`,
        );
      } else if (now.count < was) {
        lowered.push(`${rule}/${folder}`);
        if (MODE === 'lower') {
          if (now.count > 0) writeShard(rule, folder, now);
          else removeShard(rule, folder);
        }
      }
    }
    return initHere ? total(rule) : base;
  }

  console.log(
    'Architecture ratchet (STD-LAY-9, STD-LAY-10) — counts outside the owning folder; a count may only fall.',
  );
  console.log(`  ${pad('rule', 28)}${pad('count', 8)}${pad('files', 8)}baseline`);
  for (const rule of [...ruleNames, ...layerRules]) {
    const base = ratchet(rule);
    console.log(`  ${pad(rule, 28)}${pad(total(rule), 8)}${pad(fileCount(rule), 8)}${base}`);
  }
  if (lowered.length) {
    console.log(
      MODE === 'lower'
        ? `lint:arch: lowered ${lowered.length} shard(s): ${lowered.join(', ')}`
        : `lint:arch: ${lowered.length} shard(s) can be lowered (run \`npm run lint:arch -- --lower\`): ${lowered.join(', ')}`,
    );
  }
  if (failures.length) {
    console.error(`\nlint:arch: FAILED — ${failures.length} problem(s) (STD-CNF-8):`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('lint:arch: ok');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
