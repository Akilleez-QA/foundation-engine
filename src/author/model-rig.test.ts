import test from 'node:test';
import assert from 'node:assert/strict';
import {must} from '../testing/must';
import * as T from 'three';
import {captureModelRig, resolveModelRig, restoreModelRigNodes, type ModelRig} from './model-rig';
import {captureModelPoseLink, normalizeModelPoseLinkLimits} from './model-pose-link';
const limits = normalizeModelPoseLinkLimits();
function fixture(permuted = false, pivot = false) {
  const root = new T.Group(),
    a = new T.Bone(),
    b = new T.Bone(),
    ancestor = new T.Group();
  root.name = 'asset';
  a.name = 'A';
  b.name = 'B';
  ancestor.name = 'pivot';
  b.position.x = 1;
  a.add(b);
  if (pivot) {
    root.add(ancestor);
    ancestor.add(a);
  } else root.add(a);
  root.updateMatrixWorld(true);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute([0, 1, 0, 2, 0, 0, 2, 0, 0], 3));
  const ai = permuted ? 1 : 0,
    bi = permuted ? 0 : 1;
  geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute([ai, 0, 0, 0, bi, 0, 0, 0, ai, bi, 0, 0], 4));
  geometry.setAttribute('skinWeight', new T.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0], 4));
  const skeleton = new T.Skeleton(permuted ? [b, a] : [a, b]);
  const mesh = new T.SkinnedMesh(geometry, new T.MeshBasicMaterial());
  mesh.name = 'mesh';
  mesh.bind(skeleton, new T.Matrix4());
  root.add(mesh);
  return {root, a, b, ancestor, mesh, skeleton};
}
function captured(root: T.Object3D): ModelRig {
  const result = captureModelRig(root, limits);
  if (!result.ok) throw Error(result.reason);
  return result.rig;
}
const relation = (names = ['A', 'B']) =>
  captureModelPoseLink({source: 1, nodes: names.map(name => ({source: name, target: name})), inheritVisibility: true});

