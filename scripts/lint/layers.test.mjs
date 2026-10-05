// W1-6: a game's build-time tools live in <game>/tools/ and its static files in <game>/public/; neither is game code.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkGame, escapeHatchFiles, gameDirs, listedKits} from './layers.mjs';

const game = files => {
  const dir = mkdtempSync(join(tmpdir(), 'layers-game-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), {recursive: true});
    writeFileSync(join(dir, path), text);
  }
  return dir;
};
const rules = v => v.map(x => `${x.rule} ${x.to}`);

test('a tool in <game>/tools/ may import node: modules and packages; game code may not', t => {
  const dir = game({
    'tools/make-tile.mjs':
      "import {writeFileSync} from 'node:fs';\nimport {deflateSync} from 'node:zlib';\nimport data from '../levels.json' with {type: 'json'};\n",
    'tools/lib/png.ts': "import {crc32} from 'node:zlib';\nexport const x = crc32;\n",
    'scene.ts': "import {defineScene} from '@engine';\nimport {readFileSync} from 'node:fs';\n",
  });
  t.after(() => rmSync(dir, {recursive: true}));
  assert.deepEqual(rules(checkGame(dir)), ['game-imports-engine-only node:fs']);
});

test('game code never imports a tool, so no node-only code reaches the browser build', t => {
  const dir = game({
    'tools/make.mjs': 'export const make = 1;\n',
    'scene.ts': "import {make} from './tools/make.mjs';\n",
    'deep/b.ts': "import '../tools/make.mjs';\n",
  });
  t.after(() => rmSync(dir, {recursive: true}));
  assert.deepEqual(rules(checkGame(dir)).sort(), [
    'game-imports-no-tools ../tools/make.mjs',
    'game-imports-no-tools ./tools/make.mjs',
  ]);
});

test('static files in <game>/public/ (a decoder script) are not read as game code', t => {
  const dir = game({
    'public/decoders/draco.js': "import x from 'https://example.invalid/x.js';\n",
    'scene.ts': "import {defineScene} from '@engine';\n",
  });
  t.after(() => rmSync(dir, {recursive: true}));
  assert.deepEqual(checkGame(dir), []);
});

test('only the top-level tools/ and public/ folders are exempt: a nested folder of that name is game code', t => {
  const dir = game({'levels/tools/x.ts': "import 'node:fs';\n"});
  t.after(() => rmSync(dir, {recursive: true}));
  assert.deepEqual(rules(checkGame(dir)), ['game-imports-engine-only node:fs']);
});

const optedIn = {
  'game.ts':
    "import {defineGame} from '@engine';\nimport {ui} from '@kits/ui';\nimport {three as glKit} from '@kits/three';\nexport default defineGame({id: 'g', title: 'G', version: '1', firstScene: 'a', kits: [ui({lines: [1]}), glKit()]});\n",
  'look.ts':
    "import * as T from 'three';\nimport {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';\nimport {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';\nimport {useThree} from '@kits/three';\n",
};

test('the three.js escape hatch: a game that lists three() may import three, its addons and examples', t => {
  const dir = game(optedIn);
  t.after(() => rmSync(dir, {recursive: true}));
  assert.deepEqual([...listedKits(dir)].sort(), ['three', 'ui']);
  assert.deepEqual(checkGame(dir), []);
  assert.deepEqual(
    escapeHatchFiles(dir).map(f => f.split('/').pop()),
    ['game.ts', 'look.ts'],
    'npm run check names every file that uses it',
  );
});

test('the three.js escape hatch is opt-in: without three() in kits, every three import and @kits/three is refused', t => {
  const dir = game({
    ...optedIn,
    // Imported but not listed (and a call outside the kits array does not count).
    'game.ts':
      "import {defineGame} from '@engine';\nimport {three} from '@kits/three';\nthree();\nexport default defineGame({id: 'g', title: 'G', version: '1', firstScene: 'a', kits: []});\n",
  });
  t.after(() => rmSync(dir, {recursive: true}));
  assert.deepEqual([...listedKits(dir)], []);
  assert.deepEqual(rules(checkGame(dir)).sort(), [
    'kit-not-listed @kits/three',
    'kit-not-listed @kits/three',
    'three-needs-kit three',
    'three-needs-kit three/addons/postprocessing/EffectComposer.js',
    'three-needs-kit three/examples/jsm/loaders/GLTFLoader.js',
  ]);
});

test('three/webgpu and three/tsl stay refused even in a game that opts in (ADR 0078); a look-alike package too', t => {
  const dir = game({
    ...optedIn,
    'gpu.ts':
      "import {WebGPURenderer} from 'three/webgpu';\nimport {color} from 'three/tsl';\nimport x from 'three-stdlib';\n",
  });
  t.after(() => rmSync(dir, {recursive: true}));
  assert.deepEqual(rules(checkGame(dir)).sort(), [
    'game-imports-engine-only three-stdlib',
    'game-imports-engine-only three/tsl',
    'game-imports-engine-only three/webgpu',
  ]);
});

test('every template and the default game stay without the escape hatch', () => {
  // Labs and tool fixture games may opt in (labs try what the engine cannot say yet); templates and ./game may not.
  for (const dir of gameDirs().filter(d => !/[\\/](labs|tools)[\\/][^\\/]+[\\/]game$/.test(d))) {
    assert.equal(listedKits(dir).has('three'), false, dir);
    assert.deepEqual(escapeHatchFiles(dir), [], dir);
  }
});
