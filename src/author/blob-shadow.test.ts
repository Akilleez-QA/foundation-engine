import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {World} from '../core/ecs/world';
import {coreKnobs} from '../platform/render/quality';
import {defineScene, Shape, Transform} from './defs';
import {Model} from './model';
import {Shadow, sceneShadows} from './shadow-casting';
import {
  BlobShadow,
  blobWeight,
  planBlobs,
  sceneBlobShadows,
  sunCoverage,
  type BlobCandidate,
  type SceneBlobShadowLimits,
} from './blob-shadow';
import {createSceneBlobShadows} from './scene-blob-shadows';

const candidate = (o: Partial<BlobCandidate> = {}): BlobCandidate => ({
  entity: 1,
  x: 0,
  ground: 0,
  z: 0,
  yaw: 0,
  width: 1,
  depth: 1,
  opacity: 0.5,
  casts: true,
  ...o,
});

function setup(
  limits: Partial<SceneBlobShadowLimits> = {},
  shadows: ReturnType<typeof sceneShadows> | null = sceneShadows(),
) {
  const world = new World(),
    scene = new T.Scene(),
    reports: string[] = [];
  const drawing = createSceneBlobShadows({
    world,
    scene,
    limits: sceneBlobShadows(limits).limits,
    shadows: shadows ?? undefined,
    report: message => reports.push(message),
  });
  return {world, scene, reports, drawing};
}
const NO_SUN = {camera: [0, 10, 10] as const, sun: null};

test('BlobShadow and sceneBlobShadows validate; defineScene accepts only sceneBlobShadows', () => {
  assert.deepEqual(BlobShadow().value, {width: 0.8, depth: 0.8, opacity: 0.5, ground: null, visible: true});
  assert.deepEqual(BlobShadow({width: 0.6, ground: 1.5}).value.ground, 1.5);
  assert.throws(() => BlobShadow({width: 0}), /BlobShadow: width must be in \(0, 100\]/);
  assert.throws(() => BlobShadow({depth: 101}), /BlobShadow: depth/);
  assert.throws(() => BlobShadow({opacity: 1.5}), /BlobShadow: opacity must be in \[0, 1\]/);
  assert.throws(() => BlobShadow({ground: Number.NaN}), /BlobShadow: ground/);
  assert.throws(() => BlobShadow(JSON.parse('{"visible": 1}')), /BlobShadow: visible must be boolean/);
  assert.deepEqual(sceneBlobShadows().limits, {max: 64, ground: 0, crossfade: 2, distance: null});
  assert.throws(() => sceneBlobShadows({max: 0}), /max must be an integer in \[1, 1024\]/);
  assert.throws(() => sceneBlobShadows({max: 1025}), /max/);
  assert.throws(() => sceneBlobShadows({max: 2.5}), /max/);
  assert.throws(() => sceneBlobShadows({crossfade: -1}), /crossfade/);
  assert.throws(() => sceneBlobShadows({distance: 0}), /distance must be null or in \(0, 10000\]/);
  assert.throws(() => sceneBlobShadows({ground: Infinity}), /ground/);
  assert.ok(Object.isFrozen(sceneBlobShadows().limits));
  assert.throws(
    () => defineScene({id: 'bad', title: 'Bad', blobShadows: JSON.parse('{"kind": "x"}')}),
    /scene bad: blobShadows must be sceneBlobShadows/,
  );
  assert.equal(defineScene({id: 'ok', title: 'Ok', blobShadows: sceneBlobShadows()}).blobShadows?.limits.max, 64);
});

test('policy: a blob stands in where there is no real sun shadow, and crossfades at the shadow box edge', () => {
  const sun = {extent: 10};
  assert.equal(blobWeight(candidate(), null, 2), 1, 'no live sun shadow: full blob');
  assert.equal(blobWeight(candidate({casts: false}), sun, 2), 1, 'a non-caster always keeps its blob');
  assert.equal(blobWeight(candidate({x: 3}), sun, 2), 0, 'inside the box a caster has its real shadow');
  assert.equal(blobWeight(candidate({x: 8}), sun, 2), 0, 'the band starts at extent - crossfade');
  assert.equal(blobWeight(candidate({x: 9}), sun, 2), 0.5, 'half way through the band');
  assert.equal(blobWeight(candidate({x: 10}), sun, 2), 1, 'at the edge');
  assert.equal(blobWeight(candidate({x: 40, z: -3}), sun, 2), 1, 'beyond the real shadow range');
  assert.equal(blobWeight(candidate({x: 9.9}), sun, 0), 0, 'no crossfade: a hard switch at the edge');
  const rising = [8.2, 8.6, 9.2, 9.8].map(x => blobWeight(candidate({x}), sun, 2));
  assert.deepEqual(
    [...rising].sort((a, b) => a - b),
    rising,
    'monotonic across the band',
  );
});

