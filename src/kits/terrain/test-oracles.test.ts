import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTerrainOracle, oracleAxis } from './test-oracles';
const close = (actual: number, expected: number, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const grid = { baseX: 0, baseZ: 0, spacing: 1, startX: 0, startZ: 0, cellsX: 2, cellsZ: 2 };

test('oracle uses once-rounded global coordinates, including negative fractional starts', () => {
  const xs = oracleAxis(.1, .1, -1000, 3);
  assert.equal(xs[2], -99.69999694824219);
  assert.notEqual(xs[2], Math.fround(xs[0]! + 2 * .1));
  assert.deepEqual(oracleAxis(.1, .1, -998, 1), xs.slice(2));
  assert.throws(() => oracleAxis(1e30, .1, 0, 1), /collapsed/);
  assert.throws(() => createTerrainOracle({ ...grid, cellsX: 17 }, () => 0), /bound/);
});

test('plane contact, incident normals, finite vertical and oblique rays match analytic equations', () => {
  // y = 2x + 3z + 4, exactly representable on this integer lattice.
  const oracle = createTerrainOracle(grid, ({ x, z }) => 2 * x + 3 * z + 4);
  const normal = { x: -2 / Math.sqrt(14), y: 1 / Math.sqrt(14), z: -3 / Math.sqrt(14) };
  for (let iz = 0; iz <= 2; iz++) for (let ix = 0; ix <= 2; ix++) {
    const v = oracle.vertex(ix, iz); assert.equal(v.y, 2 * ix + 3 * iz + 4);
    close(v.normal.x, normal.x); close(v.normal.y, normal.y); close(v.normal.z, normal.z);
  }
  const contact = oracle.sample(.25, .5)!; close(contact.y, 6);
  const vertical = oracle.raycast({ x: .25, y: 10, z: .5 }, { x: 0, y: -7, z: 0 })!;
  close(vertical.distance, 4); close(vertical.y, 6);
  assert.equal(oracle.raycast({ x: .25, y: 10, z: .5 }, { x: 0, y: -1, z: 0 }, 3), null);
  // p(t)=(0,10,0)+t*(1,-1,1)/sqrt(3). Plane equality gives t=sqrt(3).
  const oblique = oracle.raycast({ x: 0, y: 10, z: 0 }, { x: 1, y: -1, z: 1 })!;
  close(oblique.distance, Math.sqrt(3)); close(oblique.x, 1); close(oblique.y, 9); close(oblique.z, 1);
});

test('explicit diagonal differs from bilinear interpolation on a nonplanar cell', () => {
  const oracle = createTerrainOracle({ ...grid, cellsX: 1, cellsZ: 1 }, ({ gx, gz }) => gx === 1 && gz === 1 ? 4 : 0);
  assert.equal(oracle.triangles().length, 2);
  close(oracle.sample(.25, .25)!.y, 0);
  close(oracle.sample(.75, .75)!.y, 2);
  assert.notEqual(oracle.sample(.25, .25)!.y, 4 * .25 * .25);
  close(oracle.raycast({ x: .75, y: 5, z: .75 }, { x: 0, y: -1, z: 0 })!.distance, 3);
});

test('halo changes edge incident normals without adding rendered or hittable cells', () => {
  const flat = createTerrainOracle(grid, () => 0);
  const halo = createTerrainOracle(grid, ({ gx }) => gx === -1 ? 2 : 0);
  assert.deepEqual(halo.triangles(), flat.triangles());
  assert.equal(halo.vertex(0, 1).y, flat.vertex(0, 1).y);
  // Three incident left triangles each contribute projected area .5 and x slope -2.
  const n = halo.vertex(0, 1).normal; close(n.x, 1 / Math.sqrt(2)); close(n.y, 1 / Math.sqrt(2)); close(n.z, 0);
  assert.equal(halo.sample(-.5, 1), null);
  assert.equal(halo.raycast({ x: -.5, y: 10, z: 1 }, { x: 0, y: -1, z: 0 }), null);
  assert.deepEqual(halo.vertex(1, 1).normal, flat.vertex(1, 1).normal);
});

test('brute ray selects the nearest of multiple intersected faces and excludes backward hits', () => {
  const oracle = createTerrainOracle({ ...grid, cellsX: 4 }, ({ gx }) => gx % 2 === 0 ? 0 : 2);
  const hit = oracle.raycast({ x: -.5, y: 1, z: .5 }, { x: 3, y: 0, z: 0 })!;
  close(hit.x, .5); close(hit.distance, 1);
  assert.equal(oracle.raycast({ x: -.5, y: 1, z: .5 }, { x: -1, y: 0, z: 0 }), null);
  assert.equal(oracle.raycast({ x: .5, y: 1, z: .5 }, { x: 0, y: -1, z: 0 }, 0)!.distance, 0);
  assert.throws(() => oracle.raycast({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }));
});

test('independent neighboring snapshots have identical shared positions and incident normals', () => {
  const source = ({ gx, gz }: { gx: number; gz: number }) => gx * gx / 8 + gz * gx / 16;
  const left = createTerrainOracle({ ...grid, baseX: .1, baseZ: -.3, spacing: .1, startX: -1000, startZ: -2 }, source);
  const right = createTerrainOracle({ ...grid, baseX: .1, baseZ: -.3, spacing: .1, startX: -998, startZ: -2 }, source);
  for (let z = 0; z <= 2; z++) assert.deepEqual(left.vertex(2, z), right.vertex(0, z));
  assert.ok(Object.isFrozen(left.triangles())); assert.ok(Object.isFrozen(left.vertex(0, 0).normal));
});
