import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  checkRatchet,
  findRaises,
  flattenBudgets,
  gameTemplate,
  parseTrailers,
  perfBudgetLines,
} from './budget-ratchet.mjs';

const data = (draws, extra = {}) => ({
  app: {firstLoadJsKiB: 500, appReadyMs: {desktop: 4000}},
  scenes: {main: {route: '#main', budget: {draws, textureMiB: 16, ports: {low: {draws: 10}}, ...extra}}},
});

test('budget keys cover app, scene and port numbers, and nothing else', () => {
  assert.deepEqual([...flattenBudgets(data(40)).keys()].sort(), [
    'app.appReadyMs.desktop',
    'app.firstLoadJsKiB',
    'main.draws',
    'main.ports.low.draws',
    'main.textureMiB',
  ]);
});

test('lowering, adding a scene or a metric is not a raise; a larger number or a dropped metric is', () => {
  assert.deepEqual(findRaises(data(40), data(30)), []);
  assert.deepEqual(findRaises(data(40), {...data(40), scenes: {...data(40).scenes, hall: {budget: {draws: 99}}}}), []);
  assert.deepEqual(findRaises(data(40), data(41)), [{key: 'main.draws', old: 40, now: 41}]);
  const dropped = data(40);
  delete dropped.scenes.main.budget.textureMiB;
  assert.deepEqual(findRaises(data(40), dropped), [{key: 'main.textureMiB', old: 16, now: null}]);
  assert.deepEqual(
    findRaises(data(40), {...data(40), scenes: {}}),
    [],
    'removing a whole scene removes its budget with it',
  );
});

test('a committed raise passes only with a trailer naming its key and new value', () => {
  const ok = checkRatchet({
    before: data(40),
    committed: data(44),
    working: data(44),
    trailerLines: ['main.draws 40 -> 44: the new fountain adds 4 draws'],
  });
  assert.equal(ok.ok, true, ok.failures.join('; '));
  const wrong = checkRatchet({
    before: data(40),
    committed: data(44),
    working: data(44),
    trailerLines: ['main.draws 40 -> 43: stale value'],
  });
  assert.equal(wrong.ok, false);
  assert.match(wrong.failures[0], /main\.draws rose 40 -> 44 without a matching/);
  assert.equal(checkRatchet({before: data(40), committed: data(44), working: data(44), trailerLines: []}).ok, false);
});

test('an uncommitted raise always fails; malformed trailers are reported', () => {
  const r = checkRatchet({
    before: data(40),
    committed: data(40),
    working: data(45),
    trailerLines: ['main.draws 40 -> 45: reason'],
  });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /not committed/);
  assert.deepEqual(parseTrailers(['nonsense']).problems.length, 1);
  assert.deepEqual(parseTrailers(['app.firstLoadJsKiB 500 -> 520: three upgrade']).trailers, [
    {key: 'app.firstLoadJsKiB', old: 500, now: 520, reason: 'three upgrade'},
  ]);
});

test("ratchet: a template's budgets carry the template name, so two games never share a trailer key", async () => {
  const {prefixed, prefixOf, findRaises} = await import('./budget-ratchet.mjs');
  assert.equal(prefixOf('templates/arcade/game/budgets.json'), 'arcade/');
  assert.equal(prefixOf('game/budgets.json'), '');
  const before = prefixed({app: {firstLoadJsKiB: 700}, scenes: {main: {budget: {draws: 10}}}}, 'arcade/');
  const after = prefixed({app: {firstLoadJsKiB: 720}, scenes: {main: {budget: {draws: 9}}}}, 'arcade/');
  assert.deepEqual(
    findRaises(before, after).map(r => r.key),
    ['arcade/app.firstLoadJsKiB'],
  );
});

// C10 (2026-10-04, D2b docs review): (1) a new ./game in an engine checkout was compared with origin/main, which has no
// ./game, so any raise above the template passed; (2) a Perf-Budget line in its own paragraph before Co-Authored-By
// was not read, because git parses only the last paragraph as trailers.
const budgetsFile = draws => JSON.stringify({app: {firstLoadJsKiB: 700}, scenes: {main: {budget: {draws}}}});

