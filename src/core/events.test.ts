import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus, eventArea } from './events';
import { createProbes } from './probe';

declare module './events' {
  interface EngineEvents {
    'ktev.pinged': { n: number };
    'ktev.item.collected': { id: string; coins: number };
  }
}
declare module './probe' {
  interface EngineProbes { 'ktev-rally': { lap: number } }
}

test('typed events: payloads are checked at compile time, signals unsubscribe, one throwing listener does not starve the others', () => {
  const errors: string[] = [];
  const bus = createEventBus({ onListenerError: k => errors.push(k) });
  const seen: string[] = [];
  const ctl = new AbortController();
  bus.on('ktev.item.collected', p => seen.push(`a:${p.id}:${p.coins}`), ctl.signal);
  bus.on('ktev.item.collected', () => { throw new Error('boom'); });
  bus.on('ktev.item.collected', p => seen.push(`c:${p.id}`));
  bus.emit('ktev.item.collected', { id: 'FIRST-TRIP', coins: 2 });
  assert.deepEqual(seen, ['a:FIRST-TRIP:2', 'c:FIRST-TRIP']);
  assert.deepEqual(errors, ['ktev.item.collected']);

  // @ts-expect-error: wrong payload shape is a compile error
  bus.emit('ktev.item.collected', { id: 'X' });
  // @ts-expect-error: undeclared event names are a compile error
  bus.on('ktev.not-declared', () => {});

  ctl.abort();
  seen.length = 0;
  bus.emit('ktev.item.collected', { id: 'B', coins: 1 });
  assert.deepEqual(seen, ['c:B'], 'the aborted subscription is gone');
  assert.equal(bus.listenerCount('ktev.item.collected'), 2);

  // An already-aborted signal never subscribes.
  bus.on('ktev.pinged', () => assert.fail('should not run'), ctl.signal);
  bus.emit('ktev.pinged', { n: 1 });

  // Loop guard: a listener that re-emits its own event is stopped, and reported as a listener error.
  const loop = createEventBus({ maxDepth: 4, onListenerError: (k, e) => errors.push(`${k}:${(e as Error).message}`) });
  let depth = 0;
  loop.on('ktev.pinged', p => { depth = Math.max(depth, p.n); loop.emit('ktev.pinged', { n: p.n + 1 }); });
  loop.emit('ktev.pinged', { n: 1 });
  assert.equal(depth, 4);
  assert.ok(errors.some(e => e.includes('event loop')));
});

test('delivery is synchronous, in subscription order, over a snapshot; taps see every emit', () => {
  const bus = createEventBus();
  const order: string[] = [];
  const offB = bus.on('ktev.pinged', () => order.push('b'));
  bus.on('ktev.pinged', () => { order.push('a'); offB(); bus.on('ktev.pinged', () => order.push('late')); });
  bus.on('ktev.pinged', () => order.push('c'));
  const tapped: [string, number][] = [];
  const untap = bus.tap((k, _p, n) => tapped.push([k, n]));
  bus.emit('ktev.pinged', { n: 1 });
  assert.deepEqual(order, ['b', 'a', 'c'], 'a listener added or removed during emit does not change that delivery');
  bus.emit('ktev.pinged', { n: 2 });
  assert.deepEqual(order.slice(3), ['a', 'c', 'late']);
  untap();
  bus.emit('ktev.pinged', { n: 3 });
  assert.equal(tapped.length, 2);
  assert.equal(eventArea('progression.fact.recorded'), 'progression');
  assert.equal(eventArea('app.started'), 'app');
});

test('probes read on demand, die with their signal, and cost nothing when disabled', () => {
  let reads = 0;
  const probes = createProbes(true);
  const ctl = new AbortController();
  probes.register('ktev-rally', () => { reads++; return { lap: 3 }; }, ctl.signal);
  assert.equal(reads, 0, 'registering never computes');
  assert.deepEqual(probes.read('ktev-rally'), { lap: 3 });
  assert.deepEqual(probes.names(), ['ktev-rally']);
  ctl.abort();
  assert.equal(probes.read('ktev-rally'), undefined);
  const off = createProbes(false);
  off.register('ktev-rally', () => ({ lap: 1 }), new AbortController().signal);
  assert.deepEqual(off.names(), []);
});

test('debug taps snapshot membership before listeners and cannot extend their own delivery', () => {
  const bus = createEventBus(), seen: string[] = [];
  let first = true;
  bus.on('ktev.pinged', () => { if (first) bus.tap(() => seen.push('listener-added')); });
  let offSecond = () => {};
  bus.tap(() => {
    seen.push('first');
    if (first) { first = false; offSecond(); bus.tap(() => seen.push('tap-added')); }
  });
  offSecond = bus.tap(() => seen.push('second'));
  bus.emit('ktev.pinged', { n: 1 });
  assert.deepEqual(seen, ['first', 'second'], 'removal does not rewrite the active snapshot; additions wait');
  seen.length = 0; bus.emit('ktev.pinged', { n: 2 });
  assert.deepEqual(seen, ['first', 'listener-added', 'tap-added']);
});

test('throwing error reporter cannot starve listeners or debug taps and resets for the next failure', () => {
  let reports = 0;
  const seen: number[] = [];
  const bus = createEventBus({ onListenerError() { reports++; throw Error('report failed'); } });
  bus.on('ktev.pinged', () => { throw Error('listener failed'); });
  bus.on('ktev.pinged', p => seen.push(p.n));
  bus.tap((_k, p) => seen.push((p as { n: number }).n + 10));
  bus.emit('ktev.pinged', { n: 1 }); bus.emit('ktev.pinged', { n: 2 });
  assert.equal(reports, 2); assert.deepEqual(seen, [1, 11, 2, 12]);
});

test('a reporter emitting another failing event does not recursively report its own failure', () => {
  let reports = 0;
  const seen: number[] = [];
  const bus = createEventBus({ onListenerError() { reports++; bus.emit('ktev.pinged', { n: 2 }); } });
  bus.on('ktev.pinged', () => { throw Error('failure'); });
  bus.on('ktev.pinged', p => seen.push(p.n));
  bus.emit('ktev.pinged', { n: 1 });
  assert.equal(reports, 1); assert.deepEqual(seen, [2, 1]);
});

test('event recursion guard rejects unusable configuration', () => {
  for (const maxDepth of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createEventBus({ maxDepth }), /positive safe integer/);
  }
});

test('emit diagnostics contain throwing and reentrant observers without changing listener or tap delivery', () => {
  const bus = createEventBus();
  let delivered = 0, tapped = 0, observed = 0;
  bus.on('app.started', () => { delivered++; });
  bus.tap(() => { tapped++; });
  bus.observeEmits(() => {
    observed++;
    bus.emit('app.started', { ms: 0 });
    return () => { throw Error('diagnostic completion'); };
  });
  bus.emit('app.started', { ms: 1 });
  assert.deepEqual([delivered, tapped, observed], [2, 2, 1]);
  bus.observeEmits(() => { throw Error('diagnostic entry'); });
  bus.emit('app.started', { ms: 1 });
  assert.deepEqual([delivered, tapped], [3, 3]);
});

test('diagnostic callbacks cannot change the current delivery snapshot', () => {
  const bus = createEventBus();
  let original = 0, late = 0;
  const off = bus.on('app.started', () => { original++; });
  bus.observeEmits(() => {
    off();
    bus.on('app.started', () => { late++; });
  });
  bus.emit('app.started', { ms: 1 });
  assert.deepEqual([original, late], [1, 0]);
});
