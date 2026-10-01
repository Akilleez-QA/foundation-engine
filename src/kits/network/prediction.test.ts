import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrediction, type Prediction, type PredictionOptions } from './prediction';
const jsonLimits = { maxBytes: 256, maxNodes: 32, maxDepth: 4 };
const defaults: PredictionOptions = { epoch: 'control-1', baseline: { revision: 10, processedThrough: 5, stateJson: '0' },
  limits: { state: jsonLimits, input: jsonLimits, maxPending: 4, maxPendingBytes: 64, maxReplaySteps: 4 },
  validateState: value => typeof value === 'number', validateInput: value => typeof value === 'number',
  reduce: (state, input) => JSON.stringify(Number(state) + Number(input)),
};
const make = (overrides: Partial<PredictionOptions> = {}) => createPrediction({ ...defaults, ...overrides });
const baseline = (revision: number, processedThrough: number, stateJson: string, epoch = 'control-1') => ({ revision, processedThrough, stateJson, epoch });

test('NW03 prediction: nonzero floor, correction and exact retained suffix replay', () => {
  const seen: unknown[] = [];
  const p = make({ reduce: (state, input) => { seen.push([state, input]); return JSON.stringify(Number(state) + Number(input)); } });
  assert.equal(p.push('2').status, 'predicted'); p.push('3'); p.push('4');
  assert.equal(p.read().issuedThrough, 8); assert.equal(p.read().predicted?.value, 9);
  seen.length = 0;
  assert.equal(p.reconcile(baseline(11, 6, '20')).status, 'reconciled');
  assert.deepEqual(seen, [[20, 3], [23, 4]]); assert.equal(p.read().predicted?.value, 27);
  assert.deepEqual(p.read().correction, { changed: true, replayed: 2 });
  assert.deepEqual(p.read().pending.map(i => i.sequence), [7, 8]);
  assert.equal(p.read().confirmed?.state.value, 20);
});
test('NW03 prediction: terminal domain rejection consumes one input, transport denial does not silently drop a gap', () => {
  const p = make(); p.push('2'); p.push('3');
  p.reconcile(baseline(11, 6, '0')); // terminal rejection of seq6 leaves authoritative value unchanged
  assert.equal(p.read().predicted?.value, 3); assert.equal(p.read().pending[0]?.sequence, 7);
  const retry = p.read().pending[0];
  assert.equal(retry?.json, '3'); assert.equal(p.read().issuedThrough, 7); // retry needs no push
  p.invalidate('unconsumed-denial');
  assert.equal(p.read().predicted, null); assert.equal(p.read().pending.length, 0);
  assert.equal(p.read().confirmed?.state.value, 0); assert.equal(p.push('1').status, 'unavailable');
});
test('NW03 prediction: revision ordering, same-prefix authoritative change, duplicate canonical baseline', () => {
  const p = make(); p.push('2');
  assert.equal(p.reconcile(baseline(12, 5, '10')).status, 'reconciled');
  assert.equal(p.read().predicted?.value, 12);
  assert.equal(p.reconcile(baseline(11, 0, '99')).status, 'obsolete');
  assert.equal(p.reconcile(baseline(12, 5, '1e1')).status, 'duplicate');
  assert.equal(p.reconcile(baseline(999, 999, '99', 'other')).status, 'foreign');
  assert.equal(p.read().predicted?.value, 12);
  assert.equal(p.reconcile(baseline(12, 5, '11')).status, 'unavailable');
  assert.equal(p.read().reason, 'baseline-conflict');
});
test('NW03 prediction: future or regressing prefixes invalidate, never iterate remote gaps', () => {
  for (const prefix of [4, 100000000000]) {
    let calls = 0;
    const p = make({ reduce: () => { calls++; return '0'; } });
    assert.equal(p.reconcile(baseline(11, prefix, '0')).status, 'unavailable');
    assert.equal(calls, 0); assert.equal(p.read().reason, 'invalid-prefix');
  }
});
test('NW03 prediction: codec-normalized input is canonical, detached and used once', () => {
  let seen: unknown;
  const p = make({ validateInput: v => !!v && typeof v === 'object', reduce: (_s, input) => { seen = input; return '0'; } });
  const source = { z: -0, amount: Math.round(1.239 * 100) / 100 };
  const pushed = p.push(JSON.stringify(source)); assert.equal(pushed.status, 'predicted');
  if (pushed.status !== 'predicted') throw Error('unreachable');
  assert.equal(pushed.input.json, '{"amount":1.24,"z":0}');
  assert.deepEqual(seen, JSON.parse(pushed.input.json)); assert.ok(Object.isFrozen(seen));
  source.amount = 999;
  assert.equal(p.read().pending[0]?.json, pushed.input.json);
  assert.ok(Object.isFrozen(p.read().pending)); assert.ok(Object.isFrozen(pushed.input));
});
test('NW03 prediction: pending count and bytes clear predictions before an extra reducer call', () => {
  for (const limit of [{ maxPending: 1 }, { maxPendingBytes: 1 }]) {
    let calls = 0;
    const p = make({ limits: { ...defaults.limits, ...limit }, reduce: () => { calls++; return '1'; } });
    p.push('1'); assert.equal(p.push('2').status, 'unavailable'); assert.equal(calls, 1);
    assert.equal(p.read().pendingBytes, 0); assert.equal(p.read().predicted, null);
  }
});
test('NW03 prediction: replay ceiling checks suffix before reducer and no partial publication on thrown step', () => {
  let calls = 0;
  const bounded = make({ limits: { ...defaults.limits, maxReplaySteps: 1 }, reduce: () => { calls++; return '0'; } });
  bounded.push('1'); bounded.push('2'); calls = 0;
  bounded.reconcile(baseline(11, 5, '10')); assert.equal(calls, 0); assert.equal(bounded.read().reason, 'replay-limit');
  let p: Prediction, replay = false;
  p = make({ reduce: (state, input) => {
    if (replay) { assert.equal(p.read().predicted?.value, 3); if (input === 2) throw Error('second-step'); }
    return JSON.stringify(Number(state) + Number(input));
  } });
  p.push('1'); p.push('2'); replay = true;
  assert.equal(p.reconcile(baseline(11, 5, '20')).status, 'unavailable');
  assert.equal(p.read().confirmed?.revision, 10); assert.equal(p.read().predicted, null);
});
test('NW03 prediction: reducer and validator reentry cannot publish after invalidate or disposal', () => {
  for (const phase of ['input', 'reduce', 'output'] as const) {
    for (const retire of ['invalidate', 'dispose'] as const) {
      let p: Prediction, armed = false, reduceCalls = 0;
      const stop = () => { if (armed) p[retire](); return true; };
      p = make({ validateInput: phase === 'input' ? stop : defaults.validateInput,
        validateState: phase === 'output' ? stop : defaults.validateState,
        reduce: (state, input) => { reduceCalls++; if (phase === 'reduce') stop(); return defaults.reduce(state, input); } });
      armed = true;
      assert.equal(p.push('1').status, retire === 'dispose' ? 'retired' : 'unavailable');
      assert.equal(p.read().predicted, null); assert.equal(p.read().pending.length, 0);
      if (phase === 'input') assert.equal(reduceCalls, 0);
      if (retire === 'dispose') assert.equal(p.read().confirmed, null);
    }
  }
});
test('NW03 prediction: recursive push/reconcile are busy; replay disposal retires immediately', () => {
  let p: Prediction, armed = false;
  p = make({ reduce: (state, input) => {
    assert.equal(p.push('7').status, 'busy'); assert.equal(p.reconcile(baseline(12, 5, '8')).status, 'busy');
    if (armed) p.dispose(); return defaults.reduce(state, input);
  } });
  p.push('2'); armed = true;
  assert.equal(p.reconcile(baseline(11, 5, '10')).status, 'retired');
  assert.equal(p.read().confirmed, null); assert.equal(p.read().issuedThrough, 0);
});
test('NW03 prediction: malformed state/input, bounded raw capture and exhausted sequence refuse recovery in place', () => {
  for (const input of ['false', '{', ' '.repeat(257) + '1']) {
    const p = make(); assert.equal(p.push(input).status, 'unavailable');
    assert.equal(p.reconcile(baseline(99, 5, '0')).status, 'unavailable');
  }
  const p = make({ baseline: { revision: 1, processedThrough: Number.MAX_SAFE_INTEGER, stateJson: '0' } });
  assert.equal(p.push('1').status, 'unavailable'); assert.equal(p.read().reason, 'sequence-exhausted');
  assert.throws(() => make({ limits: { ...defaults.limits, maxPending: Infinity } }));
  assert.throws(() => make({ baseline: { revision: -1, processedThrough: 0, stateJson: '0' } }));
});
test('NW03 prediction: scene/control disposal cannot be revived by old baseline, new owner uses trusted floor', () => {
  const old = make(); old.push('2'); old.dispose();
  assert.equal(old.reconcile(baseline(11, 6, '2')).status, 'retired');
  const fresh = make({ epoch: 'control-2', baseline: { revision: 11, processedThrough: 6, stateJson: '2' } });
  assert.equal(fresh.reconcile(baseline(11, 6, '2')).status, 'foreign');
  const next = fresh.push('3'); assert.equal(next.status, 'predicted');
  if (next.status === 'predicted') assert.equal(next.input.sequence, 7);
});
test('NW03 prediction: over-budget replay invokes no creator validator; supplied accessors cannot revive a retired operation', () => {
  let validations = 0;
  const p = make({ limits: { ...defaults.limits, maxReplaySteps: 1 }, validateState: value => { validations++; return typeof value === 'number'; } });
  p.push('1'); p.push('2'); validations = 0;
  p.reconcile(baseline(11, 5, '0')); assert.equal(validations, 0);
  const r = make();
  const frame = { ...baseline(11, 5, '99'), get stateJson() { r.dispose(); return '99'; } };
  assert.equal(r.reconcile(frame).status, 'retired'); assert.equal(r.read().confirmed, null);
});
test('NW03 prediction: reconciliation validator retirement and invalid replay output keep prior confirmed facts only', () => {
  let p: Prediction, retire = false;
  p = make({ validateState: value => { if (retire) p.invalidate('control-replaced'); return typeof value === 'number'; } });
  p.push('1'); retire = true;
  assert.equal(p.reconcile(baseline(11, 5, '9')).status, 'unavailable');
  assert.equal(p.read().confirmed?.revision, 10); assert.equal(p.read().reason, 'control-replaced');
  let invalid = false;
  const q = make({ reduce: (s, i) => invalid ? 'false' : defaults.reduce(s, i) });
  q.push('2'); invalid = true;
  q.reconcile(baseline(11, 5, '8'));
  assert.equal(q.read().status, 'unavailable'); assert.equal(q.read().confirmed?.state.value, 0);
  assert.equal(q.read().predicted, null);
});
