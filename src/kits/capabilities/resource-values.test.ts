import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseResourceValue,
  prepareResourceChange,
  type ResourceValue,
  type ResourceChange,
  type ResourcePolicy,
  type ResourceCandidate,
} from './resource-values';
const reject: ResourcePolicy = {overflow: 'reject', rounding: 'reject'};
const clamp: ResourcePolicy = {overflow: 'clamp', rounding: 'reject'};
const discrete = (current = 5, min = 0, max = 10): ResourceValue => ({
  version: 1,
  mode: 'safe-integer',
  min,
  max,
  current,
});
const continuous = (current = 5, min = 0, max = 10): ResourceValue => ({
  version: 1,
  mode: 'continuous',
  min,
  max,
  current,
});
function success(result: ResourceCandidate) {
  if (!result.ok) assert.fail(`expected success, received ${result.reason}`);
  return result;
}
const prepare = (value: ResourceValue, change: ResourceChange, policy = reject) =>
  success(prepareResourceChange(value, change, policy));
const refused = (value: unknown, change: ResourceChange, policy: ResourcePolicy, reason: string) =>
  assert.deepEqual(prepareResourceChange(value, change, policy), {ok: false, reason});

test('strict resource restore captures frozen values without repair or precision conversion', () => {
  const input = {...discrete()},
    parsed = parseResourceValue(input);
  input.current = 9;
  assert.equal(parsed.current, 5);
  assert.ok(Object.isFrozen(parsed));
  const bad: unknown[] = [
    null,
    [],
    {...discrete(), extra: 1},
    {...discrete(), version: 2},
    {...discrete(), mode: 'automatic'},
    {...discrete(), current: 11},
    {...discrete(), current: 1.25},
    {...discrete(), min: 0.25},
    {...discrete(), max: Number.MAX_SAFE_INTEGER + 1},
    {...continuous(), current: Infinity},
    {...continuous(), min: NaN},
    {...continuous(), min: 11},
    {...discrete(), [Symbol('extra')]: true},
  ];
  for (const value of bad) assert.throws(() => parseResourceValue(value), /resource value/);
  const signed = parseResourceValue({...continuous(), min: -0, current: -0});
  assert.equal(Object.is(signed.min, -0), false);
  assert.equal(Object.is(signed.current, -0), false);
  assert.equal(parseResourceValue(continuous(0.25)).current, 0.25);
});

test('set/add candidates distinguish request, rounding, domain clamp and actual accepted delta', () => {
  const input = discrete(),
    result = prepare(input, {kind: 'set', value: 12.8}, {overflow: 'clamp', rounding: 'floor'});
  assert.equal(result.state.current, 10);
  assert.equal(input.current, 5);
  assert.deepEqual(result.calculation, {
    requested: {kind: 'set', value: 12.8},
    policy: {overflow: 'clamp', rounding: 'floor'},
    calculatedTarget: 12.8,
    targetPrecision: 'approximate-number',
    roundedTarget: 12,
    roundedAddend: null,
    acceptedTarget: 10,
    actualDelta: 5,
    clamped: true,
  });
  const added = prepare(input, {kind: 'add', delta: -2.4}, {overflow: 'reject', rounding: 'floor'});
  assert.equal(added.calculation.roundedAddend, -3);
  assert.equal(added.state.current, 2);
  assert.equal(added.calculation.actualDelta, -3);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.state));
  assert.ok(Object.isFrozen(result.calculation));
  assert.ok(Object.isFrozen(result.calculation.requested));
  assert.ok(Object.isFrozen(result.calculation.policy));
  refused(input, {kind: 'set', value: 11}, reject, 'range');
  refused(input, {kind: 'set', value: 10.1}, reject, 'precision');
  assert.equal(prepare(input, {kind: 'set', value: 10.1}, {...reject, rounding: 'floor'}).state.current, 10);
});

test('continuous transitions retain fractional values and honest successful no-ops', () => {
  const result = prepare(continuous(0.2), {kind: 'add', delta: 0.15});
  assert.equal(result.state.current, 0.35);
  assert.equal(result.calculation.roundedAddend, null);
  const unchanged = prepare(continuous(1e308, 0, 1e308), {kind: 'add', delta: 1});
  assert.equal(unchanged.calculation.requested.kind, 'add');
  assert.deepEqual(unchanged.calculation.requested, {kind: 'add', delta: 1});
  assert.equal(unchanged.calculation.actualDelta, 0);
  assert.equal(unchanged.state.current, 1e308);
  refused(continuous(), {kind: 'set', value: 1}, {...reject, rounding: 'floor'}, 'invalid');
});

