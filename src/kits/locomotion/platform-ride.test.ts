import test from 'node:test';
import assert from 'node:assert/strict';
import { defineScene, testScene, Name, Transform, type InputState, type SceneContext } from '../../author';
import { createSystemRunner } from '../../core/ecs/systems';
import { Solid, Walls } from '../character';
import { jumpSystem, platformSystem, type PlatformLeave } from './jump-system';
import { createPlatforms, type PlatformDef, type Platforms } from './platforms';
import { deriveJump } from './jump';
import { must } from '../../testing/must';

/** The rates every regression runs at; 165 Hz is deliberately not a divisor of the aligned event times. */
const RATES = [30, 60, 120, 165, 240];
const ALIGNED = [30, 60, 120, 240];   // 0.5 s and 1/6 s are whole ticks at these rates
const jump = { height: 1.5, timeToApex: 0.35, coyoteTime: 0.1, bufferTime: 0, releaseGravityScale: 1, fallGravityScale: 1 };
const none = () => null;
const floor = (_x: number, _z: number, below: number) => (below >= 0 ? 0 : null);

interface Sample { t: number; x: number; y: number; z: number; px: number; py: number; pz: number }
interface RideOptions {
  path?: PlatformDef['path']; halfX?: number; start?: { x: number; y: number; z: number };
  setup?: (p: Platforms) => void;
  press?: (t: number, dt: number) => boolean; held?: (t: number) => boolean;
  onLeave?: PlatformLeave; ground?: (x: number, z: number, below: number) => number | null;
  order?: 'before' | 'after' | 'missing'; when?: (t: number) => boolean; radius?: number; stepHeight?: number;
  extra?: unknown[][]; maxSpeed?: number; freezeAt?: number;
  each?: (t: number, tr: { x: number; y: number; z: number }, p: Platforms) => void;
}
/**
 * Run the real fixed-step runner at `hz` ticks per second (one tick per frame): the platform system, the jump adapter
 * and a probe. `press(t, dt)` is true on the tick that starts at t; `held(t)` while the action is held.
 */
async function ride(hz: number, seconds: number, o: RideOptions) {
  const path = o.path ?? (() => ({ x: 0, y: 0, z: 0 }));
  const entities: unknown[][] = [[Name({ name: 'player' }), Transform(o.start ?? path(0))], ...(o.extra ?? [])];
  const t = await testScene(defineScene({ id: 'ride', title: 'ride', entities: entities as never }), {});
  const tr = t.world.get(t.ctx.named('player')!, Transform)!;
  const platforms = createPlatforms({ maxSpeed: o.maxSpeed });
  if (o.setup) o.setup(platforms); else platforms.add('deck', { halfX: o.halfX ?? 1, halfZ: 1, path });
  let now = 0, frame = 0, pressed = false;
  const input: InputState = { describe: () => null, pressed: id => id === 'jump' && pressed, pressedAt: () => null, held: id => id === 'jump' && (o.held?.(now) ?? true), axis: () => 0, pointer: { x: 0, y: 0, down: false, pressed: false } };
  const ctx = Object.create(t.ctx, { input: { value: input }, time: { get: () => ({ t: now, frame, calm: false }) } }) as SceneContext;
  const out: Sample[] = [];
  const adapter = jumpSystem({ action: 'jump', config: jump, ground: o.ground ?? none, platforms, onLeave: o.onLeave, radius: o.radius, stepHeight: o.stepHeight, when: o.when ? () => o.when!(now) : undefined });
  const advance = platformSystem(platforms);
  const mover = { ...advance, run: (c: SceneContext, step: number) => { if (now < (o.freezeAt ?? Infinity) - 1e-9) advance.run(c, step); } };
  const order = o.order ?? 'before';
  const systems = order === 'before' ? [mover, adapter] : order === 'after' ? [adapter, mover] : [adapter];
  const runner = createSystemRunner<SceneContext>([...systems,
    { id: 'probe', run() { const p = platforms.pose('deck') ?? { x: NaN, y: NaN, z: NaN }; out.push({ t: now + 1 / hz, x: tr.x, y: tr.y, z: tr.z, px: p.x, py: p.y, pz: p.z }); o.each?.(now + 1 / hz, tr, platforms); } },
  ], { step: 1 / hz, maxSteps: 1, report: (_id, error) => { errors.push(error); } });
  const errors: unknown[] = [], dt = 1 / hz, n = Math.round(seconds * hz);
  try {
    for (let i = 0; i < n; i++) {
      frame = i + 1; now = i * dt; pressed = o.press?.(now, dt) ?? false; runner.frame(ctx, dt);
      if (errors.length) throw errors[0];
    }
  } finally { t.dispose(); }
  return out;
}
const at = (s: Sample[], time: number) => s.reduce((a, b) => (Math.abs(b.t - time) < Math.abs(a.t - time) ? b : a));
/** A callback that fires once, at the end of the first tick ending at or after `when`. */
const once = (when: number, fn: (tr: { x: number; y: number; z: number }, p: Platforms) => void) => {
  let done = false;
  return (t: number, tr: { x: number; y: number; z: number }, p: Platforms) => { if (!done && t >= when - 1e-9) { done = true; fn(tr, p); } };
};
const pressAt = (when: number) => (t: number, dt: number) => t <= when + 1e-9 && when < t + dt - 1e-9;
/** Index of the first sample where the actor is above the deck (the jump tick). */
const takeOff = (s: Sample[]) => s.findIndex(p => p.y > p.py + 1e-9);

