// play:snap's budget verdict: a window with no rendered frame is never 'within budget', and an over-budget verdict
// names the metric, the measured value, the limit and the recovery skill. Also the summary lines and evidence paths.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {
  budgetAt,
  budgetLine,
  budgetStatus,
  budgets,
  countsLine,
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

test('play:snap budget: postDraws is judged only where a scene budgets it, apart from draws', () => {
  const s = budgetStatus(scene, {renders: 3, drawsPerFrame: 1, postDrawsPerFrame: 10, trisPerFrame: 2});
  assert.deepEqual(
    s.rows.map(r => r.metric),
    ['draws', ...(limit.postDraws === undefined ? [] : ['postDraws']), 'triangles'],
  );
});

// C1 (2026-10-03 acceptance): look-checklist item 9 needs texture memory and shadow work from the snap itself.
test('play:snap budget: textureMiB, shadowPasses and shadowCasters are judged against the row next to draws', () => {
  const m = {renders: 3, drawsPerFrame: 1, trisPerFrame: 2};
  const gpu = {textureMiB: 0.5, shadowPasses: 0, shadowCasters: 0};
  const s = budgetStatus(scene, m, {gpu});
  for (const k of ['shadowCasters', 'shadowPasses', 'textureMiB'])
    if (limit[k] !== undefined)
      assert.ok(
        s.rows.some(r => r.metric === k && r.ok),
        k,
      );
  assert.equal(s.status, 'within budget');
  assert.deepEqual(s.measured, {draws: 1, postDraws: null, triangles: 2, ...gpu});
  const over = budgetStatus(scene, m, {gpu: {textureMiB: limit.textureMiB + 0.1, shadowPasses: 7, shadowCasters: 1}});
  assert.equal(over.status, 'OVER BUDGET');
  const line = budgetLine(over);
  assert.match(line, new RegExp(`textureMiB ${limit.textureMiB + 0.1} > ${limit.textureMiB}`));
  assert.match(line, new RegExp(`shadowPasses 7 > ${limit.shadowPasses}`));
  assert.doesNotMatch(line, /shadowCasters/);
  // Shadow and texture counts never make an unrendered window 'within budget'.
  assert.equal(budgetStatus(scene, {renders: 0}, {gpu}).status, NOT_MEASURED);
});

test('play:snap counts line: every count against its budget, unbudgeted ones labelled', () => {
  const status = {
    rows: [
      {metric: 'draws', measured: 29, budget: 40, ok: true},
      {metric: 'triangles', measured: 19765, budget: 30000, ok: true},
      {metric: 'textureMiB', measured: 49, budget: 48, ok: false},
    ],
    measured: {draws: 29, postDraws: null, triangles: 19765, shadowCasters: 4, shadowPasses: 1, textureMiB: 49},
  };
  assert.equal(
    countsLine(status),
    'draws 29/40 · triangles 19,765/30,000 · shadowCasters 4 (no budget) · shadowPasses 1 (no budget) · textureMiB 49/48 OVER',
  );
});

test('play:snap budget at a lighter preset reads the row ports (as src/core/budget.ts budgetFor)', () => {
  const row = {draws: 46, postDraws: 10, ports: {high: {draws: 40}, medium: {postDraws: 1}, low: {postDraws: 0}}};
  assert.deepEqual(budgetAt(row), {draws: 46, postDraws: 10});
  assert.deepEqual(budgetAt(row, 'high'), {draws: 40, postDraws: 10});
  assert.deepEqual(budgetAt(row, 'medium'), {draws: 40, postDraws: 1});
  assert.deepEqual(budgetAt(row, 'low'), {draws: 40, postDraws: 0});
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
