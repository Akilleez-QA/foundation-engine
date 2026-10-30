import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRng, createSaveableRng} from '../../core/rng';
import {
  applyStacking,
  compileExpression,
  createDamageModel,
  defineFormulaSheet,
  defineStacking,
  evaluateExpression,
  evaluateSheet,
  FormulaError,
  formulaPresets,
  parseFormula,
} from './index';

const ev = (expr: unknown, s: (name: string) => number, random?: () => number) =>
  evaluateExpression(compileExpression(expr), s, random);
const scope = (values: Record<string, number>) => (name: string) => {
  const v = values[name];
  if (v === undefined) throw new Error(name);
  return v;
};

test('text and JSON forms compile to the same data and evaluate with precedence', () => {
  const parsed = parseFormula('a + b * c ^ 2 // 3 - -d');
  assert.deepEqual(parsed, ['sub', ['add', 'a', ['idiv', ['mul', 'b', ['pow', 'c', 2]], 3]], ['neg', 'd']]);
  const value = evaluateExpression(compileExpression(parsed), scope({a: 1, b: 2, c: 3, d: 4}));
  assert.equal(value, 1 + Math.trunc((2 * 9) / 3) + 4);
  assert.deepEqual(parseFormula('max(1, x) >= 2 && !y || z'), [
    'or',
    ['and', ['ge', ['max', 1, 'x'], 2], ['not', 'y']],
    'z',
  ]);
  assert.equal(ev(parseFormula('-7 // 2'), scope({})), -3, 'idiv truncates toward zero');
  assert.equal(ev(parseFormula('-7 % 3'), scope({})), -1, 'mod keeps the dividend sign');
  assert.equal(ev(parseFormula('round(-2.5)'), scope({})), -3, 'round is half away from zero');
  assert.equal(ev(parseFormula('clamp(9, 0, 5)'), scope({})), 5);
});

test('compile refuses unknown operators, bad arity, limits and non-data input', () => {
  assert.throws(() => compileExpression(['explode', 1]), FormulaError);
  assert.throws(() => compileExpression(['sub', 1]), /sub takes/);
  assert.throws(() => compileExpression(Number.NaN), /finite/);
  assert.throws(() => compileExpression('max'), /invalid variable/);
  assert.throws(() => compileExpression('1bad'), /invalid variable/);
  let deep: unknown = 1;
  for (let i = 0; i < 40; i++) deep = ['neg', deep];
  assert.throws(() => compileExpression(deep), /depth/);
  assert.throws(() => compileExpression(['add', 1, 2, 3], {maxNodes: 3, maxDepth: 8}), /node limit/);
  const sparse = ['add', 1];
  sparse.length = 3;
  assert.throws(() => compileExpression(sparse), /dense/);
  const accessor = ['add', 1, 2];
  Object.defineProperty(accessor, 1, {get: () => 5});
  assert.throws(() => compileExpression(accessor), /array data/);
  assert.throws(() => parseFormula('a < b < c'), /chained/);
  assert.throws(() => parseFormula('a +'), /end/);
  assert.throws(() => parseFormula('boom(1)'), /unknown function/);
  assert.throws(() => parseFormula('x'.repeat(10), 5), /too long/);
});

test('evaluation refuses non-finite and undefined arithmetic', () => {
  const run = (text: string, values: Record<string, number> = {}) => ev(parseFormula(text), scope(values));
  assert.throws(() => run('1 / 0'), /division by zero/);
  assert.throws(() => run('1 // 0'), /division by zero/);
  assert.throws(() => run('1 % 0'), /modulo/);
  assert.throws(() => run('sqrt(-1)'), /negative/);
  assert.throws(() => run('log(0)'), /non-positive/);
  assert.throws(() => run('(-8) ^ 0.5'), /negative/);
  assert.throws(() => run('x * x', {x: 1e200}), /non-finite/);
  assert.throws(() => run('clamp(1, 5, 0)'), /lower bound/);
  assert.throws(() => run('roll(6)'), /random source/);
  assert.throws(() => ev(['roll', 6], scope({}), () => 1), /\[0, 1\)/);
  assert.throws(() => ev(['roll', 1.5], scope({}), () => 0), /integer side/);
});