test('MV-02: a rider follows a moving platform exactly at 30–240 Hz, including a descent faster than gravity', async () => {
  const paths: PlatformDef['path'][] = [t => ({ x: 2 * Math.sin(t), y: 1 + 0.5 * Math.sin(2 * t), z: 0.3 * t }), t => ({ x: 0, y: 40 - 20 * t, z: 0 })];
  for (const path of paths) for (const hz of RATES) {
    const s = await ride(hz, 1.5, { path });
    for (const p of s) assert.ok(Math.abs(p.x - p.px) < 1e-9 && Math.abs(p.y - p.py) < 1e-9 && Math.abs(p.z - p.pz) < 1e-9, `${hz} Hz at ${p.t}`);
  }
});

test('MV-02: jumping off a moving platform inherits its velocity and the arc matches across tick rates', async () => {
  const path: PlatformDef['path'] = t => ({ x: 3 * t, y: 0, z: 0 });
  const reference = await ride(240, 2, { path, press: pressAt(0.5) });
  for (const hz of ALIGNED) {
    const s = await ride(hz, 2, { path, press: pressAt(0.5) });
    for (let k = 1; k <= 12; k++) {
      const a = at(s, k / 6), b = at(reference, k / 6);
      assert.ok(Math.abs(a.y - b.y) < 1e-9 && Math.abs(a.x - b.x) < 1e-9, `${hz} Hz at ${k}/6 s: ${a.x},${a.y} vs ${b.x},${b.y}`);
    }
    const mid = at(s, 0.5 + 0.35);
    assert.ok(mid.y > 1.4 && Math.abs(mid.x - mid.px) < 1e-9, `${hz} Hz kept the platform velocity in the air (add-velocity)`);
    const end = must(s[s.length - 1]);
    assert.ok(Math.abs(end.y - end.py) < 1e-9 && Math.abs(end.x - end.px) < 1e-9, `${hz} Hz landed back on the platform`);
  }
  const still = await ride(60, 1, { path, press: pressAt(0.5), onLeave: 'none' });
  const after = at(still, 0.5 + 1 / 6);
  assert.ok(Math.abs(after.x - 1.5) < 1e-9 && after.px > after.x + 0.4, `'none' keeps no horizontal motion from the jump tick on: ${after.x}`);
});

