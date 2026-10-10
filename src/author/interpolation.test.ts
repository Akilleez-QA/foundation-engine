import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../core/ecs/world';
import {createSystemRunner} from '../core/ecs/systems';
import {Transform} from './index';
import {captureInterpolation, Interpolated, presentTransform, presentedTransform} from './interpolation';

const pose = (x: number, ry = 0) => ({x, y: 0, z: 0, rx: 0, ry, rz: 0, scale: 1});

test('presentTransform blends the captured and current pose and returns the Transform itself otherwise', () => {
  const tr = pose(10, 0.5);
  assert.equal(presentTransform(tr, undefined, 0.5), tr, 'no Interpolated: unchanged object');
  const it = Interpolated().value;
  assert.equal(presentTransform(tr, it, 0.5), tr, 'nothing captured yet');
  Object.assign(it, {captured: 0, previousX: 6, previousRy: 0.1, previousScale: 1});
  const mid = presentTransform(tr, it, 0.25);
  assert.equal(mid.x, 7);
  assert.ok(Math.abs(mid.ry - 0.2) < 1e-12);
  assert.equal(presentTransform(tr, it, 0).x, 6, 'alpha 0 draws the pose before the latest step');
  for (const alpha of [NaN, -0.1, 1.5]) assert.equal(presentTransform(tr, it, alpha), tr);
  assert.equal(presentTransform(tr, {...it, revision: 1}, 0.5), tr, 'a changed revision snaps');
  assert.equal(presentTransform(tr, {...it, teleport: 3}, 0.5), tr, 'a step longer than teleport snaps');
  assert.equal(presentTransform(tr, {...it, teleport: 5}, 0.5).x, 8);
  assert.equal(presentTransform({...tr, y: Infinity}, it, 0.5).y, Infinity, 'non-finite falls back to the Transform');
});

test('rotations blend along the shorter arc, including across the ±π seam', () => {
  const it = {...Interpolated().value, captured: 0, previousRy: 3.0};
  const blended = presentTransform(pose(0, -3.0), it, 0.5).ry;
  // The shorter way from 3.0 to -3.0 passes through π (distance 2π - 6 ≈ 0.283), not through 0.
  assert.ok(Math.abs(blended - (3.0 + (2 * Math.PI - 6) / 2)) < 1e-12, String(blended));
});

test('composed with the fixed runner, a 144 Hz display sees smooth motion instead of holds and jumps', () => {
  const world = new World();
  const e = world.spawn(Transform(), Interpolated());
  const plain = world.spawn(Transform());
  const move = {
    id: 'move',
    run: () => {
      world.get(e, Transform)!.x += 1;
      world.get(plain, Transform)!.x += 1;
    },
  };
  const runner = createSystemRunner([move], {step: 1 / 60, beforeStep: () => captureInterpolation(world)});
  const drawn: number[] = [];
  const latest: number[] = [];
  for (let i = 0; i < 144; i++) {
    runner.frame({}, 1 / 144);
    drawn.push(presentedTransform(world, e, runner.alpha)!.x);
    latest.push(presentedTransform(world, plain, runner.alpha)!.x);
  }
  const steps = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i]!);
  const smooth = steps(drawn.slice(10)),
    jerky = steps(latest.slice(10));
  assert.ok(
    smooth.every(d => d >= 0),
    'never moves backwards',
  );
  assert.ok(Math.max(...smooth) - Math.min(...smooth) < 1e-6, `uniform per-frame motion: ${smooth.slice(0, 6)}`);
  assert.ok(Math.abs(smooth[0]! - 60 / 144) < 1e-6);
  assert.deepEqual([...new Set(jerky)].sort(), [0, 1], 'without opting in: holds and whole-step jumps');
  assert.ok(
    drawn.every((x, i) => x <= latest[i]! && x >= latest[i]! - 1),
    'presentation lags the simulation by less than one step',
  );
});

test('a revision change snaps a placed entity instead of sliding it across the scene', () => {
  const world = new World();
  const e = world.spawn(Transform(), Interpolated());
  let teleport = false;
  const runner = createSystemRunner(
    [
      {
        id: 'move',
        run: () => {
          const tr = world.get(e, Transform)!;
          if (teleport) {
            tr.x = 100;
            world.get(e, Interpolated)!.revision++;
            teleport = false;
          } else tr.x += 1;
        },
      },
    ],
    {step: 1 / 60, beforeStep: () => captureInterpolation(world)},
  );
  for (let i = 0; i < 10; i++) runner.frame({}, 1 / 144);
  teleport = true;
  let x = NaN;
  for (let i = 0; i < 3 && Number.isNaN(x); i++) {
    runner.frame({}, 1 / 144);
    if (world.get(e, Transform)!.x === 100) x = presentedTransform(world, e, runner.alpha)!.x;
  }
  assert.equal(x, 100);
  runner.frame({}, 1 / 60);
  const after = presentedTransform(world, e, runner.alpha)!.x;
  assert.ok(after >= 100 && after <= 101, String(after));
});
