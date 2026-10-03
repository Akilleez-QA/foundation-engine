import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatforms } from './platforms';
import { createJumpFeel } from './jump';

test('MV-02: platforms advance on exact path samples and report delta and mean velocity', () => {
  const p = createPlatforms();
  p.add('lift', { halfX: 1, halfZ: 1, path: t => ({ x: 2 * t, y: 1 + Math.sin(t), z: 0 }) });
  assert.deepEqual(p.velocity('lift'), { dx: 0, dy: 0, dz: 0 }, 'no motion before the first tick');
  p.advance(0.1); p.advance(0.1);
  assert.equal(p.time, 0.2);
  const d = p.delta('lift')!, v = p.velocity('lift')!;
  assert.ok(Math.abs(d.dx - 0.2) < 1e-12 && Math.abs(d.dy - (Math.sin(0.2) - Math.sin(0.1))) < 1e-12);
  assert.ok(Math.abs(v.dx - 2) < 1e-9 && Math.abs(v.dy - d.dy / 0.1) < 1e-9);
  assert.equal(p.supportOn('lift', 0.4 + 0.99, 0), p.pose('lift')!.y);
  assert.equal(p.supportOn('lift', 0.4 + 1.01, 0), null);
  assert.equal(p.delta('missing'), null);
});

test('MV-02: invalid platforms, paths, speeds and steps are refused without changing any pose', () => {
  assert.throws(() => createPlatforms({ maxPlatforms: 0 }), RangeError);
  assert.throws(() => createPlatforms({ maxSpeed: 0 }), RangeError);
  const p = createPlatforms({ maxPlatforms: 2, maxSpeed: 10 });
  assert.throws(() => p.add('Bad Id', { halfX: 1, halfZ: 1, path: () => ({ x: 0, y: 0, z: 0 }) }), RangeError);
  assert.throws(() => p.add('a', { halfX: 0, halfZ: 1, path: () => ({ x: 0, y: 0, z: 0 }) }), RangeError);
  assert.throws(() => p.add('a', { halfX: 1, halfZ: 1, path: () => ({ x: NaN, y: 0, z: 0 }) }), RangeError);
  let fast = false;
  p.add('a', { halfX: 1, halfZ: 1, path: t => ({ x: t, y: 0, z: 0 }) });
  p.add('b', { halfX: 1, halfZ: 1, path: t => ({ x: fast ? 1e3 * t : 0, y: 0, z: 0 }) });
  assert.throws(() => p.add('c', { halfX: 1, halfZ: 1, path: () => ({ x: 0, y: 0, z: 0 }) }), /at most 2/);
  for (const dt of [0, -1, NaN, 0.5]) assert.throws(() => p.advance(dt), RangeError);
  p.advance(0.1); fast = true;
  const before = [p.pose('a'), p.pose('b'), p.time];
  assert.throws(() => p.advance(0.1), /faster than 10/);
  assert.deepEqual([p.pose('a'), p.pose('b'), p.time], before, 'a refused advance moves nothing, not even valid platforms');
  // A declared cut accepts the discontinuity once, with zero delta.
  assert.equal(p.cut('b'), true); p.advance(0.1);
  assert.deepEqual(p.delta('b'), { dx: 0, dy: 0, dz: 0 }); assert.equal(p.pose('b')!.x, 200);
  assert.equal(p.remove('b'), true); assert.equal(p.remove('b'), false);
  p.restart(); assert.equal(p.time, 0); assert.deepEqual(p.delta('a'), { dx: 0, dy: 0, dz: 0 });
});

test('MV-02: the one-way catch is evaluated in each platform frame', () => {
  const p = createPlatforms();
  let y = 0;
  p.add('rising', { halfX: 1, halfZ: 1, path: () => ({ x: 0, y, z: 0 }) });
  p.add('same', { halfX: 1, halfZ: 1, path: () => ({ x: 0, y, z: 0 }) });
  y = -0.05; p.cut('rising'); p.cut('same'); p.advance(0.01);
  y = 0.05; p.advance(0.01);
  // A platform that rose past the actor's feet (0) picks it up; ties go to the earlier platform.
  assert.deepEqual(p.catch(0, 0, 0, 0), { id: 'rising', height: 0.05 });
  // An actor whose feet started below the platform's previous top passes through it.
  assert.equal(p.catch(0, 0, -0.1, -0.1), null);
  assert.equal(p.catch(2, 0, 0, 0), null, 'outside the footprint');
  assert.throws(() => p.catch(NaN, 0, 0, 0), RangeError);
});

test('MV-02: a launch boost adds the supporting surface velocity to the jump and keeps release gravity', () => {
  const feel = createJumpFeel({ height: 1, timeToApex: 0.3, releaseGravityScale: 3 });
  const r = feel.step(1 / 60, { pressed: true, held: true, grounded: true, boost: 2 });
  assert.equal(r.jumped, true);
  assert.ok(Math.abs(r.vy - (feel.derived.launchSpeed + 2 - feel.derived.gravity / 60)) < 1e-9);
  feel.step(1 / 60, { pressed: false, held: false, grounded: false });
  assert.equal(feel.state.released, true, 'a boosted jump is still a jump: release gravity applies');
  assert.throws(() => feel.step(1 / 60, { pressed: false, held: false, grounded: false, boost: NaN }), RangeError);
});
