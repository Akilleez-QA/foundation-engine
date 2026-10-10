import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apex,
  ballistics,
  positionAt,
  samplePoints,
  solveByApexHeight,
  solveByDuration,
  solveByHorizontalSpeed,
  solveByLaunchSpeed,
  solveByVerticalSpeed,
  solveLead,
  timeAtHeight,
  velocityAt,
  type BallisticVec3,
  type Solution,
} from './index';

const G = 9.81;
const near = (a: readonly number[], b: readonly number[], eps = 1e-9) =>
  a.every((v, i) => Math.abs(v - b[i]!) <= eps * Math.max(1, Math.abs(b[i]!)));
const traj = (s: Solution) => {
  if (s.status !== 'solved') throw new Error(`expected solved: ${s.reason}`);
  return s.trajectory;
};
const from: BallisticVec3 = [1, 2, -3],
  to: BallisticVec3 = [11, 0.5, 4];

test('every solve lands exactly on its target at its duration', () => {
  const solutions = [
    solveByDuration(from, to, 1.7, G),
    solveByHorizontalSpeed(from, to, 6, G),
    solveByVerticalSpeed(from, to, 8, G),
    solveByApexHeight(from, to, 3, G),
    solveByLaunchSpeed(from, to, 15, G, 'low'),
    solveByLaunchSpeed(from, to, 15, G, 'high'),
  ];
  const above: BallisticVec3 = [11, 4.5, 4];
  const rising = traj(solveByVerticalSpeed(from, above, 8, G, 'ascending'));
  assert.ok(near(positionAt(rising, rising.duration), above, 1e-9));
  assert.equal(
    solveByVerticalSpeed(from, to, 8, G, 'ascending').status,
    'unreachable',
    'the rising crossing of a lower height is before launch',
  );
  for (const s of solutions) {
    const t = traj(s);
    assert.ok(near(positionAt(t, t.duration), to, 1e-9), JSON.stringify(t));
    assert.ok(near(positionAt(t, 0), from));
    assert.ok(t.duration > 0);
    assert.ok(Object.isFrozen(t) && Object.isFrozen(t.velocity));
  }
});

test('mode-specific constraints hold', () => {
  const horizontal = traj(solveByHorizontalSpeed(from, to, 6, G));
  assert.ok(Math.abs(Math.hypot(horizontal.velocity[0], horizontal.velocity[2]) - 6) < 1e-12);
  assert.equal(traj(solveByVerticalSpeed(from, to, 8, G)).velocity[1], 8);
  const lob = traj(solveByApexHeight(from, to, 3, G));
  assert.ok(Math.abs(apex(lob).position[1] - (Math.max(from[1], to[1]) + 3)) < 1e-9);
  for (const arc of ['low', 'high'] as const) {
    const t = traj(solveByLaunchSpeed(from, to, 15, G, arc));
    assert.ok(Math.abs(Math.hypot(...t.velocity) - 15) < 1e-9, 'launch speed is the requested magnitude');
  }
  const low = traj(solveByLaunchSpeed(from, to, 15, G, 'low')),
    high = traj(solveByLaunchSpeed(from, to, 15, G, 'high'));
  assert.ok(low.velocity[1] < high.velocity[1] && low.duration < high.duration);
  const asc = traj(solveByVerticalSpeed([0, 0, 0], [5, 2, 0], 10, G, 'ascending'));
  const desc = traj(solveByVerticalSpeed([0, 0, 0], [5, 2, 0], 10, G, 'descending'));
  assert.ok(velocityAt(asc, asc.duration)[1] > 0 && velocityAt(desc, desc.duration)[1] < 0);
});

