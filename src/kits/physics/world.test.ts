import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../../core/ecs/world';
import {defineScene, defineSystem, testScene, Transform} from '../../author';
import {
  Collider,
  createPhysicsLoader,
  createPhysicsWorld,
  loadPhysics,
  PhysicsCharacter,
  physicsConfig,
  RigidBody,
  scenePhysics,
  type PhysicsCollision,
  type Rapier,
} from './index';

const ready = async (): Promise<Rapier> => {
  const r = await loadPhysics();
  assert.equal(r.status, 'ready');
  return (r as {rapier: Rapier}).rapier;
};

/** Count library frees on the shared prototypes while `fn` runs. */
async function countingFrees<T>(rapier: Rapier, fn: () => T | Promise<T>) {
  const counts = {worlds: 0, queues: 0, controllers: 0};
  const patch = (proto: {free(): void}, key: keyof typeof counts) => {
    const original = proto.free;
    proto.free = function (this: unknown) {
      counts[key]++;
      return original.call(this);
    };
    return () => {
      proto.free = original;
    };
  };
  const undo = [
    patch(rapier.World.prototype, 'worlds'),
    patch(rapier.EventQueue.prototype, 'queues'),
    patch(rapier.KinematicCharacterController.prototype, 'controllers'),
  ];
  try {
    const value = await fn();
    return {counts, value};
  } finally {
    for (const u of undo) u();
  }
}

test('loader: loads once per page and shares the module between callers', async () => {
  let calls = 0;
  const real = await ready();
  const loader = createPhysicsLoader(async () => {
    calls++;
    return real;
  });
  const [a, b] = await Promise.all([loader.load(), loader.load()]);
  assert.equal(a.status, 'ready');
  assert.equal(b.status, 'ready');
  assert.equal((await loader.load()).status, 'ready');
  assert.equal(calls, 1);
  assert.equal(loader.attempts, 1);
  assert.equal(loader.ready(), real);
});

test('loader: abort during the load settles that caller as aborted, removes its listener and the load still completes for the next caller', async () => {
  const real = await ready();
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const loader = createPhysicsLoader(async () => {
    await gate;
    return real;
  });
  const controller = new AbortController();
  let listeners = 0;
  const signal = controller.signal;
  const add = signal.addEventListener.bind(signal),
    remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = ((...args: Parameters<typeof add>) => (listeners++, add(...args))) as typeof add;
  signal.removeEventListener = ((...args: Parameters<typeof remove>) => (
    listeners--,
    remove(...args)
  )) as typeof remove;
  const pending = loader.load(signal);
  controller.abort();
  assert.deepEqual(await pending, {status: 'aborted'});
  assert.equal(listeners, 0, 'the abort listener is removed once settled');
  assert.equal(loader.ready(), null, 'nothing is ready yet');
  release();
  assert.equal((await loader.load()).status, 'ready');
  assert.equal(loader.attempts, 1, 'the aborted caller did not cancel the shared load');
  const already = new AbortController();
  already.abort();
  const fresh = createPhysicsLoader(async () => real);
  assert.deepEqual(await fresh.load(already.signal), {status: 'aborted'});
  assert.equal(fresh.attempts, 0, 'an already aborted signal starts nothing');
});

test('loader: a failed load is reported, forgotten and retried by the next call', async () => {
  const real = await ready();
  let fail = true;
  const loader = createPhysicsLoader(async () => {
    if (fail) throw Error('network');
    return real;
  });
  const first = await loader.load();
  assert.equal(first.status, 'failed');
  fail = false;
  assert.equal((await loader.load()).status, 'ready');
  assert.equal(loader.attempts, 2);
  const wrong = createPhysicsLoader(async () => ({}) as Rapier);
  assert.equal((await wrong.load()).status, 'failed', 'a module that is not the library is refused');
});