test('rig immutable baseline survives live animation and inverse-bind mutation; no asset rewrite during capture/resolve', () => {
  const f = fixture(),
    rig = captured(f.root),
    before = f.skeleton.boneInverses.map(m => m.toArray());
  assert.deepEqual(
    f.skeleton.boneInverses.map(m => m.toArray()),
    before,
  );
  f.b.position.x = 4;
  must(f.skeleton.boneInverses[1], 'inverse 1').elements[12] = 8;
  assert.equal(rig.nodes.find(n => n.name === 'B')!.position[0], 1);
  assert.equal(must(must(rig.skins[0], 'skin').inverses[1], 'inverse 1')[12], -1);
  assert.ok(
    Object.isFrozen(rig) && Object.isFrozen(rig.nodes) && Object.isFrozen(must(rig.skins[0], 'skin').inverses[0]),
  );
});
test('mapped independently owned rigs deform A-only B-only and mixed vertices with reordered palettes', () => {
  const source = fixture(),
    target = fixture(true),
    a = captured(source.root),
    b = captured(target.root),
    result = resolveModelRig(a, b, relation(), limits);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  source.b.rotation.z = Math.PI / 2;
  for (const pair of result.pairs) {
    pair.target.position.copy(pair.source.position);
    pair.target.quaternion.copy(pair.source.quaternion);
    pair.target.scale.copy(pair.source.scale);
  }
  target.root.updateMatrixWorld(true);
  const expected = [
    [0, 1, 0],
    [1, 1, 0],
    [1.5, 0.5, 0],
  ];
  for (let i = 0; i < 3; i++) {
    const value = new T.Vector3().fromBufferAttribute(target.mesh.geometry.getAttribute('position'), i);
    target.mesh.applyBoneTransform(i, value);
    const want = must(expected[i], `expected ${i}`);
    value.toArray().forEach((v, j) => assert.ok(Math.abs(v - must(want[j])) < 1e-6));
  }
  assert.notStrictEqual(source.skeleton, target.skeleton);
  assert.notStrictEqual(source.b, target.b);
});
test('mapping requires all skin joints and non-bone ancestor closure', () => {
  const a = captured(fixture(false, true).root),
    b = captured(fixture(false, true).root);
  assert.deepEqual(resolveModelRig(a, b, relation(), limits), {ok: false, reason: 'hierarchy'});
  assert.equal(resolveModelRig(a, b, relation(['pivot', 'A', 'B']), limits).ok, true);
  assert.deepEqual(resolveModelRig(a, b, relation(['pivot', 'A']), limits), {ok: false, reason: 'mapping'});
});
test('mapped local scale and nonidentity matching asset roots preserve numeric world deformation', () => {
  const a = fixture(),
    b = fixture(true);
  a.root.position.set(3, 2, 0);
  b.root.position.copy(a.root.position);
  a.root.rotation.z = 0.2;
  b.root.rotation.copy(a.root.rotation);
  const source = captured(a.root),
    target = captured(b.root),
    result = resolveModelRig(source, target, relation(), limits);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  a.b.scale.set(2, 1, 1);
  a.b.rotation.z = Math.PI / 2;
  for (const pair of result.pairs) {
    pair.target.position.copy(pair.source.position);
    pair.target.quaternion.copy(pair.source.quaternion);
    pair.target.scale.copy(pair.source.scale);
  }
  b.root.updateMatrixWorld(true);
  const vertex = new T.Vector3(2, 0, 0);
  b.mesh.applyBoneTransform(1, vertex).applyMatrix4(b.mesh.matrixWorld);
  const expected = new T.Vector3(1, 2, 0).applyAxisAngle(new T.Vector3(0, 0, 1), 0.2).add(new T.Vector3(3, 2, 0));
  assert.ok(vertex.distanceTo(expected) < 1e-6);
});
test('compatible names cannot conceal rest, hierarchy or inverse-bind disagreement', () => {
  const source = captured(fixture().root);
  const rest = fixture();
  rest.b.position.y = 1;
  assert.deepEqual(resolveModelRig(source, captured(rest.root), relation(), limits), {ok: false, reason: 'rest'});
  const bind = fixture();
  must(bind.skeleton.boneInverses[1], 'inverse 1').elements[12] = -0.5;
  assert.deepEqual(resolveModelRig(source, captured(bind.root), relation(), limits), {ok: false, reason: 'bind'});
  const hierarchy = fixture();
  hierarchy.root.add(hierarchy.b);
  assert.deepEqual(resolveModelRig(source, captured(hierarchy.root), relation(), limits), {
    ok: false,
    reason: 'hierarchy',
  });
  const duplicate = fixture();
  const copy = new T.Object3D();
  copy.name = 'A';
  duplicate.root.add(copy);
  assert.deepEqual(resolveModelRig(source, captured(duplicate.root), relation(), limits), {
    ok: false,
    reason: 'mapping',
  });
});
test('source occurrences with inconsistent bind matrices fail instead of choosing one skin', () => {
  const source = fixture(),
    extra = new T.SkinnedMesh(source.mesh.geometry, source.mesh.material);
  extra.bind(new T.Skeleton([source.a, source.b]), new T.Matrix4());
  must(extra.skeleton.boneInverses[1], 'inverse 1').elements[12] = -0.5;
  source.root.add(extra);
  assert.deepEqual(resolveModelRig(captured(source.root), captured(fixture().root), relation(), limits), {
    ok: false,
    reason: 'bind',
  });
});
test('capture admits aggregate skin vertices before scanning and node/joint caps before facts', () => {
  const f = fixture();
  let reads = 0;
  const positions = f.mesh.geometry.getAttribute('position');
  positions.getX = () => {
    reads++;
    return 0;
  };
  assert.deepEqual(captureModelRig(f.root, normalizeModelPoseLinkLimits({maxSkinVerticesPerModel: 2})), {
    ok: false,
    reason: 'capacity',
  });
  assert.equal(reads, 0);
  assert.deepEqual(captureModelRig(f.root, normalizeModelPoseLinkLimits({maxRigNodesPerModel: 3})), {
    ok: false,
    reason: 'capacity',
  });
  assert.deepEqual(captureModelRig(f.root, normalizeModelPoseLinkLimits({maxSkinJointsPerModel: 1})), {
    ok: false,
    reason: 'capacity',
  });
  assert.deepEqual(captureModelRig(f.root, normalizeModelPoseLinkLimits({maxRigNodesPerModel: 0})), {
    ok: false,
    reason: 'capacity',
  });
});
test('malformed weights indices modes morphs and singular binds are observed refusal', () => {
  const cases: [(f: ReturnType<typeof fixture>) => void, string][] = [
    [f => f.mesh.geometry.getAttribute('skinWeight').setX(0, NaN), 'skin'],
    [f => f.mesh.geometry.getAttribute('skinWeight').setX(0, 0.5), 'skin'],
    [f => f.mesh.geometry.getAttribute('skinIndex').setX(0, 3), 'skin'],
    [
      f => {
        f.mesh.bindMode = T.DetachedBindMode;
      },
      'skin',
    ],
    [
      f => {
        f.mesh.geometry.morphAttributes.position = [f.mesh.geometry.getAttribute('position')];
      },
      'skin',
    ],
    [f => f.mesh.bindMatrix.makeScale(0, 1, 1), 'bind'],
    [
      f => {
        f.b.scale.x = 0;
      },
      'rest',
    ],
    [
      f => {
        f.b.matrixAutoUpdate = false;
      },
      'rest',
    ],
    [
      f => {
        f.skeleton.bones[0] = new T.Bone();
      },
      'hierarchy',
    ],
  ];
  for (const [change, reason] of cases) {
    const f = fixture();
    change(f);
    assert.deepEqual(captureModelRig(f.root, limits), {ok: false, reason});
  }
});
test('restoration restores only touched locals including scale and never changes inverse arrays', () => {
  const f = fixture(),
    rig = captured(f.root),
    inverse = must(f.skeleton.boneInverses[0], 'inverse 0'),
    values = inverse.toArray();
  f.b.scale.set(3, 2, 1);
  f.b.position.x = 7;
  f.a.position.y = 5;
  assert.equal(restoreModelRigNodes(rig, [f.b]), true);
  assert.equal(f.b.position.x, 1);
  assert.deepEqual(f.b.scale.toArray(), [1, 1, 1]);
  assert.equal(f.a.position.y, 5);
  assert.equal(restoreModelRigNodes(rig, [f.b]), false);
  assert.strictEqual(f.skeleton.boneInverses[0], inverse);
  assert.deepEqual(inverse.toArray(), values);
});
test('GPU-only vertex buffers and excessive attribute names are bounded unsupported captures', () => {
  const gpu = fixture();
  gpu.mesh.geometry.setAttribute(
    'position',
    new T.GLBufferAttribute({} as WebGLBuffer, 5126, 3, 4, 3) as unknown as T.BufferAttribute,
  );
  assert.deepEqual(captureModelRig(gpu.root, limits), {ok: false, reason: 'skin'});
  const many = fixture();
  for (let i = 0; i < 33; i++)
    many.mesh.geometry.setAttribute(`custom${i}`, new T.Float32BufferAttribute([0, 0, 0], 1));
  assert.deepEqual(captureModelRig(many.root, limits), {ok: false, reason: 'skin'});
});
test('manual world matrices are refused before mapped local pose can falsely promise deformation', () => {
  const source = fixture(),
    target = fixture();
  target.b.matrixWorldAutoUpdate = false;
  source.b.position.x = 3;
  target.b.position.copy(source.b.position);
  source.root.updateMatrixWorld(true);
  target.root.updateMatrixWorld(true);
  const a = new T.Vector3(2, 0, 0),
    b = a.clone();
  source.mesh.applyBoneTransform(1, a);
  target.mesh.applyBoneTransform(1, b);
  assert.notDeepEqual(a.toArray(), b.toArray(), 'local copying cannot repair a manually frozen world matrix');
  const rejected = captureModelRig(target.root, limits);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.reason, 'rest');
});
test('capture never scans beyond admitted attribute count when an accessor changes it', () => {
  const f = fixture(),
    positions = f.mesh.geometry.getAttribute('position');
  let countReads = 0,
    vertexReads = 0;
  const getX = positions.getX.bind(positions);
  positions.getX = i => {
    vertexReads++;
    return getX(i);
  };
  Object.defineProperty(positions, 'count', {get: () => (++countReads === 1 ? 1 : 3)});
  const result = captureModelRig(f.root, normalizeModelPoseLinkLimits({maxSkinVerticesPerModel: 1}));
  assert.equal(result.ok, false);
  assert.ok(vertexReads <= 1, `read ${vertexReads} vertices after admitting one`);
});
test('capture bounds skeleton and child array traversal by detached admitted lengths', () => {
  const f = fixture();
  let lengthReads = 0;
  f.skeleton.bones = new Proxy(f.skeleton.bones, {
    get(target, key, receiver) {
      return key === 'length' ? (++lengthReads === 1 ? 1 : 2) : Reflect.get(target, key, receiver);
    },
  });
  assert.equal(captureModelRig(f.root, normalizeModelPoseLinkLimits({maxSkinJointsPerModel: 1})).ok, false);
  const g = fixture();
  let childLengths = 0,
    unadmittedRead = false;
  g.root.children = new Proxy(g.root.children, {
    get(target, key, receiver) {
      if (key === 'length') return ++childLengths === 1 ? 1 : 2;
      if (key === '1') unadmittedRead = true;
      return Reflect.get(target, key, receiver);
    },
  });
  assert.equal(captureModelRig(g.root, limits).ok, false);
  assert.equal(unadmittedRead, false);
});
