import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4} from 'three';
import {createFrames, createFrameUpdates, frameReplicaSystem, FrameReplica, frameRef, type FrameRef} from './index';
import {defineScene, testScene, Transform, Name} from '../../author';
const pose = (x: number) => new Matrix4().makeTranslation(x, 0, 0).toArray();
const ref = (id: string, generation = 1) => ({id, generation});
test('runtime identities reject nonstring IDs before retaining frames or owner capacity', () => {
  for (const id of [1, true, {}, [], new String('frame'), Symbol('frame'), '']) {
    const invalid = {id, generation: 1} as FrameRef,
      f = createFrames(1),
      q = createFrameUpdates(f, 1);
    assert.throws(() => frameRef(invalid), /invalid frame identity/);
    assert.throws(() => f.set({...invalid, matrix: pose(0)}), /invalid frame identity/);
    assert.throws(() => q.register(invalid.id, 1), /invalid frame identity/);
    assert.equal(f.size, 0);
    assert.equal(q.size, 0);
    assert.equal(f.set({...ref('valid'), matrix: pose(2)}), true);
    q.register('owner', 1);
    assert.throws(() => f.remove(invalid), /invalid frame identity/);
    assert.throws(() => f.resolve(invalid), /invalid frame identity/);
    assert.throws(
      () => q.offer('owner', {generation: 1, sequence: 4, frame: invalid, local: pose(0)}),
      /invalid frame identity/,
    );
    assert.equal(q.state('owner')!.newestSeen, -1);
    assert.equal(f.resolve(ref('valid'))![12], 2);
  }
});
test('frame identity admission captures each field once and resolution uses that capture', () => {
  const f = createFrames();
  f.set({...ref('valid'), matrix: pose(2)});
  let ids = 0,
    generations = 0;
  const changing = (): FrameRef => ({
    get id() {
      return ++ids === 1 ? 'valid' : 'wrong';
    },
    get generation() {
      return ++generations === 1 ? 1 : 2;
    },
  });
  assert.equal(f.resolve(changing())![12], 2);
  assert.deepEqual([ids, generations], [1, 1]);
  ids = generations = 0;
  assert.equal(f.remove(changing()), true);
  assert.deepEqual([ids, generations], [1, 1]);
});
test('missing parents delay newer updates; older poses cannot overwrite newest-seen identity', () => {
  const f = createFrames(),
    q = createFrameUpdates(f);
  q.register('rider', 1);
  q.offer('rider', {generation: 1, sequence: 2, frame: ref('ship'), local: pose(3)});
  assert.equal(q.pump(1), 0);
  assert.equal(q.state('rider')?.newestSeen, 2);
  assert.equal(q.state('rider')?.applied, -1);
  assert.equal(q.offer('rider', {generation: 1, sequence: 1, frame: ref('world'), local: pose(99)}), false);
  f.set({...ref('ship'), parent: ref('world'), matrix: pose(10)});
  assert.equal(q.pump(1), 0);
  f.set({...ref('world'), matrix: pose(100)});
  assert.equal(q.pump(1), 1);
  assert.equal(q.state('rider')?.world?.[12], 113);
});
test('generations cancel stale work and frames cannot revive removed identities', () => {
  const f = createFrames(),
    q = createFrameUpdates(f);
  q.register('rider', 1);
  q.offer('rider', {generation: 1, sequence: 2, frame: ref('ship'), local: pose(3)});
  q.cancel('rider', 1);
  assert.throws(() => q.register('rider', 1));
  q.register('rider', 2);
  assert.equal(q.offer('rider', {generation: 1, sequence: 99, frame: ref('ship'), local: pose(99)}), false);
  f.set({...ref('ship'), matrix: pose(1)});
  f.remove(ref('ship'));
  assert.equal(f.set({...ref('ship'), matrix: pose(2)}), false);
  f.set({...ref('ship', 2), matrix: pose(2)});
  assert.equal(f.resolve(ref('ship')), null);
});
test('bounded work rotates unresolved dependencies so ready owners are not starved', () => {
  const f = createFrames(),
    q = createFrameUpdates(f, 2);
  f.set({...ref('ready'), matrix: pose(0)});
  q.register('a', 1);
  q.register('b', 1);
  assert.throws(() => q.register('c', 1));
  q.offer('a', {generation: 1, sequence: 0, frame: ref('missing'), local: pose(0)});
  q.offer('b', {generation: 1, sequence: 0, frame: ref('ready'), local: pose(5)});
  assert.equal(q.pump(1), 0);
  assert.equal(q.pump(1), 1);
});
test('frame graph rejects cycles and freezes caller matrices', () => {
  const f = createFrames(),
    p = pose(2);
  f.set({...ref('a'), matrix: p});
  p[12] = 99;
  f.set({...ref('b'), parent: ref('a'), matrix: pose(3)});
  assert.equal(f.resolve(ref('b'))?.[12], 5);
  assert.throws(() => f.set({...ref('a'), parent: ref('b'), matrix: pose(0)}));
});
test('author-system adapter writes only applied snapshots for the current entity generation', async () => {
  const f = createFrames(),
    q = createFrameUpdates(f);
  f.set({...ref('room'), matrix: pose(10)});
  q.register('actor', 1);
  const s = await testScene(
    defineScene({
      id: 'replica',
      title: 'replica.title',
      entities: [[Name({name: 'actor'}), Transform(), FrameReplica({owner: 'actor', generation: 1})]],
      systems: [frameReplicaSystem(q)],
    }),
  );
  q.offer('actor', {generation: 1, sequence: 0, frame: ref('room'), local: pose(4)});
  s.run(1 / 60);
  assert.equal(s.world.get(s.ctx.named('actor')!, Transform)?.x, 14);
});

