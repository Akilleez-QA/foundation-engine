// scripts/perf/cache.ts: ADR 0046's conservative evidence cache for the gate.
//
// - The key is the whole executable build (the digest of every emitted file: JS, CSS, HTML, generated data, public
//   assets) plus the complete experiment descriptor (harness, browser, backend, viewport, route, windows, fixture,
//   helper sources, network mode) and the ADR 0053 classification version. Documentation and commit ids are not
//   inputs, so a docs-only change or a rebase with identical executable inputs reuses the evidence; any executable
//   change misses for every scene (no per-scene affinity yet).
// - Raw measurements are cached, never a verdict: the gate re-checks reused counts against the current budgets,
//   baselines and thresholds every time.
// - A run is stored and read only when it is complete: every scene and window of the descriptor's route present,
//   each with its numbers, no error, no invalid (ADR 0053) window, a known build, and a hermetic network. Anything
//   else is a miss, and the gate runs fresh. Files are replaced atomically.
// Layout: perf/cache/<scene>/<key>.json per scene, plus perf/cache/_run/<key>.json (run metadata, startup, after tour).
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {PerfRun, PerfSample} from '../../src/platform/perf/perf-run';
import {CLASSIFICATION_VERSION} from '../../src/platform/perf/window-class';

export const CACHE_SCHEMA = 1;
export const CACHE_DIR = fileURLToPath(new URL('../../perf/cache/', import.meta.url));

/** The experiment's shape the gate expects: its route (scenes in order) and the scenes with an active window. */
export interface Experiment {
  route: readonly string[];
  active: readonly string[];
}

export function cacheKey(input: {buildDigest: string; descriptor: string; classificationVersion?: number}): string {
  if (!/^[0-9a-f]{64}$/.test(input.buildDigest) || !/^[0-9a-f]{64}$/.test(input.descriptor))
    throw Error('cache key needs a build digest and a descriptor hash');
  return createHash('sha256')
    .update(
      JSON.stringify({
        schema: CACHE_SCHEMA,
        build: input.buildDigest,
        descriptor: input.descriptor,
        classification: input.classificationVersion ?? CLASSIFICATION_VERSION,
      }),
    )
    .digest('hex');
}

/** Sample ids the experiment must produce, per scene. */
export function expectedSamples(e: Experiment): Record<string, string[]> {
  return Object.fromEntries(e.route.map(p => [p, [p, ...(e.active.includes(p) ? [p + ':active'] : [])]]));
}

const REQUIRED: readonly (keyof PerfSample)[] = [
  'drawsPerRenderedFrame',
  'trisPerRenderedFrame',
  'offscreenDrawsPerRenderedFrame',
  'shadowPassDrawsMax',
  'textureMiB',
  'canvasMiB',
  'heapMB',
  'liveContexts',
  'frames',
];

/** Why a run is not complete evidence for this experiment; [] when it is. */
export function validateRun(run: PerfRun, e: Experiment): string[] {
  const problems: string[] = [];
  if (run?.schema !== 1) return ['not a schema-1 PerfRun'];
  if (!run.build?.digest) problems.push('no build digest (the bench was given a base URL)');
  if (run.network?.mode !== 'hermetic' && Object.keys(run.network?.external ?? {unknown: 1}).length)
    problems.push('the run reached the network: not reproducible');
  if (!run.startup) problems.push('no startup sample');
  if (!run.afterTour) problems.push('no after-tour sample');
  const byId = new Map(run.samples.map(s => [s.id, s]));
  for (const [scene, ids] of Object.entries(expectedSamples(e)))
    for (const id of ids) {
      const s = byId.get(id);
      if (!s) {
        problems.push(`${id}: missing`);
        continue;
      }
      if (s.scene !== scene) problems.push(`${id}: belongs to ${s.scene}, not ${scene}`);
      if (s.error) problems.push(`${id}: ${s.error}`);
      else if (s.classification?.kind === 'invalid') problems.push(`${id}: invalid window`);
      for (const k of REQUIRED) if (!s.error && typeof s[k] !== 'number') problems.push(`${id}: no ${k}`);
    }
  return problems;
}

function atomicWrite(path: string, data: unknown) {
  mkdirSync(join(path, '..'), {recursive: true});
  writeFileSync(path + '.tmp', JSON.stringify(data) + '\n');
  renameSync(path + '.tmp', path);
}

type Meta = Omit<PerfRun, 'samples'>;
interface RunShard {
  cacheSchema: number;
  key: string;
  kind: 'run';
  experiment: Experiment;
  meta: Meta;
}
interface SceneShard {
  cacheSchema: number;
  key: string;
  kind: 'scene';
  scene: string;
  samples: PerfSample[];
}

/** Stores complete evidence under `key`. Refuses (returns the problems) anything incomplete. */
export function storeRun(run: PerfRun, key: string, e: Experiment, dir = CACHE_DIR): string[] {
  const problems = validateRun(run, e);
  if (problems.length) return problems;
  const {samples, ...meta} = run;
  for (const scene of e.route)
    atomicWrite(join(dir, scene, `${key}.json`), {
      cacheSchema: CACHE_SCHEMA,
      key,
      kind: 'scene',
      scene,
      samples: samples.filter(s => s.scene === scene),
    } satisfies SceneShard);
  // The run shard goes last: a reader that finds it knows every scene shard was written before it.
  atomicWrite(join(dir, '_run', `${key}.json`), {
    cacheSchema: CACHE_SCHEMA,
    key,
    kind: 'run',
    experiment: {route: [...e.route], active: [...e.active]},
    meta,
  } satisfies RunShard);
  return [];
}

export type CacheRead = {ok: true; run: PerfRun} | {ok: false; reason: string};

/** Reads evidence for `key`. Any missing, unreadable, foreign or incomplete part is a miss with its reason. */
export function loadRun(key: string, e: Experiment, dir = CACHE_DIR): CacheRead {
  const read = <T>(path: string): T | string => {
    if (!existsSync(path)) return `missing ${path.slice(dir.length)}`;
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as T;
    } catch {
      return `unreadable ${path.slice(dir.length)}`;
    }
  };
  const head = read<RunShard>(join(dir, '_run', `${key}.json`));
  if (typeof head === 'string') return {ok: false, reason: head};
  if (head.cacheSchema !== CACHE_SCHEMA || head.key !== key || head.kind !== 'run')
    return {ok: false, reason: 'run shard is foreign or of another schema'};
  if (JSON.stringify(head.experiment) !== JSON.stringify({route: [...e.route], active: [...e.active]}))
    return {ok: false, reason: 'run shard is for another route'};
  const samples: PerfSample[] = [];
  for (const scene of e.route) {
    const shard = read<SceneShard>(join(dir, scene, `${key}.json`));
    if (typeof shard === 'string') return {ok: false, reason: shard};
    if (
      shard.cacheSchema !== CACHE_SCHEMA ||
      shard.key !== key ||
      shard.scene !== scene ||
      !Array.isArray(shard.samples)
    )
      return {ok: false, reason: `${scene} shard is foreign or malformed`};
    samples.push(...shard.samples);
  }
  const run: PerfRun = {...head.meta, samples};
  const problems = validateRun(run, e);
  return problems.length
    ? {
        ok: false,
        reason:
          'incomplete evidence: ' +
          problems.slice(0, 4).join('; ') +
          (problems.length > 4 ? ` (+${problems.length - 4})` : ''),
      }
    : {ok: true, run};
}
