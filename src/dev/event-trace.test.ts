import test from 'node:test';
import assert from 'node:assert/strict';
import {createEventBus} from '../core/events';
import {createEventTrace} from './event-trace';

test('causal event trace preserves nested parentage, listener failures and legacy tap order without payloads', () => {
  const bus = createEventBus({
    onListenerError() {
      throw Error('report failure');
    },
  });
  const trace = createEventTrace(bus);
  const taps: string[] = [];
  bus.tap(k => taps.push(k));
  bus.on('app.started', () => bus.emit('app.module-failed', {id: 'secret', phase: 'start', error: 'secret'}));
  bus.on('app.module-failed', () => {
    throw Error('secret');
  });
  bus.emit('app.started', {ms: 1});
  const data = trace.snapshot();
  assert.deepEqual(
    data.records.map(r => [r.id, r.parent, r.phase, r.listenerErrors]),
    [
      [1, null, 'begin', 0],
      [2, 1, 'begin', 0],
      [2, 1, 'end', 1],
      [1, null, 'end', 0],
    ],
  );
  assert.deepEqual(taps, ['app.module-failed', 'app.started']);
  assert.equal(JSON.stringify(data).includes('secret'), false);
});

test('depth rejection is a causal attempt, not a delivered event', () => {
  const bus = createEventBus({maxDepth: 1, onListenerError() {}});
  const trace = createEventTrace(bus);
  bus.on('app.started', p => bus.emit('app.started', p));
  bus.emit('app.started', {ms: 1});
  assert.deepEqual(
    trace.snapshot().records.map(r => [r.phase, r.parent, r.depth, r.listenerErrors]),
    [
      ['begin', null, 1, 0],
      ['rejected', 1, 2, 0],
      ['end', null, 1, 1],
    ],
  );
});

test('ring wraps with bounded labels and detached snapshots, reset and dispose are explicit', () => {
  const bus = createEventBus();
  const trace = createEventTrace(bus, {capacity: 3, maxLabels: 1, maxLabelLength: 5});
  bus.emit('app.started', {ms: 1});
  bus.emit('app.module-failed', {id: '', phase: 'start', error: ''});
  const data = trace.snapshot();
  assert.deepEqual(
    data.records.map(r => r.sequence),
    [2, 3, 4],
  );
  assert.equal(data.droppedRecords, 1);
  assert.equal(data.droppedLabels, 1);
  assert.equal(data.truncatedLabels, 2);
  assert.deepEqual(data.labels, ['app.s']);
  data.records[0]!.depth = 99;
  data.labels[0] = 'changed';
  assert.equal(trace.snapshot().records[0]!.depth, 1);
  assert.deepEqual(trace.snapshot().labels, ['app.s']);
  trace.reset();
  assert.deepEqual(trace.snapshot().records, []);
  assert.equal(trace.snapshot().droppedRecords, 0);
  trace.dispose();
  trace.dispose();
  bus.emit('app.started', {ms: 1});
  assert.deepEqual(trace.snapshot().records, []);
  assert.equal(trace.snapshot().disposed, true);
});

test('reset during delivery cannot publish a stale completion or parent', () => {
  const bus = createEventBus();
  const trace = createEventTrace(bus);
  bus.on('app.started', () => {
    trace.reset();
    bus.emit('app.module-failed', {id: '', phase: 'start', error: ''});
  });
  bus.emit('app.started', {ms: 1});
  assert.deepEqual(
    trace.snapshot().records.map(r => [r.id, r.parent, r.phase]),
    [
      [1, null, 'begin'],
      [1, null, 'end'],
    ],
  );
});

test('replacement survives stale disposal and malformed limits never replace the current capture', () => {
  const bus = createEventBus();
  const old = createEventTrace(bus);
  for (const capacity of [0, -1, 1.5, NaN, Infinity, 2 ** 32]) {
    assert.throws(() => createEventTrace(bus, {capacity}), RangeError);
  }
  bus.emit('app.started', {ms: 0});
  assert.equal(old.snapshot().records.length, 2);
  const next = createEventTrace(bus);
  old.dispose();
  bus.emit('app.started', {ms: 0});
  assert.equal(next.snapshot().records.length, 2);
});

test('dispose inside a listener suppresses the unfinished end and later captures', () => {
  const bus = createEventBus();
  const trace = createEventTrace(bus);
  bus.on('app.started', () => trace.dispose());
  bus.emit('app.started', {ms: 1});
  bus.emit('app.started', {ms: 2});
  assert.deepEqual(
    trace.snapshot().records.map(r => r.phase),
    ['begin'],
  );
});

