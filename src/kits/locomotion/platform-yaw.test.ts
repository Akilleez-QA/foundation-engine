import test from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, testScene, Name, Transform, type InputState, type SceneContext} from '../../author';
import {createSystemRunner} from '../../core/ecs/systems';
import {jumpSystem, platformSystem, type PlatformLeave} from './jump-system';
import {createPlatforms, wrapYaw, type PlatformDef, type Platforms} from './platforms';
import {must} from '../../testing/must';
import {Walls} from '../character';

const jump = {height: 1.5, timeToApex: 0.35, coyoteTime: 0.1, bufferTime: 0, releaseGravityScale: 1};
const TAU = 2 * Math.PI;
/** Rotate (x, z) by `a` radians with the `Transform.ry` sense. */
const rot = (a: number, x: number, z: number): [number, number] => [
  Math.cos(a) * x + Math.sin(a) * z,
  -Math.sin(a) * x + Math.cos(a) * z,
];

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  ry: number;
  px: number;
  py: number;
  pz: number;
  yaw: number;
  version: number;
}
interface SpinOptions {
  path: PlatformDef['path'];
  halfX?: number;
  halfZ?: number;
  start: {x: number; y: number; z: number; ry?: number};
  press?: (t: number, dt: number) => boolean;
  onLeave?: PlatformLeave;
  carryFacing?: boolean;
  maxSpeed?: number;
  maxTurnRate?: number;
  each?: (t: number, p: Platforms) => void;
  bind?: boolean;
  extra?: unknown[][];
  radius?: number;
}
/** The real fixed-step runner at `hz` (one tick per frame): platform system, jump adapter, probe. */
async function spin(hz: number, seconds: number, o: SpinOptions) {
  const t = await testScene(
    defineScene({
      id: 'spin',
      title: 'spin',
      entities: [
        [Name({name: 'player'}), Transform(o.start)],
        [Name({name: 'disc'}), Transform({})],
        ...(o.extra ?? []),
      ] as never,
    }),
    {},
  );
  const tr = t.world.get(t.ctx.named('player')!, Transform)!,
    disc = t.world.get(t.ctx.named('disc')!, Transform)!;
  const platforms = createPlatforms({maxSpeed: o.maxSpeed, maxTurnRate: o.maxTurnRate});
  platforms.add('deck', {halfX: o.halfX ?? 3, halfZ: o.halfZ ?? 3, path: o.path});
  let now = 0,
    pressed = false;
  const input: InputState = {
    describe: () => null,
    pressed: id => id === 'jump' && pressed,
    pressedAt: () => null,
    held: id => id === 'jump',
    axis: () => 0,
    pointer: {x: 0, y: 0, down: false, pressed: false},
  };
  const ctx = Object.create(t.ctx, {input: {value: input}}) as SceneContext;
  const out: Sample[] = [],
    errors: unknown[] = [];
  const runner = createSystemRunner<SceneContext>(
    [
      platformSystem(platforms, o.bind ? {bind: {deck: 'disc'}} : {}),
      jumpSystem({
        action: 'jump',
        config: jump,
        ground: () => null,
        platforms,
        onLeave: o.onLeave,
        carryFacing: o.carryFacing,
        radius: o.radius,
      }),
      {
        id: 'probe',
        run() {
          const p = platforms.pose('deck') ?? {x: NaN, y: NaN, z: NaN, yaw: NaN};
          out.push({
            t: now + 1 / hz,
            x: tr.x,
            y: tr.y,
            z: tr.z,
            ry: tr.ry,
            px: p.x,
            py: p.y,
            pz: p.z,
            yaw: p.yaw ?? 0,
            version: t.world.version,
          });
          o.each?.(now + 1 / hz, platforms);
        },
      },
    ],
    {step: 1 / hz, maxSteps: 1, report: (_id, error) => void errors.push(error)},
  );
  const dt = 1 / hz,
    n = Math.round(seconds * hz);
  try {
    for (let i = 0; i < n; i++) {
      now = i * dt;
      pressed = o.press?.(now, dt) ?? false;
      runner.frame(ctx, dt);
      if (errors.length) throw errors[0];
    }
  } finally {
    t.dispose();
  }
  return {out, disc: {x: disc.x, y: disc.y, z: disc.z, ry: disc.ry}};
}
const at = (s: Sample[], time: number) => s.reduce((a, b) => (Math.abs(b.t - time) < Math.abs(a.t - time) ? b : a));
const pressAt = (when: number) => (t: number, dt: number) => t <= when + 1e-9 && when < t + dt - 1e-9;

