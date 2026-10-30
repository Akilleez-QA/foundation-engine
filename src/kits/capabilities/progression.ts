/** Stateless preparation; the enclosing world owns receipts, persistence and acceptance. */
export interface ProgressionBounds {
  xpTypes: number;
  skills: number;
  prerequisites: number;
  grants: number;
  learned: number;
}
export interface ProgressionSkill {
  id: string;
  xpType: string;
  xpCost: number;
  pointCost: number;
  requires: string[];
  certificates: string[];
  schematics: string[];
}
export interface ProgressionRules {
  /** Change this identity when authored rules require a saved-state migration. */
  id: string;
  allocationLimit: number;
  xpTypes: {id: string; maxBalance: number}[];
  skills: ProgressionSkill[];
}
export interface ProgressionState {
  version: 1;
  rulesId: string;
  xp: {type: string; balance: number}[];
  learned: string[];
  /** Validated against the sum of learned skill costs, never trusted independently. */
  spentAllocation: number;
}
export interface ProgressionGrants {
  certificates: string[];
  schematics: string[];
}
export type ProgressionChange =
  {kind: 'earn' | 'spend'; xpType: string; amount: number} | {kind: 'learn' | 'surrender'; skill: string};
export type ProgressionFailure =
  | 'invalid'
  | 'limit'
  | 'unknown'
  | 'cycle'
  | 'rules-mismatch'
  | 'prerequisites'
  | 'dependent'
  | 'allocation'
  | 'insufficient-xp'
  | 'xp-capacity'
  | 'already-learned'
  | 'not-learned';
export type ProgressionCandidate =
  {ok: true; state: ProgressionState; grants: ProgressionGrants} | {ok: false; reason: ProgressionFailure};
class Invalid extends Error {
  constructor(readonly reason: ProgressionFailure) {
    super(`progression: ${reason}`);
  }
}
const fail = (reason: ProgressionFailure): never => {
  throw new Invalid(reason);
};
const id = (raw: unknown): string =>
  typeof raw === 'string' && raw.length > 0 && raw.length <= 256 ? raw : fail('invalid');
const count = (raw: unknown): number =>
  typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? (raw === 0 ? 0 : raw) : fail('invalid');
function record(raw: unknown, fields: readonly string[]): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fail('invalid');
  const keys = Object.keys(raw);
  if (keys.length !== fields.length || keys.some(k => !fields.includes(k))) return fail('invalid');
  return raw as Record<string, unknown>;
}
/** Indexed capture rejects holes and does not invoke caller iteration methods. */
function capture<T>(raw: unknown, max: number, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(raw)) return fail('invalid');
  const length = count(raw.length);
  if (length > max) return fail('limit');
  const values: T[] = [];
  for (let i = 0; i < length; i++) values.push(parse(raw[i]));
  return values;
}
function ids(raw: unknown, max: number): string[] {
  const values = capture(raw, max, id);
  if (new Set(values).size !== values.length) return fail('invalid');
  return values.sort();
}
function unique<T extends {id: string}>(values: T[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (result.has(value.id)) return fail('invalid');
    result.set(value.id, value);
  }
  return result;
}
const ordered = <T extends {id: string}>(values: T[]): T[] =>
  values.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
