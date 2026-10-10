import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {viewRay} from '../../author';
import {generateGridLevel, marchRay, seeded, type GridLevel} from './grid-fixture';
import {
  buildCellPvs,
  cellCameraFromView,
  createCellCuller,
  createCellGraph,
  createCellView,
  createCellViewResult,
  createViewCellCamera,
  type CellViewResult,
} from './index';

type V3 = [number, number, number];
const limitsFor = (level: GridLevel) => ({
  maxCells: level.cells.length,
  maxPortals: Math.max(1, level.portals.length),
  maxPortalVertices: 4,
});

/** A random camera inside a random room, sometimes pressed against one of its openings. */
function randomCamera(level: GridLevel, random: () => number) {
  const room = Math.floor(random() * level.cells.length);
  const box = level.cells[room]!;
  const m = 0.05;
  const position: V3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) position[k] = box.min[k]! + m + (box.max[k]! - box.min[k]! - 2 * m) * random();
  const near = level.openings.filter(op => op.a === room || op.b === room);
  if (near.length && random() < 0.3) {
    // Within the tolerance of the opening (or just outside it) on this room's side.
    const op = near[Math.floor(random() * near.length)]!;
    const others = [0, 1, 2].filter(k => k !== op.axis) as [number, number];
    position[others[0]] = op.lo[0] + (op.hi[0] - op.lo[0]) * (0.1 + 0.8 * random());
    position[others[1]] = op.lo[1] + (op.hi[1] - op.lo[1]) * (0.1 + 0.8 * random());
    const inward = box.min[op.axis] === op.at ? 1 : -1;
    position[op.axis] = op.at + inward * [1e-5, 5e-4, 2e-3, 0.02][Math.floor(random() * 4)]!;
  }
  const yaw = random() * 2 * Math.PI,
    pitch = (random() - 0.5) * 2.4;
  const target: V3 = [
    position[0] + Math.cos(yaw) * Math.cos(pitch),
    position[1] + Math.sin(pitch),
    position[2] + Math.sin(yaw) * Math.cos(pitch),
  ];
  return {room, view: {camera: {position, target, fov: 40 + 70 * random()}, aspect: 0.5 + 1.7 * random()}};
}

/** Rooms seen by a grid of jittered camera rays marched through open openings. */
function reference(level: GridLevel, room: number, view: Parameters<typeof viewRay>[0], random: () => number) {
  const seen = new Uint8Array(level.cells.length);
  const steps = 40;
  for (let i = 0; i < steps; i++)
    for (let j = 0; j < steps; j++) {
      const x = -1 + (2 * (i + random())) / steps,
        y = -1 + (2 * (j + random())) / steps;
      const ray = viewRay(view, {x, y});
      marchRay(level, room, ray.origin, ray.dir, 500, seen);
    }
  // The exact screen corners and edges, where narrowing is tightest.
  for (const x of [-1, 0, 1])
    for (const y of [-1, 0, 1]) {
      const ray = viewRay(view, {x, y});
      marchRay(level, room, ray.origin, ray.dir, 500, seen);
    }
  return seen;
}

test('seeded grid-of-rooms levels: the portal flood never hides a room the ray-marched reference sees', () => {
  let cameras = 0,
    refTotal = 0,
    kitTotal = 0,
    cellTotal = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const random = seeded(seed);
    const level = generateGridLevel(random, {
      cols: 3 + (seed % 4),
      rows: 3 + ((seed >> 2) % 3),
      floors: 1 + (seed % 2),
      doorChance: 0.75,
      openChance: 0.8,
    });
    const graph = createCellGraph({cells: level.cells, portals: level.portals, limits: limitsFor(level)});
    const pvs = buildCellPvs(graph);
    const n = graph.cellCount;
    const plain = createCellView(graph, {maxVisits: n * n, maxDepth: n, outside: 'all'});
    const filtered = createCellView(graph, {maxVisits: n * n, maxDepth: n, outside: 'all', pvs});
    const a = createCellViewResult(graph),
      b = createCellViewResult(graph);
    for (let k = 0; k < 40; k++) {
      // Doors open and close between frames.
      if (level.openings.length && random() < 0.3) {
        const p = Math.floor(random() * level.openings.length);
        level.openings[p]!.open = !level.openings[p]!.open;
        graph.setOpen(p, level.openings[p]!.open);
      }
      const {room, view} = randomCamera(level, random);
      const camera = cellCameraFromView(view, createViewCellCamera());
      assert.equal(plain.update(camera, a), 'portals', `seed ${seed}: completed without the overflow fallback`);
      filtered.update(camera, b);
      const seen = reference(level, room, view, random);
      for (let c = 0; c < n; c++) {
        if (seen[c]) assert.equal(a.visible[c], 1, `seed ${seed} camera ${k}: reference sees room ${c}`);
        if (a.visible[c]) assert.ok(pvs.has(room, c) || a.cameraCells > 1, 'portal set within the PVS row');
      }
      assert.deepEqual([...b.visible], [...a.visible], 'a full-depth PVS pre-filter changes nothing');
      cameras++;
      cellTotal += n;
      kitTotal += a.count;
      for (let c = 0; c < n; c++) refTotal += seen[c]!;
    }
  }
  // Tightness, not just safety: the flood keeps well under every room on these levels.
  assert.ok(kitTotal < 0.6 * cellTotal, `visible ${kitTotal} of ${cellTotal}`);
  assert.ok(kitTotal >= refTotal);
  assert.equal(cameras, 960);
});

