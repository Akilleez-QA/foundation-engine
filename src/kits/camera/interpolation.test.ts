import test from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, defineSystem, Interpolated, Name, testScene, Transform} from '../../author';
import {cameraSystem} from './index';

test('scenes expose alpha, and the camera follows an interpolated target where it is drawn', async () => {
  const scene = defineScene({
    id: 'interp',
    title: 'Interpolation',
    entities: [[Name({name: 'player'}), Transform(), Interpolated()]],
    systems: [
      defineSystem({
        id: 'walk',
        run(ctx) {
          ctx.world.get(ctx.named('player')!, Transform)!.x += 1;
        },
      }),
      cameraSystem('follow', {smooth: 0}),
    ],
  });
  const t = await testScene(scene);
  t.run(5 / 60);
  assert.equal(t.ctx.time.alpha, 0, 'testScene runs whole 60 Hz steps');
  const player = t.ctx.named('player')!;
  assert.equal(t.world.get(player, Transform)!.x, 5);
  assert.equal(t.ctx.view.camera.target[0], 4, 'drawn (and followed) one step behind at alpha 0');
  const plain = await testScene(
    defineScene({
      id: 'plain',
      title: 'Plain',
      entities: [[Name({name: 'player'}), Transform()]],
      systems: [
        defineSystem({
          id: 'walk',
          run(ctx) {
            ctx.world.get(ctx.named('player')!, Transform)!.x += 1;
          },
        }),
        cameraSystem('follow', {smooth: 0}),
      ],
    }),
  );
  plain.run(5 / 60);
  assert.equal(plain.ctx.view.camera.target[0], 5, 'entities that do not opt in are unchanged');
});