test('MV-02 turning: an unturned platform keeps the exact unturned results; a turning one reports yaw, dyaw and carry', () => {
  const p = createPlatforms();
  p.add('flat', {halfX: 1, halfZ: 1, path: t => ({x: 2 * t, y: 1, z: 0})});
  p.add('disc', {halfX: 1, halfZ: 1, path: t => ({x: 0, y: 1, z: 0, yaw: 0.5 * t})});
  p.advance(0.1);
  assert.deepEqual(Object.keys(p.delta('flat')!), ['dx', 'dy', 'dz'], 'no yaw field without a yaw path');
  assert.deepEqual(Object.keys(p.pose('flat')!), ['x', 'y', 'z']);
  const d = p.delta('flat')!,
    v = p.velocity('flat')!,
    c = p.carry('flat', 0.3, -0.2)!;
  assert.deepEqual(
    [c.dx, c.dy, c.dz, c.dyaw, c.vx, c.vy, c.vz],
    [d.dx, d.dy, d.dz, 0, v.dx, v.dy, v.dz],
    'unturned carry equals delta and velocity bit for bit',
  );
  assert.equal(p.pose('disc')!.yaw, 0.05);
  assert.ok(Math.abs(p.delta('disc')!.dyaw! - 0.05) < 1e-15 && Math.abs(p.velocity('disc')!.dyaw! - 0.5) < 1e-12);
  // A point at offset (1, 0) from the pivot moves to R(0.05)·(1, 0).
  const k = p.carry('disc', 1, 0)!,
    [ex, ez] = rot(0.05, 1, 0);
  assert.ok(Math.abs(1 + k.dx - ex) < 1e-15 && Math.abs(k.dz - ez) < 1e-15 && k.dyaw === p.delta('disc')!.dyaw);
  assert.ok(Math.abs(Math.hypot(k.vx, k.vz) - (2 * Math.sin(0.025)) / 0.1) < 1e-12, 'mean velocity is chord / tick');
  assert.equal(p.carry('missing', 0, 0), null);
  assert.throws(() => p.carry('disc', NaN, 0), RangeError);
});

test('MV-02 turning: yaw wraps to the shortest turn across ±π', () => {
  assert.equal(wrapYaw(0.3), 0.3, 'exact below π');
  assert.ok(Math.abs(wrapYaw(TAU - 0.1) + 0.1) < 1e-15 && Math.abs(wrapYaw(-TAU + 0.1) - 0.1) < 1e-15);
  const p = createPlatforms();
  // A path that returns yaw wrapped into (−π, π]: crossing +π reads as a small positive turn, not −2π.
  const wrapped = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);
  p.add('disc', {halfX: 1, halfZ: 1, path: t => ({x: 0, y: 0, z: 0, yaw: wrapped(Math.PI - 0.05 + t)})});
  p.advance(0.1);
  assert.ok(p.pose('disc')!.yaw! < 0, 'the sample wrapped');
  assert.ok(Math.abs(p.delta('disc')!.dyaw! - 0.1) < 1e-12);
});

