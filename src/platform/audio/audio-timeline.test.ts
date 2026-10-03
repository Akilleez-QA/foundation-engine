import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAudioTimeline,
  estimateOffset,
  MAX_CALIBRATION_MS,
  type AudioClockReading,
  type TimelineEvent,
} from './audio-timeline';
import {must} from '../../testing/must';

/**
 * A simulated output device: a context clock that drifts against the page clock, advances in render quanta,
 * and is heard `base + output` seconds after it renders. `stamped` reports getOutputTimestamp().
 */
function device(
  o: {rate?: number; ppm?: number; base?: number; output?: number; stamped?: boolean; startMs?: number} = {},
) {
  const rate = o.rate ?? 48000,
    quantum = 128 / rate,
    ppm = o.ppm ?? 0,
    base = o.base ?? 0.005,
    output = o.output ?? 0.02;
  let ms = o.startMs ?? 5000,
    context = 0,
    running = true,
    broken: AudioClockReading | null | 'throw' = null;
  const dev = {
    get ms() {
      return ms;
    },
    get context() {
      return context;
    },
    /** Seconds of context time the listener hears at page time `at` (ms), given the current state. */
    heardNow: () => context - base - output,
    advance(stepMs: number) {
      ms += stepMs;
      if (running) context += (stepMs / 1000) * (1 + ppm * 1e-6);
    },
    suspend() {
      running = false;
    },
    resume() {
      running = true;
    },
    /** The context clock leaps against the page clock (an output device change). */
    jump(seconds: number) {
      context += seconds;
    },
    corrupt(r: AudioClockReading | null | 'throw') {
      broken = r;
    },
    read(): AudioClockReading | null {
      if (broken === 'throw') throw Error('device gone');
      if (broken) return broken;
      if (!running) return null;
      const currentTime = Math.ceil(context / quantum) * quantum; // the next block to render
      const heard = context - base - output;
      return {
        currentTime,
        performanceTime: ms,
        outputLatency: output,
        baseLatency: base,
        output: o.stamped === false || heard <= 0 ? null : {contextTime: heard, performanceTime: ms},
      };
    },
  };
  return dev;
}
/** Deterministic pseudo-random frame times between 7 and 50 ms (variable frame rate). */
function frames(seed = 7) {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return 7 + (s / 4294967296) * 43;
  };
}

function rig(options: Partial<Parameters<typeof createAudioTimeline<string>>[0]> = {}, dev = device()) {
  const got: TimelineEvent<string>[] = [],
    dropped: TimelineEvent<string>[] = [];
  const timeline = createAudioTimeline<string>({
    read: () => dev.read(),
    now: () => dev.ms,
    dispatch: e => got.push(e),
    dropped: e => dropped.push(e),
    ...options,
  });
  return {timeline, got, dropped, dev};
}

test('the heard position follows the drifting audio clock through render quanta at a variable frame rate', () => {
  for (const stamped of [true, false]) {
    const {timeline, dev} = rig({}, device({ppm: 120, stamped}));
    assert.equal(timeline.start(), 'audio');
    const next = frames();
    let worst = 0,
      previous = -Infinity;
    const origin = timeline.contextTime(0)!;
    for (let i = 0; i < 4000; i++) {
      dev.advance(next());
      timeline.pump();
      const truth = dev.heardNow() - origin;
      if (i > 30) worst = Math.max(worst, Math.abs(timeline.position - truth));
      assert.ok(timeline.position >= previous, 'never runs backwards');
      previous = timeline.position;
    }
    assert.ok(worst < 0.003, `${stamped ? 'stamped' : 'estimated'} error ${worst}`);
    assert.equal(timeline.stats.resyncs, 0, 'drift is smoothed, not re-anchored');
    assert.ok(Math.abs(timeline.stats.latency - 0.025) < 0.003);
  }
});

test('events dispatch once, in time order, within the lookahead, with the context time to start sound at', () => {
  const {timeline, got, dev} = rig({lookahead: 0.1});
  for (const at of [1, 0.5, 0.5, 2, 0]) timeline.schedule(at, 'n' + at);
  timeline.start(0.2);
  const origin = timeline.contextTime(0)!;
  while (dev.ms < 9000) {
    dev.advance(16.7);
    timeline.pump();
  }
  assert.deepEqual(
    got.map(e => e.at),
    [0, 0.5, 0.5, 1, 2],
  );
  assert.deepEqual(
    got.map(e => e.id),
    [5, 2, 3, 1, 4],
    'equal times keep admission order',
  );
  for (const e of got) {
    assert.equal(e.when, origin + e.at);
    assert.ok(e.lateBy <= -0.0 && e.lateBy > -0.1 - 1e-9, 'dispatched ahead, within the lookahead: ' + e.lateBy);
  }
  assert.equal(timeline.stats.dispatched, 5);
  assert.equal(timeline.stats.pending, 0);
});

