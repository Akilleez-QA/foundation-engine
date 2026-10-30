import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  buildCellPvs,
  cellCameraFromView,
  createCellGraph,
  createCellView,
  createCellViewResult,
  createViewCellCamera,
  type CellBox,
  type CellVec3,
  type PortalInput,
} from './index';

const limits = {maxCells: 16, maxPortals: 16, maxPortalVertices: 8};
const box = (x0: number, x1: number, z0 = 0, z1 = 4): CellBox => ({min: [x0, 0, z0], max: [x1, 3, z1]});
/** A door in the wall x = at, y 0..2, z 1.5..2.5. */
const door = (a: number, b: number, at: number, open = true): PortalInput => ({
  a,
  b,
  open,
  points: [
    [at, 0, 1.5],
    [at, 2, 1.5],
    [at, 2, 2.5],
    [at, 0, 2.5],
  ],
});
/** Three rooms in a row along +x. */
const corridor = () =>
  createCellGraph({cells: [box(0, 4), box(4, 8), box(8, 12)], portals: [door(0, 1, 4), door(1, 2, 8)], limits});
const cam = (position: CellVec3, target: CellVec3, fov = 60, aspect = 1.5) =>
  cellCameraFromView({camera: {position: [...position], target: [...target], fov}, aspect}, createViewCellCamera());
const visibleOf = (r: {cells: Int32Array; count: number}) => [...r.cells.subarray(0, r.count)];

test('graph construction refuses malformed and over-limit input before retaining anything', () => {
  const ok = {cells: [box(0, 4), box(4, 8)], portals: [door(0, 1, 4)], limits};
  assert.doesNotThrow(() => createCellGraph(ok));
  const bad: [string, unknown][] = [
    ['min > max', {...ok, cells: [{min: [1, 0, 0], max: [0, 3, 4]}, box(4, 8)]}],
    ['non-finite', {...ok, cells: [{min: [0, 0, NaN], max: [4, 3, 4]}, box(4, 8)]}],
    ['self portal', {...ok, portals: [door(0, 0, 4)]}],
    ['missing cell', {...ok, portals: [door(0, 5, 4)]}],
    ['outside cell', {...ok, portals: [door(0, 1, 6)]}],
    [
      'two points',
      {
        ...ok,
        portals: [
          {
            a: 0,
            b: 1,
            points: [
              [4, 0, 1],
              [4, 1, 1],
            ],
          },
        ],
      },
    ],
    [
      'not planar',
      {
        ...ok,
        portals: [
          {
            a: 0,
            b: 1,
            points: [
              [4, 0, 1],
              [4, 2, 1],
              [4, 2, 2],
              [3.9, 0, 2],
            ],
          },
        ],
      },
    ],
    [
      'not convex',
      {
        ...ok,
        portals: [
          {
            a: 0,
            b: 1,
            points: [
              [4, 0, 1],
              [4, 2, 2],
              [4, 2, 1],
              [4, 0, 2],
            ],
          },
        ],
      },
    ],
    [
      'no area',
      {
        ...ok,
        portals: [
          {
            a: 0,
            b: 1,
            points: [
              [4, 0, 1],
              [4, 1, 1],
              [4, 2, 1],
            ],
          },
        ],
      },
    ],
    ['open not boolean', {...ok, portals: [{...door(0, 1, 4), open: 1}]}],
    ['too many cells', {...ok, limits: {...limits, maxCells: 1}}],
    ['too many portals', {...ok, limits: {...limits, maxPortals: 0}}],
    ['too many vertices', {...ok, limits: {...limits, maxPortalVertices: 3}}],
    ['bad tolerance', {...ok, tolerance: 0}],
    ['no limits', {cells: ok.cells, portals: ok.portals}],
  ];
  for (const [why, input] of bad) assert.throws(() => createCellGraph(input as never), Error, why);
  // Packed copies: mutating the input afterwards changes nothing.
  const max: [number, number, number] = [4, 3, 4];
  const g = createCellGraph({cells: [{min: [0, 0, 0], max}, box(4, 8)], portals: [door(0, 1, 4)], limits});
  max[0] = 100;
  const out = new Int32Array(2);
  assert.equal(g.cellsAt(50, 1, 2, out), 0);
  assert.throws(() => g.setOpen(1, true));
  assert.throws(() => g.setOpen(0, 'yes' as never));
});

