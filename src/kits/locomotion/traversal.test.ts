import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defineVolumeSet, sweepVolume, type VolumeSet} from '../volume-query/index';
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
  const distanceTo = (b: readonly number[], p: TraversalVec3) =>
    Math.hypot(
      Math.max(b[0]! - p[0], 0, p[0] - b[3]!),
      Math.max(b[1]! - p[1], 0, p[1] - b[4]!),
      Math.max(b[2]! - p[2], 0, p[2] - b[5]!),
    );
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
      const box = boxes.find(b => inside(p, r) && distanceTo(b, p) < r);
      if (box) {
        // Normal from the nearest point on the box towards the sphere centre at the last free sample.
        const q: TraversalVec3 = [
          from[0] + (to[0] - from[0]) * Math.max(0, t - 1 / steps),
          from[1] + (to[1] - from[1]) * Math.max(0, t - 1 / steps),
          from[2] + (to[2] - from[2]) * Math.max(0, t - 1 / steps),
        ];
        const c = [0, 1, 2].map(k => Math.max(box[k]!, Math.min(box[k + 3]!, q[k]!)));
        const n = [q[0] - c[0]!, q[1] - c[1]!, q[2] - c[2]!];
        // Starting inside a box has no separating direction: report the hit facing back along the cast.
        const len0 = Math.hypot(n[0]!, n[1]!, n[2]!);
        if (len0 === 0) {
          const dl = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) || 1;
          n[0] = -(to[0] - from[0]) / dl;
          n[1] = dl === 1 && to[1] === from[1] && to[0] === from[0] && to[2] === from[2] ? 1 : -(to[1] - from[1]) / dl;
          n[2] = -(to[2] - from[2]) / dl;
        }
        const len = Math.hypot(n[0]!, n[1]!, n[2]!);
        return {
          hit: true,
          fraction: Math.max(0, (i - 1) / steps),
          normal: [n[0]! / len, n[1]! / len, n[2]! / len] as const,
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
  // A top under minClimb is too low (the wall cast is capped at height − radius, so it still finds this wall).
  assert.equal(findLedge({...q, minClimb: 1.8, maxClimb: 2}, w.cast, w.ground).status, 'too-low');
  // A ceiling over the ledge top leaves no headroom.
  const low = world([
    [2, 0, -5, 4, 1.5, 5],
    [2, 2.6, -5, 4, 3, 5],
  ]);
  assert.equal(findLedge({...q, maxClimb: 1.6}, low.cast, low.ground).status, 'no-headroom');
  assert.throws(() => findLedge({...q, facing: [0, 0]}, w.cast, w.ground), RangeError);
  assert.throws(() => findLedge({...q, radius: 1}, w.cast, w.ground), RangeError, 'radius over height / 2');
});

test('ledges: low ceilings, low ledges and oblique approaches', () => {
  const q = {
    position: [0, 0, 0] as TraversalVec3,
    facing: [1, 0] as [number, number],
    height: 1.8,
    radius: 0.3,
    reach: 2.5,
    maxClimb: 2.5,
  };
  // A ceiling over everything does not make a reachable ledge too high, whatever maxClimb is.
  const roofed = world([
    [1, 0, -5, 4, 1, 5],
    [-5, 3, -5, 5, 3.5, 5],
  ]);
  for (const maxClimb of [1.2, 2.5])
    assert.equal(findLedge({...q, maxClimb}, roofed.cast, roofed.ground).status, 'ledge');
  // A knee-high ledge is found with the default minClimb.
  const low = world([[1, 0, -5, 4, 0.5, 5]]);
  const r = findLedge(q, low.cast, low.ground);
  assert.equal(r.status, 'ledge');
  if (r.status === 'ledge') assert.ok(Math.abs(r.climb - 0.5) < 1e-9);
  // A tall wall reports too-high rather than a ledge on the floor in front of it.
  assert.equal(findLedge({...q, maxClimb: 1}, world([[1, 0, -5, 4, 3, 5]]).cast, low.ground).status, 'too-high');
  // At 45° the edge lies on the wall face and the top a little past it, along the wall normal.
  const wall = world([[1, 0, -50, 4, 1.5, 50]]);
  const diag = findLedge({...q, facing: [1, 1]}, wall.cast, wall.ground);
  assert.equal(diag.status, 'ledge');
  if (diag.status === 'ledge') {
    assert.ok(Math.abs(diag.edge[0] - 1) < 0.02, `edge on the face, x=${diag.edge[0]}`);
    assert.ok(Math.abs(diag.top[0] - 1.315) < 0.02, `top past the face along the normal, x=${diag.top[0]}`);
  }
  // At 70° the approach is too oblique and says so.
  const a = (70 * Math.PI) / 180;
  assert.equal(
    findLedge({...q, facing: [Math.cos(a), Math.sin(a)], reach: 5}, wall.cast, wall.ground).status,
    'oblique',
  );
});

