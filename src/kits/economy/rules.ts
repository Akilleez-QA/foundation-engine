/** Economy rules: resources, buildable items and the cost model, validated into frozen data. */

export class EconomyError extends Error {
  constructor(message: string) {
    super(`economy: ${message}`);
    this.name = 'EconomyError';
  }
}

/** Integer amounts per resource. Choose the unit: 1 metal can be 1,000 units for fractional rates. */
export type Amounts = Readonly<Record<string, number>>;

export interface ResourceInput {
  readonly id: string;
  /** Base storage (≥ 0). Storage sources add to it. */
  readonly capacity: number;
  /** Starting stock (≤ capacity, default 0). */
  readonly initial?: number;
}
export interface ItemInput {
  readonly id: string;
  /** Total cost. Paid at the start (`upfront`) or as work progresses (`streamed`). */
  readonly cost: Amounts;
  /** Ticks to build at rate 1,000 (normal speed). */
  readonly work: number;
  /** Unlock ids that must each have a count above zero when the item starts. */
  readonly requires?: readonly string[];
  /** Unlock ids incremented when the item completes (a lab unlocking a tier). */
  readonly grants?: readonly string[];
}
export interface EconomyRulesInput {
  readonly resources: readonly ResourceInput[];
  readonly items: readonly ItemInput[];
  /** `upfront`: the full cost is taken before work starts. `streamed`: cost is drawn as work progresses, and when
   * stock runs short every queue slows by the same fraction. Default `upfront`. */
  readonly costModel?: 'upfront' | 'streamed';
  /** Percent of the paid cost returned when started work is cancelled (0–100, default 100). */
  readonly refundPercent?: number;
}
export interface Item {
  readonly id: string;
  readonly cost: Amounts;
  readonly work: number;
  readonly requires: readonly string[];
  readonly grants: readonly string[];
}
export interface EconomyRules {
  readonly resources: readonly Readonly<{id: string; capacity: number; initial: number}>[];
  readonly items: readonly Item[];
  readonly costModel: 'upfront' | 'streamed';
  readonly refundPercent: number;
  readonly signature: string;
}

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
export const isEconomyId = (v: unknown): v is string => typeof v === 'string' && ID.test(v);
/** Largest amount, rate or work value: comfortably inside exact integer arithmetic. */
export const MAX_AMOUNT = 1e12;
export const MAX_WORK = 1e9;

export function id(v: unknown, what: string): string {
  if (!isEconomyId(v)) throw new EconomyError(`invalid ${what} ${JSON.stringify(v)}`);
  return v;
}
export function amount(v: unknown, what: string, min = 0, max = MAX_AMOUNT): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max)
    throw new EconomyError(`${what} must be an integer in ${min}..${max}`);
  return v;
}
/** Capture a plain record of own data fields, refusing accessors, symbols and prototypes. */
export function plain(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EconomyError(`${what} must be a record`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new EconomyError(`${what} must be plain data`);
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new EconomyError(`${what} has a symbol key`);
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in d)) throw new EconomyError(`${what} has an accessor`);
    out[key] = d.value;
  }
  return out;
}
/** Validate an amounts record against known resources; zero entries are dropped; keys sorted. */
export function amounts(value: unknown, known: ReadonlySet<string>, what: string, min = 0, max = MAX_AMOUNT): Amounts {
  const raw = plain(value, what);
  const out: Record<string, number> = {};
  for (const key of Object.keys(raw).sort()) {
    if (!known.has(key)) throw new EconomyError(`${what} names unknown resource ${key}`);
    const n = amount(raw[key], `${what}.${key}`, min, max);
    if (n !== 0) out[key] = n;
  }
  return Object.freeze(out);
}
function ids(v: unknown, what: string): readonly string[] {
  if (v === undefined) return Object.freeze([]);
  if (!Array.isArray(v) || v.length > 16) throw new EconomyError(`${what} must be an array of at most 16 ids`);
  return Object.freeze([...new Set(v.map(x => id(x, what)))].sort());
}

const RULES = new WeakSet<object>();
export const isEconomyRules = (v: unknown): v is EconomyRules => typeof v === 'object' && v !== null && RULES.has(v);

export function defineEconomyRules(input: EconomyRulesInput): EconomyRules {
  const raw = plain(input, 'rules');
  if (!Array.isArray(raw.resources) || raw.resources.length < 1 || raw.resources.length > 16)
    throw new EconomyError('rules need 1..16 resources');
  if (!Array.isArray(raw.items) || raw.items.length > 1024) throw new EconomyError('rules allow at most 1,024 items');
  const known = new Set<string>();
  const resources = (raw.resources as unknown[]).map(entry => {
    const r = plain(entry, 'resource');
    const rid = id(r.id, 'resource id');
    if (known.has(rid)) throw new EconomyError(`duplicate resource ${rid}`);
    known.add(rid);
    const capacity = amount(r.capacity, `${rid} capacity`);
    const initial = r.initial === undefined ? 0 : amount(r.initial, `${rid} initial`, 0, capacity);
    return Object.freeze({id: rid, capacity, initial});
  });
  resources.sort((a, b) => (a.id < b.id ? -1 : 1));
  const itemIds = new Set<string>();
  const items = (raw.items as unknown[]).map(entry => {
    const it = plain(entry, 'item');
    const iid = id(it.id, 'item id');
    if (itemIds.has(iid)) throw new EconomyError(`duplicate item ${iid}`);
    itemIds.add(iid);
    return Object.freeze({
      id: iid,
      cost: amounts(it.cost, known, `${iid} cost`),
      work: amount(it.work, `${iid} work`, 1, MAX_WORK),
      requires: ids(it.requires, `${iid} requires`),
      grants: ids(it.grants, `${iid} grants`),
    });
  });
  items.sort((a, b) => (a.id < b.id ? -1 : 1));
  const costModel: 'upfront' | 'streamed' =
    raw.costModel === undefined ? 'upfront' : (raw.costModel as 'upfront' | 'streamed');
  if (costModel !== 'upfront' && costModel !== 'streamed')
    throw new EconomyError('costModel must be upfront or streamed');
  const refundPercent = raw.refundPercent === undefined ? 100 : amount(raw.refundPercent, 'refundPercent', 0, 100);
  const body = {resources: Object.freeze(resources), items: Object.freeze(items), costModel, refundPercent};
  const rules: EconomyRules = Object.freeze({...body, signature: JSON.stringify(body)});
  RULES.add(rules);
  return rules;
}
