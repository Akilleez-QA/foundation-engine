import test from 'node:test';
import assert from 'node:assert/strict';
import type {DocumentValue} from '../authoring/document';
import {createPrediction} from './prediction';
import {
  createPredictedEvents,
  type PredictedEventIdentity,
  type PredictedEvents,
  type PredictedEventsLimits,
  type PredictedEventsUpdate,
} from './predicted-events';
import {createPredictionSmoothing} from './prediction-smoothing';

const limits: PredictedEventsLimits = {maxEntries: 64, maxKeyLength: 32, maxEventsPerObserve: 64};
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Per identity, the ordered emit (E) / cancel (C) decisions a caller performed. */
class Effects {
  readonly log = new Map<string, string>();
  note(event: PredictedEventIdentity, mark: 'E' | 'C') {
    const id = `${event.tick}:${event.key}`;
    this.log.set(id, (this.log.get(id) ?? '') + mark);
  }
  apply(update: PredictedEventsUpdate | {status: string}): PredictedEventsUpdate {
    if (!('emitted' in update)) throw Error(`unexpected ${update.status}`);
    for (const e of update.emitted) this.note(e, 'E');
    for (const c of update.cancelled) this.note(c, 'C');
    return update;
  }
  /** Truth events end emitted; mispredictions end cancelled; marks always alternate from an emit. */
  live(id: string) {
    return (this.log.get(id) ?? '').endsWith('E');
  }
  /** `omitted`: identities a re-simulation left out while live. All others must be exactly 'E' or 'EC'. */
  verify(truth: Set<string>, omitted?: Set<string>) {
    let exact = 0;
    for (const [id, marks] of this.log) {
      assert.match(marks, /^(EC)*E?$/, `${id}: ${marks}`);
      assert.equal(marks.endsWith('E'), truth.has(id), `${id}: ${marks}`);
      if (omitted && !omitted.has(id)) {
        assert.equal(marks, truth.has(id) ? 'E' : 'EC', `${id} emitted or cancelled more than once`);
        exact++;
      }
    }
    for (const id of truth) assert.ok(this.log.has(id), `${id} never emitted`);
    return exact;
  }
}

test('predicted events: construction rejects out-of-bounds limits and a non-function extractor', () => {
  for (const bad of [
    {maxEntries: 0},
    {maxEntries: 65_537},
    {maxKeyLength: 257},
    {maxKeyLength: 1.5},
    {maxEventsPerObserve: -1},
  ])
    assert.throws(() => createPredictedEvents({limits: {...limits, ...bad}}), /predicted events/);
  assert.throws(() => createPredictedEvents({limits, eventsOf: 1 as never}), /predicted events/);
});

test('predicted events: a predicted event emits once; re-simulation and confirmation do not repeat it', () => {
  const e = createPredictedEvents({limits});
  assert.deepEqual(e.predict('hit', 3), {status: 'emit', origin: 'predicted'});
  assert.deepEqual(e.predict('hit', 3), {status: 'suppressed', reason: 'duplicate'});
  e.beginReplay(2);
  assert.deepEqual(e.predict('hit', 3), {status: 'suppressed', reason: 'duplicate'});
  assert.deepEqual(e.endReplay(), {status: 'resolved', cancelled: []});
  assert.deepEqual(e.confirm('hit', 3), {status: 'suppressed', reason: 'predicted'});
  assert.deepEqual(e.confirm('hit', 3), {status: 'suppressed', reason: 'duplicate'});
  assert.deepEqual(e.predict('hit', 3), {status: 'suppressed', reason: 'confirmed'});
  // An authority-only event emits once, even when confirmation arrives before the prediction.
  assert.deepEqual(e.confirm('door', 9), {status: 'emit', origin: 'authority'});
  assert.deepEqual(e.predict('door', 9), {status: 'suppressed', reason: 'confirmed'});
  assert.equal(e.read().emitted, 2);
});

