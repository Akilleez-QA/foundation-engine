// play:snap's budget verdict: a window with no rendered frame is never 'within budget', and an over-budget verdict
// names the metric, the measured value, the limit and the recovery skill.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {budgetLine, budgetStatus, budgets, NOT_MEASURED} from './lib.mjs';

const scene = Object.keys(budgets().scenes)[0];
const limit = budgets().scenes[scene].budget;

test('play:snap budget: a window with no rendered frame is not measured, not within budget', () => {
  const s = budgetStatus(scene, {renders: 0, drawsPerFrame: 0, trisPerFrame: 0});
  assert.equal(s.status, NOT_MEASURED);
  assert.deepEqual(s.rows, []);
  assert.doesNotMatch(budgetLine(s), /within budget/);
});

test('play:snap budget: rendered frames under the limits are within budget', () => {
  assert.equal(budgetStatus(scene, {renders: 3, drawsPerFrame: 1, trisPerFrame: 2}).status, 'within budget');
});

test('play:snap budget: OVER BUDGET names each metric over its limit and points at the fix-budget skill', () => {
  const s = budgetStatus(scene, {renders: 3, drawsPerFrame: limit.draws + 1, trisPerFrame: 2});
  assert.equal(s.status, 'OVER BUDGET');
  const line = budgetLine(s);
  assert.match(line, new RegExp(`draws ${limit.draws + 1} > ${limit.draws}`));
  assert.doesNotMatch(line, /triangles/, 'a metric within its limit is not named');
  assert.match(line, /\.claude\/skills\/fix-budget\/SKILL\.md/);
});
