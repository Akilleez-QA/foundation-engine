// scripts/perf/gate-verdict.ts: the gate's decision over one or two consecutive checks of the same experiment
// (ADR 0053). Pure, so the rules are unit-tested.
// - A check blocks only when it fails (over budget, missing, or a blocking regression) on comparable windows in two
//   consecutive runs.
// - A non-comparable window is never a failure or a regression, but it is not a pass either: if the latest run still
//   leaves a check inconclusive (it would fail on a non-comparable window after the bench's re-sampling, or its window
//   is 'inconclusive'), or only one of the two runs could compare it and that run failed, the gate fails with the label
//   "inconclusive".
import type { CheckReport } from '../../src/platform/perf/budget-check';

export type GateVerdict = 'pass' | 'fail' | 'inconclusive';
export interface GateDecision { verdict: GateVerdict; confirmed: string[]; inconclusive: string[] }

const key = (x: { sample: string; metric: string }) => `${x.sample}|${x.metric}`;
export const failing = (r: CheckReport) => new Set(r.rows.filter(x => x.verdict === 'fail' || x.verdict === 'missing' || x.regression?.blocking).map(key));
export const inconclusiveRows = (r: CheckReport) => new Set(r.rows.filter(x => x.verdict === 'inconclusive').map(key));

export function decide(first: CheckReport, second?: CheckReport): GateDecision {
  if (!second) {
    const confirmed = [...failing(first)], inconclusive = [...inconclusiveRows(first)];
    return { verdict: confirmed.length ? 'fail' : inconclusive.length ? 'inconclusive' : 'pass', confirmed, inconclusive };
  }
  const f1 = failing(first), i1 = inconclusiveRows(first), f2 = failing(second), i2 = inconclusiveRows(second);
  const confirmed = [...f1].filter(k => f2.has(k));
  const inconclusive = [...new Set([...i2, ...[...f2].filter(k => i1.has(k))])];
  return { verdict: confirmed.length ? 'fail' : inconclusive.length ? 'inconclusive' : 'pass', confirmed, inconclusive };
}
