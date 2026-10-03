// The generators write working code: generate every kind into a scratch copy of the explorer template, then load
// the game, compile it and run the generated tests' subject through testScene.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {generate, withChangelogRow} from './new';
import {ROOT} from './lib/game-dir.mjs';
import {loadGame} from '../src/app/game-files';
import {compileGame} from '../src/author/compile';
import {gameInputProblems} from '../src/author/input-registry';
import {must} from '../src/testing/must';

test('new: a lesson is generated outline-first into the learn template and passes the pedagogy rules', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'engine-gen-learn-'));
  try {
    cpSync(join(ROOT, 'templates', 'learn'), tmp, {recursive: true});
    const dir = join(tmp, 'game');
    const r = await generate('lesson', 'seasons', {}, dir);
    assert.ok(r.files.some(f => f.endsWith('seasons-lesson.ts')) && r.files.some(f => f.includes('(row seasons)')));
    const {brief, game, defs} = await loadGame(dir);
    assert.ok(compileGame({brief, game, defs}).scenes.some(s => s.id === 'seasons'));
    const {lessonProblems} = await import('../src/kits/learn/lesson');
    const lesson = (await import(pathToFileURL(join(dir, 'seasons-lesson.ts')).href)).default;
    const strings = JSON.parse(readFileSync(join(dir, 'strings.en.json'), 'utf8'));
    assert.deepEqual(
      lessonProblems(lesson, {
        maxPassive: brief.pedagogy.maxPassiveActions,
        ages: brief.audience.ages,
        text: (k: string) => strings[k] ?? k,
      }),
      [],
    );
  } finally {
    rmSync(tmp, {recursive: true, force: true});
  }
});

test('new: every game generator writes files that load, compile and keep the brief', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'engine-gen-'));
  try {
    cpSync(join(ROOT, 'templates', 'explorer'), tmp, {recursive: true});
    const dir = join(tmp, 'game');
    const made: string[] = [];
    for (const [kind, id, opts] of [
      ['scene', 'cellar', {}],
      ['entity', 'rock', {}],
      ['component', 'health', {}],
      ['system', 'regen', {}],
      ['input', 'jump', {}],
      ['input', 'lean', {axis: true}],
      ['save-section', 'stats', {}],
      ['interactable', 'chest', {}],
      ['interactable', 'gate', {door: 'garden'}],
      ['area', 'meadow', {}],
    ] as const)
      made.push(...(await generate(kind, id, opts as Record<string, string | boolean>, dir)).files);
    assert.ok(made.some(f => f.endsWith('cellar.ts')) && made.some(f => f.includes('budgets.json (row meadow)')));
    assert.match(readFileSync(join(dir, 'cellar.ts'), 'utf8'), /entities: \[/, 'default scene keeps inline entities');
    assert.equal(existsSync(join(dir, 'cellar.body.mts')), false, 'default generator does not create a lazy body');
    await assert.rejects(generate('scene', 'cellar', {}, dir), /already exists/);
    await assert.rejects(generate('scene', 'Bad_Id', {}, dir), /kebab-case/);
    const {brief, game, defs} = await loadGame(dir);
    const compiled = compileGame({brief, game, defs});
    assert.ok(compiled.scenes.some(s => s.id === 'cellar') && compiled.scenes.some(s => s.id === 'meadow'));
    const budgets = JSON.parse(readFileSync(join(dir, 'budgets.json'), 'utf8'));
    assert.equal(
      budgets.scenes.cellar.budget.draws,
      brief.performance.perScene.draws,
      "an unmeasured scene starts at the brief's ceiling",
    );
    assert.equal(
      'loadMiB' in budgets.scenes.cellar.budget,
      false,
      'no invented entry cost: an absent metric is unmeasured',
    );
    assert.match(readFileSync(join(tmp, 'GAME.md'), 'utf8'), /Added scene `cellar`/);
    assert.match(
      readFileSync(join(dir, 'jump.ts'), 'utf8'),
      /tap: true/,
      'the brief lists touch, so a button also answers a tap',
    );
    assert.deepEqual(gameInputProblems(game, defs), [], "generated bindings pass the boot's inputActions validation");
  } finally {
    rmSync(tmp, {recursive: true, force: true});
  }
});

test('new: opt-in lazy scene body loads through SceneBody and refuses partial overwrite', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'engine-gen-lazy-'));
  try {
    cpSync(join(ROOT, 'templates', 'explorer'), tmp, {recursive: true});
    const dir = join(tmp, 'game');
    await generate('scene', 'archive', {'lazy-body': true}, dir);
    const definition = readFileSync(join(dir, 'archive.ts'), 'utf8');
    assert.match(definition, /body: \(\) => import\('\.\/archive\.body\.mts'\)/);

    const {brief, game, defs} = await loadGame(dir);
    const scene = compileGame({brief, game, defs}).scenes.find(s => s.id === 'archive')!;
    assert.ok(scene);
    const {testScene} = await import('../src/author/testing');
    const t = await testScene(scene, {game});
    t.run(1);
    assert.ok(t.world.count > 0);

    writeFileSync(join(dir, 'reserved.body.mts'), 'export default {};');
    await assert.rejects(generate('scene', 'reserved', {'lazy-body': true}, dir), /already exists/);
    assert.equal(existsSync(join(dir, 'reserved.ts')), false, 'collision is rejected before writing the definition');
    assert.equal(readFileSync(join(dir, 'reserved.body.mts'), 'utf8'), 'export default {};');
  } finally {
    rmSync(tmp, {recursive: true, force: true});
  }
});