test('MV-02 review 1: a jump from a vertically or diagonally moving lift rises exactly (v0 + v)²/2g above its take-off top at every rate', async () => {
  const d = deriveJump(jump);
  for (const [vx, vy] of [[0, 2], [1.5, 2], [0, -1]] as const) {
    const ideal = (d.launchSpeed + vy) ** 2 / (2 * d.gravity);
    for (const hz of RATES) {
      const s = await ride(hz, 1.4, { path: t => ({ x: vx * t, y: 1 + vy * t, z: 0 }), halfX: 3, press: pressAt(0.5) });
      const k = takeOff(s), top = must(s[k - 1]).y;
      const apex = Math.max(...s.slice(k).filter(p => p.y > p.py + 1e-9).map(p => p.y));
      // The sampled maximum may miss the true apex inside a tick by at most g·dt²/8.
      assert.ok(apex <= top + ideal + 1e-9 && apex >= top + ideal - d.gravity / (8 * hz * hz) - 1e-9, `${hz} Hz lift (${vx}, ${vy}): ${apex - top} vs ${ideal}`);
      // Horizontal: the actor keeps exactly the lift's speed while airborne.
      for (const p of s.slice(k)) assert.ok(Math.abs(p.x - p.px) < 1e-9, `${hz} Hz horizontal at ${p.t}`);
    }
  }
});

test('MV-02: a rising platform adds its upward velocity to the launch (add-velocity and add-upward), not with none', async () => {
  // The platform rises at 2 m/s through the jump tick (which starts at 0.5 s, at height 1), then stops.
  const stop = 0.5 + 1 / 120, path: PlatformDef['path'] = t => ({ x: 0, y: 2 * Math.min(t, stop), z: 0 });
  const apex = async (onLeave: PlatformLeave) => {
    const s = await ride(120, 1.6, { path, halfX: 0.2, start: { x: 0, y: 0, z: 0 }, press: pressAt(0.5), onLeave });
    return Math.max(...s.map(p => p.y)) - 1;
  };
  const d = deriveJump(jump), plain = await apex('none'), up = await apex('add-upward'), full = await apex('add-velocity');
  assert.ok(Math.abs(plain - 1.5) < 1e-9, `${plain}`);
  assert.ok(Math.abs(up - (d.launchSpeed + 2) ** 2 / (2 * d.gravity)) < d.gravity / (8 * 120 * 120) + 1e-9 && Math.abs(up - full) < 1e-12, `${up} ${full}`);
});

test('MV-02: one-way moving platforms: a rising one picks up a standing actor; one moving sideways is passed from below and landed on', async () => {
  for (const hz of RATES) {
    const s = await ride(hz, 1.5, { path: t => ({ x: 0, y: -0.5 + t, z: 0 }), start: { x: 0, y: 0, z: 0 }, ground: floor });
    const end = must(s[s.length - 1]);
    assert.equal(at(s, 0.25).y, 0, `${hz} Hz still on the floor while the platform is below`);
    assert.ok(Math.abs(end.y - end.py) < 1e-12 && end.y > 0.9, `${hz} Hz carried up: ${end.y}`);
  }
  for (const hz of RATES) {
    const s = await ride(hz, 2, { path: t => ({ x: 0.3 * Math.sin(t), y: 1, z: 0 }), halfX: 2, start: { x: 0, y: 0, z: 0 }, ground: floor, press: pressAt(0.1) });
    assert.ok(Math.max(...s.map(p => p.y)) > 1.4, 'rose through the platform');
    assert.ok(Math.abs(must(s[s.length - 1]).y - 1) < 1e-12, `${hz} Hz landed on it`);
    const later = s.filter(p => p.t > 1.6), first = must(later[0]), offset = first.x - first.px;
    for (const p of later) assert.ok(Math.abs(p.x - p.px - offset) < 1e-9, `${hz} Hz rides with it`);
  }
});

