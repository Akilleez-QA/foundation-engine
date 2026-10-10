import test from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, defineSystem, Name, testScene, Transform} from '../../author';
import {createMediumTracker, createMediumVolumes, media, mediumAcceleration, type VolumeInput} from './index';

const pool = (over: Partial<VolumeInput> = {}): VolumeInput => ({
  minX: 0,
  maxX: 10,
  minZ: 0,
  maxZ: 10,
  floor: -3,
  surface: 0,
  kind: 'water',
  ...over,
});
const at = (x: number, y: number, z = 5, height = 1.8) => ({x, y, z, height});

test('probes report the winning volume, depth and submerged fraction', () => {
  const v = createMediumVolumes({maxVolumes: 4});
  v.set(1, pool());
  const p = v.probe(at(5, -0.9));
  assert.equal(p.volume?.id, 1);
  assert.equal(p.depth, 0.9);
  assert.ok(Math.abs(p.submerged - 0.5) < 1e-12);
  assert.equal(v.probe(at(5, 0.1)).volume, null, 'feet above the surface');
  assert.equal(v.probe(at(5, -5)).volume, null, 'below the floor');
  assert.equal(v.probe(at(10, -1)).volume, null, 'max edge is exclusive');
  assert.equal(v.probe(at(0, -1)).volume?.id, 1, 'min edge is inclusive');
  // Flush neighbours leave no seam; overlaps resolve by priority, then surface, then id.
  v.set(2, pool({minX: 10, maxX: 20}));
  assert.equal(v.probe(at(10, -1)).volume?.id, 2);
  v.set(3, pool({surface: 0.5, priority: 0}));
  assert.equal(v.probe(at(5, -1)).volume?.id, 3, 'higher surface wins a priority tie');
  v.set(4, pool({kind: 'mud', priority: 1, surface: -0.5}));
  assert.equal(v.probe(at(5, -1)).volume?.kind, 'mud', 'priority wins');
  v.set(4, pool({kind: 'mud', priority: 1, surface: -0.5, enabled: false}));
  assert.equal(v.probe(at(5, -1)).volume?.id, 3, 'disabled volumes are ignored');
});

test('the tracker moves through dry, wade, swim and under with hysteresis and events', () => {
  const v = createMediumVolumes({maxVolumes: 2});
  v.set(7, pool());
  const t = createMediumTracker(v, {maxActors: 4, wadeDepth: 0.4, swimDepth: 1.2, hysteresis: 0.1});
  const step = (y: number) => t.update(1, at(5, y));
  assert.deepEqual(step(0.5).events, []);
  const shallow = step(-0.45);
  assert.equal(shallow.state, 'dry', 'needs wadeDepth + hysteresis to start wading');
  assert.deepEqual(
    shallow.events,
    [{kind: 'enter', actor: 1, volume: 7}],
    'entering the volume is separate from wading',
  );
  const wade = step(-0.55);
  assert.equal(wade.state, 'wade');
  assert.deepEqual(wade.events, [{kind: 'state', actor: 1, from: 'dry', to: 'wade'}]);
  assert.equal(step(-0.35).state, 'wade', 'stays wading inside the band');
  assert.equal(step(-1.25).state, 'wade');
  assert.equal(step(-1.35).state, 'swim');
  assert.equal(step(-1.15).state, 'swim', 'stays swimming inside the band');
  assert.equal(step(-2).state, 'under', 'whole body below the surface');
  assert.equal(step(-1.05).state, 'wade', 'surfacing below swimDepth - hysteresis drops to wading');
  const out = step(1);
  assert.deepEqual(out.events, [
    {kind: 'exit', actor: 1, volume: 7},
    {kind: 'state', actor: 1, from: 'wade', to: 'dry'},
  ]);
  // A deep entry jumps straight to the deepest qualifying state.
  assert.equal(t.update(2, at(5, -1.5)).state, 'swim');
});

test('moving between volumes reports exit then enter; removal reports the exit', () => {
  const v = createMediumVolumes({maxVolumes: 2});
  v.set(1, pool({maxX: 5}));
  v.set(2, pool({minX: 5, kind: 'lava'}));
  const t = createMediumTracker(v, {maxActors: 2, wadeDepth: 0.3, swimDepth: 1});
  t.update(9, at(4, -0.5));
  assert.deepEqual(
    t.update(9, at(6, -0.5)).events.map(e => e.kind + (e.kind !== 'state' ? e.volume : '')),
    ['exit1', 'enter2'],
  );
  assert.deepEqual(t.remove(9), [{kind: 'exit', actor: 9, volume: 2}]);
  assert.equal(t.state(9), 'dry');
});

