import test from 'node:test';
import assert from 'node:assert/strict';
import { defineEntity, defineInput, defineScene, testScene, Name, Transform, type SceneContext, type InputState } from '../../author';
import { actionRows } from '../../author/compile';
import { createSystemRunner } from '../../core/ecs/systems';
import { createPressLatch } from '../../author/press-latch';
import { InputActions, inputActionRegistry, type KeyEventLike } from '../../platform/input/actions';
import { jumpSystem, jumpStateCount, resetJump } from './jump-system';

const config = { height: 2, timeToApex: 0.4, coyoteTime: 0.1, bufferTime: 0.1 };
/** Floor at 0 everywhere; a one-way ledge at 1.5 for 2 <= x <= 4. */
const ground = (x: number, _z: number, below: number) => (x >= 2 && x <= 4 && below >= 1.5 ? 1.5 : below >= 0 ? 0 : null);
const scene = (x = 0, y = 0) => defineScene({ id: 'jump', title: 'jump', entities: [[Name({ name: 'player' }), Transform({ x, y })]] });

test('MV-01: the adapter jumps from an action press, holds for full height and lands on the floor', async () => {
  const t = await testScene(scene(), { systems: [jumpSystem({ action: 'jump', config, ground })] });
  const tr = t.world.get(t.ctx.named('player')!, Transform)!;
  t.press('jump'); t.hold('jump');
  let apex = 0;
  for (let i = 0; i < 120; i++) { t.run(1 / 60); apex = Math.max(apex, tr.y); }
  assert.ok(Math.abs(apex - 2) < 0.01, `apex ${apex}`);
  assert.equal(tr.y, 0, 'landed exactly on the floor');
  t.dispose();
});

test('MV-01: surfaces above the feet are one-way; a falling actor lands on them at any speed', async () => {
  const t = await testScene(scene(3, 0), { systems: [jumpSystem({ action: 'jump', config: { ...config, maxFallSpeed: 900 }, ground })] });
  const tr = t.world.get(t.ctx.named('player')!, Transform)!;
  t.press('jump'); t.hold('jump'); t.run(2);
  assert.equal(tr.y, 1.5, 'rose through the ledge from below, then landed on it');
  // A very fast fall from high above (one tick spans far more than the ledge thickness) still lands.
  tr.y = 100; resetJump(t.world); t.release('jump'); t.run(3);   // ~1.5 m per tick at touchdown
  assert.equal(tr.y, 1.5);
  t.dispose();
});

test('MV-01: a one-way surface passed by an apex that falls inside a tick still catches the descent', async () => {
  // Find where the tick-sampled arc tops out below the true apex, and put a surface between the two.
  const cfg = { height: 2, timeToApex: 0.4083, coyoteTime: 0, bufferTime: 0 };
  const probe = await testScene(scene(0, 0), { systems: [jumpSystem({ action: 'jump', config: cfg, ground: (_x, _z, below) => (below >= 0 ? 0 : null) })] });
  const pr = probe.world.get(probe.ctx.named('player')!, Transform)!;
  probe.press('jump'); probe.hold('jump');
  let sampled = 0; for (let i = 0; i < 60; i++) { probe.run(1 / 60); sampled = Math.max(sampled, pr.y); }
  probe.dispose();
  assert.ok(2 - sampled > 1e-4, `the apex lies inside a tick (${2 - sampled} m above the last sample)`);
  const ledge = (sampled + 2) / 2, ground = (_x: number, _z: number, below: number) => (below >= ledge ? ledge : below >= 0 ? 0 : null);
  const t = await testScene(scene(0, 0), { systems: [jumpSystem({ action: 'jump', config: cfg, ground })] });
  const tr = t.world.get(t.ctx.named('player')!, Transform)!;
  t.press('jump'); t.hold('jump'); t.run(2);
  assert.equal(tr.y, ledge);
  t.dispose();
});

test('MV-01: the adapter keeps state only for its current target', async () => {
  const t = await testScene(scene(0, 0), { systems: [jumpSystem({ action: 'jump', config, ground })] });
  const first = t.ctx.named('player')!;
  t.press('jump'); t.hold('jump'); t.run(0.1);
  assert.equal(jumpStateCount(t.world), 1);
  t.world.despawn(first);
  t.run(1 / 60);
  assert.equal(jumpStateCount(t.world), 0, 'a despawned target leaves no state behind');
  const second = t.ctx.spawn(defineEntity({ id: 'again', components: [Name({ name: 'player' }), Transform({ x: 0, y: 0 })] }));
  t.release('jump'); t.run(0.5);
  assert.equal(t.world.get(second, Transform)!.y, 0, 'a new actor starts from rest, not with the old one\'s velocity');
  t.dispose();
});

