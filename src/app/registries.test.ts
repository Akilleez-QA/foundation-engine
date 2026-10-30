// The one test that checks every registry (ADR 0043; STD-REG-4). It boots the app's module list in node with no DOM:
// the layer modules (app/layer-modules.ts), the game compiled from GAME_DIR (scripts/lib/game-dir.mjs), and every manifest the app discovers by
// folder (`features/*/index.ts`, `packs/*/index.ts`), with their installs left out (the browser installs are covered by the bench and the browser
// checks). Then it runs check('report') over every frozen registry. A new registry or row is covered without editing
// this test.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readdirSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {BootValidationError, createApp} from '../core/app';
import {adminOf, type Registry} from '../core/registry';
import type {EngineModule} from '../core/module';
import {layerModules} from './layer-modules';
import {compileGame} from '../author/compile';
import {loadGame} from './game-files';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const manifests = (): string[] =>
  ['features', 'packs'].flatMap(dir =>
    existsSync(join(SRC, dir))
      ? readdirSync(join(SRC, dir))
          .map(d => join(SRC, dir, d, 'index.ts'))
          .filter(existsSync)
      : [],
  );

async function appModules(): Promise<EngineModule[]> {
  const found = await Promise.all(
    manifests().map(f => import(pathToFileURL(f).href) as Promise<{default: EngineModule}>),
  );
  const {brief, game, defs} = await loadGame();
  const compiled = compileGame({brief, game, defs});
  return [...layerModules(game, brief), ...compiled.modules, ...found.map(m => m.default)].map(m => ({
    ...m,
    install: undefined,
  }));
}
const quiet = {log: () => {}};

test('registries: every registry the app boots is valid, from the frozen boot', async () => {
  const app = createApp(await appModules(), {mode: 'test', ...quiet});
  const report = await app.boot();
  assert.deepEqual(
    report.modules.filter(m => m.status !== 'installed').map(m => `${m.id}: ${m.status} ${m.reason ?? ''}`),
    [],
  );
  assert.deepEqual(report.problems, []);
  assert.deepEqual(report.patches.errors, []);
  assert.deepEqual(report.warnings, []);
  const registries = Object.values(app.registries) as Registry<{id: string}>[];
  for (const name of ['saveSections', 'features', 'scenes', 'redirects', 'inputActions', 'cues', 'modes', 'assets'])
    assert.ok(
      registries.some(r => r.name === name),
      `registry ${name} is defined`,
    );
  for (const r of registries) assert.deepEqual(adminOf(r).check('report'), [], `registry ${r.name}`);
  app.dispose();
});

test('registries: the full module list boots in DEV mode with unique ids and no problems', async () => {
  const all = await appModules();
  const ids = all.map(m => m.id);
  assert.deepEqual(
    ids.filter((id, i) => ids.indexOf(id) !== i),
    [],
    'module ids are unique',
  );
  const report = await createApp(all, {mode: 'dev', ...quiet}).boot();
  assert.deepEqual(report.problems, []);
  assert.deepEqual(report.warnings, []);
});

test('registries: a DEV boot with a broken row fails with a readable BootValidationError', async () => {
  const broken: EngineModule = {
    id: 'feature.broken-mode-test',
    version: '0.0.0',
    requires: ['feature.game'],
    register(r) {
      r.modes.add({kind: 'mode', id: 'broken', title: 'Broken', scene: 'no-such-scene'}, 'feature.broken-mode-test');
    },
  };
  const app = createApp([...(await appModules()), broken], {mode: 'dev', ...quiet});
  await assert.rejects(app.boot(), (e: unknown) => e instanceof BootValidationError && /no-such-scene/.test(e.message));
});
