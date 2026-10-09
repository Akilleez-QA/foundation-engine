import test from 'node:test';
import assert from 'node:assert/strict';
import {createSystemRunner} from './systems';

test('runner numeric admission refuses invalid options and preserves zero-step budgets', () => {
  for (const step of [0, -1, NaN, Infinity, -Infinity])
    assert.throws(() => createSystemRunner([], {step}), /finite and positive/);
  for (const maxSteps of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => createSystemRunner([], {maxSteps}), /nonnegative safe integer/);
  const runner = createSystemRunner([{id: 'never', run: () => assert.fail('zero budget ran fixed work')}], {
    step: 0.25,
    maxSteps: 0,
  });
  assert.equal(runner.frame({}, 0.875), 0);
  assert.deepEqual(runner.stats, {frames: 1, steps: 0, dropped: 3, errors: 0});
  assert.equal(runner.alpha, 0.5);
});

test('runner numeric refusal preserves partial phase, counters and every callback for later recovery', () => {
  const calls: number[] = [];
  let hooks = 0;
  const runner = createSystemRunner([{id: 'frame', phase: 'frame', run: (_ctx, dt) => calls.push(dt)}], {
    step: 0.25,
    beforeStep: () => hooks++,
    beforeFrameLane: () => hooks++,
    after: () => hooks++,
  });
  runner.frame({}, 0.125);
  const previous = {...runner.stats};
  for (const dt of [NaN, Infinity, -Infinity]) {
    assert.throws(() => runner.frame({}, dt), /finite/);
    assert.deepEqual(runner.stats, previous);
    assert.equal(runner.alpha, 0.5);
    assert.deepEqual(calls, [0.125]);
    assert.equal(hooks, 2);
  }
  assert.equal(runner.frame({}, -0.25), 0, 'finite negative time still adds no fixed time');
  assert.equal(runner.alpha, 0.5);
  assert.equal(calls.at(-1), -0.25, 'presentation keeps the original finite delta');
  assert.equal(runner.frame({}, 0.125), 1);
  assert.equal(runner.alpha, 0);
});

test('runner keeps ordinary 30/60/144 Hz partitions at sixty ticks without negative phase', () => {
  for (const hz of [30, 60, 144]) {
    let ticks = 0;
    const runner = createSystemRunner([{id: 'tick', run: () => ticks++}]);
    for (let i = 0; i < hz; i++) {
      runner.frame({}, 1 / hz);
      assert.ok(runner.alpha >= 0 && runner.alpha < 1);
    }
    assert.equal(ticks, 60, `${hz} Hz`);
    assert.equal(runner.stats.dropped, 0);
    assert.ok(runner.alpha < 1e-12);
  }
});

test('runner tiny and subnormal steps do not invent elapsed time', () => {
  for (const step of [1e-9, 1e-10, Number.MIN_VALUE, Number.MIN_VALUE * 3]) {
    let ticks = 0;
    const runner = createSystemRunner([{id: 'tick', run: () => ticks++}], {step});
    assert.equal(runner.frame({}, 0), 0);
    assert.equal(runner.alpha, 0);
    assert.equal(ticks, 0);
    if (step / 2 > 0) {
      const partial = step === Number.MIN_VALUE * 3 ? Number.MIN_VALUE : step / 2;
      assert.equal(runner.frame({}, partial), 0);
      assert.ok(runner.alpha > 0 && runner.alpha < 1);
      assert.equal(runner.frame({}, step - partial), 1);
    } else assert.equal(runner.frame({}, step), 1);
    assert.equal(runner.frame({}, step * 3), 3);
    assert.equal(runner.frame({}, 0), 0);
    assert.equal(runner.alpha, 0);
    assert.equal(ticks, 4);
    assert.equal(runner.stats.dropped, 0);
  }
});

test('runner refuses unrepresentable frame counts and cumulative overflow before work', () => {
  for (const step of [Number.MIN_VALUE, 1 / (Number.MAX_SAFE_INTEGER + 1)]) {
    let calls = 0;
    const runner = createSystemRunner([{id: 'frame', phase: 'frame', run: () => calls++}], {step, maxSteps: 0});
    assert.throws(() => runner.frame({}, 1), /safe numeric accounting/);
    assert.deepEqual(runner.stats, {frames: 0, steps: 0, dropped: 0, errors: 0});
    assert.equal(runner.alpha, 0);
    assert.equal(calls, 0);
    assert.equal(runner.frame({}, step), 0);
    assert.equal(runner.stats.dropped, 1);
  }
  let frames = 0;
  const runner = createSystemRunner([{id: 'frame', phase: 'frame', run: () => frames++}], {
    step: 1 / (Number.MAX_SAFE_INTEGER - 1),
    maxSteps: 0,
  });
  runner.frame({}, 1);
  const saved = {...runner.stats};
  assert.ok(Number.isSafeInteger(saved.dropped));
  assert.throws(() => runner.frame({}, 1), /counters/);
  assert.deepEqual(runner.stats, saved);
  assert.equal(frames, 1);
  runner.frame({}, 0);
  assert.equal(frames, 2);
});

test('runner clamps oversized finite fixed time while presentation receives the original delta', () => {
  const observed: number[] = [];
  const runner = createSystemRunner([{id: 'frame', phase: 'frame', run: (_ctx, dt) => observed.push(dt)}], {
    step: 0.125,
    maxSteps: 3,
  });
  assert.equal(runner.frame({}, Number.MAX_VALUE), 3);
  assert.deepEqual(runner.stats, {frames: 1, steps: 3, dropped: 5, errors: 0});
  assert.equal(runner.alpha, 0);
  assert.deepEqual(observed, [Number.MAX_VALUE]);
});