test('events emitted by error reporters and legacy taps retain synchronous parentage', () => {
  let reports = 0;
  const bus = createEventBus({
    onListenerError() {
      reports++;
      bus.emit('app.module-failed', {id: 'reporter', phase: 'start', error: ''});
    },
  });
  const trace = createEventTrace(bus);
  const taps: string[] = [];
  bus.on('app.started', () => {
    throw Error('outer listener');
  });
  bus.on('app.module-failed', () => {
    throw Error('nested listener');
  });
  bus.tap(name => {
    taps.push(name);
    if (name === 'app.started') {
      bus.emit('app.module-failed', {id: 'tap', phase: 'start', error: ''});
    }
  });
  bus.emit('app.started', {ms: 0});
  assert.equal(reports, 2, 'nested reporter failures do not recursively report themselves');
  assert.deepEqual(taps, ['app.module-failed', 'app.started', 'app.module-failed', 'app.module-failed']);
  assert.deepEqual(
    trace.snapshot().records.map(r => [r.id, r.parent, r.phase, r.listenerErrors]),
    [
      [1, null, 'begin', 0],
      [2, 1, 'begin', 0],
      [2, 1, 'end', 1],
      [3, 1, 'begin', 0],
      [4, 3, 'begin', 0],
      [4, 3, 'end', 1],
      [3, 1, 'end', 1],
      [1, null, 'end', 1],
    ],
  );
});

test('timed export pairs nested intervals in begin order and uses microseconds', () => {
  const bus = createEventBus();
  const times = [1, 2, 4, 7];
  const trace = createEventTrace(bus, {now: () => times.shift()!});
  bus.on('app.started', () => bus.emit('app.module-failed', {id: 'nested', phase: 'start', error: ''}));
  bus.emit('app.started', {ms: 0});
  const exported = trace.exportTrace();
  assert.deepEqual(
    exported.traceEvents.map(e => [e.ph, e.ts, e.dur, e.args.parent]),
    [
      ['X', 1000, 6000, null],
      ['X', 2000, 2000, 1],
    ],
  );
  assert.equal(exported.metadata.incompleteSpans, 0);
  exported.traceEvents[0]!.args.id = 999;
  exported.traceEvents[0]!.name = 'mutated';
  assert.equal(trace.exportTrace().traceEvents[0]!.args.id, 1);
  assert.equal(trace.exportTrace().traceEvents[0]!.name, 'app.started');
});

test('timed export reports overwritten and interrupted endpoints without inventing intervals', () => {
  const bus = createEventBus();
  let time = 0;
  const trace = createEventTrace(bus, {capacity: 3, now: () => ++time});
  bus.emit('app.started', {ms: 0});
  bus.emit('app.started', {ms: 0});
  assert.equal(trace.exportTrace().metadata.incompleteSpans, 1);
  assert.equal(trace.exportTrace().metadata.droppedRecords, 1);
  assert.equal(trace.exportTrace().traceEvents.length, 1);
  trace.reset();
  bus.on('app.started', () => trace.dispose());
  bus.emit('app.started', {ms: 0});
  assert.equal(trace.exportTrace().metadata.incompleteSpans, 1);
  assert.equal(trace.exportTrace().traceEvents.length, 0);
});

test('clock exceptions, nonfinite, backward and overflowing samples never alter bus delivery', () => {
  for (const value of [NaN, Infinity, -1, Number.MAX_VALUE, 'throw'] as const) {
    const bus = createEventBus();
    let calls = 0,
      delivered = 0;
    const trace = createEventTrace(bus, {
      now: () => {
        if (++calls === 1) return 2;
        if (value === 'throw') throw Error('clock failure');
        return value;
      },
    });
    bus.on('app.started', () => {
      delivered++;
    });
    bus.emit('app.started', {ms: 0});
    assert.equal(delivered, 1);
    assert.equal(trace.snapshot().invalidClockSamples, 1);
    assert.equal(trace.exportTrace().metadata.invalidTimingSpans, 1);
    assert.equal(trace.exportTrace().traceEvents.length, 0);
    trace.dispose();
  }
});

test('clock callback reset/disposal cannot publish stale records or timing state', () => {
  for (const action of ['reset', 'dispose'] as const)
    for (const trigger of [1, 2]) {
      const bus = createEventBus();
      let calls = 0;
      const trace = createEventTrace(bus, {
        now: () => {
          if (++calls === trigger) {
            trace[action]();
            return 100;
          }
          return 1;
        },
      });
      let deliveries = 0;
      bus.on('app.started', () => {
        deliveries++;
      });
      bus.emit('app.started', {ms: 0});
      assert.equal(trace.snapshot().records.length, action === 'dispose' && trigger === 2 ? 1 : 0);
      bus.emit('app.started', {ms: 0});
      assert.equal(deliveries, 2);
      assert.equal(trace.snapshot().invalidClockSamples, 0);
      assert.equal(trace.exportTrace().traceEvents.length, action === 'reset' ? 1 : 0);
    }
});

test('clock function is captured from options and rejected emits remain counted separately', () => {
  const bus = createEventBus({maxDepth: 1});
  const options = {now: () => 1};
  const trace = createEventTrace(bus, options);
  options.now = () => {
    throw Error('new callback must not be read');
  };
  bus.on('app.started', () => bus.emit('app.started', {ms: 0}));
  bus.emit('app.started', {ms: 0});
  assert.equal(trace.exportTrace().metadata.rejectedRecords, 1);
  assert.equal(trace.exportTrace().metadata.invalidClockSamples, 0);
  assert.equal(trace.exportTrace().traceEvents[0]!.args.listenerErrors, 1);
});
