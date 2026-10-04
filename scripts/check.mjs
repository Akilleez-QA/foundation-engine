#!/usr/bin/env node
// scripts/check.mjs (`npm run check`): the fast check to run after every small change (target: under 30 s).
//   1. typecheck (tsc --noEmit)
//   2. lint: formatting (Prettier, on the changed files; --all checks every file), layers, the game rules (Math.random,
//      literal UI text), genericity, type escapes, the brief (this game), the budget ratchet, the model contracts
//      (scripts/asset-verify.mjs --all: every GLB under a game's public/models with a <name>.contract.json), and
//      asset provenance (this game; warnings by default, errors when the brief sets assets.provenance: 'required')
//   3. the tests that the change can affect: changed test files, the test next to each changed file, every test of
//      the game folder when anything in it changed, and every test of a changed engine folder
// "Changed" is the working tree against HEAD, plus untracked files. `--base <ref>` includes committed branch
// changes since the merge base with ref. `--all` delegates to npm test, keeping its complete suite selection.
// It never builds, benches or opens a browser: that is `npm run play:snap` (see it) and `npm run gate` (integrate).
import './lib/node-version.mjs';
import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {gameDir, ROOT} from './lib/game-dir.mjs';
import {toolCommand, npmCommand} from './lib/tool.mjs';
import {TAP_REPORTER, childTestEnv, testTotals} from './lib/test-output.mjs';

const t0 = Date.now();
const rel = p => relative(ROOT, p).split('\\').join('/');
const GAME = rel(gameDir());
const git = (args, cwd) => {
  const result = spawnSync('git', args, {cwd, encoding: 'utf8'});
  if (result.error || result.status !== 0)
    throw Error(`Cannot select tests: git ${args[0]} failed: ${result.error?.message ?? result.stderr.trim()}`);
  return result.stdout;
};

/** Parse selection options without consuming the shared --game option. */
export function selectionOptions(argv = process.argv.slice(2)) {
  let base;
  let all = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--all') {
      all = true;
      continue;
    }
    if (arg === '--game') {
      if (!argv[i + 1] || argv[i + 1].startsWith('-')) throw Error('--game needs a folder');
      i++;
      continue;
    }
    if (arg.startsWith('--game=')) {
      if (!arg.slice(7)) throw Error('--game needs a folder');
      continue;
    }
    if (arg !== '--base' && !arg.startsWith('--base=')) throw Error(`Unknown check option: ${arg}`);
    const value = arg === '--base' ? argv[++i] : arg.slice(7);
    if (base !== undefined || !value || value.startsWith('-'))
      throw Error('--base needs one Git revision, e.g. --base origin/main');
    base = value;
  }
  if (all && base !== undefined) throw Error('Choose --all or --base <ref>, not both');
  return {all, base};
}

/** The zero-selection line: never suggests `--base` when the selection already used one. */
export function noTestsMessage(base) {
  return base === undefined
    ? 'No tests selected (0 files). This is not test-suite acceptance; use --base <ref>, --all, or run explicit tests.'
    : `No tests selected (0 files): nothing changed since the merge base with ${base} affects a test. This is not test-suite acceptance; use --all or run explicit tests.`;
}

/** Include dirty/untracked paths and deletions; deleted source can still affect surviving tests. */
export function changedFiles({base, cwd = ROOT} = {}) {
  const revision = base === undefined ? 'HEAD' : git(['merge-base', 'HEAD', base], cwd).trim();
  return [
    ...new Set(
      [
        ...git(['diff', '--name-only', '--no-renames', '-z', revision, '--'], cwd).split('\0'),
        ...git(['ls-files', '--others', '--exclude-standard', '-z'], cwd).split('\0'),
      ].filter(Boolean),
    ),
  ];
}

const testsIn = dir =>
  existsSync(join(ROOT, dir))
    ? readdirSync(join(ROOT, dir), {recursive: true})
        .map(f => `${dir}/${String(f).split('\\').join('/')}`)
        .filter(f => /\.test\.(ts|mjs)$/.test(f))
    : [];