test('out-of-reach requests report unreachable instead of inventing a fallback duration', () => {
  assert.equal(solveByVerticalSpeed([0, 0, 0], [3, 10, 0], 5, G).status, 'unreachable', 'target above apex');
  assert.equal(solveByLaunchSpeed([0, 0, 0], [100, 0, 0], 10, G).status, 'unreachable', 'out of range');
  assert.equal(solveByHorizontalSpeed([0, 0, 0], [0, 5, 0], 3, G).status, 'unreachable', 'no horizontal distance');
  assert.equal(solveByApexHeight([0, 1, 0], [0, 1, 0], 0, G).status, 'unreachable');
  // Range boundary: maximum flat range is v^2/g at 45 degrees; both arcs coincide there.
  const v = 10,
    range = (v * v) / G;
  const edge = traj(solveByLaunchSpeed([0, 0, 0], [range, 0, 0], v, G));
  assert.ok(Math.abs(Math.atan2(edge.velocity[1], edge.velocity[0]) - Math.PI / 4) < 1e-6);
  assert.equal(solveByLaunchSpeed([0, 0, 0], [range * 1.0001, 0, 0], v, G).status, 'unreachable');
  // Straight up and straight down at a fixed speed.
  assert.ok(near(positionAt(traj(solveByLaunchSpeed([0, 0, 0], [0, 4, 0], 10, G)), 0), [0, 0, 0]));
  assert.equal(solveByLaunchSpeed([0, 0, 0], [0, 6, 0], 10, G).status, 'unreachable');
  const down = traj(solveByLaunchSpeed([0, 5, 0], [0, 0, 0], 2, G));
  assert.ok(near(positionAt(down, down.duration), [0, 0, 0], 1e-9));
});

test('evaluation helpers agree with the closed form', () => {
  const t = traj(solveByDuration([0, 0, 0], [10, 0, 0], 2, G));
  const top = apex(t);
  assert.ok(Math.abs(top.time - 1) < 1e-12);
  assert.ok(Math.abs(top.position[1] - G / 2) < 1e-12);
  assert.ok(Math.abs(timeAtHeight(t, 0)! - 2) < 1e-12);
  assert.equal(timeAtHeight(t, 0, 'ascending'), 0);
  assert.equal(timeAtHeight(t, 100), null);
  const points = samplePoints(t, 5);
  assert.equal(points.length, 15);
  assert.deepEqual([points[0], points[1], points[12], points[13]], [0, 0, 10, 0]);
  assert.ok(Math.abs(points[7]! - G / 2) < 1e-12, 'the middle sample is the apex');
  const reuse = new Float64Array(30);
  assert.equal(samplePoints(t, 10, reuse), reuse);
});

test('moving-target lead converges and the projectile meets the target', () => {
  const target: BallisticVec3 = [20, 0, 0],
    v: BallisticVec3 = [0, 0, 3];
  const s = solveLead([0, 0, 0], target, v, 25, G);
  const t = traj(s);
  const meet = positionAt(t, t.duration);
  assert.ok(near(meet, [target[0], target[1], target[2] + v[2] * t.duration], 1e-5), JSON.stringify(meet));
  assert.equal(solveLead([0, 0, 0], [50, 0, 0], [40, 0, 0], 15, G).status, 'unreachable', 'outrun');
});

test('inputs are validated and bounded', () => {
  for (const bad of [NaN, Infinity, 0, -1, 2e9]) {
    assert.throws(() => solveByDuration(from, to, bad, G), RangeError);
    assert.throws(() => solveByDuration(from, to, 1, bad), RangeError);
  }
  assert.throws(() => solveByDuration([0, 0] as never, to, 1, G), RangeError);
  assert.throws(() => solveByDuration([0, NaN, 0], to, 1, G), RangeError);
  assert.throws(() => solveByLaunchSpeed(from, to, 10, G, 'mid' as never), RangeError);
  assert.throws(() => solveLead(from, to, [0, 0, 0], 10, G, {samples: 4097}), RangeError);
  assert.throws(() => solveLead(from, to, [0, 0, 0], 10, G, {tolerance: 1e-300}), RangeError);
  assert.throws(() => solveLead(from, to, [0, 0, 0], 10, G, null as never), RangeError);
  assert.throws(() => timeAtHeight(traj(solveByDuration(from, to, 1, G)), 0, 'mid' as never), RangeError);
  const t = traj(solveByDuration(from, to, 1, G));
  for (const count of [1, 4097, 2.5]) assert.throws(() => samplePoints(t, count), RangeError);
  assert.throws(() => samplePoints(t, 4, new Float64Array(11)), RangeError);
  assert.throws(() => positionAt({...t, gravity: 0}, 0), RangeError);
  assert.equal(ballistics().id, 'ballistics');
});

