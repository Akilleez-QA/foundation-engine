import test from 'node:test';
import assert from 'node:assert/strict';
import type {DocumentValue} from '../authoring/document';
import {createPrediction, type Prediction} from './prediction';
import {
  createPredictionSmoothing,
  MAX_SMOOTHING_ELAPSED_MS,
  type PredictionSmoothing,
  type PredictionSmoothingOptions,
} from './prediction-smoothing';

type Point = {x: number; y: number};
const point = (v: DocumentValue): Point => {
  const o = v as {readonly [key: string]: DocumentValue};
  return {x: Number(o.x), y: Number(o.y)};
};
const at = (list: readonly number[], i: number) => list[i] ?? NaN;
const near = (list: readonly number[], i: number, expected: number) => Math.abs(at(list, i) - expected) < 1e-12;
const isPoint = (v: DocumentValue) =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as Point).x === 'number';
const jsonLimits = {maxBytes: 256, maxNodes: 8, maxDepth: 2};
const prediction = (epoch = 'control-1'): Prediction =>
  createPrediction({
    epoch,
    baseline: {revision: 0, processedThrough: 0, stateJson: '{"x":0,"y":0}'},
    limits: {state: jsonLimits, input: jsonLimits, maxPending: 8, maxPendingBytes: 1024, maxReplaySteps: 8},
    validateState: isPoint,
    validateInput: isPoint,
    reduce: (s, i) => JSON.stringify({x: point(s).x + point(i).x, y: point(s).y + point(i).y}),
  });
const defaults: PredictionSmoothingOptions = {
  width: 2,
  project: v => [point(v).x, point(v).y],
  snapDistance: 5,
  maxRatePerMs: 1,
  decay: {kind: 'half-life', halfLifeMs: 100},
  maxElapsedMs: 50,
  settle: 1e-6,
};
const smoothing = (overrides: Partial<PredictionSmoothingOptions> = {}) =>
  createPredictionSmoothing({...defaults, ...overrides});
const values = (s: PredictionSmoothing, v: DocumentValue | null | undefined) => {
  const r = s.present(v ?? null);
  if (r.status !== 'presented') throw Error(`not presented: ${r.status}`);
  return r;
};
function reconcileObserved(p: Prediction, s: PredictionSmoothing, revision: number, through: number, state: Point) {
  const before = p.read();
  const result = p.reconcile({
    epoch: before.epoch,
    revision,
    processedThrough: through,
    stateJson: JSON.stringify(state),
  });
  return {result, observed: s.observe(before, p.read())};
}
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('prediction smoothing: construction rejects every out-of-bounds choice', () => {
  const bad: Partial<PredictionSmoothingOptions>[] = [
    {width: 0},
    {width: 65},
    {width: 1.5},
    {project: 3 as never},
    {snapDistance: 0},
    {snapDistance: [1]},
    {snapDistance: [1, Infinity]},
    {maxRatePerMs: -1},
    {maxRatePerMs: [1, NaN]},
    {maxElapsedMs: 0},
    {maxElapsedMs: MAX_SMOOTHING_ELAPSED_MS + 1},
    {settle: -1},
    {settle: 5},
    {decay: {kind: 'half-life', halfLifeMs: 0}},
    {decay: {kind: 'spring'} as never},
  ];
  for (const options of bad) assert.throws(() => smoothing(options), /prediction smoothing/, JSON.stringify(options));
});

test('prediction smoothing: a real reconcile correction is continuous in presentation and exact in simulation', () => {
  const p = prediction();
  const s = smoothing();
  p.push('{"x":2,"y":0}');
  p.push('{"x":1,"y":1}');
  const shown = values(s, p.read().predicted?.value).values;
  assert.deepEqual(shown, [3, 1]);
  // Authority processed input 1 with a different outcome; replay of input 2 yields x=1.5.
  const {result, observed} = reconcileObserved(p, s, 1, 1, {x: 0.5, y: 0});
  assert.equal(result.status, 'reconciled');
  assert.equal(observed.status, 'smoothed');
  assert.deepEqual(p.read().predicted?.value, {x: 1.5, y: 1}); // simulation is exact, never offset
  assert.deepEqual(s.read().offset, [1.5, 0]);
  const after = values(s, p.read().predicted?.value);
  assert.deepEqual(after.values, [3, 1]);
  assert.equal(after.discontinuity, false);
  // One half-life (rate cap generous) halves the offset; it then settles to exactly zero.
  s.advance(50);
  s.advance(50);
  assert.ok(near(s.read().offset, 0, 0.75));
  for (let i = 0; i < 100 && at(s.read().offset, 0) !== 0; i++) s.advance(50);
  assert.deepEqual(s.read().offset, [0, 0]);
  assert.deepEqual(values(s, p.read().predicted?.value).values, [1.5, 1]);
});