/** The volume-query kit backing the traversal queries, with an explicit policy for every sweep status. */
function volumeQueries(set: VolumeSet) {
  const cast: SphereCast = (from, to, radius) => {
    const d: TraversalVec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const r = sweepVolume(set, {kind: 'sphere', center: from, radius}, d);
    if (r.status === 'clear') return {hit: false};
    if (r.status === 'hit') return {hit: true, fraction: r.fraction, normal: r.normal};
    if (r.status === 'start-overlap') {
      // Already touching: report a blocking hit facing back along the cast.
      const len = Math.hypot(d[0], d[1], d[2]);
      return {hit: true, fraction: 0, normal: len > 0 ? [-d[0] / len, -d[1] / len, -d[2] / len] : [0, 1, 0]};
    }
    // unresolved or over-budget: refuse to treat the space as clear.
    throw new Error(`volume sweep ${r.status}`);
  };
  const probe = 1e-3;
  const ground: GroundProbe = (x, z, fromY, maxDrop) => {
    const r = sweepVolume(set, {kind: 'sphere', center: [x, fromY, z], radius: probe}, [0, -maxDrop, 0]);
    if (r.status === 'clear') return null;
    if (r.status === 'hit') return fromY - r.fraction * maxDrop - probe;
    // Starting inside solid: the surface is at least at the probe start, so a ledge reads as too high.
    if (r.status === 'start-overlap') return fromY;
    throw new Error(`volume probe ${r.status}`);
  };
  return {cast, ground};
}

test('ledges through the volume-query kit: a real sphere sweep and ground probe find the same ledge', () => {
  const set = defineVolumeSet({
    revision: 0,
    maxColliders: 2,
    colliders: [
      {id: 'floor', kind: 'box', center: [0, -1, 0], halfExtents: [20, 1, 20]},
      {id: 'block', kind: 'box', center: [3, 0.75, 0], halfExtents: [1, 0.75, 5]},
    ],
  });
  const {cast, ground} = volumeQueries(set);
  const q = {
    position: [0, 0, 0] as TraversalVec3,
    facing: [1, 0] as [number, number],
    height: 1.8,
    radius: 0.3,
    reach: 2.5,
    maxClimb: 2,
  };
  const r = findLedge(q, cast, ground);
  assert.equal(r.status, 'ledge');
  if (r.status === 'ledge') {
    assert.ok(Math.abs(r.climb - 1.5) < 1e-6);
    assert.ok(Math.abs(r.edge[0] - 2) < 1e-6, `edge on the face, x=${r.edge[0]}`);
    assert.deepEqual(
      r.normal.map(v => Math.round(v * 1e6) / 1e6),
      [-1, 0, 0],
    );
  }
  assert.equal(findLedge({...q, maxClimb: 1}, cast, ground).status, 'too-high');
});

