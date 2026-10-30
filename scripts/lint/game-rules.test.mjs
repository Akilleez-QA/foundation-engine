import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkGameRules, checkSource, format} from './game-rules.mjs';

const SCRIPT = fileURLToPath(new URL('./game-rules.mjs', import.meta.url));

/** A throwaway game folder holding `files` ({path: source}); returns the folder and a cleanup. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'game-rules-'));
  const dir = join(root, 'game');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), {recursive: true});
    writeFileSync(join(dir, path), text);
  }
  return {root, dir, done: () => rmSync(root, {recursive: true, force: true})};
}

const HUD = "import { hud } from '@kits/ui';\nimport { defineSystem } from '@engine';\n";

test('lint:game: Math.random() in a game file fails and names ctx.random()', () => {
  const f = fixture({'field.ts': 'export const spawnX = () => (Math.random() * 2 - 1) * 4;\n'});
  try {
    const v = checkGameRules(f.dir, f.root);
    assert.deepEqual(
      v.map(x => [x.file, x.line, x.rule]),
      [['game/field.ts', 1, 'math-random']],
    );
    assert.match(format(v[0]), /use ctx\.random\(\) \(seeded, replayable with \?seed=\)/);
  } finally {
    f.done();
  }
});

test('lint:game: a literal HUD string fails and names defineGame({ strings }) and ctx.text', () => {
  const f = fixture({
    'field.ts':
      HUD +
      "export default defineSystem({ id: 'coins', phase: 'frame', run(ctx) {\n  hud(ctx).line('coins', `Coins ${ctx.state.coins}`);\n  hud(ctx).banner('You win');\n  hud(ctx).prompt(ctx.text('game.hint'));\n} });\n",
  });
  try {
    const v = checkGameRules(f.dir, f.root);
    assert.deepEqual(
      v.map(x => [x.line, x.rule]),
      [
        [4, 'literal-ui-text'],
        [5, 'literal-ui-text'],
      ],
    );
    assert.match(format(v[0]), /add a string key via defineGame\(\{ strings.*ctx\.text\(/);
  } finally {
    f.done();
  }
});

test('lint:game: literal DOM text fails; string keys, the strings table and input labels pass', () => {
  assert.deepEqual(
    checkSource("el.textContent = 'Game over';\nb.setAttribute('aria-label', 'Close');\n").map(v => v.line),
    [1, 2],
  );
  assert.deepEqual(
    checkSource(
      [
        "el.textContent = ctx.text('game.over');",
        "export default defineGame({ strings: { en: { 'game.hud.coins': 'Coins {n}' } } });",
        "export const jump = defineInput({ id: 'jump', label: 'Jump', keys: ['Space'] });",
        "hud(ctx).line('coins', null); hud(ctx).banner(null); h.line(id, `${n}`);",
        'const seeded = ctx.random(); // Math.random() in a comment is not code',
      ].join('\n'),
    ),
    [],
  );
});

test('lint:game: tools/, public/ and test files are not game code', () => {
  const f = fixture({
    'tools/make-atlas.ts': 'export const jitter = Math.random();\n',
    'public/decoder.js': 'var r = Math.random();\n',
    'field.test.ts': "const n = Math.random(); el.textContent = 'x ' + n;\n",
    'field.ts': 'export const n = 1;\n',
  });
  try {
    assert.deepEqual(checkGameRules(f.dir, f.root), []);
  } finally {
    f.done();
  }
});

test('lint:game: an escape comment with a reason allows one line; without a reason it does not', () => {
  assert.deepEqual(
    checkSource(
      [
        '// lint-game-allow math-random: cosmetic sparkle offset, never affects state',
        'const a = Math.random();',
        "el.textContent = '©'; hud(ctx).banner('v1.2 build'); // lint-game-allow literal-ui-text: build stamp, not translated",
      ].join('\n'),
    ),
    [],
  );
  assert.deepEqual(
    checkSource('// lint-game-allow math-random:\nconst a = Math.random();\n').map(v => v.rule),
    ['math-random'],
  );
  assert.deepEqual(
    checkSource('// lint-game-allow literal-ui-text: wrong rule\nconst a = Math.random();\n').map(v => v.rule),
    ['math-random'],
  );
});

test('lint:game: three/webgpu and three/tsl imports fail in game code, with no escape (ADR 0078)', () => {
  const v = checkSource(
    [
      "import { WebGPURenderer } from 'three/webgpu';",
      "import * as TSL from 'three/tsl';",
      "const lazy = () => import('three/webgpu');",
      '// lint-game-allow three-webgpu: a reason does not help',
      "import 'three/webgpu';",
    ].join('\n'),
  );
  assert.deepEqual(
    v.map(x => [x.line, x.rule]),
    [
      [1, 'three-webgpu'],
      [2, 'three-webgpu'],
      [3, 'three-webgpu'],
      [5, 'three-webgpu'],
    ],
  );
  assert.match(format({...v[0], file: 'game/x.ts'}), /defineBuild\(\{ render: \{ backend: 'webgpu' \} \}\)/);
  assert.deepEqual(
    checkSource("import { defineGame } from '@engine';\nimport * as THREE from 'three';\n").filter(
      x => x.rule === 'three-webgpu',
    ),
    [],
  );
});

test('lint:game: the command passes on every template game (they follow the rules)', () => {
  const r = spawnSync(process.execPath, [SCRIPT], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no Math\.random\(\), literal UI text or three\/webgpu/);
});

test('lint:game three-legacy: common outdated three.js APIs in a file that imports @kits/three each name the fix', () => {
  const src = [
    "import * as THREE from '@kits/three';", // 1
    "import { sRGBEncoding, Clock as Ticker, BoxBufferGeometry, BoxGeometry } from '@kits/three';", // 2
    "import { RGBELoader } from '@kits/three/addons/loaders/RGBELoader.js';", // 3
    "import { OrbitControls } from 'three/examples/js/controls/OrbitControls.js';", // 4
    'export function setup(renderer, texture) {', // 5
    '  renderer.outputEncoding = sRGBEncoding;', // 6
    '  renderer.physicallyCorrectLights = true;', // 7
    '  renderer.useLegacyLights = false;', // 8
    '  texture.encoding = THREE.sRGBEncoding;', // 9
    '  const g = new THREE.Geometry();', // 10
    '  renderer.shadowMap.type = THREE.PCFSoftShadowMap;', // 11
    '  return [g, mergeBufferGeometries([]), renderer.gammaOutput];', // 12
    '}', // 13
  ].join('\n');
  const v = checkSource(src);
  assert.deepEqual(
    v.map(x => x.line),
    [2, 2, 2, 3, 4, 6, 7, 8, 9, 9, 10, 11, 12, 12],
  );
  assert.ok(v.every(x => x.rule === 'three-legacy'));
  const text = v.map(x => x.fix).join('\n');
  for (const want of [
    /sRGBEncoding removed in r162: use SRGBColorSpace/,
    /Clock deprecated in r183: use Timer/,
    /BoxBufferGeometry removed: use BoxGeometry/,
    /RGBELoader deprecated in r180: use HDRLoader/,
    /import the module from three\/addons/,
    /renderer\.outputColorSpace = SRGBColorSpace/,
    /texture\.colorSpace = SRGBColorSpace/,
    /THREE\.Geometry removed in r125: use BufferGeometry/,
    /THREE\.PCFSoftShadowMap deprecated in r186: use PCFShadowMap/,
    /use mergeGeometries/,
  ])
    assert.match(text, want);
});

test('lint:game three-legacy: current APIs, files that do not use three, comments and escapes pass', () => {
  assert.deepEqual(
    checkSource(
      [
        "import { BoxGeometry, InstancedBufferGeometry, SRGBColorSpace, Timer } from '@kits/three';",
        '// renderer.outputEncoding = sRGBEncoding was the old way',
        'export const make = (r, t) => { r.outputColorSpace = SRGBColorSpace; t.colorSpace = SRGBColorSpace; return [new BoxGeometry(), new InstancedBufferGeometry(), new Timer()]; };',
      ].join('\n'),
    ),
    [],
  );
  // Without a three import the names are the game's own (a Clock component, a text encoding).
  assert.deepEqual(
    checkSource(
      "import { defineComponent } from '@engine';\nexport const Clock = defineComponent('clock', { t: 0 });\nconst d = { encoding: 'utf8' }; d.encoding = 'ascii';\n",
    ),
    [],
  );
  assert.deepEqual(
    checkSource(
      "import { Clock } from '@kits/three'; // lint-game-allow three-legacy: matches the kit's own pinned API in this test\n",
    ),
    [],
  );
});

test('lint:game three-legacy: every name the rule calls removed is really absent from the pinned three', async () => {
  const {THREE_LEGACY_NAMES} = await import('./game-rules.mjs');
  const three = await import('three');
  for (const [name, fix] of Object.entries(THREE_LEGACY_NAMES))
    if (fix.startsWith('removed')) assert.equal(name in three, false, `${name} still exists in three`);
    else assert.equal(name in three || name === 'RGBELoader', true, `${name} is not in three: call it removed`);
  for (const alias of ['BoxBufferGeometry', 'PlaneBufferGeometry', 'SphereBufferGeometry'])
    assert.equal(alias in three, false);
  assert.equal('InstancedBufferGeometry' in three, true);
});
