// The gate's decision rules: two consecutive comparable breaches block; a non-comparable window never blocks and,
// when it stays so, fails as inconclusive (a textureMiB 39.1 -> 52.8 artifact).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBudgets, type BenchResult } from '../../src/platform/perf/budget-check';
import { decide } from './gate-verdict';

const budgets = { hall: { textureMiB: 80 } };
const bindings = [{ sample: 'hall', scene: 'hall', metrics: ['textureMiB' as const] }];
const baseline: BenchResult = { hall: { textureMiB: 39.1 } };
const unknown = { kind: 'unclassified', version: 1, reasons: ['7 upload(s) of unknown provenance'], comparable: false };
const check = (textureMiB: number, comparable = true) =>
  checkBudgets({ hall: { textureMiB, ...(comparable ? {} : { classification: unknown }) } }, budgets, bindings, { tier: 'reference', baseline });

test('non-comparable, then comparable and clean: pass (a known artifact)', () => {
  assert.deepEqual(decide(check(52.8, false), check(39.1)), { verdict: 'pass', confirmed: [], inconclusive: [] });
});

test('non-comparable in both runs: inconclusive, never a regression', () => {
  const d = decide(check(52.8, false), check(52.8, false));
  assert.equal(d.verdict, 'inconclusive');
  assert.deepEqual(d.confirmed, []);
  assert.deepEqual(d.inconclusive, ['hall|textureMiB']);
});

test('one comparable breach after a non-comparable window is not two consecutive breaches: inconclusive', () => {
  assert.equal(decide(check(52.8, false), check(52.8)).verdict, 'inconclusive');
});

test('two comparable breaches block; a single one is a flake', () => {
  assert.deepEqual(decide(check(52.8), check(52.8)), { verdict: 'fail', confirmed: ['hall|textureMiB'], inconclusive: [] });
  assert.equal(decide(check(52.8), check(39.1)).verdict, 'pass');
  assert.equal(decide(check(52.8)).verdict, 'fail', 'no second run possible (--cache-only): the comparable breach stands');
  assert.equal(decide(check(52.8, false)).verdict, 'inconclusive');
});
