import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wheelPixels,
  wheelZoomFactor,
  trackpadZoomFactor,
  gestureZoomFactor,
  installWheelZoom,
  PINCH_GAIN,
} from './wheel-zoom';
import {must} from '../../testing/must';
const close = (a: number, b: number, e = 1e-12) => assert.ok(Math.abs(a - b) < e, `${a} ≠ ${b}`);
const wheel = (init: {deltaY: number; deltaMode?: number; ctrlKey?: boolean}) =>
  Object.assign(new Event('wheel', {cancelable: true}), {deltaMode: 0, ctrlKey: false, ...init});
const keyEvent = (type: string, ctrlKey: boolean) => Object.assign(new Event(type), {ctrlKey});
function rig() {
  const el = new EventTarget(),
    win = new EventTarget(),
    doc = Object.assign(new EventTarget(), {hidden: false}),
    abort = new AbortController(),
    zooms: number[] = [];
  let enabled = true;
  const handle = installWheelZoom(el, f => zooms.push(f), {
    signal: abort.signal,
    window: win,
    document: doc,
    enabled: () => enabled,
  });
  return {
    el,
    win,
    doc,
    abort,
    zooms,
    handle,
    disable() {
      enabled = false;
    },
  };
}
test('line-mode wheel matches the equivalent pixel wheel', () => {
  close(wheelZoomFactor({deltaY: 3, deltaMode: 1}), wheelZoomFactor({deltaY: 48, deltaMode: 0}));
  close(trackpadZoomFactor(3, 1), trackpadZoomFactor(48));
});
test('zooming in then out by the same wheel returns to the start', () => {
  for (const [d, m] of [
    [40, 0],
    [3, 1],
    [1, 2],
    [500, 0],
  ] as const)
    close(wheelZoomFactor({deltaY: d, deltaMode: m}) * wheelZoomFactor({deltaY: -d, deltaMode: m}), 1);
});
test('every event is clamped: page mode, momentum bursts and fast pinches stay under 16%', () => {
  for (const e of [
    {deltaY: 1, deltaMode: 2},
    {deltaY: 100000, deltaMode: 0},
    {deltaY: -900, deltaMode: 1},
  ]) {
    const f = wheelZoomFactor(e);
    assert.ok(f < 1.16 && f > 1 / 1.16, String(f));
  }
  assert.equal(Math.abs(wheelPixels({deltaY: 1e6, deltaMode: 0}, true)), 70);
});
test('a normal mouse notch keeps its previous orbit-map feel', () => {
  close(trackpadZoomFactor(50), Math.exp(50 * 0.002));
  assert.ok(trackpadZoomFactor(1) > 1 && trackpadZoomFactor(1) < 1.01);
});
test('pinch gets gain only as a ctrlKey wheel without a physical Control key', () => {
  const r = rig();
  r.el.dispatchEvent(wheel({deltaY: 2, ctrlKey: true}));
  close(must(r.zooms[0]), Math.exp(2 * PINCH_GAIN * 0.002));
  r.win.dispatchEvent(keyEvent('keydown', true));
  assert.equal(r.handle.physicalControl, true);
  r.el.dispatchEvent(wheel({deltaY: 2, ctrlKey: true}));
  close(must(r.zooms[1]), Math.exp(2 * 0.002));
  r.win.dispatchEvent(new Event('blur'));
  assert.equal(r.handle.physicalControl, false);
  r.el.dispatchEvent(wheel({deltaY: 2, ctrlKey: true}));
  close(must(r.zooms[2]), must(r.zooms[0]));
  r.win.dispatchEvent(keyEvent('keydown', true));
  r.win.dispatchEvent(keyEvent('keyup', false));
  assert.equal(r.handle.physicalControl, false);
});
test('wheel is prevented while enabled and passes through untouched while disabled', () => {
  const r = rig();
  const e = wheel({deltaY: 10});
  r.el.dispatchEvent(e);
  assert.equal(e.defaultPrevented, true);
  r.disable();
  const f = wheel({deltaY: 10});
  r.el.dispatchEvent(f);
  assert.equal(f.defaultPrevented, false);
  assert.equal(r.zooms.length, 1);
});
const gesture = (type: string, scale?: number) =>
  Object.assign(new Event(type, {cancelable: true}), scale === undefined ? {} : {scale});
test('Safari gestures zoom by the per-event scale ratio and always block page zoom', () => {
  const r = rig();
  const start = gesture('gesturestart');
  r.el.dispatchEvent(start);
  assert.equal(start.defaultPrevented, true);
  r.el.dispatchEvent(gesture('gesturechange', 1.1));
  r.el.dispatchEvent(gesture('gesturechange', 1.21));
  close(must(r.zooms[0]), 1 / 1.1);
  close(must(r.zooms[1]), 1 / 1.1);
  r.el.dispatchEvent(gesture('gestureend'));
  assert.equal(gestureZoomFactor(0), 1);
  assert.ok(gestureZoomFactor(10) > 1 / 1.16);
});
test('a pinch Safari also reports as ctrl-wheels zooms once', () => {
  const r = rig();
  r.el.dispatchEvent(gesture('gesturestart'));
  r.el.dispatchEvent(wheel({deltaY: -3, ctrlKey: true}));
  const change = gesture('gesturechange', 1.2);
  r.el.dispatchEvent(change);
  assert.equal(change.defaultPrevented, true);
  assert.equal(r.zooms.length, 1);
  r.el.dispatchEvent(gesture('gestureend'));
  r.el.dispatchEvent(gesture('gesturestart'));
  r.el.dispatchEvent(gesture('gesturechange', 1.2));
  assert.equal(r.zooms.length, 1, 'a wheel just before gesturestart also claims the gesture');
});
test('touch pinches leave gesture events to the pointer handlers', () => {
  const r = rig();
  r.el.dispatchEvent(Object.assign(new Event('pointerdown'), {pointerType: 'touch', pointerId: 4}));
  r.el.dispatchEvent(gesture('gesturestart'));
  r.el.dispatchEvent(gesture('gesturechange', 1.5));
  assert.equal(r.zooms.length, 0);
  r.el.dispatchEvent(Object.assign(new Event('lostpointercapture'), {pointerId: 4}));
  r.el.dispatchEvent(gesture('gesturechange', 1.8));
  assert.equal(r.zooms.length, 1);
});
test('aborting removes every listener', () => {
  const r = rig();
  r.abort.abort();
  r.el.dispatchEvent(wheel({deltaY: 10}));
  r.win.dispatchEvent(keyEvent('keydown', true));
  assert.equal(r.zooms.length, 0);
  assert.equal(r.handle.physicalControl, false);
});
