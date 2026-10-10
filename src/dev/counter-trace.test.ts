import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameLoop} from '../core/activity/loop';
import {createEventBus} from '../core/events';
import {createGpuTimer} from '../platform/render/gpu-timer';
import {fakeTimerGl} from '../platform/render/testing/fake-timer-gl';
import {counterSampler, createCounterTrace, mergeTraceExports} from './counter-trace';
import {createEventTrace} from './event-trace';

test('counter trace export: one global frame marker and one C record per value, in microseconds', () => {
  const trace = createCounterTrace();
  trace.frame(1, 16.5, {draws: 12, triangles: 3000, queue: undefined});
  trace.frame(2, 33, {draws: 13}, true);
  const out = trace.exportTrace();
  assert.deepEqual(out.traceEvents, [
    {
      ph: 'i',
      s: 'g',
      cat: 'foundation.frames',
      name: 'frame',
      pid: 1,
      tid: 1,
      ts: 16500,
      args: {frame: 1, stepped: false},
    },
    {ph: 'C', cat: 'foundation.counters', name: 'draws', pid: 1, tid: 1, ts: 16500, args: {value: 12}},
    {ph: 'C', cat: 'foundation.counters', name: 'triangles', pid: 1, tid: 1, ts: 16500, args: {value: 3000}},
    {
      ph: 'i',
      s: 'g',
      cat: 'foundation.frames',
      name: 'frame',
      pid: 1,
      tid: 1,
      ts: 33000,
      args: {frame: 2, stepped: true},
    },
    {ph: 'C', cat: 'foundation.counters', name: 'draws', pid: 1, tid: 1, ts: 33000, args: {value: 13}},
  ]);
  assert.equal(out.displayTimeUnit, 'ms');
  assert.equal(out.metadata.schemaVersion, 1);
  assert.equal(out.metadata.frames, 2);
  assert.deepEqual(out.metadata.counters, ['draws', 'triangles']);
  // Loadable as standard JSON: round-trips without loss.
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

test('counter trace ring: overwrites the oldest frames and counts every drop', () => {
  const trace = createCounterTrace({capacity: 3});
  for (let f = 1; f <= 5; f++) trace.frame(f, f * 16, {n: f});
  const snap = trace.snapshot();
  assert.deepEqual(
    snap.rows.map(r => r.frame),
    [3, 4, 5],
  );
  assert.equal(snap.droppedFrames, 2);
});

test('counter trace: late values attach to their own frame while it is retained, else are counted late-dropped', () => {
  const trace = createCounterTrace({capacity: 4});
  for (let f = 1; f <= 6; f++) trace.frame(f, f * 10);
  assert.equal(trace.sample(5, 'gpuMs', 2.5), true);
  assert.equal(trace.sample(1, 'gpuMs', 9), false, 'frame 1 left the ring');
  assert.equal(trace.sample(99, 'gpuMs', 1), false, 'a future frame is never invented');
  const snap = trace.snapshot();
  assert.deepEqual(
    snap.rows.map(r => r.values[0]),
    [undefined, undefined, 2.5, undefined],
  );
  assert.equal(snap.lateSamples, 1);
  assert.equal(snap.lateDropped, 2);
});

test('counter trace bounds: names, name length, invalid values and invalid frames are refused and counted', () => {
  const trace = createCounterTrace({maxCounters: 2, maxNameLength: 4});
  trace.frame(1, 1, {alpha: 1, b: 2, c: 3, d: Number.NaN, e: Infinity});
  trace.frame(1, 2, {b: 1}); // frame did not increase
  trace.frame(2, 0.5, {b: 1}); // time went backwards
  trace.frame(3, Number.NaN);
  const snap = trace.snapshot();
  assert.deepEqual(snap.names, ['alph', 'b']);
  assert.equal(snap.truncatedNames, 1);
  assert.equal(snap.droppedCounters, 1);
  assert.equal(snap.invalidValues, 2);
  assert.equal(snap.invalidFrames, 3);
  assert.equal(snap.rows.length, 1);
  for (const bad of [{capacity: 0}, {capacity: 65537}, {maxCounters: 65}, {maxNameLength: 0}, {capacity: 2.5}])
    assert.throws(() => createCounterTrace(bad), RangeError);
});

test('counter trace: reset clears; dispose freezes the final snapshot', () => {
  const trace = createCounterTrace();
  trace.frame(5, 5, {a: 1});
  trace.reset();
  assert.equal(trace.snapshot().rows.length, 0);
  trace.frame(1, 1, {a: 1}); // frame numbering may restart after reset
  trace.dispose();
  trace.frame(2, 2, {a: 2});
  assert.equal(trace.sample(1, 'b', 1), false);
  const snap = trace.snapshot();
  assert.equal(snap.rows.length, 1);
  assert.equal(snap.disposed, true);
});

test('counter trace merge: event, system-like and counter exports form one timestamp-ordered document', () => {
  const bus = createEventBus();
  let clock = 10;
  const events = createEventTrace(bus, {now: () => clock});
  const counters = createCounterTrace();
  counters.frame(1, 5, {draws: 1});
  bus.emit('app.started', {ms: 1});
  clock = 20;
  counters.frame(2, 15, {draws: 2});
  const merged = mergeTraceExports(counters.exportTrace(), events.exportTrace());
  const ts = merged.traceEvents.map(e => e.ts);
  assert.deepEqual(
    ts,
    [...ts].sort((a, b) => a - b),
  );
  assert.equal(merged.traceEvents.length, 5);
  assert.equal(merged.metadata.sources.length, 2);
  events.dispose();
});

/** A fake rAF for the real loop: frames run when the test advances time. */
function frames() {
  const pending = new Map<number, (t: number) => void>();
  let serial = 0;
  return {
    scheduler: {
      request(cb: (t: number) => void) {
        pending.set(++serial, cb);
        return serial;
      },
      cancel(id: number) {
        pending.delete(id);
      },
    },
    run(ms: number) {
      const work = [...pending.values()];
      pending.clear();
      for (const cb of work) cb(ms);
    },
  };
}

test('counter trace composed with the real frame loop and a GPU timer: late GPU time lands on the frame it measured', () => {
  const f = frames();
  let now = 0;
  const loop = new FrameLoop({
    layers: {coverage: () => 'top', onChange: () => () => {}},
    calm: () => false,
    scheduler: f.scheduler,
    now: () => now,
  });
  const gl = fakeTimerGl();
  const trace = createCounterTrace();
  const timer = createGpuTimer(gl.gl, {
    onResult: (frame, ms) => trace.sample(frame, 'gpuMs', ms),
  });
  let draws = 0;
  loop.add({
    owner: 'scene',
    mode: 'continuous',
    render(info) {
      timer.poll();
      const timed = timer.begin(info.frame);
      draws = 3 + info.frame;
      if (timed) timer.end();
    },
  });
  const off = loop.attachSampler(
    counterSampler(trace, {frameNumber: () => loop.stats.frames, sources: () => ({draws})}),
  );
  f.run(0);
  f.run(16);
  gl.answer(1.5); // frame 1's query answers two frames later
  f.run(33);
  gl.answer(2);
  f.run(50);
  loop.setHidden(true); // hidden records are not frames
  const snap = trace.snapshot();
  const gpu = snap.names.indexOf('gpuMs'),
    d = snap.names.indexOf('draws');
  assert.deepEqual(
    snap.rows.map(r => [r.frame, r.values[d], r.values[gpu]]),
    [
      [1, 4, 1.5],
      [2, 5, 2],
      [3, 6, undefined],
      [4, 7, undefined],
    ],
  );
  assert.equal(snap.lateSamples, 2);
  off();
  timer.dispose();
  loop.dispose();
});

test('counter sampler: a throwing source is counted and the loop keeps its own values', () => {
  const trace = createCounterTrace();
  const sampler = counterSampler(trace, {
    frameNumber: () => 1,
    sources: () => {
      throw Error('stats owner failed');
    },
  });
  sampler.frame({timeMs: 1, intervalMs: 16, workMs: 2, rendered: true, hidden: false, sinceEnterMs: 0, stepped: false});
  const snap = trace.snapshot();
  assert.equal(snap.sourceErrors, 1);
  assert.deepEqual(snap.names, ['intervalMs', 'workMs', 'rendered']);
});
