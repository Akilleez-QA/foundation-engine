// Unit tests of the budget checker. The tests over the game's own budgets (perf/budgets.ts) are in
// scripts/perf/budget-check.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { benchResultOf, checkBudgets, deriveBudget, formatReport, readMetric, toCheckBudget, worstOf, type BenchResult, type CheckBudget, type SampleBinding } from './budget-check';
import type { SceneBudget } from '../../core/budget';
import type { PerfRun } from './perf-run';

const bindings: SampleBinding[] = [
  { sample: 'hall', scene: 'hall', metrics: ['draws', 'triangles', 'shadowCasters', 'shadowDrawsIdle', 'textureMiB', 'heapMiB', 'frameMs'] },
  { sample: 'home', scene: 'home', metrics: ['idleRenderRatio'] },
  { sample: 'startup', scene: 'app', metrics: ['firstLoadJsKiB'] },
];
const budgets: Record<string, CheckBudget> = {
  hall: { draws: 400, triangles: 1_000_000, shadowCasters: { reference: 300, high: 300, medium: 150, low: 0 }, shadowDrawsIdle: 0, textureMiB: 160, heapMiB: 60, frameMs: 16.7 },
  home: { idleRenderRatio: 0.1 },
  app: { firstLoadJsKiB: 2112 },
};

test('passes, warns inside tolerance, fails beyond it, and reports deltas', () => {
  const run: BenchResult = {
    hall: { drawsPerRenderedFrame: 829, trisPerRenderedFrame: 1_780_000, shadowPassDrawsMax: 305, offscreenDrawsPerRenderedFrame: 257, textureMiB: 150, heapMB: 61, taskMsPerFrame: 90 },
    'home': { drawsPerRenderedFrame: 0, renderedFrameRatio: 1 },
    startup: { jsKB: 2053 },
  };
  const r = checkBudgets(run, budgets, bindings, { tier: 'reference' });
  const row = (m: string) => r.rows.find(x => x.metric === m)!;
  assert.equal(row('draws').verdict, 'fail');
  assert.equal(row('draws').delta, 429);
  assert.equal(row('draws').deltaPct, 107.25);
  assert.equal(row('shadowCasters').verdict, 'warn', '305 vs 300 is inside 3%/2 tolerance');
  assert.equal(row('shadowDrawsIdle').verdict, 'fail', 'a still scene must not redraw its shadow map');
  assert.equal(row('textureMiB').verdict, 'pass');
  assert.equal(row('heapMiB').verdict, 'warn');
  assert.equal(row('frameMs').verdict, 'advisory', 'software-GL timings never block');
  assert.equal(row('idleRenderRatio').verdict, 'pass', 'a still scene issuing 0 draws counts as ratio 0');
  assert.equal(row('firstLoadJsKiB').verdict, 'pass');
  assert.equal(r.ok, false);
  assert.equal(r.failures, 3); // draws, triangles, shadowDrawsIdle
});

test('tiers pick their own limit; unported tiers inherit the reference budget', () => {
  const run: BenchResult = { hall: { shadowPassDrawsMax: 120 } };
  assert.equal(checkBudgets(run, budgets, bindings, { tier: 'low' }).rows.find(x => x.metric === 'shadowCasters')!.verdict, 'fail');
  assert.equal(checkBudgets(run, budgets, bindings, { tier: 'medium' }).rows.find(x => x.metric === 'shadowCasters')!.verdict, 'pass');
  const scene: SceneBudget = { draws: 300, triangles: 1e6, shadowCasters: 200, shadowDrawsIdle: 0, idleRenderRatio: 0.1, textureMiB: 100, canvasMiB: 50,
    heapMiB: 60, contexts: 2, frameMs: 16.7, loadMs: 1500, loadMiB: 5, chunkKiB: 140,
    ports: { low: { draws: 150 } }, provenance: { measured: 'test', run: 'none' } };
  const flat = toCheckBudget(scene);
  assert.deepEqual(flat.draws, { reference: 300, high: 300, medium: 300, low: 150 });
  assert.equal(flat.frameMs, 16.7, 'an unported metric stays one number');
  assert.equal(toCheckBudget({ draws: 10 }).triangles, undefined, 'a missing (UNMEASURED) field is skipped');
});

test('a regression against the baseline blocks even under budget; timings only on the reference GPU', () => {
  const base: BenchResult = { hall: { drawsPerRenderedFrame: 200, textureMiB: 100, taskMsPerFrame: 10 } };
  const run: BenchResult = { hall: { drawsPerRenderedFrame: 240, textureMiB: 102, taskMsPerFrame: 30 } };
  const r = checkBudgets(run, budgets, bindings, { tier: 'reference', baseline: base });
  const draws = r.rows.find(x => x.metric === 'draws')!;
  assert.equal(draws.verdict, 'pass');
  assert.deepEqual(draws.regression, { delta: 40, deltaPct: 20, blocking: true });
  assert.equal(r.rows.find(x => x.metric === 'textureMiB')!.regression!.blocking, false);
  assert.equal(r.rows.find(x => x.metric === 'frameMs')!.regression!.blocking, false);
  const hw = checkBudgets(run, budgets, bindings, { tier: 'reference', baseline: base, realHardware: true });
  assert.equal(hw.rows.find(x => x.metric === 'frameMs')!.regression!.blocking, true);
  assert.equal(r.ok, false);
  assert.match(formatReport(r), /BLOCKING/);
});

