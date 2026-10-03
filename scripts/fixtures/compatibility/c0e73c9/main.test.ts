import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testScene, Transform } from '@engine';
import main from './main';

test('S1: pressing turn rotates the cube a quarter turn within half a second', async () => {
  const t = await testScene(main);
  const cube = t.ctx.named('cube')!;
  t.press('turn');
  t.run(0.5);
  assert.ok(Math.abs(t.world.get(cube, Transform)!.ry - Math.PI / 2) < 0.01);
  assert.equal(t.ctx.state.turns, 1);
  assert.deepEqual(t.cues, ['ui.click']);
});

test('a still cube does not touch the world', async () => {
  const t = await testScene(main);
  t.run(0.1);
  const v = t.world.version;
  t.run(1);
  assert.equal(t.world.version, v);
});