function bounds(raw: ProgressionBounds): ProgressionBounds {
  const b = record(raw, ['xpTypes', 'skills', 'prerequisites', 'grants', 'learned']);
  return {
    xpTypes: count(b.xpTypes),
    skills: count(b.skills),
    prerequisites: count(b.prerequisites),
    grants: count(b.grants),
    learned: count(b.learned),
  };
}
function rules(raw: unknown, b: ProgressionBounds): ProgressionRules {
  const r = record(raw, ['id', 'allocationLimit', 'xpTypes', 'skills']);
  const rulesId = id(r.id),
    allocationLimit = count(r.allocationLimit);
  const xpTypes = capture(r.xpTypes, b.xpTypes, value => {
    const x = record(value, ['id', 'maxBalance']);
    return {id: id(x.id), maxBalance: count(x.maxBalance)};
  });
  const types = unique(xpTypes);
  let remainingPrerequisites = b.prerequisites,
    remainingGrants = b.grants;
  const skills = capture(r.skills, b.skills, value => {
    const s = record(value, ['id', 'xpType', 'xpCost', 'pointCost', 'requires', 'certificates', 'schematics']);
    const skillId = id(s.id),
      xpType = id(s.xpType),
      xpCost = count(s.xpCost),
      pointCost = count(s.pointCost);
    const requires = ids(s.requires, remainingPrerequisites);
    remainingPrerequisites -= requires.length;
    const certificates = ids(s.certificates, remainingGrants);
    remainingGrants -= certificates.length;
    const schematics = ids(s.schematics, remainingGrants);
    remainingGrants -= schematics.length;
    if (!types.has(xpType)) return fail('unknown');
    return {id: skillId, xpType, xpCost, pointCost, requires, certificates, schematics};
  });
  const nodes = unique(skills),
    pending = new Map<string, number>(),
    dependents = new Map<string, string[]>();
  for (const s of skills) {
    pending.set(s.id, s.requires.length);
    for (const required of s.requires) {
      if (!nodes.has(required)) return fail('unknown');
      const children = dependents.get(required) ?? [];
      children.push(s.id);
      dependents.set(required, children);
    }
  }
  // Iterative DAG validation does not exhaust the call stack for deep authored trees.
  const ready = skills.filter(s => s.requires.length === 0).map(s => s.id);
  for (let i = 0; i < ready.length; i++) {
    for (const child of dependents.get(ready[i]!) ?? []) {
      // i < ready.length
      const left = pending.get(child)! - 1;
      pending.set(child, left);
      if (left === 0) ready.push(child);
    }
  }
  if (ready.length !== skills.length) return fail('cycle');
  return {id: rulesId, allocationLimit, xpTypes: ordered(xpTypes), skills: ordered(skills)};
}
/** Validate and detach bounded authored data. Throws on invalid definitions. */
export function parseProgressionRules(raw: unknown, inputBounds: ProgressionBounds): ProgressionRules {
  return rules(raw, bounds(inputBounds));
}
function state(raw: unknown, r: ProgressionRules, b: ProgressionBounds): ProgressionState {
  const s = record(raw, ['version', 'rulesId', 'xp', 'learned', 'spentAllocation']);
  if (s.version !== 1) return fail('invalid');
  if (id(s.rulesId) !== r.id) return fail('rules-mismatch');
  const types = new Map(r.xpTypes.map(t => [t.id, t]));
  const xp = capture(s.xp, b.xpTypes, value => {
    const x = record(value, ['type', 'balance']),
      type = id(x.type),
      balance = count(x.balance),
      definition = types.get(type);
    if (!definition) return fail('unknown');
    if (balance > definition.maxBalance) return fail('xp-capacity');
    return {type, balance};
  });
  if (xp.length !== types.size || new Set(xp.map(x => x.type)).size !== xp.length) return fail('invalid');
  const learned = ids(s.learned, b.learned),
    learnedSet = new Set(learned),
    nodes = new Map(r.skills.map(skill => [skill.id, skill]));
  let spent = 0;
  for (const skill of learned) {
    const definition = nodes.get(skill);
    if (!definition) return fail('unknown');
    if (definition.requires.some(p => !learnedSet.has(p))) return fail('prerequisites');
    if (definition.pointCost > r.allocationLimit - spent) return fail('allocation');
    spent += definition.pointCost;
  }
  if (count(s.spentAllocation) !== spent) return fail('allocation');
  return {
    version: 1,
    rulesId: r.id,
    xp: xp.sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0)),
    learned,
    spentAllocation: spent,
  };
}
/** Strict restore; never repairs, resets, or migrates corrupt saved state. */
export function parseProgressionState(
  raw: unknown,
  inputRules: ProgressionRules,
  inputBounds: ProgressionBounds,
): ProgressionState {
  const b = bounds(inputBounds);
  return state(raw, rules(inputRules, b), b);
}
export function createProgressionState(inputRules: ProgressionRules, inputBounds: ProgressionBounds): ProgressionState {
  const r = rules(inputRules, bounds(inputBounds));
  return {
    version: 1,
    rulesId: r.id,
    xp: r.xpTypes.map(t => ({type: t.id, balance: 0})),
    learned: [],
    spentAllocation: 0,
  };
}
export interface ProgressionGrantSource {
  readonly kind: 'certificate' | 'schematic';
  readonly id: string;
  readonly skills: readonly string[];
}
export type ProgressionInspectionFacts =
  | Readonly<{
      kind: 'earn' | 'spend';
      xpType: string;
      amount: number;
      balance: number;
      maxBalance: number;
    }>
  | Readonly<{
      kind: 'learn' | 'surrender';
      skill: string;
      learned: boolean;
      xpType: string;
      xpCost: number;
      balance: number;
      pointCost: number;
      spentAllocation: number;
      allocationLimit: number;
      learnedCount: number;
      learnedLimit: number;
      missingPrerequisites: readonly string[];
      learnedDependents: readonly string[];
    }>;
