import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  corridor,
  createAvoidance,
  createPathSearch,
  defineNavMesh,
  findStraightPath,
  locate,
  navMeshGraph,
  walkMesh,
  type MeshPoint,
} from './index';

const V = (x: number, z: number, y = 0): MeshPoint => [x, y, z];
// An L of three unit squares: A [0,1]², B [1,2]×[0,1], C [1,2]×[1,2]. Counter-clockwise seen from above.
const lMesh = () =>
  defineNavMesh({
    vertices: [V(0, 0), V(1, 0), V(2, 0), V(0, 1), V(1, 1), V(2, 1), V(1, 2), V(2, 2)],
    polygons: [
      [0, 1, 4, 3],
      [1, 2, 5, 4],
      [4, 5, 7, 6],
    ],
  });
const route = (mesh: ReturnType<typeof lMesh>, from: number, to: number) => {
  const r = createPathSearch(navMeshGraph(mesh), `p${from}`, `p${to}`).step(10_000).result;
  assert.equal(r.status, 'arrived');
  return corridor(r.status === 'arrived' ? r.path : []);
};

test('locate finds the polygon under a point, honouring height', () => {
  const mesh = lMesh();
  assert.equal(locate(mesh, [0.5, 0, 0.5]), 0);
  assert.equal(locate(mesh, [1.5, 0, 1.5]), 2);
  assert.equal(locate(mesh, [0.5, 0, 1.5]), null, 'the missing corner of the L');
  assert.equal(locate(mesh, [0.5, 5, 0.5]), null, 'too far above');
  assert.equal(locate(mesh, [0.5, 5, 0.5], 10), 0);
});

test('the funnel pulls the corridor tight around the inner corner, with radius clearance', () => {
  const mesh = lMesh();
  const path = route(mesh, 0, 2);
  assert.deepEqual(path, [0, 1, 2]);
  const tight = findStraightPath(mesh, path, [0.5, 0, 0.5], [1.5, 0, 1.5]);
  assert.deepEqual(tight, {
    status: 'ok',
    points: [
      [0.5, 0, 0.5],
      [1, 0, 1],
      [1.5, 0, 1.5],
    ],
  });
  const clear = findStraightPath(mesh, path, [0.5, 0, 0.5], [1.5, 0, 1.5], 0.1);
  assert.equal(clear.status, 'ok');
  if (clear.status === 'ok')
    for (const p of clear.points.slice(1, -1))
      assert.ok(Math.hypot(p[0] - 1, p[2] - 1) >= 0.1 - 1e-9, 'kept off the corner');
  assert.deepEqual(findStraightPath(mesh, path, [0.5, 0, 0.5], [1.5, 0, 1.5], 0.6), {status: 'too-narrow', portal: 0});
  assert.deepEqual(findStraightPath(mesh, [0, 1], [0.5, 0, 0.5], [1.5, 0, 0.5]).status, 'ok');
  assert.deepEqual(findStraightPath(mesh, [0, 2], [0.5, 0, 0.5], [1.5, 0, 1.5]), {status: 'broken', at: 0});
});

test('a zig-zag corridor yields one corner per turn and no corner on straight stretches', () => {
  // A 5×1 strip of unit squares along x: the path through it is straight.
  const vertices: MeshPoint[] = [];
  for (let x = 0; x <= 5; x++) vertices.push(V(x, 0), V(x, 1));
  const polygons = [0, 1, 2, 3, 4].map(i => [2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1]);
  const mesh = defineNavMesh({vertices, polygons});
  const path = route(mesh, 0, 4);
  const r = findStraightPath(mesh, path, [0.2, 0, 0.2], [4.8, 0, 0.8]);
  assert.deepEqual(r, {
    status: 'ok',
    points: [
      [0.2, 0, 0.2],
      [4.8, 0, 0.8],
    ],
  });
});

test('walkMesh crosses shared edges, stops at the boundary and slides along it', () => {
  const mesh = lMesh();
  assert.deepEqual(walkMesh(mesh, 0, [0.5, 0, 0.5], [1, 1]), {position: [1.5, 0, 1.5], polygon: 2, blocked: false});
  const wall = walkMesh(mesh, 0, [0.5, 0, 0.5], [0, 2]);
  assert.deepEqual(wall, {position: [0.5, 0, 1], polygon: 0, blocked: true});
  const slide = walkMesh(mesh, 0, [0.5, 0, 0.5], [2, 0.2]);
  assert.equal(slide.blocked, true);
  assert.equal(slide.polygon, 1);
  assert.equal(slide.position[0], 2);
  assert.ok(slide.position[2] > 0.5, 'slid along the boundary');
  const noSlide = walkMesh(mesh, 0, [0.5, 0, 0.5], [2, 0.2], false);
  assert.ok(noSlide.position[2] < slide.position[2]);
});

