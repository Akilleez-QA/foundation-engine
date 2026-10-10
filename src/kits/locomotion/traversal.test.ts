import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  createLadders,
  findLedge,
  pushStep,
  type BoxSweep,
  type GroundProbe,
  type PushableState,
  type SphereCast,
  type TraversalVec3,
} from './index';

/** A world of axis-aligned boxes [minX, minY, minZ, maxX, maxY, maxZ]: sphere casts by sampling, ground by top faces. */
function world(boxes: readonly (readonly number[])[]) {
  const inside = (p: TraversalVec3, r: number) =>
    boxes.some(
      b =>
        p[0] > b[0]! - r &&
        p[0] < b[3]! + r &&
        p[1] > b[1]! - r &&
        p[1] < b[4]! + r &&
        p[2] > b[2]! - r &&
        p[2] < b[5]! + r,
    );
  const cast: SphereCast = (from, to, r) => {
    const steps = 400;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p: TraversalVec3 = [
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
      ];
      if (inside(p, r)) {
        const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
        const k = d.map(Math.abs).indexOf(Math.max(...d.map(Math.abs)));
        const normal = [0, 0, 0];
        normal[k] = -Math.sign(d[k]!);
        return {
          hit: true,
          fraction: Math.max(0, (i - 1) / steps),
          normal: [normal[0]!, normal[1]!, normal[2]!] as const,
        };
      }
    }
    return {hit: false};
  };
  const ground: GroundProbe = (x, z, fromY, maxDrop) => {
    let best: number | null = null;
    for (const b of boxes)
      if (x >= b[0]! && x <= b[3]! && z >= b[2]! && z <= b[5]! && b[4]! <= fromY && b[4]! >= fromY - maxDrop)
        best = best === null ? b[4]! : Math.max(best, b[4]!);
    if (best === null && fromY >= 0 && fromY - maxDrop <= 0) best = 0;
    return best;
  };
  const sweep: BoxSweep = (c, h, d) => {
    const steps = 200;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const p = [c[0] + d[0] * t, c[1] + d[1] * t, c[2] + d[2] * t];
      if (
        boxes.some(
          b =>
            p[0]! + h[0] > b[0]! &&
            p[0]! - h[0] < b[3]! &&
            p[1]! + h[1] > b[1]! &&
            p[1]! - h[1] < b[4]! &&
            p[2]! + h[2] > b[2]! &&
            p[2]! - h[2] < b[5]!,
        )
      )
        return (i - 1) / steps;
    }
    return 1;
  };
  return {cast, ground, sweep};
}

test('ledges: a wall ahead with a climbable top and headroom is found; other cases say why not', () => {
  // A block 1.5 high from x=2 to x=4.
  const w = world([[2, 0, -5, 4, 1.5, 5]]);
  const q = {
    position: [0, 0, 0] as TraversalVec3,
    facing: [1, 0] as [number, number],
    height: 1.8,
    radius: 0.3,
    reach: 2.5,
    maxClimb: 2,
    minClimb: 0.5,
  };
  const r = findLedge(q, w.cast, w.ground);
  assert.equal(r.status, 'ledge');
  if (r.status === 'ledge') {
    assert.ok(Math.abs(r.climb - 1.5) < 1e-9);
    assert.ok(r.top[0] > 2 && r.top[0] < 4);
    assert.deepEqual(r.normal, [-1, 0, 0]);
  }
  assert.equal(findLedge({...q, facing: [-1, 0]}, w.cast, w.ground).status, 'no-wall');
  assert.equal(findLedge({...q, maxClimb: 1}, w.cast, w.ground).status, 'too-high');
  assert.equal(findLedge({...q, minClimb: 1.8, maxClimb: 2}, w.cast, w.ground).status, 'too-low');
  // A ceiling over the ledge top leaves no headroom.
  const low = world([
    [2, 0, -5, 4, 1.5, 5],
    [2, 2.6, -5, 4, 3, 5],
  ]);
  assert.equal(findLedge({...q, maxClimb: 1.6}, low.cast, low.ground).status, 'no-headroom');
  assert.throws(() => findLedge({...q, facing: [0, 0]}, w.cast, w.ground), RangeError);
});