test('an input timestamp between frames maps to its own heard time, minus the stored calibration', () => {
  const {timeline, dev} = rig({calibration: {inputMs: 30, visualMs: 10}}, device({stamped: false}));
  timeline.start(0);
  for (let i = 0; i < 120; i++) {
    dev.advance(16);
    timeline.pump();
  }
  const origin = timeline.contextTime(0)!;
  const pressMs = dev.ms - 9.5; // a key pressed between the previous frame and this one
  const heard = dev.context - 0.0095 - 0.025 - origin;
  assert.ok(Math.abs(timeline.positionAt(pressMs) - heard) < 0.003);
  assert.ok(Math.abs(timeline.inputPosition(pressMs) - (heard - 0.03)) < 0.003);
  assert.ok(
    Math.abs(timeline.position - (dev.heardNow() - origin + 0.01)) < 0.003,
    'a 10 ms display lag is compensated by drawing 10 ms ahead',
  );
  timeline.calibration = {inputMs: -40, visualMs: 0};
  assert.ok(Math.abs(timeline.inputPosition(pressMs) - (heard + 0.04)) < 0.003);
  assert.throws(() => {
    timeline.calibration = {inputMs: MAX_CALIBRATION_MS + 1, visualMs: 0};
  });
  assert.throws(() => {
    timeline.calibration = {inputMs: 0, visualMs: NaN};
  });
  assert.throws(() => timeline.positionAt(NaN));
});

test('suspension holds position and dispatch; resume re-anchors and continues where the paused audio stopped', () => {
  const {timeline, got, dropped, dev} = rig({lateTolerance: 0.03});
  timeline.start(0);
  for (const at of [0.5, 1, 3, 3.5]) timeline.schedule(at, String(at));
  while (dev.ms < 5000 + 700) {
    dev.advance(16);
    timeline.pump();
  }
  assert.deepEqual(
    got.map(e => e.at),
    [0.5],
  );
  dev.suspend();
  const held = timeline.position;
  for (let i = 0; i < 60; i++) {
    dev.advance(50);
    assert.equal(timeline.pump(), 0);
  }
  assert.equal(timeline.position, held, 'nothing is heard while suspended');
  assert.equal(timeline.stats.stalled, true);
  // The tab comes back: the context resumes from where it stopped, the page clock has moved on 3 s.
  dev.resume();
  dev.advance(16);
  timeline.pump();
  assert.equal(timeline.stats.resyncs, 1);
  assert.equal(timeline.stats.stalled, false);
  assert.ok(Math.abs(timeline.position - held) < 0.05, 'position continues from the suspended point');
  while (timeline.position < 4) {
    dev.advance(16);
    timeline.pump();
  }
  assert.deepEqual(
    got.map(e => e.at),
    [0.5, 1, 3, 3.5],
  );
  assert.equal(dropped.length, 0, 'the audio clock paused too: nothing became late');
});

test('a forward clock jump (a device change) re-anchors and drops the events it skipped instead of playing them late', () => {
  const dev = device();
  const {timeline, got, dropped} = rig({lateTolerance: 0.03}, dev);
  timeline.start(0);
  for (const at of [0.5, 1, 1.2, 2.5]) timeline.schedule(at, String(at));
  while (timeline.position < 0.7) {
    dev.advance(16);
    timeline.pump();
  }
  dev.jump(1.5);
  dev.advance(16);
  timeline.pump();
  assert.equal(timeline.stats.resyncs, 1);
  assert.deepEqual(
    got.map(e => e.at),
    [0.5],
  );
  assert.deepEqual(
    dropped.map(e => e.at),
    [1, 1.2],
    'skipped events are reported, not played',
  );
  while (timeline.position < 2.6) {
    dev.advance(16);
    timeline.pump();
  }
  assert.deepEqual(
    got.map(e => e.at),
    [0.5, 2.5],
  );
});

