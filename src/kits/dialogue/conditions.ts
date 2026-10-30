/**
 * kits/dialogue/conditions.ts: declared dialogue variables, bounded condition trees and assignments.
 *
 * Conditions are JSON data, not an expression language: no parser, no callbacks, no string evaluation. Each tree is
 * validated once against the declared variables and node IDs, so evaluation cannot fail or run unbounded.
 */
export type DialogueValue = boolean | number | string;
export type DialogueVariables = Readonly<Record<string, DialogueValue>>;
export type DialogueOp = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge';
export type DialogueCondition =
  | {readonly var: string; readonly op: DialogueOp; readonly value: DialogueValue}
  | {readonly visits: string; readonly op: DialogueOp; readonly value: number}
  | {readonly fact: string}
  | {readonly all: readonly DialogueCondition[]}
  | {readonly any: readonly DialogueCondition[]}
  | {readonly not: DialogueCondition};
export type DialogueAssignment =
  | {readonly var: string; readonly op: 'set'; readonly value: DialogueValue}
  | {readonly var: string; readonly op: 'add'; readonly value: number};

export const DIALOGUE_LIMITS = Object.freeze({
  maxNodes: 1024,
  maxOptions: 32,
  maxVariables: 256,
  maxStringLength: 256,
  maxConditionNodes: 64,
  maxConditionDepth: 8,
  maxAssignments: 32,
});

const OPS = new Set<string>(['eq', 'ne', 'lt', 'le', 'gt', 'ge']);
const ORDERED = new Set<string>(['lt', 'le', 'gt', 'ge']);
const validName = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;
const kind = (v: unknown) =>
  typeof v === 'boolean'
    ? 'boolean'
    : typeof v === 'number' && Number.isSafeInteger(v)
      ? 'number'
      : typeof v === 'string' && v.length <= DIALOGUE_LIMITS.maxStringLength
        ? 'string'
        : null;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));

/** Validate and copy the declared variables (null-prototype record). */
export function initialVariables(input: unknown): Record<string, DialogueValue> {
  const out: Record<string, DialogueValue> = Object.create(null);
  if (input === undefined) return out;
  if (!isRecord(input) || Object.keys(input).length > DIALOGUE_LIMITS.maxVariables)
    throw Error('dialogue: invalid variables');
  for (const [name, value] of Object.entries(input)) {
    if (!validName(name) || kind(value) === null) throw Error(`dialogue: invalid variable "${name}"`);
    out[name] = value as DialogueValue;
  }
  return out;
}

/** Restore saved values: absent means initial values; every declared name must keep its declared type. */
export function restoreVariables(
  declared: Record<string, DialogueValue>,
  saved: unknown,
): Record<string, DialogueValue> {
  const out: Record<string, DialogueValue> = Object.assign(Object.create(null), declared);
  if (saved === undefined) return out;
  if (!isRecord(saved)) throw Error('dialogue: invalid snapshot variables');
  for (const [name, value] of Object.entries(saved)) {
    if (!Object.hasOwn(declared, name) || kind(value) !== kind(declared[name]))
      throw Error('dialogue: invalid snapshot variables');
    out[name] = value as DialogueValue;
  }
  return out;
}

/** Validate one option's condition tree and assignments against the declared variables and nodes. Throws. */
export function checkConditions(
  when: unknown,
  set: unknown,
  declared: Record<string, DialogueValue>,
  nodes: ReadonlyMap<string, unknown>,
) {
  if (when !== undefined) {
    let count = 0;
    const pending: {c: unknown; depth: number}[] = [{c: when, depth: 0}];
    while (pending.length) {
      const {c, depth} = pending.pop()!;
      if (++count > DIALOGUE_LIMITS.maxConditionNodes || depth >= DIALOGUE_LIMITS.maxConditionDepth)
        throw Error('dialogue: condition too large');
      if (!isRecord(c)) throw Error('dialogue: invalid condition');
      if (exactKeys(c, ['var', 'op', 'value'])) {
        if (
          !Object.hasOwn(declared, c.var as string) ||
          !OPS.has(c.op as string) ||
          kind(c.value) === null ||
          kind(c.value) !== kind(declared[c.var as string])
        )
          throw Error('dialogue: invalid variable condition');
        if (ORDERED.has(c.op as string) && kind(c.value) !== 'number')
          throw Error('dialogue: ordered comparison needs a number');
      } else if (exactKeys(c, ['visits', 'op', 'value'])) {
        if (!nodes.has(c.visits as string) || !OPS.has(c.op as string) || kind(c.value) !== 'number')
          throw Error('dialogue: invalid visits condition');
      } else if (exactKeys(c, ['fact'])) {
        if (!validName(c.fact)) throw Error('dialogue: invalid fact condition');
      } else if (exactKeys(c, ['all']) || exactKeys(c, ['any'])) {
        const list = (c.all ?? c.any) as unknown;
        if (!Array.isArray(list) || list.length > DIALOGUE_LIMITS.maxConditionNodes)
          throw Error('dialogue: invalid condition list');
        for (const child of list) pending.push({c: child, depth: depth + 1});
      } else if (exactKeys(c, ['not'])) pending.push({c: c.not, depth: depth + 1});
      else throw Error('dialogue: invalid condition');
    }
  }
  if (set !== undefined) {
    if (!Array.isArray(set) || set.length > DIALOGUE_LIMITS.maxAssignments)
      throw Error('dialogue: invalid assignments');
    for (const a of set) {
      if (!isRecord(a) || !exactKeys(a, ['var', 'op', 'value']) || !Object.hasOwn(declared, a.var as string))
        throw Error('dialogue: invalid assignment');
      if (a.op === 'set') {
        if (kind(a.value) === null || kind(a.value) !== kind(declared[a.var as string]))
          throw Error('dialogue: assignment changes a variable type');
      } else if (a.op === 'add') {
        if (kind(a.value) !== 'number' || kind(declared[a.var as string]) !== 'number')
          throw Error('dialogue: add needs a number variable');
      } else throw Error('dialogue: invalid assignment');
    }
  }
}

const compare = (op: DialogueOp, a: DialogueValue, b: DialogueValue) =>
  op === 'eq'
    ? a === b
    : op === 'ne'
      ? a !== b
      : op === 'lt'
        ? a < b
        : op === 'le'
          ? a <= b
          : op === 'gt'
            ? a > b
            : a >= b;

/** Evaluate a validated condition. Facts come from the caller and are read through `has` only. */
export function evaluate(
  c: DialogueCondition,
  env: {variables: DialogueVariables; visits(node: string): number; facts: ReadonlySet<string>},
): boolean {
  if ('var' in c) return compare(c.op, env.variables[c.var]!, c.value); // validated against the declared variables
  if ('visits' in c) return compare(c.op, env.visits(c.visits), c.value);
  if ('fact' in c) return env.facts.has(c.fact);
  if ('all' in c) return c.all.every(x => evaluate(x, env));
  if ('any' in c) return c.any.some(x => evaluate(x, env));
  return !evaluate(c.not, env);
}

/** Apply validated assignments in order; null when an addition leaves the safe-integer range (nothing applies). */
export function applyAssignments(
  variables: DialogueVariables,
  set: readonly DialogueAssignment[] | undefined,
): DialogueVariables | null {
  if (!set?.length) return variables;
  const out: Record<string, DialogueValue> = Object.assign(Object.create(null), variables);
  for (const a of set) {
    if (a.op === 'set') out[a.var] = a.value;
    else {
      const next = (out[a.var] as number) + a.value;
      if (!Number.isSafeInteger(next)) return null;
      out[a.var] = next;
    }
  }
  return out;
}
