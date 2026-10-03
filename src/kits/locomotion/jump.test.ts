import test from 'node:test';
import assert from 'node:assert/strict';
import {createJumpFeel, deriveJump, type JumpFeelConfig} from './jump';
import {must} from '../../testing/must';

const RATES = [30, 60, 120, 144, 165, 240];
/** 1/6 s is a whole number of ticks at 30, 60, 120, 144 and 240 Hz (165 Hz is checked separately with one-tick tolerance). */
const ALIGNED = [30, 60, 120, 144, 240];

interface Run {
  y: number[];
  t: number[];
  apex: number;
  jumps: number;
  landedAt: number | null;
}
/**
 * Flat floor at y = 0. `script(t)` gives the facts at tick start time t; the floor reports support. Returns positions
 * sampled at every tick end.
 */
function simulate(
  config: JumpFeelConfig,
  hz: number,
  seconds: number,
  script: (t: number, dt: number) => {pressed: boolean; held: boolean; floor?: boolean},
  start = 0,
): Run {
  const feel = createJumpFeel(config),
    dt = 1 / hz,
    n = Math.round(seconds * hz);
  let y = start,
    apex = start,
    jumps = 0,
    landedAt: number | null = null,
    airborne = false;
  const out: Run = {y: [], t: [], apex: 0, jumps: 0, landedAt: null};
  for (let i = 0; i < n; i++) {
    const t = i * dt,
      s = script(t, dt),
      floor = s.floor ?? true;
    const r = feel.step(dt, {pressed: s.pressed, held: s.held, grounded: floor && y <= 1e-12});
    if (r.jumped) jumps++;
    apex = Math.max(apex, y + r.peak);
    y += r.dy;
    if (y > 1e-12) airborne = true;
    if (floor && y <= 0 && r.vy <= 0) {
      if (airborne && landedAt === null) landedAt = t + dt;
      y = 0;
      airborne = false;
    }
    out.y.push(y);
    out.t.push(t + dt);
  }
  return {...out, apex, jumps, landedAt};
}
const at = (run: Run, time: number) =>
  must(run.y[Math.round(time * (run.y.length / must(run.t[run.t.length - 1]))) - 1], `sample at ${time} s`);
const pressOnce =
  (when = 0) =>
  (t: number, dt: number) => ({pressed: t <= when && when < t + dt - 1e-12, held: t >= when - 1e-12});

test('MV-01: derivation reproduces the height/time parabola and stays exact with apex modulation', () => {
  const d = deriveJump({height: 2, timeToApex: 0.4});
  assert.ok(Math.abs(d.launchSpeed - 10) < 1e-12 && Math.abs(d.gravity - 25) < 1e-12);
  const m = deriveJump({height: 2, timeToApex: 0.4, apexBand: 0.3, apexGravityScale: 0.4}),
    b = m.apexSpeed;
  // Rise with full gravity to the band, then reduced gravity to zero: both segments must sum to the configured pair.
  const h = (m.launchSpeed ** 2 - b ** 2) / (2 * m.gravity) + b ** 2 / (2 * m.apexGravity);
  const t = (m.launchSpeed - b) / m.gravity + b / m.apexGravity;
  assert.ok(Math.abs(h - 2) < 1e-12 && Math.abs(t - 0.4) < 1e-12, `${h} ${t}`);
});

test('MV-01: a held jump reaches exactly the configured apex and the same arc at 30–240 Hz', () => {
  for (const config of [
    {height: 2, timeToApex: 0.4},
    {height: 1.2, timeToApex: 0.35, apexBand: 0.25, apexGravityScale: 0.5, fallGravityScale: 2},
  ]) {
    const reference = simulate(config, 240, 1.5, pressOnce(0));
    for (const hz of RATES) {
      const run = simulate(config, hz, 1.5, pressOnce(0));
      assert.equal(run.jumps, 1, `${hz} Hz jumps`);
      assert.ok(Math.abs(run.apex - config.height) < 1e-9, `${hz} Hz apex ${run.apex}`);
      assert.ok(
        Math.abs(run.landedAt! - reference.landedAt!) <= 1 / hz + 1e-9,
        `${hz} Hz landing ${run.landedAt} vs ${reference.landedAt}`,
      );
      if (ALIGNED.includes(hz))
        for (let k = 1; k * (1 / 6) < reference.landedAt! - 1e-9; k++) {
          assert.ok(Math.abs(at(run, k / 6) - at(reference, k / 6)) < 1e-9, `${hz} Hz at ${k}/6 s`);
        }
    }
  }
});