test('generated interior fixture: objects culled per camera on an 8 x 8 grid of rooms', () => {
  const random = seeded(2026);
  const level = generateGridLevel(random, {cols: 8, rows: 8, floors: 1, doorChance: 0.7, openChance: 0.85});
  const graph = createCellGraph({cells: level.cells, portals: level.portals, limits: limitsFor(level)});
  const perRoom = 12,
    n = graph.cellCount;
  const objects = Array.from({length: n * perRoom}, () => ({visible: true}));
  let writes = 0;
  const culler = createCellCuller<{visible: boolean}>({
    cellCount: n,
    maxObjects: objects.length,
    maxCellsPerObject: 1,
    sink: {
      set(o, v) {
        writes++;
        o.visible = v;
      },
    },
  });
  objects.forEach((o, i) => culler.add(o, Math.floor(i / perRoom)));
  const view = createCellView(graph, {maxVisits: 4 * n, maxDepth: n, outside: 'all'});
  const out: CellViewResult = createCellViewResult(graph);
  let culled = 0;
  const cameras = 100;
  for (let k = 0; k < cameras; k++) {
    const {view: v} = randomCamera(level, random);
    view.update(cellCameraFromView(v, createViewCellCamera()), out);
    culler.apply(out);
    const s = culler.stats();
    assert.equal(s.visibleObjects + s.culledObjects, objects.length);
    assert.equal(s.visibleObjects, out.count * perRoom);
    assert.equal(objects.filter(o => o.visible).length, s.visibleObjects);
    culled += s.culledObjects;
  }
  const mean = culled / cameras / objects.length;
  assert.ok(mean > 0.7, `mean culled share ${mean.toFixed(3)}`);
  // Render on change: fewer writes than a per-frame rewrite of every object.
  assert.ok(writes < (cameras * objects.length) / 4, `writes ${writes}`);
});