test('config: invalid options are refused with the field named; defaults follow the engine fixed step', () => {
  const c = physicsConfig();
  assert.equal(c.step, 1 / 60);
  assert.equal(c.substeps, 1);
  assert.equal(physicsConfig({substeps: 2}).step, 1 / 120);
  assert.equal(physicsConfig({timeScale: 0.5}).step, 1 / 120, 'a deliberate time scale changes physics time');
  for (const [bad, field] of [
    [{gravity: {x: 0, y: Number.NaN, z: 0}}, 'gravity.y'],
    [{solverIterations: 0}, 'solverIterations'],
    [{solverIterations: 2.5}, 'solverIterations'],
    [{substeps: 9}, 'substeps'],
    [{timeScale: 0}, 'timeScale'],
    [{limits: {maxBodies: 0}}, 'limits.maxBodies'],
    [{limits: {maxSnapshotBytes: 10}}, 'limits.maxSnapshotBytes'],
    [{limits: {bogus: 1}}, 'unknown limit bogus'],
    [{math: 'fast'}, 'math'],
  ] as const)
    assert.throws(
      () => physicsConfig(bad as never),
      (e: Error) => e instanceof RangeError && e.message.includes(field),
    );
  assert.throws(() => scenePhysics({substeps: 0}), RangeError, 'scenePhysics refuses at definition time');
});

test('lifecycle: dispose frees the world and event queue exactly once and is idempotent; later calls report disposed', async () => {
  const rapier = await ready();
  const {counts} = await countingFrees(rapier, () => {
    const pw = createPhysicsWorld(rapier);
    const w = new World();
    w.spawn(Transform({y: 2}), RigidBody(), Collider({shape: 'ball', radius: 0.5}));
    pw.tick(w);
    pw.dispose();
    pw.dispose();
    assert.equal(pw.disposed, true);
    assert.equal(pw.tick(w), null);
    assert.deepEqual(pw.snapshot(), {status: 'disposed'});
    assert.deepEqual(pw.restore('{}'), {status: 'disposed'});
    assert.deepEqual(pw.raycast({x: 0, y: 5, z: 0}, {x: 0, y: -1, z: 0}, 10), {status: 'disposed'});
    assert.equal(pw.debugLines(), null);
    assert.equal(pw.status().state, 'disposed');
    assert.deepEqual(pw.status().released, {worlds: 1, queues: 1, controllers: 0});
  });
  assert.equal(counts.worlds, 1);
  assert.equal(counts.queues, 1);
});

test('lifecycle: a scene visit loads in prepare, ticks once per fixed step, and exit disposes the visit world', async () => {
  const rapier = await ready();
  const physics = scenePhysics();
  let seen = 0;
  const reader = defineSystem({
    id: 'reads-physics',
    run(ctx) {
      if (physics.of(ctx)) seen++;
    },
  });
  const scene = defineScene({
    id: 'drop',
    title: 'Drop',
    prepare: (_ctx, signal) => physics.prepare(signal),
    exit: ctx => physics.exit(ctx),
    entities: [
      [Transform({y: 3}), RigidBody(), Collider({shape: 'ball', radius: 0.5})],
      [Transform(), Collider({hx: 5, hy: 0.1, hz: 5})],
    ],
    systems: [physics.system, reader],
  });
  const {counts} = await countingFrees(rapier, async () => {
    const t = await testScene(scene);
    t.run(1);
    const pw = physics.of(t.ctx)!;
    assert.equal(pw.status().tick, 60, 'one step per fixed tick');
    assert.equal(seen, 60);
    assert.equal(physics.state(t.ctx), 'running');
    const ball = t.world.first(RigidBody)![0];
    assert.ok(t.world.get(ball, Transform)!.y < 0.7, 'the dynamic body fell and its pose was written back');
    t.dispose();
    assert.equal(pw.disposed, true);
    assert.equal(physics.of(t.ctx), null, 'a retired visit never recreates its world');
    assert.equal(physics.state(t.ctx), 'disposed');
    physics.exit(t.ctx);
  });
  assert.equal(counts.worlds, 1, 'exactly one world freed for the visit');
  assert.equal(counts.queues, 1);
});

