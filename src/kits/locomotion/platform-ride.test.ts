import test from 'node:test';
import assert from 'node:assert/strict';
import { defineScene, testScene, Name, Transform, type InputState, type SceneContext } from '../../author';
import { createSystemRunner } from '../../core/ecs/systems';
import { Walls } from '../character';
import { jumpSystem, platformSystem, type PlatformLeave } from './jump-system';
import { createPlatforms, type PlatformDef } from './platforms';

const RATES = [30, 60, 120, 144, 165, 240];
const ALIGNED = [30, 60, 120, 144, 240];   // 0.5 s and 1/6 s are whole ticks at these rates
const jump = { height: 1.5, timeToApex: 0.35, coyoteTime: 0, bufferTime: 0, releaseGravityScale: 1 };
const none = () => null;

interface Sample { t: number; x: number; y: number; z: number; px: number; py: number; pz: number }
/**
 * Run the real fixed-step runner at `hz` ticks per second (one tick per frame): the platform system, the jump adapter
 * and a probe. `press(t)` is true on the tick that starts at t; `held(t)` while the action is held.
 */
async function ride(hz: number, seconds: number, o: { path: PlatformDef['path']; halfX?: number; start?: { x: number; y: number; z: number };
  press?: (t: number, dt: number) => boolean; held?: (t: number) => boolean; onLeave?: PlatformLeave; ground?: (x: number, z: number, below: number) => number | null;
  walls?: boolean; each?: (t: number, tr: { x: number; y: number; z: number }, p: ReturnType<typeof createPlatforms>) => void }) {
  const entities: unknown[][] = [[Name({ name: 'player' }), Transform(o.start ?? o.path(0))]];
  if (o.walls) entities.push([Walls({ minX: -100, maxX: 1, minZ: -100, maxZ: 100 })]);
  const t = await testScene(defineScene({ id: 'ride', title: 'ride', entities: entities as never }), {});
  const tr = t.world.get(t.ctx.named('player')!, Transform)!;
  const platforms = createPlatforms();
  platforms.add('deck', { halfX: o.halfX ?? 1, halfZ: 1, path: o.path });
  let now = 0, frame = 0, pressed = false;
  const input: InputState = { describe: () => null, pressed: id => id === 'jump' && pressed, pressedAt: () => null, held: id => id === 'jump' && (o.held?.(now) ?? true), axis: () => 0, pointer: { x: 0, y: 0, down: false, pressed: false } };
  const ctx = Object.create(t.ctx, { input: { value: input }, time: { get: () => ({ t: now, frame, calm: false }) } }) as SceneContext;
  const out: Sample[] = [];
  const runner = createSystemRunner<SceneContext>([
    platformSystem(platforms),
    jumpSystem({ action: 'jump', config: jump, ground: o.ground ?? none, platforms, onLeave: o.onLeave }),
    { id: 'probe', run() { const p = platforms.pose('deck') ?? { x: NaN, y: NaN, z: NaN }; out.push({ t: platforms.time, x: tr.x, y: tr.y, z: tr.z, px: p.x, py: p.y, pz: p.z }); o.each?.(platforms.time, tr, platforms); } },
  ], { step: 1 / hz, maxSteps: 1 });
  const dt = 1 / hz, n = Math.round(seconds * hz);
  for (let i = 0; i < n; i++) { frame = i + 1; pressed = o.press?.(i * dt, dt) ?? false; now = i * dt; runner.frame(ctx, dt); }
  t.dispose();
  return out;
}
const at = (s: Sample[], time: number) => s[Math.round(time * s.length / s[s.length - 1].t) - 1];
const pressAt = (when: number) => (t: number, dt: number) => t <= when + 1e-9 && when < t + dt - 1e-9;

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
    assert.ok(mid.y > 1.4, `${hz} Hz airborne near apex: ${mid.y}`);
    assert.ok(Math.abs(mid.x - mid.px) < 1e-9, 'kept the platform velocity in the air (add-velocity)');
    const end = s[s.length - 1];
    assert.ok(Math.abs(end.y - end.py) < 1e-9 && Math.abs(end.x - end.px) < 1e-9, `${hz} Hz landed back on the platform`);
  }
  const still = await ride(60, 1, { path, press: pressAt(0.5), onLeave: 'none' });
  const after = at(still, 0.5 + 1 / 6);
  // The jump tick still rides that tick's displacement; afterwards nothing is kept.
  assert.ok(Math.abs(after.x - 3 * (0.5 + 1 / 60)) < 1e-9 && after.px > after.x + 0.4, `'none' keeps no horizontal velocity: ${after.x}`);
});