test('MV-01: walking off a ledge allows a coyote jump; step and snap keep a supported actor attached', async () => {
  let x = 3;
  const steps = (cx: number, _z: number, below: number) => { const h = cx < 5 ? 1 : 0.95; return below >= h ? h : below >= 0 ? 0 : null; };
  const t = await testScene(scene(3, 1), { systems: [jumpSystem({ action: 'jump', config, ground: steps, snapDistance: 0.1, stepHeight: 0.2 })] });
  const tr = t.world.get(t.ctx.named('player')!, Transform)!;
  t.run(0.1); assert.equal(tr.y, 1);
  x = 5.5; tr.x = x; t.run(1 / 60); assert.equal(tr.y, 0.95, 'snapped down a small drop');
  tr.x = 4; t.run(1 / 60); assert.equal(tr.y, 1, 'stepped up a small rise');
  const ledge = (cx: number, _z: number, below: number) => (cx < 5 && below >= 1 ? 1 : below >= 0 ? 0 : null);
  const u = await testScene(scene(4, 1), { systems: [jumpSystem({ action: 'jump', config, ground: ledge })] });
  const ur = u.world.get(u.ctx.named('player')!, Transform)!;
  u.run(0.1); ur.x = 6; u.run(3 / 60);
  assert.ok(ur.y < 1, 'falling after the ledge');
  u.press('jump'); u.hold('jump'); u.run(1 / 60);
  let apex = 0; for (let i = 0; i < 60; i++) { u.run(1 / 60); apex = Math.max(apex, ur.y); }
  assert.ok(apex > 2.5, `coyote jump rose from near the ledge: ${apex}`);
  t.dispose(); u.dispose();
});

test('MV-01: invalid ground answers fail the tick; invalid options fail at definition', async () => {
  assert.throws(() => jumpSystem({ action: 'jump', config: { height: -1, timeToApex: 1 }, ground }), RangeError);
  assert.throws(() => jumpSystem({ action: 'jump', config, ground, snapDistance: -1 }), RangeError);
  assert.throws(() => jumpSystem({ action: '', config, ground }), RangeError);
  const t = await testScene(scene(), { systems: [jumpSystem({ action: 'jump', config, ground: (_x, _z, below) => below + 1 })] });
  assert.throws(() => t.run(1 / 60), /at or below/);
  t.dispose();
});

/**
 * The real fixed-step runner (60 Hz ticks) at display rates from 30 to 240 Hz, with the stock runtime's press latch:
 * each press reaches exactly one fixed tick, including through frames that run no tick (displays above 60 Hz). One
 * press must jump once, and the fixed-step trajectory must not depend on the display rate.
 */
test('MV-01: one press jumps once and the trajectory is identical at display rates 30–240 Hz', async () => {
  const PRESS = 0.5, RELEASE = 0.5 + 1 / 3;   // both on a frame boundary at 30, 60, 120, 144 and 240 Hz
  const trace = async (hz: number) => {
    const t = await testScene(scene(), {});
    const tr = t.world.get(t.ctx.named('player')!, Transform)!;
    const latch = createPressLatch();
    let held = false, frame = 0, now = 0;
    const input: InputState = { describe: () => null, pressed: id => latch.has(id), held: id => id === 'jump' && held, axis: () => 0, pointer: { x: 0, y: 0, down: false, pressed: false } };
    const ctx = Object.create(t.ctx, { input: { value: input }, time: { get: () => ({ t: now, frame, calm: false }) } }) as SceneContext;
    const ys: number[] = [];
    const runner = createSystemRunner<SceneContext>([jumpSystem({ action: 'jump', config, ground }), { id: 'probe', run() { ys.push(tr.y); } }],
      { step: 1 / 60, maxSteps: 8, beforeStep: () => latch.beginStep(), beforeFrameLane: () => latch.beginFrameLane() });
    // Frame i delivers what happened during (previous, now]; events land exactly on frame boundaries here.
    for (let i = 1; now < 2.5; i++) {
      const previous = now; now = i / hz; frame = i;
      if (previous < PRESS - 1e-9 && now >= PRESS - 1e-9) latch.add('jump');
      held = now >= PRESS - 1e-9 && now < RELEASE - 1e-9;
      runner.frame(ctx, now - previous); latch.endFrame();
    }
    t.dispose();
    const takeOff = ys.findIndex(y => y > 0), rises = ys.filter((y, i) => i > 0 && y > 0 && ys[i - 1] === 0).length;
    return { ys: ys.slice(takeOff), takeOff, rises, apex: Math.max(...ys), air: ys.slice(takeOff).findIndex(y => y === 0) };
  };
  const reference = await trace(60);
  assert.equal(reference.rises, 1);
  assert.ok(reference.apex > 1 && reference.apex < 2, `released early: ${reference.apex}`);
  for (const hz of [30, 120, 144, 165, 240]) {
    const run = await trace(hz);
    assert.equal(run.rises, 1, `${hz} Hz: one press, one jump`);
    if (hz === 30 || hz === 165) {
      // Input quantised to frames that straddle ticks: take-off and release may shift by one tick, nothing more.
      assert.ok(Math.abs(run.takeOff - reference.takeOff) <= 1, `${hz} Hz take-off tick`);
      assert.ok(Math.abs(run.apex - reference.apex) < config.height / 0.4 * 2 / 60, `${hz} Hz apex ${run.apex} vs ${reference.apex}`);
      assert.ok(Math.abs(run.air - reference.air) <= 2, `${hz} Hz airtime ${run.air} vs ${reference.air}`);
    } else {
      assert.equal(run.takeOff, reference.takeOff, `${hz} Hz take-off tick`);
      assert.deepEqual(run.ys, reference.ys, `${hz} Hz fixed-step samples`);
    }
  }
});

