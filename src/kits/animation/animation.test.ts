import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarkerTrack, createSocketRig, defineMarkerClip } from './index';
import { Matrix4 } from 'three';
const clip = { id: 'walk', duration: 1, markers: [{ id: 'step', at: .5 }, { id: 'boundary', at: 0 }] };
test('markers cross skipped frames and loop boundaries once per action occurrence', () => {
  const t = createMarkerTrack(clip, { action: 'actor:1', loop: true });
  assert.deepEqual(t.advance(.5).map(e => [e.marker, e.cycle]), [['step', 0]]);
  assert.deepEqual(t.advance(2).map(e => [e.marker, e.cycle]), [['boundary', 1], ['step', 1], ['boundary', 2]]);
  assert.deepEqual(t.advance(2), []);
  const a = createMarkerTrack(clip, { action: 'actor:2' }).advance(.5)[0];
  assert.notEqual(a.key, createMarkerTrack(clip, { action: 'actor:1' }).advance(.5)[0].key);
});
test('seek and teleport suppress crossed markers; cancellation ends events', () => {
  const t = createMarkerTrack(clip, { action: 'a', loop: true }); t.seek(9.8);
  assert.deepEqual(t.advance(10).map(e => e.cycle), [10]); t.seek(0); assert.equal(t.advance(.5).length, 1);
  assert.throws(() => t.advance(.1)); t.cancel(); assert.deepEqual(t.advance(12), []);
});
test('event budget rejects huge catch-up before changing cursor', () => {
  const t = createMarkerTrack(clip, { action: 'a', loop: true, maxEvents: 2 });
  assert.throws(() => t.advance(1e10), /budget/); assert.equal(t.time, 0); assert.equal(t.advance(1).length, 2);
});
test('definition snapshot cannot be changed after creation and nonlooping clips stop', () => {
  const source = { id: 'x', duration: 1, markers: [{ id: 'm', at: .2 }] }; const t = createMarkerTrack(source, { action: 'a' });
  source.markers[0].at = .9; assert.equal(t.advance(.3).length, 1); assert.ok(Object.isFrozen(t.clip.markers[0]));
  assert.deepEqual(t.advance(10), []); assert.equal(t.time, 1);
  assert.throws(() => defineMarkerClip({ ...clip, duration: 0 }));
  assert.throws(() => defineMarkerClip({ ...clip, markers: [{ id: 'x', at: 1 }] }));
});
const translate = (x: number, y = 0, z = 0) => new Matrix4().makeTranslation(x, y, z).toArray();
test('named attachment survives LOD changes and carries the coordinate-frame identity', () => {
  const rig = createSocketRig([{ id: 'high', sockets: { hand: translate(1) } }, { id: 'low', sockets: { hand: translate(2) } }]);
  rig.attach('tool-17', 'hand', translate(3));
  const a = rig.sample('tool-17', 'high', { id: 'vehicle-4', matrix: translate(10) });
  const b = rig.sample('tool-17', 'low', { id: 'vehicle-4', matrix: translate(10) });
  assert.equal(a.child, 'tool-17'); assert.equal(a.frame, 'vehicle-4'); assert.equal(a.matrix[12], 14); assert.equal(b.matrix[12], 15);
  assert.equal(rig.detach('tool-17')?.child, 'tool-17'); assert.equal(rig.detach('tool-17'), undefined);
  assert.throws(() => rig.sample('tool-17', 'high', { id: 'world', matrix: translate(0) }));
});
test('attachment composition respects parent rotation and snapshots definitions', () => {
  const local = translate(1); const rig = createSocketRig([{ id: 'only', sockets: { hand: local } }]); local[12] = 999;
  rig.attach('tool', 'hand'); const p = rig.sample('tool', 'only', { id: 'room', matrix: new Matrix4().makeRotationZ(Math.PI / 2).toArray() });
  assert.ok(Math.abs(p.matrix[12]) < 1e-12); assert.ok(Math.abs(p.matrix[13] - 1) < 1e-12); assert.ok(Object.isFrozen(p.matrix));
});
test('rig rejects missing LOD sockets, duplicate ownership, bad matrices and excess attachments', () => {
  assert.throws(() => createSocketRig([{ id: 'high', sockets: { hand: translate(0) } }, { id: 'low', sockets: {} }]));
  const rig = createSocketRig([{ id: 'only', sockets: { hand: translate(0) } }], 1);
  assert.throws(() => rig.attach('bad', 'hand', [1])); rig.attach('one', 'hand');
  assert.throws(() => rig.attach('one', 'hand')); assert.throws(() => rig.attach('two', 'hand'));
  assert.equal(rig.clear().length, 1); assert.equal(rig.size, 0);
});
