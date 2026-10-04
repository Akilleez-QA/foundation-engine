import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestSaves, Mesh, testScene, Transform} from '@engine';
import {hud} from '@kits/ui';
import game from './game';
import courtyard, {Ember, EMBERS} from './courtyard';
import embers from './embers';

const at = (t: Awaited<ReturnType<typeof testScene>>) => t.world.get(t.ctx.named('player')!, Transform)!;

test('S1: holding up moves the player away from the camera and the courtyard walls stop them', async () => {
  const t = await testScene(courtyard, {game});
  t.hold('character-z', -1);
  t.run(0.2);
  assert.ok(at(t).z < 6.2, `moved from z 6.5 to ${at(t).z}`);
  t.release('character-z');
  t.hold('character-x', 1);
  t.run(5);
  assert.ok(at(t).x <= 9.4 && at(t).x > 8.5, `x ${at(t).x}`);
  t.dispose();
});

test('S2: walking into an ember takes it, counts it and remembers it after a reload', async () => {
  const saves = createTestSaves();
  const t = await testScene(courtyard, {game, services: {save: saves.store}});
  t.run(2 / 60);
  assert.equal(hud(t.ctx).read().lines.embers, `Embers 0 of ${EMBERS.length}`);
  const [x, z] = EMBERS[0]!;
  Object.assign(at(t), {x, z});
  t.run(2 / 60);
  assert.deepEqual(t.ctx.save(embers).get().taken, ['ember-1']);
  assert.equal(hud(t.ctx).read().lines.embers, `Embers 1 of ${EMBERS.length}`);
  assert.deepEqual(t.cues, ['ui.success']);
  t.dispose();
  const after = await testScene(courtyard, {game, services: {save: saves.reload()}});
  after.run(2 / 60);
  assert.equal([...after.world.query(Ember)].length, EMBERS.length - 1, 'the taken ember is not back');
  assert.equal(hud(after.ctx).read().lines.embers, `Embers 1 of ${EMBERS.length}`);
  after.dispose();
  saves.dispose();
});

test('taking every ember shows the banner', async () => {
  const t = await testScene(courtyard, {game});
  t.ctx.save(embers).update(d => {
    d.taken = EMBERS.slice(1).map((_, i) => `ember-${i + 2}`);
  });
  const [x, z] = EMBERS[0]!;
  Object.assign(at(t), {x, z});
  t.run(2 / 60);
  assert.equal(hud(t.ctx).read().banner, 'Every ember found!');
  t.dispose();
});

test('the stonework is one mesh within its triangle share, and its baked colours are valid', async () => {
  const t = await testScene(courtyard, {game});
  const stone = t.world.get(t.ctx.named('stonework')!, Mesh)!;
  assert.ok(stone.indices.length / 3 < 20_000, `${stone.indices.length / 3} triangles`);
  assert.ok(stone.colors.every(c => c >= 0 && c <= 1));
  t.dispose();
});
