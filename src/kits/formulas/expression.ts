import {dmath} from '../../core/dmath';

/**
 * Data-defined arithmetic. An expression is JSON: a finite number, a variable name, or an array whose first element is
 * an operator name and whose remaining elements are expressions: `['mul', 'attack', ['add', 'level', 3]]`.
 * Evaluation uses only correctly rounded IEEE operations and the engine's deterministic `dmath`, so the same inputs
 * and random draws give the same bits in every conforming JavaScript engine.
 */
export type Expr = number | string | readonly [string, ...Expr[]];

/** Random source: `ctx.random`, `rng.next`, or a saveable stream's `next`. Must return a number in [0, 1). */
export type RandomSource = () => number;

export interface ExpressionLimits {
  /** Maximum nodes in one expression (1–4096, default 512). */
  readonly maxNodes: number;
  /** Maximum nesting depth (1–64, default 32). */
  readonly maxDepth: number;
}
export const DEFAULT_EXPRESSION_LIMITS: ExpressionLimits = Object.freeze({maxNodes: 512, maxDepth: 32});

export class FormulaError extends Error {
  constructor(message: string) {
    super(`formulas: ${message}`);
    this.name = 'FormulaError';
  }
}

const NAME = /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/;
/** A variable name: a letter or underscore, then letters, digits, `_` or `.`; at most 64 characters. */
export function isFormulaName(value: unknown): value is string {
  return typeof value === 'string' && NAME.test(value) && !Object.hasOwn(OPERATORS, value);
}

type Arity = readonly [min: number, max: number];
/** Operator table: name -> argument count range. Variadic operators use a maximum of 64. */
const OPERATORS: Readonly<Record<string, Arity>> = Object.freeze({
  add: [2, 64],
  sub: [2, 2],
  mul: [2, 64],
  div: [2, 2],
  idiv: [2, 2],
  mod: [2, 2],
  neg: [1, 1],
  abs: [1, 1],
  min: [1, 64],
  max: [1, 64],
  clamp: [3, 3],
  floor: [1, 1],
  ceil: [1, 1],
  round: [1, 1],
  trunc: [1, 1],
  sqrt: [1, 1],
  pow: [2, 2],
  exp: [1, 1],
  log: [1, 1],
  lt: [2, 2],
  le: [2, 2],
  gt: [2, 2],
  ge: [2, 2],
  eq: [2, 2],
  ne: [2, 2],
  and: [2, 64],
  or: [2, 64],
  not: [1, 1],
  if: [3, 3],
  rand: [0, 0],
  roll: [1, 1],
  chance: [1, 1],
});
export const FORMULA_OPERATORS: readonly string[] = Object.freeze(Object.keys(OPERATORS));

/** A validated, frozen expression with the variables it reads and the most random draws one evaluation can take. */
export interface CompiledExpression {
  readonly expr: Expr;
  readonly variables: readonly string[];
  readonly maxDraws: number;
  readonly nodes: number;
}

function denseArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    throw new FormulaError('expected an array');
  const length: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length > 65)
    throw new FormulaError('operator has too many arguments');
  if (Reflect.ownKeys(value).length !== length + 1) throw new FormulaError('expected a dense data array');
  const out: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d)) throw new FormulaError('expected array data');
    out.push(d.value);
  }
  return out;
}

/** Validate and detach an expression. Throws FormulaError on unknown operators, wrong arity or exceeded limits. */
export function compileExpression(
  input: unknown,
  limits: ExpressionLimits = DEFAULT_EXPRESSION_LIMITS,
): CompiledExpression {
  const maxNodes = bound(limits.maxNodes, 4096, 'maxNodes');
  const maxDepth = bound(limits.maxDepth, 64, 'maxDepth');
  const variables = new Set<string>();
  let nodes = 0;
  const walk = (value: unknown, depth: number): {expr: Expr; draws: number} => {
    if (++nodes > maxNodes) throw new FormulaError('expression node limit');
    if (depth > maxDepth) throw new FormulaError('expression depth limit');
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new FormulaError('literal must be finite');
      return {expr: value, draws: 0};
    }
    if (typeof value === 'string') {
      if (!isFormulaName(value)) throw new FormulaError(`invalid variable name ${JSON.stringify(value)}`);
      variables.add(value);
      return {expr: value, draws: 0};
    }
    const items = denseArray(value);
    const op = items[0];
    if (typeof op !== 'string' || !Object.hasOwn(OPERATORS, op))
      throw new FormulaError(`unknown operator ${String(op)}`);
    const [min, max] = OPERATORS[op]!;
    const count = items.length - 1;
    if (count < min || count > max) throw new FormulaError(`${op} takes ${min}–${max} arguments, got ${count}`);
    const args: Expr[] = [];
    let draws = op === 'rand' || op === 'roll' || op === 'chance' ? 1 : 0;
    let branchDraws = 0;
    for (let i = 1; i < items.length; i++) {
      const child = walk(items[i], depth + 1);
      args.push(child.expr);
      // `if` evaluates its condition and one branch; record the costlier branch.
      if (op === 'if' && i > 1) branchDraws = Math.max(branchDraws, child.draws);
      else draws += child.draws;
    }
    return {expr: Object.freeze([op, ...args]) as Expr, draws: draws + branchDraws};
  };
  const result = walk(input, 1);
  return Object.freeze({
    expr: result.expr,
    variables: Object.freeze([...variables].sort()),
    maxDraws: result.draws,
    nodes,
  });
}