test('portal narrowing: a straight corridor shows every room, each through a narrower clip rectangle', () => {
  const g = corridor();
  const view = createCellView(g, {maxVisits: 64, maxDepth: 3, outside: 'all'});
  const out = createCellViewResult(g);
  assert.equal(view.update(cam([1, 1, 2], [12, 1, 2]), out), 'portals');
  assert.deepEqual(visibleOf(out), [0, 1, 2]);
  const width = (c: number) => out.rects[4 * c + 2]! - out.rects[4 * c]!;
  assert.equal(width(0), 2, 'the camera room keeps the whole view');
  assert.ok(width(1) < 2 && width(2) < width(1), 'each further door narrows the rectangle');
  assert.ok(out.rects[4 * 2]! >= out.rects[4 * 1]! && out.rects[4 * 2 + 2]! <= out.rects[4 * 1 + 2]!);
  // Looking through door 1 at an angle that misses door 2: room 2 is not visible.
  view.update(cam([3.5, 1, 0.2], [4, 1, 1.9]), out);
  assert.deepEqual(visibleOf(out), [0, 1]);
});

test('a room reached first through a narrow portal grows when a wider one reaches it later', () => {
  // Two openings join rooms 0 and 1: portal 0 is a slit at the side, portal 1 is the door aligned with room 2's.
  const slit: PortalInput = {
    a: 0,
    b: 1,
    points: [
      [4, 0, 0.2],
      [4, 2, 0.2],
      [4, 2, 0.4],
      [4, 0, 0.4],
    ],
  };
  const g = createCellGraph({
    cells: [box(0, 4), box(4, 8), box(8, 12)],
    portals: [slit, door(0, 1, 4), door(1, 2, 8)],
    limits,
  });
  const view = createCellView(g, {maxVisits: 64, maxDepth: 3, outside: 'none'});
  const out = createCellViewResult(g);
  view.update(cam([1, 1, 2], [12, 1, 2]), out);
  assert.deepEqual(visibleOf(out), [0, 1, 2]);
  g.setOpen(1, false);
  view.update(cam([1, 1, 2], [12, 1, 2]), out);
  assert.deepEqual(visibleOf(out), [0, 1], 'through the slit alone room 2 is out of line');
});

test('closed portals stop the flood and reopening recomputes from the graph revision', () => {
  const g = corridor();
  const view = createCellView(g, {maxVisits: 64, maxDepth: 3, outside: 'all'});
  const out = createCellViewResult(g);
  const c = cam([1, 1, 2], [12, 1, 2]);
  view.update(c, out);
  assert.equal(g.setOpen(1, false), true);
  assert.equal(g.setOpen(1, false), false, 'no change, no revision');
  view.update(c, out);
  assert.deepEqual(visibleOf(out), [0, 1]);
  assert.equal(out.changed, true);
  g.setOpen(0, false);
  view.update(c, out);
  assert.deepEqual(visibleOf(out), [0]);
  g.setOpen(0, true);
  g.setOpen(1, true);
  view.update(c, out);
  assert.deepEqual(visibleOf(out), [0, 1, 2]);
});

test('a portal behind the camera is rejected; one crossing the eye plane is kept', () => {
  const g = corridor();
  const view = createCellView(g, {maxVisits: 64, maxDepth: 3, outside: 'all'});
  const out = createCellViewResult(g);
  view.update(cam([3, 1, 2], [-5, 1, 2]), out);
  assert.deepEqual(visibleOf(out), [0], 'looking away from the door');
  // Standing beside the door and looking along the wall with a wide view: part of the door is in front.
  view.update(cam([3.9, 1, 1], [3.9, 1, 4], 100), out);
  assert.ok(out.visible[1], 'a door partly in front of the eye stays');
});

test('a camera on or a hair from the portal plane sees the next room through the whole rectangle', () => {
  const g = corridor();
  const view = createCellView(g, {maxVisits: 64, maxDepth: 3, outside: 'none'});
  const out = createCellViewResult(g);
  for (const x of [3.9995, 4, 4.0004]) {
    // Looking down the door's own plane (projection degenerate) and straight through it.
    view.update(cam([x, 1, 2], [x, 1, 4], 90), out);
    assert.ok(out.visible[0] && out.visible[1], `x=${x}: both rooms of the doorway`);
    view.update(cam([x, 1, 2], [12, 1, 2], 60), out);
    assert.ok(out.visible[1] && out.visible[2], `x=${x}: through the doorway`);
  }
  // Exactly on the shared wall the camera is in both rooms.
  view.update(cam([4, 1, 2], [12, 1, 2]), out);
  assert.equal(out.cameraCells, 2);
});

