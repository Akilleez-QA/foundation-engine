import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameLoop } from '../../core/activity/loop';
import type { FrameRecord } from '../../core/activity/ports';
import { binWidthAt, createSessionRecorder, FixedHistogram, HISTOGRAM_BINS, recordSession, slope, type SessionRecorder } from './session-recorder';

/** Drives a recorder with synthetic frame records on one timeline. */
function driver(rec: SessionRecorder, start = 1000) {
  let t = start;
  const r: FrameRecord = { timeMs: 0, intervalMs: 0, rendered: true, hidden: false, sinceEnterMs: 0, workMs: 0, stepped: false };
  return {
    get t() { return t; },
    frame(intervalMs: number, workMs = 1, rendered = true) {
      t += intervalMs; r.timeMs = t; r.intervalMs = intervalMs; r.workMs = workMs; r.rendered = rendered; r.hidden = false;
      rec.frame(r);
    },
    resume() { r.timeMs = t; r.intervalMs = 0; r.workMs = 0; r.rendered = true; r.hidden = false; rec.frame(r); },
    hidden(awayMs = 0) { t += awayMs; r.timeMs = t; r.intervalMs = 0; r.workMs = 0; r.rendered = false; r.hidden = true; rec.frame(r); },
    at(timeMs: number, intervalMs: number) { if (Number.isFinite(timeMs)) t = timeMs; r.timeMs = timeMs; r.intervalMs = intervalMs; r.workMs = 1; r.rendered = true; r.hidden = false; rec.frame(r); },
  };
}

/** Exact nearest-rank percentile. */
const exact = (values: number[], p: number) => { const s = [...values].sort((a, b) => a - b); return s[Math.max(1, Math.ceil(p * s.length)) - 1]; };

test('PERF-01: percentiles on known distributions are within one bin above the exact nearest rank', () => {
  // A deterministic LCG: no Math.random in source (lint), and a replayable case.
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const cases: Record<string, number[]> = {
    constant: Array.from({ length: 1000 }, () => 16.7),
    uniform: Array.from({ length: 5000 }, () => 8 + rand() * 20),
    bimodal: Array.from({ length: 4000 }, (_, i) => (i % 10 === 0 ? 33.4 : 16.7) + rand() * 0.5),
    heavyTail: Array.from({ length: 3000 }, () => 10 / Math.max(0.01, rand())),
    single: [42.42],
  };
  for (const [name, values] of Object.entries(cases)) {
    const h = new FixedHistogram();
    for (const v of values) h.add(Math.min(v, 999));
    const clipped = values.map(v => Math.min(v, 999));
    for (const p of [0.5, 0.95, 0.99]) {
      const want = exact(clipped, p), got = h.quantile(p);
      assert.ok(got >= want - 1e-9, `${name} p${p * 100}: ${got} must not be below exact ${want}`);
      assert.ok(got - want <= binWidthAt(want) + 1e-9, `${name} p${p * 100}: ${got} within one bin of ${want}`);
    }
    assert.equal(h.summary()!.max, Math.round(Math.max(...clipped) * 1000) / 1000);
  }
  const constant = new FixedHistogram(); for (let i = 0; i < 10; i++) constant.add(16.7);
  assert.equal(constant.quantile(0.99), 16.7, 'clamped to the observed max: a constant is exact');
  assert.ok(Number.isNaN(new FixedHistogram().quantile(0.5)));
  assert.equal(new FixedHistogram().summary(), null);
  const over = new FixedHistogram(); over.add(5000); assert.equal(over.quantile(0.5), 5000, 'overflow bin reports the observed max');
});

test('PERF-01: rolling windows close on loop-active time and percentiles describe each window', () => {
  const rec = createSessionRecorder({ windowMs: 1000, maxWindows: 10 });
  const d = driver(rec);
  d.resume();
  for (let i = 0; i < 60; i++) d.frame(16.7, 2);   // ≈ 1002 ms: one full window
  for (let i = 0; i < 25; i++) d.frame(40, 5);     // exactly 1000 ms: a second full window
  const e = rec.evidence();
  assert.equal(e.windows.length, 2);
  const [a, b] = e.windows;
  assert.equal(a.complete, true); assert.equal(a.end, 'full');
  assert.equal(a.frames, 61); assert.equal(a.resumes, 1, 'the first frame after an idle loop has no interval');
  assert.equal(a.frameMs!.p50, 16.7); assert.equal(a.workMs!.p95, 2);
  assert.equal(a.longFrames, 0);
  assert.equal(b.frames, 25); assert.equal(b.frameMs!.p99, 40);
  assert.equal(b.longFrames, 25, '40 ms > 1.5 × 16.67 ms'); assert.equal(b.severeFrames, 0);
  assert.equal(b.startMs, a.endMs, 'windows are contiguous on the session timeline');
  assert.equal(a.classification.kind, 'unclassified', 'no upload/request facts: never claimed steady');
  assert.equal(a.classification.comparable, false);
  assert.equal(e.session.frames, 86);
});