test('heights follow sloped polygons', () => {
  const mesh = defineNavMesh({vertices: [V(0, 0, 0), V(2, 0, 2), V(2, 2, 2), V(0, 2, 0)], polygons: [[0, 1, 2, 3]]});
  const r = walkMesh(mesh, 0, [0.5, 0.5, 1], [1, 0]);
  assert.ok(Math.abs(r.position[1] - 1.5) < 1e-9);
});

test('mesh validation refuses non-convex, clockwise, bad indices and over-shared edges', () => {
  const v = [V(0, 0), V(1, 0), V(1, 1), V(0, 1)];
  assert.throws(() => defineNavMesh({vertices: v, polygons: [[0, 3, 2, 1]]}), /counter-clockwise/);
  assert.throws(() => defineNavMesh({vertices: v, polygons: [[0, 1, 9]]}), RangeError);
  assert.throws(() => defineNavMesh({vertices: v, polygons: [[0, 1, 1, 2]]}), RangeError);
  assert.throws(
    () =>
      defineNavMesh({
        vertices: [...v, V(2, 0), V(-1, 0)],
        polygons: [
          [0, 1, 2],
          [1, 0, 3],
          [0, 1, 4],
        ],
      }),
    RangeError,
  );
  assert.throws(() => locate({} as never, [0, 0, 0]), /defineNavMesh/);
});

test('avoidance: head-on agents pass each other without collision, and reciprocally', () => {
  const avoid = createAvoidance({horizon: 3, neighborRadius: 5});
  let a = {id: 'a', position: [-4, 0] as [number, number], velocity: [1, 0] as [number, number]};
  let b = {id: 'b', position: [4, 0.01] as [number, number], velocity: [-1, 0] as [number, number]};
  let closest = Infinity;
  for (let i = 0; i < 200; i++) {
    const [va, vb] = avoid.step([
      {...a, preferred: [1, 0], radius: 0.5, maxSpeed: 1},
      {...b, preferred: [-1, 0], radius: 0.5, maxSpeed: 1},
    ]);
    a = {id: 'a', position: [a.position[0] + va![0] * 0.05, a.position[1] + va![1] * 0.05], velocity: [va![0], va![1]]};
    b = {id: 'b', position: [b.position[0] + vb![0] * 0.05, b.position[1] + vb![1] * 0.05], velocity: [vb![0], vb![1]]};
    closest = Math.min(closest, Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]));
  }
  assert.ok(closest >= 1 - 1e-6, `never overlapped: ${closest}`);
  assert.ok(a.position[0] > 3 && b.position[0] < -3, 'both got past');
  const repeat = createAvoidance({horizon: 3}).step([
    {id: 'x', position: [0, 0], velocity: [0, 0], preferred: [1, 0], radius: 0.5, maxSpeed: 1},
  ]);
  assert.deepEqual(repeat, [[1, 0]], 'alone: the preferred velocity');
  assert.throws(
    () => avoid.step([{id: 'x', position: [0, 0], velocity: [0, 0], preferred: [0, 0], radius: 0, maxSpeed: 1}]),
    RangeError,
  );
});

test('avoidance: eight agents swapping across a circle keep apart and arrive', () => {
  const avoid = createAvoidance({horizon: 2, neighborRadius: 4, maxNeighbors: 7});
  const n = 8,
    R = 5;
  let agents = Array.from({length: n}, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return {
      id: `a${i}`,
      position: [R * Math.cos(a), R * Math.sin(a)] as [number, number],
      velocity: [0, 0] as [number, number],
      goal: [-R * Math.cos(a), -R * Math.sin(a)] as [number, number],
    };
  });
  let closest = Infinity;
  for (let step = 0; step < 600; step++) {
    const vs = avoid.step(
      agents.map(a => {
        const dx = a.goal[0] - a.position[0],
          dz = a.goal[1] - a.position[1],
          d = Math.hypot(dx, dz);
        const pref: [number, number] = d < 0.05 ? [0, 0] : [(dx / d) * Math.min(1, d), (dz / d) * Math.min(1, d)];
        return {id: a.id, position: a.position, velocity: a.velocity, preferred: pref, radius: 0.3, maxSpeed: 1};
      }),
    );
    agents = agents.map((a, i) => ({
      ...a,
      position: [a.position[0] + vs[i]![0] * 0.05, a.position[1] + vs[i]![1] * 0.05] as [number, number],
      velocity: [vs[i]![0], vs[i]![1]] as [number, number],
    }));
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        closest = Math.min(
          closest,
          Math.hypot(agents[i]!.position[0] - agents[j]!.position[0], agents[i]!.position[1] - agents[j]!.position[1]),
        );
  }
  assert.ok(closest > 0.6 * 0.8, `close calls stay near the combined radius: ${closest}`);
  const arrived = agents.filter(a => Math.hypot(a.goal[0] - a.position[0], a.goal[1] - a.position[1]) < 0.5).length;
  assert.ok(arrived >= 7, `arrived ${arrived}/8`);
});