test('MV-02 turning: a turned footprint is an oriented rectangle for support, catch and standing', () => {
  const p = createPlatforms();
  let yaw = 0;
  p.add('bar', {halfX: 2, halfZ: 0.25, path: () => ({x: 10, y: 1, z: 0, yaw})});
  assert.equal(p.supportOn('bar', 11.9, 0.2), 1, 'unturned: inside the axis-aligned box');
  assert.equal(p.supportOn('bar', 10, 1.9), null);
  yaw = Math.PI / 2;
  p.cut('bar');
  p.advance(0.01);
  // A quarter turn: local +x maps to world −z, so the bar now lies along z.
  assert.equal(p.supportOn('bar', 11.9, 0.2), null, 'the old axis-aligned corner is off the turned bar');
  assert.equal(p.supportOn('bar', 10, -1.99), 1);
  assert.equal(p.supportOn('bar', 10.24, 1.99), 1, 'a turned corner is inside');
  assert.equal(p.supportOn('bar', 10.26, 1.99), null, 'just past the turned corner is outside');
  assert.deepEqual(p.catch(10, 1.99, 1, 1), {id: 'bar', height: 1});
  assert.equal(p.catch(11.9, 0, 1, 1), null);
  // standing() uses the previous footprint, which after the cut is the turned one.
  assert.equal(p.standing(10, 1.99, 1), 'bar');
  assert.equal(p.standing(11.9, 0, 1), null);
  // An eighth turn: the corner of the unturned box (2, 0.25) is outside, the turned corner inside.
  yaw = Math.PI / 4;
  p.cut('bar');
  p.advance(0.01);
  const [cx, cz] = rot(Math.PI / 4, 2, 0.25);
  assert.equal(p.supportOn('bar', 10 + cx * 0.999, cz * 0.999), 1);
  assert.equal(p.supportOn('bar', 12, 0.25), null);
});

test('MV-02 turning: turn bounds, consistent yaw, corner speed and cut are checked before anything moves', () => {
  for (const maxTurnRate of [0, -1, NaN, 1001]) assert.throws(() => createPlatforms({maxTurnRate}), RangeError);
  const p = createPlatforms({maxTurnRate: 4, maxSpeed: 10});
  let yaw = 0,
    drop = false;
  p.add('a', {halfX: 1, halfZ: 1, path: t => ({x: t, y: 0, z: 0})});
  p.add('disc', {halfX: 1, halfZ: 1, path: () => (drop ? {x: 0, y: 0, z: 0} : {x: 0, y: 0, z: 0, yaw})});
  assert.throws(
    () => p.add('bad', {halfX: 1, halfZ: 1, path: () => ({x: 0, y: 0, z: 0, yaw: NaN})}),
    /finite within ±1e6/,
  );
  assert.throws(() => p.add('far', {halfX: 1, halfZ: 1, path: () => ({x: 0, y: 0, z: 0, yaw: 2e6})}), RangeError);
  p.advance(0.1);
  const before = [p.pose('a'), p.pose('disc'), p.time];
  yaw = 0.5; // 5 rad/s over 0.1 s
  assert.throws(() => p.advance(0.1), /turned faster than 4/);
  assert.deepEqual([p.pose('a'), p.pose('disc'), p.time], before, 'a refused turn moves nothing');
  yaw = 0.01;
  const slow = createPlatforms({maxTurnRate: 20});
  slow.add('disc', {halfX: 1, halfZ: 1, path: t => ({x: 0, y: 0, z: 0, yaw: t})});
  assert.throws(() => slow.advance(0.2), /half turn per tick/, '20 rad/s · 0.2 s ≥ π is ambiguous');
  slow.advance(0.1);
  drop = true;
  assert.throws(() => p.advance(0.1), /on every sample or on none/);
  drop = false;
  // A large platform turning slowly: its corners outrun maxSpeed although its pivot is still.
  const big = createPlatforms({maxSpeed: 10});
  big.add('wheel', {halfX: 50, halfZ: 50, path: t => ({x: 0, y: 0, z: 0, yaw: 0.2 * t})});
  assert.throws(() => big.advance(0.1), /at a footprint corner/, '0.2 rad/s · 70.7 m ≈ 14 m/s');
  // A declared cut accepts a yaw discontinuity once, with zero turn.
  yaw = 3;
  p.cut('disc');
  p.advance(0.1);
  assert.deepEqual(p.delta('disc'), {dx: 0, dy: 0, dz: 0, dyaw: 0});
  assert.equal(p.pose('disc')!.yaw, 3);
  p.restart();
  assert.deepEqual(p.delta('disc'), {dx: 0, dy: 0, dz: 0, dyaw: 0});
});

