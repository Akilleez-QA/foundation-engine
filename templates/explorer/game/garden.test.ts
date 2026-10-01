import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testScene, Transform } from '@engine';
import { hud } from '@kits/ui';
import { progress } from '@kits/explore';
import game from './game';
import garden from './garden';

const at = (t: Awaited<ReturnType<typeof testScene>>) => t.world.get(t.ctx.named('player')!, Transform)!;

test('S1: holding up moves the player away from the camera and the garden walls stop them', async () => {
  const t = await testScene(garden, { game });
  t.hold('character-z', -1); t.run(0.5);
  assert.ok(at(t).z < 1, `moved from z 2 to ${at(t).z}`);
  t.release('character-z'); t.hold('character-x', 1); t.run(4);
  assert.ok(at(t).x <= 6.5 - 0.35 + 1e-9 && at(t).x > 5.5, `x ${at(t).x}`);
});

test('S2: standing by the bench shows its prompt and using it counts one of three things', async () => {
  const t = await testScene(garden, { game });
  const me = at(t); me.x = -3; me.z = -1;
  t.run(2 / 60);
  assert.equal(t.ctx.state.near, 'bench');
  assert.equal(hud(t.ctx).read().prompt, 'Sit on the bench (E, A or tap)');
  assert.equal(hud(t.ctx).read().lines.found, 'Found 0 of 3');
  t.press('explore-interact'); t.run(2 / 60);
  assert.equal(hud(t.ctx).read().lines.found, 'Found 1 of 3');
});

test('S4: using all three things shows the found-everything banner', async () => {
  const t = await testScene(garden, { game });
  t.ctx.save(progress).update(d => { d.used = ['garden/bench', 'shed/crate']; });
  const me = at(t); me.x = -4; me.z = 2;
  t.run(2 / 60);
  assert.equal(t.ctx.state.near, 'lamp');
  t.press('explore-interact'); t.run(2 / 60);
  assert.equal(hud(t.ctx).read().banner, 'You found everything!');
});