test('preset gating: every preset keeps the sun map (floor low); only a player `off` turns blobs on everywhere', () => {
  const knob = coreKnobs.find(k => k.id === 'shadows.quality');
  assert.ok(knob);
  for (const [preset, quality] of Object.entries(knob.presets)) {
    assert.notEqual(quality, 'off', `${preset} keeps a sun shadow`);
    assert.deepEqual(sunCoverage({sceneShadows: true, extent: 14, quality: quality as 'low'}), {extent: 14}, preset);
  }
  assert.equal(sunCoverage({sceneShadows: true, extent: 14, quality: 'off'}), null, 'player off');
  assert.equal(sunCoverage({sceneShadows: false, extent: 14, quality: 'ultra'}), null, 'no sceneShadows()');
  assert.equal(sunCoverage({sceneShadows: true, extent: undefined, quality: 'ultra'}), null, 'a sun without shadow');
});

test('capacity: at most max blobs, the nearest to the camera kept (ties by entity), candidate order preserved', () => {
  const cs = [5, -1, 3, 1, -3].map((x, i) => candidate({entity: 10 + i, x}));
  const all = planBlobs(cs, {max: 5, sun: null, crossfade: 2, camera: [0, 5, 0]});
  assert.equal(all.dropped, 0);
  assert.deepEqual(
    all.kept.map(c => c.entity),
    [10, 11, 12, 13, 14],
  );
  const near = planBlobs(cs, {max: 3, sun: null, crossfade: 2, camera: [0, 5, 0]});
  assert.equal(near.dropped, 2);
  // Distances 5, 1, 3, 1, 3: the two at 1, then the tie at 3 goes to the lower entity (12).
  assert.deepEqual(
    near.kept.map(c => c.entity),
    [11, 12, 13],
  );
  const moved = planBlobs(cs, {max: 1, sun: null, crossfade: 2, camera: [5, 5, 0]});
  assert.deepEqual(
    moved.kept.map(c => c.entity),
    [10],
    'the camera decides who is nearest',
  );
  // Hidden blobs (inside the sun box, or opacity 0) never take capacity.
  const hidden = planBlobs(
    [candidate({entity: 1}), candidate({entity: 2, x: 30}), candidate({entity: 3, opacity: 0})],
    {
      max: 1,
      sun: {extent: 10},
      crossfade: 2,
      camera: [0, 0, 0],
    },
  );
  assert.deepEqual([hidden.kept.map(c => c.entity), hidden.dropped], [[2], 0]);
  assert.equal(hidden.kept[0]!.alpha, 0.5);
});

test('one instanced draw, allocated once at max; it never casts, so it adds 1 draw and 0 shadow casters', () => {
  const t = setup({max: 8});
  const meshes = t.scene.children.filter((c): c is T.InstancedMesh => (c as T.InstancedMesh).isInstancedMesh);
  assert.equal(meshes.length, 1);
  const mesh = meshes[0]!;
  assert.equal(mesh, t.drawing.mesh);
  assert.equal(mesh.instanceMatrix.count, 8, 'capacity allocated once');
  assert.equal(mesh.count, 0);
  assert.equal(mesh.visible, true, 'kept in the scene so its program is prepared before activation');
  assert.deepEqual([mesh.castShadow, mesh.receiveShadow], [false, false]);
  assert.equal(t.drawing.sync(NO_SUN), false, 'nothing to draw: no change');
  assert.equal(t.drawing.stats.draws, 0);
  for (let i = 0; i < 3; i++) t.world.spawn(Transform({x: i * 2, ry: 0.5, scale: 2}), BlobShadow({width: 0.5}));
  t.world.spawn(Transform({x: 9}), BlobShadow({visible: false}));
  t.world.spawn(Transform({x: 9})); // no BlobShadow
  assert.equal(t.drawing.sync(NO_SUN), true);
  assert.deepEqual(
    {...t.drawing.stats},
    {capacity: 8, candidates: 3, drawn: 3, dropped: 0, draws: 1, uploads: 1},
    'three blobs, one draw',
  );
  assert.equal(mesh.count, 3);
  // Placement: on the ground (lifted), scaled by width/depth times the Transform's scale, turned with ry.
  const at = new T.Matrix4(),
    pos = new T.Vector3(),
    rot = new T.Quaternion(),
    size = new T.Vector3();
  mesh.getMatrixAt(1, at);
  at.decompose(pos, rot, size);
  assert.ok(Math.abs(pos.x - 2) < 1e-6 && Math.abs(pos.y - 0.01) < 1e-6 && pos.z === 0);
  assert.ok(Math.abs(size.x - 1) < 1e-6 && Math.abs(size.z - 1.6) < 1e-6);
  assert.ok(Math.abs(new T.Euler().setFromQuaternion(rot).y - 0.5) < 1e-6);
  assert.equal(mesh.geometry.getAttribute('blobAlpha').getX(0), 0.5);
});