test('outside every cell the creator fallback applies: all, none or a listed set', () => {
  const g = corridor();
  const out = createCellViewResult(g);
  const far = cam([50, 1, 2], [0, 1, 2]);
  assert.equal(createCellView(g, {maxVisits: 8, maxDepth: 3, outside: 'all'}).update(far, out), 'outside');
  assert.deepEqual(visibleOf(out), [0, 1, 2]);
  createCellView(g, {maxVisits: 8, maxDepth: 3, outside: 'none'}).update(far, out);
  assert.deepEqual(visibleOf(out), []);
  createCellView(g, {maxVisits: 8, maxDepth: 3, outside: [2, 2]}).update(far, out);
  assert.deepEqual(visibleOf(out), [2]);
  assert.throws(() => createCellView(g, {maxVisits: 8, maxDepth: 3, outside: [3]}));
});

test('cycles terminate: a ring of four rooms around a pillar converges within the visit bound', () => {
  // 2 x 2 rooms; every shared wall has a door, so the graph is a cycle.
  const cells: CellBox[] = [box(0, 4, 0, 4), box(4, 8, 0, 4), box(0, 4, 4, 8), box(4, 8, 4, 8)];
  const zDoor = (a: number, b: number, x0: number): PortalInput => ({
    a,
    b,
    points: [
      [x0 + 1, 0, 4],
      [x0 + 3, 0, 4],
      [x0 + 3, 2, 4],
      [x0 + 1, 2, 4],
    ],
  });
  const xDoor = (a: number, b: number, z0: number): PortalInput => ({
    a,
    b,
    points: [
      [4, 0, z0 + 1],
      [4, 2, z0 + 1],
      [4, 2, z0 + 3],
      [4, 0, z0 + 3],
    ],
  });
  const g = createCellGraph({cells, portals: [xDoor(0, 1, 0), xDoor(2, 3, 4), zDoor(0, 2, 0), zDoor(1, 3, 4)], limits});
  const view = createCellView(g, {maxVisits: 64, maxDepth: 4, outside: 'all'});
  const out = createCellViewResult(g);
  for (let yaw = 0; yaw < 16; yaw++) {
    const a = (yaw / 16) * 2 * Math.PI;
    assert.equal(view.update(cam([2, 1, 2], [2 + Math.cos(a), 1, 2 + Math.sin(a)], 100), out), 'portals');
    assert.ok(out.visits <= 16, `visits ${out.visits}`);
  }
});

test('bounds: maxDepth is a reported horizon and maxVisits overflow falls back conservatively', () => {
  const g = corridor();
  const out = createCellViewResult(g);
  const c = cam([1, 1, 2], [12, 1, 2]);
  createCellView(g, {maxVisits: 64, maxDepth: 1, outside: 'all'}).update(c, out);
  assert.deepEqual(visibleOf(out), [0, 1]);
  assert.equal(out.depthLimited, 1);
  assert.equal(createCellView(g, {maxVisits: 1, maxDepth: 3, outside: 'none'}).update(c, out), 'overflow');
  assert.deepEqual(visibleOf(out), [0, 1, 2], 'no PVS: every cell');
  const pvs = buildCellPvs(g, {maxDepth: 1});
  createCellView(g, {maxVisits: 1, maxDepth: 3, outside: 'none', pvs}).update(c, out);
  assert.deepEqual(visibleOf(out), [0, 1], 'with a PVS: the camera cell row');
  for (const bad of [
    {maxVisits: 0, maxDepth: 1},
    {maxVisits: 1.5, maxDepth: 1},
    {maxVisits: 1, maxDepth: 4},
    {maxVisits: 1, maxDepth: 0},
  ])
    assert.throws(() => createCellView(g, {...bad, outside: 'all'}));
  assert.throws(() => createCellView(g, {maxVisits: 1, maxDepth: 1, outside: 'all', mode: 'pvs'}));
  assert.throws(() => createCellView(g, {maxVisits: 1, maxDepth: 1, outside: 'all', pvs: buildCellPvs(corridor())}));
});

