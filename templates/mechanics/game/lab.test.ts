import test from 'node:test';
import assert from 'node:assert/strict';
import { testScene, Transform, type CueVoiceOptions } from '@engine';
import game from './game';
import lab, { sessionFor } from './lab';
async function setup() {
  let scene: Awaited<ReturnType<typeof testScene>>;
  scene = await testScene(lab, { game, services: { input: { cancel() { scene?.release('character-x'); scene?.release('character-z'); } } as never } });
  return scene;
}

test('S1: rider pose follows the vehicle with independent movement disabled until validated exit', async () => {
  const t = await setup(), s = sessionFor(t.ctx); s.next(t.ctx); t.hold('character-x', 1); t.run(.4);
  const tr = t.world.get(t.ctx.named('player')!, Transform)!; assert.equal(tr.x, s.fleet.pose('player')![12]);
  s.next(t.ctx); assert.equal(s.fleet.hasRider('player'), false); const old = tr.x; t.run(.4); assert.equal(tr.x, old);
  t.hold('character-x', 1); t.run(.4); assert.ok(tr.x > old);
});
test('S2: repeated collection does not duplicate inventory or debit and equipment gates probe use', async () => {
  const t = await setup(), s = sessionFor(t.ctx);
  assert.equal(s.canProbe(), false); s.next(t.ctx); s.next(t.ctx); s.next(t.ctx);
  const before = s.snapshot(); assert.equal(before.balance, 2); assert.equal(s.claim(), false); assert.deepEqual(s.snapshot(), before);
  s.next(t.ctx); assert.equal(s.canProbe(), true); assert.equal(s.snapshot().equipped, 1);
});
test('S3: one probe action emits one marker and commits one moving-target tag', async () => {
  const t = await setup(), s = sessionFor(t.ctx);
  for (let i = 0; i < 5; i++) s.next(t.ctx);
  s.next(t.ctx); t.run(1); assert.equal(s.snapshot().tags, 1); assert.equal(s.snapshot().markers, 1);
  t.run(1); assert.equal(s.snapshot().tags, 1); assert.equal(s.snapshot().markers, 1);
});


test('probe result emits one spatial cue at the committed impact position', async () => {
  const t = await setup(), s = sessionFor(t.ctx);
  const played: { cue: string; options?: CueVoiceOptions }[] = [];
  t.ctx.playVoice = (cue, options) => { played.push({ cue, options }); return null; };
  for (let i = 0; i < 5; i++) s.next(t.ctx); t.run(1); t.run(1);
  assert.equal(played.length, 1); assert.equal(played[0].cue, 'ui.success');
  const point = played[0].options!.spatial!.position;
  assert.ok(point.every(Number.isFinite)); assert.ok(point[0] > 3 && point[0] < 4); assert.equal(point[1], 1);
});


test('probe pose clip moves only attached presentation while the actor stays authoritative', async () => {
  const t = await setup(), s = sessionFor(t.ctx);
  for (let i = 0; i < 4; i++) s.next(t.ctx);
  t.run(1 / 60);
  const actor = t.world.get(t.ctx.named('player')!, Transform)!;
  const tool = t.world.get(t.ctx.named('probe')!, Transform)!;
  const actorY = actor.y, neutral = tool.y;
  s.next(t.ctx); t.run(.1);
  assert.ok(tool.y > neutral); assert.equal(actor.y, actorY);
  t.run(.5); assert.equal(tool.y, neutral); assert.equal(actor.y, actorY);
});

test('checkpoint delivery reload preserves stock and rejects the old request epoch', async () => {
  const { labSave, bagOptions } = await import('./save');
  const { createCheckpointInventory } = await import('@kits/inventory');
  const { createSession } = await import('./session');
  const t = await setup(), s = sessionFor(t.ctx);
  s.next(t.ctx); s.next(t.ctx); s.next(t.ctx);
  const saved = JSON.parse(JSON.stringify(t.ctx.save(labSave).get()));
  const ledger = createCheckpointInventory(bagOptions, saved.bag);
  assert.equal(ledger.epoch, 1); assert.equal(ledger.quantity('bag', 'probe-batch'), 1);
  assert.deepEqual(ledger.apply(0, { kind: 'exchange', id: 'lab-delivery', consume: [], produce: [] }), { ok: false, reason: 'stale-epoch' });
  const reload = await setup(); sessionFor(reload.ctx).dispose();
  reload.ctx.save(labSave).update(d => Object.assign(d, saved));
  const resumed = createSession(reload.ctx);
  assert.equal(resumed.claim(), false); assert.equal(resumed.snapshot().balance, 2);
  resumed.next(reload.ctx); resumed.next(reload.ctx); resumed.next(reload.ctx); resumed.next(reload.ctx);
  assert.equal(resumed.canProbe(), true); assert.equal(resumed.snapshot().equipped, 1);
  resumed.dispose();
});

test('station placement requires ownership and packing refuses occupants before hiding the station', async () => {
  const { Shape } = await import('@engine');
  const t = await setup(), s = sessionFor(t.ctx);
  for (let i = 0; i < 5; i++) s.next(t.ctx); t.run(1);
  const p = { id: 'intruder', x: 0, z: 2, width: 1, depth: 1, height: 0 };
  assert.equal(s.property.place('other', p, 0, () => ({ height: 0, excluded: false })), false);
  s.next(t.ctx); assert.equal(s.property.snapshot().placements.length, 1);
  const occupied = s.property.snapshot();
  assert.equal(s.property.pack('player', occupied.revision), null); assert.deepEqual(s.property.snapshot(), occupied);
  assert.equal(s.property.pack('other', occupied.revision), null);
  s.next(t.ctx); s.next(t.ctx); t.run(1 / 60);
  assert.equal(s.property.snapshot().packed, true); assert.equal(s.property.snapshot().placements.length, 1);
  assert.equal(t.world.get(t.ctx.named('kiosk')!, Shape)!.visible, false);
});

test('diagnostic root motion stops at collider while skeletal pose overrides remain bounded', async () => {
  const { Model } = await import('@engine');
  const t = await setup(), s = sessionFor(t.ctx), e = t.ctx.named('beacon')!;
  t.run(2.5); const tr = t.world.get(e, Transform)!, pose = t.world.get(e, Model)!.pose;
  assert.ok(tr.x > 1.5 && tr.x < 1.9); assert.equal(pose.length, 2); assert.deepEqual(pose.map(p=>p.node), ['shoulder','elbow']);
  const stopped=tr.x;t.run(1);assert.equal(tr.x,stopped);
  s.beaconOwner.transition({owner:'none',target:'beacon',frame:{id:'lab',generation:1}},()=>true);t.run(.1);assert.equal(tr.x,stopped);
});

test('collecting and equipping the probe play the lab chime: from the kiosk, then higher', async () => {
  const t = await setup(), s = sessionFor(t.ctx);
  s.next(t.ctx); s.next(t.ctx); assert.deepEqual(t.plays, []);
  s.next(t.ctx); assert.deepEqual(t.plays, [{ id: 'lab-chime', options: { volume: .7, position: [0, .6, 2] } }]);
  s.next(t.ctx); assert.deepEqual(t.plays[1], { id: 'lab-chime', options: { volume: .5, pitch: 1.5 } });
  assert.equal(s.claim(), false); assert.equal(t.plays.length, 2, 'a repeated claim plays nothing');
});
