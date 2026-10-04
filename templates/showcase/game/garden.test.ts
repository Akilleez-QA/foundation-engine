import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testScene, Transform} from '@engine';
import {hud} from '@kits/ui';
import game from './game';
import courtyard from './courtyard';
import garden from './garden';
import {SUNDIAL} from './garden-scenery';
import {goldenHour, LOOKS, overcast} from './look';

const at = (t: Awaited<ReturnType<typeof testScene>>) => t.world.get(t.ctx.named('player')!, Transform)!;

test('S3: the gate leads to the garden, and using the sundial moves the garden to the next light preset', async () => {
  const c = await testScene(courtyard, {game});
  Object.assign(at(c), {x: 0, z: -9});
  c.run(2 / 60);
  assert.equal(c.ctx.state.near, 'gate');
  c.press('explore-interact');
  c.run(2 / 60);
  assert.deepEqual(c.went, ['garden']);
  c.dispose();

  const t = await testScene(garden, {game});
  assert.equal(garden.view?.environment, goldenHour, 'the garden opens at golden hour');
  Object.assign(at(t), {x: SUNDIAL[0] + 0.8, z: SUNDIAL[1] + 0.4});
  t.run(2 / 60);
  assert.equal(t.ctx.state.near, 'sundial');
  t.press('explore-interact');
  t.run(2 / 60);
  assert.equal(t.ctx.view.environment, overcast);
  assert.equal(hud(t.ctx).read().lines.look, 'Light: overcast');
  for (let i = 1; i < LOOKS.length; i++) {
    t.press('explore-interact');
    t.run(2 / 60);
  }
  assert.equal(t.ctx.view.environment, goldenHour, 'the presets go round');
  t.dispose();
});
