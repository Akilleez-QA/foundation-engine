import {FormulaError, isFormulaName, type RandomSource} from './expression';
import {evaluateSheet, type FormulaResult, type FormulaSheet} from './sheet';

/**
 * Modifier stacking. Each stage collects contributions and combines them by its rule, then applies the combined term:
 * `add` stages add it, `multiply` stages multiply by (1 + term). Stages run in declared order, so the order is the
 * creator's choice ("flat bonuses, then the strongest buff, then additive surges, then multiplicative resist").
 *
 *   sum      Σ values                 max / min  the largest / smallest value (strongest-only buffs)
 *   product  Π(1 + v) − 1 (multiply stages only: independent multipliers)
 *
 * The combined term is clamped to the stage's [min, max]; a multiply stage's factor never goes below zero.
 */
export interface StackingStageInput {
  readonly id: string;
  readonly apply: 'add' | 'multiply';
  readonly combine: 'sum' | 'max' | 'min' | 'product';
  readonly min?: number;
  readonly max?: number;
}
export interface StackingStage extends Required<Omit<StackingStageInput, 'min' | 'max'>> {
  readonly min: number;
  readonly max: number;
}
export interface Contribution {
  readonly stage: string;
  readonly value: number;
  /** Who supplied it; contributions combine in (source, then supplied) order so sums are reproducible. */
  readonly source: string;
}
export interface StageTrace {
  readonly id: string;
  readonly count: number;
  readonly term: number;
  readonly before: number;
  readonly after: number;
}
export interface Stacking {
  readonly stages: readonly StackingStage[];
  readonly maxContributions: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function defineStacking(stages: readonly StackingStageInput[], maxContributions = 256): Stacking {
  if (!Number.isSafeInteger(maxContributions) || maxContributions < 1 || maxContributions > 4096)
    throw new FormulaError('maxContributions must be an integer in 1..4096');
  if (!Array.isArray(stages) || stages.length > 32) throw new FormulaError('a stacking order has at most 32 stages');
  const seen = new Set<string>();
  const out = stages.map((s): StackingStage => {
    if (!isFormulaName(s.id) || seen.has(s.id)) throw new FormulaError(`invalid or duplicate stage ${String(s.id)}`);
    seen.add(s.id);
    if (s.apply !== 'add' && s.apply !== 'multiply')
      throw new FormulaError(`stage ${s.id}: apply must be add or multiply`);
    if (!['sum', 'max', 'min', 'product'].includes(s.combine)) throw new FormulaError(`stage ${s.id}: invalid combine`);
    if (s.apply === 'add' && s.combine === 'product') throw new FormulaError(`stage ${s.id}: product needs multiply`);
    const min = s.min ?? -Number.MAX_VALUE,
      max = s.max ?? Number.MAX_VALUE;
    if (!finite(min) || !finite(max) || min > max) throw new FormulaError(`stage ${s.id}: invalid bounds`);
    return Object.freeze({id: s.id, apply: s.apply, combine: s.combine, min, max});
  });
  return Object.freeze({stages: Object.freeze(out), maxContributions});
}

/** Apply contributions to a value through the stacking order. Unknown stages and non-finite values throw. */
export function applyStacking(
  stacking: Stacking,
  value: number,
  contributions: readonly Contribution[],
): {readonly value: number; readonly stages: readonly StageTrace[]} {
  if (!finite(value)) throw new FormulaError('stacking value must be finite');
  if (!Array.isArray(contributions) || contributions.length > stacking.maxContributions)
    throw new FormulaError('too many contributions');
  const byStage = new Map<string, {source: string; value: number; index: number}[]>();
  for (const s of stacking.stages) byStage.set(s.id, []);
  contributions.forEach((c, index) => {
    const {stage, value: v, source} = c;
    const rows = typeof stage === 'string' ? byStage.get(stage) : undefined;
    if (!rows) throw new FormulaError(`unknown stage ${String(stage)}`);
    if (!finite(v)) throw new FormulaError('contribution value must be finite');
    if (typeof source !== 'string' || !source.length || source.length > 256)
      throw new FormulaError('contribution source must be a non-empty string');
    rows.push({source, value: v, index});
  });
  const trace: StageTrace[] = [];
  let current = value;
  for (const stage of stacking.stages) {
    const rows = byStage
      .get(stage.id)!
      .sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : a.index - b.index));
    const before = current;
    let term = 0;
    if (rows.length) {
      if (stage.combine === 'sum') term = rows.reduce((s, r) => s + r.value, 0);
      else if (stage.combine === 'max') term = Math.max(...rows.map(r => r.value));
      else if (stage.combine === 'min') term = Math.min(...rows.map(r => r.value));
      else term = rows.reduce((p, r) => p * (1 + r.value), 1) - 1;
      if (!finite(term)) throw new FormulaError(`stage ${stage.id} overflowed`);
      term = Math.min(stage.max, Math.max(stage.min, term));
      current = stage.apply === 'add' ? current + term : current * Math.max(0, 1 + term);
      if (!finite(current)) throw new FormulaError(`stage ${stage.id} overflowed`);
    }
    trace.push(Object.freeze({id: stage.id, count: rows.length, term, before, after: current}));
  }
  return Object.freeze({value: current, stages: Object.freeze(trace)});
}