test('a stalled frame drops events past the late tolerance and bounds the work per pump', () => {
  const {timeline, got, dropped, dev} = rig({maxDispatch: 4, lateTolerance: 0.05, lookahead: 0.1});
  timeline.start(0);
  for (let i = 0; i < 40; i++) timeline.schedule(0.5 + i * 0.01, 'e' + i);
  dev.advance(16);
  timeline.pump();
  dev.advance(800); // a long main-thread stall: events at 0.5..0.69 are now late by up to 0.3 s
  const before = timeline.stats.dispatched + timeline.stats.dropped;
  timeline.pump();
  assert.equal(timeline.stats.dispatched + timeline.stats.dropped - before, 4, 'at most maxDispatch resolved per pump');
  const playedLate = got.filter(e => e.lateBy > 0.05);
  assert.equal(playedLate.length, 0, 'nothing dispatched later than the tolerance');
  assert.ok(dropped.length > 0 && dropped.every(e => e.lateBy > 0.05));
  for (let i = 0; i < 40; i++) {
    dev.advance(16);
    timeline.pump();
  }
  assert.equal(timeline.stats.dispatched + timeline.stats.dropped, 40, 'every admitted event is resolved exactly once');
  assert.equal(new Set([...got, ...dropped].map(e => e.id)).size, 40);
});

test('admission, cancellation, abort, stop and dispose bound and release pending events', () => {
  const {timeline, got, dev} = rig({maxPending: 3});
  const abort = new AbortController();
  const a = timeline.schedule(1, 'a')!,
    b = timeline.schedule(1.1, 'b', abort.signal)!;
  timeline.schedule(1.2, 'c');
  assert.equal(timeline.schedule(1.3, 'd'), null, 'full');
  assert.equal(timeline.stats.pending, 3);
  assert.equal(timeline.cancel(a), true);
  assert.equal(timeline.cancel(a), false);
  abort.abort();
  assert.equal(timeline.stats.pending, 1);
  assert.equal(timeline.cancel(b), false);
  assert.equal(timeline.schedule(2, 'x', abort.signal), null, 'an aborted signal is not admitted');
  timeline.start(0);
  while (dev.ms < 7000) {
    dev.advance(16);
    timeline.pump();
  }
  assert.deepEqual(
    got.map(e => e.payload),
    ['c'],
  );
  timeline.schedule(9, 'later');
  timeline.stop();
  timeline.stop();
  assert.equal(timeline.stats.pending, 0);
  assert.equal(timeline.running, false);
  assert.ok(Number.isNaN(timeline.position));
  assert.equal(timeline.contextTime(1), null);
  assert.throws(() => timeline.schedule(NaN, 'bad'));
  assert.throws(() => timeline.schedule(1e9, 'bad'));
  timeline.dispose();
  timeline.dispose();
  assert.equal(timeline.schedule(1, 'after'), null);
  assert.throws(() => timeline.start(), /disposed/);
  assert.equal(timeline.pump(), 0);
});

test('handlers may schedule, cancel, stop or dispose during dispatch; failures do not strand siblings', () => {
  const dev = device();
  const seen: string[] = [];
  let tl!: ReturnType<typeof createAudioTimeline<string>>;
  const failure = Error('handler failed');
  tl = createAudioTimeline<string>({
    read: () => dev.read(),
    now: () => dev.ms,
    lookahead: 0.2,
    dispatch: e => {
      seen.push(e.payload);
      if (e.payload === 'a') {
        tl.schedule(e.at + 0.01, 'a2');
        tl.cancel(cId);
        assert.equal(tl.pump(), 0, 'reentrant pump does nothing');
      }
      if (e.payload === 'b') throw failure;
      if (e.payload === 'd') tl.stop();
    },
  });
  tl.schedule(0.1, 'a');
  tl.schedule(0.12, 'b');
  const cId = tl.schedule(0.13, 'c')!;
  tl.schedule(0.14, 'd');
  tl.schedule(0.15, 'e');
  tl.start(0);
  dev.advance(16);
  assert.throws(
    () => tl.pump(),
    (error: unknown) => error === failure,
  );
  assert.deepEqual(seen, ['a', 'a2', 'b', 'd'], 'c cancelled; e cancelled by stop');
  assert.equal(tl.stats.pending, 0);
  const many = createAudioTimeline<number>({
    read: () => dev.read(),
    now: () => dev.ms,
    dispatch: () => {
      throw Error('x');
    },
  });
  many.schedule(0, 1);
  many.schedule(0, 2);
  many.start(0);
  dev.advance(16);
  assert.throws(
    () => many.pump(),
    (error: unknown) => error instanceof AggregateError && error.errors.length === 2,
  );
  const disposing = createAudioTimeline<number>({
    read: () => dev.read(),
    now: () => dev.ms,
    dispatch: () => disposing.dispose(),
  });
  disposing.schedule(0, 1);
  disposing.schedule(0, 2);
  disposing.start(0);
  dev.advance(16);
  assert.equal(disposing.pump(), 1);
  assert.equal(disposing.stats.pending, 0);
});