test('ledges: low walls just above minClimb meet the sphere at their edge, and thin or roofed walls report why', () => {
  const q = {
    position: [0, 0, 0] as TraversalVec3,
    facing: [1, 0] as [number, number],
    height: 1.8,
    radius: 0.3,
    reach: 2.5,
    maxClimb: 2,
  };
  const boxes = (...extra: {id: string; center: TraversalVec3; halfExtents: TraversalVec3}[]) =>
    volumeQueries(
      defineVolumeSet({
        revision: 0,
        maxColliders: 1 + extra.length,
        colliders: [
          {id: 'floor', kind: 'box', center: [0, -1, 0], halfExtents: [20, 1, 20]},
          ...extra.map(e => ({...e, kind: 'box' as const})),
        ],
      }),
    );
  // Tops just above minClimb, and low curbs with minClimb 0, are ledges: the sphere meets their upper edge.
  for (const [minClimb, top] of [
    [0.3, 0.35],
    [0.3, 0.45],
    [0, 0.05],
    [0, 0.2],
  ] as const) {
    const {cast, ground} = boxes({id: 'b', center: [3, top / 2, 0], halfExtents: [1, top / 2, 5]});
    const r = findLedge({...q, minClimb}, cast, ground);
    assert.equal(r.status, 'ledge', `top ${top}, minClimb ${minClimb}`);
    if (r.status === 'ledge') {
      assert.ok(Math.abs(r.climb - top) < 1e-6);
      assert.ok(Math.abs(r.edge[0] - 2) < 1e-3, `edge at the face, x=${r.edge[0]}`);
      assert.deepEqual(r.normal, [-1, 0, 0]);
    }
  }
  // A wall no higher than minClimb is not seen.
  const lowWall = boxes({id: 'b', center: [3, 0.1, 0], halfExtents: [1, 0.1, 5]});
  assert.equal(findLedge({...q, minClimb: 0.3}, lowWall.cast, lowWall.ground).status, 'no-wall');
  // A thin fence has no top to stand on, with or without a ceiling overhead.
  const fence = {id: 'fence', center: [2.05, 0.6, 0] as TraversalVec3, halfExtents: [0.05, 0.6, 5] as TraversalVec3};
  const ceiling = {id: 'roof', center: [0, 2.55, 0] as TraversalVec3, halfExtents: [20, 0.25, 20] as TraversalVec3};
  for (const world of [boxes(fence), boxes(fence, ceiling)])
    for (const minClimb of [0, 0.5])
      assert.equal(findLedge({...q, minClimb}, world.cast, world.ground).status, 'no-top');
  // A wall taller than maxClimb is too high, ceiling or not.
  const tall = {id: 'tall', center: [3, 1.5, 0] as TraversalVec3, halfExtents: [1, 1.5, 5] as TraversalVec3};
  for (const world of [boxes(tall), boxes(tall, {...ceiling, center: [0, 3.75, 0]})])
    assert.equal(findLedge({...q, maxClimb: 1, minClimb: 0.5}, world.cast, world.ground).status, 'too-high');
  // Walkable ramps are slopes, not wall edges, at any minClimb.
  for (const deg of [2, 10, 20, 30]) {
    const t = (deg * Math.PI) / 180,
      c = Math.cos(t),
      sn = Math.sin(t);
    // A long box rotated about z whose top face starts at x = 1, y = 0 and rises away from the body.
    const corner = [-5 * c - 0.5 * sn, -5 * sn + 0.5 * c];
    const ramp = volumeQueries(
      defineVolumeSet({
        revision: 0,
        maxColliders: 2,
        colliders: [
          {id: 'floor', kind: 'box', center: [0, -1, 0], halfExtents: [20, 1, 20]},
          {
            id: 'ramp',
            kind: 'box',
            center: [1 - corner[0]!, -corner[1]!, 0],
            halfExtents: [5, 0.5, 5],
            rotation: [0, 0, Math.sin(t / 2), Math.cos(t / 2)],
          },
        ],
      }),
    );
    // A shallow ramp may stay under the wall cast within reach (no wall); a steeper one is hit but is not a wall.
    for (const minClimb of [0, 0.3]) {
      const status = findLedge({...q, minClimb}, ramp.cast, ramp.ground).status;
      assert.ok(status === 'not-a-wall' || status === 'no-wall', `${deg}° ramp, minClimb ${minClimb}: ${status}`);
    }
  }
  // A body pressed flush against a tall wall still reads it as too high.
  const flush = boxes({id: 'tall', center: [1.3, 1.5, 0], halfExtents: [1, 1.5, 5]});
  assert.equal(findLedge({...q, maxClimb: 1}, flush.cast, flush.ground).status, 'too-high');
  // A wall just behind the body does not change the reason.
  const behind = boxes(
    {id: 'tall', center: [2, 1.5, 0], halfExtents: [1, 1.5, 5]},
    {id: 'back', center: [-1.31, 1.5, 0], halfExtents: [1, 1.5, 5]},
  );
  assert.equal(findLedge({...q, maxClimb: 1}, behind.cast, behind.ground).status, 'too-high');
  // A floor-like normal (straight up) is not a wall, even with wallSlope 1.
  const up: SphereCast = () => ({hit: true, fraction: 0.5, normal: [0, 1, 0]});
  assert.equal(findLedge({...q, wallSlope: 1}, up, () => 0).status, 'not-a-wall');
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
  assert.throws(() => ladders.attach([0, 1, -0.5], [0, 0]), RangeError, 'zero facing');
  assert.throws(() => ladders.pose({ladder: 'l', t: Number.NaN}), RangeError);
  assert.throws(() => ladders.topExit(g, Number.NaN), RangeError);
  assert.throws(() => ladders.topExit(g, -1), RangeError);
  // A ladder high overhead or far below is out of reach vertically.
  const high = createLadders([{id: 'h', bottom: [0, 3, 0], top: [0, 6, 0], outward: [0, -1]}]);
  assert.equal(high.attach([0, 0, -0.5], [0, 1]), null);
  assert.equal(high.attach([0, 9, -0.5], [0, 1]), null);
  assert.equal(high.attach([0, 0, -0.5], [0, 1], {maxVertical: 3})?.t, 0);
});

