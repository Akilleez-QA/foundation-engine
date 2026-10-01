import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurface, type SurfaceOptions } from './surface';
const options: SurfaceOptions = { id: 'test', revision: 1, originX: 0, originZ: 0, spacing: 1, cellsX: 2, cellsZ: 2, seed: 42, baseHeight: 3 };
const near = (a: number, b: number, epsilon = 1e-8): void => { assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`); };

test('flat surface queries include every outer edge and reject outside/invalid points', () => {
  const surface = createSurface(options);
  for (const [x, z] of [[0, 0], [2, 0], [0, 2], [2, 2], [0.5, 1.6]]) {
    assert.deepEqual(surface.sample(x!, z!), { height: 3, normal: { x: -0, y: 1, z: -0 }, material: 0, excluded: false });
  }
  for (const [x, z] of [[-Number.EPSILON, 0], [2.001, 1], [1, 2.001]]) assert.equal(surface.sample(x!, z!), null);
  assert.throws(() => surface.sample(NaN, 0));
});

test('independent triangle plane interpolation matches both mesh halves and normals', () => {
  const surface = createSurface({ ...options, cellsX: 1, cellsZ: 1, baseHeight: 0, layers: [{ kind: 'radial', x: 0, z: 0, radius: 1, height: 4 }] });
  // Corners are 4,0,0,0. Diagonal is between (1,0) and (0,1), NOT (0,0) and (1,1).
  near(surface.sample(0.2, 0.3)!.height, 2);
  near(surface.sample(0.8, 0.7)!.height, 0);
  near(surface.sample(0.5, 0.5)!.height, 0);
  const normal = surface.sample(0.2, 0.3)!.normal;
  near(normal.x, 4 / Math.sqrt(33)); near(normal.y, 1 / Math.sqrt(33)); near(normal.z, 4 / Math.sqrt(33));
  assert.deepEqual(surface.mesh().indices, [0, 2, 1, 1, 2, 3]);
  assert.deepEqual(surface.mesh().positions, [0, 4, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]);
});

test('ordered feathered pads flatten, blend, and provide surface metadata', () => {
  const surface = createSurface({ ...options, cellsX: 4, cellsZ: 4, baseHeight: 0, pads: [
    { x: 2, z: 2, radius: 0.5, feather: 1, height: 10, material: 4, excluded: true },
    { x: 2, z: 2, radius: 0.1, height: 7, material: 5, excluded: false },
  ] });
  assert.equal(surface.sample(2, 2)!.height, 7); assert.equal(surface.sample(2, 2)!.material, 5); assert.equal(surface.sample(2, 2)!.excluded, false);
  assert.equal(surface.sample(1, 2)!.height, 5); assert.equal(surface.sample(1, 2)!.excluded, true);
  assert.equal(surface.sample(0, 2)!.height, 0);
});

test('global-coordinate noise produces identical adjacent chunk edges and repeatable snapshots', () => {
  const layers = [{ kind: 'noise' as const, amplitude: 5, frequency: 0.17 }, { kind: 'radial' as const, x: 2, z: 2, radius: 2, height: -3 }];
  const a = createSurface({ ...options, layers }), b = createSurface({ ...options, originX: 2, layers });
  for (const z of [0, 0.25, 0.5, 1, 1.8, 2]) near(a.sample(2, z)!.height, b.sample(2, z)!.height);
  assert.deepEqual(a.mesh(), createSurface({ ...options, layers }).mesh());
  assert.notDeepEqual(a.mesh(), createSurface({ ...options, layers, seed: 43 }).mesh());
});

test('input and returned meshes cannot mutate the snapshot', () => {
  const layers = [{ kind: 'radial' as const, x: 0, z: 0, radius: 1, height: 4 }];
  const o = { ...options, layers }, surface = createSurface(o), before = surface.mesh();
  o.baseHeight = 100; layers[0]!.height = 900;
  const mesh = surface.mesh(); mesh.positions.fill(777); mesh.indices.fill(0);
  assert.deepEqual(surface.mesh(), before); assert.equal(surface.sample(0, 0)!.height, 7);
  assert.ok(Object.isFrozen(surface)); assert.ok(Object.isFrozen(surface.sample(0, 0)!.normal));
});

test('invalid and unrepresentable configurations fail explicitly', () => {
  for (const patch of [{ spacing: 0 }, { cellsX: 257 }, { cellsZ: 0 }, { cellsX: 1.5 }, { seed: -1 }, { revision: NaN }, { baseHeight: 1e40 }, { originX: Infinity }, { originX: 1e20 }, { id: '' }]) assert.throws(() => createSurface({ ...options, ...patch }));
  assert.throws(() => createSurface({ ...options, layers: [{ kind: 'noise', frequency: Infinity, amplitude: 1 }] }));
  assert.throws(() => createSurface({ ...options, layers: [{ kind: 'radial', x: 0, z: 0, radius: -1, height: 1 }] }));
  assert.throws(() => createSurface({ ...options, pads: [{ x: 0, z: 0, radius: 1, height: 1, feather: -1 }] }));
});

test('raycast normalizes directions, uses raised terrain, and respects distance and bounds', () => {
  const surface = createSurface({ ...options, baseHeight: 5 });
  const hit = surface.raycast({ x: 1, y: 12, z: 1 }, { x: 0, y: -9, z: 0 })!;
  assert.deepEqual(hit, { x: 1, y: 5, z: 1, distance: 7 });
  assert.equal(surface.raycast({ x: 1, y: 12, z: 1 }, { x: 0, y: -1, z: 0 }, 6), null);
  assert.equal(surface.raycast({ x: 3, y: 12, z: 1 }, { x: 0, y: -1, z: 0 }), null);
  const oblique = surface.raycast({ x: -1, y: 7, z: 1 }, { x: 1, y: -1, z: 0 })!;
  near(oblique.x, 1); near(oblique.y, 5); near(oblique.distance, Math.sqrt(8));
  assert.throws(() => surface.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }));
  assert.throws(() => surface.raycast({ x: Infinity, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }));
});

test('rays hit triangle slopes and their shared diagonal exactly', () => {
  const surface = createSurface({ ...options, cellsX: 1, cellsZ: 1, baseHeight: 0, layers: [{ kind: 'radial', x: 0, z: 0, radius: 1, height: 4 }] });
  for (const [x, z, height] of [[0.2, 0.3, 2], [0.5, 0.5, 0], [0.8, 0.7, 0], [0, 0, 4], [1, 1, 0]]) {
    const hit = surface.raycast({ x: x!, y: 10, z: z! }, { x: 0, y: -1, z: 0 })!;
    assert.ok(hit); near(hit.y, height!); near(hit.y, surface.sample(x!, z!)!.height);
  }
});