test('predicted events: mispredictions cancel exactly once at replay end or settlement, then expire', () => {
  const e = createPredictedEvents({limits});
  e.predict('a', 4);
  e.predict('b', 5);
  e.predict('c', 6);
  e.confirm('c', 6);
  e.beginReplay(5);
  assert.equal(e.beginReplay(5).status, 'invalid'); // no nested replay
  e.predict('a', 4); // below replay range: untouched
  assert.deepEqual(e.endReplay(), {status: 'resolved', cancelled: [{key: 'b', tick: 5}]});
  assert.deepEqual(e.endReplay(), {status: 'resolved', cancelled: []});
  assert.deepEqual(e.settle(6), {status: 'resolved', cancelled: [{key: 'a', tick: 4}]});
  assert.equal(e.read().entries, 0);
  assert.deepEqual(e.predict('a', 4), {status: 'dropped', reason: 'late'});
  assert.deepEqual(e.confirm('z', 6), {status: 'dropped', reason: 'late'});
  assert.deepEqual(e.settle(2), {status: 'resolved', cancelled: []}); // never moves backward
  assert.equal(e.read().settledThrough, 6);
  e.predict('q', 9);
  assert.deepEqual(e.cancelPending(), {status: 'resolved', cancelled: [{key: 'q', tick: 9}]});
  assert.equal(e.read().cancelled, 3);
});

test('predicted events: overload drops or forgets but never emits an identity twice', () => {
  const e = createPredictedEvents({limits: {...limits, maxEntries: 2}});
  e.predict('a', 1);
  e.predict('b', 2);
  assert.deepEqual(e.predict('c', 3), {status: 'dropped', reason: 'capacity'});
  assert.deepEqual(e.confirm('c', 3), {status: 'emit', origin: 'authority'}); // emitted once, unrecorded
  assert.equal(e.read().unrecorded, 1);
  assert.equal(e.read().forgottenThrough, 3);
  assert.deepEqual(e.confirm('c', 3), {status: 'dropped', reason: 'forgotten'});
  assert.deepEqual(e.predict('c', 3), {status: 'dropped', reason: 'forgotten'});
  assert.deepEqual(e.confirm('a', 1), {status: 'suppressed', reason: 'predicted'}); // recorded still works
  e.confirm('d', 2);
  assert.equal(e.read().forgottenThrough, 3); // never lowered
  assert.deepEqual(e.read().dropped, {capacity: 1, late: 0, forgotten: 3});
});

test('predicted events: invalid identities, reentrancy and disposal change nothing', () => {
  const e = createPredictedEvents({limits});
  for (const [key, tick] of [
    ['', 1],
    ['x'.repeat(33), 1],
    ['k', -1],
    ['k', 1.5],
    [3, 1],
  ] as const)
    assert.equal(e.predict(key as string, tick).status, 'invalid');
  assert.equal(e.beginReplay(-1).status, 'invalid');
  assert.equal(e.settle(NaN).status, 'invalid');
  assert.equal(e.observe(null as never, null as never).status, 'invalid'); // no extractor configured
  assert.equal(e.read().entries, 0);
  e.dispose();
  for (const r of [e.predict('a', 1), e.confirm('a', 1), e.beginReplay(0), e.endReplay(), e.settle(1)])
    assert.equal(r.status, 'retired');
});

const W = 24;
type Tick = {t: number; log: [number, string][]};
const asTick = (v: DocumentValue): Tick => {
  const o = v as {readonly [key: string]: DocumentValue};
  const log = (Array.isArray(o.log) ? o.log : []) as readonly (readonly DocumentValue[])[];
  return {t: Number(o.t), log: log.map(([tick, key]) => [Number(tick), String(key)])};
};
function step(state: Tick, v: number): Tick {
  const t = state.t + 1;
  const log = state.log.filter(([tick]) => tick > t - W);
  if (v % 3 === 0) log.push([t, 'hit']);
  if (v >= 8) log.push([t, 'burst']);
  return {t, log};
}
const eventsOf = (state: DocumentValue) => asTick(state).log.map(([tick, key]) => ({key, tick}));
const jsonLimits = {maxBytes: 4096, maxNodes: 256, maxDepth: 4};
const clientPrediction = (epoch = 'control-1') =>
  createPrediction({
    epoch,
    baseline: {revision: 0, processedThrough: 0, stateJson: '{"log":[],"t":0}'},
    limits: {state: jsonLimits, input: jsonLimits, maxPending: 12, maxPendingBytes: 1024, maxReplaySteps: 12},
    validateState: v => !!v && typeof v === 'object' && Array.isArray(asTick(v).log),
    validateInput: v => typeof v === 'number',
    reduce: (s, i) => JSON.stringify(step(asTick(s), i as number)),
  });