test('lifecycle: the visit abort signal disposes too; prepare rejects on abort', async () => {
  const rapier = await ready();
  const physics = scenePhysics();
  const controller = new AbortController();
  const world = new World();
  const pw = physics.of({world, view: {signal: controller.signal}} as never)!;
  assert.ok(pw);
  controller.abort();
  assert.equal(pw.disposed, true);
  physics.exit({world});
  assert.deepEqual(pw.status().released, {worlds: 1, queues: 0 + 1, controllers: 0});
  const gate = new Promise<Rapier>(() => {});
  const slow = scenePhysics({loader: createPhysicsLoader(() => gate)});
  const abort = new AbortController();
  const p = slow.prepare(abort.signal);
  abort.abort(Error('left the scene'));
  await assert.rejects(p, /left the scene/);
  const notLoaded = new World();
  assert.equal(slow.of({world: notLoaded}), null, 'no world before the library is ready');
  void rapier;
});

test('limits: bodies, colliders and characters beyond the configured bounds are refused, counted and retried', async () => {
  const rapier = await ready();
  const pw = createPhysicsWorld(rapier, {limits: {maxBodies: 2, maxColliders: 3}});
  const w = new World();
  const ids = [0, 1, 2].map(i => w.spawn(Transform({x: i * 2, y: 1}), RigidBody(), Collider()));
  const statics = [0, 1].map(i => w.spawn(Transform({x: i * 2, z: 5}), Collider()));
  pw.tick(w);
  let s = pw.status();
  assert.equal(s.bodies, 2);
  assert.equal(s.colliders, 3);
  assert.equal(s.refused['limit-bodies'], 1);
  assert.equal(s.refused['limit-colliders'], 1);
  assert.equal(pw.handles(ids[2]!), null);
  assert.equal(pw.handles(statics[1]!), null);
  assert.equal(s.refusals, 2);
  pw.tick(w);
  assert.equal(pw.status().refusals, 2, 'a still-refused entity is not counted again');
  w.despawn(ids[0]!);
  pw.tick(w);
  s = pw.status();
  assert.ok(pw.handles(ids[2]!), 'a freed slot admits the waiting entity in entity order');
  assert.equal(s.bodies, 2);
  const bad = w.spawn(Transform(), RigidBody(), Collider({shape: 'ball', radius: -1}));
  pw.tick(w);
  assert.equal(pw.status().refused['invalid-collider'], 1);
  assert.equal(pw.handles(bad), null);
  pw.dispose();
});

test('despawn: a removed entity loses its body and collider; its old handles are never reused for it', async () => {
  const rapier = await ready();
  const pw = createPhysicsWorld(rapier);
  const w = new World();
  const a = w.spawn(Transform({y: 1}), RigidBody(), Collider());
  const s = w.spawn(Transform({x: 3}), Collider());
  pw.tick(w);
  const before = pw.handles(a)!;
  assert.equal(pw.status().bodies, 1);
  w.despawn(a);
  w.remove(s, Collider);
  pw.tick(w);
  assert.equal(pw.handles(a), null);
  assert.equal(pw.handles(s), null);
  assert.deepEqual([pw.status().bodies, pw.status().colliders], [0, 0]);
  const b = w.spawn(Transform({y: 1}), RigidBody(), Collider());
  pw.tick(w);
  const after = pw.handles(b)!;
  assert.notEqual(after.body, before.body, 'the library bumps the generation of a reused slot');
  const hit = pw.raycast({x: 0, y: 5, z: 0}, {x: 0, y: -1, z: 0}, 10);
  assert.equal(hit.status === 'ok' && hit.hits[0]?.entity, b, 'queries map to the live entity only');
  pw.dispose();
});

