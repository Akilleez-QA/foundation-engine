#!/usr/bin/env node
// scripts/check.mjs (`npm run check`): the fast check to run after every small change (target: under 30 s).
//   1. typecheck (tsc --noEmit)
//   2. lint: layers, genericity, the brief (this game), the budget ratchet
//   3. the tests that the change can affect: changed test files, the test next to each changed file, every test of
//      the game folder when anything in it changed, and every test of a changed engine folder
// "Changed" is the working tree against HEAD, plus untracked files. `--all` runs every test instead.
// It never builds, benches or opens a browser: that is `npm run play:snap` (see it) and `npm run gate` (integrate).
import './lib/node-version.mjs';
import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {gameDir, ROOT} from './lib/game-dir.mjs';
import {toolCommand} from './lib/tool.mjs';

const t0 = Date.now();
const all = process.argv.includes('--all');
const rel = p => relative(ROOT, p).split('\\').join('/');
const GAME = rel(gameDir());
const git = args => spawnSync('git', args, {cwd: ROOT, encoding: 'utf8'}).stdout?.split('\n').map(s => s.trim()).filter(Boolean) ?? [];

/** Files changed against HEAD, and untracked files. */
export function changedFiles() { return [...new Set([...git(['diff', '--name-only', 'HEAD']), ...git(['ls-files', '--others', '--exclude-standard'])])].filter(f => existsSync(join(ROOT, f))); }

const testsIn = dir => existsSync(join(ROOT, dir)) ? readdirSync(join(ROOT, dir), {recursive: true}).map(f => `${dir}/${String(f).split('\\').join('/')}`).filter(f => /\.test\.(ts|mjs)$/.test(f)) : [];

/** The tests a set of changed files can affect. */
export function affectedTests(changed, game = GAME) {
  const out = new Set();
  for (const f of changed) {
    if (/\.test\.(ts|mjs)$/.test(f)) { out.add(f); continue; }
    const sibling = f.replace(/\.(ts|mjs)$/, '.test.$1');
    if (sibling !== f && existsSync(join(ROOT, sibling))) out.add(sibling);
    if (f.startsWith(game + '/') || f === join(game, '..', 'GAME.md').split('\\').join('/')) for (const t of testsIn(game)) out.add(t);
    else if (/^src\/.+\.(ts|css)$/.test(f)) for (const t of testsIn(dirname(f)).filter(t => dirname(t) === dirname(f))) out.add(t);
    if (/^src\/(author|app)\//.test(f) || /^templates\/[^/]+\/game\//.test(f)) out.add('src/app/templates.test.ts');
    // The build declares the @engine barrel free of side effects; its guard runs when either side changes.
    if (f === 'src/author/index.ts' || f === 'vite.config.ts') out.add('scripts/vite-config.test.mjs');
  }
  return [...out].filter(t => existsSync(join(ROOT, t))).sort();
}

const results = [];
const run = (name, cmd, args = []) => {
  // A tool command from scripts/lib/tool.mjs (no npx, no shell: the same on Windows), or a plain `node` script.
  const c = typeof cmd === 'string' ? {command: cmd === 'node' ? process.execPath : cmd, args, shell: false} : cmd;
  const t = Date.now(), r = spawnSync(c.command, c.args, {cwd: ROOT, encoding: 'utf8', env: process.env, shell: c.shell});
  const ok = r.status === 0;
  results.push({name, ok, s: (Date.now() - t) / 1000, out: ok ? '' : (r.stdout + r.stderr).trim().split('\n').filter(l => !/^\s*(#|ok |\.\.\.|---|duration_ms|type:)/.test(l)).slice(-40).join('\n')});
  return ok;
};

if (process.argv[1] && process.argv[1].endsWith('check.mjs')) {
  run('generate', 'node', ['scripts/generate.mjs']);
  run('typecheck', toolCommand('tsc', ['--noEmit']));
  run('lint:layers', 'node', ['scripts/lint/layers.mjs']);
  run('lint:generic', 'node', ['scripts/lint/genericity.mjs']);
  run('lint:brief', toolCommand('tsx', ['scripts/lint/brief.ts', GAME]));
  run('lint:budgets', 'node', ['scripts/perf/budget-ratchet.mjs']);
  const tests = all ? ['src/**/*.test.ts', 'templates/*/game/**/*.test.ts', 'templates/*/game/**/*.test.mjs', 'scripts/**/*.test.mjs', 'scripts/**/*.test.ts'] : affectedTests(changedFiles());
  if (tests.length) run(`tests (${all ? 'all' : tests.length + ' file(s)'})`, toolCommand('tsx', ['--test', ...tests]));
  else results.push({name: 'tests (nothing changed that has tests)', ok: true, s: 0, out: ''});
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name} (${r.s.toFixed(1)} s)${r.ok ? '' : '\n' + r.out.replace(/^/gm, '     ')}`);
  const bad = results.filter(r => !r.ok);
  console.log(`check: ${bad.length ? 'FAIL (' + bad.map(r => r.name).join(', ') + ')' : 'PASS'} in ${((Date.now() - t0) / 1000).toFixed(0)} s · game ${GAME}${bad.length ? '' : ' · next: npm run play:snap to see it'}`);
  process.exitCode = bad.length ? 1 : 0;
}
