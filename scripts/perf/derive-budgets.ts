// scripts/perf/derive-budgets.ts (`npm run perf:derive -- <perf/runs/….json> [--headroom 0.1]`): starting budgets from a
// measured run: for each scene, the worst of its idle and active windows, plus headroom, rounded up to a readable
// step (deriveBudget). It prints JSON rows to paste into game/budgets.json when a scene gains its budget; after
// that a budget only moves by reviewed edits (lowering freely, raising with a Perf-Budget trailer).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deriveBudget, worstOf, type BenchSample, type BudgetMetric } from '../../src/platform/perf/budget-check';
import type { PerfRun } from '../../src/platform/perf/perf-run';

export const DERIVED: readonly BudgetMetric[] = ['draws', 'triangles', 'shadowCasters', 'textureMiB', 'canvasMiB', 'heapMiB', 'contexts', 'loadMiB'];

export function deriveFromRun(run: PerfRun, headroom = 0.1): Record<string, Record<string, unknown>> {
  const scenes = [...new Set(run.samples.filter(s => !s.error).map(s => s.scene))];
  return Object.fromEntries(scenes.map(p => {
    const samples = run.samples.filter(s => s.scene === p && !s.error) as unknown as BenchSample[];
    return [p, deriveBudget(worstOf(samples), DERIVED, headroom)];
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const file = argv.find(a => a.endsWith('.json'));
  if (!file) { console.error('usage: npm run perf:derive -- <perf/runs/….json> [--headroom 0.1]'); process.exit(64); }
  const hi = argv.indexOf('--headroom');
  const run = JSON.parse(readFileSync(file, 'utf8')) as PerfRun;
  console.log(JSON.stringify(deriveFromRun(run, hi >= 0 ? Number(argv[hi + 1]) : 0.1), null, 2));
  if (run.startup) console.log(`startup: ${JSON.stringify(run.startup)}\nafterTour: ${JSON.stringify(run.afterTour)}`);
}