test('MV-02: leaving a footprint applies the leave policy; a removed platform drops its rider with nothing', async () => {
  const path: PlatformDef['path'] = t => ({ x: 2 * t, y: 5, z: 0 });
  const shove = () => once(0.5, tr => { tr.x += 1.5; });
  for (const hz of RATES) {
    const kept = await ride(hz, 1, { path, each: shove() }), off = kept.filter(p => p.t > 0.55);
    assert.ok(off.every(p => p.y < 5), `${hz} Hz fell after leaving the footprint`);
    assert.ok(Math.abs((must(off[off.length - 1]).x - must(off[0]).x) / (must(off[off.length - 1]).t - must(off[0]).t) - 2) < 1e-6, `${hz} Hz kept 2 m/s horizontally`);
    const d = (await ride(hz, 1, { path, each: shove(), onLeave: 'none' })).filter(p => p.t > 0.55);
    assert.equal(must(d[d.length - 1]).x, must(d[0]).x, `${hz} Hz 'none' keeps nothing`);
    const r = (await ride(hz, 1, { path, each: once(0.5, (_tr, p) => { p.remove('deck'); }) })).filter(p => p.t > 0.55);
    assert.equal(must(r[r.length - 1]).x, must(r[0]).x, `${hz} Hz a removed platform imparts no velocity`);
    assert.ok(must(r[r.length - 1]).y < 5);
  }
});

test('MV-02 review 2: frozen, missing or late platform systems never replay a stale displacement', async () => {
  const path: PlatformDef['path'] = t => ({ x: 2 * t, y: 1, z: 0 });
  for (const hz of RATES) {
    const missing = await ride(hz, 1, { path, order: 'missing' });
    assert.ok(missing.every(p => p.x === 0 && p.y === 1), `${hz} Hz no advance, no drift`);
    // The platform system stops at 0.5 s: the rider stays exactly on the frozen platform.
    const stalled = await ride(hz, 1, { path, freezeAt: 0.5 });
    for (const p of stalled) assert.ok(Math.abs(p.x - p.px) < 1e-9 && p.y === 1, `${hz} Hz frozen at ${p.t}: ${p.x} vs ${p.px}`);
    const late = await ride(hz, 1, { path, order: 'after' });
    for (const p of late.slice(1)) assert.ok(Math.abs(p.x - (p.px - 2 / hz)) < 1e-9 && p.y === 1, `${hz} Hz ordered after: one tick behind, never drifting (${p.x} vs ${p.px})`);
  }
});

test('MV-02 review 3: a cut, a restart or a removal and re-add detaches the rider instead of teleporting it', async () => {
  for (const hz of RATES) for (const kind of ['cut', 'restart', 're-add'] as const) {
    let far = false;
    // The footprint still covers the rider after the jump; only its height changes discontinuously.
    const path: PlatformDef['path'] = t => ({ x: t, y: far ? 10 : 1, z: 0 });
    const s = await ride(hz, 1, {
      setup: p => p.add('deck', { halfX: 1, halfZ: 1, path }),
      each: once(0.5, (_tr, p) => {
        far = true;
        if (kind === 'cut') p.cut('deck'); else if (kind === 'restart') p.restart(); else { p.remove('deck'); p.add('deck', { halfX: 1, halfZ: 1, path }); }
      }),
    });
    const after = s.filter(p => p.t > 0.55);
    assert.ok(after.every(p => p.x < 1 && p.y < 1), `${hz} Hz ${kind}: rider stayed behind and fell (${must(after[after.length - 1]).x}, ${must(after[after.length - 1]).y})`);
  }
  // Another owner lifting the rider detaches it: it is not pulled back down onto the platform.
  for (const hz of RATES) {
    const s = await ride(hz, 1, { path: t => ({ x: t, y: 1, z: 0 }), each: once(0.5, tr => { tr.y += 0.5; }) });
    const k = s.findIndex(p => p.y > 1.4);
    assert.ok(k >= 0 && must(s[k + 1]).y > 1.2, `${hz} Hz lifted rider kept its height on the next tick: ${s[k + 1]?.y}`);
  }
});