test('MV-01: releasing early cuts the rise, identically across tick rates, and never below the cut arc', () => {
  const config = {height: 2, timeToApex: 0.4, releaseGravityScale: 3},
    release = 1 / 6;
  const script = (t: number, dt: number) => ({pressed: t === 0, held: t < release - 1e-9});
  const full = simulate(config, 60, 1.5, pressOnce(0)),
    reference = simulate(config, 240, 1.5, script);
  const d = deriveJump(config),
    v = d.launchSpeed - d.gravity * release;
  const expected = d.launchSpeed * release - (d.gravity * release * release) / 2 + (v * v) / (2 * d.releaseGravity);
  assert.ok(reference.apex < full.apex - 0.3, 'variable height lowers the apex');
  for (const hz of ALIGNED) {
    const run = simulate(config, hz, 1.5, script);
    assert.ok(Math.abs(run.apex - expected) < 1e-9, `${hz} Hz apex ${run.apex} vs ${expected}`);
    for (let k = 1; k <= 3; k++)
      assert.ok(Math.abs(at(run, k / 6) - at(reference, k / 6)) < 1e-9, `${hz} Hz at ${k}/6 s`);
  }
  // Unaligned release (165 Hz) is quantised to one tick: the apex stays within that tick's effect.
  const odd = simulate(config, 165, 1.5, script);
  assert.ok(Math.abs(odd.apex - expected) < d.launchSpeed / 165, `165 Hz apex ${odd.apex}`);
});

test('MV-01: coyote time admits a late press inside the window and refuses one outside it at every rate', () => {
  for (const hz of RATES) {
    // The press lands on the first tick starting at or after `leave + delay`; the support ends on the first tick at or after `leave`.
    const leave = 0.2;
    for (const [delay, coyote, want] of [
      [0.05, 0.1, 1],
      [0.16, 0.1, 0],
      [0, 0, 0],
      [0.12, 0.25, 1],
    ] as const) {
      const run = simulate(
        {height: 1, timeToApex: 0.3, coyoteTime: coyote, bufferTime: 0},
        hz,
        1,
        (t, dt) => ({
          pressed: t >= leave + delay - 1e-12 && t - dt < leave + delay - 1e-12,
          held: true,
          floor: t < leave - 1e-12,
        }),
        0,
      );
      assert.equal(run.jumps, want, `${hz} Hz delay ${delay} coyote ${coyote}`);
    }
  }
});

test('MV-01: a buffered press jumps on landing exactly once, and an expired one never does', () => {
  for (const hz of RATES) {
    // Start 1 m up with nothing pressed; the fall lasts sqrt(2/fallGravity) seconds.
    const config = {height: 1, timeToApex: 0.3, bufferTime: 0.1, coyoteTime: 0},
      d = deriveJump(config),
      fall = Math.sqrt(2 / d.fallGravity);
    for (const [early, want] of [
      [0.06, 1],
      [0.2, 0],
    ] as const) {
      const press = fall - early;
      const run = simulate(
        config,
        hz,
        2.5,
        (t, dt) => ({pressed: t <= press && press < t + dt - 1e-12, held: t >= press}),
        1,
      );
      assert.equal(run.jumps, want, `${hz} Hz early ${early}`);
    }
  }
});

test('MV-01: holding the action never re-jumps; each press is consumed at most once', () => {
  for (const hz of RATES) {
    const run = simulate({height: 1, timeToApex: 0.3}, hz, 3, pressOnce(0));
    assert.equal(run.jumps, 1, `${hz} Hz`);
  }
});

test('MV-01: terminal fall speed bounds descent; ceilings and external launches are explicit', () => {
  const feel = createJumpFeel({height: 1, timeToApex: 0.3, maxFallSpeed: 4});
  let r = feel.step(1 / 60, {pressed: false, held: false, grounded: false});
  for (let i = 0; i < 120; i++) r = feel.step(1 / 60, {pressed: false, held: false, grounded: false});
  assert.equal(r.vy, -4);
  assert.ok(Math.abs(r.dy + 4 / 60) < 1e-12);
  feel.setVelocity(6);
  r = feel.step(1 / 60, {pressed: false, held: false, grounded: false});
  assert.ok(Math.abs(r.vy - (6 - feel.derived.gravity / 60)) < 1e-9, 'a launch is not cut by release gravity');
  feel.ceiling();
  assert.equal(feel.state.vy, 0);
  assert.throws(() => feel.setVelocity(Number.NaN), RangeError);
});

