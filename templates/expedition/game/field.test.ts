import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testScene, Transform} from '@engine';
import {createDialogue} from '@kits/dialogue';
import {createInventoryLedger} from '@kits/inventory';
import game from './game';
import field, {setDoorOpen} from './field';
import {briefing, expeditionSave, inventoryOptions, visitStation, initialSave} from './session';
async function ready(t: Awaited<ReturnType<typeof testScene>>) {
  for (let i = 0; i < 8; i++) {
    t.run(1 / 60);
    for (let j = 0; j < 5; j++) await Promise.resolve();
  }
}
const status = (t: Awaited<ReturnType<typeof testScene>>) =>
  t.ctx.state.expedition as {status: string; collected: number; badges: number};
test('S1: route planning never counts as physical arrival', async () => {
  const t = await testScene(field, {game});
  await ready(t);
  t.press('expedition-next');
  t.run(0.2);
  assert.equal(status(t).status, 'walking');
  assert.equal(status(t).collected, 0);
  t.run(6);
  assert.equal(status(t).collected, 1);
  field.exit?.(t.ctx);
});
test('S2: stopping cancels movement and permits a fresh route without losing collected stations', async () => {
  const t = await testScene(field, {game});
  await ready(t);
  t.press('expedition-next');
  t.run(0.8);
  t.press('expedition-cancel');
  t.run(1 / 60);
  const tr = t.world.get(t.ctx.named('player')!, Transform)!,
    x = tr.x,
    z = tr.z;
  t.run(2);
  assert.equal(tr.x, x);
  assert.equal(tr.z, z);
  assert.equal(status(t).collected, 0);
  t.press('expedition-next');
  t.run(6);
  assert.equal(status(t).collected, 1);
  field.exit?.(t.ctx);
});
test('S3: three arrivals award one badge and replay or reload cannot duplicate it', async () => {
  const t = await testScene(field, {game});
  await ready(t);
  for (let i = 0; i < 3; i++) {
    t.press('expedition-next');
    t.run(7);
  }
  assert.equal(status(t).collected, 3);
  assert.equal(status(t).badges, 1);
  const saved = t.ctx.save(expeditionSave).get();
  const retried = visitStation(saved, 2);
  assert.equal(createInventoryLedger(inventoryOptions, retried.inventory).quantity('collection', 'survey-badge-v1'), 1);
  field.exit?.(t.ctx);
  field.enter?.(t.ctx);
  t.press('expedition-next');
  t.run(2);
  assert.equal(status(t).badges, 1);
  assert.equal(status(t).collected, 3);
  field.exit?.(t.ctx);
});
test('S4: dialogue accepts only current session revision and saved state restores', () => {
  const d = createDialogue(briefing, 'expedition-briefing');
  const v = d.view(new Set())!;
  assert.equal(
    d.choose({session: 'old', revision: v.revision, node: v.node, option: 'begin'}, new Set()).status,
    'stale',
  );
  assert.equal(
    d.choose({session: v.session, revision: v.revision, node: v.node, option: 'begin'}, new Set()).status,
    'applied',
  );
  const saved = initialSave();
  saved.dialogue = d.snapshot();
  const restored = expeditionSave.section.parse(saved);
  assert.equal(createDialogue(briefing, 'expedition-briefing', restored.dialogue).view(new Set()), null);
});

test('S6: optional assistance and functional gear change pace without cosmetic mastery grants', async () => {
  const {prepareSurvey, walkingPace, restoreEquipment} = await import('./session');
  const standard = prepareSurvey(initialSave(), false),
    assisted = prepareSurvey(initialSave(), true);
  assert.ok(walkingPace(assisted) < walkingPace(standard));
  assert.deepEqual(
    assisted.capabilities.grants.find(g => g.capability === 'guided-pace'),
    {capability: 'guided-pace', reason: 'tutorial', event: 'assistance-selected-v1'},
  );
  assert.ok(!assisted.capabilities.evidence.includes('practice-complete'));
  const worn = restoreEquipment(standard.equipment);
  assert.deepEqual(
    worn.active().map(i => i.id),
    ['boots-1'],
  );
  worn.commit('cap-1', worn.preview('cap-1', false).revision, false);
  assert.equal(walkingPace({...standard, equipment: worn.snapshot()}), walkingPace(standard));
  assert.equal(walkingPace(expeditionSave.section.parse(assisted)), walkingPace(assisted));
});

test('doorway refuses unready or closed crossing and retry cannot award a blocked arrival', async () => {
  const t = await testScene(field, {game});
  await ready(t);
  setDoorOpen(t.ctx, false);
  t.press('expedition-next');
  t.run(5);
  assert.equal(status(t).collected, 0);
  assert.equal(status(t).status, 'stopped');
  setDoorOpen(t.ctx, true);
  t.press('expedition-next');
  t.run(7);
  assert.equal(status(t).collected, 1);
  field.exit?.(t.ctx);
});