test('MV-02 review 4: while `when` is false the rider stays on its moving platform and presses are ignored', async () => {
  for (const hz of RATES) {
    const s = await ride(hz, 1.5, { path: t => ({ x: t, y: 1 + 0.5 * Math.sin(3 * t), z: 0 }), when: t => t < 0.3 || t > 1, press: pressAt(0.6) });
    for (const p of s) assert.ok(Math.abs(p.x - p.px) < 1e-9 && Math.abs(p.y - p.py) < 1e-9, `${hz} Hz at ${p.t}`);
  }
});

test('MV-02 review 5: while riding, static ground and other platforms are swept too', async () => {
  for (const hz of RATES) {
    // A lift descending through the floor leaves its rider on the floor.
    const down = await ride(hz, 1.5, { path: t => ({ x: 0, y: 0.5 - t, z: 0 }), ground: floor, start: { x: 0, y: 0.5, z: 0 } });
    assert.ok(down.filter(p => p.t > 0.6).every(p => p.y === 0), `${hz} Hz stayed on the floor`);
    // Carried into a step no higher than stepHeight: the rider steps up onto it and stays.
    const block = (x: number, _z: number, below: number) => (x > 1 && below >= 0.2 ? 0.2 : below >= 0 ? 0 : null);
    const step = await ride(hz, 2, { path: t => ({ x: t, y: 0, z: 0 }), halfX: 0.5, ground: block, stepHeight: 0.25 });
    const end = must(step[step.length - 1]);
    assert.ok(end.y === 0.2 && end.x > 1 && end.x < 1.1, `${hz} Hz stepped onto the block: (${end.x}, ${end.y})`);
    // A second platform rising past the rider picks it up.
    const pick = await ride(hz, 1.5, { setup: p => { p.add('deck', { halfX: 1, halfZ: 1, path: () => ({ x: 0, y: 1, z: 0 }) }); p.add('elevator', { halfX: 1, halfZ: 1, path: t => ({ x: 0, y: 0.5 + t, z: 0 }) }); }, start: { x: 0, y: 1, z: 0 } });
    const last = must(pick[pick.length - 1]);
    assert.ok(Math.abs(last.y - (0.5 + last.t)) < 1e-9 && last.y > 1.9, `${hz} Hz carried up by the overtaking platform: ${last.y}`);
  }
});

test('MV-02 review 6: moving off a rising lift keeps the coyote window', async () => {
  for (const hz of RATES) {
    const s = await ride(hz, 1.2, { path: t => ({ x: 0, y: 1 + 2 * t, z: 0 }), each: once(0.5, tr => { tr.x = 5; }), press: pressAt(0.55) });
    const d = deriveJump(jump), apex = Math.max(...s.map(p => p.y)), leftAt = s.find(p => p.x === 5)!;
    assert.ok(apex > leftAt.y + d.launchSpeed ** 2 / (2 * d.gravity) * 0.6, `${hz} Hz coyote jump after the lift: ${apex} from ${leftAt.y}`);
  }
});

test('MV-02 review 7/8: limits are enforced before anything moves', async () => {
  // A 1000 m/s lift (the largest accepted speed) yields a boost at the limit rather than a refused step.
  const s = await ride(60, 0.2, { path: t => ({ x: 0, y: 1000 * t, z: 0 }), maxSpeed: 1000, press: pressAt(0.1) });
  assert.ok(s.every(p => Number.isFinite(p.y)));
  // Carried motion that would need more than 1,024 sub-steps is refused with the actor untouched.
  await assert.rejects(ride(60, 0.1, { path: t => ({ x: 100 * t, y: 0, z: 0 }), radius: 0.001 }), /512 radii/);
  // A thin solid in the path of fast carried motion still stops it.
  for (const hz of RATES) {
    const thin = await ride(hz, 1, { path: t => ({ x: 60 * t, y: 0, z: 0 }), halfX: 100, extra: [[Transform({ x: 2 }), Solid({ halfX: 0.01, halfZ: 5 })]] });
    assert.ok(thin.every(p => p.x <= 2 - 0.01 - 0.35 + 1e-9), `${hz} Hz passed through the thin solid`);
  }
});

