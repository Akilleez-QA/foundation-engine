import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4 } from 'three';
import { createFrames, createFrameUpdates, frameReplicaSystem, FrameReplica } from './index';
import { defineScene, testScene, Transform, Name } from '../../author';
const pose = (x: number) => new Matrix4().makeTranslation(x, 0, 0).toArray();
const ref = (id: string, generation = 1) => ({ id, generation });
test('missing parents delay newer updates; older poses cannot overwrite newest-seen identity', () => {
  const f = createFrames(), q = createFrameUpdates(f); q.register('rider', 1);
  q.offer('rider', { generation: 1, sequence: 2, frame: ref('ship'), local: pose(3) });
  assert.equal(q.pump(1), 0); assert.equal(q.state('rider')?.newestSeen, 2); assert.equal(q.state('rider')?.applied, -1);
  assert.equal(q.offer('rider', { generation: 1, sequence: 1, frame: ref('world'), local: pose(99) }), false);
  f.set({ ...ref('ship'), parent: ref('world'), matrix: pose(10) }); assert.equal(q.pump(1), 0);
  f.set({ ...ref('world'), matrix: pose(100) }); assert.equal(q.pump(1), 1); assert.equal(q.state('rider')?.world?.[12], 113);
});
test('generations cancel stale work and frames cannot revive removed identities', () => {
  const f = createFrames(), q = createFrameUpdates(f); q.register('rider', 1);
  q.offer('rider', { generation: 1, sequence: 2, frame: ref('ship'), local: pose(3) }); q.cancel('rider', 1);
  assert.throws(() => q.register('rider', 1)); q.register('rider', 2);
  assert.equal(q.offer('rider', { generation: 1, sequence: 99, frame: ref('ship'), local: pose(99) }), false);
  f.set({ ...ref('ship'), matrix: pose(1) }); f.remove(ref('ship'));
  assert.equal(f.set({ ...ref('ship'), matrix: pose(2) }), false); f.set({ ...ref('ship', 2), matrix: pose(2) }); assert.equal(f.resolve(ref('ship')), null);
});
test('bounded work rotates unresolved dependencies so ready owners are not starved', () => {
  const f = createFrames(), q = createFrameUpdates(f, 2); f.set({ ...ref('ready'), matrix: pose(0) });
  q.register('a', 1); q.register('b', 1); assert.throws(() => q.register('c', 1));
  q.offer('a', { generation: 1, sequence: 0, frame: ref('missing'), local: pose(0) });
  q.offer('b', { generation: 1, sequence: 0, frame: ref('ready'), local: pose(5) });
  assert.equal(q.pump(1), 0); assert.equal(q.pump(1), 1);
});
test('frame graph rejects cycles and freezes caller matrices', () => {
  const f = createFrames(), p = pose(2); f.set({ ...ref('a'), matrix: p }); p[12] = 99;
  f.set({ ...ref('b'), parent: ref('a'), matrix: pose(3) }); assert.equal(f.resolve(ref('b'))?.[12], 5);
  assert.throws(() => f.set({ ...ref('a'), parent: ref('b'), matrix: pose(0) }));
});
test('author-system adapter writes only applied snapshots for the current entity generation', async () => {
  const f = createFrames(), q = createFrameUpdates(f); f.set({ ...ref('room'), matrix: pose(10) }); q.register('actor', 1);
  const s = await testScene(defineScene({ id: 'replica', title: 'replica.title', entities: [[Name({ name: 'actor' }), Transform(), FrameReplica({ owner: 'actor', generation: 1 })]], systems: [frameReplicaSystem(q)] }));
  q.offer('actor', { generation: 1, sequence: 0, frame: ref('room'), local: pose(4) }); s.run(1 / 60);
  assert.equal(s.world.get(s.ctx.named('actor')!, Transform)?.x, 14);
});

test('applied local pose follows parent motion without another sequence and holds display on parent loss', async () => {
  const f = createFrames(), q = createFrameUpdates(f); f.set({ ...ref('room'), matrix: pose(10) }); q.register('actor', 1);
  const s = await testScene(defineScene({ id: 'parent-moves', title: 'parent.moves', entities: [[Name({ name: 'actor' }), Transform(), FrameReplica({ owner: 'actor', generation: 1 })]], systems: [frameReplicaSystem(q)] }));
  q.offer('actor', { generation: 1, sequence: 4, frame: ref('room'), local: pose(4) }); s.run(1 / 60);
  const before = q.state('actor')!.revision; f.set({ ...ref('room'), matrix: pose(20) }); s.run(1 / 60);
  assert.equal(q.state('actor')!.applied, 4); assert.ok(q.state('actor')!.revision > before);
  assert.equal(s.world.get(s.ctx.named('actor')!, Transform)!.x, 24);
  f.remove(ref('room')); s.run(1 / 60); assert.equal(q.state('actor')!.world, null);
  assert.equal(s.world.get(s.ctx.named('actor')!, Transform)!.x, 24);
});
