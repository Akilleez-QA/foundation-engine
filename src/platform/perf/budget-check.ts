import {isWholeScriptedWindow} from './scripted-window';
// platform/perf/budget-check.ts (L1, pure: no DOM, no three). The per-scene budget checker, shared
// by the gate (scripts/perf), later the dev perf HUD and `engine.perf.check()`. Input: a bench result (one object
// per measured sample, keyed by sample id; `benchResultOf` turns a PerfRun into one) and a table of per-scene
// budgets. Output: per-metric pass/warn/fail with deltas, plus regressions against an optional baseline.
// The tier type comes from core/tiers and the budget shape from core/budget.
import { budgetFor, type SceneBudgetValues } from '../../core/budget';
import { QUALITY_PRESETS, type Ported, type QualityPreset } from '../../core/tiers';
import type { PerfRun } from './perf-run';

export type Tier = QualityPreset;
export type PerTier<T> = { readonly [K in QualityPreset]: T };
/** A limit is one number for every tier, or one per tier. */
export type Limit = number | PerTier<number>;

/** Every metric a budget may declare (ADR 0025). All are "lower is better". */
export type BudgetMetric =
  | 'draws'            // GL draw calls per rendered frame, shadow passes included
  | 'triangles'        // triangles submitted per rendered frame, shadow passes included
  | 'shadowCasters'    // draws in the largest shadow pass seen (casters x shadow lights)
  | 'shadowDrawsIdle'  // off-screen (shadow/RT) draws per rendered frame while still: 0 = static shadow maps
  | 'textureMiB'       // live GPU texture bytes in connected, non-lost contexts
  | 'canvasMiB'        // live 2D canvas backing store (DOM + offscreen), after GC
  | 'heapMiB'          // JS heap after two forced GCs
  | 'contexts'         // live WebGL contexts
  | 'frameMs'          // frame interval (reference GPU only; SwiftShader is advisory)
  | 'idleRenderRatio'  // share of frames that issued draws while the scene is still (render on demand)
  | 'loadMs'           // route change to first interactive picture of the scene
  | 'loadMiB'          // bytes transferred to enter the scene
  | 'chunkKiB'         // the scene's own lazy chunk(s), minified
  | 'firstLoadJsKiB';  // startup only: JS before the first picture

/** Metrics that come from the structure of a frame: the ones the software-GL gate blocks on. */
export const COUNT_METRICS: ReadonlySet<BudgetMetric> = new Set<BudgetMetric>(['draws', 'triangles', 'shadowCasters', 'textureMiB', 'canvasMiB', 'heapMiB', 'contexts', 'loadMiB', 'chunkKiB', 'firstLoadJsKiB']);

/** The checker's flat view of a budget; `toCheckBudget` derives it from a SceneBudget. */
export type CheckBudget = Partial<Record<BudgetMetric, Limit>>;

/** One bench sample (the PerfRun sample shape, and the older bench-perf JSON). */
export interface BenchSample {
  readonly error?: string;
  readonly drawsPerFrame?: number;
  readonly drawsPerRenderedFrame?: number;
  readonly trisPerRenderedFrame?: number;
  readonly offscreenDrawsPerRenderedFrame?: number;
  readonly shadowPassDrawsMax?: number;
  readonly chunkKiB?: number;
  readonly textureMiB?: number;
  readonly canvasMiB?: number;
  readonly heapMB?: number;
  readonly liveContexts?: number;
  readonly taskMsPerFrame?: number;
  readonly frameMs?: number;
  readonly renderedFrameRatio?: number;
  readonly enterMs?: number;
  readonly enterMB?: number;
  readonly transferredMB?: number;
  readonly jsKB?: number;
  readonly firstLoadJsKiB?: number;
  readonly appReadyMs?: number;
  readonly [extra: string]: unknown;
}
export interface BenchResult {
  readonly profile?: string;
  readonly [sample: string]: BenchSample | string | undefined;
}