test('range changes explicitly retain, preserve interval ratio, or refill, including negative ranges', () => {
  const value = continuous(-5, -10, 0);
  assert.equal(prepare(value, {kind: 'bounds', min: -20, max: 0, adjust: 'retain'}).state.current, -5);
  assert.equal(prepare(value, {kind: 'bounds', min: -20, max: 0, adjust: 'ratio'}).state.current, -10);
  assert.equal(prepare(value, {kind: 'bounds', min: -20, max: 0, adjust: 'refill'}).state.current, 0);
  refused(discrete(8), {kind: 'bounds', min: 0, max: 4, adjust: 'retain'}, reject, 'range');
  const retained = prepare(discrete(8), {kind: 'bounds', min: 0, max: 4, adjust: 'retain'}, clamp);
  assert.equal(retained.state.current, 4);
  assert.equal(retained.calculation.actualDelta, -4);
  assert.equal(retained.calculation.clamped, true);
  assert.equal(prepare(discrete(8), {kind: 'bounds', min: 0, max: 20, adjust: 'retain'}).state.current, 8);
});

test('old zero-width ratio refuses while new collapsed intervals remain valid', () => {
  for (const mode of ['continuous', 'safe-integer'] as const) {
    const old = {version: 1 as const, mode, min: 4, max: 4, current: 4};
    refused(old, {kind: 'bounds', min: 7, max: 7, adjust: 'ratio'}, reject, 'zero-width');
    assert.equal(prepare(old, {kind: 'bounds', min: 7, max: 7, adjust: 'refill'}).state.current, 7);
    const collapsed = prepare({...old, min: 0, max: 10, current: 5}, {kind: 'bounds', min: 7, max: 7, adjust: 'ratio'});
    assert.equal(collapsed.state.current, 7);
    assert.equal(collapsed.calculation.actualDelta, 2);
  }
});

test('integer ratio rounds exact rational values with ties toward positive infinity', () => {
  const old = discrete(1, 0, 2),
    change = {kind: 'bounds' as const, min: -3, max: 0, adjust: 'ratio' as const};
  refused(old, change, reject, 'precision');
  for (const [rounding, expected] of [
    ['floor', -2],
    ['ceil', -1],
    ['nearest', -1],
  ] as const) {
    const result = prepare(old, change, {...reject, rounding});
    assert.equal(result.state.current, expected);
    assert.equal(result.calculation.calculatedTarget, -1.5);
    assert.equal(result.calculation.targetPrecision, 'approximate-ratio');
  }
  const tie = prepare(old, {...change, min: -1}, {...reject, rounding: 'nearest'});
  assert.equal(tie.state.current, 0);
  assert.equal(Object.is(tie.state.current, -0), false);
});

test('integer ratios use exact bounded intermediates even when safe endpoints span unsafe Number integers', () => {
  const m = Number.MAX_SAFE_INTEGER,
    old = discrete(0, -m, m);
  assert.equal(parseResourceValue(old).current, 0);
  const change = {kind: 'bounds' as const, min: 0, max: m, adjust: 'ratio' as const};
  assert.equal(prepare(old, change, {...reject, rounding: 'floor'}).state.current, 4503599627370495);
  assert.equal(prepare(old, change, {...reject, rounding: 'ceil'}).state.current, 4503599627370496);
  assert.equal(prepare(old, change, {...reject, rounding: 'nearest'}).state.current, 4503599627370496);
  refused(old, change, reject, 'precision');
  assert.equal(prepare(old, {...change, min: -m}).state.current, 0);
});

test('integer add rounds the argument before arithmetic loses a fractional request', () => {
  const m = Number.MAX_SAFE_INTEGER,
    old = discrete(m, 0, m);
  refused(old, {kind: 'add', delta: 0.1}, reject, 'precision');
  refused(old, {kind: 'add', delta: 0.1}, {...clamp, rounding: 'ceil'}, 'overflow');
  const unchanged = prepare(old, {kind: 'add', delta: 0.1}, {...reject, rounding: 'floor'});
  assert.equal(unchanged.calculation.roundedAddend, 0);
  assert.equal(unchanged.calculation.actualDelta, 0);
  assert.deepEqual(unchanged.calculation.requested, {kind: 'add', delta: 0.1});
  assert.equal(
    prepare(discrete(0, -10, 10), {kind: 'add', delta: -0.5}, {...reject, rounding: 'nearest'}).state.current,
    0,
  );
});

