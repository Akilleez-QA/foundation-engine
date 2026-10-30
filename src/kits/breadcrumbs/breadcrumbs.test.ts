import test from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, defineSystem, Name, testScene, Transform} from '../../author';
import {breadcrumbs, createBreadcrumbTrail, nextFollowerLag, type Crumb} from './index';

const crumb = (x: number, z = 0, flags = 0, heading = 0): Crumb => ({x, y: 0, z, heading, flags});

test('every-tick trails give the leader state exactly N ticks ago, clamped to the oldest crumb', () => {
  const trail = createBreadcrumbTrail({capacity: 8, record: {mode: 'every-tick'}});
  assert.equal(trail.behind(0), null);
  for (let i = 0; i < 5; i++) assert.equal(trail.record(crumb(i, 0, i)), 'recorded');
  assert.deepEqual(trail.behind(0), crumb(4, 0, 4));
  assert.deepEqual(trail.behind(3), crumb(1, 0, 1));
  assert.deepEqual(trail.behind(99), crumb(0, 0, 0), 'clamped to the oldest');
  for (let i = 5; i < 20; i++) trail.record(crumb(i));
  assert.equal(trail.size, 8, 'bounded ring');
  assert.deepEqual(trail.behind(7), crumb(12));
  assert.deepEqual(trail.behind(8), crumb(12));
});

test('moved trails skip until the leader has moved, so followers wait while it stands still', () => {
  const trail = createBreadcrumbTrail({capacity: 16, record: {mode: 'moved', minDistance: 0.5}});
  assert.equal(trail.record(crumb(0)), 'recorded', 'the first crumb always records');
  assert.equal(trail.record(crumb(0.2)), 'skipped');
  assert.equal(trail.record(crumb(0.49)), 'skipped');
  assert.equal(trail.record(crumb(0.5)), 'recorded', 'distance is measured from the last recorded crumb');
  assert.equal(trail.size, 2);
});

test('distance lookups retrace the exact path, corners included', () => {
  const trail = createBreadcrumbTrail({capacity: 32, record: {mode: 'every-tick'}});
  // An L-shaped path: east 4 units, then north 3 units. Newest is at (4, 3).
  for (let x = 0; x <= 4; x++) trail.record(crumb(x, 0, 1, Math.PI / 2));
  for (let z = 1; z <= 3; z++) trail.record(crumb(4, z, 2, 0));
  const p = (d: number) => {
    const c = trail.along(d)!;
    return [c.x, c.z];
  };
  assert.deepEqual(p(0), [4, 3]);
  assert.deepEqual(p(1.5), [4, 1.5]);
  assert.deepEqual(p(3), [4, 0], 'the corner itself');
  assert.deepEqual(p(4.25), [2.75, 0], 'continues around the corner, never cuts it');
  assert.deepEqual(p(100), [0, 0], 'clamped to the oldest crumb');
  assert.equal(trail.along(4.25)!.flags, 1, 'flags from the older crumb of the pair');
  // A spaced train: followers 1.5 apart all lie on the recorded polyline.
  for (let k = 1; k <= 4; k++) {
    const [x = NaN, z = NaN] = p(1.5 * k);
    assert.ok((x === 4 && z >= 0 && z <= 3) || (z === 0 && x >= 0 && x <= 4), `${x},${z}`);
  }
});

test('cuts stop followers from sliding across a teleport', () => {
  const trail = createBreadcrumbTrail({capacity: 16, record: {mode: 'every-tick'}});
  for (let x = 0; x < 5; x++) trail.record(crumb(x));
  trail.cut();
  assert.equal(trail.segment, 0);
  assert.equal(trail.behind(0), null);
  trail.record(crumb(100));
  trail.record(crumb(101));
  assert.deepEqual(trail.behind(10), crumb(100), 'never reaches back before the cut');
  assert.deepEqual(trail.along(50)!.x, 100);
  assert.equal(trail.size, 7, 'older crumbs are kept but unreachable');
});

test('snapshots restore an identical trail and are validated', () => {
  const options = {capacity: 4, record: {mode: 'every-tick'} as const};
  const trail = createBreadcrumbTrail(options);
  for (let i = 0; i < 6; i++) trail.record(crumb(i, i, i));
  trail.cut();
  trail.record(crumb(9));
  const snap = JSON.parse(JSON.stringify(trail.snapshot()));
  const copy = createBreadcrumbTrail(options, snap);
  assert.deepEqual(copy.snapshot(), trail.snapshot());
  assert.deepEqual(copy.behind(3), trail.behind(3));
  copy.record(crumb(10));
  trail.record(crumb(10));
  assert.deepEqual(copy.snapshot(), trail.snapshot());
  for (const bad of [
    {...snap, v: 2},
    {...snap, capacity: 5},
    {...snap, segment: 9},
    {...snap, crumbs: [...snap.crumbs, crumb(1), crumb(2)]},
    {...snap, crumbs: [{x: NaN, y: 0, z: 0, heading: 0, flags: 0}]},
  ])
    assert.throws(() => createBreadcrumbTrail(options, bad), RangeError);
});

test('inputs are validated', () => {
  for (const capacity of [1, 65537, 2.5])
    assert.throws(() => createBreadcrumbTrail({capacity, record: {mode: 'every-tick'}}));
  assert.throws(() => createBreadcrumbTrail({capacity: 4, record: {mode: 'moved', minDistance: 0}}), RangeError);
  assert.throws(() => createBreadcrumbTrail({capacity: 4, record: {mode: 'sometimes'} as never}), RangeError);
  const trail = createBreadcrumbTrail({capacity: 4, record: {mode: 'every-tick'}});
  assert.throws(() => trail.record({...crumb(0), flags: -1}), RangeError);
  assert.throws(() => trail.record({...crumb(0), y: Infinity}), RangeError);
  assert.throws(() => trail.behind(-1), RangeError);
  assert.throws(() => trail.along(-1), RangeError);
  const before = trail.revision;
  assert.throws(() => trail.record(null as never));
  assert.equal(trail.revision, before, 'a refused record changes nothing');
  assert.equal(breadcrumbs().id, 'breadcrumbs');
});

