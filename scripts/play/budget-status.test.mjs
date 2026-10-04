// play:snap's budget verdict: a window with no rendered frame is never 'within budget', and an over-budget verdict
// names the metric, the measured value, the limit and the recovery skill. Also the summary lines and evidence paths.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {
  budgetLine,
  budgetStatus,
  budgets,
  evidencePath,
  frameRateLine,
  NOT_MEASURED,
  OUT,
  ROOT,
  viewLine,
} from './lib.mjs';

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

test('play:snap summary: a phone view prints its draws, verdict and measured fps, labelled advisory', () => {
  const moving = {renders: 17, drawsPerFrame: 3, trisPerFrame: 735, fps: 5, frameMsP95: 183.3};
  const line = viewLine('mobile', {moving, budget: {...budgetStatus(scene, moving), window: 'moving'}});
  assert.match(line, /mobile budget \(moving window\): 3 draws, 735 tris per rendered frame · within budget/);
  assert.match(line, /5 fps \(p95 183\.3 ms\), advisory$/);
  assert.equal(frameRateLine({renders: 0}), 'fps not measured');
});

test('play:snap and play:script evidence paths are relative to the repository, as the CLI prints them', () => {
  assert.equal(evidencePath(join(OUT, 'restart', '01-start.png')), 'playtest/latest/restart/01-start.png');
  assert.equal(evidencePath(join(ROOT, 'playtest', 'latest', 'probe.json')), 'playtest/latest/probe.json');
});