export interface DamageModelInput {
  /** Base amount, critical rolls and hit checks; evaluated with the caller's random source. */
  readonly sheet: FormulaSheet;
  /** Step holding the pre-modifier amount (default: the sheet's last step). */
  readonly amountStep?: string;
  /** Optional step that is 0 on a miss; a miss skips modifiers and resistance and resolves to 0. */
  readonly hitStep?: string;
  /** Optional step that is non-zero on a critical; reported only (fold the multiplier into the sheet). */
  readonly criticalStep?: string;
  readonly stacking?: Stacking;
  /** Resistance fractions: 0.25 removes a quarter, negative values are weaknesses. Clamped to [min, max]. */
  readonly resistance?: {readonly min?: number; readonly max?: number; readonly immuneAt?: number | null};
  readonly rounding?: 'none' | 'floor' | 'ceil' | 'round' | 'trunc';
  /** Smallest amount a landed, non-immune hit deals (after rounding). Default 0. */
  readonly minimum?: number;
  /** Largest amount (after rounding). Default unbounded. */
  readonly maximum?: number;
}
export interface DamageRequest {
  readonly inputs: Readonly<Record<string, number>>;
  readonly contributions?: readonly Contribution[];
  /** The defender's resistance to this amount's type, already looked up by the caller (e.g. `table[type] ?? 0`). */
  readonly resistance?: number;
}
export interface DamageResult {
  readonly kind: 'hit' | 'miss' | 'immune';
  readonly amount: number;
  readonly critical: boolean;
  readonly base: number;
  readonly resisted: number;
  readonly stages: readonly StageTrace[];
  readonly sheet: FormulaResult;
}
export interface DamageModel {
  readonly config: Readonly<Required<Omit<DamageModelInput, 'hitStep' | 'criticalStep' | 'stacking'>>> & {
    readonly hitStep: string | null;
    readonly criticalStep: string | null;
    readonly stacking: Stacking;
  };
  /** Order: sheet → miss check → stacking stages → resistance (immunity) → rounding → minimum/maximum. */
  resolve(request: DamageRequest, random?: RandomSource): DamageResult;
}

const ROUND = {
  none: (x: number) => x,
  floor: Math.floor,
  ceil: Math.ceil,
  round: (x: number) => (x < 0 ? -Math.round(-x) : Math.round(x)),
  trunc: Math.trunc,
} as const;

export function createDamageModel(input: DamageModelInput): DamageModel {
  const sheet = input.sheet;
  const ids = new Set(sheet.steps.map(s => s.id));
  const step = (name: string | undefined, what: string): string | null => {
    if (name === undefined) return null;
    if (!ids.has(name)) throw new FormulaError(`${what} ${name} is not a sheet step`);
    return name;
  };
  const amountStep = step(input.amountStep, 'amountStep') ?? sheet.steps[sheet.steps.length - 1]!.id;
  const rounding = input.rounding ?? 'none';
  if (!Object.hasOwn(ROUND, rounding)) throw new FormulaError('invalid rounding');
  const minResist = input.resistance?.min ?? -1,
    maxResist = input.resistance?.max ?? 1,
    immuneAt = input.resistance?.immuneAt === undefined ? 1 : input.resistance.immuneAt;
  const minimum = input.minimum ?? 0,
    maximum = input.maximum ?? Number.MAX_VALUE;
  if (!finite(minResist) || !finite(maxResist) || minResist > maxResist || (immuneAt !== null && !finite(immuneAt)))
    throw new FormulaError('invalid resistance bounds');
  if (!finite(minimum) || !finite(maximum) || minimum > maximum) throw new FormulaError('invalid minimum/maximum');
  const config = Object.freeze({
    sheet,
    amountStep,
    hitStep: step(input.hitStep, 'hitStep'),
    criticalStep: step(input.criticalStep, 'criticalStep'),
    stacking: input.stacking ?? defineStacking([]),
    resistance: Object.freeze({min: minResist, max: maxResist, immuneAt}),
    rounding,
    minimum,
    maximum,
  });
  return Object.freeze({
    config,
    resolve(request: DamageRequest, random?: RandomSource): DamageResult {
      const result = evaluateSheet(sheet, request.inputs, random ? {random} : {});
      const base = result.values[amountStep]!;
      const critical = config.criticalStep !== null && result.values[config.criticalStep] !== 0;
      const empty = Object.freeze([]) as readonly StageTrace[];
      if (config.hitStep !== null && result.values[config.hitStep] === 0)
        return Object.freeze({
          kind: 'miss',
          amount: 0,
          critical: false,
          base,
          resisted: 0,
          stages: empty,
          sheet: result,
        });
      const stacked = applyStacking(config.stacking, base, request.contributions ?? []);
      const supplied = request.resistance ?? 0;
      if (!finite(supplied)) throw new FormulaError('resistance must be finite');
      const resisted = Math.min(maxResist, Math.max(minResist, supplied));
      if (immuneAt !== null && supplied >= immuneAt)
        return Object.freeze({
          kind: 'immune',
          amount: 0,
          critical,
          base,
          resisted,
          stages: stacked.stages,
          sheet: result,
        });
      const after = stacked.value * (1 - resisted);
      if (!finite(after)) throw new FormulaError('resistance overflowed');
      const amount = Math.min(maximum, Math.max(minimum, ROUND[rounding](after)));
      return Object.freeze({kind: 'hit', amount, critical, base, resisted, stages: stacked.stages, sheet: result});
    },
  });
}