test('the follower lag controller waits, keeps pace and catches up when the leader stops', () => {
  const o = {movingLag: 15, idleLag: 9, catchUpEvery: 4};
  let lag = 0;
  for (let tick = 0; tick < 20; tick++) lag = nextFollowerLag(lag, {...o, recorded: true, tick});
  assert.equal(lag, 15, 'grows to the moving lag, then holds while the leader moves');
  const seen: number[] = [];
  for (let tick = 20; tick < 48; tick++) seen.push((lag = nextFollowerLag(lag, {...o, recorded: false, tick})));
  assert.equal(lag, 9, 'closes in to the idle lag');
  assert.equal(seen.filter((v, i) => i > 0 && v !== seen[i - 1]).length + (seen[0] !== 15 ? 1 : 0), 6);
  assert.throws(() => nextFollowerLag(0, {...o, idleLag: 20, recorded: true, tick: 0}), RangeError);
});

test('composition: a follower entity retraces the leader through a fixed-step scene', async () => {
  const trail = createBreadcrumbTrail({capacity: 64, record: {mode: 'moved', minDistance: 0.25}});
  const path: [number, number][] = [];
  const scene = defineScene({
    id: 'train',
    title: 'Train',
    entities: [
      [Name({name: 'leader'}), Transform()],
      [Name({name: 'follower'}), Transform()],
    ],
    systems: [
      defineSystem({
        id: 'leader-walk',
        run(ctx) {
          const tr = ctx.world.get(ctx.named('leader')!, Transform)!;
          if (ctx.time.frame < 40) tr.x += 0.1;
          else tr.z += 0.1;
          path.push([tr.x, tr.z]);
          trail.record({x: tr.x, y: tr.y, z: tr.z, heading: tr.ry});
        },
      }),
      defineSystem({
        id: 'follower-retrace',
        run(ctx) {
          const at = trail.along(2);
          if (!at) return;
          const tr = ctx.world.get(ctx.named('follower')!, Transform)!;
          tr.x = at.x;
          tr.z = at.z;
        },
      }),
    ],
  });
  const t = await testScene(scene);
  t.run(1.5);
  const f = t.world.get(t.ctx.named('follower')!, Transform)!;
  // The leader turned north at x ≈ 4; the follower is on that corner path, not on the diagonal shortcut.
  // The follower lies on the recorded polyline (it retraces, never takes the diagonal shortcut).
  const crumbs = trail.snapshot().crumbs;
  const onPath = crumbs.slice(1).some((b, i) => {
    const a = crumbs[i]!;
    const cross = (b.x - a.x) * (f.z - a.z) - (b.z - a.z) * (f.x - a.x);
    const dot = (f.x - a.x) * (b.x - a.x) + (f.z - a.z) * (b.z - a.z);
    const len2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
    return Math.abs(cross) < 1e-9 && dot >= -1e-9 && dot <= len2 + 1e-9;
  });
  assert.ok(onPath, `${f.x},${f.z}`);
  assert.ok(f.z > 0.5 && f.x > 3, `around the corner: ${f.x},${f.z}`);
  const l = t.world.get(t.ctx.named('leader')!, Transform)!;
  // The leader can be up to minDistance ahead of its newest crumb.
  assert.ok(Math.hypot(l.x - f.x, l.z - f.z) <= 2 + 0.25 + 1e-9);
});

test('review regressions: stationary crumbs, sparse or hostile snapshots, revision ceiling, over-long lag', () => {
  const trail = createBreadcrumbTrail({capacity: 8, record: {mode: 'every-tick'}});
  trail.record(crumb(0, 0, 1, 0));
  trail.record(crumb(1, 0, 2, 0.5));
  trail.record(crumb(1, 0, 3, 1.0));
  trail.record(crumb(1, 0, 4, 1.5));
  assert.deepEqual(trail.along(0), trail.behind(0), 'distance 0 is the newest crumb, facing and flags included');
  assert.equal(trail.along(0.5)!.x, 0.5);
  const options = {capacity: 4, record: {mode: 'every-tick'} as const};
  // eslint-disable-next-line no-sparse-arrays
  const sparse = {v: 1, capacity: 4, crumbs: [crumb(0), , crumb(2)], segment: 3, revision: 3};
  assert.throws(() => createBreadcrumbTrail(options, sparse as never), RangeError);
  let reads = 0;
  const growing = new Proxy([crumb(0), crumb(1)], {
    get(target, key, receiver) {
      if (key === 'length') return reads++ === 0 ? 2 : 6;
      return Reflect.get(target, key, receiver);
    },
  });
  const restored = createBreadcrumbTrail(options, {v: 1, capacity: 4, crumbs: growing, segment: 2, revision: 2});
  assert.ok(restored.size <= 4);
  assert.throws(
    () =>
      createBreadcrumbTrail(options, {v: 1, capacity: 4, crumbs: [], segment: 0, revision: Number.MAX_SAFE_INTEGER}),
    RangeError,
  );
  assert.equal(nextFollowerLag(30, {recorded: true, movingLag: 15, idleLag: 9, catchUpEvery: 4, tick: 0}), 29);
});