/** How a sample id maps onto a scene and which metric set it proves. */
export interface SampleBinding {
  readonly sample: string;          // sample id, e.g. 'home:active'
  readonly scene: string;           // scene id, e.g. 'home'
  readonly metrics: readonly BudgetMetric[];
  /** Only a reference-GPU run proves these (idle behaviour: SwiftShader renders too few frames per window). */
  readonly gpuOnly?: boolean;
}

export interface Tolerance { readonly relative: number; readonly absolute: number }
/** Noise allowance per metric. Counts are near-deterministic; timings are not. */
export const DEFAULT_TOLERANCE: Readonly<Record<BudgetMetric, Tolerance>> = {
  draws: { relative: 0.03, absolute: 2 },
  triangles: { relative: 0.03, absolute: 500 },
  shadowCasters: { relative: 0.03, absolute: 2 },
  shadowDrawsIdle: { relative: 0, absolute: 0 },
  textureMiB: { relative: 0.02, absolute: 1 },
  canvasMiB: { relative: 0.02, absolute: 1 },
  heapMiB: { relative: 0.10, absolute: 2 },
  contexts: { relative: 0, absolute: 0 },
  frameMs: { relative: 0.25, absolute: 1 },
  idleRenderRatio: { relative: 0, absolute: 0.05 },
  loadMs: { relative: 0.25, absolute: 250 },
  loadMiB: { relative: 0.05, absolute: 0.25 },
  chunkKiB: { relative: 0.02, absolute: 4 },
  firstLoadJsKiB: { relative: 0.01, absolute: 8 },
};

/** Growth against the baseline run that blocks a merge even while under budget (the ratchet). */
export const DEFAULT_REGRESSION: Readonly<Record<BudgetMetric, Tolerance>> = {
  draws: { relative: 0.10, absolute: 10 },
  triangles: { relative: 0.10, absolute: 5000 },
  shadowCasters: { relative: 0.10, absolute: 10 },
  shadowDrawsIdle: { relative: 0, absolute: 0 },
  textureMiB: { relative: 0.10, absolute: 4 },
  canvasMiB: { relative: 0.10, absolute: 4 },
  heapMiB: { relative: 0.20, absolute: 5 },
  contexts: { relative: 0, absolute: 0 },
  frameMs: { relative: 0.50, absolute: 4 },
  idleRenderRatio: { relative: 0, absolute: 0.10 },
  loadMs: { relative: 0.50, absolute: 1000 },
  loadMiB: { relative: 0.10, absolute: 1 },
  chunkKiB: { relative: 0.05, absolute: 8 },
  firstLoadJsKiB: { relative: 0.02, absolute: 16 },
};

/** Timing metrics are advisory unless the run is on the reference GPU. */
export const TIMING_METRICS: ReadonlySet<BudgetMetric> = new Set<BudgetMetric>(['frameMs', 'loadMs']);

/** 'inconclusive': the sample would fail or regress, but its window is not comparable (ADR 0053: unknown provenance),
 *  so it proves nothing either way. It never counts as a failure or a regression; the gate re-samples, then reports it. */
export type Verdict = 'pass' | 'warn' | 'fail' | 'advisory' | 'missing' | 'inconclusive';
export interface MetricReport {
  readonly scene: string;
  readonly sample: string;
  readonly metric: BudgetMetric;
  readonly budget: number;
  readonly measured: number | null;
  readonly delta: number | null;       // measured - budget (negative = headroom)
  readonly deltaPct: number | null;
  readonly verdict: Verdict;
  readonly baseline?: number;
  readonly regression?: { readonly delta: number; readonly deltaPct: number; readonly blocking: boolean };
  /** Why a 'missing' row has no number, why a row is inconclusive, or why its baseline was not compared. */
  readonly reason?: string;
  /** The baseline sample exists but is not comparable, so no regression was computed. */
  readonly baselineInconclusive?: boolean;
}
export interface CheckReport {
  readonly tier: Tier;
  readonly rows: readonly MetricReport[];
  readonly failures: number;
  readonly regressions: number;
  readonly warnings: number;
  /** Rows that would fail or regress on a non-comparable sample. Not failures; still not a pass. */
  readonly inconclusive: number;
  readonly ok: boolean;
}

