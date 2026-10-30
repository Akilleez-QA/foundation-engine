#!/usr/bin/env node
// scripts/lint/layers.mjs: the layer rules (STANDARD chapter 3, STD-LAY-1 to STD-LAY-9), zero-dependency.
//
// Reads every import (static, `export … from`, `import type`, dynamic `import()`) of every source file under src/,
// resolves relative specifiers, and checks the dependency direction:
//
//   L0 core/      imports nothing above L0                         (core-is-bottom)
//   L1 platform/  imports only core/ (and the rendering library)   (platform-knows-no-game)
//   L2 domain/    imports only core/ and platform/workers/; never the rendering library or the DOM layer folders
//                 (domain-below-presentation, domain-no-three); domain/math/ imports nothing (math-pure)
//   L2.5 kits/    optional genre kits on the author API: may import core/, platform/, domain/, author/ and other kits;
//                 never features/, packs/, app/, dev/              (kits-below-features)
//   L3 features/<x>/ never imports another feature or a pack       (feature-isolation); packs likewise
//   L4 app/       imports a feature only through its manifest `features/<x>/index.ts` (app-imports-manifests-only)
//   content/      imports only types from core/ and domain/        (content-is-data)
//   author/       the author API (`@engine`): imports core/, platform/ and domain/; never a kit, a feature, a pack,
//                 app or dev (author-knows-no-kit, author-below-app). core/ and platform/ never import kits either:
//                 the engine works without any kit, and a kit is only ever chosen by a game.
//   nobody imports app/ or dev/ (test support excepted)            (nobody-imports-app, nobody-imports-dev)
//   game/ and templates/<name>/game/ (outside src/) import only `@engine`, `@kits/<name>`, their own files and JSON
//                 (game-imports-engine-only); only app/ reads the game (the composition root, through `@game`).
//                 The one exception is the three.js escape hatch (src/kits/three/README.md): a game that lists the kit
//                 in `defineGame({ kits: [three()] })` may import `three`, `three/addons/*` and `three/examples/jsm/*`
//                 in its own files; any other game may not (three-needs-kit), and `@kits/three` itself needs the
//                 listing (kit-not-listed). `three/webgpu` and `three/tsl` stay banned for every game (lint:game,
//                 ADR 0078). Engine code never gets this allowance.
//                 Two folders of a game are not game code: <game>/public/ (static files served as they are) is not read,
//                 and <game>/tools/ holds the game's build-time Node scripts (asset generators), which may import
//                 anything; game code never imports a tool (game-imports-no-tools), so no tool reaches the browser.
//                 app/game-files.ts alone (node-only) reads scripts/lib/game-dir.mjs, the one GAME_DIR rule.
//   no import cycles, type-only edges included                     (no-circular)
//
// Test files (*.test.ts) are exempt from the direction rules (they may assemble any layers) but not from cycles.
// Known violations would live in lint-baseline/layers.json, whose counts only fall (STD-LAY-9); the engine starts
// with none, so any violation fails.
//
//   node scripts/lint/layers.mjs            check (exit 1 on a violation)
//   node scripts/lint/layers.mjs --json     print the violations as JSON
import {readFileSync, readdirSync, existsSync, statSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = join(ROOT, 'src');
const EXTS = ['.ts', '.tsx', '.mts', '.js', '.mjs'];

/** Every source file under `dir`, src-relative with '/' separators. */
export function sourceFiles(dir = SRC) {
  const out = [];
  const walk = d => {
    for (const e of readdirSync(d, {withFileTypes: true})) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'generated') walk(p);
      } else if (EXTS.some(x => e.name.endsWith(x)) && !e.name.endsWith('.d.ts'))
        out.push(relative(SRC, p).split(sep).join('/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/** Comments removed, strings kept (so import specifiers survive). */
export function stripComments(code) {
  let out = '',
    i = 0;
  while (i < code.length) {
    const c = code[i],
      n = code[i + 1];
    if (c === '/' && n === '/') {
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += c;
      i++;
      while (i < code.length && code[i] !== q) {
        if (code[i] === '\\') {
          out += code[i++];
        }
        out += code[i++];
      }
      out += code[i++] ?? '';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Import specifiers of one file: [{spec, typeOnly}]. */
export function importsOf(code) {
  const src = stripComments(code),
    out = [];
  for (const m of src.matchAll(
    /(?:^|[;\n}])\s*(import|export)\s+(type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?(['"])([^'"]+)\3/g,
  ))
    out.push({spec: m[4], typeOnly: !!m[2]});
  for (const m of src.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g))
    out.push({spec: m[2], typeOnly: false, dynamic: true});
  return out;
}

/** A relative specifier resolved to a src-relative file, or null (a package or an unresolvable path). */
export function resolveSpec(fromRel, spec, exists = p => existsSync(p) && statSync(p).isFile()) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(SRC, dirname(fromRel), spec.split('?')[0]);
  const tries = [
    base,
    ...EXTS.map(x => base + x),
    ...EXTS.map(x => join(base, 'index' + x)),
    base.replace(/\.js$/, '.ts'),
  ];
  for (const t of tries)
    if (exists(t)) {
      const r = relative(SRC, t).split(sep).join('/');
      return r.startsWith('..') ? '../' + r : r;
    }
  return null;
}

const layerOf = rel => rel.split('/')[0];
const isTest = rel => /\.test\.[cm]?[jt]s$/.test(rel);
const isTestSupport = rel =>
  rel.startsWith('testing/') || /(^|\/)test-[\w-]+\.ts$/.test(rel) || /(^|\/)fixtures\//.test(rel);
const featureOf = rel => /^(features|packs)\/([^/]+)\//.exec(rel)?.slice(1).join('/');

/** The violated rule for one edge, or null. `to` is a src-relative path, or a package name for bare specifiers. */
export function ruleFor(from, to, {bare = false} = {}) {
  const fl = layerOf(from);
  if (bare) {
    if ((fl === 'domain' || fl === 'content') && /^three(\/|$)/.test(to)) return 'domain-no-three';
    return null;
  }
  const tl = layerOf(to);
  if (to.startsWith('../'))
    return from.startsWith('../') || (from === 'app/game-files.ts' && to === '../../scripts/lib/game-dir.mjs')
      ? null
      : 'outside-src';
  if (tl === 'dev' && fl !== 'dev') return 'nobody-imports-dev';
  if (tl === 'app' && fl !== 'app' && !isTestSupport(from)) return 'nobody-imports-app';
  if (tl === 'testing' && !isTestSupport(from) && fl !== 'dev') return 'product-imports-test-support';
  switch (fl) {
    case 'core':
      return ['core', 'generated'].includes(tl) ? null : 'core-is-bottom';
    case 'platform':
      return ['core', 'platform', 'generated'].includes(tl) ? null : 'platform-knows-no-game';
    case 'domain':
      if (from.startsWith('domain/math/') && !to.startsWith('domain/math/')) return 'math-pure';
      return tl === 'core' || tl === 'domain' || to.startsWith('platform/workers/')
        ? null
        : 'domain-below-presentation';
    case 'kits':
      return ['features', 'packs', 'app'].includes(tl) ? 'kits-below-features' : null;
    case 'author':
      return tl === 'kits'
        ? 'author-knows-no-kit'
        : ['features', 'packs', 'app'].includes(tl)
          ? 'author-below-app'
          : null;
    case 'content':
      return ['core', 'domain', 'content'].includes(tl) ? null : 'content-is-data';
    case 'features':
    case 'packs': {
      if (tl === 'features' || tl === 'packs')
        return featureOf(from) === featureOf(to) ? null : fl === 'features' ? 'feature-isolation' : 'pack-isolation';
      return tl === 'app' ? 'nobody-imports-app' : null;
    }
    case 'app':
      return (tl === 'features' || tl === 'packs') && !/^(features|packs)\/[^/]+\/index\.ts$/.test(to)
        ? 'app-imports-manifests-only'
        : null;
    default:
      return null;
  }
}

/** Content-is-data also needs type-only imports from core and domain. */
const contentValueImport = (from, to, typeOnly) =>
  layerOf(from) === 'content' && ['core', 'domain'].includes(layerOf(to)) && !typeOnly ? 'content-types-only' : null;

export function check(files = sourceFiles(), read = f => readFileSync(join(SRC, f), 'utf8')) {
  const violations = [],
    graph = new Map();
  for (const f of files) {
    const edges = [];
    for (const {spec, typeOnly} of importsOf(read(f))) {
      const to = resolveSpec(f, spec);
      if (!isTest(f)) {
        const rule = to
          ? (ruleFor(f, to) ?? contentValueImport(f, to, typeOnly))
          : spec.startsWith('.')
            ? null
            : ruleFor(f, spec, {bare: true});
        if (rule) violations.push({rule, from: f, to: to ?? spec});
      }
      if (to && !to.startsWith('../')) edges.push(to);
    }
    graph.set(f, edges);
  }
  // Cycles: Tarjan's strongly connected components; every component with more than one file (or a self-edge) is one.
  let index = 0;
  const idx = new Map(),
    low = new Map(),
    stack = [],
    on = new Set(),
    cycles = [];
  const strong = v => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    on.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!graph.has(w)) continue;
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        on.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1 || (graph.get(v) ?? []).includes(v)) cycles.push(comp.sort());
    }
  };
  for (const v of graph.keys()) if (!idx.has(v)) strong(v);
  for (const c of cycles) violations.push({rule: 'no-circular', from: c[0], to: c.join(' → ')});
  return violations;
}

/** The folders under `root/<parent>` that hold a game (`<parent>/<name>/game/game.ts`), sorted. */
function gamesUnder(root, parent) {
  const dir = join(root, parent);
  return existsSync(dir)
    ? readdirSync(dir)
        .filter(n => !n.startsWith('.') && existsSync(join(dir, n, 'game', 'game.ts')))
        .sort()
        .map(n => join(dir, n, 'game'))
    : [];
}

/** Every game directory in the checkout: ./game, each template's game, each lab's game (labs/<name>/game) and each
 *  tool fixture game (tools/<name>/game). Labs and fixtures obey the same game rules as a template. */
export function gameDirs(root = ROOT) {
  return [
    join(root, 'game'),
    ...gamesUnder(root, 'templates'),
    ...gamesUnder(root, 'labs'),
    ...gamesUnder(root, 'tools'),
  ].filter(d => existsSync(d));
}
const KIT = /^@kits\/([a-z][a-z0-9-]*)$/;
/** A three.js import the escape hatch allows: the core, its addons and examples (never three/webgpu or three/tsl). */
export const THREE_IMPORT = /^three(\/(addons|examples\/jsm)\/.+)?$/;
/** The bracketed text after `kits:` (balanced), or null. */
function kitsArray(code) {
  const m = /\bkits\s*:\s*\[/.exec(code);
  if (!m) return null;
  let depth = 1,
    i = m.index + m[0].length;
  const start = i;
  for (; i < code.length && depth > 0; i++) {
    if (code[i] === '[') depth++;
    else if (code[i] === ']') depth--;
  }
  return code.slice(start, i - 1);
}
/** Game source files (absolute) of `dir`: not public/, tools/ or tests. */
function gameSources(dir) {
  const out = [];
  const walk = d => {
    for (const e of readdirSync(d, {withFileTypes: true})) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (!(d === dir && (e.name === 'public' || e.name === 'tools')) && e.name !== 'node_modules') walk(p);
      } else if (/\.[cm]?[jt]s$/.test(e.name) && !/\.test\.[cm]?[jt]s$/.test(e.name) && !e.name.endsWith('.d.ts'))
        out.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}
/**
 * The kits a game folder lists in `defineGame({ kits: [...] })`: each `@kits/<name>` import whose binding is called
 * inside the `kits` array of the file that calls `defineGame(`. Static, so the lints need no build.
 */
export function listedKits(dir, read = f => readFileSync(f, 'utf8')) {
  const kits = new Set();
  for (const file of gameSources(dir)) {
    const code = stripComments(read(file));
    if (!/\bdefineGame\s*\(/.test(code)) continue;
    const list = kitsArray(code);
    if (list === null) continue;
    for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@kits\/([a-z][a-z0-9-]*)['"]/g))
      for (const part of m[1].split(',')) {
        const [imported, local = imported] = part.trim().split(/\s+as\s+/);
        if (local && /^[\w$]+$/.test(local) && new RegExp(`(^|[^\\w$.])${local.replace('$', '\\$')}\\s*\\(`).test(list))
          kits.add(m[2]);
      }
  }
  return kits;
}
/** Game files (repository-relative) that use the three.js escape hatch: they import `@kits/three` or `three`. */
export function escapeHatchFiles(dir, read = f => readFileSync(f, 'utf8')) {
  return gameSources(dir)
    .filter(f => importsOf(read(f)).some(({spec}) => spec === '@kits/three' || THREE_IMPORT.test(spec)))
    .map(f => relative(ROOT, f).split(sep).join('/'));
}
/** Game files (repository-relative), and their imports that are not the author API, a kit, their own files or JSON. */
export function checkGame(dir, read = f => readFileSync(f, 'utf8')) {
  const out = [];
  if (!existsSync(dir)) return out;
  // <game>/public/ holds files the game serves as they are (a decoder's .js included), never game code.
  const walk = d => {
    for (const e of readdirSync(d, {withFileTypes: true})) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (!(d === dir && e.name === 'public')) walk(p);
      } else if (/\.[cm]?[jt]s$/.test(e.name)) check1(p);
    }
  };
  const tools = join(dir, 'tools');
  const inTools = p => p === tools || p.startsWith(tools + sep);
  const three = listedKits(dir, read).has('three');
  const check1 = file => {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (inTools(file)) return;
    for (const {spec} of importsOf(read(file))) {
      if (spec.startsWith('.') && inTools(resolve(dirname(file), spec))) {
        out.push({rule: 'game-imports-no-tools', from: rel, to: spec});
        continue;
      }
      if (spec === '@engine' || spec.endsWith('.json')) continue;
      const kit = KIT.exec(spec);
      if (kit) {
        if (!existsSync(join(SRC, 'kits', kit[1], 'index.ts')))
          out.push({rule: 'game-imports-a-real-kit', from: rel, to: spec});
        else if (kit[1] === 'three' && !three) out.push({rule: 'kit-not-listed', from: rel, to: spec});
        continue;
      }
      if (THREE_IMPORT.test(spec)) {
        if (!three) out.push({rule: 'three-needs-kit', from: rel, to: spec});
        continue;
      }
      if (/\.test\.[cm]?[jt]s$/.test(rel) && spec.startsWith('node:')) continue;
      if (spec.startsWith('.') && resolve(dirname(file), spec).startsWith(dir + sep)) continue;
      out.push({rule: 'game-imports-engine-only', from: rel, to: spec});
    }
  };
  walk(dir);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = sourceFiles();
  const games = gameDirs();
  const v = [...check(files), ...games.flatMap(d => checkGame(d))];
  if (process.argv.includes('--json')) console.log(JSON.stringify(v, null, 1));
  else if (v.length) {
    console.error(
      `lint:layers: ${v.length} violation(s)\n` +
        v.map(x => `  ${x.rule}: ${x.from} → ${x.to}`).join('\n') +
        (v.some(x => x.rule === 'three-needs-kit' || x.rule === 'kit-not-listed')
          ? "\n  three.js in game code is the opt-in escape hatch: list three() from '@kits/three' in defineGame({ kits }) (src/kits/three/README.md), or use @engine"
          : ''),
    );
  } else console.log(`lint:layers: ${files.length} engine files and ${games.length} game dir(s), no violations`);
  process.exitCode = v.length ? 1 : 0;
}
