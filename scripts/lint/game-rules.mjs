#!/usr/bin/env node
// scripts/lint/game-rules.mjs (`npm run lint:game`, part of `npm run check` and `npm run lint`): two of AGENTS.md's
// short rules, enforced in game code. lint:arch holds the same rules for src/ only; this applies them to the active
// game folder (GAME_DIR, default ./game) and to every templates/<name>/game.
//
//   math-random      Math.random() in game code. Use ctx.random(): seeded, so a run with ?seed= replays exactly.
//   literal-ui-text  a literal with words written where a player reads it: the UI kit's HUD (`.line(id, '…')`,
//                    `.banner('…')`, `.prompt('…')`), DOM text and labels (`textContent`, `title`, `aria-label`, …)
//                    and HTML (`innerHTML`, …). Use a string key: defineGame({ strings }) and ctx.text(key, vars).
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

const MATH_RANDOM = ARCH_RULES.find(r => r.name === 'math-random');

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
      if (!escaped(lines, line, r.name)) out.push({rule: r.name, line, fix: r.fix});
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
  else console.log(`lint:game: ${dirs.length} game dir(s), no Math.random() or literal UI text`);
  process.exitCode = v.length ? 1 : 0;
}
