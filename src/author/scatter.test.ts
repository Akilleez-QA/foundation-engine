import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {defineScatter, sceneScatter, Scatter, SCATTER_DEFAULTS, scatterRoot, type ScatterData} from './scatter';
import {createScatterAdmission, placeScatter} from './scatter-field';
import {defineMesh} from './mesh';

const grass = (o: Partial<ScatterData> = {}) =>
  defineScatter({
    shape: {kind: 'cone', size: [0.12, 0.45, 0.12]},
    area: {kind: 'edge', rect: [-11, -11, 11, 11], width: 2.2},
    count: 1400,
    seed: 3,
    scale: [0.6, 1.5],
    ry: 'random',
    tilt: 0.25,
    ...o,
  }).value;
const positions = (p: {matrices: Float32Array; count: number}): [number, number, number][] =>
  Array.from({length: p.count}, (_, i) => [
    p.matrices[i * 16 + 12]!,
    p.matrices[i * 16 + 13]!,
    p.matrices[i * 16 + 14]!,
  ]);

test('defineScatter fills defaults, copies arrays and names the bad field', () => {
  const points: [number, number][] = [[1, 2]];
  const init = defineScatter({shape: {kind: 'box', size: [1, 1, 1]}, points});
  assert.equal(init.type, Scatter);
  assert.deepEqual(init.value.points, [[1, 2]]);
  points[0]![0] = 9;
  assert.deepEqual(init.value.points, [[1, 2]], 'copied');
  assert.equal(init.value.color, SCATTER_DEFAULTS.color);
  const bad: [Partial<ScatterData>, RegExp][] = [
    [{}, /exactly one of shape and mesh/],
    [{shape: {kind: 'box', size: [1, 1, 1]}}, /points, or an area/],
    [{shape: {kind: 'torus' as 'box', size: [1, 1, 1]}, points: [[0, 0]]}, /shape.kind/],
    [{shape: {kind: 'box', size: [1, 1, 1]}, area: {kind: 'rect', rect: [0, 0, 1, 1]}, count: 0}, /count/],
    [{shape: {kind: 'box', size: [1, 1, 1]}, area: {kind: 'rect', rect: [0, 0, 1, 1]}, count: 70_000}, /count/],
    [{shape: {kind: 'box', size: [1, 1, 1]}, area: {kind: 'rect', rect: [1, 0, 0, 1]}, count: 1}, /area.rect/],
    [{shape: {kind: 'box', size: [1, 1, 1]}, area: {kind: 'ring', radius: [2, 1]}, count: 1}, /area.radius/],
    [{shape: {kind: 'box', size: [1, 1, 1]}, area: {kind: 'edge', rect: [0, 0, 4, 4], width: 3}, count: 1}, /width/],
    [{shape: {kind: 'box', size: [1, 1, 1]}, points: [[0, 0]], scale: [2, 1]}, /scale/],
    [{shape: {kind: 'box', size: [1, 1, 1]}, points: [[0, 0]], tilt: 2}, /tilt/],
    [{shape: {kind: 'box', size: [1, 1, 1]}, points: [[0, 0]], colorJitter: [0, 2, 0]}, /colorJitter/],
    [{shape: {kind: 'box', size: [1, 1, 1]}, points: [[0, 0]], ry: NaN}, /ry/],
  ];
  for (const [input, message] of bad) assert.throws(() => defineScatter(input), message, JSON.stringify(input));
  assert.throws(() => sceneScatter({max: 0}), /max/);
  assert.throws(() => sceneScatter({instances: 1e9}), /instances/);
  assert.deepEqual(sceneScatter().limits, {max: 32, instances: 65_536});
});

test('placement is a pure function of the data, the scene and the run seed', () => {
  const root = scatterRoot('courtyard', null);
  const a = placeScatter(grass(), root, 1),
    b = placeScatter(grass(), root, 1);
  assert.equal(a.count, 1400);
  assert.deepEqual(a.matrices, b.matrices, 'same input, same layout');
  assert.notDeepEqual(placeScatter(grass({seed: 4}), root, 1).matrices, a.matrices, 'another seed, another layout');
  assert.notDeepEqual(placeScatter(grass(), scatterRoot('garden', null), 1).matrices, a.matrices, 'another scene');
  assert.notDeepEqual(placeScatter(grass(), scatterRoot('courtyard', 7), 1).matrices, a.matrices, '?seed= moves it');
  assert.deepEqual(
    placeScatter(grass(), scatterRoot('courtyard', 7), 1).matrices,
    placeScatter(grass(), scatterRoot('courtyard', 7), 1).matrices,
  );
});

