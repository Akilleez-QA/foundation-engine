#!/usr/bin/env node
// scripts/lint/css.mjs: the style rules (STD-RUN-24), counted per stylesheet with postcss (a vite dependency):
//
//   css-unlayered     rules outside `@layer` (an unlayered rule beats every layered one)
//   css-root-prefix   feature selectors not scoped under their scene root (`.scene-<id>` or `[data-scene…]`);
//                     platform/ui and app stylesheets own the shell and are exempt
//   css-hex-colour    hex colours outside platform/ui/tokens.css (use `var(--engine-*)` tokens)
//   css-important     `!important` declarations
//
// Baselines live in lint-baseline/css/<rule>.json. A file's count may fall but never rise; a new file starts at 0.
//
//   node scripts/lint/css.mjs           report + ratchet check
//   node scripts/lint/css.mjs --lower   rewrite baselines whose count fell (never raises)
import {readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import postcss from 'postcss';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BASELINE = join(ROOT, 'lint-baseline', 'css');
const MODE = process.argv.includes('--lower') ? 'lower' : 'check';

export const RULES = ['css-unlayered', 'css-root-prefix', 'css-hex-colour', 'css-important'];
const HEX = /(?<![\w&#-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const ROOTED = /^(?:\.scene-[\w-]+|\[data-scene\b[^\]]*\])(?=$|[\s>+~.:#[])/;
const TOKENS = 'platform/ui/tokens.css';
const SHELL = /^(?:platform\/ui\/|app\/)/;

const colourText = (value) => value.replace(/url\([^)]*\)|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'/gi, '');
const inKeyframes = (node) => { for (let n = node.parent; n; n = n.parent) if (n.type === 'atrule' && /keyframes$/i.test(n.name)) return true; return false; };
const inLayer = (node) => { for (let n = node.parent; n; n = n.parent) if (n.type === 'atrule' && n.name === 'layer') return true; return false; };

/** Counts of each rule for one stylesheet's text. `file` is src-relative. */
export function countSheet(css, file) {
  const c = Object.fromEntries(RULES.map((r) => [r, 0]));
  const root = postcss.parse(css, {from: file});
  root.walkRules((rule) => {
    if (inKeyframes(rule)) return;
    if (!inLayer(rule)) c['css-unlayered']++;
    if (!SHELL.test(file)) for (const sel of rule.selectors) if (!ROOTED.test(sel.trim())) c['css-root-prefix']++;
  });
  root.walkDecls((decl) => {
    if (decl.important) c['css-important']++;
    if (file !== TOKENS) c['css-hex-colour'] += (colourText(decl.value).match(HEX) ?? []).length;
  });
  return c;
}

export const stylesheets = (src = join(ROOT, 'src')) => {
  const walk = (dir, prefix = '') => readdirSync(dir, {withFileTypes: true}).flatMap(e =>
    e.isDirectory() ? walk(join(dir, e.name), prefix + e.name + '/') : e.name.endsWith('.css') ? [prefix + e.name] : []);
  return existsSync(src) ? walk(src).sort() : [];
};

export function scan() {
  const counts = Object.fromEntries(RULES.map((r) => [r, {}]));
  for (const f of stylesheets()) {
    const c = countSheet(readFileSync(join(ROOT, 'src', f), 'utf8'), f);
    for (const r of RULES) if (c[r]) counts[r][f] = c[r];
  }
  return counts;
}

const readBaseline = (rule) => {
  const p = join(BASELINE, `${rule}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).files : {};
};
const writeBaseline = (rule, files) => {
  mkdirSync(BASELINE, {recursive: true});
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  const count = Object.values(sorted).reduce((a, b) => a + b, 0);
  writeFileSync(join(BASELINE, `${rule}.json`), `${JSON.stringify({rule, count, files: sorted}, null, 2)}\n`);
};

function main() {
  const counts = scan();
  const failures = [], lowered = [];
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  console.log(`CSS ratchet (STD-RUN-24) — ${stylesheets().length} stylesheet(s); a count may only fall.`);
  for (const rule of RULES) {
    const now = counts[rule], was = readBaseline(rule);
    let fell = false;
    for (const f of new Set([...Object.keys(now), ...Object.keys(was)])) {
      const n = now[f] ?? 0, w = was[f] ?? 0;
      if (n > w) failures.push(`${rule} in src/${f}: ${n} > baseline ${w}`);
      else if (n < w) fell = true;
    }
    if (fell) {
      lowered.push(rule);
      if (MODE === 'lower') writeBaseline(rule, Object.fromEntries(Object.entries(was).map(([f, w]) => [f, Math.min(w, now[f] ?? 0)]).filter(([, n]) => n > 0)));
    }
    console.log(`  ${rule.padEnd(18)}${String(sum(now)).padEnd(8)}baseline ${sum(was)}`);
  }
  if (lowered.length) console.log(MODE === 'lower' ? `lint:css: lowered ${lowered.join(', ')}` : `lint:css: can be lowered (node scripts/lint/css.mjs --lower): ${lowered.join(', ')}`);
  if (failures.length) {
    console.error(`\nlint:css: FAILED — ${failures.length} count(s) rose above baseline:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
