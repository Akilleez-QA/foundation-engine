import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, defineSystem} from './defs';
import {testScene} from './testing';
test('scene preparation completes before activation and systems observe prepared state', async () => {
  const order: string[] = [];
  const scene = defineScene({
    id: 'prepared',
    title: 'Prepared',
    async prepare(ctx, signal) {
      assert.equal(signal.aborted, false);
      order.push('prepare');
      await Promise.resolve();
      ctx.state.ready = true;
    },
    enter(ctx) {
      assert.equal(ctx.state.ready, true);
      order.push('enter');
    },
    systems: [
      defineSystem({
        id: 'prepared-step',
        run(ctx) {
          assert.equal(ctx.state.ready, true);
          order.push('step');
        },
      }),
    ],
  });
  const t = await testScene(scene);
  assert.deepEqual(order, ['prepare', 'enter']);
  t.run(1 / 60);
  assert.deepEqual(order, ['prepare', 'enter', 'step']);
});
test('failed preparation cannot activate scene', async () => {
  let entered = false;
  await assert.rejects(
    testScene(
      defineScene({
        id: 'failed-preparation',
        title: 'Fail',
        async prepare() {
          throw Error('required resource');
        },
        enter() {
          entered = true;
        },
      }),
    ),
    /required resource/,
  );
  assert.equal(entered, false);
});
