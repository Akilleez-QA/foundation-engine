// Cache tests (ADR 0046): identical-build reuse, tightened-budget failure on reused evidence, incomplete-cache
// rejection, key invalidation, and a draw regression failing against a baseline. The evidence is synthetic: three
// scenes, one with an active window.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cacheKey, expectedSamples, loadRun, storeRun, validateRun, type Experiment} from './cache';
import {
  benchResultOf,
  checkBudgets,
  toCheckBudget,
  type SampleBinding,
  type BenchResult,
} from '../../src/platform/perf/budget-check';
import type {PerfRun, PerfSample} from '../../src/platform/perf/perf-run';

const SCENES = ['main', 'hall', 'tower'];
const experiment: Experiment = {route: SCENES, active: ['hall']};
const hex = (c: string) => c.repeat(64);
const steady = {kind: 'steady' as const, version: 1, reasons: [], comparable: true};
const sample = (id: string, scene: string, draws: number): PerfSample => ({
  id,
  scene,
  mode: id.endsWith(':active') ? 'active' : 'idle',
  classification: steady,
  frames: 6,
  drawsPerRenderedFrame: draws,
  trisPerRenderedFrame: draws * 100,
  offscreenDrawsPerRenderedFrame: 0,
  shadowPassDrawsMax: 0,
  shadowPassesMax: 0,
  textureMiB: 4,
  canvasMiB: 2,
  heapMB: 10,
  liveContexts: 1,
});

function todaysRun(): PerfRun {
  const samples = [
    sample('main', 'main', 40),
    sample('hall', 'hall', 120),
    sample('hall:active', 'hall', 130),
    sample('tower', 'tower', 60),
  ];
  return {
    schema: 1,
    sha: 'a'.repeat(40),
    dirty: false,
    harness: 'swiftshader',
    viewport: {width: 1280, height: 800, dpr: 1},
    gpu: 'SwiftShader',
    browser: 'test',
    when: 't',
    loadAverage: 0,
    descriptor: hex('d'),
    build: {digest: hex('b'), files: 1},
    network: {mode: 'hermetic', external: {}},
    startup: {appReadyMs: 900, transferredMB: 1, jsKB: 300, heapMB: 8, textureMiB: 0, canvasMiB: 1, liveContexts: 1},
    samples,
    afterTour: {textureMiB: 4, canvasMiB: 2, heapMB: 10, liveContexts: 1},
    chunks: {},
  };
}
const CHECK_BUDGETS = Object.fromEntries(
  SCENES.map(p => [p, toCheckBudget({draws: 200, textureMiB: 16, contexts: 1})]),
);
const BENCH_BINDINGS: SampleBinding[] = [
  ...SCENES.map(p => ({sample: p, scene: p, metrics: ['draws', 'textureMiB', 'contexts'] as const})),
  {sample: 'hall:active', scene: 'hall', metrics: ['draws']},
];
const withDir = (fn: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'engine-perf-cache-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
};
const check = (run: PerfRun, budgets = CHECK_BUDGETS, baseline: BenchResult = benchResultOf(todaysRun())) =>
  checkBudgets(benchResultOf(run), budgets, BENCH_BINDINGS, {tier: 'reference', baseline, realHardware: false});

test("today's evidence is complete for the gate's experiment", () => {
  assert.deepEqual(validateRun(todaysRun(), experiment), []);
  assert.deepEqual(expectedSamples(experiment).hall, ['hall', 'hall:active']);
  assert.deepEqual(expectedSamples(experiment).main, ['main']);
});

test('the key covers the whole build and the experiment: any change to either misses', () => {
  const k = cacheKey({buildDigest: hex('b'), descriptor: hex('d')});
  assert.equal(k, cacheKey({buildDigest: hex('b'), descriptor: hex('d')}), 'identical build and experiment: same key');
  assert.notEqual(k, cacheKey({buildDigest: hex('c'), descriptor: hex('d')}), 'an executable change misses');
  assert.notEqual(
    k,
    cacheKey({buildDigest: hex('b'), descriptor: hex('e')}),
    'a harness, browser, route or window change misses',
  );
  assert.notEqual(
    k,
    cacheKey({buildDigest: hex('b'), descriptor: hex('d'), classificationVersion: 99}),
    'a classification change misses',
  );
  assert.throws(
    () => cacheKey({buildDigest: '', descriptor: hex('d')}),
    /build digest/,
    'no build digest: never a key',
  );
});

