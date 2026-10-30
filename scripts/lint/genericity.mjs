#!/usr/bin/env node
// scripts/lint/genericity.mjs (`npm run lint:generic`): the engine is not a game (docs/PROVENANCE.md).
//
// The core, platform and author layers and the engine's own docs must make sense to someone building a racing game
// or a puzzle game. So they must not use the vocabulary of one genre: places, stations, rooms, walking, badges, or
// the nouns of the game the engine was extracted from. Genre patterns live in kits (src/kits/, docs/kits/) and
// templates, which this check does not scan.
//
// Scanned: src/core, src/platform, src/author, src/domain, src/app, src/dev, src/features, src/testing, README.md, AGENTS.md, CLAUDE.md, docs/ (except docs/kits/).
// A hit is allowed only by the ALLOW list below: an idiom ("in place", "room for"), or a documented opt-in (the
// brief's `kids` flag and the kid-safe policy). Adding to ALLOW is a design decision: say why next to the entry.
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const SCANNED = [
  'src/core',
  'src/platform',
  'src/author',
  'src/domain',
  'src/app',
  'src/dev',
  'src/features',
  'src/testing',
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'docs',
];
export const SKIPPED = ['docs/kits'];
/** Genre vocabulary: one genre's gameplay model, and the original game's nouns. */
export const WORDS =
  /\b(places?|stations?|rooms?|walk(?:s|ing|ed|er|ers|able)?|badges?|kids?|chickens?|moons?|rovers?|missions?|planetarium|yard|exhibits?|campus)\b/gi;
/** Allowed uses. Each entry: a pattern matched around the hit, and why. */
export const ALLOW = [
  [/\bin place\b/i, 'idiom: mutate in place'],
  [/\b(the one|same|many) places?\b/i, 'idiom'],
  [/\b(re-)?places (each|and|it|its|the|a)\b/i, 'verb: the shell places a row'],
  [/(this\.|private )place\(/, 'the shell row placement method'],
  [/\b(no|make|leave|leaves) room\b|\broom for\b|\broom\(/i, "idiom and the change tracker's room(n)"],
  [/`missions`/, "a candidate kit's name in docs/ROADMAP.md"],
  [/\bkid-safe\b/i, 'the opt-in kid-safe policy profile (docs/policy/KID-SAFE.md)'],
  [
    /\bwalk[ -]cycles?\b|`walk(?:_turn_(?:left|right))?`|\bwalk (?:clip|clips|poses?|key poses?|loop)\b/i,
    'the walk cycle: the standard example of a looping clip in pose-to-pose animation (a motion, not a genre)',
  ],
  [
    /\bkids\s*[?:]|audience\??\.kids|\bconst kids\b|\bkids \?|, kids,|kids: true|`kids`|\bkids\b.*\bopt/i,
    "the brief's opt-in audience flag",
  ],
];

function files(target) {
  const abs = join(ROOT, target);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [target];
  const out = [];
  const walk = d => {
    for (const e of readdirSync(d, {withFileTypes: true})) {
      const p = join(d, e.name),
        rel = relative(ROOT, p).split(sep).join('/');
      if (SKIPPED.some(s => rel === s || rel.startsWith(s + '/'))) continue;
      if (e.isDirectory()) {
        if (e.name !== 'generated' && e.name !== 'node_modules') walk(p);
      } else if (/\.(ts|mts|mjs|js|css|md|json|html)$/.test(e.name)) out.push(rel);
    }
  };
  walk(abs);
  return out;
}

/** Hits in one text: [{line, word, text}] that no ALLOW entry covers. */
export function hits(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(WORDS)) {
      const window = line.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
      if (ALLOW.some(([re]) => re.test(window))) continue;
      out.push({line: i + 1, word: m[0], text: line.trim().slice(0, 160)});
    }
  });
  return out;
}

export function check() {
  const out = [];
  for (const t of SCANNED)
    for (const f of files(t)) for (const h of hits(readFileSync(join(ROOT, f), 'utf8'))) out.push({file: f, ...h});
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const found = check();
  if (found.length) {
    console.error(
      `lint:generic: ${found.length} genre word(s) in the engine (move them to a kit or template, or rename):\n` +
        found
          .slice(0, 60)
          .map(h => `  ${h.file}:${h.line} "${h.word}": ${h.text}`)
          .join('\n'),
    );
    process.exitCode = 1;
  } else console.log(`lint:generic: ${SCANNED.join(', ')} are genre-neutral`);
}