test('accelerations: buoyancy, drag and current', () => {
  const v = createMediumVolumes({maxVolumes: 1});
  v.set(1, pool({density: 1.2, drag: 2, current: [1, 0, 0]}));
  const probe = v.probe(at(5, -2)); // fully submerged
  const a = mediumAcceleration({probe, velocity: [0, -1, 0], gravity: 9.81});
  assert.ok(Math.abs(a[1] - (9.81 * 1.2 + 2)) < 1e-12, 'buoyancy plus drag against the fall');
  assert.equal(a[0], 2, 'drag pulls toward the current velocity');
  const half = v.probe(at(5, -0.9));
  assert.ok(
    Math.abs(mediumAcceleration({probe: half, velocity: [0, 0, 0], gravity: 9.81})[1] - 9.81 * 1.2 * 0.5) < 1e-12,
  );
  assert.deepEqual(mediumAcceleration({probe: v.probe(at(50, 0)), velocity: [3, 3, 3], gravity: 9.81}), [0, 0, 0]);
});

test('snapshots restore tracker state; inputs are validated', () => {
  const v = createMediumVolumes({maxVolumes: 1});
  v.set(1, pool());
  const t = createMediumTracker(v, {maxActors: 2, wadeDepth: 0.4, swimDepth: 1.2});
  t.update(1, at(5, -1.5));
  const u = createMediumTracker(v, {maxActors: 2, wadeDepth: 0.4, swimDepth: 1.2});
  u.restore(JSON.parse(JSON.stringify(t.snapshot())));
  assert.deepEqual(u.update(1, at(5, -1.3)), t.update(1, at(5, -1.3)));
  assert.throws(() => u.restore({v: 1, actors: [{actor: 1, state: 'swim', volume: null}]}), RangeError);
  assert.throws(() => v.set(2, pool()), RangeError, 'capacity');
  for (const bad of [{surface: -5}, {maxX: 0}, {kind: ''}, {drag: -1}, {current: [0, 0] as never}, {priority: 1.5}])
    assert.throws(() => createMediumVolumes({maxVolumes: 1}).set(1, pool(bad)), RangeError);
  for (const bad of [
    {wadeDepth: 1, swimDepth: 1},
    {wadeDepth: 0, swimDepth: 1},
    {wadeDepth: 0.4, swimDepth: 1.2, hysteresis: 0.5},
  ])
    assert.throws(() => createMediumTracker(v, {maxActors: 1, ...bad}), RangeError);
  assert.throws(() => t.update(5, {x: 0, y: 0, z: 0, height: 0}), RangeError);
  assert.equal(media().id, 'media');
});

test('composition: a fixed-step body floats in water and is carried by the current', async () => {
  const volumes = createMediumVolumes({maxVolumes: 1});
  volumes.set(
    1,
    pool({minX: -50, maxX: 50, minZ: -50, maxZ: 50, floor: -10, density: 1.1, drag: 1.5, current: [0.5, 0, 0]}),
  );
  const tracker = createMediumTracker(volumes, {maxActors: 1, wadeDepth: 0.4, swimDepth: 1.2});
  const velocity = [0, 0, 0];
  const states: string[] = [];
  const g = 9.81,
    dt = 1 / 60;
  const scene = defineScene({
    id: 'float',
    title: 'Float',
    entities: [[Name({name: 'swimmer'}), Transform({y: 2})]],
    systems: [
      defineSystem({
        id: 'body',
        run(ctx) {
          const tr = ctx.world.get(ctx.named('swimmer')!, Transform)!;
          const r = tracker.update(0, {x: tr.x, y: tr.y, z: tr.z, height: 1.8});
          states.push(r.state);
          const a = mediumAcceleration({probe: r.probe, velocity: velocity as never, gravity: g});
          velocity[0]! += a[0] * dt;
          velocity[1]! += (a[1] - g) * dt;
          velocity[2]! += a[2] * dt;
          tr.x += velocity[0]! * dt;
          tr.y += velocity[1]! * dt;
          tr.z += velocity[2]! * dt;
        },
      }),
    ],
  });
  const t = await testScene(scene);
  t.run(20);
  const tr = t.world.get(t.ctx.named('swimmer')!, Transform)!;
  // Density 1.1 floats with about 1/1.1 of the body submerged: feet near -1.636.
  assert.ok(Math.abs(tr.y - -1.8 / 1.1) < 0.05, String(tr.y));
  assert.ok(tr.x > 5, 'carried downstream by the current');
  assert.ok(states.includes('swim') && states[0] === 'dry');
});
