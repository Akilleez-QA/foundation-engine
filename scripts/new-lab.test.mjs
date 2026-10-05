// new-lab and lab: a lab is an isolated game in labs/<id> with its kits registered (dependencies included), a lab
// card stating its question, and a runner that points every command at its game folder.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ROOT} from './lib/game-dir.mjs';
import {kitOrder, startLab, withKits} from './new-lab.mjs';
import {labCommand, labsIn} from './lab.mjs';

/** A scratch repository with two templates and a few kits whose index.ts files declare their dependencies. */
function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'engine-new-lab-'));
  for (const t of ['blank', 'arcade'])
    cpSync(join(ROOT, 'templates', t), join(root, 'templates', t), {recursive: true});
  const kit = (name, src) => {
    mkdirSync(join(root, 'src', 'kits', name), {recursive: true});
    writeFileSync(join(root, 'src', 'kits', name, 'index.ts'), src);
  };
  kit('ui', "export function ui() { return defineKit({id: 'ui', requires: []}); }\n");
  kit('camera', "export function camera() { return defineKit({id: 'camera', requires: []}); }\n");
  kit('learn', "export function learn() { return defineKit({id: 'learn', requires: ['ui', 'camera']}); }\n");
  kit('spatial-audio', "export function spatialAudio() { return defineKit({id: 'spatial-audio', requires: []}); }\n");
  kit('replay', 'export function startReplay() {}\n');
  kit(
    'needs-replay',
    "export function needsReplay() { return defineKit({id: 'needs-replay', requires: ['replay']}); }\n",
  );
  return root;
}

const quiet = () => {};

test('new-lab: a lab is an isolated game in labs/<id> with a lab card, a tsconfig and a lab- game id', () => {
  const root = scratch();
  try {
    startLab({root, id: 'crowd-motion', question: 'Can sixty people pose inside the frame budget?', log: quiet});
    const lab = join(root, 'labs', 'crowd-motion');
    assert.match(readFileSync(join(lab, 'game', 'game.ts'), 'utf8'), /id: 'lab-crowd-motion'/);
    assert.match(readFileSync(join(lab, 'GAME.md'), 'utf8'), /^# Crowd motion \(lab\)$/m);
    const card = readFileSync(join(lab, 'README.md'), 'utf8');
    assert.match(card, /^Status: exploring$/m);
    assert.match(card, /\*\*Question:\*\* Can sixty people pose inside the frame budget\?/);
    assert.match(card, /npm run lab -- crowd-motion/);
    assert.deepEqual(JSON.parse(readFileSync(join(lab, 'tsconfig.json'), 'utf8')).include, ['game/**/*.ts']);
    // Nothing is written outside labs/<id>: no ./game, no root GAME.md.
    assert.equal(existsSync(join(root, 'game')), false);
    assert.equal(existsSync(join(root, 'GAME.md')), false);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test("new-lab: --kit registers the kit and the kits it requires, once each, after the template's own", () => {
  const root = scratch();
  try {
    startLab({root, id: 'lessons', template: 'arcade', kits: ['learn', 'spatial-audio'], log: quiet});
    const code = readFileSync(join(root, 'labs', 'lessons', 'game', 'game.ts'), 'utf8');
    assert.match(code, /kits: \[ui\(\), camera\(\), learn\(\), spatialAudio\(\)\]/);
    assert.match(code, /import \{spatialAudio\} from '@kits\/spatial-audio';/);
    assert.equal(code.match(/ui\(\)/g).length, 1);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('new-lab: kit order puts dependencies first; unknown kits and factory-less dependencies are refused', () => {
  const root = scratch();
  try {
    assert.deepEqual(
      kitOrder(root, ['learn']).map(k => k.name),
      ['ui', 'camera', 'learn'],
    );
    // A library kit (no factory) may be asked for directly: the lab imports its functions, nothing is registered.
    assert.deepEqual(
      kitOrder(root, ['replay']).map(k => [k.name, k.factory]),
      [['replay', null]],
    );
    assert.throws(() => kitOrder(root, ['nope']), /No kit 'nope'/);
    assert.throws(() => kitOrder(root, ['needs-replay']), /requires 'replay', which has no replay\(\) factory/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('new-lab: withKits appends inside an existing array (nested arrays included) and adds one when absent', () => {
  const k = (name, factory = name) => ({name, factory, requires: []});
  assert.equal(
    withKits("import {defineGame} from '@engine';\nexport default defineGame({id: 'a'});\n", [k('ui')]),
    "import {defineGame} from '@engine';\nimport {ui} from '@kits/ui';\nexport default defineGame({id: 'a', kits: [ui()]});\n",
  );
  assert.match(
    withKits("import {x} from '@kits/x';\ndefineGame({kits: [x({list: [1, 2]})], id: 'a'});", [k('ui')]),
    /kits: \[x\(\{list: \[1, 2\]\}\), ui\(\)\], id: 'a'/,
  );
  assert.match(withKits('defineGame({kits: [], id: 1});', [k('ui')]), /kits: \[ui\(\)\]/);
  const once = withKits('defineGame({kits: [ui()]});', [k('ui')]);
  assert.equal(once, 'defineGame({kits: [ui()]});');
});

test('new-lab: refuses a bad id, an unknown template and an existing lab without --force', () => {
  const root = scratch();
  try {
    assert.throws(() => startLab({root, id: 'Crowd Motion', log: quiet}), /kebab-case/);
    assert.throws(() => startLab({root, id: 'x', template: 'nope', log: quiet}), /No template 'nope'/);
    startLab({root, id: 'x', log: quiet});
    writeFileSync(join(root, 'labs', 'x', 'game', 'note.ts'), '// old\n');
    assert.throws(() => startLab({root, id: 'x', log: quiet}), /already exists/);
    startLab({root, id: 'x', force: true, log: quiet});
    assert.equal(existsSync(join(root, 'labs', 'x', 'game', 'note.ts')), false);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('lab: lists labs with their status and question, and points each command at the lab game folder', () => {
  const root = scratch();
  try {
    startLab({root, id: 'dash', template: 'arcade', question: 'Does a dash feel good?', log: quiet});
    startLab({root, id: 'blank-one', log: quiet});
    assert.deepEqual(labsIn(root), [
      {id: 'blank-one', status: 'exploring', question: '(no question yet)'},
      {id: 'dash', status: 'exploring', question: 'Does a dash feel good?'},
    ]);
    assert.deepEqual(labCommand(['dash'], root), {args: ['run', 'play'], gameDir: 'labs/dash/game'});
    assert.deepEqual(labCommand(['dash', 'snap', '--mobile'], root), {
      args: ['run', 'play:snap', '--', '--mobile'],
      gameDir: 'labs/dash/game',
    });
    assert.throws(() => labCommand(['nope'], root), /No lab 'nope'\. Labs: blank-one, dash/);
    assert.throws(() => labCommand(['dash', 'deploy:production'], root), /Unknown lab command/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