/** False only when the sample's ADR 0053 classification says it is not comparable (unclassified or invalid). */
export function isComparable(s: BenchSample): boolean {
  if(s.scriptedWindow!==undefined)return isWholeScriptedWindow(s);
  return (s.classification as { comparable?: boolean } | undefined)?.comparable !== false;
}

export function limitFor(limit: Limit, tier: Tier): number {
  return typeof limit === 'number' ? limit : limit[tier];
}

export function readMetric(s: BenchSample, metric: BudgetMetric): number | null {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  switch (metric) {
    case 'draws': return n(s.drawsPerRenderedFrame) ?? n(s.drawsPerFrame);
    case 'triangles': return n(s.trisPerRenderedFrame);
    case 'shadowCasters': return n(s.shadowPassDrawsMax);
    case 'shadowDrawsIdle': return n(s.offscreenDrawsPerRenderedFrame);
    case 'chunkKiB': return n(s.chunkKiB);
    case 'textureMiB': return n(s.textureMiB);
    case 'canvasMiB': return n(s.canvasMiB);
    case 'heapMiB': return n(s.heapMB);
    case 'contexts': return n(s.liveContexts);
    // Frame interval of a continuously rendering window (uncapped GPU run), else main-thread ms per frame.
    case 'frameMs': return n(s.frameMs) ?? n(s.taskMsPerFrame);
    case 'idleRenderRatio': {
      // A still scene that issues zero draws in the window has ratio 0, whatever the probe's frame count says.
      const draws = n(s.drawsPerRenderedFrame) ?? n(s.drawsPerFrame);
      return draws === 0 ? 0 : n(s.renderedFrameRatio);
    }
    case 'loadMs': return n(s.enterMs) ?? n(s.appReadyMs);
    case 'loadMiB': return n(s.enterMB) ?? n(s.transferredMB);
    case 'firstLoadJsKiB': return n(s.firstLoadJsKiB) ?? n(s.jsKB);
  }
}

const round = (v: number) => Math.round(v * 100) / 100;
const over = (measured: number, reference: number, t: Tolerance) =>
  measured - reference > Math.max(t.absolute, Math.abs(reference) * t.relative);

export interface CheckOptions {
  readonly tier: Tier;
  readonly baseline?: BenchResult;
  readonly tolerance?: Partial<Record<BudgetMetric, Tolerance>>;
  readonly regression?: Partial<Record<BudgetMetric, Tolerance>>;
  /** True when the run is on the reference GPU, so timings are enforced rather than advisory. */
  readonly realHardware?: boolean;
}