test('events: collision events are ordered by entity pair, mark sensors, and are bounded with drops counted', async () => {
  const rapier = await ready();
  const pw = createPhysicsWorld(rapier, {limits: {maxEventsPerStep: 2}});
  const w = new World();
  w.spawn(Transform(), Collider({hx: 20, hy: 0.1, hz: 20}));
  const balls = [0, 1, 2, 3].map(i =>
    w.spawn(Transform({x: i * 2 - 3, y: 0.7}), RigidBody(), Collider({shape: 'ball', radius: 0.5})),
  );
  const zone = w.spawn(Transform({x: 9, y: 0.5}), Collider({sensor: true, hx: 1, hy: 1, hz: 1}));
  const all: PhysicsCollision[] = [];
  let dropped = 0;
  for (let i = 0; i < 60; i++) {
    const ev = pw.tick(w)!;
    assert.ok(ev.list.length <= 2);
    for (let k = 1; k < ev.list.length; k++) {
      const p = ev.list[k - 1]!,
        q = ev.list[k]!;
      assert.ok(p.a < q.a || (p.a === q.a && p.b <= q.b), 'sorted by pair');
    }
    for (const e of ev.list) assert.ok(e.a < e.b);
    all.push(...ev.list);
    dropped += ev.dropped;
  }
  assert.ok(dropped >= 2, `four landings in a bound of two: ${dropped} dropped`);
  assert.equal(pw.status().droppedEvents, dropped);
  assert.ok(all.every(e => e.started && !e.sensor && balls.includes(e.b)));
  // A ball rolled into the sensor reports a sensor event.
  pw.teleport(balls[3]!, {x: 9, y: 0.6, z: 0});
  let sensed = false;
  for (let i = 0; i < 5; i++) sensed ||= pw.tick(w)!.list.some(e => e.sensor && e.b === zone);
  assert.ok(sensed, 'a body entering a sensor is reported as a sensor event');
  pw.dispose();
});

test('queries: raycast, bounded raycastAll, overlap and shape cast return entity ids and refuse invalid input', async () => {
  const rapier = await ready();
  const pw = createPhysicsWorld(rapier, {limits: {maxQueryHits: 2}});
  const w = new World();
  const boxes = [1, 3, 5].map(y => w.spawn(Transform({y}), Collider({hx: 0.4, hy: 0.4, hz: 0.4})));
  pw.tick(w);
  const one = pw.raycast({x: 0, y: 10, z: 0}, {x: 0, y: -2, z: 0}, 20);
  assert.equal(one.status, 'ok');
  if (one.status === 'ok') {
    assert.equal(one.hits[0]!.entity, boxes[2]);
    assert.ok(Math.abs(one.hits[0]!.distance - 4.6) < 1e-4);
    assert.ok(Math.abs(one.hits[0]!.normal.y - 1) < 1e-4);
  }
  const excluded = pw.raycast({x: 0, y: 10, z: 0}, {x: 0, y: -1, z: 0}, 20, {exclude: boxes[2]!});
  assert.equal(excluded.status === 'ok' && excluded.hits[0]!.entity, boxes[1]);
  const many = pw.raycastAll({x: 0, y: 10, z: 0}, {x: 0, y: -1, z: 0}, 20);
  assert.equal(many.status === 'ok' && many.hits.length, 2);
  assert.equal(many.status === 'ok' && many.truncated, true, 'the bound is reported, not hidden');
  const over = pw.overlap({shape: 'ball', radius: 1.2}, {x: 0, y: 2, z: 0});
  assert.deepEqual(over.status === 'ok' && over.hits, [boxes[0], boxes[1]]);
  const cast = pw.castShape({shape: 'ball', radius: 0.2}, {x: 0, y: 10, z: 0}, {x: 0, y: -1, z: 0}, 20);
  assert.equal(cast.status === 'ok' && cast.hits[0]!.entity, boxes[2]);
  for (const r of [
    pw.raycast({x: Number.NaN, y: 0, z: 0}, {x: 0, y: -1, z: 0}, 1),
    pw.raycast({x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0}, 1),
    pw.raycast({x: 0, y: 0, z: 0}, {x: 0, y: -1, z: 0}, -1),
    pw.raycastAll({x: 0, y: 0, z: 0}, {x: 0, y: -1, z: 0}, 1, {maxHits: 3}),
    pw.overlap({shape: 'ball', radius: 0}, {x: 0, y: 0, z: 0}),
  ])
    assert.equal(r.status, 'invalid');
  pw.dispose();
});

test('debug draw: line output is bounded by maxDebugVertices and reports what it left out', async () => {
  const rapier = await ready();
  const pw = createPhysicsWorld(rapier, {limits: {maxDebugVertices: 10}});
  const w = new World();
  for (let i = 0; i < 5; i++) w.spawn(Transform({x: i * 3}), Collider({shape: 'ball', radius: 1}));
  pw.tick(w);
  const lines = pw.debugLines()!;
  assert.equal(lines.vertexCount, 10);
  assert.equal(lines.vertices.length, 30);
  assert.equal(lines.colors.length, 40);
  assert.ok(lines.total > 10 && lines.truncated);
  pw.dispose();
});