test('applied local pose follows parent motion without another sequence and holds display on parent loss', async () => {
  const f = createFrames(),
    q = createFrameUpdates(f);
  f.set({...ref('room'), matrix: pose(10)});
  q.register('actor', 1);
  const s = await testScene(
    defineScene({
      id: 'parent-moves',
      title: 'parent.moves',
      entities: [[Name({name: 'actor'}), Transform(), FrameReplica({owner: 'actor', generation: 1})]],
      systems: [frameReplicaSystem(q)],
    }),
  );
  q.offer('actor', {generation: 1, sequence: 4, frame: ref('room'), local: pose(4)});
  s.run(1 / 60);
  const before = q.state('actor')!.revision;
  f.set({...ref('room'), matrix: pose(20)});
  s.run(1 / 60);
  assert.equal(q.state('actor')!.applied, 4);
  assert.ok(q.state('actor')!.revision > before);
  assert.equal(s.world.get(s.ctx.named('actor')!, Transform)!.x, 24);
  f.remove(ref('room'));
  s.run(1 / 60);
  assert.equal(q.state('actor')!.world, null);
  assert.equal(s.world.get(s.ctx.named('actor')!, Transform)!.x, 24);
});

test('author pose cache includes owner generation, owner name and native transform identity', async () => {
  const f = createFrames(),
    q = createFrameUpdates(f);
  f.set({...ref('room'), matrix: pose(0)});
  q.register('actor', 1);
  const s = await testScene(
    defineScene({
      id: 'replica-rebind',
      title: 'replica.rebind',
      entities: [[Name({name: 'actor'}), Transform(), FrameReplica({owner: 'actor', generation: 1})]],
      systems: [frameReplicaSystem(q)],
    }),
  );
  const entity = s.ctx.named('actor')!,
    replica = s.world.get(entity, FrameReplica)!;
  const offer = (owner: string, generation: number, x: number) =>
    q.offer(owner, {generation, sequence: 0, frame: ref('room'), local: pose(x)});
  offer('actor', 1, 4);
  s.run(1 / 60);
  const firstRevision = replica.revision;
  assert.equal(s.world.get(entity, Transform)!.x, 4);
  q.cancel('actor', 1);
  q.register('actor', 2);
  offer('actor', 2, 9);
  s.run(1 / 60);
  assert.equal(s.world.get(entity, Transform)!.x, 4); // Component still owns the old generation.
  replica.generation = 2;
  s.run(1 / 60);
  assert.equal(q.state('actor')!.revision, firstRevision);
  assert.equal(s.world.get(entity, Transform)!.x, 9);

  q.register('other', 2);
  offer('other', 2, 12);
  replica.owner = 'other';
  s.run(1 / 60);
  assert.equal(q.state('other')!.revision, firstRevision);
  assert.equal(s.world.get(entity, Transform)!.x, 12);
  s.world.add(entity, Transform({x: 99}));
  s.run(1 / 60);
  assert.equal(s.world.get(entity, Transform)!.x, 12);
});

test('attached pose cannot follow a replaced frame generation without an explicit newer update', () => {
  const f = createFrames(),
    q = createFrameUpdates(f);
  f.set({...ref('platform'), matrix: pose(10)});
  q.register('actor', 1);
  q.offer('actor', {generation: 1, sequence: 0, frame: ref('platform'), local: pose(3)});
  q.pump(1);
  assert.equal(q.state('actor')!.world![12], 13);
  f.remove(ref('platform'));
  f.set({...ref('platform', 2), matrix: pose(100)});
  q.pump(1);
  assert.equal(q.state('actor')!.world, null);
  assert.equal(q.state('actor')!.frame!.generation, 1);
  q.offer('actor', {generation: 1, sequence: 1, frame: ref('platform', 2), local: pose(3)});
  q.pump(1);
  assert.equal(q.state('actor')!.world![12], 103);
});