export function checkBudgets(
  result: BenchResult,
  budgets: Readonly<Record<string, CheckBudget>>,
  bindings: readonly SampleBinding[],
  opts: CheckOptions,
): CheckReport {
  const rows: MetricReport[] = [];
  const sampleOf = (r: BenchResult | undefined, key: string): BenchSample | undefined => {
    const v = r?.[key];
    return typeof v === 'object' && v !== null ? v : undefined;
  };
  for (const b of bindings) {
    const budget = budgets[b.scene];
    if (!budget || (b.gpuOnly && !opts.realHardware)) continue;
    const sample = sampleOf(result, b.sample);
    for (const metric of b.metrics) {
      const limit = budget[metric];
      if (limit === undefined) continue;
      const cap = limitFor(limit, opts.tier);
      const measured = sample && !sample.error ? readMetric(sample, metric) : null;
      if (measured === null) {
        rows.push({ scene: b.scene, sample: b.sample, metric, budget: cap, measured: null, delta: null, deltaPct: null, verdict: 'missing',
          reason: sample?.error ?? (sample ? 'metric not measured' : 'no sample') });
        continue;
      }
      const tol = { ...DEFAULT_TOLERANCE, ...opts.tolerance }[metric];
      const delta = measured - cap;
      const deltaPct = cap === 0 ? (measured === 0 ? 0 : Infinity) : delta / cap;
      let verdict: Verdict = delta <= 0 ? 'pass' : over(measured, cap, tol) ? 'fail' : 'warn';
      if (verdict === 'fail' && TIMING_METRICS.has(metric) && !opts.realHardware) verdict = 'advisory';
      let row: MetricReport = { scene: b.scene, sample: b.sample, metric, budget: cap, measured: round(measured), delta: round(delta), deltaPct: round(deltaPct * 100), verdict };
      const base = sampleOf(opts.baseline, b.sample);
      const before = base && !base.error && isComparable(base) ? readMetric(base, metric) : null;
      if (base && !base.error && !isComparable(base)) row = { ...row, baselineInconclusive: true, reason: 'baseline window not comparable: no regression computed' };
      if (before !== null) {
        const reg = { ...DEFAULT_REGRESSION, ...opts.regression }[metric];
        const d = measured - before;
        const blocking = over(measured, before, reg) && !(TIMING_METRICS.has(metric) && !opts.realHardware);
        row = { ...row, baseline: round(before), regression: { delta: round(d), deltaPct: round(before === 0 ? (d === 0 ? 0 : 100) : (d / before) * 100), blocking } };
      }
      if (!isComparable(sample!) && (row.verdict === 'fail' || row.regression?.blocking)) {
        const cls = sample!.classification as { kind?: string; reasons?: string[] } | undefined;
        row = { ...row, verdict: 'inconclusive', ...(row.regression ? { regression: { ...row.regression, blocking: false } } : {}),
          reason: `window ${cls?.kind ?? 'not comparable'}${cls?.reasons?.length ? ': ' + cls.reasons.join('; ') : ''}` };
      }
      rows.push(row);
    }
  }
  const failures = rows.filter(r => r.verdict === 'fail' || r.verdict === 'missing').length;
  const regressions = rows.filter(r => r.regression?.blocking).length;
  const warnings = rows.filter(r => r.verdict === 'warn' || r.verdict === 'advisory').length;
  const inconclusive = rows.filter(r => r.verdict === 'inconclusive').length;
  return { tier: opts.tier, rows, failures, regressions, warnings, inconclusive, ok: failures === 0 && regressions === 0 && inconclusive === 0 };
}

/** Plain-text report for the gate log and the merge summary (local only; nothing is sent anywhere). */
export function formatReport(r: CheckReport): string {
  const verdict = r.ok ? 'PASS' : r.failures || r.regressions ? 'FAIL' : 'INCONCLUSIVE';
  const head = `perf budgets (${r.tier}): ${verdict} · ${r.rows.length} checks · ${r.failures} over budget · ${r.regressions} regressions · ${r.inconclusive} inconclusive · ${r.warnings} warnings`;
  const lines = r.rows
    .filter(x => x.verdict !== 'pass' || x.regression?.blocking || x.baselineInconclusive)
    .map(x => {
      const m = x.measured === null ? 'n/a' : String(x.measured);
      const d = x.delta === null ? '' : ` (${x.delta >= 0 ? '+' : ''}${x.delta}, ${x.deltaPct}%)`;
      const reg = x.regression ? ` · vs baseline ${x.baseline} ${x.regression.delta >= 0 ? '+' : ''}${x.regression.delta}${x.regression.blocking ? ' BLOCKING' : ''}` : '';
      const why = x.reason ? ` · ${x.reason}` : '';
      return `  ${x.verdict.toUpperCase().padEnd(8)} ${x.scene.padEnd(12)} ${x.metric.padEnd(15)} ${m} / ${x.budget}${d}${reg}${why}`;
    });
  return [head, ...lines].join('\n');
}