test('new: generated inputs take free bindings from the boot table and never clash with the engine or each other', async () => {
  // Regression: `new input` always wrote keys ['f'], pad ['x']; pad x is shell.menu's, so the game did not boot.
  for (const template of ['blank', 'arcade', 'explorer', 'learn']) {
    const tmp = mkdtempSync(join(tmpdir(), `engine-gen-input-${template}-`));
    try {
      cpSync(join(ROOT, 'templates', template), tmp, {recursive: true});
      const dir = join(tmp, 'game');
      for (const id of ['jump', 'dash', 'crouch', 'throw']) await generate('input', id, {}, dir);
      await generate('input', 'lean', {axis: true}, dir);
      await generate('input', 'tilt', {axis: true}, dir);
      const {game, defs} = await loadGame(dir);
      assert.deepEqual(gameInputProblems(game, defs), [], `${template}: generated inputs pass the boot check`);
      const jump = readFileSync(join(dir, 'jump.ts'), 'utf8');
      assert.doesNotMatch(jump, /pad: \['x'\]/, `${template}: pad x belongs to shell.menu`);
    } finally {
      rmSync(tmp, {recursive: true, force: true});
    }
  }
});

test('new: a changelog row lands at the end of the Changelog table, not after later sections', () => {
  const md =
    '# Game\n\n## Changelog\n\n| Date | Change | Budgets |\n|---|---|---|\n| 1 | first | |\n\n## Milestone\n\n- notes\n';
  assert.equal(
    withChangelogRow(md, '| 2 | second | |'),
    '# Game\n\n## Changelog\n\n| Date | Change | Budgets |\n|---|---|---|\n| 1 | first | |\n| 2 | second | |\n\n## Milestone\n\n- notes\n',
  );
  assert.equal(withChangelogRow('# Game\n', '| 2 | x | |'), '# Game\n| 2 | x | |\n');
  assert.equal(
    withChangelogRow('# Game\n\n## Changelog\n\n## Next\n', '| 2 | x | |'),
    '# Game\n\n## Changelog\n\n| Date | Change | Budgets |\n|---|---|---|\n| 2 | x | |\n\n## Next\n',
    'a heading without a table gets the header first',
  );
});

test('new: the free-key choice never picks a letter already bound by code (f when code:KeyF is taken)', async () => {
  const {freeButtonBinding, keyIdentity} = await import('../src/author/input-registry');
  const {defineInput} = await import('../src/author/defs');
  const letters = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
  // Every candidate letter bound by code on a pad-free axis... except none: then the generator must refuse.
  const defs = [
    defineInput({
      id: 'all',
      label: 'All',
      axis: {
        negative: {
          keys: letters.slice(0, 18).map(l => (/\d/.test(l) ? `code:Digit${l}` : `code:Key${l.toUpperCase()}`)),
          pad: ['rs-left'],
        },
        positive: {
          keys: letters.slice(18).map(l => (/\d/.test(l) ? `code:Digit${l}` : `code:Key${l.toUpperCase()}`)),
          pad: ['rs-right'],
        },
      },
    }),
  ];
  const game = {kind: 'game', id: 'g', title: 'G', version: '1', firstScene: 'x'} as never;
  assert.throws(() => freeButtonBinding(game, defs, 'jump'), /no free key/);
  const some = [defineInput({id: 'one', label: 'One', keys: ['code:KeyF'], pad: ['y']})];
  assert.notEqual(keyIdentity(must(freeButtonBinding(game, some, 'jump').keys[0], 'a free key')), 'f');
});

test('new: a generated scene row passes the budget check when it becomes the start scene', async () => {
  // The bench never measures the start scene's entry cost; a generated loadMiB would be reported missing and fail the gate.
  const tmp = mkdtempSync(join(tmpdir(), 'engine-gen-budget-'));
  try {
    cpSync(join(ROOT, 'templates', 'arcade'), tmp, {recursive: true});
    const dir = join(tmp, 'game');
    await generate('scene', 'arena', {}, dir);
    const row = JSON.parse(readFileSync(join(dir, 'budgets.json'), 'utf8')).scenes.arena;
    assert.equal(row.budget.loadMiB, undefined);
    assert.match(row.provenance.measured, /^unmeasured/);
    const {checkBudgets, toCheckBudget} = await import('../src/platform/perf/budget-check');
    // A start-scene window: counts measured, no enterMB (the bench does not enter the first scene).
    const sample = {drawsPerRenderedFrame: 3, trisPerRenderedFrame: 100, textureMiB: 0, heapMB: 1, liveContexts: 1};
    const metrics = ['draws', 'triangles', 'textureMiB', 'heapMiB', 'contexts', 'loadMiB'] as const;
    const report = checkBudgets(
      {'arena:active': sample},
      {arena: toCheckBudget(row.budget)},
      [{scene: 'arena', sample: 'arena:active', metrics}],
      {tier: 'reference'},
    );
    assert.deepEqual(
      report.rows.filter(r => r.verdict !== 'pass').map(r => `${r.metric} ${r.verdict}`),
      [],
      'nothing reported missing or over',
    );
    assert.equal(report.rows.length, metrics.length - 1, 'loadMiB is skipped as unmeasured, not checked');
  } finally {
    rmSync(tmp, {recursive: true, force: true});
  }
});
