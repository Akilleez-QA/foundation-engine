import test from 'node:test';
import assert from 'node:assert/strict';
import {must} from '../testing/must';
import * as T from 'three';
import {inspectModel} from './model-inspection';
import type {Entity} from '../core/ecs/world';

function fixture() {
  const root = new T.Group(),
    a = new T.Bone(),
    b = new T.Bone();
  a.add(b);
  b.position.x = 1;
  root.add(a);
  root.updateMatrixWorld(true);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute([0, 1, 0, 2, 0, 0, 2, 0, 0], 3));
  geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0], 4));
  geometry.setAttribute('skinWeight', new T.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0], 4));
  const mesh = new T.SkinnedMesh(geometry, new T.MeshBasicMaterial());
  mesh.name = 'strip';
  mesh.bind(new T.Skeleton([a, b]));
  root.add(mesh);
  b.rotation.z = Math.PI / 2;
  root.position.set(10, 2, 0);
  root.updateMatrixWorld(true);
  const nodes = new Map<string, T.Object3D | null>([
    ['strip', mesh],
    ['duplicate', null],
    ['ordinary', a],
  ]);
  const slot = {asset: 'strip', ready: true, root, nodes};
  return {
    root,
    a,
    b,
    mesh,
    slot,
    inspect: (skinVertices: {mesh: string; vertex: number}[]) =>
      inspectModel({entity: 1 as Entity, skinVertices}, () => ({slot})),
  };
}
test('weighted inspection observes independently expected multi-joint world positions without updating pose', () => {
  const f = fixture();
  const sample = () => f.inspect([0, 1, 2].map(vertex => ({mesh: 'strip', vertex})));
  const first = sample();
  assert.equal(first.status, 'observed');
  if (first.status !== 'observed') return;
  const expected = [
    [10, 3, 0],
    [11, 3, 0],
    [11.5, 2.5, 0],
  ];
  first.skinVertices.forEach((row, i) => {
    assert.equal(row.status, 'ready');
    const want = must(expected[i], `expected ${i}`);
    row.position!.forEach((n, j) => assert.ok(Math.abs(n - must(want[j])) < 1e-6));
  });
  const before = f.b.matrixWorld.toArray();
  f.b.rotation.z = -Math.PI / 2;
  assert.deepEqual(sample(), first);
  assert.deepEqual(f.b.matrixWorld.toArray(), before);
  f.root.updateMatrixWorld(true);
  const after = sample();
  assert.equal(after.status, 'observed');
  if (after.status !== 'observed') return;
  assert.ok(Math.abs(must(must(after.skinVertices[1], 'vertex 1').position![1]) - 1) < 1e-6);
});
test('weighted inspection refuses unsupported, ambiguous and out-of-range observations', () => {
  const f = fixture();
  const r = f.inspect([
    {mesh: 'absent', vertex: 0},
    {mesh: 'duplicate', vertex: 0},
    {mesh: 'ordinary', vertex: 0},
    {mesh: 'strip', vertex: 3},
  ]);
  assert.equal(r.status, 'observed');
  if (r.status !== 'observed') return;
  assert.deepEqual(
    r.skinVertices.map(x => x.status),
    ['missing', 'ambiguous', 'unsupported', 'out-of-range'],
  );
  f.mesh.geometry.getAttribute('skinIndex').setX(0, 99);
  const bad = f.inspect([{mesh: 'strip', vertex: 0}]);
  assert.equal(bad.status, 'observed');
  if (bad.status === 'observed') assert.equal(must(bad.skinVertices[0], 'vertex 0').status, 'unsupported');
});
test('weighted inspection bounds and captures requested vertices before reading the live owner', () => {
  let reads = 0;
  const read = () => {
    reads++;
    return null;
  };
  assert.throws(() => inspectModel({entity: 1 as Entity, skinVertices: new Array(33)}, read));
  assert.throws(() => inspectModel({entity: 1 as Entity, skinVertices: [{mesh: 'strip', vertex: -1}]}, read));
  assert.equal(reads, 0);
  const request = {mesh: 'strip', vertex: 0},
    requests = [request];
  const f = fixture();
  const result = inspectModel({entity: 1 as Entity, skinVertices: requests}, () => {
    request.vertex = 999;
    return {slot: f.slot};
  });
  assert.equal(result.status, 'observed');
  if (result.status === 'observed') assert.equal(must(result.skinVertices[0], 'vertex 0').vertex, 0);
});

test('weighted inspection reports GPU-only attributes unsupported and never enumerates arbitrary morph fields', () => {
  const f = fixture();
  f.mesh.geometry.morphAttributes = new Proxy(
    {},
    {
      ownKeys() {
        throw Error('unbounded enumeration');
      },
    },
  );
  const visible = f.inspect([{mesh: 'strip', vertex: 0}]);
  assert.equal(visible.status, 'observed');
  if (visible.status === 'observed') assert.equal(must(visible.skinVertices[0], 'vertex 0').status, 'ready');
  const attributes = f.mesh.geometry.attributes;
  for (const [name, size] of [
    ['position', 3],
    ['skinIndex', 4],
    ['skinWeight', 4],
  ] as const) {
    const previous = must(attributes[name], name);
    f.mesh.geometry.setAttribute(
      name,
      new T.GLBufferAttribute({} as WebGLBuffer, 5126, size, 4, 3) as unknown as T.BufferAttribute,
    );
    const result = f.inspect([{mesh: 'strip', vertex: 0}]);
    assert.equal(result.status, 'observed');
    if (result.status === 'observed') assert.equal(must(result.skinVertices[0], 'vertex 0').status, 'unsupported');
    f.mesh.geometry.setAttribute(name, previous);
  }
});