test('ladders: attach when facing in, climb with exits at both ends, and stand off the top', () => {
  const ladders = createLadders([{id: 'l', bottom: [0, 0, 0], top: [0, 4, 0], outward: [0, -1], offset: 0.4}]);
  assert.equal(ladders.attach([0, 0, -0.5], [0, -1]), null, 'facing away');
  const grip = ladders.attach([0, 1, -0.5], [0, 1])!;
  assert.equal(grip.ladder, 'l');
  assert.ok(Math.abs(grip.t - 0.25) < 1e-9);
  assert.deepEqual(ladders.pose(grip), [0, 1, -0.4]);
  let g = grip;
  let exit: 'top' | 'bottom' | null = null;
  for (let i = 0; i < 100 && !exit; i++) ({grip: g, exit} = ladders.climb(g, 1, 2, 0.1));
  assert.equal(exit, 'top');
  assert.equal(g.t, 1);
  assert.deepEqual(ladders.topExit(g), [0, 4, 0.5]);
  assert.equal(ladders.climb({ladder: 'l', t: 0.01}, -1, 2, 1).exit, 'bottom');
  assert.throws(() => createLadders([{id: 'x', bottom: [0, 1, 0], top: [0, 0, 0], outward: [1, 0]}]), RangeError);
  assert.throws(() => ladders.climb(g, 2, 1, 1), RangeError);
});

test('pushables: force accelerates, friction stops, walls block per axis, and grid pushes move whole cells', () => {
  const w = world([[3, 0, -5, 4, 2, 5]]);
  const half: TraversalVec3 = [0.5, 0.5, 0.5];
  let state: PushableState = {position: [0, 0.5, 0], velocity: [0, 0]};
  for (let i = 0; i < 30; i++)
    state = pushStep(state, {half, mass: 2, force: [10, 0], dt: 0.05, sweep: w.sweep, maxSpeed: 1}).state;
  assert.ok(state.position[0] > 1 && state.velocity[0] <= 1 + 1e-12, 'capped speed');
  let blocked = false;
  for (let i = 0; i < 100; i++) {
    const r = pushStep(state, {half, mass: 2, force: [10, 4], dt: 0.05, sweep: w.sweep, maxSpeed: 1});
    state = r.state;
    blocked ||= r.blocked;
  }
  assert.ok(blocked);
  assert.ok(state.position[0] <= 2.5 + 1e-9, 'stopped at the wall');
  assert.ok(state.position[2] > 0.5, 'slides along the wall on the other axis');
  for (let i = 0; i < 100; i++)
    state = pushStep(state, {half, mass: 2, force: [0, 0], dt: 0.05, sweep: w.sweep, friction: 8}).state;
  assert.deepEqual(state.velocity, [0, 0], 'friction stops it');
  const grid = pushStep(
    {position: [0, 0.5, 0], velocity: [0, 0]},
    {half, mass: 1, force: [1, 0.5], dt: 0.1, sweep: w.sweep, snap: 1},
  );
  assert.deepEqual(grid.state.position, [1, 0.5, 0]);
  const wallGrid = pushStep(
    {position: [2, 0.5, 0], velocity: [0, 0]},
    {half, mass: 1, force: [1, 0], dt: 0.1, sweep: w.sweep, snap: 1},
  );
  assert.equal(wallGrid.blocked, true);
  assert.deepEqual(wallGrid.state.position, [2, 0.5, 0]);
  assert.throws(() => pushStep(state, {half: [0, 1, 1], mass: 1, force: [0, 0], dt: 0.1, sweep: w.sweep}), RangeError);
});
