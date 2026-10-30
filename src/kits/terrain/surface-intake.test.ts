import test from 'node:test';
import assert from 'node:assert/strict';
import {createSampledSurface, patchSurface, buildSurfaceChunk, type SampledSurfaceOptions} from './index';
import {surfaceWire} from './surface';
const grid = {id: 'authored', revision: 1, originX: 0, originZ: 0, spacing: 1, cellsX: 1, cellsZ: 1};
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('sample intake: creator plane has analytic contact, ray distances and vertex normals on an offset grid', () => {
  const heights = [];
  for (let z = -2; z <= 0; z++) for (let x = 4; x <= 6; x++) heights.push(2 * x - 3 * z + 5);
  const surface = createSampledSurface({...grid, originX: 4, originZ: -2, cellsX: 2, cellsZ: 2, heights});
  for (const [x, z] of [
    [4, -2],
    [4.2, -1.3],
    [5.8, -0.2],
    [6, 0],
  ]) {
    const expected = 2 * x! - 3 * z! + 5,
      sample = surface.sample(x!, z!)!;
    near(sample.height, expected);
    near(sample.normal.x, -2 / Math.sqrt(14));
    near(sample.normal.y, 1 / Math.sqrt(14));
    near(sample.normal.z, 3 / Math.sqrt(14));
    near(surface.raycast({x: x!, y: 40, z: z!}, {x: 0, y: -2, z: 0})!.distance, 40 - expected);
  }
  const normal = surface.vertex(1, 1).normal;
  near(normal.x, -2 / Math.sqrt(14));
  near(normal.y, 1 / Math.sqrt(14));
  near(normal.z, 3 / Math.sqrt(14));
  assert.equal(surface.sample(3.9, -1), null);
});

test('sample intake: nonplanar data follows independently calculated triangle planes, not bilinear interpolation', () => {
  const surface = createSampledSurface({...grid, heights: new Float64Array([0, 2, 3, 9])});
  // Lower plane = 2x + 3z; upper plane = 6x + 7z - 4.
  near(surface.sample(0.2, 0.3)!.height, 1.3);
  near(surface.sample(0.8, 0.7)!.height, 5.7);
  near(surface.sample(0.5, 0.5)!.height, 2.5);
  near(surface.sample(0.8, 0.7)!.normal.x, -6 / Math.sqrt(86));
  assert.deepEqual(surface.mesh(), {positions: [0, 0, 0, 1, 2, 0, 0, 3, 1, 1, 9, 1], indices: [0, 2, 1, 1, 2, 3]});
});

test('sample intake: metadata defaults, rounding and caller buffers have canonical owned semantics', () => {
  const heights = [0.1, 2, 3, 9],
    materials = new Uint16Array([2, 4, 6, 8]),
    exclusions = new Uint8Array([0, 1, 0, 0]);
  const surface = createSampledSurface({...grid, heights, materials, exclusions});
  const before = surface.mesh();
  assert.equal(surface.vertex(0, 0).y, Math.fround(0.1));
  assert.equal(surface.sample(0.1, 0.1)!.material, 2);
  assert.equal(surface.sample(0.1, 0.1)!.excluded, true);
  assert.equal(surface.sample(0, 0)!.excluded, false);
  heights.fill(99);
  materials.fill(99);
  exclusions.fill(0);
  const mesh = surface.mesh();
  mesh.positions.fill(99);
  mesh.indices.fill(0);
  assert.deepEqual(surface.mesh(), before);
  assert.equal(surface.vertex(1, 0).material, 4);
  assert.equal(surface.vertex(1, 0).excluded, true);
  assert.ok(Object.isFrozen(surface));
  assert.ok(Object.isFrozen(surface.vertex(0, 0).normal));
  const defaults = createSampledSurface({...grid, heights: [0, 0, 0, 0]});
  assert.equal(defaults.vertex(0, 0).material, 0);
  assert.equal(defaults.vertex(0, 0).excluded, false);
});

test('sample intake: imported data retains patch, worker serialization and mixed stride chunk interoperability', () => {
  const heights = Array.from({length: 25}, (_, i) => i % 5);
  const surface = createSampledSurface({...grid, cellsX: 4, cellsZ: 4, heights});
  const patch = patchSurface(surface, 2, [{x: 2, z: 2, height: 8}]);
  assert.equal(patch.surface.vertex(2, 2).y, 8);
  assert.equal(surface.vertex(2, 2).y, 2);
  const left = buildSurfaceChunk(surface, {startX: 0, startZ: 0, cellsX: 2, cellsZ: 4, stride: 1});
  const right = buildSurfaceChunk(surface, {startX: 2, startZ: 0, cellsX: 2, cellsZ: 4, stride: 2});
  const edge = (positions: number[]) => {
    const out = [];
    for (let i = 0; i < positions.length; i += 3) if (positions[i] === 2) out.push(positions.slice(i, i + 3));
    return out.sort((a, b) => a[2]! - b[2]!);
  };
  assert.deepEqual(edge(left.mesh.positions), edge(right.mesh.positions));
  const wire = surfaceWire(surface);
  wire.heights.fill(200);
  wire.xs.fill(200);
  assert.equal(surface.vertex(2, 2).y, 2);
  assert.equal(surface.vertex(2, 2).x, 2);
});

test('sample intake: malformed topology and samples fail before returning a canonical surface', () => {
  const valid: SampledSurfaceOptions = {...grid, heights: [0, 2, 3, 9]};
  const invalid: Partial<SampledSurfaceOptions>[] = [
    {heights: []},
    {heights: [0, 1, 2, 3, 4]},
    {heights: [0, NaN, 0, 0]},
    {heights: [0, Infinity, 0, 0]},
    {heights: [0, 1e40, 0, 0]},
    {heights: new Array<number>(4)},
    {materials: [0]},
    {materials: [-1, 0, 0, 0]},
    {materials: [65536, 0, 0, 0]},
    {materials: [0.5, 0, 0, 0]},
    {exclusions: [0]},
    {exclusions: [0, 2, 0, 0]},
    {exclusions: [0, NaN, 0, 0]},
    {id: ''},
    {revision: -1},
    {revision: 0.5},
    {spacing: 0},
    {originX: Infinity},
    {originX: 1e20},
    {cellsX: 257},
    {cellsZ: 0},
    {cellsX: 0.5},
  ];
  for (const bad of invalid) assert.throws(() => createSampledSurface({...valid, ...bad}));
  assert.throws(() => createSampledSurface({...grid} as SampledSurfaceOptions));
  let reads = 0;
  const input = {
    length: 4,
    get 0() {
      reads++;
      return 0;
    },
  };
  assert.throws(() => createSampledSurface({...grid, cellsX: 257, heights: input}));
  assert.equal(reads, 0);
});