test('MV-01: invalid configuration and steps are rejected without changing state', () => {
  for (const bad of [
    {height: 0, timeToApex: 0.3},
    {height: 1, timeToApex: 0},
    {height: 1, timeToApex: 0.3, coyoteTime: 2},
    {height: 1, timeToApex: 0.3, apexGravityScale: 0},
    {height: 1, timeToApex: 0.3, fallGravityScale: 0.5},
    {height: Infinity, timeToApex: 1},
    {height: 1, timeToApex: 0.3, maxDt: 1},
  ] as JumpFeelConfig[]) {
    assert.throws(() => createJumpFeel(bad), RangeError, JSON.stringify(bad));
  }
  const feel = createJumpFeel({height: 1, timeToApex: 0.3});
  feel.step(1 / 60, {pressed: true, held: true, grounded: true});
  const before = feel.state;
  for (const dt of [-1, Number.NaN, Infinity, 0.5])
    assert.throws(() => feel.step(dt, {pressed: true, held: true, grounded: true}), RangeError);
  assert.throws(() => feel.step(1 / 60, {pressed: 1 as unknown as boolean, held: true, grounded: true}), RangeError);
  assert.deepEqual(feel.state, before);
});

test('MV-01: a zero-length step records a press without ageing it; reset and cancelPress drop it', () => {
  const feel = createJumpFeel({height: 1, timeToApex: 0.3, bufferTime: 0});
  assert.equal(feel.step(0, {pressed: true, held: true, grounded: true}).jumped, false);
  assert.equal(feel.step(0, {pressed: false, held: true, grounded: true}).jumped, false);
  assert.equal(
    feel.step(1 / 60, {pressed: false, held: true, grounded: true}).jumped,
    true,
    'retained press jumps on the next tick',
  );
  assert.equal(feel.step(1 / 60, {pressed: false, held: true, grounded: false}).jumped, false, 'and only once');
  const again = createJumpFeel({height: 1, timeToApex: 0.3, bufferTime: 0.5});
  again.step(0, {pressed: true, held: true, grounded: false});
  again.cancelPress();
  assert.equal(again.step(1 / 60, {pressed: false, held: true, grounded: true}).jumped, false);
  again.step(0, {pressed: true, held: true, grounded: false});
  again.reset();
  assert.equal(again.step(1 / 60, {pressed: false, held: true, grounded: true}).jumped, false);
  assert.deepEqual(
    {...again.state, vy: 0},
    {vy: 0, grounded: true, fromJump: false, released: false, sinceSupport: 0, pressAge: null},
  );
});

/** Ticks after the event at which a press still jumps, scanning offsets 1…n (coyote) or 0…n (buffer). */
function admittedCoyote(window: number, hz: number) {
  let last = 0;
  for (let n = 1; n <= hz; n++) {
    const feel = createJumpFeel({height: 1, timeToApex: 0.3, coyoteTime: window, bufferTime: 0}),
      dt = 1 / hz;
    feel.step(dt, {pressed: false, held: false, grounded: true});
    let jumped = false;
    for (let k = 1; k <= n; k++)
      jumped = feel.step(dt, {pressed: k === n, held: true, grounded: false}).jumped || jumped;
    if (jumped) last = n;
  }
  return last;
}
function admittedBuffer(window: number, hz: number) {
  let last = -1;
  for (let n = 0; n <= hz; n++) {
    const feel = createJumpFeel({height: 1, timeToApex: 0.3, coyoteTime: 0, bufferTime: window}),
      dt = 1 / hz;
    feel.setVelocity(-1);
    let jumped = false;
    for (let k = 0; k <= n; k++)
      jumped = feel.step(dt, {pressed: k === 0, held: true, grounded: k === n}).jumped || jumped;
    if (jumped) last = n;
  }
  return last;
}

test('MV-01: coyote and buffer windows admit exactly floor(window × rate) ticks after the event at every rate', () => {
  for (const hz of [30, 60, 120, 144, 165, 240])
    for (const window of [0, 0.05, 0.1, 0.2, 1 / 6, 0.25]) {
      const want = Math.floor(window * hz + 1e-9);
      assert.equal(admittedCoyote(window, hz), want, `coyote ${window} at ${hz} Hz`);
      assert.equal(admittedBuffer(window, hz), want, `buffer ${window} at ${hz} Hz`);
    }
});

test('MV-01: restore() returns the controller exactly to its last save()', () => {
  const feel = createJumpFeel({height: 2, timeToApex: 0.4}),
    dt = 1 / 30;
  feel.step(dt, {pressed: false, held: false, grounded: true});
  feel.step(dt, {pressed: true, held: true, grounded: true});
  feel.save();
  const saved = feel.state,
    ref = createJumpFeel({height: 2, timeToApex: 0.4});
  ref.step(dt, {pressed: false, held: false, grounded: true});
  ref.step(dt, {pressed: true, held: true, grounded: true});
  feel.step(dt, {pressed: false, held: false, grounded: false});
  feel.setVelocity(5);
  feel.cancelPress();
  feel.restore();
  assert.deepEqual(feel.state, saved);
  for (let i = 0; i < 20; i++)
    assert.deepEqual(
      feel.step(dt, {pressed: i === 3, held: i < 5, grounded: i > 10}),
      ref.step(dt, {pressed: i === 3, held: i < 5, grounded: i > 10}),
    );
});