export type ProgressionInspection =
  | Readonly<{
      ok: true;
      eligible: boolean;
      reason: ProgressionFailure | null;
      blockers: readonly ProgressionFailure[];
      facts: ProgressionInspectionFacts;
    }>
  | Readonly<{ok: false; reason: ProgressionFailure}>;
function grantProjection(s: ProgressionState, r: ProgressionRules, includeSources = false) {
  const learned = new Set(s.learned),
    certificates = new Map<string, string[]>(),
    schematics = new Map<string, string[]>();
  // Both presence and provenance are derived from this one captured learned/rules traversal.
  for (const skill of r.skills)
    if (learned.has(skill.id)) {
      for (const [map, ids] of [
        [certificates, skill.certificates],
        [schematics, skill.schematics],
      ] as const) {
        for (const value of ids) {
          const contributors = map.get(value) ?? [];
          if (includeSources) contributors.push(skill.id);
          map.set(value, contributors);
        }
      }
    }
  const grants = {certificates: [...certificates.keys()].sort(), schematics: [...schematics.keys()].sort()};
  const sources: ProgressionGrantSource[] = [];
  if (includeSources)
    for (const [kind, map, ids] of [
      ['certificate', certificates, grants.certificates],
      ['schematic', schematics, grants.schematics],
    ] as const) {
      for (const id of ids) sources.push(Object.freeze({kind, id, skills: Object.freeze(map.get(id)!)}));
    }
  return {grants, sources: Object.freeze(sources)};
}
/** Skill-derived grants only; external possession and its provenance remain creator-owned. */
export function deriveProgressionGrants(
  raw: unknown,
  inputRules: ProgressionRules,
  inputBounds: ProgressionBounds,
): ProgressionGrants {
  const b = bounds(inputBounds),
    r = rules(inputRules, b);
  return grantProjection(state(raw, r, b), r).grants;
}
/** Frozen accepted-state contributors, distinct by grant kind even when ids match. */
export function deriveProgressionGrantSources(
  raw: unknown,
  inputRules: ProgressionRules,
  inputBounds: ProgressionBounds,
): readonly ProgressionGrantSource[] {
  const b = bounds(inputBounds),
    r = rules(inputRules, b);
  return grantProjection(state(raw, r, b), r, true).sources;
}
function assess(s: ProgressionState, change: ProgressionChange, r: ProgressionRules, b: ProgressionBounds) {
  if (change === null || typeof change !== 'object') return fail('invalid');
  const kind = change.kind,
    blockers: ProgressionFailure[] = [];
  let facts: ProgressionInspectionFacts;
  if (kind === 'earn' || kind === 'spend') {
    const c = record(change, ['kind', 'xpType', 'amount']),
      type = id(c.xpType),
      amount = count(c.amount);
    if (amount === 0) return fail('invalid');
    const balance = s.xp.find(x => x.type === type),
      definition = r.xpTypes.find(t => t.id === type);
    if (!balance || !definition) return fail('unknown');
    if (kind === 'earn' && amount > definition.maxBalance - balance.balance) blockers.push('xp-capacity');
    if (kind === 'spend' && amount > balance.balance) blockers.push('insufficient-xp');
    facts = Object.freeze({kind, xpType: type, amount, balance: balance.balance, maxBalance: definition.maxBalance});
  } else if (kind === 'learn' || kind === 'surrender') {
    const c = record(change, ['kind', 'skill']),
      skill = id(c.skill),
      definition = r.skills.find(s => s.id === skill);
    if (!definition) return fail('unknown');
    const learned = new Set(s.learned),
      balance = s.xp.find(x => x.type === definition.xpType)!;
    const missingPrerequisites = Object.freeze(definition.requires.filter(p => !learned.has(p)));
    const learnedDependents = Object.freeze(
      r.skills.filter(other => learned.has(other.id) && other.requires.includes(skill)).map(other => other.id),
    );
    if (kind === 'learn') {
      // This order is the existing preparation contract, including the learned-count limit.
      if (learned.has(skill)) blockers.push('already-learned');
      if (missingPrerequisites.length) blockers.push('prerequisites');
      if (s.learned.length >= b.learned) blockers.push('limit');
      if (definition.pointCost > r.allocationLimit - s.spentAllocation) blockers.push('allocation');
      if (definition.xpCost > balance.balance) blockers.push('insufficient-xp');
    } else {
      if (!learned.has(skill)) blockers.push('not-learned');
      if (learnedDependents.length) blockers.push('dependent');
    }
    facts = Object.freeze({
      kind,
      skill,
      learned: learned.has(skill),
      xpType: definition.xpType,
      xpCost: definition.xpCost,
      balance: balance.balance,
      pointCost: definition.pointCost,
      spentAllocation: s.spentAllocation,
      allocationLimit: r.allocationLimit,
      learnedCount: s.learned.length,
      learnedLimit: b.learned,
      missingPrerequisites,
      learnedDependents,
    });
  } else return fail('invalid');
  return Object.freeze({
    ok: true as const,
    eligible: blockers.length === 0,
    reason: blockers[0] ?? null,
    blockers: Object.freeze(blockers),
    facts,
  });
}
/** Progression-only eligibility, not admission of coupled inventory, receipts, permissions or persistence. */
export function inspectProgressionChange(
  raw: unknown,
  change: ProgressionChange,
  inputRules: ProgressionRules,
  inputBounds: ProgressionBounds,
): ProgressionInspection {
  try {
    const b = bounds(inputBounds),
      r = rules(inputRules, b),
      s = state(raw, r, b);
    return assess(s, change, r, b);
  } catch (error) {
    if (error instanceof Invalid) return Object.freeze({ok: false, reason: error.reason});
    throw error;
  }
}
/**
 * One pure candidate transition. Repeated earn/spend is NOT idempotent: the enclosing
 * world validates accepted events, deduplicates receipts and publishes all coupled state.
 * Surrender refunds allocation only; spent XP remains spent.
 */
export function prepareProgressionChange(
  raw: unknown,
  change: ProgressionChange,
  inputRules: ProgressionRules,
  inputBounds: ProgressionBounds,
): ProgressionCandidate {
  try {
    const b = bounds(inputBounds),
      r = rules(inputRules, b),
      s = state(raw, r, b),
      assessment = assess(s, change, r, b);
    if (assessment.reason) return {ok: false, reason: assessment.reason};
    const facts = assessment.facts,
      balance = s.xp.find(x => x.type === facts.xpType)!;
    if ('amount' in facts) balance.balance += facts.kind === 'earn' ? facts.amount : -facts.amount;
    else if (facts.kind === 'learn') {
      balance.balance -= facts.xpCost;
      s.spentAllocation += facts.pointCost;
      s.learned.push(facts.skill);
      s.learned.sort();
    } else {
      s.spentAllocation -= facts.pointCost;
      s.learned = s.learned.filter(value => value !== facts.skill);
    }
    return {ok: true, state: s, grants: grantProjection(s, r).grants};
  } catch (error) {
    if (error instanceof Invalid) return {ok: false, reason: error.reason};
    throw error;
  }
}
