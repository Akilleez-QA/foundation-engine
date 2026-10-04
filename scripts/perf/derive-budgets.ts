// scripts/perf/derive-budgets.ts (`npm run perf:derive -- <perf/runs/….json> [--headroom 0.1]`): starting budgets from a
// measured run: for each scene, the worst of its idle and active windows, plus headroom, rounded up to a readable
// step (deriveBudget). It prints JSON rows to paste into game/budgets.json when a scene gains its budget; after
// that a budget only moves by reviewed edits (lowering freely, raising with a Perf-Budget trailer).
//
// A budget is only ever derived from evidence. A scene is refused (named on stderr, left out of the rows, exit 1) when
// any of its windows was rejected or is not comparable (ADR 0053), for example an active window that drew no frame
// because the scene had ended: a worst-of over the remaining windows would understate it, and zeros are not counts.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {deriveBudget, isComparable, worstOf, type BudgetMetric} from '../../src/platform/perf/budget-check';
import type {PerfRun} from '../../src/platform/perf/perf-run';
import {NO_FRAME_HINT} from './budget-check';

export const DERIVED: readonly BudgetMetric[] = [
  'draws',
  'triangles',
  'shadowCasters',
  'shadowPasses',
  'textureMiB',
  'canvasMiB',
  'heapMiB',
  'contexts',
  'loadMiB',
];

export interface Derivation {
  /** Budget rows of the scenes with complete, comparable evidence. */
  rows: Record<string, Record<string, unknown>>;
  /** Scenes left out, each with why. */
  refused: Record<string, string[]>;
  /** Scenes whose per-rendered-frame counts were left out of the row (no window drew a frame), each with why. */
  notes: Record<string, string>;
}

/** Means per rendered frame: unmeasured, not zero, when no window of the scene drew a frame. */
const PER_RENDERED_FRAME: readonly BudgetMetric[] = ['draws', 'triangles'];

/** Why one scene's windows cannot be a budget source; [] when they can. */
export function refusalReasons(samples: readonly PerfRun['samples'][number][]): string[] {
  const out: string[] = [];
  for (const s of samples) {
    const cls = s.classification as {kind?: string; reasons?: string[]} | undefined;
    if (s.error) out.push(`${s.id}: rejected (${s.error})`);
    else if (cls?.kind === 'inconclusive') out.push(`${s.id}: inconclusive: ${NO_FRAME_HINT}`);
    else if (!isComparable({...s}))
      out.push(
        `${s.id}: not comparable (${cls?.kind ?? 'unknown'}${cls?.reasons?.length ? ': ' + cls.reasons.join('; ') : ''})`,
      );
  }
  return out;
}

export function deriveRun(run: PerfRun, headroom = 0.1): Derivation {
  const rows: Derivation['rows'] = {},
    refused: Derivation['refused'] = {},
    notes: Derivation['notes'] = {};
  for (const scene of [...new Set(run.samples.map(s => s.scene))]) {
    const samples = run.samples.filter(s => s.scene === scene);
    const why = refusalReasons(samples);
    if (why.length) {
      refused[scene] = why;
      continue;
    }
    // A still on-demand scene may legitimately draw nothing in its idle window; its per-frame means are then 0 by
    // observation. Leave those metrics out (unmeasured, so the checker skips them) rather than invent a step-sized cap.
    const drew = samples.some(s => typeof s.renderedFrames === 'number' && s.renderedFrames > 0);
    if (!drew)
      notes[scene] =
        `no window drew a frame; ${PER_RENDERED_FRAME.join(' and ')} left unmeasured (bench an active window in which the scene draws)`;
    rows[scene] = deriveBudget(
      worstOf(samples.map(s => ({...s}))),
      drew ? DERIVED : DERIVED.filter(m => !PER_RENDERED_FRAME.includes(m)),
      headroom,
    );
  }
  return {rows, refused, notes};
}

/** The budget rows only (scenes with complete, comparable evidence); see {@link deriveRun} for the refusals. */
export function deriveFromRun(run: PerfRun, headroom = 0.1): Record<string, Record<string, unknown>> {
  return deriveRun(run, headroom).rows;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const file = argv.find(a => a.endsWith('.json'));
  if (!file) {
    console.error('usage: npm run perf:derive -- <perf/runs/….json> [--headroom 0.1]');
    process.exit(64);
  }
  const hi = argv.indexOf('--headroom');
  const run = JSON.parse(readFileSync(file, 'utf8')) as PerfRun;
  const {rows, refused, notes} = deriveRun(run, hi >= 0 ? Number(argv[hi + 1]) : 0.1);
  console.log(JSON.stringify(rows, null, 2));
  if (run.startup) console.log(`startup: ${JSON.stringify(run.startup)}\nafterTour: ${JSON.stringify(run.afterTour)}`);
  for (const [scene, note] of Object.entries(notes)) console.error(`perf:derive: ${scene}: ${note}`);
  for (const [scene, why] of Object.entries(refused))
    console.error(
      `perf:derive: NO BUDGET for ${scene}: the evidence is not comparable\n${why.map(w => '  ' + w).join('\n')}`,
    );
  if (Object.keys(refused).length) process.exitCode = 1;
}