test('identical-build reuse: stored complete evidence comes back unchanged', () =>
  withDir(dir => {
    const run = todaysRun(),
      key = cacheKey({buildDigest: run.build!.digest, descriptor: hex('d')});
    assert.deepEqual(storeRun(run, key, experiment, dir), []);
    const hit = loadRun(key, experiment, dir);
    assert.ok(hit.ok);
    assert.deepEqual(hit.run, run);
    assert.equal(
      loadRun(cacheKey({buildDigest: hex('c'), descriptor: hex('d')}), experiment, dir).ok,
      false,
      'another build misses',
    );
  }));

test('a tightened budget fails on reused evidence (a cached run is evidence, not a verdict)', () =>
  withDir(dir => {
    const run = todaysRun(),
      key = cacheKey({buildDigest: run.build!.digest, descriptor: hex('d')});
    storeRun(run, key, experiment, dir);
    const hit = loadRun(key, experiment, dir);
    assert.ok(hit.ok);
    const towerDraws = hit.run.samples.find(s => s.id === 'tower')!.drawsPerRenderedFrame!;
    const tightened = {...CHECK_BUDGETS, tower: {...CHECK_BUDGETS.tower, draws: Math.floor(towerDraws * 0.8)}};
    const r = check(hit.run, tightened);
    assert.equal(r.ok, false);
    assert.equal(r.rows.find(x => x.sample === 'tower' && x.metric === 'draws')!.verdict, 'fail');
  }));

test('a +30-draw regression blocks against the baseline; +5 is inside the 10 % ratchet', () => {
  const run = todaysRun();
  const bump = (n: number): PerfRun => ({
    ...run,
    samples: run.samples.map(s => (s.id === 'tower' ? {...s, drawsPerRenderedFrame: s.drawsPerRenderedFrame! + n} : s)),
  });
  const bad = check(bump(30));
  const row = bad.rows.find(x => x.sample === 'tower' && x.metric === 'draws')!;
  assert.equal(row.regression?.blocking, true, `tower draws ${row.measured} vs baseline ${row.baseline}`);
  assert.equal(bad.ok, false);
  const small = check(bump(5));
  assert.equal(small.rows.find(x => x.sample === 'tower' && x.metric === 'draws')!.regression?.blocking, false);
});

test('an incomplete cache is rejected: missing shard, truncated file, errored or invalid window, wrong route', () =>
  withDir(dir => {
    const run = todaysRun(),
      key = cacheKey({buildDigest: run.build!.digest, descriptor: hex('d')});
    storeRun(run, key, experiment, dir);
    unlinkSync(join(dir, 'main', `${key}.json`));
    assert.match((loadRun(key, experiment, dir) as {reason: string}).reason, /missing .*main/);
    storeRun(run, key, experiment, dir);
    writeFileSync(join(dir, 'tower', `${key}.json`), '{"cacheSchema":1,"key":"');
    assert.match((loadRun(key, experiment, dir) as {reason: string}).reason, /unreadable .*tower/);
    storeRun(run, key, experiment, dir);
    const shard = JSON.parse(readFileSync(join(dir, 'hall', `${key}.json`), 'utf8'));
    shard.samples = shard.samples.filter((s: PerfSample) => s.id !== 'hall:active');
    writeFileSync(join(dir, 'hall', `${key}.json`), JSON.stringify(shard));
    assert.match((loadRun(key, experiment, dir) as {reason: string}).reason, /hall:active: missing/);
    assert.equal(loadRun(key, {...experiment, active: ['hall']}, dir).ok, false, 'another route');
  }));

test('incomplete evidence is never stored', () =>
  withDir(dir => {
    const run = todaysRun(),
      key = cacheKey({buildDigest: run.build!.digest, descriptor: hex('d')});
    const errored = {
      ...run,
      samples: run.samples.map(s =>
        s.id === 'main' ? {id: s.id, scene: s.scene, mode: s.mode, error: 'left the scene during the window'} : s,
      ),
    };
    assert.match(storeRun(errored, key, experiment, dir).join(), /main: left the scene/);
    const invalid = {
      ...run,
      samples: run.samples.map(s =>
        s.id === 'tower'
          ? {...s, classification: {kind: 'invalid' as const, version: 1, reasons: [], comparable: false}}
          : s,
      ),
    };
    assert.match(storeRun(invalid, key, experiment, dir).join(), /tower: invalid window/);
    assert.match(storeRun({...run, build: null}, key, experiment, dir).join(), /no build digest/);
    assert.match(
      storeRun({...run, network: {mode: 'live', external: {'https://example.com': 3}}}, key, experiment, dir).join(),
      /network/,
    );
    assert.equal(loadRun(key, experiment, dir).ok, false, 'nothing was written');
  }));
