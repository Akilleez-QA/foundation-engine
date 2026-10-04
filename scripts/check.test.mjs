import test from 'node:test';
import assert from 'node:assert/strict';
import {affectedTests, changedFiles, noTestsMessage, selectionOptions, testSummary} from './check.mjs';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

test("check: a changed file brings its own test, its game's tests, or its folder's tests", () => {
  assert.deepEqual(affectedTests(['src/kits/ui/index.ts'], 'templates/blank/game'), [
    'src/kits/ui/touch-button.test.ts',
    'src/kits/ui/ui.test.ts',
  ]);
  const game = affectedTests(['templates/arcade/game/steer.ts'], 'templates/arcade/game');
  assert.ok(game.includes('templates/arcade/game/play.test.ts') && game.includes('src/app/templates.test.ts'));
  assert.deepEqual(affectedTests(['docs/STANDARD.md'], 'templates/blank/game'), []);
  assert.ok(affectedTests(['src/core/ecs/world.ts'], 'templates/blank/game').includes('src/core/ecs/ecs.test.ts'));
});

test('check: changing the @engine barrel or the Vite config runs the barrel side-effect guard', () => {
  for (const f of ['src/author/index.ts', 'vite.config.ts'])
    assert.ok(affectedTests([f], 'templates/blank/game').includes('scripts/vite-config.test.mjs'), f);
  assert.ok(!affectedTests(['src/author/testing.ts'], 'templates/blank/game').includes('scripts/vite-config.test.mjs'));
});

test('check: a committed branch, dirty files, untracked paths and deleted sources remain selectable', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'foundation-check-'));
  t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const git = (...args) =>
    execFileSync(
      'git',
      ['-c', 'commit.gpgSign=false', '-c', `core.hooksPath=${join(cwd, 'disabled-hooks')}`, ...args],
      {cwd, encoding: 'utf8'},
    ).trim();
  const commit = message =>
    git('-c', 'user.name=Check test', '-c', 'user.email=check@example.invalid', 'commit', '-qm', message);
  git('init', '-q');
  writeFileSync(join(cwd, 'deleted.ts'), 'export const value = 1;');
  writeFileSync(join(cwd, 'dirty.ts'), 'export const value = 1;');
  writeFileSync(join(cwd, 'unstaged.ts'), 'export const value = 1;');
  git('add', '.');
  commit('baseline');
  const base = git('rev-parse', 'HEAD');
  git('checkout', '-qb', 'upstream');
  writeFileSync(join(cwd, 'upstream-only.ts'), 'export const upstream = true;');
  git('add', '.');
  commit('upstream change');
  git('checkout', '-qb', 'candidate', base);
  writeFileSync(join(cwd, 'committed.ts'), 'export const value = 2;');
  rmSync(join(cwd, 'deleted.ts'));
  git('add', '.');
  commit('branch change');
  assert.deepEqual(changedFiles({cwd}), [], 'clean committed tree selects no working-tree changes');
  writeFileSync(join(cwd, 'dirty.ts'), 'export const value = 3;');
  git('add', 'dirty.ts');
  writeFileSync(join(cwd, 'unstaged.ts'), 'export const value = 5;');
  writeFileSync(join(cwd, 'untracked space.ts'), 'export const value = 4;');
  assert.deepEqual(changedFiles({base, cwd}).sort(), [
    'committed.ts',
    'deleted.ts',
    'dirty.ts',
    'unstaged.ts',
    'untracked space.ts',
  ]);
  assert.deepEqual(
    changedFiles({base: 'upstream', cwd}).sort(),
    ['committed.ts', 'deleted.ts', 'dirty.ts', 'unstaged.ts', 'untracked space.ts'],
    'upstream-only edits must not be mistaken for candidate deletions',
  );
  assert.throws(() => changedFiles({base: 'nonexistent-revision', cwd}), /Cannot select tests/);
  git('mv', 'committed.ts', 'renamed.ts');
  assert.deepEqual(
    changedFiles({cwd}).sort(),
    ['committed.ts', 'dirty.ts', 'renamed.ts', 'unstaged.ts', 'untracked space.ts'],
    'rename selects both source and destination',
  );
  assert.ok(
    affectedTests(['src/kits/ui/deleted-source.ts'], 'templates/blank/game').includes('src/kits/ui/ui.test.ts'),
  );
});

test('check: complete test totals remain visible without per-test output', () => {
  assert.equal(
    testSummary(
      'ok 1 - example\n# tests 5\n# suites 0\n# pass 5\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 12\n',
    ),
    '# tests 5\n# pass 5\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 12',
  );
  assert.equal(testSummary('no test output'), '');
  assert.equal(
    testSummary(
      '✔ example\nℹ tests 5\nℹ suites 0\nℹ pass 5\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 12\n',
    ),
    '# tests 5\n# pass 5\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 12',
    'Node 23+ spec summaries',
  );
});

test('check: selection options reject missing or conflicting revisions', () => {
  assert.deepEqual(selectionOptions(['--base', 'origin/main']), {base: 'origin/main', all: false});
  assert.deepEqual(selectionOptions(['--all']), {base: undefined, all: true});
  assert.deepEqual(selectionOptions(['--game', 'templates/blank/game', '--base=origin/main']), {
    base: 'origin/main',
    all: false,
  });
  assert.deepEqual(selectionOptions(['--game=templates/blank/game', '--all']), {base: undefined, all: true});
  for (const argv of [
    ['--base'],
    ['--base='],
    ['--al'],
    ['--game'],
    ['--game='],
    ['--base', '--all'],
    ['--base', 'HEAD', '--base', 'HEAD~1'],
    ['--all', '--base', 'HEAD'],
  ]) {
    assert.throws(() => selectionOptions(argv));
  }
});

test('check: the zero-tests line suggests --base only when the selection did not already use it', () => {
  assert.match(noTestsMessage(undefined), /use --base <ref>, --all, or run explicit tests/);
  const based = noTestsMessage('origin/main');
  assert.match(based, /^No tests selected \(0 files\)/);
  assert.match(based, /since the merge base with origin\/main/);
  assert.match(based, /not test-suite acceptance/);
  assert.doesNotMatch(based, /--base/);
});
