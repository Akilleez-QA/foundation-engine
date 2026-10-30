// Every template is a complete game (docs/recipes/add-a-template.md): a GAME.md, a brief whose genre is the template's
// name, a game whose first scene exists, and a budget row for every scene. The registries boot for each one.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from '../core/app';
import {compileGame} from '../author/compile';
import type {SceneDefinition} from '../author/defs';
import {layerModules} from './layer-modules';
import {loadGame} from './game-files';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TEMPLATES = join(ROOT, 'templates');
const names = existsSync(TEMPLATES)
  ? readdirSync(TEMPLATES).filter(n => !n.startsWith('.') && existsSync(join(TEMPLATES, n, 'game')))
  : [];

test('templates: at least the blank template exists', () => {
  assert.ok(names.includes('blank'));
});

for (const name of names) {
  test(`template ${name}: complete, consistent with its brief, and boots`, async () => {
    const dir = join(TEMPLATES, name, 'game');
    for (const f of ['../GAME.md', 'build.brief.ts', 'game.ts', 'budgets.json'])
      assert.ok(existsSync(join(dir, f)), `${name}: missing ${f}`);
    const {brief, game, defs} = await loadGame(dir);
    assert.equal(brief.genre, name, "the brief's genre names the template");
    const scenes = defs.filter((d): d is SceneDefinition => d.kind === 'scene').map(s => s.id);
    assert.ok(scenes.includes(game.firstScene), 'the first scene exists');
    const budgets = JSON.parse(readFileSync(join(dir, 'budgets.json'), 'utf8')) as {
      scenes: Record<string, {scene: string; route: string}>;
    };
    for (const id of scenes) {
      assert.ok(budgets.scenes[id], `${name}: scene ${id} has a budget row`);
      assert.equal(budgets.scenes[id].scene, `scene.${id}`);
      assert.equal(budgets.scenes[id].route, `#scene/${id}`);
    }
    assert.equal(Object.keys(budgets.scenes)[0], game.firstScene, 'the bench starts where the game starts');
    for (const v of brief.quality.views) assert.ok(scenes.includes(v.scene), `quality view ${v.id} names a real scene`);
    const md = readFileSync(join(dir, '..', 'GAME.md'), 'utf8');
    for (const c of brief.success) assert.ok(md.includes(c.id), `GAME.md mirrors success criterion ${c.id}`);
    const compiled = compileGame({brief, game, defs});
    const report = await createApp(
      [...layerModules(game, brief), ...compiled.modules].map(m => ({...m, install: undefined})),
      {mode: 'dev', log: () => {}},
    ).boot();
    assert.deepEqual(report.problems, []);
  });
}
