import test from 'node:test';
import assert from 'node:assert/strict';
import {must} from '../testing/must';
import {createSystemRunner, type SystemSpec} from '../core/ecs/systems';
import {createSystemTiming, type SystemTimingCapture} from './system-timing';
import {sceneId} from './ids';

function setup(systems: SystemSpec<object>[]) {
  const visit = new AbortController(),
    activity = new AbortController();
  let current = true;
  const timing = createSystemTiming(
    systems,
    {
      epoch: 7,
      scene: sceneId('sample'),
      params: {},
      player: 'local',
      signal: visit.signal,
      current: () => current,
    },
    activity.signal,
  );
  return {
    timing,
    visit,
    activity,
    supersede() {
      current = false;
    },
  };
}

test('system timing attributes actual runner invocations, preserves errors and sibling execution', () => {
  let time = 0,
    siblings = 0;
  const failure = new Error('authored failure'),
    errors: unknown[] = [];
  const {timing} = setup([
    {
      id: 'slow',
      run() {
        time += 5;
      },
    },
    {
      id: 'broken',
      run() {
        time += 2;
        throw failure;
      },
    },
    {
      id: 'presentation',
      phase: 'frame',
      run() {
        siblings++;
        time++;
      },
    },
  ]);
  const capture = timing.start({now: () => time})!;
  const runner = createSystemRunner(timing.systems, {
    step: 0.1,
    report(_id, error) {
      errors.push(error);
      time += 10;
    },
  });
  runner.frame({}, 0.2);
  const rows = capture.snapshot().records;
  assert.deepEqual(
    rows.map(r => [r.ordinal, r.phase, r.durationMs, r.failed]),
    [
      [0, 'fixed', 5, false],
      [1, 'fixed', 2, true],
      [0, 'fixed', 5, false],
      [1, 'fixed', 2, true],
      [2, 'frame', 1, false],
    ],
  );
  assert.deepEqual(errors, [failure, failure]);
  assert.equal(siblings, 1);
  assert.deepEqual(runner.stats, {frames: 1, steps: 2, dropped: 0, errors: 2});
  assert.equal(must(capture.exportTrace().traceEvents[0], 'trace event 0').dur, 5000);
  assert.equal(must(capture.exportTrace().traceEvents[1], 'trace event 1').args.failed, true);
});

test('system timing bounds completed rows and labels, detaches exports, and validates before replacement', () => {
  const {timing} = setup([
    {id: 'long-name', run() {}},
    {id: 'other', run() {}},
  ]);
  const capture = timing.start({capacity: 2, maxLabels: 1, maxLabelLength: 4, now: () => 0})!;
  const runner = createSystemRunner(timing.systems);
  runner.frame({}, 1 / 60);
  runner.frame({}, 1 / 60);
  const snapshot = capture.snapshot();
  assert.equal(snapshot.records.length, 2);
  assert.equal(snapshot.droppedRecords, 2);
  assert.equal(snapshot.droppedLabels, 2);
  assert.equal(snapshot.truncatedLabels, 4);
  snapshot.labels[0] = 'changed';
  must(snapshot.records[0], 'record').ordinal = 99;
  assert.equal(capture.snapshot().labels[0], 'long');
  assert.equal(must(capture.snapshot().records[0], 'record').ordinal, 0);
  const exported = capture.exportTrace();
  must(exported.traceEvents[0], 'trace event 0').args.ordinal = 99;
  assert.equal(must(capture.exportTrace().traceEvents[0], 'trace event 0').args.ordinal, 0);
  assert.throws(() => timing.start({capacity: 0}), RangeError);
  assert.equal(capture.snapshot().disposed, false);
  capture.reset();
  assert.equal(capture.snapshot().records.length, 0);
});

test('system timing owner loss, replacement and reset suppress pending completions', () => {
  for (const operation of ['visit', 'activity', 'replace', 'reset', 'dispose']) {
    let capture: SystemTimingCapture;
    const context = setup([
      {
        id: 'sample',
        run() {
          if (operation === 'visit') context.visit.abort();
          if (operation === 'activity') context.activity.abort();
          if (operation === 'replace') context.timing.start();
          if (operation === 'reset') capture.reset();
          if (operation === 'dispose') capture.dispose();
        },
      },
    ]);
    capture = context.timing.start({now: () => 0})!;
    must(context.timing.systems[0], 'timed system').run({}, 0);
    assert.equal(capture.snapshot().records.length, 0);
    assert.equal(capture.snapshot().disposed, operation !== 'reset');
    if (operation === 'visit' || operation === 'activity') assert.equal(context.timing.start(), null);
  }
  const context = setup([]);
  context.supersede();
  assert.equal(context.timing.start(), null);
});

test('invalid or reentrant clocks cannot suppress authored execution or recurse diagnostics', () => {
  let runs = 0;
  const {timing} = setup([
    {
      id: 'sample',
      run() {
        runs++;
      },
    },
  ]);
  const options: {now: () => number} = {
    now: () => {
      throw Error('clock');
    },
  };
  const capture = timing.start(options)!;
  options.now = () => 0;
  must(timing.systems[0], 'timed system').run({}, 0);
  assert.equal(runs, 1);
  assert.equal(capture.snapshot().invalidClockSamples, 2);
  assert.equal(capture.exportTrace().metadata.invalidTimingRecords, 1);
  let times = 0;
  const reentrant = timing.start({
    now() {
      times++;
      must(timing.systems[0], 'timed system').run({}, 0);
      return times;
    },
  })!;
  must(timing.systems[0], 'timed system').run({}, 0);
  assert.equal(times, 2);
  assert.equal(runs, 4);
  assert.equal(reentrant.snapshot().records.length, 1);
  let reset!: SystemTimingCapture;
  reset = timing.start({
    now() {
      reset.reset();
      return 1;
    },
  })!;
  must(timing.systems[0], 'timed system').run({}, 0);
  assert.equal(reset.snapshot().records.length, 0);
  assert.equal(runs, 5);
});
