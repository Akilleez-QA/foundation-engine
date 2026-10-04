#!/usr/bin/env node
// scripts/perf/budget-ratchet.mjs (`npm run lint:budgets`): budgets only fall (STANDARD chapter 12, STD-PRF-4).
//
// It compares every game's budgets.json in the working tree (./game and each templates/<name>/game) with the same
// file at the base revision (default origin/main; the root commit when there is no remote yet). Every number that rose, and every budgeted metric that
// disappeared (unbudgeted is looser than any number), is a RAISE. Each raise needs a commit trailer on this branch
// (base..HEAD) that names it exactly:
//
//   Perf-Budget: <key> <old> -> <new>: <reason>
//
// where <key> is `<scene>.<metric>`, `<scene>.ports.<preset>.<metric>` or `app.<metric>` (`app.appReadyMs.desktop`),
// prefixed with `<template>/` for a template's budgets (`blank/main.draws`); ./game's keys have no prefix.
// A raise that is not committed yet cannot carry a trailer, so it fails until it is committed with one. Lowering a
// number, adding a scene or adding a metric needs nothing: that is the ratchet turning.
//
// The trailer is a line of its own anywhere in a commit message on the branch: in the trailer block with
// Co-Authored-By, or in a paragraph of its own (git's own trailer parser reads only the last paragraph; this does not).
//
// A new ./game in an engine checkout: when the base has no game/budgets.json, ./game is compared with the template it
// started from, so a raise above the template's numbers still needs a trailer. game/.origin.json (written by
// `npm run new-game`: {template, commit}) names it; the template's budgets are read at that commit, else at the base,
// else from the working tree. Without the file, the template is the brief's genre when a template has that name,
// else the template whose scene ids the game keeps the most of. A game not committed yet starts from that point too,
// so a raise above the template is reported as not committed.
//
//   node scripts/perf/budget-ratchet.mjs [--base <ref>] [--json]
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
import {readdirSync} from 'node:fs';
export const DATA_FILE = 'game/budgets.json';
/** Where budgets lived before: a base revision is read from here when it lacks the file, so a move is no loophole.
 *  The engine's first game kept its budgets in perf/budget-data.json and then game/budgets.json; the blank template
 *  (the default game) inherits them. */
export const FORMER_FILES = {'templates/blank/game/budgets.json': ['game/budgets.json', 'perf/budget-data.json']};

/** Every game budgets file in the working tree, repository-relative. */
export function budgetFiles(root = ROOT) {
  const templates = join(root, 'templates');
  const files = [
    DATA_FILE,
    ...(existsSync(templates)
      ? readdirSync(templates)
          .filter(t => !t.startsWith('.'))
          .map(t => `templates/${t}/game/budgets.json`)
      : []),
  ];
  return files.filter(f => existsSync(join(root, f)));
}
/** The trailer prefix of a budgets file: '' for ./game, '<template>/' for a template. */
export const prefixOf = file => /^templates\/([^/]+)\//.exec(file)?.[1]?.concat('/') ?? '';

/** Every budget number keyed by its trailer key. Non-budget fields (route, provenance, notes) are ignored. */
export function flattenBudgets(data) {
  const out = new Map();
  const walk = (prefix, value) => {
    if (typeof value === 'number') {
      out.set(prefix, value);
      return;
    }
    if (value && typeof value === 'object' && !Array.isArray(value))
      for (const [k, v] of Object.entries(value)) walk(`${prefix}.${k}`, v);
  };
  walk('app', data?.app ?? {});
  for (const [scene, row] of Object.entries(data?.scenes ?? {})) walk(scene, row?.budget ?? {});
  return out;
}

/** Raises from `before` to `after`: a larger number, or a budgeted metric of a kept scene that is gone. */
export function findRaises(before, after) {
  const a = flattenBudgets(before),
    b = flattenBudgets(after),
    raises = [];
  const kept = new Set(Object.keys(after?.scenes ?? {}));
  for (const [key, old] of a) {
    const scene = key.split('.')[0];
    const now = b.get(key);
    if (now === undefined) {
      if (scene === 'app' || kept.has(scene)) raises.push({key, old, now: null});
      continue;
    }
    if (now > old) raises.push({key, old, now});
  }
  return raises;
}