test('predicted events: composition with the real createPrediction reconcile and with smoothing', () => {
  const p = clientPrediction();
  const e = createPredictedEvents({limits, eventsOf});
  const s = createPredictionSmoothing({
    width: 1,
    project: v => [asTick(v).log.length],
    snapDistance: 8,
    maxRatePerMs: 1,
    decay: {kind: 'linear'},
    maxElapsedMs: 50,
    settle: 0,
  });
  const fx = new Effects();
  const observe = (act: () => unknown) => {
    const before = p.read();
    act();
    const after = p.read();
    s.observe(before, after);
    return fx.apply(e.observe(before, after));
  };
  assert.deepEqual(observe(() => p.push('3')).emitted, [{key: 'hit', tick: 1, origin: 'predicted'}]);
  observe(() => p.push('9')); // hit + burst at tick 2
  observe(() => p.push('1'));
  // Authority: tick 1 was not a hit (input altered server side); tick 2 confirmed.
  const auth = step(step({t: 0, log: []}, 1), 9);
  const update = observe(() =>
    p.reconcile({epoch: 'control-1', revision: 1, processedThrough: 2, stateJson: JSON.stringify(auth)}),
  );
  assert.deepEqual(update.cancelled, [{key: 'hit', tick: 1}]);
  assert.deepEqual(update.emitted, []);
  // Duplicate delivery and an obsolete baseline produce nothing.
  const dup = observe(() =>
    p.reconcile({epoch: 'control-1', revision: 1, processedThrough: 2, stateJson: JSON.stringify(auth)}),
  );
  assert.equal(dup.status, 'unchanged');
  fx.verify(new Set(['2:hit', '2:burst']));
  assert.equal(s.read().corrections, 1); // smoothing saw the same correction
  const before = p.read();
  p.invalidate('lost');
  observe(() => undefined);
  assert.equal(e.observe(before, p.read()).status, 'discontinuity');
});

test('predicted events: extractor failures and reentrant extractors fail closed by cancelling pending', () => {
  let mode: 'ok' | 'throw' | 'reenter' | 'dispose' = 'ok';
  const p = clientPrediction();
  const e: PredictedEvents = createPredictedEvents({
    limits,
    eventsOf: v => {
      if (mode === 'throw') throw Error('x');
      if (mode === 'reenter') assert.equal(e.predict('x', 99).status, 'busy');
      if (mode === 'dispose') e.dispose();
      return eventsOf(v);
    },
  });
  let before = p.read();
  p.push('3');
  assert.equal(e.observe(before, p.read()).status, 'observed');
  mode = 'reenter';
  before = p.read();
  p.push('6');
  assert.equal(e.observe(before, p.read()).status, 'observed');
  mode = 'throw';
  const failed = e.observe(before, p.read());
  assert.ok('cancelled' in failed && failed.status === 'events-invalid' && failed.cancelled.length === 2);
  mode = 'dispose';
  assert.equal(e.observe(before, p.read()).status, 'retired');
  assert.equal(e.read().entries, 0);
});