test('pushables: force accelerates, friction stops, walls block per axis, and grid pushes move whole cells', () => {
  const w = world([[3, 0, -5, 4, 2, 5]]);
  const half: TraversalVec3 = [0.5, 0.5, 0.5];
  let state: PushableState = {position: [0, 0.5, 0], velocity: [0, 0]};
  for (let i = 0; i < 30; i++)
    state = pushStep(state, {half, mass: 2, force: [40, 0], dt: 0.05, sweep: w.sweep, maxSpeed: 1}).state;
  assert.ok(state.position[0] > 1 && state.velocity[0] <= 1 + 1e-12, 'capped speed');
  let blocked = false;
  for (let i = 0; i < 100; i++) {
    const r = pushStep(state, {half, mass: 2, force: [40, 30], dt: 0.05, sweep: w.sweep, maxSpeed: 1});
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
  // Off-grid blocks land on the next grid line.
  const offGrid = pushStep(
    {position: [0.3, 0.5, 0], velocity: [0, 0]},
    {half, mass: 1, force: [1, 0], dt: 0.1, sweep: w.sweep, snap: 1},
  );
  assert.deepEqual(offGrid.state.position, [1, 0.5, 0]);
  // Grid pushes go to the next line strictly ahead, the same for nearly equal positions and in both directions.
  const open = world([]);
  const gridPush = (x: number, fx: number, origin = 0) =>
    pushStep(
      {position: [x, 0.5, 0], velocity: [0, 0]},
      {half, mass: 1, force: [fx, 0], dt: 0.1, sweep: open.sweep, snap: 1, origin},
    ).state.position[0];
  assert.equal(gridPush(0.5, 1), 1);
  assert.equal(gridPush(2.5, 1), 3);
  assert.equal(gridPush(2.4999999999, 1), 3);
  assert.equal(gridPush(0.5, -1), 0);
  assert.equal(gridPush(3 - 1e-12, 1), 4, 'within rounding of a line counts as on it');
  // With the grid offset by half a cell, blocks stay centred in cells.
  assert.equal(gridPush(0.5, 1, 0.5), 1.5);
  assert.equal(gridPush(0.5, -1, 0.5), -0.5);
  assert.equal(gridPush(2.4999999999, 1, 0.5), 3.5);
  assert.throws(
    () => pushStep(state, {half, mass: 1, force: [0, 0], dt: 0.1, sweep: open.sweep, origin: Number.NaN}),
    RangeError,
    'origin is validated without snap too',
  );
});

test('pushables: friction always resists, a weak push never starts the block, and dt 0 changes nothing', () => {
  const open = world([]);
  const half: TraversalVec3 = [0.5, 0.5, 0.5];
  // A tiny push on a heavy moving block does not switch friction off.
  let s: PushableState = {position: [0, 0.5, 0], velocity: [2, 0]};
  for (let i = 0; i < 120; i++)
    s = pushStep(s, {half, mass: 1e6, force: [1e-12, 0], dt: 1 / 60, sweep: open.sweep, friction: 8}).state;
  assert.deepEqual(s.velocity, [0, 0]);
  // A push weaker than friction × mass leaves a resting block at rest; a stronger one moves it.
  const rest: PushableState = {position: [0, 0.5, 0], velocity: [0, 0]};
  const weak = pushStep(rest, {half, mass: 2, force: [15, 0], dt: 0.1, sweep: open.sweep, friction: 8});
  assert.deepEqual(weak.state.position, [0, 0.5, 0]);
  const strong = pushStep(rest, {half, mass: 2, force: [20, 0], dt: 0.1, sweep: open.sweep, friction: 8});
  assert.ok(strong.state.position[0] > 0);
  // dt 0 never sweeps and never reports a block.
  const still = pushStep(
    {position: [0, 0.5, 0], velocity: [3, 0]},
    {half, mass: 1, force: [0, 0], dt: 0, sweep: () => 0},
  );
  assert.equal(still.blocked, false);
  assert.deepEqual(still.state.velocity, [3, 0]);
});
