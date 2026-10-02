import test from 'node:test';
import assert from 'node:assert/strict';
import { defineGame, defineInput, defineScene } from './defs';
import { actionOf } from './ids';
import { testScene } from './testing';
import { sceneInput } from './scene-input';
import { InputActions, inputActionRegistry, type ActionLayerInfo } from '../platform/input/actions';

const scene = defineScene({ id: 'hints', title: 'Hints' });
const inspect = defineInput({ id: 'inspect', label: 'Inspect', keys: ['code:KeyI'], pad: ['x'], tap: true });
const move = defineInput({ id: 'move', label: 'Move', axis: {
  negative: { keys: ['a'], pad: ['ls-left'] }, positive: { keys: ['d'], pad: ['ls-right'] },
} });

test('headless hints describe only declared local press actions, with immutable untranslated metadata', async () => {
  const t = await testScene(scene, { inputs: [inspect, move] });
  const hint = t.ctx.input.describe('inspect')!;
  assert.deepEqual(hint, { labelKey: 'game.input.inspect', keys: ['code:KeyI'], pad: ['x'], inContext: true });
  assert.equal(t.ctx.text(hint.labelKey), 'Inspect');
  assert.ok(Object.isFrozen(hint));
  assert.ok(Object.isFrozen(hint.keys));
  assert.ok(Object.isFrozen(hint.pad));
  assert.throws(() => (hint.keys as string[]).push('x'), TypeError);
  assert.equal('touch' in hint, false, 'tap does not establish a visible touch control');
  for (const id of ['missing', 'move', 'move.negative', actionOf('inspect'), actionOf('move', 'negative')]) {
    assert.equal(t.ctx.input.describe(id), null, id);
  }
});

test('headless hints snapshot authored defaults and leave translation to the catalogue', async () => {
  const keys = ['i'];
  const local = defineInput({ id: 'inspect', label: 'Inspect', keys, pad: ['x'] });
  const game = defineGame({ id: 'hint-test', title: 'Hints', version: '1.0.0', firstScene: scene.id,
    strings: { en: { 'game.input.inspect': 'Examine' } } });
  const t = await testScene(scene, { inputs: [local], game });
  keys.push('j');
  assert.deepEqual(t.ctx.input.describe('inspect')!.keys, ['i']);
  assert.equal(t.ctx.text(t.ctx.input.describe('inspect')!.labelKey), 'Examine');
});

test('injected real dispatcher supplies current remaps and modal context without changing old snapshots', async () => {
  let layers: ActionLayerInfo[] = [];
  const input = new InputActions({ now: () => 0, registry: inputActionRegistry([
    { id: actionOf('inspect'), label: 'game.input.inspect', scope: 'global', kind: 'press', defaults: { keys: inspect.keys, pad: inspect.pad } },
    { id: actionOf('unowned'), label: 'unowned', scope: 'always', kind: 'press', defaults: { keys: ['u'] } },
  ]), layers: { fromTop: () => layers, escape: () => false, cycleFocus: () => false, onChange: () => () => {} } });
  const t = await testScene(scene, { inputs: [inspect], services: { input } });
  const first = t.ctx.input.describe('inspect')!;
  input.setOverrides({ [actionOf('inspect')]: { keys: ['Shift+e'], pad: ['y'] } });
  assert.deepEqual(t.ctx.input.describe('inspect'), { labelKey: first.labelKey, keys: ['Shift+e'], pad: ['y'], inContext: true });
  assert.deepEqual(first.keys, ['code:KeyI']);
  layers = [{ id: 'reading', kind: 'sheet', modal: 'page' }];
  assert.equal(t.ctx.input.describe('inspect')!.inContext, false);
  assert.equal(t.ctx.input.describe('unowned'), null);
  layers = [];
  assert.equal(t.ctx.input.describe('inspect')!.inContext, true);
});

test('legacy scripted input works without metadata and covered scene input retains descriptions', async () => {
  const t = await testScene(scene);
  t.press('inspect');
  assert.equal(t.ctx.input.pressed('inspect'), true);
  assert.equal(t.ctx.input.describe('inspect'), null);
  const hint = Object.freeze({ labelKey: 'game.input.inspect', keys: Object.freeze(['i']), pad: Object.freeze([]), inContext: false });
  const input = sceneInput(() => false, () => true, new Map([['inspect', 1]]), { x: 0, y: 0, down: false, pressed: false }, id => id === 'inspect' ? hint : null);
  assert.equal(input.pressed('inspect'), false);
  assert.equal(input.describe('inspect'), hint);
});