/** The tests a set of changed files can affect. */
export function affectedTests(changed, game = GAME) {
  const out = new Set();
  for (const f of changed) {
    if (/\.test\.(ts|mjs)$/.test(f)) {
      out.add(f);
      continue;
    }
    const sibling = f.replace(/\.(ts|mjs)$/, '.test.$1');
    if (sibling !== f && existsSync(join(ROOT, sibling))) out.add(sibling);
    if (f.startsWith(game + '/') || f === join(game, '..', 'GAME.md').split('\\').join('/'))
      for (const t of testsIn(game)) out.add(t);
    else if (/^src\/.+\.(ts|css)$/.test(f))
      for (const t of testsIn(dirname(f)).filter(t => dirname(t) === dirname(f))) out.add(t);
    if (/^src\/(author|app)\//.test(f) || /^templates\/[^/]+\/game\//.test(f)) out.add('src/app/templates.test.ts');
    // The build declares the @engine barrel free of side effects; its guard runs when either side changes.
    if (f === 'src/author/index.ts' || f === 'vite.config.ts') out.add('scripts/vite-config.test.mjs');
  }
  return [...out].filter(t => existsSync(join(ROOT, t))).sort();
}

const results = [];
/** Retain canonical Node test totals without flooding the quick-check report (TAP or spec output, any Node). */
export function testSummary(output) {
  const totals = testTotals(output) ?? {};
  return ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms']
    .filter(k => k in totals)
    .map(k => `# ${k} ${totals[k]}`)
    .join('\n');
}
/** Lines a passing step marks as warnings (`warning: …`), so they are seen without failing the check. */
export const warnings = output =>
  output
    .split('\n')
    .filter(l => /^warning: /.test(l))
    .join('\n');
const run = (name, cmd, args = []) => {
  // A tool command from scripts/lib/tool.mjs (no npx, no shell: the same on Windows), or a plain `node` script.
  const c = typeof cmd === 'string' ? {command: cmd === 'node' ? process.execPath : cmd, args, shell: false} : cmd;
  const t = Date.now(),
    r = spawnSync(c.command, c.args, {cwd: ROOT, encoding: 'utf8', env: childTestEnv(), shell: c.shell});
  const ok = r.status === 0;
  results.push({
    name,
    ok,
    s: (Date.now() - t) / 1000,
    out: ok
      ? name.startsWith('tests (')
        ? testSummary(r.stdout)
        : warnings(r.stdout)
      : (r.stdout + r.stderr)
          .trim()
          .split('\n')
          .filter(l => !/^\s*(#|ok |\.\.\.|---|duration_ms|type:)/.test(l))
          .slice(-40)
          .join('\n'),
  });
  return ok;
};

if (process.argv[1] && process.argv[1].endsWith('check.mjs')) {
  let options, changed;
  try {
    options = selectionOptions();
    changed = options.all ? [] : changedFiles(options);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const {all, base} = options;
  console.log(
    `test selection: ${all ? 'complete npm test suite' : base ? `branch changes since merge base with ${base}, plus working tree` : 'working tree against HEAD plus untracked files'}`,
  );
  run('generate', 'node', ['scripts/generate.mjs']);
  run('typecheck', toolCommand('tsc', ['--noEmit']));
  // Prettier skips files it does not format (--ignore-unknown) and those in .prettierignore; `npm run format` fixes them.
  // Many changed files (a long-lived branch) check the whole tree instead: a command line has a length limit on Windows.
  const formattable = changed.filter(f => existsSync(join(ROOT, f)));
  if (all || formattable.length > 200)
    run('format:check', toolCommand('prettier', ['--check', '--log-level', 'warn', '.']));
  else if (formattable.length)
    run(
      `format:check (${formattable.length} changed file(s))`,
      toolCommand('prettier', ['--check', '--log-level', 'warn', '--ignore-unknown', ...formattable]),
    );
  run('lint:layers', 'node', ['scripts/lint/layers.mjs']);
  run('lint:game', 'node', ['scripts/lint/game-rules.mjs']);
  run('lint:generic', 'node', ['scripts/lint/genericity.mjs']);
  run('lint:types', 'node', ['scripts/lint/types.mjs']);
  run('lint:brief', toolCommand('tsx', ['scripts/lint/brief.ts', GAME]));
  run('lint:budgets', 'node', ['scripts/perf/budget-ratchet.mjs']);
  // Every GLB under a game's public/models that has an adjacent <name>.contract.json must meet it.
  run('asset:verify', 'node', ['scripts/asset-verify.mjs', '--all']);
  run('lint:provenance', toolCommand('tsx', ['scripts/lint/provenance.ts', GAME]));
  const tests = all ? [] : affectedTests(changed);
  if (all) run('tests (complete npm test suite)', npmCommand(['test']));
  else if (tests.length) {
    console.log(`selected test files (${tests.length}):\n${tests.map(t => `  ${t}`).join('\n')}`);
    run(`tests (${tests.length} file(s))`, toolCommand('tsx', ['--test', TAP_REPORTER, ...tests]));
  } else {
    console.log(noTestsMessage(base));
    results.push({name: 'tests (0 selected; not run)', ok: true, s: 0, out: ''});
  }
  for (const r of results)
    console.log(
      `${r.ok ? 'ok  ' : 'FAIL'} ${r.name} (${r.s.toFixed(1)} s)${r.out ? '\n' + r.out.replace(/^/gm, '     ') : ''}`,
    );
  const bad = results.filter(r => !r.ok);
  console.log(
    `check: ${bad.length ? 'FAIL (' + bad.map(r => r.name).join(', ') + ')' : 'PASS'} in ${((Date.now() - t0) / 1000).toFixed(0)} s · game ${GAME}${bad.length ? '' : ' · next: npm run play:snap to see it'}`,
  );
  process.exitCode = bad.length ? 1 : 0;
}
