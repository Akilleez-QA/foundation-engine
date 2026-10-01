import {WHOLE_ROUTE_POLICY,isWholeScriptedWindow} from '../../src/platform/perf/scripted-window';
// Baseline shards (ADR 0036): perf/baseline/<scene>.json holds the last accepted run of that scene per
// harness and viewport; perf/baseline/_app.json holds startup and after-tour. Only `npm run perf:baseline` writes them,
// and only for the scenes of the run it is given. A baseline compares only with a run of the same experiment
// descriptor (ADR 0046): the same route, windows, harness helpers and browser.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isComparable, type BenchResult, type BenchSample } from '../../src/platform/perf/budget-check';
import type { PerfRun, PerfSample } from '../../src/platform/perf/perf-run';

export const BASELINE_DIR = fileURLToPath(new URL('../../perf/baseline/', import.meta.url));

export interface BaselineSource { sha: string; descriptor: string; when: string; buildDigest: string }
export interface ShardRun { sources?: BaselineSource[]; sha: string; descriptor: string; when: string; samples: (PerfSample | (BenchSample & { id: string }))[] }
export interface Shard { schema: 1; scene: string; runs: Record<string, ShardRun> }

export const harnessKey = (run: Pick<PerfRun, 'harness' | 'viewport'>) => `${run.harness}@${run.viewport.width}x${run.viewport.height}`;

function readShard(path: string): Shard | null {
  if (!existsSync(path)) return null;
  const s = JSON.parse(readFileSync(path, 'utf8')) as Shard;
  if (s.schema !== 1 || typeof s.runs !== 'object') throw Error(`${path}: not a schema-1 baseline shard`);
  return s;
}

/** The baseline for `run` as a keyed result, plus the scenes whose baseline exists but is not comparable. */
export function loadBaseline(run: PerfRun, dir = BASELINE_DIR): { baseline: BenchResult; incomparable: string[] } {
  const out: Record<string, BenchSample> = {}, incomparable: string[] = [];
  if (!existsSync(dir)) return { baseline: out, incomparable };
  const key = harnessKey(run);
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const shard = readShard(join(dir, f));
    const r = shard?.runs[key];
    if (!shard || !r) continue;
    if (r.descriptor !== run.descriptor) { incomparable.push(shard.scene); continue; }
    for (const s of r.samples) out[s.id] = s as BenchSample;
  }
  return { baseline: out, incomparable };
}

/** Samples of `scenes` that cannot be a baseline: rejected, or not comparable (ADR 0053 unclassified/invalid). */
export function nonComparable(run: PerfRun, scenes?: readonly string[]): string[] {
  return run.samples.filter(s => !scenes || scenes.includes(s.scene))
    .filter(s => s.error || !('scriptedWindow' in s ? isWholeScriptedWindow(s) : isComparable(s as unknown as BenchSample)) || ('scriptedWindow' in s && (run as PerfRun & {experiment?:{comparisonPolicy?:string}}).experiment?.comparisonPolicy!==WHOLE_ROUTE_POLICY))
    .map(s => `${s.id} (${s.error ?? (s.classification?.kind??'missing classification') + ': ' + (s.classification?.reasons??[]).join('; ')})`);
}
export class NonComparableBaseline extends Error {
  constructor(readonly samples: string[]) { super('refusing: a baseline must be comparable; not comparable: ' + samples.join(', ')); this.name = 'NonComparableBaseline'; }
}

/** Writes the shards of the run's scenes (and _app when the run has a startup sample). Refuses a dirty run, and any
 *  scene whose samples are rejected or not comparable: a baseline is only ever a comparable window. */
export function writeBaseline(run: PerfRun, dir = BASELINE_DIR, only?: readonly string[], sources?: BaselineSource[]): string[] {
  if (run.dirty) throw Error('refusing: the run was taken from a tree with uncommitted changes');
  const scenes = [...new Set(run.samples.map(s => s.scene))].filter(p => !only || only.includes(p));
  const bad = scenes.length ? nonComparable(run, scenes) : [];
  if (bad.length) throw new NonComparableBaseline(bad);
  mkdirSync(dir, { recursive: true });
  const key = harnessKey(run), written: string[] = [];
  const put = (scene: string, samples: ShardRun['samples']) => {
    const path = join(dir, `${scene}.json`);
    const shard = readShard(path) ?? { schema: 1 as const, scene, runs: {} };
    shard.runs[key] = { ...(sources ? { sources } : {}), sha: run.sha, descriptor: run.descriptor, when: run.when, samples };
    writeFileSync(path + '.tmp', JSON.stringify(shard, null, 1) + '\n');
    renameSync(path + '.tmp', path);
    written.push(path);
  };
  for (const scene of scenes) put(scene, run.samples.filter(s => s.scene === scene).map(({ topTextures: _t, ...s }) => s));
  if (run.startup && (!only || only.includes('app'))) put('_app', [{ id: 'startup', ...run.startup }, ...(run.afterTour ? [{ id: 'afterTour', ...run.afterTour }] : [])]);
  return written;
}