test('without a clock sample a run uses the clamped page clock; it keeps that source until restarted', () => {
  const dev = device();
  dev.suspend();
  const {timeline, got} = rig({}, dev);
  timeline.schedule(0.2, 'p');
  assert.equal(timeline.start(0), 'performance');
  for (let i = 0; i < 30; i++) {
    dev.advance(16);
    timeline.pump();
  }
  assert.equal(must(got[0]).when, null, 'no context time on the fallback');
  assert.ok(Math.abs(timeline.position - 0.48) < 1e-9);
  dev.advance(60_000);
  timeline.pump(); // a hidden tab: one clamped step, not a minute
  assert.ok(Math.abs(timeline.position - 0.73) < 1e-9);
  dev.resume();
  dev.advance(16);
  timeline.pump();
  assert.equal(timeline.stats.source, 'performance', 'a run never switches clocks mid-way');
  timeline.stop();
  assert.equal(timeline.start(0.2), 'audio');
  assert.ok(
    Math.abs(timeline.positionAt(dev.ms) - (-0.2 - 0.025)) < 0.003,
    "a restarted run begins `lead` before its own zero, not the previous run's",
  );
  timeline.stop();
  dev.advance(5000);
  assert.equal(timeline.start(0.2), 'audio');
  assert.ok(Math.abs(timeline.positionAt(dev.ms) - (-0.2 - 0.025)) < 0.003);
  const none = rig(
    {fallback: 'none'},
    (() => {
      const d = device();
      d.suspend();
      return d;
    })(),
  );
  assert.equal(none.timeline.start(), null);
  assert.equal(none.timeline.running, false);
});

test('unusable or throwing clock readings count as no sample; a bad page clock throws', () => {
  const dev = device();
  const {timeline} = rig({}, dev);
  timeline.start(0);
  for (let i = 0; i < 10; i++) {
    dev.advance(16);
    timeline.pump();
  }
  const before = timeline.position;
  for (const bad of [
    {currentTime: NaN, performanceTime: 1, outputLatency: 0, baseLatency: 0, output: null},
    {currentTime: 1, performanceTime: -1, outputLatency: 0, baseLatency: 0, output: null},
    {currentTime: 1, performanceTime: 1, outputLatency: Infinity, baseLatency: 0, output: null},
    {
      currentTime: 1,
      performanceTime: 1,
      outputLatency: 0,
      baseLatency: 0,
      output: {contextTime: NaN, performanceTime: 1},
    },
  ] as AudioClockReading[]) {
    dev.corrupt(bad);
    dev.advance(16);
    assert.equal(timeline.pump(), 0);
    assert.equal(timeline.position, before);
  }
  dev.corrupt('throw');
  dev.advance(16);
  assert.equal(timeline.pump(), 0);
  assert.equal(timeline.stats.stalled, true);
  dev.corrupt(null);
  dev.advance(16);
  timeline.pump();
  assert.ok(timeline.position > before);
  // An absurd latency report is clamped, never trusted.
  const huge = device({output: 30, stamped: false});
  const h = rig({maxLatency: 0.5}, huge);
  h.timeline.start(0);
  huge.advance(16);
  h.timeline.pump();
  assert.equal(h.timeline.stats.latency, 0.5);
  let ms = NaN;
  const t = createAudioTimeline({read: () => null, now: () => ms, dispatch: () => {}});
  assert.throws(() => t.start(), /finite/);
  ms = 0;
  t.start();
  ms = -5;
  assert.throws(() => t.pump(), /finite/);
});