/** A throwaway engine checkout: templates at the base commit, no ./game; the ratchet copied in. */
function checkout() {
  const root = mkdtempSync(join(tmpdir(), 'ratchet-origin-'));
  const g = (...a) => execFileSync('git', a, {cwd: root, encoding: 'utf8'}).trim();
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@example.invalid');
  g('config', 'user.name', 'T');
  g('config', 'commit.gpgsign', 'false');
  mkdirSync(join(root, 'scripts', 'perf'), {recursive: true});
  cpSync(
    join(dirname(fileURLToPath(import.meta.url)), 'budget-ratchet.mjs'),
    join(root, 'scripts/perf/budget-ratchet.mjs'),
  );
  for (const t of ['blank', 'arcade']) {
    mkdirSync(join(root, 'templates', t, 'game'), {recursive: true});
    writeFileSync(join(root, 'templates', t, 'game', 'budgets.json'), budgetsFile(10));
  }
  g('add', '-A');
  g('commit', '-q', '-m', 'engine');
  const base = g('rev-parse', 'HEAD');
  const lint = () =>
    spawnSync(process.execPath, ['scripts/perf/budget-ratchet.mjs', '--base', base], {cwd: root, encoding: 'utf8'});
  return {root, g, base, lint};
}

test('C10: a new ./game is ratcheted against the template it started from, not an empty origin/main', () => {
  const {root, g, base, lint} = checkout();
  try {
    mkdirSync(join(root, 'game'));
    writeFileSync(join(root, 'game', '.origin.json'), JSON.stringify({template: 'blank', commit: base}));
    // Not committed yet: the template's numbers pass, a raise above them is reported as not committed.
    writeFileSync(join(root, 'game', 'budgets.json'), budgetsFile(10));
    assert.equal(lint().status, 0);
    writeFileSync(join(root, 'game', 'budgets.json'), budgetsFile(30));
    let r = lint();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /main\.draws 10 -> 30 is not committed/);
    assert.doesNotMatch(r.stderr, /app\./, 'an uncommitted game is not "every number missing"');
    g('add', '-A');
    g('commit', '-q', '-m', 'Start a game');
    r = lint();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /main\.draws rose 10 -> 30/);
    assert.match(r.stderr, /compared with templates\/blank \(\.origin\.json/);
    assert.match(r.stderr, /a line of its own, anywhere in the message/);
    // The trailer in its own paragraph before Co-Authored-By: git's trailer parser misses it; the ratchet reads it.
    g(
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'Bigger level',
      '-m',
      'Perf-Budget: main.draws 10 -> 30: the level needs it',
      '-m',
      'Co-Authored-By: Someone <s@example.invalid>',
    );
    assert.equal(g('log', '-1', '--format=%(trailers:key=Perf-Budget,valueonly)'), '');
    r = lint();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /1 raise\(s\)/);
    // Lowering below the template needs nothing.
    writeFileSync(join(root, 'game', 'budgets.json'), budgetsFile(5));
    g('commit', '-qam', 'Lower');
    assert.equal(lint().status, 0);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('C10: without .origin.json the template is the brief genre, else the best scene-id match', () => {
  const {root} = checkout();
  try {
    mkdirSync(join(root, 'game'));
    writeFileSync(join(root, 'game', 'budgets.json'), budgetsFile(30));
    assert.deepEqual(gameTemplate(root), {template: 'arcade', commit: null, from: 'scene ids'});
    writeFileSync(join(root, 'game', 'build.brief.ts'), "export default defineBuild({genre: 'blank'});");
    assert.deepEqual(gameTemplate(root), {template: 'blank', commit: null, from: 'genre'});
    writeFileSync(join(root, 'game', '.origin.json'), JSON.stringify({template: 'arcade', commit: 'abc'}));
    assert.deepEqual(gameTemplate(root), {template: 'arcade', commit: 'abc', from: '.origin.json'});
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('C10: Perf-Budget lines are read from any paragraph of a commit message', () => {
  assert.deepEqual(
    perfBudgetLines(
      'Title\n\nPerf-Budget: a.draws 1 -> 2: x\n\nbody\n\nPerf-Budget: b.draws 3 -> 4: y\nCo-Authored-By: z',
    ),
    ['a.draws 1 -> 2: x', 'b.draws 3 -> 4: y'],
  );
});
