import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defineMesh, MESH_LIMITS, validateMesh} from './mesh';
import {World} from '../core/ecs/world';
import {spawnInto} from './body';

const triangle = () => ({positions: [0, 0, 0, 1, 0, 0, 0, 0, 1], indices: [0, 2, 1]});
test('indexed mesh owns cloneable authored geometry across independent spawns', () => {
  const source = triangle(),
    init = defineMesh(source);
  source.positions[0] = 99;
  assert.equal(init.value.positions[0], 0);
  const world = new World(),
    a = spawnInto(world, [init]),
    b = spawnInto(world, [init]);
  const first = world.get(a, init.type)!,
    second = world.get(b, init.type)!;
  first.positions[0] = 5;
  assert.equal(second.positions[0], 0);
  assert.deepEqual(structuredClone(second), init.value);
});

test('indexed mesh rejects invalid topology and nonfinite GPU values before upload', () => {
  for (const positions of [[], [0, 0], [NaN, 0, 0, 1, 0, 0, 0, 0, 1], [Number.MAX_VALUE, 0, 0, 1, 0, 0, 0, 0, 1]]) {
    assert.throws(() => defineMesh({...triangle(), positions}), /mesh:/);
  }
  for (const indices of [[], [0, 1], [-1, 1, 2], [0, 1, 3], [0, 0.5, 2], [0, NaN, 2]])
    assert.throws(() => defineMesh({...triangle(), indices}), /mesh:/);
  assert.throws(
    () => defineMesh({...triangle(), positions: new Array(MESH_LIMITS.vertices * 3 + 3).fill(0)}),
    /vertices/,
  );
  assert.throws(
    () => defineMesh({...triangle(), indices: new Array(MESH_LIMITS.triangles * 3 + 3).fill(0)}),
    /triangles/,
  );
});

test('indexed mesh validates vertex colors, revision and mutated input on rebuild', () => {
  for (const colors of [[1, 0, 0], new Array(9).fill(Infinity), new Array(9).fill(-1), new Array(9).fill(2)])
    assert.throws(() => defineMesh({...triangle(), colors}), /colors/);
  for (const revision of [-1, 0.5, Infinity]) assert.throws(() => defineMesh({...triangle(), revision}), /revision/);
  for (const color of [-1, 0x1000000, NaN]) assert.throws(() => defineMesh({...triangle(), color}), /color/);
  const valid = defineMesh({...triangle(), colors: new Array(9).fill(0.5)});
  valid.value.indices[0] = 999;
  assert.throws(() => validateMesh(valid.value), /index/);
});

test('explicit mesh normals are cloned and reject malformed or non-unit attributes', () => {
  const normals = [0, 1, 0, 0, 1, 0, 0, 1, 0],
    mesh = defineMesh({...triangle(), normals});
  normals[0] = 1;
  assert.equal(mesh.value.normals[0], 0);
  for (const invalid of [[0, 1, 0], new Array(9).fill(0), new Array(9).fill(NaN), [0, 2, 0, 0, 1, 0, 0, 1, 0]])
    assert.throws(() => defineMesh({...triangle(), normals: invalid}), /normals/);
});
