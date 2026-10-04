import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {World} from '../core/ecs/world';
import {Name, Transform, defineScene, defineSystem, Shape} from './defs';
import {defineScatter, sceneScatter, Scatter, scatterRoot, type ScatterData} from './scatter';
import {createSceneScatter} from './scene-scatter';
import {createSceneSurfaces} from './scene-materials';
import {createSceneResources} from './scene-resources';
import {createPrimitiveGeometries} from './primitive-geometries';
import {defineMaterial, Material} from './material';
import {defineMesh} from './mesh';
import {testScene} from './testing';

const grass = (o: Partial<ScatterData> = {}) =>
  defineScatter({
    shape: {kind: 'cone', size: [0.12, 0.45, 0.12]},
    area: {kind: 'rect', rect: [-5, -5, 5, 5]},
    count: 1400,
    seed: 3,
    ...o,
  });

function setup(limits = {max: 4, instances: 4000}, density = 1) {
  const world = new World(),
    scene = new T.Scene(),
    resources = createSceneResources(),
    reports: unknown[] = [];
  const surfaces = createSceneSurfaces({
    library: null,
    resources,
    signal: new AbortController().signal,
    anisotropy: 1,
    changed() {},
    report: e => reports.push(e),
  });
  const geometries = createPrimitiveGeometries(resources);
  const drawing = createSceneScatter({
    world,
    scene,
    limits,
    root: scatterRoot('test', null),
    density,
    surfaces,
    geometries,
    resources,
    mask: () => 1,
    report: e => reports.push(e),
  });
  const meshes = () => scene.children.filter((c): c is T.InstancedMesh => (c as T.InstancedMesh).isInstancedMesh);
  return {world, scene, resources, reports, drawing, meshes};
}

test('one instanced draw per scatter; triangles count every copy', () => {
  const t = setup();
  const e = t.world.spawn();
  t.world.add(e, Transform({x: 2}));
  t.world.add(e, Name({name: 'grass'}));
  t.world.add(e, grass());
  assert.equal(t.drawing.sync(), true);
  const [mesh] = t.meshes();
  assert.equal(t.meshes().length, 1);
  assert.equal(mesh!.count, 1400);
  assert.equal(mesh!.name, 'grass');
  assert.equal(mesh!.position.x, 2, 'the Transform is the origin');
  const perCone = mesh!.geometry.index!.count / 3;
  assert.deepEqual(
    [t.drawing.stats.draws, t.drawing.stats.triangles, t.drawing.stats.instances],
    [1, perCone * 1400, 1400],
  );
  assert.deepEqual(t.drawing.stats.list, [
    {name: 'grass', instances: 1400, requested: 1400, triangles: perCone * 1400},
  ]);
  assert.ok(mesh!.boundingSphere && mesh!.boundingSphere.radius > 5, 'bounds cover every copy');
});

test('static buffers: nothing is rewritten when nothing changed; a move keeps them; new data rebuilds once', () => {
  const t = setup();
  const e = t.world.spawn();
  t.world.add(e, Transform());
  t.world.add(e, grass());
  t.drawing.sync();
  const [mesh] = t.meshes();
  const matrices = mesh!.instanceMatrix,
    version = matrices.version;
  assert.equal(t.drawing.sync(), false, 'idle: no change');
  t.world.get(e, Transform)!.x = 3;
  assert.equal(t.drawing.sync(), true);
  assert.equal(t.meshes()[0], mesh, 'same mesh');
  assert.equal(mesh!.instanceMatrix, matrices, 'same instance buffer');
  assert.equal(matrices.version, version, 'not written again');
  let disposed = 0;
  mesh!.addEventListener('dispose', () => disposed++);
  t.world.add(e, grass({count: 200}));
  assert.equal(t.drawing.sync(), true);
  assert.equal(disposed, 1, 'the old instance buffers are freed');
  assert.equal(t.meshes().length, 1);
  assert.equal(t.meshes()[0]!.count, 200);
});

test('a Material on the entity shades every copy; colour jitter uses per-copy colours', () => {
  const t = setup();
  const e = t.world.spawn();
  t.world.add(e, Transform());
  t.world.add(e, grass({colorJitter: [0.05, 0.1, 0.1], color: 0x2f5a2c}));
  t.world.add(e, defineMaterial({shading: 'toon'}));
  t.drawing.sync();
  const [mesh] = t.meshes();
  assert.equal((mesh!.material as T.Material).type, 'MeshToonMaterial');
  assert.equal(mesh!.instanceColor!.count, 1400);
  assert.equal((mesh!.material as T.MeshToonMaterial).color.getHex(), 0xffffff, 'copies carry the colour');
  t.world.get(e, Material)!.emissive = 0x112233;
  assert.equal(t.drawing.sync(), true);
  assert.equal(t.meshes()[0], mesh, 'a look change in the same class keeps the instances');
  assert.equal((mesh!.material as T.MeshToonMaterial).emissive.getHex(), 0x112233);
});

