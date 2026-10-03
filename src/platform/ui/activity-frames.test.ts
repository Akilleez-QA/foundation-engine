import test from 'node:test';
import assert from 'node:assert/strict';
import {ActivityFrames} from './activity-frames';
test('activity suspends its frame owner while hidden and resumes without a time jump', () => {
  const pending = new Map<number, FrameRequestCallback>();
  let serial = 0,
    suspensions = 0;
  const deltas: number[] = [];
  const loop = new ActivityFrames(
    dt => deltas.push(dt),
    () => suspensions++,
    cb => {
      pending.set(++serial, cb);
      return serial;
    },
    id => {
      pending.delete(id);
    },
  );
  const advance = (t: number) => {
    const work = [...pending.values()];
    pending.clear();
    work.forEach(cb => cb(t));
  };
  loop.start();
  loop.start();
  assert.equal(pending.size, 1);
  advance(10);
  advance(30);
  assert.deepEqual(deltas, [0, 0.02]);
  loop.setVisible(false);
  assert.equal(pending.size, 0);
  assert.equal(suspensions, 1);
  advance(20000);
  assert.equal(deltas.length, 2);
  loop.setVisible(true);
  advance(30000);
  assert.equal(deltas.at(-1), 0);
  advance(40000);
  assert.equal(deltas.at(-1), 0.05);
  loop.stop();
  assert.equal(pending.size, 0);
  loop.setVisible(false);
  loop.setVisible(true);
  assert.equal(pending.size, 0);
});
test('an activity closed from inside its frame never schedules another frame', () => {
  let callback: FrameRequestCallback = () => {};
  let requests = 0;
  const loop = new ActivityFrames(
    () => loop.stop(),
    () => {},
    cb => {
      callback = cb;
      return ++requests;
    },
    () => {},
  );
  loop.start();
  callback(0);
  assert.equal(requests, 1);
});
test('every app activity runs through the one frame loop: one frame request serves them all', () => {
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: FrameRequestCallback) => number;
    cancelAnimationFrame?: (id: number) => void;
  };
  const saved = {request: g.requestAnimationFrame, cancel: g.cancelAnimationFrame};
  const pending = new Map<number, FrameRequestCallback>();
  let serial = 0;
  g.requestAnimationFrame = cb => {
    pending.set(++serial, cb);
    return serial;
  };
  g.cancelAnimationFrame = id => {
    pending.delete(id);
  };
  try {
    const a: number[] = [],
      b: number[] = [];
    const first = new ActivityFrames(
        dt => a.push(dt),
        () => {},
      ),
      second = new ActivityFrames(
        dt => b.push(dt),
        () => {},
      );
    first.start();
    second.start();
    assert.equal(pending.size, 1, 'two activities share one frame request');
    const advance = (t: number) => {
      const work = [...pending.values()];
      pending.clear();
      work.forEach(cb => cb(t));
    };
    advance(100);
    advance(116);
    assert.deepEqual(a, [0, 0.016]);
    assert.deepEqual(b, [0, 0.016]);
    first.stop();
    advance(132);
    assert.equal(a.length, 2);
    assert.equal(b.length, 3);
    second.stop();
    assert.equal(pending.size, 0, 'nothing is scheduled when no activity runs');
  } finally {
    g.requestAnimationFrame = saved.request;
    g.cancelAnimationFrame = saved.cancel;
  }
});
test('a converted hand loop and a one-shot run on the one frame loop with the frame timestamp', async () => {
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: FrameRequestCallback) => number;
    cancelAnimationFrame?: (id: number) => void;
  };
  const saved = {request: g.requestAnimationFrame, cancel: g.cancelAnimationFrame};
  const pending = new Map<number, FrameRequestCallback>();
  let serial = 0;
  g.requestAnimationFrame = cb => {
    pending.set(++serial, cb);
    return serial;
  };
  g.cancelAnimationFrame = id => {
    pending.delete(id);
  };
  try {
    const {frameTicker, nextFrame} = await import('./activity-frames');
    const loop: number[] = [],
      once: number[] = [];
    const ticker = frameTicker('test', now => loop.push(now));
    nextFrame(now => once.push(now));
    const cancelled = nextFrame(now => once.push(-now));
    cancelled();
    assert.equal(pending.size, 1);
    const advance = (t: number) => {
      const work = [...pending.values()];
      pending.clear();
      work.forEach(cb => cb(t));
    };
    advance(100);
    advance(116);
    assert.deepEqual(loop, [100, 116]);
    assert.deepEqual(once, [100]);
    ticker.remove();
    assert.equal(pending.size, 0);
  } finally {
    g.requestAnimationFrame = saved.request;
    g.cancelAnimationFrame = saved.cancel;
  }
});