test('sheets validate names and order, and evaluate deterministically with a seeded stream', () => {
  assert.throws(() => defineFormulaSheet({inputs: ['a'], steps: [{id: 'b', expr: 'c'}]}), /unknown or later/);
  assert.throws(
    () =>
      defineFormulaSheet({
        inputs: ['a'],
        steps: [
          {id: 'b', expr: 'later'},
          {id: 'later', expr: 1},
        ],
      }),
    /unknown or later/,
  );
  assert.throws(() => defineFormulaSheet({inputs: ['a', 'a'], steps: [{id: 'b', expr: 1}]}), /duplicate/);
  assert.throws(() => defineFormulaSheet({inputs: ['a'], steps: [{id: 'a', expr: 1}]}), /duplicate/);
  assert.throws(() => defineFormulaSheet({inputs: ['a'], steps: [{id: 'b', expr: 'b'}]}), /unknown or later/);
  const sheet = defineFormulaSheet({
    inputs: ['attack', 'critRate'],
    constants: {critMultiplier: 2},
    steps: [
      {id: 'crit', expr: {text: 'chance(critRate)'}},
      {id: 'spread', expr: {text: '90 + roll(21)'}},
      {id: 'amount', expr: {text: 'attack * spread / 100 * if(crit, critMultiplier, 1)'}},
    ],
  });
  assert.equal(sheet.maxDraws, 2);
  assert.throws(() => evaluateSheet(sheet, {attack: 10}), /exactly/);
  assert.throws(() => evaluateSheet(sheet, {attack: 10, critRate: Number.NaN}), /finite/);
  const runs = (seed: number) => {
    const rng = createRng(seed);
    return Array.from({length: 50}, () => evaluateSheet(sheet, {attack: 40, critRate: 0.25}, {random: rng.next}).value);
  };
  assert.deepEqual(runs(7), runs(7));
  assert.notDeepEqual(runs(7), runs(8));
  const traced = evaluateSheet(sheet, {attack: 40, critRate: 1}, {random: () => 0.5, trace: true});
  assert.deepEqual(traced.trace, [
    {id: 'crit', value: 1, draws: 1},
    {id: 'spread', value: 100, draws: 1},
    {id: 'amount', value: 80, draws: 0},
  ]);
  assert.equal(traced.draws, 2);
  assert.ok(Object.isFrozen(traced.values));
});

test('a saved random stream reproduces the same results after restore', () => {
  const sheet = defineFormulaSheet(formulaPresets.collectibleRpg);
  const inputs = {level: 30, power: 80, attack: 70, defense: 55, critRate: 0.1, bonus: 1.5};
  const rng = createSaveableRng(11);
  for (let i = 0; i < 5; i++) evaluateSheet(sheet, inputs, {random: rng.next});
  const saved = rng.state();
  const first = Array.from({length: 20}, () => evaluateSheet(sheet, inputs, {random: rng.next}).value);
  rng.restore(saved);
  const again = Array.from({length: 20}, () => evaluateSheet(sheet, inputs, {random: rng.next}).value);
  assert.deepEqual(again, first);
});

test('stacking stages apply in declared order with their combine rules and bounds', () => {
  const stacking = defineStacking([
    {id: 'flat', apply: 'add', combine: 'sum'},
    {id: 'empower', apply: 'multiply', combine: 'max'},
    {id: 'surge', apply: 'multiply', combine: 'sum', max: 0.5},
    {id: 'resist', apply: 'multiply', combine: 'product', min: -0.9},
  ]);
  const result = applyStacking(stacking, 100, [
    {stage: 'surge', value: 0.3, source: 'b'},
    {stage: 'flat', value: 20, source: 'ring'},
    {stage: 'empower', value: 0.25, source: 'banner'},
    {stage: 'empower', value: 0.1, source: 'song'},
    {stage: 'surge', value: 0.3, source: 'a'},
    {stage: 'resist', value: -0.5, source: 'shield'},
    {stage: 'resist', value: -0.5, source: 'ward'},
  ]);
  // (100 + 20) × 1.25 × (1 + min(0.6, 0.5)) × (1 + max(0.25 − 1, −0.9))
  assert.equal(result.value, 120 * 1.25 * 1.5 * 0.25);
  assert.deepEqual(
    result.stages.map(s => [s.id, s.count, s.term]),
    [
      ['flat', 1, 20],
      ['empower', 2, 0.25],
      ['surge', 2, 0.5],
      ['resist', 2, -0.75],
    ],
  );
  const shuffled = applyStacking(stacking, 100, [
    {stage: 'surge', value: 0.1, source: 'z'},
    {stage: 'surge', value: 0.2, source: 'a'},
  ]);
  const ordered = applyStacking(stacking, 100, [
    {stage: 'surge', value: 0.2, source: 'a'},
    {stage: 'surge', value: 0.1, source: 'z'},
  ]);
  assert.equal(shuffled.value, ordered.value, 'contribution order does not change the result');
  assert.throws(() => applyStacking(stacking, 1, [{stage: 'nope', value: 1, source: 'x'}]), /unknown stage/);
  assert.throws(() => defineStacking([{id: 'x', apply: 'add', combine: 'product'}]), /product needs multiply/);
  assert.throws(
    () =>
      applyStacking(defineStacking([], 1), 1, [
        {stage: 'x', value: 1, source: 'a'},
        {stage: 'x', value: 1, source: 'b'},
      ]),
    /more than 1/,
  );
  const negative = applyStacking(defineStacking([{id: 'm', apply: 'multiply', combine: 'sum'}]), 10, [
    {stage: 'm', value: -3, source: 'curse'},
  ]);
  assert.equal(negative.value, 0, 'a multiply factor never goes below zero');
});

