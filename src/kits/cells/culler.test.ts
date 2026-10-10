import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Shape, Transform} from '../../author';
import {World} from '../../core/ecs/world';
import {
  cellCameraFromView,
  createCellCuller,
  createCellGraph,
  createCellView,
  createCellViewResult,
  createViewCellCamera,
  entityVisibility,
  objectVisibility,
  type CellViewResult,
  type CellVisibilitySink,
} from './index';

/** A fake view result over `n` cells with the given ones visible. */
const result = (n: number, on: number[]): CellViewResult => {
  const visible = new Uint8Array(n);
  for (const c of on) visible[c] = 1;
  return {
    visible,
    cells: Int32Array.from(on),
    count: on.length,
    rects: new Float64Array(4 * n),
    status: 'portals',
    cameraCells: 1,
    visits: 1,
    depthLimited: 0,
    changed: true,
  };
};
interface Thing {
  id: number;
  visible: boolean;
}
const spySink = () => {
  const log: string[] = [];
  let commits = 0;
  const sink: CellVisibilitySink<Thing> = {
    set(t, v) {
      log.push(`${t.id}:${v ? 'on' : 'off'}`);
      t.visible = v;
    },
    commit() {
      commits++;
    },
  };
  return {sink, log, commits: () => commits};
};

test('apply writes only targets whose visibility flips, and nothing when the cell set is unchanged', () => {
  const {sink, log, commits} = spySink();
  const culler = createCellCuller({cellCount: 4, maxObjects: 8, maxCellsPerObject: 2, sink});
  const things = [0, 1, 2, 3].map(id => ({id, visible: true}));
  things.forEach((t, i) => culler.add(t, i));
  const spanning = {id: 9, visible: true};
  culler.add(spanning, [1, 2]);
  assert.equal(culler.apply(result(4, [0, 1])), 5, 'the first apply writes every target once');
  assert.deepEqual(log.splice(0), ['0:on', '1:on', '2:off', '3:off', '9:on']);
  assert.equal(commits(), 1);
  assert.equal(culler.apply(result(4, [0, 1])), 0);
  assert.equal(commits(), 1, 'no commit without writes');
  // Cell 1 hides, cell 2 shows: the spanning target stays visible and is not written.
  assert.equal(culler.apply(result(4, [0, 2])), 2);
  assert.deepEqual(log.splice(0), ['1:off', '2:on']);
  assert.deepEqual(culler.stats(), {objects: 5, visibleObjects: 3, culledObjects: 2, visibleCells: 2, written: 2});
  assert.equal(culler.isVisible(1), false);
});

test('remove and dispose restore what the culler hid; handles are reused within maxObjects', () => {
  const {sink, log} = spySink();
  const culler = createCellCuller({cellCount: 2, maxObjects: 2, maxCellsPerObject: 1, sink});
  const a = {id: 0, visible: true},
    b = {id: 1, visible: true};
  const ha = culler.add(a, 0),
    hb = culler.add(b, 1);
  assert.equal(culler.add({id: 2, visible: true}, 0), -1, 'saturated');
  culler.apply(result(2, [0]));
  culler.remove(hb);
  assert.equal(b.visible, true, 'restored on removal');
  assert.throws(() => culler.remove(hb));
  const hc = culler.add({id: 3, visible: true}, 1);
  assert.equal(hc, hb, 'a freed handle is reused');
  culler.apply(result(2, [0]));
  assert.deepEqual(log.slice(-1), ['3:off'], 'a new target is written on the next apply even when nothing moved');
  culler.dispose();
  culler.dispose();
  assert.equal(log.at(-1), '3:on');
  assert.equal(a.visible, true);
  assert.throws(() => culler.apply(result(2, [0])));
  assert.throws(() => culler.add(a, 0));
  void ha;
});

test('a sink that calls back into the culler is refused; a throwing sink is recovered by the next apply', () => {
  let culler!: ReturnType<typeof createCellCuller<Thing>>;
  let reenter = true,
    fail = -1;
  const culled: number[] = [];
  culler = createCellCuller<Thing>({
    cellCount: 3,
    maxObjects: 4,
    maxCellsPerObject: 1,
    sink: {
      set(t, v) {
        if (reenter) culler.apply(result(3, []));
        if (t.id === fail) throw new Error('sink failed');
        t.visible = v;
        if (!v) culled.push(t.id);
      },
    },
  });
  const things = [0, 1, 2].map(id => ({id, visible: true}));
  things.forEach((t, i) => culler.add(t, i));
  assert.throws(() => culler.apply(result(3, [0])), /busy/);
  reenter = false;
  fail = 1;
  assert.throws(() => culler.apply(result(3, [0])), /sink failed/);
  fail = -1;
  culler.apply(result(3, [0]));
  assert.deepEqual(
    things.map(t => t.visible),
    [true, false, false],
    'every target reaches the right state after the failure',
  );
  assert.equal(culler.stats().culledObjects, 2);
});