test('nonfinite, unsafe target and exposed-delta arithmetic refuse before domain clamp', () => {
  const m = Number.MAX_SAFE_INTEGER;
  refused(discrete(m, 0, m), {kind: 'add', delta: 1}, clamp, 'overflow');
  refused(discrete(), {kind: 'set', value: m + 1}, clamp, 'overflow');
  refused(discrete(-m, -m, m), {kind: 'set', value: m}, clamp, 'overflow');
  refused(continuous(1e308, 0, 1e308), {kind: 'add', delta: 1e308}, clamp, 'overflow');
  refused(continuous(-1e308, -1e308, 1e308), {kind: 'set', value: 1e308}, clamp, 'overflow');
  const wide = continuous(0, -1e308, 1e308);
  assert.equal(
    prepare(wide, {kind: 'set', value: 1}).state.current,
    1,
    'unused interval width does not invalidate snapshot',
  );
  refused(wide, {kind: 'bounds', min: 0, max: 1, adjust: 'ratio'}, reject, 'overflow');
});

test('invalid definitions and policies return bounded refusals without coercion or repair', () => {
  const changes = [
    null,
    [],
    {kind: 'multiply', value: 2},
    {kind: 'set', value: NaN},
    {kind: 'set', value: 1, extra: 2},
    {
      kind: 'set',
      value: {
        valueOf() {
          throw Error('must not coerce');
        },
      },
    },
    {kind: 'bounds', min: 5, max: 4, adjust: 'retain'},
    {kind: 'bounds', min: 0, max: 10, adjust: 'automatic'},
  ];
  for (const change of changes)
    assert.equal(prepareResourceChange(discrete(), change as ResourceChange, reject).ok, false);
  for (const policy of [
    null,
    {},
    {overflow: 'wrap', rounding: 'reject'},
    {...reject, extra: true},
    {...reject, rounding: 'bankers'},
  ]) {
    refused(discrete(), {kind: 'set', value: 1}, policy as ResourcePolicy, 'invalid');
  }
  const failure = prepareResourceChange({}, {kind: 'set', value: 1}, reject);
  assert.ok(Object.isFrozen(failure));
});

test('capture detaches prior arguments before later getters mutate them and reads kind only once', () => {
  const old = {...discrete()},
    policy = {...reject};
  let reads = 0;
  const change = {
    get kind() {
      reads++;
      return reads === 1 ? 'add' : 'set';
    },
    get delta() {
      old.current = 9;
      return 2;
    },
  };
  const result = success(prepareResourceChange(old, change as ResourceChange, policy));
  assert.equal(result.state.current, 7);
  assert.equal(reads, 1);
  policy.overflow = 'clamp';
  assert.equal(result.calculation.policy.overflow, 'reject');
  const throwing = {
    kind: 'set',
    get value(): number {
      throw Error('bad getter');
    },
  };
  refused(discrete(), throwing as ResourceChange, reject, 'invalid');
  const proxy = new Proxy(
    {},
    {
      ownKeys() {
        throw Error('bad keys');
      },
    },
  );
  refused(proxy, {kind: 'set', value: 1}, reject, 'invalid');
});

test('pure preparation can reenter without publishing either candidate or retaining an owner', () => {
  const old = discrete();
  let nested: ResourceCandidate | undefined;
  const change = {
    kind: 'set' as const,
    get value() {
      nested = prepareResourceChange(old, {kind: 'add', delta: 1}, reject);
      return 8;
    },
  };
  const first = prepare(old, change);
  assert.equal(first.state.current, 8);
  assert.equal(success(nested!).state.current, 6);
  assert.equal(old.current, 5);
  assert.deepEqual(prepare(old, change), first);
});

test('integer ratio rounding uses exact remainder even when the diagnostic Number loses it', () => {
  const m = Number.MAX_SAFE_INTEGER,
    old = discrete(m - 1, 0, m);
  const change = {kind: 'bounds' as const, min: 0, max: m - 1, adjust: 'ratio' as const};
  // (m-1)^2 / m = m-2 + 1/m, so ceil differs from floor despite Number losing 1/m.
  const lower = prepare(old, change, {...reject, rounding: 'floor'});
  const upper = prepare(old, change, {...reject, rounding: 'ceil'});
  assert.equal(lower.state.current, m - 2);
  assert.equal(upper.state.current, m - 1);
  assert.equal(Number.isInteger(lower.calculation.calculatedTarget), true);
  refused(old, change, reject, 'precision');
});