/**
 * Starting budgets from a measured run: measured value plus headroom, rounded up to a readable step.
 * Used once per scene when it gains a budget; afterwards budgets only move by reviewed edits.
 */
export function deriveBudget(sample: BenchSample, metrics: readonly BudgetMetric[], headroom = 0.1): CheckBudget {
  const step: Record<BudgetMetric, number> = { draws: 10, triangles: 10000, shadowCasters: 10, shadowDrawsIdle: 1, chunkKiB: 16, textureMiB: 8, canvasMiB: 4, heapMiB: 5, contexts: 1, frameMs: 1, idleRenderRatio: 0.05, loadMs: 250, loadMiB: 1, firstLoadJsKiB: 64 };
  const out: Partial<Record<BudgetMetric, Limit>> = {};
  for (const m of metrics) {
    const v = readMetric(sample, m);
    if (v === null) continue;
    const s = step[m];
    out[m] = m === 'contexts' || (m === 'shadowDrawsIdle' && v === 0) ? v
      : m === 'idleRenderRatio' ? Math.min(1, Math.max(s, Math.round(Math.ceil((v * (1 + headroom)) / s) * s * 100) / 100))
      : Math.max(s, Math.ceil((v * (1 + headroom)) / s) * s);
  }
  return out;
}

/** Merge several samples of one scene (idle and active windows, several runs) into their worst values. */
export function worstOf(samples: readonly BenchSample[]): BenchSample {
  const keys = ['drawsPerRenderedFrame', 'trisPerRenderedFrame', 'offscreenDrawsPerRenderedFrame', 'shadowPassDrawsMax', 'textureMiB', 'canvasMiB', 'heapMB', 'liveContexts', 'taskMsPerFrame', 'enterMs', 'enterMB'] as const;
  const out: Record<string, number> = {};
  for (const k of keys) {
    const vals = samples.map(s => s[k]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (vals.length) out[k] = Math.max(...vals);
  }
  return out;
}

/** A budget as the checker reads it. Missing fields are UNMEASURED and skipped; lower presets inherit. */
export function toCheckBudget(b: Ported<Partial<SceneBudgetValues>>): CheckBudget {
  const perTier = Object.fromEntries(QUALITY_PRESETS.map(t => [t, budgetFor(b, t)])) as Record<QualityPreset, Partial<SceneBudgetValues>>;
  const out: Partial<Record<BudgetMetric, Limit>> = {};
  const metrics: readonly (BudgetMetric & keyof SceneBudgetValues)[] = ['draws', 'triangles', 'shadowCasters', 'shadowDrawsIdle', 'idleRenderRatio', 'textureMiB', 'canvasMiB', 'heapMiB', 'contexts', 'frameMs', 'loadMs', 'loadMiB', 'chunkKiB'];
  for (const m of metrics) {
    const ref = perTier.reference[m];
    if (ref === undefined) continue;
    const at = (t: QualityPreset) => perTier[t][m] ?? ref;
    out[m] = QUALITY_PRESETS.every(t => at(t) === ref) ? ref : { reference: ref, high: at('high'), medium: at('medium'), low: at('low') };
  }
  return out;
}

/** A PerfRun as the checker's keyed result: each sample under its id, plus 'startup' and 'afterTour'. */
export function benchResultOf(run: PerfRun): BenchResult {
  const out: Record<string, BenchSample | string> = { profile: `${run.harness}@${run.viewport.width}x${run.viewport.height}` };
  if (run.startup) out.startup = run.startup;
  if (run.afterTour) out.afterTour = run.afterTour;
  for (const s of run.samples) out[s.id] = s as unknown as BenchSample;
  return out;
}