function bound(value: unknown, maximum: number, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new FormulaError(`${name} must be an integer in 1..${maximum}`);
  return value;
}

/** Variable lookup used during evaluation. */
export type Scope = (name: string) => number;

const finiteResult = (value: number, op: string): number => {
  if (!Number.isFinite(value)) throw new FormulaError(`${op} produced a non-finite value`);
  return value;
};
const truthy = (value: number) => value !== 0;
/** Round half away from zero (Math.round rounds half up, which is asymmetric for negatives). */
const roundHalfAway = (x: number) => (x < 0 ? -Math.round(-x) : Math.round(x));
const draw = (random: RandomSource): number => {
  const unit = random();
  if (typeof unit !== 'number' || !Number.isFinite(unit) || unit < 0 || unit >= 1)
    throw new FormulaError('random source must return a number in [0, 1)');
  return unit;
};

/**
 * Evaluate a compiled expression. Every intermediate result must be finite; division and modulo by zero, the square
 * root or logarithm of a negative number and non-integer powers of negative numbers throw. `if`, `and` and `or`
 * short-circuit, so only the branch taken draws random numbers; evaluation order is left to right.
 */
export function evaluateExpression(expr: Expr, scope: Scope, random?: RandomSource): number {
  if (typeof expr === 'number') return expr;
  if (typeof expr === 'string') return scope(expr);
  const op = expr[0];
  const args = expr.slice(1) as Expr[];
  const at = (i: number) => evaluateExpression(args[i]!, scope, random);
  const all = () => args.map(arg => evaluateExpression(arg, scope, random));
  switch (op) {
    case 'add':
      return finiteResult(
        all().reduce((s, v) => s + v, 0),
        op,
      );
    case 'sub':
      return finiteResult(at(0) - at(1), op);
    case 'mul':
      return finiteResult(
        all().reduce((s, v) => s * v, 1),
        op,
      );
    case 'div': {
      const a = at(0),
        b = at(1);
      if (b === 0) throw new FormulaError('division by zero');
      return finiteResult(a / b, op);
    }
    case 'idiv': {
      const a = at(0),
        b = at(1);
      if (b === 0) throw new FormulaError('division by zero');
      return finiteResult(Math.trunc(a / b), op);
    }
    case 'mod': {
      const a = at(0),
        b = at(1);
      if (b === 0) throw new FormulaError('modulo by zero');
      return finiteResult(a % b, op);
    }
    case 'neg':
      return -at(0) + 0;
    case 'abs':
      return Math.abs(at(0));
    case 'min':
      return Math.min(...all());
    case 'max':
      return Math.max(...all());
    case 'clamp': {
      const x = at(0),
        lo = at(1),
        hi = at(2);
      if (lo > hi) throw new FormulaError('clamp lower bound exceeds upper bound');
      return Math.min(hi, Math.max(lo, x));
    }
    case 'floor':
      return Math.floor(at(0));
    case 'ceil':
      return Math.ceil(at(0));
    case 'round':
      return roundHalfAway(at(0));
    case 'trunc':
      return Math.trunc(at(0));
    case 'sqrt': {
      const x = at(0);
      if (x < 0) throw new FormulaError('square root of a negative number');
      return Math.sqrt(x);
    }
    case 'pow': {
      const x = at(0),
        y = at(1);
      if (x < 0 && !Number.isInteger(y)) throw new FormulaError('non-integer power of a negative number');
      if (x === 0 && y < 0) throw new FormulaError('negative power of zero');
      return finiteResult(dmath.pow(x, y), op);
    }
    case 'exp':
      return finiteResult(dmath.exp(at(0)), op);
    case 'log': {
      const x = at(0);
      if (x <= 0) throw new FormulaError('logarithm of a non-positive number');
      return dmath.log(x);
    }
    case 'lt':
      return at(0) < at(1) ? 1 : 0;
    case 'le':
      return at(0) <= at(1) ? 1 : 0;
    case 'gt':
      return at(0) > at(1) ? 1 : 0;
    case 'ge':
      return at(0) >= at(1) ? 1 : 0;
    case 'eq':
      return at(0) === at(1) ? 1 : 0;
    case 'ne':
      return at(0) !== at(1) ? 1 : 0;
    case 'and':
      for (let i = 0; i < args.length; i++) if (!truthy(at(i))) return 0;
      return 1;
    case 'or':
      for (let i = 0; i < args.length; i++) if (truthy(at(i))) return 1;
      return 0;
    case 'not':
      return truthy(at(0)) ? 0 : 1;
    case 'if':
      return truthy(at(0)) ? at(1) : at(2);
    case 'rand':
      if (!random) throw new FormulaError('rand needs a random source');
      return draw(random);
    case 'roll': {
      const sides = at(0);
      if (!Number.isSafeInteger(sides) || sides < 1 || sides > 2 ** 32)
        throw new FormulaError('roll needs an integer side count in 1..2^32');
      if (!random) throw new FormulaError('roll needs a random source');
      return Math.floor(draw(random) * sides);
    }
    case 'chance': {
      const p = at(0);
      if (!random) throw new FormulaError('chance needs a random source');
      return draw(random) < p ? 1 : 0;
    }
  }
  throw new FormulaError(`unknown operator ${String(op)}`);
}
