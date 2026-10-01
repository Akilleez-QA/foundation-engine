// The generators write working code: generate every kind into a scratch copy of the explorer template, then load
// the game, compile it and run the generated tests' subject through testScene.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { generate } from './new';
import { ROOT } from './lib/game-dir.mjs';
import { loadGame } from '../src/app/game-files';
import { compileGame } from '../src/author/compile';

test('new: a lesson is generated outline-first into the learn template and passes the pedagogy rules', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'engine-gen-learn-'));
  try {
    cpSync(join(ROOT, 'templates', 'learn'), tmp, { recursive: true });
    const dir = join(tmp, 'game');
    const r = await generate('lesson', 'seasons', {}, dir);
    assert.ok(r.files.some(f => f.endsWith('seasons-lesson.ts')) && r.files.some(f => f.includes('(row seasons)')));
    const { brief, game, defs } = await loadGame(dir);
    assert.ok(compileGame({ brief, game, defs }).scenes.some(s => s.id === 'seasons'));
    const { lessonProblems } = await import('../src/kits/learn/lesson');
    const lesson = (await import(pathToFileURL(join(dir, 'seasons-lesson.ts')).href)).default;
    const strings = JSON.parse(readFileSync(join(dir, 'strings.en.json'), 'utf8'));
    assert.deepEqual(lessonProblems(lesson, { maxPassive: brief.pedagogy.maxPassiveActions, ages: brief.audience.ages, text: (k: string) => strings[k] ?? k }), []);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('new: every game generator writes files that load, compile and keep the brief', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'engine-gen-'));
  try {
    cpSync(join(ROOT, 'templates', 'explorer'), tmp, { recursive: true });
    const dir = join(tmp, 'game');
    const made: string[] = [];
    for (const [kind, id, opts] of [['scene', 'cellar', {}], ['entity', 'rock', {}], ['component', 'health', {}], ['system', 'regen', {}], ['input', 'jump', {}], ['input', 'lean', { axis: true }], ['save-section', 'stats', {}], ['interactable', 'chest', {}], ['interactable', 'gate', { door: 'garden' }], ['area', 'meadow', {}]] as const)
      made.push(...(await generate(kind, id, opts as Record<string, string | boolean>, dir)).files);
    assert.ok(made.some(f => f.endsWith('cellar.ts')) && made.some(f => f.includes('budgets.json (row meadow)')));
    assert.match(readFileSync(join(dir, 'cellar.ts'), 'utf8'), /entities: \[/, 'default scene keeps inline entities');
    assert.equal(existsSync(join(dir, 'cellar.body.mts')), false, 'default generator does not create a lazy body');
    await assert.rejects(generate('scene', 'cellar', {}, dir), /already exists/);
    await assert.rejects(generate('scene', 'Bad_Id', {}, dir), /kebab-case/);
    const { brief, game, defs } = await loadGame(dir);
    const compiled = compileGame({ brief, game, defs });
    assert.ok(compiled.scenes.some(s => s.id === 'cellar') && compiled.scenes.some(s => s.id === 'meadow'));
    const budgets = JSON.parse(readFileSync(join(dir, 'budgets.json'), 'utf8'));
    assert.equal(budgets.scenes.cellar.budget.draws, brief.performance.perScene.draws, 'an unmeasured scene starts at the brief\'s ceiling');
    assert.match(readFileSync(join(tmp, 'GAME.md'), 'utf8'), /Added scene `cellar`/);
    assert.match(readFileSync(join(dir, 'jump.ts'), 'utf8'), /tap: true/, 'the brief lists touch, so a button also answers a tap');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});


test('new: opt-in lazy scene body loads through SceneBody and refuses partial overwrite', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'engine-gen-lazy-'));
  try {
    cpSync(join(ROOT, 'templates', 'explorer'), tmp, { recursive: true });
    const dir = join(tmp, 'game');
    await generate('scene', 'archive', { 'lazy-body': true }, dir);
    const definition = readFileSync(join(dir, 'archive.ts'), 'utf8');
    assert.match(definition, /body: \(\) => import\('\.\/archive\.body\.mts'\)/);

    const { brief, game, defs } = await loadGame(dir);
    const scene = compileGame({ brief, game, defs }).scenes.find(s => s.id === 'archive')!;
    assert.ok(scene);
    const { testScene } = await import('../src/author/testing');
    const t = await testScene(scene, { game });
    t.run(1);
    assert.ok(t.world.count > 0);

    writeFileSync(join(dir, 'reserved.body.mts'), 'export default {};');
    await assert.rejects(generate('scene', 'reserved', { 'lazy-body': true }, dir), /already exists/);
    assert.equal(existsSync(join(dir, 'reserved.ts')), false, 'collision is rejected before writing the definition');
    assert.equal(readFileSync(join(dir, 'reserved.body.mts'), 'utf8'), 'export default {};');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