test('rebuild: changed component data is applied only on request', async () => {
  const rapier = await ready();
  const pw = createPhysicsWorld(rapier);
  const w = new World();
  const e = w.spawn(Transform(), Collider({hx: 0.5, hy: 0.5, hz: 0.5}));
  pw.tick(w);
  w.get(e, Collider)!.hy = 3;
  pw.tick(w);
  const miss = pw.raycast({x: 0, y: 10, z: 0}, {x: 0, y: -1, z: 0}, 20);
  assert.ok(miss.status === 'ok' && Math.abs(miss.hits[0]!.distance - 9.5) < 1e-4, 'in-place edits are not observed');
  pw.rebuild(e);
  pw.tick(w);
  const hit = pw.raycast({x: 0, y: 10, z: 0}, {x: 0, y: -1, z: 0}, 20);
  assert.ok(hit.status === 'ok' && Math.abs(hit.hits[0]!.distance - 7) < 1e-4);
  pw.dispose();
});

test('kinematic bodies follow Transform and fixed bodies stay put', async () => {
  const rapier = await ready();
  const pw = createPhysicsWorld(rapier);
  const w = new World();
  const k = w.spawn(Transform(), RigidBody({kind: 'kinematic'}), Collider());
  const f = w.spawn(Transform({x: 5}), RigidBody({kind: 'fixed'}), Collider());
  pw.tick(w);
  w.get(k, Transform)!.x = 2;
  w.get(f, Transform)!.x = 9;
  pw.tick(w);
  const ray = (x: number) => pw.raycast({x, y: 10, z: 0}, {x: 0, y: -1, z: 0}, 20);
  const atK = ray(2),
    atF = ray(5);
  assert.equal(atK.status === 'ok' && atK.hits[0]?.entity, k);
  assert.equal(atF.status === 'ok' && atF.hits[0]?.entity, f);
  pw.dispose();
});

test('events: stop events for a despawned entity are counted as unmapped, never listed or dropped', async () => {
  const rapier = await ready();
  const pw = createPhysicsWorld(rapier);
  const w = new World();
  w.spawn(Transform(), Collider({hx: 5, hy: 0.1, hz: 5}));
  const ball = w.spawn(Transform({y: 0.62}), RigidBody(), Collider({shape: 'ball', radius: 0.5}));
  let started = 0;
  for (let i = 0; i < 30; i++) started += pw.tick(w)!.list.filter(e => e.started).length;
  assert.equal(started, 1);
  w.despawn(ball);
  const ev = pw.tick(w)!;
  assert.deepEqual([ev.list.length, ev.dropped, ev.unmapped], [0, 0, 1]);
  assert.equal(pw.status().unmappedEvents, 1);
  assert.equal(pw.status().droppedEvents, 0);
  pw.dispose();
});

test('scene: current() never creates a world; of() adopts the visit signal even when another caller created it', async () => {
  await ready();
  const physics = scenePhysics();
  const world = new World();
  assert.equal(physics.current({world}), null);
  const created = physics.of({world})!;
  assert.equal(physics.current({world}), created);
  const controller = new AbortController();
  assert.equal(physics.of({world, view: {signal: controller.signal}} as never), created);
  controller.abort();
  assert.equal(created.disposed, true, 'the visit signal disposes a world created before the signal was seen');
  assert.equal(physics.current({world}), null);
});