test('MV-01: presses on adjacent ticks are two presses; the adapter adds no filter of its own', async () => {
  const t = await testScene(scene(), {});
  const tr = t.world.get(t.ctx.named('player')!, Transform)!;
  let pressed = false, frame = 0, rises = 0, last = 0;
  const input: InputState = { describe: () => null, pressed: id => id === 'jump' && pressed, held: () => false, axis: () => 0, pointer: { x: 0, y: 0, down: false, pressed: false } };
  const ctx = Object.create(t.ctx, { input: { value: input }, time: { get: () => ({ t: frame / 60, frame, calm: false }) } }) as SceneContext;
  const short = { height: 0.1, timeToApex: 0.1, bufferTime: 1, releaseGravityScale: 1 };
  const runner = createSystemRunner<SceneContext>([jumpSystem({ action: 'jump', config: short, ground }), { id: 'probe', run() { if (last === 0 && tr.y > 0) rises++; last = tr.y; } }], { step: 1 / 60 });
  // The second press arrives while airborne and is buffered (1 s) until the landing: two presses, two jumps.
  for (frame = 1; frame <= 120; frame++) { pressed = frame === 2 || frame === 3; runner.frame(ctx, 1 / 60); }
  assert.equal(rises, 2);
  t.dispose();
});

test('MV-01: hold buttons report held through the real action layer; plain buttons stay press-only', () => {
  const jump = defineInput({ id: 'jump', label: 'Jump', keys: ['Space'], pad: ['a'], hold: true });
  const plain = defineInput({ id: 'use', label: 'Use', keys: ['e'], pad: ['x'] });
  assert.equal(actionRows(jump)[0].kind, 'hold'); assert.equal(actionRows(plain)[0].kind, 'press');
  assert.throws(() => defineInput({ id: 'bad', label: 'Bad', keys: ['b'], pad: ['b'], hold: 'yes' as unknown as boolean }));
  const layers = { fromTop: () => [], escape: () => false, cycleFocus: () => false, onChange: () => () => {} };
  const actions = new InputActions({ registry: inputActionRegistry([...actionRows(jump), ...actionRows(plain)]), layers, now: () => 0 });
  const phases: string[] = [];
  actions.onAction(actionRows(jump)[0].id, e => { phases.push(e.phase); return true; });
  actions.onAction(actionRows(plain)[0].id, () => true);
  const key = (k: string, code: string, repeat = false): KeyEventLike => ({ key: k, code, repeat, target: null, preventDefault() {}, stopPropagation() {} });
  actions.keyDown(key(' ', 'Space')); actions.keyDown(key(' ', 'Space', true));
  assert.equal(actions.held(actionRows(jump)[0].id), true);
  actions.keyDown(key('e', 'KeyE')); assert.equal(actions.held(actionRows(plain)[0].id), false);
  actions.keyUp(key(' ', 'Space'));
  assert.equal(actions.held(actionRows(jump)[0].id), false);
  assert.deepEqual(phases, ['press', 'release'], 'one press edge, no repeat presses, one release');
  actions.keyDown(key(' ', 'Space')); actions.cancel('overlay');
  assert.equal(actions.held(actionRows(jump)[0].id), false, 'cancellation releases a held button');
});