test('damage model: miss, critical, stacking, resistance, immunity, rounding and floor', () => {
  const sheet = defineFormulaSheet({
    inputs: ['attack', 'defense', 'accuracy', 'critRate'],
    steps: [
      {id: 'hit', expr: {text: 'chance(accuracy)'}},
      {id: 'crit', expr: {text: 'chance(critRate)'}},
      {id: 'amount', expr: {text: 'max(0, attack - defense) * if(crit, 2, 1)'}},
    ],
  });
  const model = createDamageModel({
    sheet,
    hitStep: 'hit',
    criticalStep: 'crit',
    stacking: defineStacking([{id: 'buff', apply: 'multiply', combine: 'max'}]),
    resistance: {min: -1, max: 0.8},
    rounding: 'floor',
    minimum: 1,
  });
  const inputs = {attack: 30, defense: 10, accuracy: 0.5, critRate: 0.5};
  assert.equal(model.resolve({inputs}, () => 0.9).kind, 'miss');
  const crit = model.resolve(
    {inputs, contributions: [{stage: 'buff', value: 0.5, source: 'x'}], resistance: 0.25},
    () => 0.1,
  );
  assert.equal(crit.kind, 'hit');
  assert.equal(crit.critical, true);
  assert.equal(crit.amount, Math.floor(40 * 1.5 * 0.75));
  assert.equal(
    model.resolve({inputs, resistance: 0.95}, () => 0.1).amount,
    Math.floor(40 * (1 - 0.8)),
    'resistance capped',
  );
  assert.equal(model.resolve({inputs, resistance: 1}, () => 0.1).kind, 'immune');
  assert.equal(model.resolve({inputs, resistance: -0.5}, () => 0.1).amount, 60, 'weakness amplifies');
  assert.equal(model.resolve({inputs: {...inputs, attack: 10}}, () => 0.1).amount, 1, 'landed hits deal the minimum');
  assert.throws(() => createDamageModel({sheet, hitStep: 'nothing'}), /not a sheet step/);
});

// Independent transliteration of the named preset's documented arithmetic, used as the reference.
function referenceJade(c: Record<string, number>): number {
  const neg = c.modifier! < 0;
  const accuracy = c.magic ? 100 - (neg ? 1 : 0) : c.accuracy! - (neg ? 1 : c.evasion!);
  if (c.hitRoll! % 100 > accuracy && !c.sleep) return 0;
  const ratio = Math.trunc((100 * c.attack!) / (neg ? 1 : Math.max(c.defense!, 1)));
  let value = (((c.attack! * (c.level! + 3) * Math.sqrt(ratio)) / 10) * c.power!) / 100 / 20;
  if (!c.magic && c.critRoll! % 100 < c.critical! - c.antiCritical!) value = value * 7 * 0.25;
  if (c.element! < 4) value *= Math.sqrt(Math.sqrt(1250 * c.affinity!)) / 10;
  value *= c.modifier!;
  value *= 1 / 32;
  const amount = Math.trunc(value);
  return amount === 0 ? 1 : amount + (c.parity! & 1);
}

test('named preset reproduces its documented arithmetic across many inputs', () => {
  const sheet = defineFormulaSheet(formulaPresets.jadeCocoonDamage);
  const model = createDamageModel({sheet, hitStep: 'hit', criticalStep: 'crit', minimum: -Number.MAX_VALUE});
  const rng = createRng('jade-reference');
  for (let i = 0; i < 2000; i++) {
    const c = {
      attack: rng.int(1, 999),
      defense: rng.int(0, 999),
      level: rng.int(1, 99),
      power: rng.int(1, 200),
      accuracy: rng.int(0, 120),
      evasion: rng.int(0, 60),
      critical: rng.int(0, 60),
      antiCritical: rng.int(0, 30),
      parity: rng.int(0, 1000),
      element: rng.int(0, 5),
      affinity: rng.int(0, 200),
      modifier: rng.int(-8, 64),
      magic: rng.int(0, 1),
      sleep: rng.int(0, 1),
      hitRoll: rng.int(0, 32767),
      critRoll: rng.int(0, 32767),
    };
    const expected = referenceJade(c);
    const result = model.resolve({inputs: c});
    if (result.kind === 'miss') assert.equal(expected, 0, `case ${i}`);
    else assert.equal(result.amount, expected, `case ${i}`);
  }
});