test('prediction smoothing: linear decay moves at the capped rate and elapsed time is clamped', () => {
  const s = smoothing({decay: {kind: 'linear'}, maxRatePerMs: [0.01, 0.02], maxElapsedMs: 40});
  s.correct({x: 4, y: -4}, {x: 0, y: 0});
  assert.deepEqual(s.read().offset, [4, -4]);
  s.advance(10);
  assert.ok(near(s.read().offset, 0, 3.9) && near(s.read().offset, 1, -3.8));
  s.advance(10_000); // clamped to 40 ms
  assert.ok(near(s.read().offset, 0, 3.5) && near(s.read().offset, 1, -3));
  for (const elapsed of [-1, NaN, Infinity]) assert.equal(s.advance(elapsed).status, 'invalid');
  assert.ok(near(s.read().offset, 0, 3.5));
  // Half-life decay is also capped by the per-component rate.
  const h = smoothing({decay: {kind: 'half-life', halfLifeMs: 1}, maxRatePerMs: 0.01});
  h.correct({x: 4, y: 0}, {x: 0, y: 0});
  h.advance(10);
  assert.ok(near(h.read().offset, 0, 3.9));
});

test('prediction smoothing: a correction beyond the snap distance snaps with a one-shot discontinuity flag', () => {
  const p = prediction();
  const s = smoothing();
  p.push('{"x":1,"y":0}');
  values(s, p.read().predicted?.value);
  const {observed} = reconcileObserved(p, s, 1, 1, {x: 50, y: 0});
  assert.equal(observed.status, 'snapped');
  assert.deepEqual(s.read().offset, [0, 0]);
  const first = values(s, p.read().predicted?.value);
  assert.deepEqual(first.values, [50, 0]);
  assert.equal(first.discontinuity, true);
  assert.equal(values(s, p.read().predicted?.value).discontinuity, false);
  assert.equal(s.read().snaps, 1);
  // Accumulated small corrections also snap once their sum crosses the bound.
  s.correct({x: 3, y: 0}, {x: 0, y: 0});
  assert.equal(s.correct({x: 3, y: 0}, {x: 0, y: 0}).status, 'snapped');
});

test('prediction smoothing: duplicate, obsolete and foreign baselines and pushes do not move the offset', () => {
  const p = prediction();
  const s = smoothing();
  p.push('{"x":1,"y":0}');
  reconcileObserved(p, s, 2, 1, {x: 2, y: 0});
  const offset = s.read().offset;
  assert.equal(reconcileObserved(p, s, 2, 1, {x: 2, y: 0}).observed.status, 'unchanged'); // duplicate
  assert.equal(reconcileObserved(p, s, 1, 0, {x: 9, y: 9}).observed.status, 'unchanged'); // obsolete
  const before = p.read();
  assert.equal(p.reconcile({epoch: 'other', revision: 9, processedThrough: 9, stateJson: '{}'}).status, 'foreign');
  assert.equal(s.observe(before, p.read()).status, 'unchanged');
  const beforePush = p.read();
  p.push('{"x":1,"y":0}');
  assert.equal(s.observe(beforePush, p.read()).status, 'unchanged');
  assert.deepEqual(s.read().offset, offset);
});

test('prediction smoothing: invalidation, disposal and replacement owners are explicit discontinuities', () => {
  const p = prediction();
  const s = smoothing();
  s.correct({x: 1, y: 1}, {x: 0, y: 0});
  const before = p.read();
  p.invalidate('lost-control');
  assert.deepEqual(s.observe(before, p.read()), {status: 'discontinuity', reason: 'prediction-unavailable'});
  assert.deepEqual(s.read().offset, [0, 0]);
  assert.deepEqual(s.present(null), {status: 'absent', values: null, discontinuity: true});
  const q = prediction('control-2');
  s.correct({x: 1, y: 1}, {x: 0, y: 0});
  assert.equal(s.observe(before, q.read()).status, 'discontinuity');
  assert.equal(values(s, q.read().predicted?.value).discontinuity, true);
  s.discontinuity('teleport');
  assert.equal(s.read().lastDiscontinuity, 'teleport');
  s.dispose();
  assert.equal(s.advance(1).status, 'retired');
  assert.equal(s.present({x: 0, y: 0}).status, 'retired');
  assert.equal(s.correct({x: 0, y: 0}, {x: 1, y: 1}).status, 'retired');
});

