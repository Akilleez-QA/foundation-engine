// `npm run perf:baseline`: accept comparable measurements as the baseline of their scenes (an improvement updates
// the baseline in the same change). Rewrites only the shards of the scenes named.
//   npm run perf:baseline -- <perf/runs/….json> [--only a,b]   from a clean run; refuses any rejected or
//                                                              non-comparable (ADR 0053) sample
//   npm run perf:baseline -- --bench [--runs K] [--attempts N] [--only a,b]
//                                                              benches (each window already re-samples up to 3
//                                                              times in its scene) up to N times (default K + 2)
//                                                              until every scene has K comparable runs (default 3),
//                                                              and writes their per-metric maximum; else writes
//                                                              nothing and errors
import {readFileSync} from 'node:fs';
import type {PerfRun} from '../../src/platform/perf/perf-run';
import {SCENE_IDS} from '../../perf/budgets';
import {baselineFromBenches, writeBaseline} from './baselines';

const argv = process.argv.slice(2);
const arg = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const only = arg('--only')?.split(',');
let written: string[];
if (argv.includes('--bench')) {
  // @ts-expect-error: bench.mjs is plain JavaScript (run under tsx)
  const {parseArgs, runBench, writeRun} = await import('./bench.mjs');
  const o = {...parseArgs([]), check: false};
  const runs = Number(arg('--runs') ?? 3),
    attempts = Number(arg('--attempts') ?? runs + 2);
  written = await baselineFromBenches(
    async i => {
      console.log(`perf:baseline: bench ${i}/${attempts} (full route, so page-wide numbers stay comparable)`);
      const run = (await runBench(o, {log: () => {}})) as PerfRun;
      console.log('PerfRun →', writeRun(run));
      return run;
    },
    (only ?? SCENE_IDS).filter(p => p !== 'app'),
    {runs, attempts},
    undefined,
    console.log,
  );
} else {
  const file = argv.find(a => a.endsWith('.json'));
  if (!file) {
    console.error(
      'usage: npm run perf:baseline -- <perf/runs/….json> [--only a,b] | --bench [--attempts N] [--only a,b]',
    );
    process.exit(64);
  }
  written = writeBaseline(JSON.parse(readFileSync(file, 'utf8')) as PerfRun, undefined, only);
}
for (const p of written) console.log('baseline →', p);
