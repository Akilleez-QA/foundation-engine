// W1-6: a game's build-time tools live in <game>/tools/ and its static files in <game>/public/; neither is game code.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkGame} from './layers.mjs';

const game = files => {
  const dir = mkdtempSync(join(tmpdir(), 'layers-game-'));
  for (const [path, text] of Object.entries(files)) { mkdirSync(join(dir, path, '..'), {recursive: true}); writeFileSync(join(dir, path), text); }
  return dir;
};
const rules = v => v.map(x => `${x.rule} ${x.to}`);

test('a tool in <game>/tools/ may import node: modules and packages; game code may not', t => {
  const dir = game({
    'tools/make-tile.mjs': "import {writeFileSync} from 'node:fs';\nimport {deflateSync} from 'node:zlib';\nimport data from '../levels.json' with {type: 'json'};\n",
    'tools/lib/png.ts': "import {crc32} from 'node:zlib';\nexport const x = crc32;\n",
    'scene.ts': "import {defineScene} from '@engine';\nimport {readFileSync} from 'node:fs';\n",
  });
  t.after(() => rmSync(dir, {recursive: true}));
  assert.deepEqual(rules(checkGame(dir)), ['game-imports-engine-only node:fs']);
});

test('game code never imports a tool, so no node-only code reaches the browser build', t => {
  const dir = game({'tools/make.mjs': 'export const make = 1;\n', 'scene.ts': "import {make} from './tools/make.mjs';\n", 'deep/b.ts': "import '../tools/make.mjs';\n"});
  t.after(() => rmSync(dir, {recursive: true}));
  assert.deepEqual(rules(checkGame(dir)).sort(), ['game-imports-no-tools ../tools/make.mjs', 'game-imports-no-tools ./tools/make.mjs']);
});

test('static files in <game>/public/ (a decoder script) are not read as game code', t => {
  const dir = game({'public/decoders/draco.js': "import x from 'https://example.invalid/x.js';\n", 'scene.ts': "import {defineScene} from '@engine';\n"});
  t.after(() => rmSync(dir, {recursive: true}));
  assert.deepEqual(checkGame(dir), []);
});

test('only the top-level tools/ and public/ folders are exempt: a nested folder of that name is game code', t => {
  const dir = game({'levels/tools/x.ts': "import 'node:fs';\n"});
  t.after(() => rmSync(dir, {recursive: true}));
  assert.deepEqual(rules(checkGame(dir)), ['game-imports-engine-only node:fs']);
});
