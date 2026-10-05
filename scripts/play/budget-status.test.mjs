// play:snap's budget verdict: a window with no rendered frame is never 'within budget', and an over-budget verdict
// names the metric, the measured value, the limit and the recovery skill. Also the summary lines and evidence paths.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {
  activityLine,
  budgetAt,
  budgetLine,
  budgetStatus,
  budgets,
  countsLine,
  evidencePath,
  frameRateLine,
  hasSettled,
  NOT_MEASURED,
  OUT,
  ROOT,
  SETTLE,
  settle,
  viewLine,
  warmUpLine,
  windowsAgree,
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

// C5 (2026-10-03 acceptance): Calm motion could not be checked in a browser. The snap's still window says what moved.
test('play:snap activity line: renders, picture and particles; with Calm, whether motion and emitters stopped', () => {
  const still = {ms: 1500, renders: 0, pictureChanged: false, particles: {emitters: 2, live: 0, spawned: 0, draws: 0}};
  assert.equal(
    activityLine(still),
    'still 1.5 s with no input: 0 renders, picture unchanged, 2 emitter(s), 0 live, 0 spawned',
  );
  assert.match(activityLine(still, true), /motion stopped, emitters stopped/);
  const busy = {ms: 1500, renders: 40, pictureChanged: true, particles: {emitters: 1, live: 9, spawned: 8, draws: 1}};
  assert.match(activityLine(busy, true), /motion NOT stopped, emitters NOT stopped/);
  // A DOM-only animation (no frame drawn) still counts as motion: the picture changed.
  assert.match(activityLine({...still, pictureChanged: true}, true), /motion NOT stopped, emitters stopped/);
  assert.match(activityLine({...still, particles: null}, true), /no particles · motion stopped, emitters stopped/);
  assert.match(activityLine(still, false), /CALM NOT ON/);
  // Under Calm, attempts go on (the stream is unchanged) but nothing is added: the line counts particles added.
  assert.match(
    activityLine({...still, particles: {...still.particles, calmed: 9}}, true),
    /0 spawned \(9 withheld by Calm\) · motion stopped, emitters stopped/,
  );
});

const win = (drawsPerFrame, trisPerFrame, postDrawsPerFrame = 0, renders = 5) => ({
  renders,
  drawsPerFrame,
  trisPerFrame,
  postDrawsPerFrame,
});

test('play:snap settle: windows agree within the tolerance on draws, post draws and triangles, and only with frames', () => {
  assert.equal(windowsAgree(win(40, 100_000), win(41, 102_000)), true, 'within 5 %');
  assert.equal(windowsAgree(win(40, 1_636_000), win(40, 420_000)), false, 'a warm-up triangle peak');
  assert.equal(windowsAgree(win(60, 1000), win(40, 1000)), false, 'draws differ');
  assert.equal(windowsAgree(win(40, 1000, 10), win(40, 1000, 0)), false, 'post draws differ');
  assert.equal(windowsAgree(win(0, 0, 0, 0), win(0, 0, 0, 0)), false, 'no frames is never settled');
});

test('play:snap settle: settled after stableWindows consecutive agreeing windows, so a warm-up window never counts', () => {
  const warm = win(52, 1_636_000);
  const steady = win(40, 420_000);
  assert.equal(SETTLE.stableWindows, 2);
  assert.equal(hasSettled([warm, steady]), false);
  assert.equal(hasSettled([warm, steady, steady]), false, 'one agreeing pair is not enough');
  assert.equal(hasSettled([warm, steady, steady, steady]), true);
  assert.equal(hasSettled([steady, steady, warm]), false, 'a late spike resets it');
  assert.equal(hasSettled([warm, steady, steady], {stableWindows: 1}), true);
});

test('play:snap settle: the warm-up line names both windows and whether it settled', () => {
  const line = warmUpLine({warmUp: win(52, 1_636_000), steady: win(40, 420_000), settled: true, windows: 4, ms: 2600});
  assert.match(
    line,
    /warm-up \(first 600 ms after open, not judged\): 52 draws, 1,636,000 tris → steady: 40 draws, 420,000 tris/,
  );
  assert.match(line, /settled after 2\.6 s \(4 windows\)/);
  const not = warmUpLine({warmUp: win(1, 1), steady: win(0, 0, 0, 0), settled: false, windows: 13, ms: 8100});
  assert.match(not, /steady: no frames · did not settle within 8\.1 s; the budget is judged on the last frames/);
});

/** A page stand-in for settle(): every engine.redraw() draws one frame; the first `heavy` frames are a warm-up. */
function warmingPage({heavy = 6, warm = [52, 1_636_000], steady = [40, 420_000]} = {}) {
  const c = {draws: 0, tris: 0, renders: 0};
  return {
    async evaluate(js) {
      if (js.includes('engine.redraw()')) {
        const [d, t] = c.renders < heavy ? warm : steady;
        c.draws += d;
        c.tris += t;
        c.renders++;
        return undefined;
      }
      if (js.includes('requestAnimationFrame')) return [16, 16, 17];
      return {draws: c.draws, post: 0, tris: c.tris, loop: {renders: c.renders}, heap: null};
    },
  };
}

test('play:snap settle: a scene that warms up is judged on its settled frames and reports the warm-up apart', async () => {
  const s = await settle(warmingPage(), {windowMs: 5});
  assert.equal(s.settled, true);
  assert.deepEqual([s.warmUp.drawsPerFrame, s.warmUp.trisPerFrame], [52, 1_636_000], 'the first window is the warm-up');
  assert.deepEqual([s.steady.drawsPerFrame, s.steady.trisPerFrame], [40, 420_000]);
  assert.equal(s.windows, 5, 'warm-up, the mixed window, then three alike (two agreeing pairs)');
  const never = await settle(warmingPage({heavy: Infinity, warm: [1, 1]}), {windowMs: 5, maxMs: 0});
  assert.equal(never.windows, 1, 'maxMs bounds the wait');
  assert.equal(never.settled, false);
});