test('every preset compiles and evaluates to a finite amount', () => {
  for (const [name, preset] of Object.entries(formulaPresets)) {
    const sheet = defineFormulaSheet(preset);
    const inputs = Object.fromEntries(sheet.inputs.map(n => [n, n === 'critRate' ? 0.1 : 5]));
    const result = evaluateSheet(sheet, inputs, {random: createRng(name).next});
    assert.ok(Number.isFinite(result.value), name);
  }
});

test('review hardening: long chains, reserved names, unbranded data, zero sign, frozen presets', () => {
  const terms = Array.from({length: 200}, (_, i) => `a${i}`);
  const chain = parseFormula(terms.join(' + '));
  const compiled = compileExpression(chain);
  assert.ok(compiled.nodes < 210, 'same-operator runs are flattened');
  const values = Object.fromEntries(terms.map((t, i) => [t, i]));
  assert.equal(evaluateExpression(compiled, scope(values)), (199 * 200) / 2);
  assert.deepEqual(parseFormula('(a + b) + c'), ['add', ['add', 'a', 'b'], 'c'], 'groups are kept');
  assert.throws(() => compileExpression('__proto__'), /invalid variable/);
  assert.throws(() => compileExpression('a.constructor'), /invalid variable/);
  assert.throws(() => compileExpression('a..b'), /invalid variable/);
  assert.throws(
    () => defineFormulaSheet(JSON.parse('{"inputs":[],"constants":{"__proto__":5},"steps":[{"id":"x","expr":1}]}')),
    /invalid constant/,
  );
  assert.throws(() => parseFormula('1e-400'), /underflows/);
  assert.throws(() => evaluateExpression({expr: ['min'], variables: [], maxDraws: 0, nodes: 1}, scope({})), /compiled/);
  const sheet = defineFormulaSheet({inputs: ['x'], steps: [{id: 'y', expr: 'x'}]});
  assert.throws(() => evaluateSheet({...sheet}, {x: 1}), /defineFormulaSheet/);
  assert.throws(() => applyStacking({stages: [], maxContributions: 1e9}, 1, []), /defineStacking/);
  assert.throws(() => evaluateExpression(compileExpression('x'), () => Number.NaN), /finite/);
  for (const text of ['-1 * 0', 'trunc(-0.5)', 'round(-0.4)', '-1 // 2', '-4 % 2', 'ceil(-0.5)'])
    assert.ok(Object.is(ev(parseFormula(text), scope({})), 0), `${text} is +0`);
  assert.throws(() => {
    (formulaPresets.arcadeSubtract.constants as {minimum: number}).minimum = 99;
  }, TypeError);
  const rpg = createDamageModel({sheet: defineFormulaSheet(formulaPresets.collectibleRpg)});
  const immune = rpg.resolve(
    {inputs: {level: 50, power: 90, attack: 80, defense: 60, critRate: 0, bonus: 0}},
    createRng('x').next,
  );
  assert.equal(immune.amount, 0, 'a zero bonus stays zero');
});

test('review hardening: same-source stacking order, immunity first, immuneAt bounds', () => {
  const stacking = defineStacking([{id: 's', apply: 'add', combine: 'sum'}]);
  const rows = [0.1, 0.2, 0.3].map(value => ({stage: 's', value, source: 'a'}));
  const forward = applyStacking(stacking, 0, rows).value;
  const backward = applyStacking(stacking, 0, [...rows].reverse()).value;
  assert.ok(Object.is(forward, backward));
  const huge = defineStacking([{id: 'm', apply: 'multiply', combine: 'product'}]);
  const sheet = defineFormulaSheet({inputs: ['x'], steps: [{id: 'amount', expr: 'x'}]});
  const model = createDamageModel({sheet, stacking: huge});
  const many = Array.from({length: 200}, (_, i) => ({stage: 'm', value: 1e10, source: `s${i}`}));
  assert.equal(model.resolve({inputs: {x: 1}, contributions: many, resistance: 1}).kind, 'immune');
  assert.throws(() => model.resolve({inputs: {x: 1}, contributions: many}), /overflowed/);
  assert.throws(() => createDamageModel({sheet, resistance: {min: -1, immuneAt: -2}}), /immuneAt/);
  assert.throws(() => defineStacking([{id: 'x', apply: 'add', combine: 'sum', extra: 1} as never]), /unexpected field/);
});