test('options are validated before any work', () => {
  const base = {read: () => null, now: () => 0, dispatch: () => {}};
  for (const bad of [
    {lookahead: 0},
    {lookahead: 2},
    {lateTolerance: -1},
    {maxPending: 0},
    {maxPending: 1.5},
    {maxDispatch: 1e9},
    {resyncThreshold: 0},
    {smoothing: 0},
    {smoothing: 1.1},
    {maxLatency: NaN},
    {fallback: 'later' as 'none'},
    {calibration: {inputMs: 600, visualMs: 0}},
  ])
    assert.throws(() => createAudioTimeline({...base, ...bad}), String(Object.keys(bad)));
  assert.throws(() => createAudioTimeline({...base, dispatch: undefined as unknown as () => void}));
  const t = createAudioTimeline(base);
  assert.throws(() => t.start(-1));
  assert.throws(() => t.start(61));
  t.start();
  assert.throws(() => t.start(), /already running/);
});

test('calibration from taps: median with outlier rejection, bounded input', () => {
  const taps = [21, 19, 22, 18, 20, 23, 17, 20, 250, -300];
  const estimate = estimateOffset(taps)!;
  assert.equal(estimate.offsetMs, 20);
  assert.equal(estimate.used, 8);
  assert.ok(estimate.spreadMs <= 2);
  assert.equal(estimateOffset([10, 12, 11]), null, 'too few taps');
  assert.equal(estimateOffset([0, 0, 0, 0, 0, 300, -300, 310], 6), null, 'too few taps survive outlier rejection');
  assert.deepEqual(
    estimateOffset([...taps, NaN, 1001, -5000, Infinity]),
    estimate,
    'stray samples are discarded, not fatal',
  );
  assert.equal(estimateOffset([NaN, 1001, 20, 20], 3), null, 'too few usable samples');
  assert.throws(() => estimateOffset('taps' as unknown as number[]));
  assert.throws(() => estimateOffset(Array(1025).fill(0)));
  assert.equal(estimateOffset(Array(8).fill(900))!.offsetMs, MAX_CALIBRATION_MS, 'clamped to the calibration bound');
});

test('repeated schedule/cancel around a far-future event keeps the queue bounded by maxPending', () => {
  const {timeline, dev} = rig({maxPending: 8});
  timeline.start(0);
  timeline.schedule(1e6, 'far');
  const queueLength = () => timeline.stats.retained;
  for (let i = 0; i < 50_000; i++) {
    const id = timeline.schedule(10 + (i % 7), 'x')!;
    if (i % 3 === 0) {
      const abort = new AbortController();
      timeline.schedule(20, 'y', abort.signal);
      abort.abort();
    }
    assert.equal(timeline.cancel(id), true);
    if (i % 1000 === 0) {
      dev.advance(16);
      timeline.pump();
    }
  }
  assert.equal(timeline.stats.pending, 1);
  assert.ok(queueLength() <= 2 * 8 + 65, 'dead records are compacted: ' + queueLength());
});

test('a handler that stops and restarts the run ends the old pump; events of the new run are not dropped', () => {
  const dev = device();
  const seen: string[] = [];
  const dropped: string[] = [];
  const tl: ReturnType<typeof createAudioTimeline<string>> = createAudioTimeline<string>({
    read: () => dev.read(),
    now: () => dev.ms,
    dropped: e => dropped.push(e.payload),
    dispatch: e => {
      seen.push(e.payload);
      if (e.payload === 'end') {
        tl.stop();
        tl.start(0);
        tl.schedule(0, 'a2');
        tl.schedule(0.01, 'b2');
      }
    },
  });
  tl.schedule(0, 'a');
  tl.schedule(1, 'end'); // the old run is ~0.9 s in when 'end' dispatches
  tl.start(0);
  for (let i = 0; i < 80; i++) {
    dev.advance(16);
    tl.pump();
  }
  assert.deepEqual(seen, ['a', 'end', 'a2', 'b2']);
  assert.deepEqual(dropped, []);
  assert.throws(() => {
    const t2 = createAudioTimeline<number>({read: () => dev.read(), now: () => dev.ms, dispatch: () => t2.start()});
    t2.schedule(0, 1);
    t2.start(0);
    dev.advance(16);
    t2.pump();
  }, /already running/);
});

test('dropped events count toward maxDispatch, so a burst of stale events is bounded per pump', () => {
  const {timeline, dropped, dev} = rig({maxDispatch: 5, lateTolerance: 0.01});
  timeline.start(0);
  for (let i = 0; i < 30; i++) timeline.schedule(0.1 + i * 0.001, 'late' + i);
  dev.advance(1000);
  assert.equal(timeline.pump(), 0);
  assert.equal(dropped.length, 5, 'five resolved in one pump');
  dev.advance(16);
  timeline.pump();
  assert.equal(dropped.length, 10);
});
