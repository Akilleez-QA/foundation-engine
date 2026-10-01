import test from 'node:test';
import assert from 'node:assert/strict';
import { createControl } from './index';
import { InputActions, inputActionRegistry, type KeyEventLike } from '../../platform/input/actions';
import { defineScene, testScene, Name, Transform } from '../../author';
import { Character, characterSystem, resetCharacterMotion } from '../character';
const initial = { owner: 'walk', target: 'player', frame: { id: 'world', generation: 1 } };
const seated = { owner: 'seat', target: 'player', frame: { id: 'vehicle', generation: 2 } };
function input() {
  const keys = new InputActions({ registry: inputActionRegistry([{ id: 'test.move', scope: 'global', kind: 'hold', label: 'test.move', defaults: { keys: ['code:KeyW'], pad: ['ls-up'] } }]), layers: { fromTop: () => [], escape: () => false, cycleFocus: () => false, onChange: () => () => {} }, now: () => 0 });
  keys.onAction('test.move', () => true);
  const key: KeyEventLike = { code: 'KeyW', key: 'w', target: null, preventDefault() {}, stopPropagation() {} };
  return { keys, key };
}
test('successful transition uses actual input epoch and held sources require release before pressing again', () => {
  const { keys, key } = input(); let resets = 0; const control = createControl(initial, { input: keys, resetMotion() { resets++; } });
  keys.keyDown(key); assert.equal(keys.held('test.move'), true); const epoch = keys.epoch;
  assert.equal(control.transition(seated, () => true), true); assert.equal(keys.held('test.move'), false); assert.equal(keys.epoch, epoch + 1);
  keys.keyDown({ ...key, repeat: true }); assert.equal(keys.held('test.move'), false); keys.keyUp(key); keys.keyDown(key); assert.equal(keys.held('test.move'), true);
  assert.equal(control.owns('seat'), true); assert.equal(resets, 1); assert.equal(control.state.frame.generation, 2);
});
test('failed validation or throwing commit does not relinquish owner or cancel input', () => {
  const { keys } = input(); const control = createControl(initial, { input: keys, resetMotion() { throw Error('must not reset'); } });
  const state = control.state, epoch = keys.epoch;
  assert.equal(control.transition(seated, () => false), false);
  assert.throws(() => control.transition(seated, () => { throw Error('rejected'); }));
  assert.equal(control.state, state); assert.equal(keys.epoch, epoch); assert.equal(control.owns('walk'), true);
});
test('reentry cannot steal ownership during a transition and disposal is terminal', () => {
  const { keys } = input(); const control = createControl(initial, { input: keys, resetMotion() {} });
  assert.equal(control.transition(seated, () => { assert.equal(control.transition(initial, () => true), false); return true; }), true);
  control.dispose(); control.dispose(); assert.equal(control.owns('seat'), false); assert.equal(control.transition(initial, () => true), false);
});
test('motion reset prevents old integrator velocity from leaking across authority changes', async () => {
  const s = await testScene(defineScene({ id: 'control-reset', title: 'control.reset', entities: [[Name({ name: 'player' }), Transform(), Character()]], systems: [characterSystem({ relative: 'world', pointer: false })] }));
  s.hold('character-x', 1); s.run(.3); s.release('character-x'); const e = s.ctx.named('player')!, tr = s.world.get(e, Transform)!;
  const x = tr.x; resetCharacterMotion(s.world, e); s.run(1 / 60); assert.equal(tr.x, x);
});

test('terminal disposal during commit cannot publish a new owner',()=>{
 const {keys}=input();const control=createControl(initial,{input:keys,resetMotion(){}}),before=control.state;
 assert.equal(control.transition(seated,()=>{control.dispose();return true;}),false);
 assert.equal(control.state,before);assert.equal(control.owns('walk'),false);
});
test('control identities are bounded strings and motion resets even if cancellation throws',()=>{
 assert.throws(()=>createControl({...initial,owner:42 as unknown as string},{input:{cancel(){}},resetMotion(){}}));
 let resets=0;const control=createControl(initial,{input:{cancel(){throw Error('cancel failed');}},resetMotion(){resets++;}});
 assert.throws(()=>control.transition(seated,()=>true));assert.equal(control.state.owner,'seat');assert.equal(resets,1);
 assert.throws(()=>control.dispose());assert.equal(resets,2);control.dispose();assert.equal(resets,2);
});
