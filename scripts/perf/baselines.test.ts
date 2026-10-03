// The baseline writer only ever accepts comparable windows: it refuses a non-comparable sample, and when benching it
// re-samples up to N times, then errors without writing anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PerfRun, PerfSample } from '../../src/platform/perf/perf-run';
import { baselineFromBenches, NonComparableBaseline, writeBaseline } from './baselines';
import { must } from '../../src/testing/must';

const steady = { kind: 'steady' as const, version: 1, reasons: [], comparable: true };
const unknown = { kind: 'unclassified' as const, version: 1, reasons: ['3 upload(s) of unknown provenance'], comparable: false };
const sample = (id: string, scene: string, draws: number, comparable = true): PerfSample =>
  ({ id, scene, mode: 'idle', drawsPerRenderedFrame: draws, classification: comparable ? steady : unknown });
const run = (samples: PerfSample[], sha = 'a'.repeat(40)): PerfRun => ({ schema: 1, sha, dirty: false, harness: 'swiftshader', viewport: { width: 1280, height: 800, dpr: 1 },
  gpu: 'sw', browser: 'c', when: 't', loadAverage: 1, descriptor: 'd'.repeat(64), startup: { appReadyMs: 1, transferredMB: 1, jsKB: 1, heapMB: 1, textureMiB: 1, canvasMiB: 1, liveContexts: 1 },
  build: { digest: 'b'.repeat(64), files: 1 }, samples, afterTour: { textureMiB: 1, canvasMiB: 1, heapMB: 1, liveContexts: 1 }, chunks: {} });
const withDir = async (fn: (dir: string) => Promise<void> | void) => { const dir = mkdtempSync(join(tmpdir(), 'engine-perf-baseline-')); try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };

test('the writer refuses a non-comparable sample and writes nothing', () => withDir(dir => {
  assert.throws(() => writeBaseline(run([sample('lab', 'lab', 222, false), sample('hall', 'hall', 57)]), dir), (e: Error) =>
    e instanceof NonComparableBaseline && /lab \(unclassified: 3 upload/.test(e.message));
  assert.deepEqual(readdirSync(dir), []);
  assert.throws(() => writeBaseline(run([{ id: 'hall', scene: 'hall', mode: 'idle', error: 'left the scene' }]), dir), NonComparableBaseline);
  writeBaseline(run([sample('lab', 'lab', 222, false), sample('hall', 'hall', 57)]), dir, ['hall']);
  assert.ok(existsSync(join(dir, 'hall.json')) && !existsSync(join(dir, 'lab.json')), '--only a comparable scene is fine');
}));

test('benching re-samples until every scene is comparable, each scene from a run where it was', () => withDir(async dir => {
  const runs = [run([sample('lab', 'lab', 222, false), sample('hall', 'hall', 57)], '1'.repeat(40)),
    run([sample('lab', 'lab', 246), sample('hall', 'hall', 57, false)], '2'.repeat(40))];
  let calls = 0;
  await baselineFromBenches(async () => must(runs[calls++], 'a bench run'), ['lab', 'hall'], { runs: 1, attempts: 3 }, dir);
  assert.equal(calls, 2, 'stopped as soon as every scene had a comparable run');
  const shard = (p: string) => JSON.parse(readFileSync(join(dir, `${p}.json`), 'utf8')).runs['swiftshader@1280x800'];
  assert.equal(shard('lab').samples[0].drawsPerRenderedFrame, 246);
  assert.equal(shard('hall').samples[0].drawsPerRenderedFrame, 57);
  assert.equal(shard('hall').samples[0].classification.comparable, true, 'hall came from the run where it was comparable');
  assert.ok(existsSync(join(dir, '_app.json')));
}));

test('benching errors after N attempts when a scene stays non-comparable, and writes nothing', () => withDir(async dir => {
  let calls = 0;
  await assert.rejects(baselineFromBenches(async () => { calls++; return run([sample('lab', 'lab', 222, false), sample('hall', 'hall', 57)]); }, ['lab', 'hall'], { runs: 1, attempts: 3 }, dir),
    (e: Error) => e instanceof NonComparableBaseline && /lab/.test(e.message) && !/hall/.test(e.message));
  assert.equal(calls, 3);
  assert.deepEqual(readdirSync(dir), []);
}));

test('the baseline is the per-metric maximum over K comparable runs (level triangles 158.6k..183k by animation phase)', () => withDir(async dir => {
  const tris = [158586, 180088, 172003];
  let i = 0;
  await baselineFromBenches(async () => run([{ ...sample('level', 'level', 110), trisPerRenderedFrame: must(tris[i++]) }]), ['level'], { runs: 3, attempts: 5 }, dir);
  assert.equal(i, 3);
  const s = JSON.parse(readFileSync(join(dir, 'level.json'), 'utf8')).runs['swiftshader@1280x800'].samples[0];
  assert.equal(s.trisPerRenderedFrame, 180088);
  assert.equal(s.envelopeOf, 3);
  assert.equal(JSON.parse(readFileSync(join(dir, '_app.json'), 'utf8')).runs['swiftshader@1280x800'].samples[0].id, 'startup');
}));

for (const field of ['build', 'descriptor', 'harness', 'viewport', 'browser', 'gpu'] as const) {
  test(`baseline envelope rejects mixed ${field} without writing any shards`, () => withDir(async dir => {
    const first = run([sample('hall', 'hall', 57)]), second = structuredClone(first);
    if (field === 'build') second.build!.digest = 'c'.repeat(64);
    else if (field === 'viewport') second.viewport.width++;
    else if (field === 'harness') second.harness = 'gpu';
    else second[field] += '-changed';
    let i = 0;
    await assert.rejects(baselineFromBenches(async () => must([first, second][i++], 'a bench run'), ['hall'], { runs: 2, attempts: 2 }, dir), /mixes executable builds or experiments/);
    assert.deepEqual(readdirSync(dir), []);
  }));
}
test('baseline envelope refuses missing build provenance and records every contributing attempt', () => withDir(async dir => {
  const first = run([sample('hall', 'hall', 57)]);
  await assert.rejects(baselineFromBenches(async () => ({...first, build: null}), ['hall'], { runs: 1, attempts: 1 }, dir), /known executable build digest/);
  assert.deepEqual(readdirSync(dir), []);
  await baselineFromBenches(async () => first, ['hall'], { runs: 1, attempts: 1 }, dir);
  const shard = JSON.parse(readFileSync(join(dir, 'hall.json'), 'utf8')).runs['swiftshader@1280x800'];
  assert.deepEqual(shard.sources, [{sha: first.sha, descriptor: first.descriptor, when: first.when, buildDigest: first.build!.digest}]);
}));