test('a mesh scatter owns its geometry and keeps vertex colours', () => {
  const t = setup();
  const rock = defineMesh({
    positions: [0, 0.4, 0, 0.3, 0, 0, 0, 0, 0.3, -0.3, 0, 0],
    indices: [0, 2, 1, 0, 3, 2],
    colors: [0.5, 0.5, 0.5, 0.4, 0.4, 0.4, 0.3, 0.3, 0.3, 0.2, 0.2, 0.2],
  }).value;
  const e = t.world.spawn();
  t.world.add(e, Transform());
  t.world.add(e, defineScatter({mesh: rock, area: {kind: 'ring', radius: [1, 3]}, count: 60, seed: 4}));
  t.drawing.sync();
  const [mesh] = t.meshes();
  assert.equal(mesh!.count, 60);
  assert.equal((mesh!.material as T.Material).vertexColors, true);
  let geometryDisposed = 0;
  mesh!.geometry.addEventListener('dispose', () => geometryDisposed++);
  t.world.remove(e, Scatter);
  assert.equal(t.drawing.sync(), true);
  assert.equal(t.meshes().length, 0);
  assert.equal(geometryDisposed, 1, 'its own geometry is released with it');
});

test('overflow is refused and reported; freed capacity admits a refused scatter; essential ones come first', () => {
  const t = setup({max: 3, instances: 2000});
  const spawn = (s: ReturnType<typeof grass>) => {
    const e = t.world.spawn();
    t.world.add(e, Transform());
    t.world.add(e, s);
    return e;
  };
  const a = spawn(grass({count: 1500})),
    b = spawn(grass({count: 1000})),
    c = spawn(grass({count: 100, essential: true}));
  t.drawing.sync();
  assert.deepEqual(
    t.drawing.stats.list.map(l => l.instances).sort((x, y) => x - y),
    [100, 1500],
    'the essential scatter first, then entity order; the third does not fit',
  );
  assert.deepEqual(t.drawing.stats.refused, {scatters: 0, instances: 1, invalid: 0});
  assert.equal(t.reports.length, 1);
  assert.match(String(t.reports[0]), /refused/);
  t.drawing.sync();
  t.drawing.sync();
  assert.deepEqual(t.drawing.stats.refused, {scatters: 0, instances: 1, invalid: 0}, 'not offered again every frame');
  t.world.despawn(a);
  t.drawing.sync();
  t.drawing.sync();
  assert.deepEqual(
    t.drawing.stats.list.map(l => l.instances).sort((x, y) => x - y),
    [100, 1000],
    'b admitted once a went',
  );
  assert.ok(t.world.has(b, Scatter) && t.world.has(c, Scatter));
});

test('invalid data is refused and reported once; leaving disposes everything', () => {
  const t = setup();
  const e = t.world.spawn();
  t.world.add(e, Transform());
  const bad = {...grass().value, count: -1};
  t.world.add(e, Scatter(bad));
  t.drawing.sync();
  t.drawing.sync();
  assert.equal(t.drawing.stats.refused.invalid, 1);
  assert.equal(t.meshes().length, 0);
  t.world.add(e, grass());
  t.drawing.sync();
  const [mesh] = t.meshes();
  let disposed = 0;
  mesh!.addEventListener('dispose', () => disposed++);
  const geometry = mesh!.geometry;
  let geometryDisposed = 0;
  geometry.addEventListener('dispose', () => geometryDisposed++);
  t.drawing.dispose();
  assert.equal(disposed, 1);
  assert.equal(geometryDisposed, 1, 'the shared primitive lease is returned with its last user');
  assert.equal(t.meshes().length, 0);
  assert.equal(t.drawing.stats.draws, 0);
});

test('scatter never shifts gameplay ctx.random; testScene reports placement and refusals headless', async () => {
  const seen: number[][] = [];
  const roll = defineSystem({id: 'roll', run: ctx => void seen.at(-1)!.push(ctx.random())});
  const scene = (withScatter: boolean) =>
    defineScene({
      id: 'court',
      title: 'Court',
      ...(withScatter ? {scatter: sceneScatter({instances: 2000})} : {}),
      entities: [
        [Transform(), Shape()],
        ...(withScatter
          ? [
              [Transform(), grass()],
              [Transform(), grass({count: 900})],
            ]
          : []),
      ],
      systems: [roll],
    });
  for (const withScatter of [false, true]) {
    seen.push([]);
    const t = await testScene(scene(withScatter), {seed: 42});
    t.run(0.2);
    if (withScatter) {
      assert.deepEqual(t.scatter.stats?.refused, {scatters: 0, instances: 1, invalid: 0});
      assert.equal(t.scatter.reports.length, 1);
      const [first] = [...t.world.query(Scatter)][0]!;
      assert.equal(t.scatter.placement(first)?.count, 1400);
    } else assert.equal(t.scatter.stats, null);
    t.dispose();
  }
  assert.deepEqual(seen[0], seen[1], 'the same gameplay draws with and without scatter');
  const missing = await testScene(defineScene({id: 'bare', title: 'Bare', entities: [[Transform(), grass()]]}));
  assert.match(missing.scatter.reports[0]!, /sceneScatter/);
  const low = await testScene(scene(true), {scatterDensity: 0.35});
  const [entity] = [...low.world.query(Scatter)][0]!;
  assert.ok(low.scatter.placement(entity)!.count < 700, 'the density knob thins headless too');
});
