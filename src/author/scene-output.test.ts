import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OUTPUT_DEFAULTS, outputKey, validateSceneOutput, type SceneOutput} from './scene-output';
import {createOutputSync} from './scene-output-sync';
import {defineScene} from './defs';
import {testScene} from './testing';

test("a scene without output keeps today's picture: no tone mapping, exposure 1", async () => {
  assert.deepEqual(validateSceneOutput(undefined), {toneMapping: 'none', exposure: 1});
  assert.deepEqual(OUTPUT_DEFAULTS, {toneMapping: 'none', exposure: 1});
  assert.ok(Object.isFrozen(OUTPUT_DEFAULTS));
  const plain = defineScene({id: 'plain', title: 'Plain'});
  assert.equal(plain.view?.output, undefined);
  const t = await testScene(plain);
  assert.deepEqual(t.ctx.view.output, {toneMapping: 'none', exposure: 1});
  t.dispose();
});

test('output fills defaults and keeps the authored fields', async () => {
  assert.deepEqual(validateSceneOutput({toneMapping: 'aces'}), {toneMapping: 'aces', exposure: 1});
  assert.deepEqual(validateSceneOutput({exposure: 0.5}), {toneMapping: 'none', exposure: 0.5});
  for (const toneMapping of ['none', 'aces', 'agx', 'neutral'] as const)
    assert.equal(validateSceneOutput({toneMapping, exposure: 16}).toneMapping, toneMapping);
  const scene = defineScene({id: 'lit', title: 'Lit', view: {output: {toneMapping: 'agx', exposure: 0.9}}});
  assert.deepEqual(scene.view?.output, {toneMapping: 'agx', exposure: 0.9});
  const t = await testScene(scene);
  assert.deepEqual(t.ctx.view.output, {toneMapping: 'agx', exposure: 0.9});
  t.dispose();
});

test('invalid output is refused, naming the field', () => {
  const bad: [unknown, RegExp][] = [
    [null, /view\.output must be an object/],
    [[1], /view\.output must be an object/],
    [{toneMapping: 'filmic'}, /view\.output\.toneMapping must be one of none, aces, agx, neutral/],
    [{toneMapping: 3}, /toneMapping/],
    [{exposure: 0}, /view\.output\.exposure must be a number in \(0, 16\]/],
    [{exposure: -1}, /exposure/],
    [{exposure: 16.01}, /exposure/],
    [{exposure: NaN}, /exposure/],
    [{exposure: Infinity}, /exposure/],
    [{exposure: '1'}, /exposure/],
    [{bloom: 1}, /view\.output\.bloom is unknown/],
  ];
  for (const [input, message] of bad) assert.throws(() => validateSceneOutput(input), message, JSON.stringify(input));
  assert.throws(
    () => defineScene({id: 'bad', title: 'Bad', view: {output: {toneMapping: 'filmic' as 'aces'}}}),
    /scene bad: view\.output\.toneMapping/,
  );
});

test('a changed output applies once and marks one frame; an unchanged one is free', () => {
  const applied: SceneOutput[] = [],
    reports: unknown[] = [];
  const initial = {toneMapping: 'none', exposure: 1} as const;
  const sync = createOutputSync(
    initial,
    o => applied.push({...o}),
    e => reports.push(e),
  );
  assert.equal(sync.sync(initial), false, 'the initial value is already on the renderer');
  const aces = {toneMapping: 'aces', exposure: 0.9} as const;
  assert.equal(sync.sync(aces), true);
  assert.equal(sync.sync(aces), false, 'the same value again draws nothing');
  assert.equal(sync.sync({...aces}), false, 'an equal copy draws nothing');
  assert.equal(sync.sync({toneMapping: 'aces', exposure: 1.2}), true);
  assert.deepEqual(applied, [
    {toneMapping: 'aces', exposure: 0.9},
    {toneMapping: 'aces', exposure: 1.2},
  ]);
  assert.deepEqual(reports, []);
});

test('an invalid run-time output is reported once and the last valid output stays', () => {
  const applied: string[] = [],
    reports: unknown[] = [];
  const sync = createOutputSync(
    OUTPUT_DEFAULTS,
    o => applied.push(outputKey(o)),
    e => reports.push(e),
  );
  assert.equal(sync.sync({toneMapping: 'aces', exposure: 99}), false);
  assert.equal(sync.sync({toneMapping: 'aces', exposure: 99}), false);
  assert.equal(reports.length, 1, 'one report per distinct refusal');
  assert.match(String(reports[0]), /ctx\.view\.output\.exposure/);
  assert.equal(sync.sync({toneMapping: 'aces', exposure: 2}), true, 'a valid value recovers');
  assert.equal(sync.sync({toneMapping: 'nope'}), false);
  assert.equal(reports.length, 2);
  assert.deepEqual(applied, ['aces:2']);
});
