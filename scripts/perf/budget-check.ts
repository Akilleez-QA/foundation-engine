// scripts/perf/budget-check.ts (`npm run perf:check -- <run.json>`): checks a PerfRun against perf/budgets.ts and the
// baseline shards and prints the report. Report-only (exits 0 unless the file is unreadable); `npm run gate` blocks.
//
// Usage: tsx scripts/perf/budget-check.ts <perf/runs/….json> [--no-baseline] [--tier reference|high|medium|low]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { benchResultOf, checkBudgets, formatReport, type CheckReport } from '../../src/platform/perf/budget-check';
import type { PerfRun } from '../../src/platform/perf/perf-run';
import { isQualityPreset, type QualityPreset } from '../../src/core/tiers';
import { BENCH_BINDINGS, CHECK_BUDGETS } from '../../perf/budgets';
import { loadBaseline } from './baselines';

/** What to do about an active window that drew no frame (shared with perf:derive). */
export const NO_FRAME_HINT = 'the active window drew no frame, so the scene had probably ended (game over, frozen run, pause) and its counts are zeros, not measurements. Make the bench meet the scene in play (for example a start scene before it, so it is entered fresh, or no fail state reachable within the window), then bench again. If the held keys are not what moves this scene, name the keys that do as the row\'s activeKeys in budgets.json. These windows never pass the gate and perf:derive derives no budget from them.';

export interface RunReport { report: CheckReport; text: string; incomparable: string[] }

/** Budgets and (unless disabled) the comparable baseline; SwiftShader runs gate counts only. */
export function reportRun(run: PerfRun, opts: { baseline?: boolean; tier?: QualityPreset; baselineDir?: string } = {}): RunReport {
  const { baseline, incomparable } = opts.baseline === false ? { baseline: undefined, incomparable: [] } : loadBaseline(run, opts.baselineDir);
  const report = checkBudgets(benchResultOf(run), CHECK_BUDGETS, BENCH_BINDINGS, { tier: opts.tier ?? 'reference', baseline, realHardware: run.harness === 'gpu' });
  const kinds = new Map<string, string[]>();
  for (const s of run.samples) { const k = s.error ? 'rejected' : s.classification?.kind ?? 'unclassified'; kinds.set(k, [...(kinds.get(k) ?? []), s.id]); }
  const lines = [
    `PerfRun ${run.sha.slice(0, 12)}${run.dirty ? ' (dirty)' : ''} · ${run.harness} ${run.viewport.width}x${run.viewport.height} · load ${run.loadAverage} · ${run.gpu}`,
    formatReport(report),
    '  windows (ADR 0053): ' + [...kinds].map(([k, ids]) => `${k} ${ids.length}${k === 'steady' ? '' : ' [' + ids.join(', ') + ']'}`).join(' · '),
  ];
  const dead = run.samples.filter(s => !s.error && s.classification?.kind === 'inconclusive').map(s => s.id);
  if (dead.length) lines.push(`  INCONCLUSIVE window(s) ${dead.join(', ')}: ${NO_FRAME_HINT}`);
  if (incomparable.length) lines.push(`  baseline not comparable (another experiment descriptor) for: ${incomparable.join(', ')}; run npm run perf:baseline on a clean, accepted run`);
  return { report, text: lines.join('\n'), incomparable };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const file = argv.find(a => !a.startsWith('--') && a.endsWith('.json'));
  if (!file) { console.error('usage: tsx scripts/perf/budget-check.ts <run.json> [--no-baseline] [--tier reference]'); process.exit(64); }
  const ti = argv.indexOf('--tier'), tier = ti >= 0 ? argv[ti + 1] : 'reference';
  if (!isQualityPreset(tier)) throw Error('unknown tier ' + tier);
  const run = JSON.parse(readFileSync(file, 'utf8')) as PerfRun;
  if (run.schema !== 1) throw Error(`${file}: not a schema-1 PerfRun`);
  console.log(reportRun(run, { baseline: !argv.includes('--no-baseline'), tier }).text);
  console.log('(report-only; the gate that blocks is npm run gate)');
}
