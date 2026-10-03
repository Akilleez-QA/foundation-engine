// The play:script format is checked before any browser starts (scripts/play/script-schema.mjs).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readdirSync, readFileSync, existsSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scriptProblems, assertScript, STEPS} from './script-schema.mjs';
import {runScript} from './script.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ok = steps => ({name: 'check', scene: 'play', seed: 1, steps});

test('every committed playtest script is well formed', () => {
  const dirs = ['game', ...readdirSync(join(ROOT, 'templates')).map(t => join('templates', t, 'game'))].map(d => join(ROOT, d, 'playtest')).filter(existsSync);
  const files = dirs.flatMap(d => readdirSync(d).filter(f => f.endsWith('.json')).map(f => join(d, f)));
  assert.ok(files.length >= 5, `found ${files.length} scripts`);
  for (const f of files) assert.deepEqual(scriptProblems(JSON.parse(readFileSync(f, 'utf8'))), [], f);
});

test('every step the recipe documents is accepted', () => {
  assert.deepEqual(scriptProblems(ok([
    {goto: 'play', params: {n: '2'}}, {key: 'ArrowUp', ms: 800}, {press: ' '}, {teleport: [3, -1.2], name: 'player'},
    {wait: 0}, {wait: 500}, {snap: 'after-turn'}, {expect: {path: 'world.state.score', atLeast: 1}},
    {expect: {path: 'world.state.tags', contains: 'x'}}, {expect: {path: 'world.state.phase', equals: 'over'}}, {expect: {path: 'world.state.best', exists: true}},
    {waitUntil: {path: 'world.state.phase', equals: 'over'}, ms: 20000, every: 100},
    {pressUntil: 'Enter', until: {path: 'scene.scene', equals: 'scene.b'}, every: 500, ms: 60000},
    {holdUntil: ']', until: {path: 'world.state.caption', exists: true}, ms: 15000},
    {reload: true}, {reload: true, ms: 30000},
  ])), []);
  assert.deepEqual(Object.keys(STEPS).sort(), ['expect', 'goto', 'holdUntil', 'key', 'press', 'pressUntil', 'reload', 'snap', 'teleport', 'wait', 'waitUntil']);
});

test('a bad script is reported step by step, naming what is wrong and what is allowed', () => {
  const problems = scriptProblems(ok([
    {expect: {path: 'world.state.y', atMost: 0.71}},          // the trial's matcher
    {jump: true},
    {press: ' ', wait: 100},
    {key: 'ArrowUp', ms: -5},
    {teleport: [1]},
    {pressUntil: 'Enter'},
    {waitUntil: {path: 'a', equals: 1, atLeast: 2}},
    {reload: 'now'},
    {snap: '../escape'},
    {wait: 100, msec: 5},
    {expect: {equals: 1}},
  ]));
  assert.deepEqual(problems, [
    'step 1 (expect) has an unknown matcher "atMost" (use one of equals, contains, atLeast, exists)',
    'step 2 {"jump":true} has no action: use one of goto, key, press, teleport, wait, snap, expect, waitUntil, pressUntil, holdUntil, reload',
    'step 3 has 2 actions (press, wait); use one per step',
    'step 4 (key).ms: -5 must be milliseconds (0 or more)',
    'step 5 (teleport): [1] must be an [x, z] pair of numbers',
    'step 6 (pressUntil) needs "until", the matcher that ends it',
    'step 7 (waitUntil) has 2 matchers (equals, atLeast); use one per step',
    'step 8 (reload): "now" must be true',
    'step 9 (snap): "../escape" must be a file-name-safe label (letters, digits, . _ -)',
    'step 10 (wait) has an unknown field "msec"',
    'step 11 (expect) needs "path", a dotted path into engine.state() such as "world.state.score"',
  ]);
  assert.deepEqual(scriptProblems({name: 'a b', steps: [], extra: 1}), [
    'unknown top-level field "extra" (name, scene, seed, steps, description)',
    '"name" must be a file-name-safe string (letters, digits, . _ -): evidence goes to playtest/latest/<name>/',
    '"steps" must be a non-empty list',
  ]);
  assert.throws(() => assertScript({name: 'x', steps: [{jump: 1}]}, 'game/playtest/x.json'), /^Error: game\/playtest\/x\.json: 1 problem\(s\):\n  step 1 .*\n  \(format: docs\/recipes\/write-a-playtest-script\.md\)$/);
});

test('runScript refuses a bad script before launching a browser', async () => {
  await assert.rejects(runScript(ok([{expect: {path: 'a', atMost: 1}}]), 'http://127.0.0.1:9'), /unknown matcher "atMost"/);
});

test('npm run play:script exits 64 with the problems, before serving or launching anything', () => {
  const dir = mkdtempSync(join(tmpdir(), 'play-script-'));
  const bad = join(dir, 'bad.json'), broken = join(dir, 'broken.json');
  writeFileSync(bad, JSON.stringify(ok([{wait: 10}, {expect: {path: 'world.state.y', atMost: 0.71}}])));
  writeFileSync(broken, '{"name": "x", ');
  const run = file => spawnSync(process.execPath, ['scripts/play/script.mjs', file], {cwd: ROOT, encoding: 'utf8', timeout: 20000, env: {...process.env, ENGINE_CHROMIUM: '/nonexistent/browser'}});
  const r = run(bad);
  assert.equal(r.status, 64, r.stderr);
  assert.match(r.stderr, /bad\.json: 1 problem\(s\):\n  step 2 \(expect\) has an unknown matcher "atMost"/);
  assert.doesNotMatch(r.stderr, /    at /, 'no stack trace');
  const j = run(broken);
  assert.equal(j.status, 64);
  assert.match(j.stderr, /broken\.json: not valid JSON/);
  assert.match(run(join(dir, 'missing.json')).stderr, /missing\.json: no such file/);
});

test('the recipe shows the committed arcade reload script, and documents every step', () => {
  const recipe = readFileSync(join(ROOT, 'docs/recipes/write-a-playtest-script.md'), 'utf8');
  const shown = recipe.match(/```json\n([\s\S]*?)```/)?.[1];
  assert.equal(shown, readFileSync(join(ROOT, 'templates/arcade/game/playtest/best-reload.json'), 'utf8'));
  for (const kind of Object.keys(STEPS)) assert.match(recipe, new RegExp(`\\| \`\\{"${kind}":`), `the step table documents ${kind}`);
});