test('PERF-01: the ring buffer is bounded; stop policy truncates with an explicit marker and detaches', () => {
  let detached = 0;
  const stop = createSessionRecorder({ windowMs: 100, maxWindows: 3 }, () => { detached++; });
  const d = driver(stop);
  for (let i = 0; i < 50; i++) d.frame(10);
  const e = stop.evidence();
  assert.equal(e.windows.length, 3);
  assert.equal(e.state, 'truncated');
  assert.deepEqual(e.truncated, { reason: 'capacity', atMs: 300 });
  assert.equal(detached, 1, 'truncation releases the loop sampler slot');
  assert.equal(e.session.frames, 30, 'frames after truncation are not recorded');

  const ring = createSessionRecorder({ windowMs: 100, maxWindows: 3, overflow: 'ring' });
  const r = driver(ring);
  for (let i = 0; i < 1000; i++) r.frame(10);
  const re = ring.evidence();
  assert.equal(re.windows.length, 3, 'never more than maxWindows retained');
  assert.equal(re.session.windowsClosed, 100);
  assert.equal(re.session.evictedWindows, 97);
  assert.deepEqual(re.windows.map(w => w.index), [97, 98, 99], 'oldest evicted first, order kept');
  assert.equal(re.state, 'recording');
  assert.equal(re.session.frames, 1000, 'session totals still cover evicted windows');
});

test('PERF-01: segment capacity truncates instead of growing', () => {
  const rec = createSessionRecorder({ windowMs: 1000, maxSegments: 2 });
  const d = driver(rec);
  for (const scene of ['a', 'b', 'c']) { rec.segment({ scene, epoch: 1 }); d.frame(10); d.frame(10); }
  const e = rec.evidence();
  assert.equal(e.segments.length, 2);
  assert.equal(e.truncated?.reason, 'segments');
});

test('PERF-01: a hidden tab closes the open window as invalid and pauses accounting until frames resume', () => {
  const rec = createSessionRecorder({ windowMs: 1000 });
  const d = driver(rec);
  for (let i = 0; i < 30; i++) d.frame(16);
  d.hidden(60_000);                                // away a minute: no interval reaches a window
  d.resume();
  for (let i = 0; i < 70; i++) d.frame(16);
  const e = rec.evidence();
  assert.equal(e.session.hiddenTransitions, 1);
  assert.equal(e.windows[0].end, 'hidden');
  assert.equal(e.windows[0].complete, false);
  assert.equal(e.windows[0].classification.kind, 'invalid');
  assert.equal(e.windows[1].complete, true);
  assert.equal(e.windows[1].frameMs!.max, 16, 'the hidden minute never appears as a frame interval');
  assert.ok(e.windows[1].startMinute >= 1, 'drift x-axis keeps session wall time');
  // A hidden flip with fewer than two frames is discarded, not stored.
  d.hidden(); d.resume(); d.hidden();
  assert.equal(rec.evidence().session.discardedWindows, 1);
});

test('PERF-01: clock jumps: backwards timestamps are counted and kept monotonic; forward jumps are gaps', () => {
  const rec = createSessionRecorder({ windowMs: 10_000, gapMs: 1000 });
  const d = driver(rec, 5000);
  d.frame(16); d.frame(16);
  d.at(100, 0);                                   // timestamp went backwards (a reset timebase)
  d.at(Number.NaN, 16);                           // non-finite timestamp
  d.frame(5000);                                  // a 5 s stall or forward jump
  d.frame(16);
  rec.stop();
  const e = rec.evidence();
  assert.equal(e.session.clockAnomalies, 2);
  assert.equal(e.session.gaps, 1);
  assert.equal(e.session.frameMs!.max, 16, 'the gap is excluded from percentiles');
  const w = e.windows[0];
  assert.ok(w.endMs >= w.startMs);
  assert.equal(w.end, 'stopped');
});

test('PERF-01: stop and dispose mid-window; both idempotent and evidence stays readable', () => {
  let detached = 0;
  const rec = createSessionRecorder({ windowMs: 1000 }, () => { detached++; });
  const d = driver(rec);
  for (let i = 0; i < 10; i++) d.frame(16);
  rec.dispose(); rec.dispose(); rec.stop();
  d.frame(16);
  const e = rec.evidence();
  assert.equal(e.state, 'disposed');
  assert.equal(detached, 1);
  assert.equal(e.windows.length, 0, 'dispose drops the open window');
  assert.equal(e.session.discardedWindows, 1);
  assert.equal(e.session.frames, 10);
  assert.equal(e.session.frameMs!.p50, 16, 'totals frozen at dispose');

  const s = createSessionRecorder({ windowMs: 1000 });
  const sd = driver(s);
  for (let i = 0; i < 10; i++) sd.frame(16);
  s.stop(); s.stop();
  sd.frame(16);
  const se = s.evidence();
  assert.equal(se.state, 'stopped');
  assert.equal(se.windows.length, 1, 'stop keeps the partial window, marked incomplete');
  assert.equal(se.windows[0].end, 'stopped');
  assert.equal(se.windows[0].classification.kind, 'invalid');
  s.dispose();
  assert.equal(s.evidence().windows.length, 1, 'retained summaries survive dispose');
});

