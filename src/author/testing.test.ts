import test from 'node:test';
import assert from 'node:assert/strict';
import { defineScene, defineSystem } from './defs';
import { testScene } from './testing';

test('headless failures surface after siblings finish and frame input and events retire', async () => {
  const original = Error('publication failed');
  const frames: number[] = [];
  const presses: boolean[] = [];
  let fail = true;
  const scene = await testScene(defineScene({
    id: 'failure-test', title: 'Failure test', systems: [
      defineSystem({ id: 'producer', run(ctx) { ctx.world.emit('sample'); if (fail) throw original; } }),
      defineSystem({ id: 'consumer', run(ctx) {
        frames.push(ctx.time.frame);
        presses.push(ctx.input.pressed('confirm'));
        assert.equal(ctx.world.read('sample').length, 1);
      } }),
      defineSystem({ id: 'presentation', phase: 'frame', run(ctx) { ctx.world.emit('presented'); } }),
    ],
  }));
  scene.press('confirm');
  assert.throws(() => scene.run(1), error => {
    assert.equal((error as Error).cause, original);
    assert.equal((error as Error & { systemId: string }).systemId, 'producer');
    assert.match((error as Error).message, /publication failed/);
    return true;
  });
  assert.deepEqual(frames, [1], 'the failing frame completes, then the run stops');
  assert.deepEqual(scene.world.read('sample'), []);
  assert.deepEqual(scene.world.read('presented'), []);
  fail = false;
  scene.run(1 / 60);
  assert.deepEqual(frames, [1, 2], 'the completed fixed step is not replayed after recovery');
  assert.deepEqual(presses, [true, false]);
});

test('headless failures retain every system identity and original cause', async () => {
  const first = Error('first');
  const second = { toString() { throw Error('formatting failed'); } };
  const scene = await testScene(defineScene({
    id: 'multiple-failures', title: 'Multiple failures', systems: [
      defineSystem({ id: 'fixed-failure', run() { throw first; } }),
      defineSystem({ id: 'frame-failure', phase: 'frame', run() { throw second; } }),
    ],
  }));
  assert.throws(() => scene.run(1 / 60), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors.map(item => item.systemId), ['fixed-failure', 'frame-failure']);
    assert.equal(error.errors[0].cause, first);
    assert.equal(error.errors[1].cause, second);
    return true;
  });
});

test('a caller-owned input replaces the scripted input, and scripting it is refused', async () => {
  const seen: number[] = [];
  let axis = 0;
  const input = { describe: () => null, pressed: () => false, held: () => false, axis: () => axis, pointer: { x: 0, y: 0, down: false, pressed: false } };
  const scene = await testScene(defineScene({ id: 'input-owner', title: 'Input owner', systems: [defineSystem({ id: 'read', run(ctx) { seen.push(ctx.input.axis('steer')); } })] }), { input });
  try {
    // A source without pressedAt is completed (no timestamps) and otherwise read through; a full InputState is used as is.
    assert.equal(scene.ctx.input.pressedAt('steer'), null);
    assert.equal(scene.ctx.input.pointer, input.pointer);
    axis = -1; scene.run(1 / 60);
    axis = 1; scene.run(1 / 60);
    assert.deepEqual(seen, [-1, 1]);
    assert.throws(() => scene.press('steer'), /caller-owned/);
    assert.throws(() => scene.hold('steer'), /caller-owned/);
    assert.throws(() => scene.release('steer'), /caller-owned/);
  } finally { scene.dispose(); }
  const full = { ...input, pressedAt: (_action: string): number | null => 7 };
  const owned = await testScene(defineScene({ id: 'input-owner-full', title: 'Input owner', systems: [] }), { input: full });
  try { assert.equal(owned.ctx.input, full); assert.equal(owned.ctx.input.pressedAt('steer'), 7); } finally { owned.dispose(); }
});
