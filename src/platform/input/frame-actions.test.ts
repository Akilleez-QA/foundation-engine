import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ActionLatch,
  clampNotches,
  HeldInput,
  heldVector,
  PINCH_NOTCHES_PER_EFOLD,
  Repeater,
  toDisc,
} from './frame-actions';

test('held sources are independent and repeats never arm a cleared source', () => {
  const held = new HeldInput();
  held.press('key:KeyW', 'up');
  held.press('key:ArrowUp', 'up');
  held.press('pointer:3', 'up');
  held.release('key:KeyW');
  assert.ok(held.has('up'));
  held.release('pointer:3');
  assert.ok(held.has('up'));
  held.release('key:ArrowUp');
  assert.equal(held.has('up'), false);
  held.press('key:KeyW', 'up');
  held.clear();
  assert.equal(held.press('key:KeyW', 'up', true), false);
  assert.equal(held.has('up'), false);
  held.release('key:KeyW');
  assert.equal(held.press('key:KeyW', 'up'), true);
  assert.ok(held.has('up'));
  held.press('pointer:9', 'left');
  held.releaseWhere(s => s.startsWith('key:'));
  assert.equal(held.has('up'), false);
  assert.ok(held.has('left'));
});
test('diagonals and aliases are normalised; opposite keys cancel', () => {
  const held = new HeldInput();
  held.press('a', 'up');
  held.press('b', 'right');
  const v = heldVector(held);
  assert.ok(Math.abs(Math.hypot(v.x, v.y) - 1) < 1e-9);
  held.press('c', 'up');
  assert.ok(Math.abs(Math.hypot(heldVector(held).x, heldVector(held).y) - 1) < 1e-9);
  held.clear();
  held.press('a', 'up');
  held.press('b', 'down');
  assert.deepEqual(heldVector(held), {x: 0, y: 0});
  assert.deepEqual(toDisc(3, 4), {x: 0.6, y: 0.8});
  assert.deepEqual(toDisc(0.3, 0.4), {x: 0.3, y: 0.4});
  assert.deepEqual(toDisc(NaN, 1), {x: 0, y: 0});
});
test('repeater: immediate press, then the delay, then the interval; a new key restarts it', () => {
  const r = new Repeater(400, 150);
  assert.deepEqual(r.update('in', 0), {first: true, repeats: 0});
  assert.equal(r.update('in', 399).repeats, 0);
  assert.equal(r.update('in', 400).repeats, 1);
  assert.equal(r.update('in', 549).repeats, 0);
  assert.equal(r.update('in', 550).repeats, 1);
  assert.equal(r.update('out', 560).first, true);
  assert.equal(r.update(null, 600).first, false);
  assert.equal(r.update('out', 610).first, true);
  assert.equal(r.update('out', 5000).repeats, 3, 'a stalled frame bursts at most three');
});
test('the latch keeps sub-frame presses, sorts zoom by time and empties on drain', () => {
  const latch = new ActionLatch();
  latch.action({action: 'interact', t: 1, device: 'touch'});
  latch.zoom({notches: 1, source: 'wheel', t: 5});
  latch.zoom({notches: -1, source: 'key', t: 2});
  latch.zoom({notches: 0, source: 'key', t: 3});
  latch.look(0.1, 0.2);
  latch.look(0.1, NaN);
  latch.moveStarted();
  const out = latch.drain();
  assert.equal(out.actions.length, 1);
  assert.deepEqual(
    out.zoom.map(z => z.t),
    [2, 5],
  );
  assert.ok(Math.abs(out.look.x - 0.2) < 1e-12);
  assert.equal(out.look.y, 0.2);
  assert.ok(out.moveStarted);
  const empty = latch.drain();
  assert.equal(empty.actions.length + empty.zoom.length + empty.taps.length, 0);
  assert.equal(empty.moveStarted, false);
});
test('notch clamp and pinch gain follow the zoom design', () => {
  assert.equal(clampNotches(9), 1.5);
  assert.equal(clampNotches(-9), -1.5);
  assert.equal(clampNotches(Infinity), 0);
  assert.ok(
    Math.abs(PINCH_NOTCHES_PER_EFOLD * Math.log(2) * 0.073 - 0.31) < 0.01,
    'doubling the finger spread is about .31 z',
  );
});