test('PVS: conservative reachability bits, usable alone, ignore door state', () => {
  const g = corridor();
  g.setOpen(0, false);
  const pvs = buildCellPvs(g, {maxDepth: 1});
  assert.equal(pvs.words, 1);
  assert.ok(pvs.has(0, 1) && !pvs.has(0, 2) && pvs.has(1, 2) && pvs.has(2, 2));
  const list = new Int32Array(3);
  assert.equal(pvs.visibleFrom(1, list), 3);
  const out = createCellViewResult(g);
  const view = createCellView(g, {maxVisits: 1, maxDepth: 3, outside: 'all', pvs, mode: 'pvs'});
  assert.equal(view.update(cam([1, 1, 2], [12, 1, 2]), out), 'pvs');
  assert.deepEqual(visibleOf(out), [0, 1]);
  assert.throws(() => buildCellPvs(g, {maxDepth: 4}));
});

test('an unchanged camera reuses the answer; any input change or invalidate recomputes', () => {
  const g = corridor();
  const view = createCellView(g, {maxVisits: 64, maxDepth: 3, outside: 'all'});
  const out = createCellViewResult(g);
  const c = cam([1, 1, 2], [12, 1, 2]);
  view.update(c, out);
  assert.equal(out.changed, true);
  out.visits = -1;
  view.update(c, out);
  assert.equal(out.changed, false);
  assert.equal(out.visits, -1, 'not recomputed');
  view.invalidate();
  view.update(c, out);
  assert.ok(out.visits > 0);
  assert.equal(out.changed, false, 'recomputed, same set');
  const moved = cam([1.01, 1, 2], [12, 1, 2]);
  view.update(moved, out);
  assert.ok(out.visits > 0);
  assert.throws(() => view.update({position: [0, NaN, 0], viewProjection: c.viewProjection}, out));
  assert.throws(() => view.update({position: [0, 0, 0], viewProjection: [1, 2]}, out));
  assert.throws(() => view.update(c, createCellViewResult(createCellGraph({cells: [box(0, 1)], portals: [], limits}))));
});

test('the same inputs give the same cells and rectangles in the same order', () => {
  const g = corridor();
  const c = cam([1, 1.2, 2.3], [12, 0.8, 1.7], 75);
  const a = createCellViewResult(g),
    b = createCellViewResult(g);
  createCellView(g, {maxVisits: 64, maxDepth: 3, outside: 'all'}).update(c, a);
  createCellView(g, {maxVisits: 64, maxDepth: 3, outside: 'all'}).update(c, b);
  assert.deepEqual(visibleOf(a), visibleOf(b));
  assert.deepEqual([...a.rects], [...b.rects]);
});

test("two views sharing one result record never reuse each other's answer", () => {
  const g = corridor();
  const out = createCellViewResult(g);
  const c = cam([1, 1, 2], [12, 1, 2]);
  const wide = createCellView(g, {maxVisits: 64, maxDepth: 3, outside: 'all'});
  const shallow = createCellView(g, {maxVisits: 64, maxDepth: 1, outside: 'all'});
  wide.update(c, out);
  assert.deepEqual(visibleOf(out), [0, 1, 2]);
  shallow.update(c, out);
  assert.deepEqual(visibleOf(out), [0, 1]);
  wide.update(c, out);
  assert.deepEqual(visibleOf(out), [0, 1, 2], "recomputed, not the other view's cached set");
});

test('an orthographic camera inside a cell floods through the portals it faces', () => {
  const g = corridor();
  const view = createCellView(g, {maxVisits: 64, maxDepth: 3, outside: 'none'});
  const out = createCellViewResult(g);
  const ortho = (x: number, tx: number) => {
    const c = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    c.position.set(x, 1, 2);
    c.lookAt(tx, 1, 2);
    c.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
    view.update({position: [x, 1, 2], viewProjection: m.elements}, out);
    return visibleOf(out);
  };
  assert.deepEqual(ortho(1, 12), [0, 1, 2]);
  // Orthographic projection has no eye plane (w = 1): portals behind the camera still project. Conservative, not
  // tight; the near rectangle must lie inside the camera's cells (see the README limits).
  assert.deepEqual(ortho(1, -12), [0, 1, 2]);
});