test('construction and registration refuse invalid input', () => {
  const sink = objectVisibility<Thing>();
  assert.throws(() => createCellCuller({cellCount: 0, maxObjects: 1, maxCellsPerObject: 1, sink}));
  assert.throws(() => createCellCuller({cellCount: 1, maxObjects: 0, maxCellsPerObject: 1, sink}));
  assert.throws(() => createCellCuller({cellCount: 1, maxObjects: 1, maxCellsPerObject: 65, sink}));
  assert.throws(() => createCellCuller({cellCount: 1, maxObjects: 1, maxCellsPerObject: 1, sink: {} as never}));
  const culler = createCellCuller({cellCount: 2, maxObjects: 2, maxCellsPerObject: 1, sink});
  assert.throws(() => culler.add({id: 0, visible: true}, 2));
  assert.throws(() => culler.add({id: 0, visible: true}, [0, 1]));
  assert.throws(() => culler.add({id: 0, visible: true}, []));
  assert.throws(() => culler.apply(result(3, [])));
});

test('composition: ECS Shape entities and three.js objects through the real World and camera matrices', () => {
  // Three rooms along +x with doors in x = 4 and x = 8.
  const doorAt = (a: number, b: number, x: number) => ({
    a,
    b,
    points: [
      [x, 0, 1.5],
      [x, 2, 1.5],
      [x, 2, 2.5],
      [x, 0, 2.5],
    ] as [number, number, number][],
  });
  const graph = createCellGraph({
    cells: [0, 4, 8].map(x0 => ({min: [x0, 0, 0] as const, max: [x0 + 4, 3, 4] as const})),
    portals: [doorAt(0, 1, 4), doorAt(1, 2, 8)],
    limits: {maxCells: 3, maxPortals: 2, maxPortalVertices: 4},
  });
  const view = createCellView(graph, {maxVisits: 16, maxDepth: 3, outside: 'all'});
  const out = createCellViewResult(graph);

  // The engine view's matrix matches the three.js camera the renderer builds from it.
  const camera = {
    position: [1, 1.2, 2] as [number, number, number],
    target: [12, 1, 2.2] as [number, number, number],
    fov: 60,
  };
  const mine = cellCameraFromView({camera, aspect: 1.5}, createViewCellCamera());
  const three = new THREE.PerspectiveCamera(60, 1.5, 0.1, 500);
  three.position.set(...camera.position);
  three.lookAt(...camera.target);
  three.updateMatrixWorld();
  const vp = new THREE.Matrix4().multiplyMatrices(three.projectionMatrix, three.matrixWorldInverse);
  vp.elements.forEach((e, i) => assert.ok(Math.abs(e - mine.viewProjection[i]!) < 1e-9, `element ${i}`));
  const straightDown = cellCameraFromView(
    {camera: {position: [2, 2, 2], target: [2, 0, 2], fov: 50}, aspect: 1},
    createViewCellCamera(),
  );
  three.position.set(2, 2, 2);
  three.lookAt(2, 0, 2);
  three.fov = 50;
  three.aspect = 1;
  three.updateProjectionMatrix();
  three.updateMatrixWorld();
  vp.multiplyMatrices(three.projectionMatrix, three.matrixWorldInverse);
  vp.elements.forEach((e, i) => assert.ok(Math.abs(e - straightDown.viewProjection[i]!) < 1e-9, `down ${i}`));

  // ECS: Shape.visible on entities, the world version marks the change once per apply.
  const world = new World();
  const entities = [0, 1, 2].map(c => world.spawn(Transform({x: 4 * c + 2, z: 2}), Shape({kind: 'box'})));
  const ecs = createCellCuller({
    cellCount: 3,
    maxObjects: 8,
    maxCellsPerObject: 1,
    sink: entityVisibility(world, Shape),
  });
  entities.forEach((e, c) => ecs.add(e, c));
  // three.js: Object3D.visible on meshes under a group; frustum culling still runs on the visible ones.
  const meshes = [0, 1, 2].map(() => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  let renders = 0;
  const objs = createCellCuller<THREE.Object3D>({
    cellCount: 3,
    maxObjects: 8,
    maxCellsPerObject: 1,
    sink: objectVisibility(() => renders++),
  });
  meshes.forEach((m, c) => objs.add(m, c));
  meshes.forEach(m => assert.equal(m.frustumCulled, true));

  const frame = (position: [number, number, number], target: [number, number, number]) => {
    view.update(cellCameraFromView({camera: {position, target, fov: 60}, aspect: 1.5}, mine), out);
    ecs.apply(out);
    objs.apply(out);
  };
  frame([1, 1, 2], [12, 1, 2]);
  assert.deepEqual(
    entities.map(e => world.get(e, Shape)!.visible),
    [true, true, true],
  );
  // Turn around in room 0: rooms 1 and 2 hide.
  frame([1, 1, 2], [-5, 1, 2]);
  assert.deepEqual(
    entities.map(e => world.get(e, Shape)!.visible),
    [true, false, false],
  );
  assert.deepEqual(
    meshes.map(m => m.visible),
    [true, false, false],
  );
  const version = world.version,
    before = renders;
  // A still camera: no recompute, no writes, no world change, no render request.
  for (let i = 0; i < 5; i++) frame([1, 1, 2], [-5, 1, 2]);
  assert.equal(out.changed, false);
  assert.equal(world.version, version);
  assert.equal(renders, before);
  // A despawned entity is skipped by the sink, not an error.
  world.despawn(entities[1]!);
  frame([1, 1, 2], [12, 1, 2]);
  assert.equal(world.get(entities[2]!, Shape)!.visible, true);
  assert.equal(world.version, version + 2, 'one despawn and one touch for the apply');
});

test('remove and dispose show targets left unknown by resync or a throwing sink; a failed dispose can be retried', () => {
  let failId = -1;
  const sink: CellVisibilitySink<Thing> = {
    set(t, v) {
      if (t.id === failId) throw new Error('sink failed');
      t.visible = v;
    },
  };
  // resync, then remove: the hidden target is shown although its state is unknown.
  let culler = createCellCuller<Thing>({cellCount: 2, maxObjects: 4, maxCellsPerObject: 1, sink});
  const a = {id: 0, visible: true},
    b = {id: 1, visible: true};
  const ha = culler.add(a, 0);
  culler.add(b, 1);
  culler.apply(result(2, []));
  culler.resync();
  culler.remove(ha);
  assert.equal(a.visible, true);
  // A throwing sink during apply, then dispose: every target ends shown.
  failId = 1;
  culler.add(a, 0);
  assert.throws(() => culler.apply(result(2, [0])));
  failId = -1;
  culler.dispose();
  assert.deepEqual([a.visible, b.visible], [true, true]);

  // A sink throwing mid-dispose: not disposed, the retry finishes the rest.
  culler = createCellCuller<Thing>({cellCount: 3, maxObjects: 4, maxCellsPerObject: 1, sink});
  const things = [0, 1, 2].map(id => ({id, visible: true}));
  things.forEach((t, i) => culler.add(t, i));
  culler.apply(result(3, []));
  failId = 1;
  assert.throws(() => culler.dispose(), /sink failed/);
  assert.deepEqual(
    things.map(t => t.visible),
    [true, false, false],
  );
  assert.doesNotThrow(() => culler.apply(result(3, [])), 'still usable after a failed dispose');
  failId = -1;
  culler.dispose();
  assert.deepEqual(
    things.map(t => t.visible),
    [true, true, true],
  );
  assert.throws(() => culler.apply(result(3, [])), /disposed/);
});

test('seeded model fuzz: no target ends hidden after remove or dispose, and every clean apply matches its cells', () => {
  const random = (() => {
    let s = 0x9e3779b9;
    return () => {
      s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
      return s / 4294967296;
    };
  })();
  for (let round = 0; round < 60; round++) {
    const n = 2 + Math.floor(random() * 5);
    let failing = false;
    const sink: CellVisibilitySink<Thing & {cells: number[]}> = {
      set(t, v) {
        if (failing && random() < 0.5) throw new Error('sink failed');
        t.visible = v;
      },
    };
    const culler = createCellCuller({cellCount: n, maxObjects: 6, maxCellsPerObject: 2, sink});
    const live = new Map<number, Thing & {cells: number[]}>();
    const removed: (Thing & {cells: number[]})[] = [];
    for (let step = 0; step < 80; step++) {
      failing = random() < 0.25;
      const op = random();
      try {
        if (op < 0.25) {
          const cells = [Math.floor(random() * n)];
          if (random() < 0.4) cells.push((cells[0]! + 1) % n);
          const t = {id: step, visible: random() < 0.5, cells};
          const h = culler.add(t, cells);
          if (h >= 0) live.set(h, t);
        } else if (op < 0.4 && live.size) {
          const h = [...live.keys()][Math.floor(random() * live.size)]!;
          const t = live.get(h)!;
          culler.remove(h);
          live.delete(h);
          removed.push(t);
          assert.equal(t.visible, true, 'shown after a successful remove');
        } else if (op < 0.48) culler.resync();
        else {
          const on = Array.from({length: n}, (_, c) => c).filter(() => random() < 0.4);
          const r = result(n, on);
          culler.apply(r);
          for (const t of live.values())
            assert.equal(
              t.visible,
              t.cells.some(c => r.visible[c] === 1),
              'a clean apply matches the cells',
            );
        }
      } catch (error) {
        assert.match(String(error), /sink failed/);
      }
    }
    failing = false;
    culler.dispose();
    for (const t of [...live.values(), ...removed]) assert.equal(t.visible, true, 'shown after dispose');
  }
});