test('MV-02 turning: a rider on a spinning disc stays on its circle, turns with it and matches at 30, 60 and 120 Hz', async () => {
  const w = 1.5,
    r = 2,
    ry0 = 0.25;
  const path: PlatformDef['path'] = t => ({x: 0, y: 1, z: 0, yaw: w * t});
  const runs = await Promise.all(
    [30, 60, 120].map(hz => spin(hz, 2, {path, start: {x: r, y: 1, z: 0, ry: ry0}, bind: true})),
  );
  for (const [i, {out, disc}] of runs.entries()) {
    for (const s of out) {
      const [ex, ez] = rot(s.yaw, r, 0);
      assert.ok(Math.abs(Math.hypot(s.x, s.z) - r) < 1e-12, `radius kept at ${s.t}`);
      assert.ok(Math.abs(s.x - ex) < 1e-12 && Math.abs(s.z - ez) < 1e-12, `on the turned offset at ${s.t}`);
      assert.ok(Math.abs(s.ry - (ry0 + s.yaw)) < 1e-12, `facing turned by the same yaw at ${s.t}`);
      assert.equal(s.y, 1);
    }
    assert.equal(disc.ry, must(out[out.length - 1]).yaw, `bind publishes the yaw (${i})`);
  }
  for (const k of [1, 2, 3, 4, 5, 6]) {
    const [a, b, c] = runs.map(run => at(run.out, k / 3));
    assert.ok(
      Math.abs(a!.x - c!.x) < 1e-12 && Math.abs(b!.x - c!.x) < 1e-12 && Math.abs(a!.z - c!.z) < 1e-12,
      `aligned at ${k}/3 s`,
    );
  }
  // carryFacing false: position is carried, facing is left to its own owner.
  const still = await spin(60, 1, {path, start: {x: r, y: 1, z: 0, ry: ry0}, carryFacing: false});
  assert.ok(still.out.every(s => s.ry === ry0));
  assert.ok(Math.abs(must(still.out[still.out.length - 1]).x - rot(w, r, 0)[0]) < 1e-12);
});

test('MV-02 turning: 10,000 ticks on a disc whose yaw is wrapped into (−π, π] neither drift nor lose the rider', async () => {
  const w = 2,
    r = 2.5,
    hz = 60;
  const wrapped = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);
  const {out} = await spin(hz, 10_000 / hz, {
    path: t => ({x: 0, y: 1, z: 0, yaw: wrapped(w * t)}),
    start: {x: 0, y: 1, z: r},
  });
  assert.equal(out.length, 10_000);
  let worst = 0;
  for (const s of out) {
    const [ex, ez] = rot(w * s.t, 0, r);
    worst = Math.max(worst, Math.hypot(s.x - ex, s.z - ez), Math.abs(Math.hypot(s.x, s.z) - r));
    assert.equal(s.y, 1, `still riding at ${s.t}`);
  }
  assert.ok(worst < 1e-9, `drift after 10,000 ticks: ${worst} m`);
  const last = must(out[out.length - 1]);
  assert.ok(Math.abs(wrapYaw(last.ry - w * last.t)) < 1e-9, 'facing kept the accumulated turn');
});

test('MV-02 turning: a rider carried by translation and rotation together follows pivot + R(yaw)·offset', async () => {
  const path: PlatformDef['path'] = t => ({x: 3 * t, y: 1 + 0.5 * t, z: -t, yaw: -0.8 * t});
  for (const hz of [30, 60, 120]) {
    const {out} = await spin(hz, 2, {path, start: {x: 1, y: 1, z: 0.5}});
    for (const s of out) {
      const [ox, oz] = rot(s.yaw, 1, 0.5);
      assert.ok(
        Math.abs(s.x - (s.px + ox)) < 1e-12 && Math.abs(s.z - (s.pz + oz)) < 1e-12 && Math.abs(s.y - s.py) < 1e-12,
        `${hz} Hz at ${s.t}`,
      );
    }
  }
});