test('PERF-01: segments follow route changes; pause closes the window; same key is a no-op', () => {
  const rec = createSessionRecorder({ windowMs: 1000 });
  const d = driver(rec);
  rec.segment({ scene: 'scene.a', epoch: 1, preset: 'high' });
  for (let i = 0; i < 5; i++) d.frame(16);
  rec.segment({ scene: 'scene.a', epoch: 1, preset: 'high' });
  rec.segment(null);                               // scene.entering: handover
  for (let i = 0; i < 5; i++) d.frame(16);         // not recorded while paused
  rec.segment({ scene: 'scene.b', epoch: 2, preset: 'high' });
  for (let i = 0; i < 5; i++) d.frame(16);
  rec.segment({ scene: 'scene.b', epoch: 2, preset: 'low' });
  for (let i = 0; i < 3; i++) d.frame(16);
  rec.stop();
  const e = rec.evidence();
  assert.deepEqual(e.segments.map(s => [s.scene, s.epoch, s.preset]), [['scene.a', 1, 'high'], ['scene.b', 2, 'high'], ['scene.b', 2, 'low']]);
  assert.deepEqual(e.windows.map(w => [w.segment, w.end, w.frames]), [[0, 'paused', 5], [1, 'segment', 5], [2, 'stopped', 3]]);
  assert.equal(e.session.frames, 13);
});

test('PERF-01: drift slope and early/late ratio surface a synthetic throttling ramp', () => {
  const rec = createSessionRecorder({ windowMs: 60_000, maxWindows: 30 });
  const d = driver(rec);
  rec.segment({ scene: 'scene.soak', preset: 'medium' });
  // 20 minutes: work time rises 0.25 ms per minute; frame time steps from 16.7 to 33.3 after minute 12.
  for (let minute = 0; minute < 20; minute++) {
    const frameMs = minute < 12 ? 16.7 : 33.3, workMs = 4 + 0.25 * minute;
    const n = Math.ceil(60_000 / frameMs);
    for (let i = 0; i < n; i++) d.frame(frameMs, workMs);
  }
  const e = rec.evidence();
  const [g] = e.drift;
  assert.equal(g.group, 'scene.soak|medium');
  assert.equal(g.windows, 20);
  assert.ok(Math.abs(g.workP95SlopeMsPerMin! - 0.25) < 0.02, `work slope ${g.workP95SlopeMsPerMin}`);
  assert.ok(g.frameP95SlopeMsPerMin! > 0.5);
  assert.ok(g.workP95Ratio! > 1.5 && g.frameP95Ratio! > 1.9);
  // A flat session has ~0 slope.
  const flat = createSessionRecorder({ windowMs: 1000 }), fd = driver(flat);
  for (let i = 0; i < 600; i++) fd.frame(16.7, 3);
  assert.equal(flat.evidence().drift[0].workP95SlopeMsPerMin, 0);
  assert.equal(slope([1], [2]), null);
  assert.equal(slope([1, 1], [2, 3]), null);
});

test('PERF-01: optional cumulative counters are read only at window boundaries and failures are counted', () => {
  let reads = 0, draws = 0, tris = 0;
  const rec = createSessionRecorder({ windowMs: 100, counters: () => { reads++; return { draws, triangles: tris }; } });
  const d = driver(rec);
  for (let i = 0; i < 10; i++) { draws += 7; tris += 300; d.frame(10); }
  assert.equal(reads, 2, 'one read when the window opens, one when it closes');
  const w = rec.evidence().windows[0];
  assert.equal(w.drawsPerRenderedFrame, 6.3, 'deltas after the opening read');
  assert.equal(w.trianglesPerRenderedFrame, 270);
  const broken = createSessionRecorder({ windowMs: 100, counters: () => { throw new Error('gone'); } });
  const b = driver(broken);
  for (let i = 0; i < 10; i++) b.frame(10);
  const be = broken.evidence();
  assert.equal(be.windows[0].drawsPerRenderedFrame, null);
  assert.equal(be.session.counterFailures, 1);
});