/** Per-metric maximum of several comparable windows of one sample id: the envelope a later run is compared with. */
export function envelope<T extends Record<string, unknown>>(samples: readonly T[]): T {
  const out: Record<string, unknown> = { ...samples[0] };
  for (const k of Object.keys(out)) {
    // Guard counters belong to the retained raw window; budget metrics still take their maximum.
    if(out.scriptedWindow && (k==='frames'||k==='windowMs'))continue;
    const vals = samples.map(x => x[k]);
    if (vals.every(v => typeof v === 'number' && Number.isFinite(v))) out[k] = Math.max(...(vals as number[]));
  }
  if (samples.length > 1) out.envelopeOf = samples.length;
  return out as T;
}

/**
 * Baselines from fresh benches (the budget rule: the worst value over runs). Counts of animated scenes depend on the
 * animation phase while the clock is not frozen, and some scenes settle into more than one state, so one run
 * is not a baseline. This runs `bench` up to `attempts` times until every scene in `scenes` has `runs` runs in which
 * all its samples are comparable (ADR 0053), and writes each sample's per-metric maximum over those runs. If a scene
 * falls short, nothing is written and it throws NonComparableBaseline naming the samples of the last attempt.
 */
export async function baselineFromBenches(bench: (attempt: number) => Promise<PerfRun>, scenes: readonly string[], opts: { runs: number; attempts: number },
  dir = BASELINE_DIR, log: (s: string) => void = () => {}): Promise<string[]> {
  const good = new Map<string, PerfRun[]>(scenes.map(p => [p, []]));
  const apps: PerfRun[] = [];
  const short = () => scenes.filter(p => good.get(p)!.length < opts.runs);
  let last: PerfRun | null = null;
  let identity: string | null = null;
  const sources: BaselineSource[] = [];
  for (let i = 1; i <= opts.attempts && short().length; i++) {
    const run = await bench(i);
    last = run;
    if (!run.build?.digest || !/^[0-9a-f]{64}$/.test(run.build.digest)) throw Error('refusing: baseline envelope needs a known executable build digest');
    const current = JSON.stringify({ build: run.build.digest, descriptor: run.descriptor, harness: run.harness, viewport: run.viewport, browser: run.browser, gpu: run.gpu });
    if (identity !== null && current !== identity) throw Error('refusing: baseline envelope mixes executable builds or experiments');
    identity = current;
    sources.push({ sha: run.sha, descriptor: run.descriptor, when: run.when, buildDigest: run.build.digest });
    if (run.dirty) throw Error('refusing: the run was taken from a tree with uncommitted changes');
    if (run.startup && run.afterTour && apps.length < opts.runs) apps.push(run);
    for (const p of short()) if (nonComparable(run, [p]).length === 0 && run.samples.some(s => s.scene === p)) good.get(p)!.push(run);
    const missing = short();
    log(`baseline bench ${i}/${opts.attempts}: ${missing.length ? `fewer than ${opts.runs} comparable run(s): ${missing.join(', ')}` : `${opts.runs} comparable run(s) of every scene`}`);
  }
  const missing = short();
  if (missing.length) throw new NonComparableBaseline(last ? nonComparable(last, missing).concat(missing.filter(p => !nonComparable(last!, [p]).length).map(p => `${p} (only ${good.get(p)!.length} comparable run(s))`)) : missing);
  const latest = last!;
  const samples = scenes.flatMap(p => {
    const runs = good.get(p)!;
    const ids = [...new Set(runs[0].samples.filter(s => s.scene === p).map(s => s.id))];
    return ids.map(id => envelope(runs.map(r => r.samples.find(s => s.id === id)!).filter(Boolean) as unknown as Record<string, unknown>[]) as unknown as PerfRun['samples'][number]);
  });
  const env: PerfRun = { ...latest, samples,
    startup: apps.length ? envelope(apps.map(r => r.startup!) as unknown as Record<string, unknown>[]) as unknown as PerfRun['startup'] : latest.startup,
    afterTour: apps.length ? envelope(apps.map(r => r.afterTour!) as unknown as Record<string, unknown>[]) as unknown as PerfRun['afterTour'] : latest.afterTour };
  return writeBaseline(env, dir, [...scenes, 'app'], sources);
}