test('MV-02 review 7: a refused ground answer on a riding tick leaves the actor where it was', async () => {
  for (const hz of RATES) {
    const seen: { x: number; y: number }[] = [];
    let bad = false;
    await assert.rejects(ride(hz, 1, {
      path: t => ({ x: t, y: 1, z: 0 }), ground: (_x, _z, below) => (bad ? below + 1 : null),
      each: (t, tr) => { seen.push({ x: tr.x, y: tr.y }); if (t >= 0.5 - 1e-9) bad = true; },
    }), /at or below/);
    const [before, failed] = seen.slice(-2);
    assert.deepEqual(failed, before, `${hz} Hz the failing tick published nothing`);
  }
});

test('MV-02: carried motion slides against walls instead of passing through them', async () => {
  for (const hz of RATES) {
    const s = await ride(hz, 1.5, { path: t => ({ x: 3 * t, y: 0, z: 0 }), halfX: 3, extra: [[Walls({ minX: -100, maxX: 1, minZ: -100, maxZ: 100 })]] });
    for (const p of s) assert.ok(p.x <= 1 - 0.35 + 1e-9, `${hz} Hz inside the wall at ${p.t}: ${p.x}`);
  }
});

test('MV-02 re-verification: a tick whose ground query throws once is rolled back like a skipped tick', async () => {
  /**
   * Run `n` ticks; on tick `k` either the adapter is skipped, or its ground query throws on its `call`-th use that tick
   * (1: before the controller steps; 2: the landing sweep after it stepped and after ride state was written).
   */
  async function run(hz: number, n: number, k: number, mode: 'throw' | 'skip', lift: 'none' | 'diagonal' | 'flat', call = 2) {
    const t = await testScene(defineScene({ id: 'tx', title: 'tx', entities: [[Name({ name: 'player' }), Transform(lift !== 'none' ? { x: 0, y: 1, z: 0 } : { x: 0, y: 5, z: 0 })]] }), {});
    const tr = t.world.get(t.ctx.named('player')!, Transform)!;
    const platforms = createPlatforms();
    if (lift !== 'none') platforms.add('deck', { halfX: 2, halfZ: 2, path: s => ({ x: 0.5 * s, y: lift === 'flat' ? 1 : 1 + s, z: 0 }) });
    let tick = 0, calls = 0;
    const input: InputState = { describe: () => null, pressed: () => false, pressedAt: () => null, held: () => false, axis: () => 0, pointer: { x: 0, y: 0, down: false, pressed: false } };
    const ctx = Object.create(t.ctx, { input: { value: input } }) as SceneContext;
    const ground = (x: number, z: number, below: number) => { if (mode === 'throw' && tick === k && ++calls === call) throw new Error('ground offline'); return floor(x, z, below); };
    const adapter = jumpSystem({ action: 'jump', config: jump, ground, platforms }), advance = platformSystem(platforms), dt = 1 / hz;
    const out: { x: number; y: number; z: number }[] = [];
    try {
      for (tick = 0; tick < n; tick++) {
        advance.run(ctx, dt);
        if (tick === k && mode === 'skip') { out.push({ x: tr.x, y: tr.y, z: tr.z }); continue; }
        if (tick === k) assert.throws(() => adapter.run(ctx, dt), /ground offline/);
        else adapter.run(ctx, dt);
        out.push({ x: tr.x, y: tr.y, z: tr.z });
      }
    } finally { t.dispose(); }
    return out;
  }
  for (const hz of [30, 60]) {
    for (const [lift, k] of [['none', Math.round(0.3 * hz)], ['flat', 0], ['diagonal', 0], ['diagonal', Math.round(0.2 * hz)]] as const) {
      const skipped = await run(hz, hz, k, 'skip', lift);
      for (const call of [1, 2]) {
        const thrown = await run(hz, hz, k, 'throw', lift, call);
        assert.deepEqual(thrown, skipped, `${hz} Hz ${lift === 'none' ? 'mid-fall' : `${lift} lift`}, query ${call} of tick ${k} threw: the failed tick must equal a skipped tick`);
      }
    }
  }
});