test('transforms: non-finite or out-of-bound positions and rotations are refused at admission, skipped as kinematic targets and refused by teleport', async () => {
  const rapier = await ready();
  const pw = createPhysicsWorld(rapier, {limits: {maxCoordinate: 1000}});
  const w = new World();
  const bad = [
    w.spawn(Transform({x: Number.NaN}), RigidBody(), Collider()),
    w.spawn(Transform({y: 1e39}), RigidBody(), Collider()),
    w.spawn(Transform({rz: 1e300}), RigidBody()),
    w.spawn(Transform({z: 2000}), Collider()),
    w.spawn(Transform({x: Number.POSITIVE_INFINITY}), PhysicsCharacter()),
  ];
  const k = w.spawn(Transform({x: 1}), RigidBody({kind: 'kinematic'}), Collider());
  const d = w.spawn(Transform({x: 5, y: 2}), RigidBody(), Collider());
  pw.tick(w);
  for (const e of bad) assert.equal(pw.handles(e), null);
  const s = pw.status();
  assert.equal(s.refused['invalid-body'], 3);
  assert.equal(s.refused['invalid-collider'], 1);
  assert.equal(s.refused['invalid-character'], 1);
  const tr = w.get(k, Transform)!;
  tr.x = Number.NaN;
  pw.tick(w);
  tr.x = 1e300;
  pw.tick(w);
  assert.equal(pw.status().skippedPoses, 2, 'each skipped kinematic target is counted');
  const hit = pw.raycast({x: 1, y: 10, z: 0}, {x: 0, y: -1, z: 0}, 20);
  assert.equal(hit.status === 'ok' && hit.hits[0]?.entity, k, 'the body keeps its last valid target');
  assert.equal(pw.teleport(d, {x: 1e300, y: 0, z: 0}), false);
  assert.equal(pw.teleport(d, {x: 0, y: Number.NaN, z: 0}), false);
  assert.equal(pw.teleport(d, {x: 0, y: 2, z: 0, ry: 5000}), false);
  assert.equal(pw.teleport(d, {x: 0, y: 2, z: 0}), true);
  pw.tick(w);
  const dt = w.get(d, Transform)!;
  assert.ok([dt.x, dt.y, dt.z, dt.rx, dt.ry, dt.rz].every(Number.isFinite), 'no NaN is written back');
  assert.equal(pw.raycast({x: 1e300, y: 0, z: 0}, {x: 0, y: -1, z: 0}, 1).status, 'invalid');
  assert.equal(pw.overlap({shape: 'ball', radius: 1}, {x: 0, y: 0, z: 5000}).status, 'invalid');
  assert.throws(() => physicsConfig({limits: {maxCoordinate: 0}}), RangeError);
  assert.equal(physicsConfig().limits.maxCoordinate, 1_000_000);
  pw.dispose();
});

test('queries: past maxHits, raycastAll keeps the nearest and overlap the lowest entity ids, whatever the library order', async () => {
  const rapier = await ready();
  const pw = createPhysicsWorld(rapier, {limits: {maxQueryHits: 3}});
  const w = new World();
  const boxes: number[] = [];
  for (let i = 0; i < 40; i++) boxes.push(w.spawn(Transform({y: 100 - i * 2}), Collider({hx: 0.4, hy: 0.4, hz: 0.4})));
  assert.deepEqual(boxes.slice(0, 3), [1, 2, 3]);
  pw.tick(w);
  const ray = pw.raycastAll({x: 0, y: 200, z: 0}, {x: 0, y: -1, z: 0}, 1000, {maxHits: 3});
  assert.equal(ray.status, 'ok');
  if (ray.status === 'ok') {
    assert.deepEqual(
      ray.hits.map(h => h.entity),
      [1, 2, 3],
    );
    assert.equal(ray.truncated, true);
  }
  const all = pw.overlap({shape: 'cuboid', hx: 1, hy: 60, hz: 1}, {x: 0, y: 50, z: 0}, {maxHits: 3});
  assert.deepEqual(all.status === 'ok' && all.hits, [1, 2, 3]);
  assert.equal(all.status === 'ok' && all.truncated, true);
  const few = pw.overlap({shape: 'ball', radius: 0.5}, {x: 0, y: 98, z: 0});
  assert.deepEqual(few.status === 'ok' && [few.hits, few.truncated], [[2], false]);
  pw.dispose();
});

test('scene: exit removes the visit abort listener', async () => {
  await ready();
  const physics = scenePhysics();
  const world = new World();
  const controller = new AbortController();
  let listeners = 0;
  const signal = controller.signal;
  const add = signal.addEventListener.bind(signal),
    remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = ((...a: Parameters<typeof add>) => (listeners++, add(...a))) as typeof add;
  signal.removeEventListener = ((...a: Parameters<typeof remove>) => (listeners--, remove(...a))) as typeof remove;
  assert.ok(physics.of({world, view: {signal}} as never));
  assert.equal(listeners, 1);
  physics.exit({world});
  assert.equal(listeners, 0);
});
