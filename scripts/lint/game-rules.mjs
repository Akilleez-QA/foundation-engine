#!/usr/bin/env node
// scripts/lint/game-rules.mjs (`npm run lint:game`, part of `npm run check` and `npm run lint`): rules that
// lint:arch holds for src/ only (two of AGENTS.md's short rules and the render-backend boundary), applied to the
// active game folder (GAME_DIR, default ./game) and to every templates/<name>/game.
//
//   math-random      Math.random() in game code. Use ctx.random(): seeded, so a run with ?seed= replays exactly.
//   literal-ui-text  a literal with words written where a player reads it: the UI kit's HUD (`.line(id, '…')`,
//                    `.banner('…')`, `.prompt('…')`), DOM text and labels (`textContent`, `title`, `aria-label`, …)
//                    and HTML (`innerHTML`, …). Use a string key: defineGame({ strings }) and ctx.text(key, vars).
//   three-webgpu     an import of `three/webgpu` or `three/tsl` (ADR 0078). The render backend is a brief setting
//                    (`defineBuild({ render: { backend } })`); only the engine's WebGPU backend imports these. This
//                    rule has no escape.
//   three-legacy     three.js APIs that are gone or deprecated in the pinned three (r186), in a file that imports
//                    three directly or through `@kits/three`: `Geometry`/`Face3`, `*BufferGeometry` aliases,
//                    `outputEncoding`/`.encoding`/`sRGBEncoding`/`LinearEncoding`, `physicallyCorrectLights`,
//                    `useLegacyLights`, `gammaOutput`/`gammaFactor`, legacy loaders (`JSONLoader`,
//                    `BasisTextureLoader`, `RGBELoader`), `mergeBufferGeometries`, `Clock`, `PCFSoftShadowMap` and
//                    imports from `three/examples/js/`. Common in agent-written code trained on older three. Game code
//                    reaches three only through a kit (lint:layers), so the rule is dormant until a `@kits/three`
//                    kit exists; it is ready for it. Each finding names the replacement.
//
// Not scanned: <game>/tools/ (build-time Node scripts), <game>/public/ (static files), and test files (*.test.*).
// An explicit escape, on the offending line or the line above, with a reason after the colon:
//   // lint-game-allow math-random: <why this one is not gameplay randomness>
//
//   node scripts/lint/game-rules.mjs           check (exit 1 on a violation)
//   node scripts/lint/game-rules.mjs --json    print the violations as JSON
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RULES as ARCH_RULES, ruleMatches, literalUiText, literalAt, stripComments} from './architecture.mjs';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** HUD sinks of the UI kit (`hud(ctx)`): a literal straight into a line, the banner or the prompt. */
const HUD_SINK = /\.(?:line\s*\(\s*[^,()]*,\s*|banner\s*\(\s*|prompt\s*\(\s*)(?=['"`])/g;

/** A file that uses three: an import (static, dynamic or re-export) of `three`, `three/...` or `@kits/three[/...]`. */
const THREE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"`](?:three|@kits\/three)(?:\/[^'"`]*)?['"`]/;
/** Named imports from a three module: `import { A, B as C } from 'three'` (type-only imports included). */
const THREE_NAMED =
  /\b(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"`](?:three|@kits\/three)(?:\/[^'"`]*)?['"`]/g;

/**
 * three.js names that are gone or deprecated in three r186 (checked against node_modules/three 0.186.1: absent
 * from src/ and examples/jsm/, or marked @deprecated), with what to use instead. Matched as `THREE.<name>` or as a
 * name imported from a three module.
 */
export const THREE_LEGACY_NAMES = {
  Geometry: 'removed in r125: use BufferGeometry (or a built-in such as BoxGeometry)',
  Face3: 'removed in r125: use BufferGeometry with an index',
  sRGBEncoding: 'removed in r162: use SRGBColorSpace',
  LinearEncoding: 'removed in r162: use LinearSRGBColorSpace (or NoColorSpace for data textures)',
  JSONLoader: 'removed: export glTF (GLB) and load it with GLTFLoader, or use ObjectLoader for three JSON',
  LegacyJSONLoader: 'removed: export glTF (GLB) and load it with GLTFLoader',
  BasisTextureLoader: 'removed: use KTX2Loader with KTX2 (Basis Universal) textures',
  RGBELoader: 'deprecated in r180: use HDRLoader',
  Clock: 'deprecated in r183: use Timer',
  PCFSoftShadowMap: 'deprecated in r186: use PCFShadowMap',
};
/** `BoxBufferGeometry` and friends: the aliases were removed; the plain names (`BoxGeometry`) are BufferGeometry. */
const BUFFER_ALIAS = /^(?!Instanced)\w+BufferGeometry$/;
const legacyNameFix = name =>
  THREE_LEGACY_NAMES[name] ??
  (BUFFER_ALIAS.test(name) ? `removed: use ${name.replace('BufferGeometry', 'Geometry')}` : null);

/** Properties and paths that are gone in r186, matched anywhere in a file that uses three. */
const THREE_LEGACY_PATTERNS = [
  {re: /\.outputEncoding\b/g, fix: 'removed in r162: set renderer.outputColorSpace = SRGBColorSpace'},
  {
    re: /\.encoding\s*=(?!=)/g,
    fix: 'texture.encoding was removed in r162: set texture.colorSpace = SRGBColorSpace for colour maps (leave data maps as they are)',
  },
  {re: /\.physicallyCorrectLights\b/g, fix: 'removed: physically based light units are the only mode; delete the line'},
  {re: /\.useLegacyLights\b/g, fix: 'removed in r165: physically based light units are the only mode; delete the line'},
  {re: /\.gamma(?:Output|Factor)\b/g, fix: 'removed: use renderer.outputColorSpace = SRGBColorSpace'},
  {
    re: /\bmergeBufferGeometries\b/g,
    fix: 'renamed in r151: use mergeGeometries from three/addons/utils/BufferGeometryUtils.js',
  },
  {
    re: /['"`]three\/examples\/js\/[^'"`]*['"`]/g,
    fix: 'three/examples/js was removed in r148: import the module from three/addons/...',
  },
];

/** Legacy three.js uses in comment-free source that imports three; [] for a file that does not. */
export function threeLegacyMatches(code) {
  if (!THREE_IMPORT.test(code)) return [];
  const hits = [];
  for (const {re, fix} of THREE_LEGACY_PATTERNS) for (const m of code.matchAll(re)) hits.push({index: m.index, fix});
  for (const m of code.matchAll(/\bTHREE\.([A-Za-z_$][\w$]*)/g)) {
    const fix = legacyNameFix(m[1]);
    if (fix) hits.push({index: m.index, fix: `THREE.${m[1]} ${fix}`});
  }
  for (const m of code.matchAll(THREE_NAMED))
    for (const part of m[1].split(',')) {
      const name = part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0];
      const fix = name && legacyNameFix(name);
      if (fix) hits.push({index: m.index + m[0].indexOf(part.trim()), fix: `${name} ${fix}`});
    }
  return hits.sort((a, b) => a.index - b.index);
}

const MATH_RANDOM = ARCH_RULES.find(r => r.name === 'math-random');
const THREE_WEBGPU = ARCH_RULES.find(r => r.name === 'three-webgpu');

/** The rules for game code: name, matcher over comment-free source, and the fix an agent should apply. */
export const GAME_RULES = [
  {
    name: 'math-random',
    match: code => ruleMatches(MATH_RANDOM, code),
    fix: 'Math.random() is not replayable: use ctx.random() (seeded, replayable with ?seed=); pass ctx (or ctx.random) to helpers outside a system',
  },
  {
    name: 'literal-ui-text',
    match: code => {
      const hits = literalUiText(code);
      for (const m of code.matchAll(HUD_SINK))
        if (/[A-Za-z]{2}/.test(literalAt(code, m.index + m[0].length))) hits.push({index: m.index, 0: m[0]});
      return hits.sort((a, b) => a.index - b.index);
    },
    fix: "literal text reaches the player: add a string key via defineGame({ strings: { en: { 'game.hud.coins': 'Coins {n}' } } }) and show ctx.text('game.hud.coins', { n })",
  },
  {
    name: 'three-webgpu',
    escapable: false,
    match: code => ruleMatches(THREE_WEBGPU, code),
    fix: "game code never imports three/webgpu or three/tsl (ADR 0078): choose the backend in the brief with defineBuild({ render: { backend: 'webgpu' } }) and keep game code on @engine",
  },
  {
    name: 'three-legacy',
    match: threeLegacyMatches,
    fix: 'a three.js API that is gone or deprecated in the pinned three (r186): use the current API',
  },
];

const ESCAPE = /lint-game-allow\s+([\w-]+)\s*:\s*\S/;
/** True when line `n` (1-based) or the line above carries an escape for `rule` with a reason. */
function escaped(lines, n, rule) {
  return [lines[n - 1], lines[n - 2]].some(l => {
    const m = l && ESCAPE.exec(l);
    return m && m[1] === rule;
  });
}

const isTest = name => /\.test\.[cm]?[jt]sx?$/.test(name);

/** Game source files of `dir` (absolute), skipping tools/, public/ and tests. */
export function gameSourceFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = d => {
    for (const e of readdirSync(d, {withFileTypes: true})) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (!(d === dir && (e.name === 'tools' || e.name === 'public')) && e.name !== 'node_modules') walk(p);
      } else if (/\.[cm]?[jt]sx?$/.test(e.name) && !e.name.endsWith('.d.ts') && !isTest(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** Violations in one source text: {rule, line, fix}. */
export function checkSource(text) {
  const code = stripComments(text);
  const lines = text.split('\n');
  const out = [];
  for (const r of GAME_RULES) {
    for (const m of r.match(code)) {
      const line = code.slice(0, m.index).split('\n').length;
      if (r.escapable === false || !escaped(lines, line, r.name)) out.push({rule: r.name, line, fix: m.fix ?? r.fix});
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Violations in a game folder: {rule, file (relative to root), line, fix}. */
export function checkGameRules(dir, root = ROOT) {
  return gameSourceFiles(dir).flatMap(f =>
    checkSource(readFileSync(f, 'utf8')).map(v => ({...v, file: relative(root, f).split(sep).join('/')})),
  );
}

/** The game folders to scan: the active one (GAME_DIR, else ./game, else the blank template) and every template. */
export async function gameFolders(root = ROOT) {
  const {gameDir} = await import('../lib/game-dir.mjs');
  const {gameDirs} = await import('./layers.mjs');
  let active = null;
  try {
    active = gameDir();
  } catch {
    /* reported by the commands that build it */
  }
  return [...new Set([...(active ? [active] : []), ...gameDirs(root)].map(d => resolve(d)))];
}

export const format = v =>
  `${v.file}:${v.line} ${v.rule}: ${v.fix} (or, rarely, an escape with a reason: // lint-game-allow ${v.rule}: <reason>)`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dirs = await gameFolders();
  const v = dirs.flatMap(d => checkGameRules(d));
  if (process.argv.includes('--json')) console.log(JSON.stringify(v, null, 1));
  else if (v.length) console.error(`lint:game: ${v.length} violation(s)\n` + v.map(x => `  ${format(x)}`).join('\n'));
  else
    console.log(
      `lint:game: ${dirs.length} game dir(s), no Math.random(), literal UI text or three/webgpu, and no legacy three.js API`,
    );
  process.exitCode = v.length ? 1 : 0;
}