/** Every `Perf-Budget:` value in commit messages (full bodies, any paragraph), one per line. */
export function perfBudgetLines(messages) {
  const out = [];
  for (const line of String(messages ?? '').split('\n')) {
    const m = /^\s*Perf-Budget:\s*(.*)$/i.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

const TRAILER = /^(\S+)\s+(-?[\d.]+|none)\s*->\s*(-?[\d.]+|none)\s*:\s*(\S.*)$/;
/** `<key> <old> -> <new>: <reason>` rows; malformed rows are returned as problems. */
export function parseTrailers(lines) {
  const trailers = [],
    problems = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = TRAILER.exec(line);
    if (!m) {
      problems.push(`malformed Perf-Budget trailer: "${line}" (want "<key> <old> -> <new>: <reason>")`);
      continue;
    }
    const num = s => (s === 'none' ? null : Number(s));
    trailers.push({key: m[1], old: num(m[2]), now: num(m[3]), reason: m[4]});
  }
  return {trailers, problems};
}

/** The ratchet's verdict: every raise must be committed and named by a trailer with the same key and new value. */
export function checkRatchet({before, committed, working, trailerLines}) {
  const {trailers, problems} = parseTrailers(trailerLines);
  const failures = [...problems];
  const uncommitted = findRaises(committed, working);
  for (const r of uncommitted)
    failures.push(
      `${r.key} ${r.old} -> ${r.now ?? 'none'} is not committed: commit it with a "Perf-Budget: ${r.key} ${r.old} -> ${r.now ?? 'none'}: <reason>" trailer`,
    );
  const raises = findRaises(before, committed);
  for (const r of raises) {
    const t = trailers.find(x => x.key === r.key && x.now === r.now);
    if (!t)
      failures.push(
        `${r.key} rose ${r.old} -> ${r.now ?? 'none'} without a matching "Perf-Budget: ${r.key} ${r.old} -> ${r.now ?? 'none'}: <reason>" line in a commit message on this branch (a line of its own, anywhere in the message)`,
      );
  }
  return {ok: failures.length === 0, raises, trailers, failures};
}

const git = (...args) => {
  try {
    return execFileSync('git', args, {cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    return null;
  }
};

/** The base revision: `--base`, else origin/main, else the root commit (nothing to compare on a fresh repository). */
export function resolveBase(explicit) {
  if (explicit) {
    if (!git('rev-parse', '--verify', explicit + '^{commit}')) throw Error(`unknown base ${explicit}`);
    return explicit;
  }
  if (git('rev-parse', '--verify', 'origin/main^{commit}')) return 'origin/main';
  return git('rev-list', '--max-parents=0', 'HEAD')?.split('\n')[0] ?? null;
}

const readAt = (rev, file) => {
  for (const f of [file, ...(FORMER_FILES[file] ?? [])]) {
    const s = rev ? git('show', `${rev}:${f}`) : null;
    if (s) return JSON.parse(s);
  }
  return {};
};
/** Prefix every scene and the app block of one file's data, so several games share one trailer namespace. */
export function prefixed(data, prefix) {
  if (!prefix) return data;
  const out = {app: {}, scenes: {}};
  for (const [k, v] of Object.entries(data?.app ?? {}))
    ((out.scenes[`${prefix}app`] ??= {budget: {}}), (out.scenes[`${prefix}app`].budget[k] = v));
  for (const [id, row] of Object.entries(data?.scenes ?? {})) out.scenes[prefix + id] = row;
  return out;
}
/** The template a game started from: game/.origin.json, else the brief's genre, else the best scene-id match. */
export function gameTemplate(root = ROOT, gameDir = 'game') {
  const dir = join(root, gameDir);
  const templates = existsSync(join(root, 'templates'))
    ? readdirSync(join(root, 'templates')).filter(t => existsSync(join(root, 'templates', t, 'game', 'budgets.json')))
    : [];
  const originFile = join(dir, '.origin.json');
  if (existsSync(originFile)) {
    const o = JSON.parse(readFileSync(originFile, 'utf8'));
    if (typeof o?.template === 'string' && templates.includes(o.template))
      return {template: o.template, commit: typeof o.commit === 'string' ? o.commit : null, from: '.origin.json'};
  }
  const brief = existsSync(join(dir, 'build.brief.ts')) ? readFileSync(join(dir, 'build.brief.ts'), 'utf8') : '';
  const genre = /genre:\s*['"]([^'"]+)['"]/.exec(brief)?.[1];
  if (genre && templates.includes(genre)) return {template: genre, commit: null, from: 'genre'};
  const scenes = existsSync(join(dir, 'budgets.json'))
    ? Object.keys(JSON.parse(readFileSync(join(dir, 'budgets.json'), 'utf8')).scenes ?? {})
    : [];
  let best = null;
  for (const t of templates) {
    const ids = Object.keys(
      JSON.parse(readFileSync(join(root, 'templates', t, 'game', 'budgets.json'), 'utf8')).scenes ?? {},
    );
    const kept = ids.filter(id => scenes.includes(id)).length;
    if (kept && (!best || kept > best.kept)) best = {template: t, kept};
  }
  return best ? {template: best.template, commit: null, from: 'scene ids'} : null;
}

const merge = parts => ({
  app: Object.assign({}, ...parts.map(p => p.app ?? {})),
  scenes: Object.assign({}, ...parts.map(p => p.scenes ?? {})),
});

export function main(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--base');
  const base = resolveBase(i >= 0 ? argv[i + 1] : process.env.BUDGET_BASE);
  const hasHead = !!git('rev-parse', '--verify', 'HEAD^{commit}');
  const files = budgetFiles();
  const working = merge(files.map(f => prefixed(JSON.parse(readFileSync(join(ROOT, f), 'utf8')), prefixOf(f))));
  let origin = null;
  const beforeOf = f => {
    const at = base ? readAt(base, f) : {};
    if (f !== DATA_FILE || Object.keys(at).length) return at;
    // A new ./game: the base never had one. Compare it with the template it started from.
    origin = gameTemplate();
    if (!origin) return {};
    const tf = `templates/${origin.template}/game/budgets.json`;
    for (const rev of [origin.commit, base]) {
      if (!rev || !git('rev-parse', '--verify', rev + '^{commit}')) continue;
      const s = git('show', `${rev}:${tf}`);
      if (s) return ((origin.at = rev.slice(0, 12)), JSON.parse(s));
    }
    origin.at = 'working tree';
    return JSON.parse(readFileSync(join(ROOT, tf), 'utf8'));
  };
  const before = merge(files.map(f => prefixed(beforeOf(f), prefixOf(f))));
  // A game not committed yet (only in the working tree) starts from its comparison point, so a raise above the
  // template is reported as not committed rather than every number as missing.
  const inHead = f => hasHead && git('cat-file', '-e', `HEAD:${f}`) !== null;
  const committed = merge(
    files.map(f => prefixed(inHead(f) ? readAt('HEAD', f) : f === DATA_FILE ? beforeOf(f) : {}, prefixOf(f))),
  );
  const range = base && hasHead ? `${base}..HEAD` : null;
  // Full messages, not git's trailer block: a Perf-Budget line counts in any paragraph.
  const trailerLines = range ? perfBudgetLines(git('log', '--format=%B', range) ?? '') : [];
  const result = checkRatchet({before, committed, working, trailerLines});
  const from = origin
    ? `; ./game compared with templates/${origin.template} (${origin.from}, at ${origin.at ?? 'nothing'})`
    : '';
  if (argv.includes('--json')) console.log(JSON.stringify({base, origin, ...result}, null, 1));
  else if (result.ok)
    console.log(
      `lint:budgets: ${flattenBudgets(working).size} budget numbers in ${files.length} game(s); ${result.raises.length} raise(s) since ${base ? base.slice(0, 12) : 'the start'}, each with its Perf-Budget trailer${from}`,
    );
  else
    console.error(
      `lint:budgets: FAILED (budgets only fall; STANDARD chapter 12)${from}\n  ${result.failures.join('\n  ')}`,
    );
  return result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