test('instance buffers upload only on change: a still world and a moving camera (under capacity) upload nothing', () => {
  const t = setup({max: 4});
  const e = t.world.spawn(Transform({x: 1}), BlobShadow());
  t.world.spawn(Transform({x: -1}), BlobShadow());
  assert.equal(t.drawing.sync(NO_SUN), true);
  const matrixVersion = t.drawing.mesh.instanceMatrix.version,
    alphaVersion = (t.drawing.mesh.geometry.getAttribute('blobAlpha') as T.BufferAttribute).version;
  for (let i = 0; i < 5; i++) assert.equal(t.drawing.sync(NO_SUN), false);
  assert.equal(t.drawing.sync({camera: [40, 2, -9], sun: null}), false, 'the camera only matters over capacity');
  assert.equal(t.drawing.stats.uploads, 1);
  assert.equal(t.drawing.mesh.instanceMatrix.version, matrixVersion);
  assert.equal((t.drawing.mesh.geometry.getAttribute('blobAlpha') as T.BufferAttribute).version, alphaVersion);
  t.world.get(e, Transform)!.z = 3;
  assert.equal(t.drawing.sync(NO_SUN), true, 'a moved entity uploads once');
  assert.equal(t.drawing.sync(NO_SUN), false);
  t.world.get(e, BlobShadow)!.opacity = 0.2;
  assert.equal(t.drawing.sync(NO_SUN), true, 'a changed opacity uploads once');
  t.world.despawn(e);
  assert.equal(t.drawing.sync(NO_SUN), true);
  assert.equal(t.drawing.mesh.count, 1);
  assert.equal(t.drawing.stats.uploads, 4);
  assert.ok(t.drawing.mesh.instanceMatrix.version > matrixVersion);
});

test('the sun hides casters inside its box; Models, non-casters and scenes without sceneShadows keep their blobs', () => {
  const t = setup({max: 8});
  const sun = {camera: [0, 10, 10] as const, sun: {extent: 10}};
  t.world.spawn(Transform({x: 1}), Shape(), BlobShadow()); // a caster inside the box: real shadow, no blob
  t.world.spawn(Transform({x: 30}), Shape(), BlobShadow()); // a caster beyond the box: blob
  t.world.spawn(Transform({x: 2}), Shape(), Shadow({cast: false}), BlobShadow()); // a non-caster: blob
  t.world.spawn(Transform({x: 3}), Shape(), Model(), BlobShadow()); // Models cast no real shadow yet: blob
  t.world.spawn(Transform({x: 4}), BlobShadow()); // no drawn body: blob
  t.drawing.sync(sun);
  assert.deepEqual([t.drawing.stats.candidates, t.drawing.stats.drawn], [5, 4]);
  t.drawing.sync(NO_SUN);
  assert.equal(t.drawing.stats.drawn, 5, 'shadows off (or no sun shadow): every blob');
  const none = setup({max: 8}, null);
  none.world.spawn(Transform({x: 1}), Shape(), BlobShadow());
  none.drawing.sync(sun);
  assert.equal(none.drawing.stats.drawn, 1, 'without sceneShadows() nothing casts, so every blob is drawn');
});

test('overload: the nearest max are drawn, the rest counted, reported once per visit', () => {
  const t = setup({max: 2});
  for (const x of [8, 1, -2, 5]) t.world.spawn(Transform({x}), BlobShadow());
  assert.equal(t.drawing.sync({camera: [0, 4, 0], sun: null}), true);
  assert.deepEqual([t.drawing.stats.drawn, t.drawing.stats.dropped, t.drawing.stats.draws], [2, 2, 1]);
  const xs = [0, 1].map(i => {
    const m = new T.Matrix4();
    t.drawing.mesh.getMatrixAt(i, m);
    return m.elements[12];
  });
  assert.deepEqual(xs, [1, -2]);
  assert.equal(t.drawing.sync({camera: [0, 4, 0], sun: null}), false, 'same camera, same choice: no upload');
  assert.equal(t.drawing.sync({camera: [9, 4, 0], sun: null}), true, 'the camera moved: the nearest change');
  assert.equal(t.reports.length, 1);
  assert.match(t.reports[0]!, /4 blob shadows want drawing but the scene draws at most 2/);
});

test('dispose removes the mesh and releases geometry, material and instance buffers; sync is then inert', () => {
  const t = setup();
  t.world.spawn(Transform(), BlobShadow());
  t.drawing.sync(NO_SUN);
  const disposed: string[] = [];
  t.drawing.mesh.geometry.addEventListener('dispose', () => disposed.push('geometry'));
  (t.drawing.mesh.material as T.Material).addEventListener('dispose', () => disposed.push('material'));
  t.drawing.mesh.addEventListener('dispose', () => disposed.push('instances'));
  t.drawing.dispose();
  t.drawing.dispose();
  assert.deepEqual(disposed, ['geometry', 'material', 'instances'], 'each once');
  assert.equal(t.scene.children.length, 0);
  assert.equal(t.drawing.sync(NO_SUN), false);
  assert.equal(t.drawing.stats.draws, 0);
});