test('PERF-01: options are validated and labels are bounded; evidence is detached JSON', () => {
  assert.throws(() => createSessionRecorder({ windowMs: 0 }), RangeError);
  assert.throws(() => createSessionRecorder({ maxWindows: 1.5 }), RangeError);
  assert.throws(() => createSessionRecorder({ maxWindows: 1e9 }), RangeError);
  assert.throws(() => createSessionRecorder({ overflow: 'grow' as never }), RangeError);
  assert.throws(() => createSessionRecorder({ meta: { evidence: 'certified' as never } }), RangeError);
  const rec = createSessionRecorder({ windowMs: 100, meta: { profile: 'x'.repeat(500) + '\n', evidence: 'emulated', build: 'abc' } });
  const d = driver(rec);
  for (let i = 0; i < 20; i++) d.frame(10);
  const e = rec.evidence();
  assert.equal(e.meta.profile.length, 120);
  assert.equal(e.meta.evidence, 'emulated');
  assert.equal(e.recorder.histogram.bins, HISTOGRAM_BINS);
  assert.ok(e.limitations.some(l => /DV-01/.test(l)));
  e.windows[0].frameMs!.p50 = -1;
  assert.notEqual(rec.evidence().windows[0].frameMs!.p50, -1, 'a snapshot cannot mutate the recorder');
  assert.deepEqual(JSON.parse(JSON.stringify(e)), e, 'JSON-safe');
});

test('PERF-01: recordSession uses the loop\'s one sampler slot and releases it on stop', () => {
  const pending = new Map<number, (t: number) => void>(); let serial = 0;
  const loop = new FrameLoop({ scheduler: { request: cb => { pending.set(++serial, cb); return serial; }, cancel: id => { pending.delete(id); } },
    layers: { coverage: () => 'top', onChange: () => () => {} }, calm: () => false, now: () => 0 });
  const run = (ms: number) => { const w = [...pending.values()]; pending.clear(); for (const cb of w) cb(ms); };
  loop.add({ owner: 'a', mode: 'continuous', render: () => {} });
  const rec = recordSession(loop, { windowMs: 100 });
  assert.equal(loop.hasSampler, true);
  assert.throws(() => recordSession(loop), /already has a frame sampler/);
  for (let t = 0; t <= 200; t += 10) run(t);
  rec.stop();
  assert.equal(loop.hasSampler, false);
  const e = rec.evidence();
  assert.equal(e.windows.filter(w => w.complete).length, 2);
  assert.equal(e.session.frames, 21);
});

test('PERF-01: a pause or segment close that fills the ring stays truncated under the stop policy', () => {
  for (const close of ['pause', 'segment'] as const) {
    let detached = 0;
    const rec = createSessionRecorder({ windowMs: 100, maxWindows: 2 }, () => { detached++; });
    const d = driver(rec);
    rec.segment({ scene: 'scene.a', epoch: 1 });
    for (let i = 0; i < 10; i++) d.frame(10);      // window 1 fills naturally
    for (let i = 0; i < 3; i++) d.frame(10);       // window 2 open
    if (close === 'pause') rec.segment(null); else rec.segment({ scene: 'scene.b', epoch: 2 });
    assert.equal(rec.state, 'truncated', `${close}: the close that filled the ring truncates`);
    rec.segment({ scene: 'scene.c', epoch: 3 });
    rec.segment(null);
    for (let i = 0; i < 30; i++) d.frame(10);
    const e = rec.evidence();
    assert.equal(e.state, 'truncated', `${close}: later segment calls cannot revive it`);
    assert.equal(e.truncated?.reason, 'capacity');
    assert.equal(e.windows.length, 2);
    assert.equal(e.session.evictedWindows, 0, 'stop policy never evicts');
    assert.equal(e.session.frames, 13, 'frames after truncation are ignored');
    assert.equal(detached, 1);
  }
});

test('PERF-01: frames stepped by a held test driver are counted, never timed', () => {
  const rec = createSessionRecorder({ windowMs: 1000 });
  const d = driver(rec, 50_000);
  for (let i = 0; i < 5; i++) d.frame(16);
  const stepped: FrameRecord = { timeMs: 0, intervalMs: 50, rendered: true, hidden: false, sinceEnterMs: 0, workMs: 9, stepped: true };
  for (let i = 1; i <= 9; i++) { stepped.timeMs = i * 50; rec.frame(stepped); }   // manualMs restarts at 0
  for (let i = 0; i < 5; i++) d.frame(16);
  rec.stop();
  const e = rec.evidence();
  assert.equal(e.session.steppedFrames, 9);
  assert.equal(e.session.clockAnomalies, 0, 'a stepped timeline is not a clock anomaly');
  assert.equal(e.session.frames, 10);
  assert.equal(e.session.frameMs!.max, 16, 'script-chosen intervals never enter percentiles');
  assert.equal(e.session.workMs!.max, 1);
  assert.equal(e.windows[0].steppedFrames, 9);
  assert.equal(e.windows[0].activeMs, 160);
});