test('MV-02 turning: a rider stays on a turned bar where the axis-aligned box would have dropped it', async () => {
  // A 4 m × 0.4 m bar makes a quarter turn: the rider at the bar's end ends at (0, −1.8), far outside the unturned box.
  const {out} = await spin(60, 1, {
    path: t => ({x: 0, y: 1, z: 0, yaw: (Math.PI / 2) * Math.min(t, 1)}),
    halfX: 2,
    halfZ: 0.2,
    start: {x: 1.8, y: 1, z: 0},
  });
  const end = must(out[out.length - 1]);
  assert.ok(Math.abs(end.x) < 1e-12 && Math.abs(end.z + 1.8) < 1e-12 && end.y === 1, `${end.x}, ${end.z}`);
});

test('MV-02 turning: jumping off a spinning disc keeps the tangential velocity ω·r as the mean over the tick', async () => {
  const w = 3,
    r = 2;
  for (const hz of [30, 60, 120]) {
    const path: PlatformDef['path'] = t => ({x: 0, y: 0, z: 0, yaw: w * t});
    const {out} = await spin(hz, 0.8, {path, start: {x: r, y: 0, z: 0}, press: pressAt(0.5)});
    const k = out.findIndex(s => s.y > 1e-9),
      a = must(out[k + 1]),
      b = must(out[k + 2]),
      jumpTick = must(out[k]);
    const vx = (b.x - a.x) * hz,
      vz = (b.z - a.z) * hz,
      ideal = 2 * r * Math.sin(w / hz / 2) * hz;
    assert.ok(Math.abs(Math.hypot(vx, vz) - ideal) < 1e-9, `${hz} Hz chord speed ${Math.hypot(vx, vz)} vs ${ideal}`);
    assert.ok(
      Math.abs(ideal - w * r) <= (w * r * (w / hz) ** 2) / 24 + 1e-12,
      `${hz} Hz within the chord bound of ω·r`,
    );
    // Its direction is the chord of the jump tick's ride: perpendicular to the radius at the tick's mid-turn.
    const [tx, tz] = rot(jumpTick.yaw - w / hz / 2, 0, -1);
    assert.ok(Math.abs((vx * tx + vz * tz) / Math.hypot(vx, vz) - 1) < 1e-9, `${hz} Hz tangential direction`);
    assert.equal(b.ry, a.ry, 'airborne facing no longer turns with the disc');
  }
  const none = await spin(60, 0.8, {
    path: t => ({x: 0, y: 0, z: 0, yaw: w * t}),
    start: {x: r, y: 0, z: 0},
    press: pressAt(0.5),
    onLeave: 'none',
  });
  const k = none.out.findIndex(s => s.y > 1e-9);
  assert.ok(must(none.out[k + 1]).x === must(none.out[k + 3]).x, "'none' keeps no tangential motion");
});

test('MV-02 turning: a cut or a restart of a turning platform detaches the rider', async () => {
  for (const kind of ['cut', 'restart'] as const) {
    let jumped = false;
    const {out} = await spin(60, 1, {
      path: t => ({x: 0, y: jumped ? 0.5 : 1, z: 0, yaw: jumped ? 2 : 0.5 * t}),
      start: {x: 1, y: 1, z: 0},
      each: (t, p) => {
        if (!jumped && t >= 0.5 - 1e-9) {
          jumped = true;
          if (kind === 'cut') p.cut('deck');
          else p.restart();
        }
      },
    });
    const pinned = out.filter(s => s.t > 0.55);
    const first = must(pinned[0]);
    assert.ok(
      pinned.every(s => s.x === first.x && s.z === first.z && s.y < 1),
      `${kind}: the rider was neither swung nor teleported, and fell`,
    );
  }
});