test('review regressions: closed-form apex, bracketed lead, domain-safe results, stable roots', () => {
  // Zero apex height onto a higher target used to round the discriminant below zero.
  const zero = traj(solveByApexHeight([0, 0, 0], [3, 16.75565323414017, 1], 0, 12.380467571998722));
  assert.ok(near(positionAt(zero, zero.duration), [3, 16.75565323414017, 1], 1e-9));
  let failures = 0;
  for (let i = 0; i < 2000; i++) {
    const g = 0.1 + ((i * 7919) % 300) / 10,
      y = 0.01 + ((i * 104729) % 2000) / 100;
    if (solveByApexHeight([0, 0, 0], [1 + (i % 7), y, 2], 0, g).status !== 'solved') failures++;
  }
  assert.equal(failures, 0);
  // A target approaching the shooter: an intermediate aim point used to abort the search.
  const lead = traj(solveLead([0, 0, 0], [25, 0, 0], [-10, 0, 0], 15, G));
  assert.ok(Math.abs(Math.hypot(...lead.velocity) - 15) < 1e-6);
  assert.ok(near(positionAt(lead, lead.duration), [25 - 10 * lead.duration, 0, 0], 1e-6));
  const high = traj(solveLead([0, 0, 0], [25, 0, 0], [-10, 0, 0], 15, G, {arc: 'high'}));
  assert.ok(high.duration > lead.duration && Math.abs(Math.hypot(...high.velocity) - 15) < 1e-6);
  // Randomized lead: every solved result meets the moving target at the requested speed.
  for (let i = 0; i < 300; i++) {
    const r = (k: number) => (((i + 1) * k) % 1000) / 1000;
    const target: BallisticVec3 = [5 + 40 * r(613), 10 * r(331) - 5, 40 * r(797) - 20];
    const vel: BallisticVec3 = [10 * r(211) - 5, 2 * r(101) - 1, 10 * r(457) - 5];
    const s = solveLead([0, 0, 0], target, vel, 30, G, {arc: i % 2 ? 'high' : 'low'});
    if (s.status !== 'solved') continue;
    const t = s.trajectory;
    assert.ok(Math.abs(Math.hypot(...t.velocity) - 30) < 1e-5);
    const meet = target.map((v, k) => v + vel[k]! * t.duration);
    assert.ok(near(positionAt(t, t.duration), meet, 1e-6));
  }
  // Results outside the numeric domain are unreachable, never solved-but-unusable or thrown mid-solve.
  assert.equal(solveByDuration([0, 0, 0], [100, 0, 0], 1e-8, G).status, 'unreachable');
  assert.equal(solveByHorizontalSpeed([-1e9, 0, 0], [1e9, 0, 0], 1e-9, G).status, 'unreachable');
  assert.doesNotThrow(() => solveByVerticalSpeed([0, 0, 0], [1, 0, 0], 1e3, 1e-7));
  // Cancellation-free crossings: a tiny rise at a huge vertical speed is still after launch.
  const quick = traj(solveByVerticalSpeed([0, 0, 0], [0, 1e-6, 0], 1e8, G, 'ascending'));
  assert.ok(Math.abs(quick.velocity[1] - 1e8) / 1e8 < 1e-9);
  // Straight-up shots honour the arc: low is direct, high goes up and falls back; same point is high-only.
  const direct = traj(solveByLaunchSpeed([0, 0, 0], [0, 2, 0], 10, G, 'low')),
    lobbed = traj(solveByLaunchSpeed([0, 0, 0], [0, 2, 0], 10, G, 'high'));
  assert.ok(direct.duration < lobbed.duration);
  assert.equal(solveByLaunchSpeed([0, 0, 0], [0, 0, 0], 10, G, 'low').status, 'unreachable');
  assert.ok(Math.abs(traj(solveByLaunchSpeed([0, 0, 0], [0, 0, 0], 10, G, 'high')).duration - 20 / G) < 1e-12);
});