test('predicted events: seeded randomized out-of-order and duplicate confirmations stay exactly once', () => {
  for (const seed of [3, 11, 2026, 77777]) {
    const rnd = mulberry32(seed);
    const e = createPredictedEvents({limits: {...limits, maxEntries: 4096}});
    const fx = new Effects();
    const keys = ['hit', 'burst', 'step'];
    const truth = new Set<string>();
    const omitted = new Set<string>();
    const belief = new Map<string, boolean>();
    const T = 200;
    for (let t = 0; t <= T; t++) for (const k of keys) if (rnd() < 0.4) truth.add(`${t}:${k}`);
    const queue: [string, number][] = [];
    let head = -1,
      settled = -1,
      confirmedThrough = -1;
    const run = (r: ReturnType<PredictedEvents['predict']>, key: string, tick: number) => {
      if (r.status === 'emit') fx.note({key, tick}, 'E');
    };
    while (settled < T) {
      const op = rnd();
      if (op < 0.4 && head < T) {
        head = Math.min(T, head + 1 + Math.floor(rnd() * 3));
        for (let t = confirmedThrough + 1; t <= head; t++)
          for (const k of keys) if (truth.has(`${t}:${k}`)) queue.push([k, t]);
        confirmedThrough = head;
      } else if (op < 0.7 && head > settled) {
        // Re-simulate a random suffix of at most 12 unsettled ticks.
        const floor = Math.max(settled + 1, head - 11);
        const from = floor + Math.floor(rnd() * (head - floor + 1));
        e.beginReplay(from);
        for (let t = from; t <= head; t++)
          for (const k of keys) {
            // The client's belief per identity is stable but flips on 5% of re-simulations.
            const id = `${t}:${k}`;
            if (!belief.has(id)) belief.set(id, rnd() < (truth.has(id) ? 0.85 : 0.15));
            if (rnd() < 0.05) belief.set(id, !belief.get(id));
            if (belief.get(id)) {
              run(e.predict(k, t), k, t);
              if (rnd() < 0.2) run(e.predict(k, t), k, t); // duplicate within one pass
            } else if (fx.live(id)) omitted.add(id);
          }
        const end = e.endReplay();
        if (end.status === 'resolved') for (const c of end.cancelled) fx.note(c, 'C');
      } else if (op < 0.88 && queue.length) {
        // Deliver a random confirmation (out of order); sometimes deliver it twice.
        const i = Math.floor(rnd() * queue.length);
        const [k, t] = queue[i]!;
        if (rnd() > 0.25) queue.splice(i, 1);
        run(e.confirm(k, t), k, t);
      } else {
        // Settle only through ticks whose confirmations have all been delivered.
        const to = Math.min(head, ...queue.map(([, t]) => t - 1));
        if (to > settled) {
          const r = e.settle(to);
          if (r.status === 'resolved') for (const c of r.cancelled) fx.note(c, 'C');
          settled = to;
        }
      }
    }
    const exact = fx.verify(truth, omitted);
    assert.ok(exact > 200);
    const s = e.read();
    assert.equal(s.entries, 0);
    assert.ok(s.cancelled > 10 && s.suppressed > 10, JSON.stringify(s));
  }
});

test('predicted events: seeded randomized real prediction with reordered and duplicate baselines', () => {
  for (const seed of [5, 19, 314, 8080]) {
    const rnd = mulberry32(seed);
    const p = clientPrediction();
    const e = createPredictedEvents({limits, eventsOf});
    const fx = new Effects();
    const sent: number[] = [];
    let authority: Tick = {t: 0, log: []};
    let processed = 0,
      revision = 0;
    const truth = new Set<string>();
    const queue: {revision: number; through: number; json: string}[] = [];
    const observe = (act: () => unknown) => {
      const before = p.read();
      act();
      fx.apply(e.observe(before, p.read()));
    };
    const authorityProcess = (count: number) => {
      for (let i = 0; i < count; i++) {
        const v = sent[processed++]!;
        const altered = rnd() < 0.25 ? v + 1 : v; // the authority sometimes disagrees
        authority = step(authority, altered);
        for (const [tick, key] of authority.log) truth.add(`${tick}:${key}`);
      }
      queue.push({revision: ++revision, through: processed, json: JSON.stringify(authority)});
    };
    const deliver = (b: (typeof queue)[number]) =>
      observe(() =>
        p.reconcile({epoch: 'control-1', revision: b.revision, processedThrough: b.through, stateJson: b.json}),
      );
    for (let i = 0; i < 400; i++) {
      const op = rnd();
      if (op < 0.45 && p.read().pending.length < 12) {
        const v = Math.floor(rnd() * 10);
        observe(() => p.push(String(v)));
        sent.push(v);
      } else if (op < 0.7 && processed < sent.length) {
        authorityProcess(1 + Math.floor(rnd() * (sent.length - processed)));
      } else if (queue.length) {
        const j = Math.floor(rnd() * queue.length); // reordered delivery
        deliver(queue[j]!);
        if (rnd() < 0.6) queue.splice(j, 1); // otherwise a duplicate later
      }
      assert.equal(p.read().status, 'ready');
    }
    authorityProcess(sent.length - processed); // final, newest baseline covering every sent input
    deliver(queue.at(-1)!);
    fx.verify(truth);
    assert.equal(e.read().predicted, 0);
    assert.ok(e.read().cancelled > 3, JSON.stringify(e.read()));
  }
});

