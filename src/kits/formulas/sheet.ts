import {
  captureArray,
  compileExpression,
  DEFAULT_EXPRESSION_LIMITS,
  evaluateExpression,
  FormulaError,
  isFormulaName,
  type CompiledExpression,
  type Expr,
  type ExpressionLimits,
  type RandomSource,
} from './expression';
import {parseFormula} from './parse';

/** One named step: its value can be read by later steps and is returned. `expr` is JSON data or formula text. */
export interface FormulaStepInput {
  readonly id: string;
  readonly expr: Expr | {readonly text: string};
}
export interface FormulaSheetInput {
  /** Names the caller must supply on every evaluation. */
  readonly inputs: readonly string[];
  /** Named constants (tuning). They can be overridden per evaluation only when listed in `inputs` instead. */
  readonly constants?: Readonly<Record<string, number>>;
  /** Steps run in order; a step reads inputs, constants and earlier steps only. */
  readonly steps: readonly FormulaStepInput[];
  readonly limits?: Partial<ExpressionLimits> & {readonly maxSteps?: number; readonly maxInputs?: number};
}
export interface FormulaStep {
  readonly id: string;
  readonly compiled: CompiledExpression;
}
/** A validated, frozen formula sheet: deterministic given its inputs and random draws. */
export interface FormulaSheet {
  readonly inputs: readonly string[];
  readonly constants: Readonly<Record<string, number>>;
  readonly steps: readonly FormulaStep[];
  /** Upper bound on random draws in one evaluation. */
  readonly maxDraws: number;
  /** Total expression nodes: the work bound of one evaluation. */
  readonly nodes: number;
}
export interface FormulaTraceRow {
  readonly id: string;
  readonly value: number;
  readonly draws: number;
}
export interface FormulaResult {
  /** Every step's value by id. */
  readonly values: Readonly<Record<string, number>>;
  /** The last step's value. */
  readonly value: number;
  readonly draws: number;
  /** Present when evaluated with `{trace: true}`: each step's value and draws, in order. */
  readonly trace?: readonly FormulaTraceRow[];
}

function plainRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FormulaError(`${what} must be a record`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new FormulaError(`${what} must be plain data`);
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new FormulaError(`${what} has a symbol key`);
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in d)) throw new FormulaError(`${what} has an accessor`);
    out[key] = d.value;
  }
  return out;
}
function limit(value: unknown, fallback: number, maximum: number, name: string): number {
  const v = value === undefined ? fallback : value;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 || v > maximum)
    throw new FormulaError(`${name} must be an integer in 1..${maximum}`);
  return v;
}