test('MV-02 turning review M1: facing does not turn while a wall holds back the carry', async () => {
  // The disc turns the rider at (2, 0) towards −z; a wall at z = −0.35 (the body radius) blocks that motion.
  const w = 1,
    ry0 = 0.5;
  const {out} = await spin(60, 0.5, {
    path: t => ({x: 0, y: 1, z: 0, yaw: w * t}),
    start: {x: 2, y: 1, z: 0, ry: ry0},
    extra: [[Walls({minX: -100, maxX: 100, minZ: -0.35, maxZ: 100})]],
  });
  for (const s of out) {
    assert.equal(s.ry, ry0, `facing kept at ${s.t} while the carry is blocked`);
    assert.equal(s.z, 0, 'held at the wall');
  }
  // Without the wall the same rider turns.
  const free = await spin(60, 0.5, {path: t => ({x: 0, y: 1, z: 0, yaw: w * t}), start: {x: 2, y: 1, z: 0, ry: ry0}});
  assert.ok(Math.abs(must(free.out[free.out.length - 1]).ry - (ry0 + 0.5 * w)) < 1e-12);
});

test('MV-02 turning review L1: a facing owned elsewhere (even NaN) never forces a write on an unturned ride', async () => {
  const {out} = await spin(60, 0.5, {path: () => ({x: 0, y: 1, z: 0}), start: {x: 1, y: 1, z: 0, ry: NaN}});
  const first = must(out[0]).version;
  assert.ok(
    out.every(s => s.version === first && Number.isNaN(s.ry)),
    'a still rider with NaN facing is never re-published',
  );
});

test('MV-02 turning review L2-L4: single reads, actionable turn-rate errors and the wrapYaw domain', () => {
  let reads = 0;
  const p = createPlatforms();
  p.add('disc', {
    halfX: 1,
    halfZ: 1,
    path: () => ({
      x: 0,
      y: 0,
      z: 0,
      get yaw() {
        reads++;
        return reads === 1 ? 0 : NaN;
      },
    }),
  });
  assert.equal(reads, 1, 'yaw is read once per sample');
  assert.equal(p.pose('disc')!.yaw, 0);
  const fast = createPlatforms({maxTurnRate: 20});
  fast.add('disc', {halfX: 1, halfZ: 1, path: t => ({x: 0, y: 0, z: 0, yaw: t})});
  assert.throws(() => fast.advance(0.2), /lower maxTurnRate below 15\.708 rad\/s or use a shorter fixed step/);
  for (const a of [NaN, Infinity, -Infinity, 2e9]) assert.throws(() => wrapYaw(a), RangeError);
  assert.equal(wrapYaw(Math.PI), -Math.PI, 'the range is [−π, π)');
  assert.equal(wrapYaw(-Math.PI), -Math.PI);
});

test('MV-02 turning re-review: an unobstructed carry far from the origin with a small radius always turns facing', async () => {
  // Hundreds of sub-steps at large coordinates round differently from the one-shot carry; only a real deflection by
  // a wall or solid may stop the turn.
  const wrapped = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);
  for (const [X, radius, r] of [
    [1e5, 0.01, 20],
    [9e5, 0.02, 9],
  ] as const) {
    const {out} = await spin(60, 10, {
      path: t => ({x: X, y: 1, z: 0, yaw: wrapped(6 * t)}),
      halfX: r + 1,
      halfZ: r + 1,
      start: {x: X + r, y: 1, z: 0, ry: 0},
      radius,
      maxSpeed: 1000,
    });
    assert.equal(out.length, 600);
    for (const s of out) {
      assert.equal(s.y, 1, `X=${X}: still riding at ${s.t}`);
      assert.ok(Math.abs(wrapYaw(s.ry - 6 * s.t)) < 1e-9, `X=${X}: facing followed the deck at ${s.t}: ${s.ry}`);
    }
    const last = must(out[out.length - 1]);
    assert.ok(Math.abs(last.ry - 60) < 1e-9, `X=${X}: no tick skipped (${last.ry} rad of 60)`);
  }
});