test('MV-02: a rising platform adds its upward velocity to the launch (add-velocity and add-upward), not with none', async () => {
  // The platform rises at 2 m/s through the jump tick (which starts at 0.5 s), then stops.
  const stop = 0.5 + 1 / 120, path: PlatformDef['path'] = t => ({ x: 0, y: 2 * Math.min(t, stop), z: 0 });
  const apex = async (onLeave: PlatformLeave) => {
    const s = await ride(120, 1.6, { path, halfX: 0.2, start: { x: 0, y: 0, z: 0 }, press: pressAt(0.5), onLeave });
    return Math.max(...s.map(p => p.y)) - 2 * stop;
  };
  const plain = await apex('none'), up = await apex('add-upward'), full = await apex('add-velocity');
  assert.ok(Math.abs(plain - 1.5) < 1e-9, `${plain}`);
  assert.ok(up > plain + 0.3 && Math.abs(up - full) < 1e-12, `${up} ${full}`);
});

test('MV-02: one-way moving platforms: a rising one picks up a standing actor; one moving sideways is passed from below and landed on', async () => {
  const floor = (_x: number, _z: number, below: number) => (below >= 0 ? 0 : null);
  for (const hz of RATES) {
    const s = await ride(hz, 1.5, { path: t => ({ x: 0, y: -0.5 + t, z: 0 }), start: { x: 0, y: 0, z: 0 }, ground: floor });
    const end = s[s.length - 1];
    assert.equal(at(s, 0.25).y, 0, `${hz} Hz still on the floor while the platform is below`);
    assert.ok(Math.abs(end.y - end.py) < 1e-12 && end.y > 0.9, `${hz} Hz carried up: ${end.y}`);
  }
  for (const hz of RATES) {
    const s = await ride(hz, 2, { path: t => ({ x: 0.3 * Math.sin(t), y: 1, z: 0 }), halfX: 2, start: { x: 0, y: 0, z: 0 }, ground: floor, press: pressAt(0.1) });
    assert.ok(Math.max(...s.map(p => p.y)) > 1.4, 'rose through the platform');
    const end = s[s.length - 1];
    assert.ok(Math.abs(end.y - 1) < 1e-12, `${hz} Hz landed on it: ${end.y}`);
    const later = s.filter(p => p.t > 1.6);
    const offset = later[0].x - later[0].px;
    for (const p of later) assert.ok(Math.abs(p.x - p.px - offset) < 1e-9, `${hz} Hz rides with it`);
  }
});

test('MV-02: leaving a footprint applies the leave policy; a removed platform drops its rider with nothing', async () => {
  // The rider is pushed off the edge at 0.5 s (another owner moves it); with add-velocity it keeps the platform's speed.
  const path: PlatformDef['path'] = t => ({ x: 2 * t, y: 5, z: 0 });
  const shove = (t: number, tr: { x: number }) => { if (Math.abs(t - 0.5) < 1e-9) tr.x += 1.5; };
  const kept = await ride(60, 1, { path, each: shove });
  const off = kept.filter(p => p.t > 0.55);
  assert.ok(off.every(p => p.y < 5), 'fell after leaving the footprint');
  assert.ok(Math.abs((off[off.length - 1].x - off[0].x) / (off[off.length - 1].t - off[0].t) - 2) < 1e-9, 'kept 2 m/s horizontally');
  const dropped = await ride(60, 1, { path, each: shove, onLeave: 'none' });
  const d = dropped.filter(p => p.t > 0.55);
  assert.equal(d[d.length - 1].x, d[0].x, "'none' keeps nothing");
  const removed = await ride(60, 1, { path, each: (t, _tr, p) => { if (Math.abs(t - 0.5) < 1e-9) p.remove('deck'); } });
  const r = removed.filter(p => p.t > 0.55);
  assert.equal(r[r.length - 1].x, r[0].x, 'a removed platform imparts no velocity');
  assert.ok(r[r.length - 1].y < 5);
});

test('MV-02: carried motion slides against walls instead of passing through them', async () => {
  const s = await ride(60, 1.5, { path: t => ({ x: 3 * t, y: 0, z: 0 }), halfX: 3, walls: true });
  for (const p of s) assert.ok(p.x <= 1 - 0.35 + 1e-9, `inside the wall at ${p.t}: ${p.x}`);
});