test('three.js cameras: wide, asymmetric, parented, on portal planes and corners, rays aimed at every open portal', () => {
  let cameras = 0,
    aimed = 0;
  for (let seed = 101; seed <= 112; seed++) {
    const random = seeded(seed);
    const level = generateGridLevel(random, {cols: 4, rows: 3, floors: 2, doorChance: 0.8, openChance: 0.8});
    const graph = createCellGraph({cells: level.cells, portals: level.portals, limits: limitsFor(level)});
    const n = graph.cellCount;
    const view = createCellView(graph, {maxVisits: n * n, maxDepth: n, outside: 'all'});
    const out = createCellViewResult(graph);
    const rig = new THREE.Group();
    const camera = new THREE.PerspectiveCamera();
    rig.add(camera);
    const worldPos = new THREE.Vector3(),
      vp = new THREE.Matrix4(),
      position: V3 = [0, 0, 0];
    for (let k = 0; k < 40; k++) {
      // Position: inside a room, exactly on an opening's plane, just past it, or at a room corner.
      const room = Math.floor(random() * n),
        box = level.cells[room]!;
      const p = new THREE.Vector3();
      for (let a = 0; a < 3; a++) p.setComponent(a, box.min[a]! + (box.max[a]! - box.min[a]!) * random());
      const kind = random();
      const ops = level.openings;
      if (kind < 0.45 && ops.length) {
        const op = ops[Math.floor(random() * ops.length)]!;
        const others = [0, 1, 2].filter(a => a !== op.axis) as [number, number];
        p.setComponent(others[0], op.lo[0] + (op.hi[0] - op.lo[0]) * random());
        p.setComponent(others[1], op.lo[1] + (op.hi[1] - op.lo[1]) * random());
        p.setComponent(op.axis, op.at + [0, 0, 1e-7, -1e-7, 1e-4, -1e-4][Math.floor(random() * 6)]!);
      } else if (kind < 0.6) {
        for (let a = 0; a < 3; a++) p.setComponent(a, random() < 0.5 ? box.min[a]! : box.max[a]!);
      }
      // A parented camera: rotated, offset rig; the kit gets the world position and world matrices.
      rig.position.set(random() * 3, random() * 3, random() * 3);
      rig.rotation.set(random(), random() * 6, random());
      rig.updateMatrixWorld(true);
      camera.position.copy(rig.worldToLocal(p.clone()));
      camera.fov = 30 + 140 * random();
      camera.aspect = 0.3 + 2.7 * random();
      camera.near = 0.01 + 0.5 * random();
      camera.far = 500;
      if (random() < 0.4) {
        const w = 1000,
          h = 1000;
        const sw = 200 + 800 * random(),
          sh = 200 + 800 * random();
        camera.setViewOffset(w, h, (w - sw) * random(), (h - sh) * random(), sw, sh);
      } else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      const yaw = random() * 2 * Math.PI,
        pitch = (random() - 0.5) * 3;
      camera.lookAt(
        p.x + Math.cos(yaw) * Math.cos(pitch),
        p.y + Math.sin(pitch),
        p.z + Math.sin(yaw) * Math.cos(pitch),
      );
      camera.updateMatrixWorld(true);
      camera.getWorldPosition(worldPos);
      worldPos.toArray(position);
      vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      view.update({position, viewProjection: vp.elements}, out);
      assert.notEqual(out.status, 'overflow');

      const seen = new Uint8Array(n);
      const march = (target: THREE.Vector3) => {
        const dir = target.clone().sub(worldPos).normalize();
        const start = worldPos.clone().addScaledVector(dir, 1e-6);
        const cell = level.cells.findIndex(
          b =>
            start.x > b.min[0] &&
            start.x < b.max[0] &&
            start.y > b.min[1] &&
            start.y < b.max[1] &&
            start.z > b.min[2] &&
            start.z < b.max[2],
        );
        if (cell >= 0) marchRay(level, cell, position, dir.toArray(), 500, seen);
      };
      const ndc = new THREE.Vector3();
      for (let i = 0; i <= 24; i++)
        for (let j = 0; j <= 24; j++) {
          const x = i === 0 || i === 24 ? -1 + i / 12 : -1 + (2 * (i - 0.5 + random() - 0.5)) / 24,
            y = j === 0 || j === 24 ? -1 + j / 12 : -1 + (2 * (j - 0.5 + random() - 0.5)) / 24;
          march(ndc.set(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)), 0).unproject(camera));
        }
      // Rays aimed at points of every open opening that lie in the view.
      const local = new THREE.Vector3();
      for (const op of level.openings) {
        if (!op.open) continue;
        const others = [0, 1, 2].filter(a => a !== op.axis) as [number, number];
        for (let s = 0; s < 9; s++) {
          const u = s < 4 ? [0.001, 0.999][s & 1]! : random(),
            v = s < 4 ? [0.001, 0.999][s >> 1]! : random();
          const q = new THREE.Vector3();
          q.setComponent(op.axis, op.at);
          q.setComponent(others[0], op.lo[0] + (op.hi[0] - op.lo[0]) * u);
          q.setComponent(others[1], op.lo[1] + (op.hi[1] - op.lo[1]) * v);
          local.copy(q).applyMatrix4(camera.matrixWorldInverse);
          if (local.z >= 0) continue;
          ndc.copy(q).project(camera);
          if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) continue;
          aimed++;
          march(q);
        }
      }
      for (let c = 0; c < n; c++)
        if (seen[c]) assert.equal(out.visible[c], 1, `seed ${seed} camera ${k}: reference sees cell ${c}`);
      cameras++;
    }
  }
  assert.equal(cameras, 480);
  assert.ok(aimed > 1000, `aimed rays ${aimed}`);
});