const hitAt = (tick: number, ...keys: string[]) => keys.map(key => [tick, key] as [number, string]);
test('predicted events: a replacement owner starts from a clean ledger, losing nothing (review P1)', () => {
  const e = createPredictedEvents({limits, eventsOf});
  const p = clientPrediction();
  let before = p.read();
  p.push('3');
  assert.equal(e.observe(before, p.read()).status, 'observed');
  before = p.read();
  p.reconcile({
    epoch: 'control-1',
    revision: 1,
    processedThrough: 1,
    stateJson: JSON.stringify({t: 1, log: hitAt(1, 'hit')}),
  });
  e.observe(before, p.read());
  assert.equal(e.read().settledThrough, 1);
  const old = p.read();
  p.invalidate('lost');
  assert.equal(e.observe(old, p.read()).status, 'discontinuity');
  // The replacement owner restarts its sequence; its tick-1 event must emit, not drop as late.
  const q = clientPrediction('control-2');
  before = q.read();
  q.push('3');
  const update = e.observe(before, q.read());
  assert.ok('emitted' in update);
  assert.deepEqual(update.emitted, [{key: 'hit', tick: 1, origin: 'predicted'}]);
  // A pair spanning two owners is a discontinuity that rebinds to the newer owner.
  const r = clientPrediction('control-3');
  r.push('3');
  const spanning = e.observe(q.read(), r.read());
  assert.ok('emitted' in spanning && spanning.status === 'discontinuity');
  assert.deepEqual(spanning.cancelled, [{key: 'hit', tick: 1}]);
  assert.deepEqual(spanning.emitted, [{key: 'hit', tick: 1, origin: 'predicted'}]);
});

test('predicted events: a new authority event at a settled tick is reported late, never lost silently (review P2)', () => {
  const e = createPredictedEvents({limits, eventsOf});
  const p = clientPrediction();
  const reconcile = (revision: number, through: number, log: [number, string][]) => {
    const before = p.read();
    p.reconcile({
      epoch: 'control-1',
      revision,
      processedThrough: through,
      stateJson: JSON.stringify({t: through, log}),
    });
    return e.observe(before, p.read());
  };
  const before = p.read();
  p.push('1');
  e.observe(before, p.read());
  reconcile(1, 1, []);
  const bumped = reconcile(2, 1, hitAt(1, 'other'));
  assert.ok('dropped' in bumped && bumped.dropped === 1 && bumped.emitted.length === 0);
  assert.equal(e.read().dropped.late, 1);
  // The same settled identity seen again is not counted twice.
  const again = reconcile(3, 1, hitAt(1, 'other'));
  assert.ok('dropped' in again && again.dropped === 0);
});

test('predicted events: a reconcile observed together with a later push still confirms and cancels (review P3)', () => {
  const e = createPredictedEvents({limits, eventsOf});
  const p = clientPrediction();
  let before = p.read();
  p.push('3'); // predicts hit@1
  e.observe(before, p.read());
  before = p.read();
  p.reconcile({
    epoch: 'control-1',
    revision: 1,
    processedThrough: 1,
    stateJson: JSON.stringify({t: 1, log: hitAt(1, 'burst')}),
  });
  p.push('1'); // clears correction
  const update = e.observe(before, p.read());
  assert.ok('cancelled' in update);
  assert.deepEqual(update.cancelled, [{key: 'hit', tick: 1}]);
  assert.deepEqual(update.emitted, [{key: 'burst', tick: 1, origin: 'authority'}]);
  assert.equal(e.read().predicted, 0);
});