test('prediction smoothing: invalid projections and reentrant callbacks fail closed', () => {
  for (const project of [
    () => [1],
    () => [1, NaN],
    () => 'no' as never,
    () => {
      throw Error('x');
    },
  ]) {
    const s = smoothing({project});
    assert.deepEqual(s.correct({x: 0, y: 0}, {x: 1, y: 0}), {status: 'discontinuity', reason: 'projection-failed'});
    assert.equal(s.present({x: 0, y: 0}).status, 'absent');
  }
  let inner: unknown;
  const s: PredictionSmoothing = smoothing({
    project: v => {
      inner = s.advance(1);
      inner = [inner, s.present(v), s.correct(v, v)];
      return [point(v).x, point(v).y];
    },
  });
  s.correct({x: 1, y: 0}, {x: 0, y: 0});
  assert.deepEqual(inner, [{status: 'busy'}, {status: 'busy'}, {status: 'busy'}]);
  const d: PredictionSmoothing = smoothing({
    project: () => {
      d.dispose();
      return [0, 0];
    },
  });
  assert.equal(d.correct({x: 1, y: 0}, {x: 0, y: 0}).status, 'retired');
  assert.deepEqual(d.read().offset, [0, 0]);
});

function boundedRun(seed: number) {
  const rnd = mulberry32(seed);
  const p = prediction();
  const rate = [0.02, 0.05];
  const s = smoothing({maxRatePerMs: rate, snapDistance: [4, 6], decay: {kind: 'half-life', halfLifeMs: 120}});
  const authority = {x: 0, y: 0};
  let processed = 0,
    revision = 0;
  const sent: Point[] = [];
  const delivered: {revision: number; through: number; state: Point}[] = [];
  let prev = values(s, p.read().predicted?.value).values;
  const trace: number[] = [];
  const counts = {smoothed: 0, snapped: 0, steps: 0};
  for (let step = 0; step < 600; step++) {
    let motion = [0, 0],
      allowance = [0, 0];
    const op = rnd();
    if (op < 0.35 && p.read().pending.length < 8) {
      const input = {x: Math.round(rnd() * 8 - 4), y: Math.round(rnd() * 8 - 4)};
      const before = p.read().predicted!.value;
      p.push(JSON.stringify(input));
      sent.push(input);
      motion = [
        point(p.read().predicted!.value).x - point(before).x,
        point(p.read().predicted!.value).y - point(before).y,
      ];
    } else if (op < 0.6 && processed < sent.length) {
      const take = 1 + Math.floor(rnd() * (sent.length - processed));
      for (let i = 0; i < take; i++) {
        const input = sent[processed++]!;
        const drift = rnd();
        const noise = drift < 0.25 ? rnd() * 2 - 1 : drift < 0.3 ? rnd() * 40 - 20 : 0;
        authority.x += input.x + noise;
        authority.y += input.y - noise / 2;
      }
      delivered.push({revision: ++revision, through: processed, state: {...authority}});
      const pick = delivered[rnd() < 0.7 ? delivered.length - 1 : Math.floor(rnd() * delivered.length)]!;
      const {observed} = reconcileObserved(p, s, pick.revision, pick.through, pick.state);
      if (observed.status === 'smoothed' || observed.status === 'snapped') counts[observed.status]++;
    } else {
      const elapsed = rnd() * 90;
      s.advance(elapsed);
      allowance = rate.map(r => r * Math.min(elapsed, 50));
    }
    const shown = values(s, p.read().predicted!.value);
    const offset = s.read().offset;
    assert.ok(Math.abs(at(offset, 0)) <= 4 && Math.abs(at(offset, 1)) <= 6, 'offset stays within the snap distance');
    if (!shown.discontinuity) {
      for (let i = 0; i < 2; i++) {
        const presentationStep = at(shown.values, i) - at(prev, i) - at(motion, i);
        assert.ok(
          Math.abs(presentationStep) <= at(allowance, i) + 1e-9,
          `seed ${seed} step ${step}: ${presentationStep}`,
        );
      }
      counts.steps++;
    }
    prev = shown.values;
    trace.push(...shown.values);
  }
  return {trace, counts};
}

test('prediction smoothing: seeded randomized reconcile never steps presentation beyond the bound except at snaps', () => {
  for (const seed of [1, 7, 42, 1234, 99991]) {
    const {counts} = boundedRun(seed);
    assert.ok(counts.smoothed > 5 && counts.snapped > 0, JSON.stringify(counts));
  }
});

test('prediction smoothing: identical inputs give identical presentation (no clock)', () => {
  assert.deepEqual(boundedRun(5).trace, boundedRun(5).trace);
});