test('areas put copies where they say', () => {
  const root = scatterRoot('s', null);
  for (const [x, , z] of positions(placeScatter(grass(), root, 1))) {
    assert.ok(x >= -11 && x <= 11 && z >= -11 && z <= 11, 'inside the rect');
    assert.ok(Math.abs(x) >= 11 - 2.2 - 1e-6 || Math.abs(z) >= 11 - 2.2 - 1e-6, `in the edge band (${x}, ${z})`);
  }
  const ring = placeScatter(grass({area: {kind: 'ring', radius: [3, 5]}, count: 500}), root, 1);
  for (const [x, , z] of positions(ring)) assert.ok(Math.hypot(x, z) >= 3 - 1e-6 && Math.hypot(x, z) <= 5 + 1e-6);
  const rect = placeScatter(grass({area: {kind: 'rect', rect: [1, 2, 3, 4]}, count: 500, y: 0.5}), root, 1);
  for (const [x, y, z] of positions(rect)) assert.ok(x >= 1 && x <= 3 && z >= 2 && z <= 4 && y === 0.5);
  const sides = new Set(
    positions(placeScatter(grass({count: 400}), root, 1)).map(([x, , z]) =>
      Math.abs(x) > Math.abs(z) ? (x > 0 ? 'e' : 'w') : z > 0 ? 's' : 'n',
    ),
  );
  assert.equal(sides.size, 4, 'all four walls get copies');
  const lanterns = placeScatter(
    defineScatter({
      shape: {kind: 'box', size: [1, 1, 1]},
      points: [
        [-9, -9],
        [9, 9],
      ],
      scale: [2, 2],
    }).value,
    root,
    1,
  );
  assert.deepEqual(positions(lanterns), [
    [-9, 0, -9],
    [9, 0, 9],
  ]);
  const m = new T.Matrix4().fromArray(lanterns.matrices),
    s = new T.Vector3();
  m.decompose(new T.Vector3(), new T.Quaternion(), s);
  assert.ok(Math.abs(s.x - 2) < 1e-6, 'scale applied');
});

test('density keeps a deterministic, nested subset; essential scatters are never thinned', () => {
  const root = scatterRoot('s', null);
  const full = placeScatter(grass(), root, 1),
    medium = placeScatter(grass(), root, 0.6),
    low = placeScatter(grass(), root, 0.35);
  assert.ok(medium.count < full.count && low.count < medium.count);
  assert.ok(Math.abs(medium.count / full.count - 0.6) < 0.06, `about 60% kept (${medium.count})`);
  const key = (p: number[]) => p.map(v => v.toFixed(5)).join(',');
  const fullSet = new Set(positions(full).map(key)),
    mediumSet = new Set(positions(medium).map(key));
  assert.ok(
    positions(medium).every(p => fullSet.has(key(p))),
    'medium copies sit exactly where the full layout has them',
  );
  assert.ok(
    positions(low).every(p => mediumSet.has(key(p))),
    'low is a subset of medium',
  );
  assert.equal(placeScatter(grass({essential: true}), root, 0.35).count, 1400);
});

test('colour jitter gives each copy its own colour around the base; none without it', () => {
  const root = scatterRoot('s', null);
  assert.equal(placeScatter(grass(), root, 1).colors, null);
  const p = placeScatter(grass({color: 0x2f5a2c, colorJitter: [0.03, 0.1, 0.08], count: 200}), root, 1);
  assert.equal(p.colors!.length, 600);
  const base = new T.Color().setHex(0x2f5a2c);
  let differs = 0;
  for (let i = 0; i < 200; i++) {
    const c = new T.Color(p.colors![i * 3]!, p.colors![i * 3 + 1]!, p.colors![i * 3 + 2]!);
    if (!c.equals(base)) differs++;
    assert.ok(Math.abs(c.g - base.g) < 0.2, 'close to the base');
  }
  assert.ok(differs > 190);
  const thinned = placeScatter(grass({colorJitter: [0.1, 0, 0]}), root, 0.5);
  assert.equal(thinned.colors!.length, thinned.count * 3);
});

test('a mesh scatter validates its mesh', () => {
  const rock = defineMesh({positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2]}).value;
  assert.doesNotThrow(() => defineScatter({mesh: rock, points: [[0, 0]]}));
  assert.throws(() => defineScatter({mesh: {...rock, indices: [0, 1, 9]}, points: [[0, 0]]}), /mesh: index/);
});

test('admission bounds scatters and copies; refusals are counted and reported once per cause', () => {
  const reports: string[] = [];
  const a = createScatterAdmission<number>({max: 2, instances: 1000}, e => reports.push(e.message));
  assert.equal(a.admit(1, 600, 600), true);
  assert.equal(a.admit(2, 600, 600), false, 'copies over the scene bound');
  assert.equal(a.admit(2, 300, 300), true);
  assert.equal(a.admit(3, 10, 10), false, 'too many scatters');
  assert.equal(a.admit(4, 10, 10), false);
  assert.deepEqual(a.stats.refused, {scatters: 2, instances: 1, invalid: 0});
  assert.equal(reports.length, 2, 'one report per cause');
  assert.match(reports[0]!, /sceneScatter\(\{ instances \}\)/);
  assert.deepEqual([a.stats.scatters, a.stats.instances], [2, 900]);
  assert.equal(a.admit(1, 700, 700), true, 're-admitting with new numbers counts its own copies once');
  assert.equal(a.admit(1, 800, 800), false, 'a grown scatter that no longer fits is released');
  assert.equal(a.has(1), false);
  assert.equal(a.release(2), true);
  assert.deepEqual([a.stats.scatters, a.stats.instances], [0, 0]);
});
