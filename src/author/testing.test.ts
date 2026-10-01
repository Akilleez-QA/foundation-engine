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