/** Validate and freeze a formula sheet. Unknown names, forward references and duplicate ids are refused here. */
export function defineFormulaSheet(input: FormulaSheetInput): FormulaSheet {
  const raw = plainRecord(input, 'sheet');
  const limits = raw.limits === undefined ? {} : plainRecord(raw.limits, 'limits');
  const exprLimits: ExpressionLimits = {
    maxNodes: limit(limits.maxNodes, DEFAULT_EXPRESSION_LIMITS.maxNodes, 4096, 'maxNodes'),
    maxDepth: limit(limits.maxDepth, DEFAULT_EXPRESSION_LIMITS.maxDepth, 64, 'maxDepth'),
  };
  const maxSteps = limit(limits.maxSteps, 64, 1024, 'maxSteps');
  const maxInputs = limit(limits.maxInputs, 64, 1024, 'maxInputs');
  const inputList = captureArray(raw.inputs, maxInputs, 'inputs');
  const stepList = captureArray(raw.steps, maxSteps, 'steps');
  if (stepList.length < 1) throw new FormulaError(`a sheet needs 1..${maxSteps} steps`);
  const known = new Set<string>();
  const claim = (name: unknown, what: string): string => {
    if (!isFormulaName(name)) throw new FormulaError(`invalid ${what} name ${JSON.stringify(name)}`);
    if (known.has(name)) throw new FormulaError(`duplicate name ${name}`);
    known.add(name);
    return name;
  };
  const inputs = Object.freeze(inputList.map(n => claim(n, 'input')));
  const constants: Record<string, number> = Object.create(null);
  const constRaw = raw.constants === undefined ? {} : plainRecord(raw.constants, 'constants');
  if (Object.keys(constRaw).length > maxInputs) throw new FormulaError('constants exceed maxInputs');
  for (const key of Object.keys(constRaw).sort()) {
    const value = constRaw[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new FormulaError(`constant ${key} must be finite`);
    constants[claim(key, 'constant')] = value;
  }
  const steps: FormulaStep[] = [];
  let maxDraws = 0,
    nodes = 0;
  for (const entry of stepList) {
    const step = plainRecord(entry, 'step');
    if (!isFormulaName(step.id)) throw new FormulaError(`invalid step name ${JSON.stringify(step.id)}`);
    const id = step.id;
    let source: unknown = step.expr;
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      const textual = plainRecord(source, 'step expression');
      if (typeof textual.text !== 'string') throw new FormulaError(`step ${id} expression text must be a string`);
      source = parseFormula(textual.text);
    }
    const compiled = compileExpression(source, exprLimits);
    for (const name of compiled.variables)
      if (!known.has(name)) throw new FormulaError(`step ${id} reads unknown or later name ${name}`);
    claim(id, 'step');
    maxDraws += compiled.maxDraws;
    nodes += compiled.nodes;
    steps.push(Object.freeze({id, compiled}));
  }
  const sheet: FormulaSheet = Object.freeze({
    inputs,
    constants: Object.freeze(constants),
    steps: Object.freeze(steps),
    maxDraws,
    nodes,
  });
  SHEETS.add(sheet);
  return sheet;
}
const SHEETS = new WeakSet<object>();
/** True for a sheet returned by `defineFormulaSheet`; hand-built sheets are refused by evaluation. */
export const isFormulaSheet = (value: unknown): value is FormulaSheet =>
  typeof value === 'object' && value !== null && SHEETS.has(value);

/**
 * Evaluate every step in order. Inputs must be finite numbers for exactly the declared names. A failing step throws
 * FormulaError; random draws already taken are not returned to the source (save the stream's state first if a
 * failure must be retried without advancing it).
 */
export function evaluateSheet(
  sheet: FormulaSheet,
  inputs: Readonly<Record<string, number>>,
  options: {readonly random?: RandomSource; readonly trace?: boolean} = {},
): FormulaResult {
  if (!isFormulaSheet(sheet)) throw new FormulaError('evaluate a sheet from defineFormulaSheet');
  const supplied = plainRecord(inputs, 'inputs');
  const keys = Object.keys(supplied);
  if (keys.length !== sheet.inputs.length) throw new FormulaError('inputs must match the sheet exactly');
  const values = new Map<string, number>();
  for (const name of sheet.inputs) {
    const v = supplied[name];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new FormulaError(`input ${name} must be a finite number`);
    values.set(name, v);
  }
  for (const key of Object.keys(sheet.constants)) values.set(key, sheet.constants[key]!);
  let draws = 0;
  const counted: RandomSource | undefined = options.random
    ? () => {
        draws++;
        return options.random!();
      }
    : undefined;
  const scope = (name: string) => {
    const v = values.get(name);
    if (v === undefined) throw new FormulaError(`unknown name ${name}`);
    return v;
  };
  const out: Record<string, number> = Object.create(null);
  const trace: FormulaTraceRow[] = [];
  let last = 0;
  for (const step of sheet.steps) {
    const before = draws;
    last = evaluateExpression(step.compiled, scope, counted);
    values.set(step.id, last);
    out[step.id] = last;
    if (options.trace) trace.push(Object.freeze({id: step.id, value: last, draws: draws - before}));
  }
  const result: FormulaResult = {values: Object.freeze(out), value: last, draws};
  return Object.freeze(options.trace ? {...result, trace: Object.freeze(trace)} : result);
}