test('a missing or errored sample fails rather than passing silently, and says why', () => {
  const r = checkBudgets({ hall: { error: 'left the scene during the window' } }, budgets, bindings, { tier: 'reference' });
  assert.ok(r.rows.filter(x => x.scene === 'hall').every(x => x.verdict === 'missing'));
  assert.match(formatReport(r), /left the scene/);
  assert.equal(r.ok, false);
});

test('deriveBudget rounds measured values up with headroom; worstOf merges windows', () => {
  const b = deriveBudget({ drawsPerRenderedFrame: 343, trisPerRenderedFrame: 105_236, textureMiB: 184.4, heapMB: 20.4, liveContexts: 2 }, ['draws', 'triangles', 'textureMiB', 'heapMiB', 'contexts']);
  assert.deepEqual(b, { draws: 380, triangles: 120000, textureMiB: 208, heapMiB: 25, contexts: 2 });
  assert.equal(readMetric({ drawsPerFrame: 7 }, 'draws'), 7);
  assert.deepEqual(worstOf([{ drawsPerRenderedFrame: 10, heapMB: 5 }, { drawsPerRenderedFrame: 12 }]), { drawsPerRenderedFrame: 12, heapMB: 5 });
});

test('benchResultOf keys a PerfRun by sample id', () => {
  const run: PerfRun = { schema: 1, sha: 'x', dirty: false, harness: 'swiftshader', viewport: { width: 1280, height: 800, dpr: 1 }, gpu: 'sw', browser: 'c', when: 't',
    loadAverage: 1, descriptor: 'd', startup: { appReadyMs: 1, transferredMB: 1, jsKB: 1, heapMB: 1, textureMiB: 1, canvasMiB: 1, liveContexts: 1 },
    samples: [{ id: 'hall', scene: 'hall', mode: 'idle', drawsPerRenderedFrame: 5 }, { id: 'workshop:active', scene: 'workshop', mode: 'active', error: 'e' }], afterTour: null, chunks: {} };
  const r = benchResultOf(run);
  assert.equal((r.hall as { drawsPerRenderedFrame: number }).drawsPerRenderedFrame, 5);
  assert.equal((r['workshop:active'] as { error: string }).error, 'e');
  assert.equal((r.startup as { jsKB: number }).jsKB, 1);
});

const unknown = { kind: 'unclassified', version: 1, reasons: ['3 upload(s) of unknown provenance'], comparable: false };
test('a non-comparable window never fails or regresses: it is inconclusive, and the report is not a pass', () => {
  const base: BenchResult = { hall: { drawsPerRenderedFrame: 200 } };
  const drawsOnly: SampleBinding[] = [{ sample: 'hall', scene: 'hall', metrics: ['draws'] }];
  const r = checkBudgets({ hall: { drawsPerRenderedFrame: 460, classification: unknown } }, budgets, drawsOnly, { tier: 'reference', baseline: base });
  const row = r.rows.find(x => x.metric === 'draws')!;
  assert.equal(row.verdict, 'inconclusive');
  assert.equal(row.regression?.blocking, false);
  assert.match(row.reason!, /unclassified: 3 upload/);
  assert.equal(r.failures, 0);
  assert.equal(r.regressions, 0);
  assert.equal(r.inconclusive, 1);
  assert.equal(r.ok, false);
  assert.match(formatReport(r), /INCONCLUSIVE · .* 0 regressions · 1 inconclusive/);
  const passing = checkBudgets({ hall: { drawsPerRenderedFrame: 210, classification: unknown } }, budgets, drawsOnly, { tier: 'reference', baseline: base });
  assert.equal(passing.rows.find(x => x.metric === 'draws')!.verdict, 'pass', 'a non-comparable window that passes is not held against the run');
});

test('a non-comparable baseline window is never compared (the workshop 222 -> 246 artifact)', () => {
  const base: BenchResult = { hall: { drawsPerRenderedFrame: 222, classification: unknown } };
  const r = checkBudgets({ hall: { drawsPerRenderedFrame: 246 } }, { hall: { draws: 250 } }, [{ sample: 'hall', scene: 'hall', metrics: ['draws'] }], { tier: 'reference', baseline: base });
  const row = r.rows.find(x => x.metric === 'draws')!;
  assert.equal(row.regression, undefined);
  assert.equal(row.baselineInconclusive, true);
  assert.equal(r.ok, true);
  assert.match(formatReport(r), /baseline window not comparable/);
});
