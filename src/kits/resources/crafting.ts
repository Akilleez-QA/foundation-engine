import {
  parseDimensionalStock,
  prepareStockChange,
  type DimensionalStock,
  type StockBatch,
  type StockBounds,
} from '../inventory/dimensional.js';
import type {IndustrialPlan} from './industry.js';

export interface CraftBounds {
  slots: number;
  selections: number;
  attributes: number;
  weights: number;
  points: number;
  steps: number;
  properties: number;
}
export interface CraftSelection {
  slot: string;
  container: string;
  batch: string;
  quantity: number;
}
export interface CraftAttribute {
  id: string;
  weights: {slot: string; property: string; weight: number}[];
  initialPermille: number;
  gainPermille: number;
  effectPermille: number;
}
/** Integer affine model: base + sum(floor(attribute * coefficient / 1000)). */
export interface CraftModel {
  base: number;
  terms: {attribute: string; coefficient: number}[];
}
export interface CraftRecipe {
  id: string;
  version: number;
  pointLimit: number;
  slots: {id: string; materials: string[]; unit: string; quantity: number}[];
  attributes: CraftAttribute[];
  output: {
    material: string;
    unit: string;
    phase: string;
    massMg: CraftModel;
    volumeUl: CraftModel;
    properties: Record<string, CraftModel>;
  };
  scrap: Omit<StockBatch, 'id'>;
  workJ: number;
  maxPowerW: number;
}
/** Outcomes come from the enclosing accepted action. No random source or stock owner exists here. */
export interface CraftStep {
  attribute: string;
  points: number;
  effectPermille: number;
}
export interface CraftExperiment {
  version: 1;
  id: string;
  recipe: string;
  recipeVersion: number;
  pointBudget: number;
  selections: CraftSelection[];
  steps: CraftStep[];
  locked: boolean;
}
export interface CraftValues {
  id: string;
  ceiling: number;
  value: number;
}
export interface CraftManifest {
  version: 1;
  id: string;
  experiment: CraftExperiment;
  values: CraftValues[];
  plan: IndustrialPlan;
}
export interface CraftInput {
  stock: DimensionalStock;
  stockBounds: StockBounds;
  bounds: CraftBounds;
}
const fail = (s: string): never => {
  throw Error(`crafting: ${s}`);
};
const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : fail('record');
const id = (v: unknown): string => (typeof v === 'string' && v.length > 0 && v.length <= 256 ? v : fail('id'));
const num = (v: unknown, max = Number.MAX_SAFE_INTEGER, min = 0): number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max && !Object.is(v, -0) ? v : fail('integer');
function list<T>(raw: unknown, max: number, read: (v: unknown) => T): T[] {
  if (!Array.isArray(raw)) return fail('array');
  const n = num(raw.length, max);
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(read(raw[i]));
  return out;
}
function unique<T>(items: T[], key: (v: T) => string): T[] {
  if (new Set(items.map(key)).size !== items.length) fail('duplicate');
  return items;
}
const exact = (v: bigint): number => (v >= 0n && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : fail('overflow'));
function bounds(raw: CraftBounds): CraftBounds {
  const r = rec(raw);
  return {
    slots: num(r.slots, 1024, 1),
    selections: num(r.selections, 4096, 1),
    attributes: num(r.attributes, 128, 1),
    weights: num(r.weights, 4096, 1),
    points: num(r.points, 1024),
    steps: num(r.steps, 1024),
    properties: num(r.properties, 128),
  };
}
function recipe(raw: unknown, b: CraftBounds): CraftRecipe {
  const r = rec(raw),
    slots = unique(
      list(r.slots, b.slots, v => {
        const s = rec(v);
        return {
          id: id(s.id),
          materials: unique(list(s.materials, b.selections, id), x => x).sort(),
          unit: id(s.unit),
          quantity: num(s.quantity, Number.MAX_SAFE_INTEGER, 1),
        };
      }),
      s => s.id,
    );
  if (!slots.length || slots.some(s => !s.materials.length)) fail('slots');
  const attributes = unique(
    list(r.attributes, b.attributes, v => {
      const a = rec(v);
      const weights = list(a.weights, b.weights, v => {
        const w = rec(v);
        return {slot: id(w.slot), property: id(w.property), weight: num(w.weight, 1000000, 1)};
      });
      if (!weights.length || weights.some(w => !slots.some(s => s.id === w.slot))) fail('weights');
      return {
        id: id(a.id),
        weights,
        initialPermille: num(a.initialPermille, 1000),
        gainPermille: num(a.gainPermille, 1000),
        effectPermille: num(a.effectPermille, 1000, -1000),
      };
    }),
    a => a.id,
  );
  const model = (v: unknown): CraftModel => {
    const m = rec(v),
      terms = unique(
        list(m.terms, b.attributes, v => {
          const t = rec(v);
          return {
            attribute: id(t.attribute),
            coefficient: num(t.coefficient, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER),
          };
        }),
        t => t.attribute,
      );
    if (terms.some(t => !attributes.some(a => a.id === t.attribute))) fail('model-attribute');
    return {base: num(m.base), terms};
  };
  const o = rec(r.output),
    p = rec(o.properties),
    propertyKeys = Object.keys(p).sort();
  if (propertyKeys.length > b.properties) fail('properties');
  const properties: Record<string, CraftModel> = Object.create(null);
  for (const k of propertyKeys) properties[id(k)] = model(p[k]);
  const s = rec(r.scrap),
    sp = rec(s.properties),
    scrapKeys = Object.keys(sp).sort();
  if (scrapKeys.length > b.properties) fail('properties');
  const scrapProperties: Record<string, number> = Object.create(null);
  for (const k of scrapKeys) scrapProperties[id(k)] = num(sp[k]);
  return {
    id: id(r.id),
    version: num(r.version, Number.MAX_SAFE_INTEGER, 1),
    pointLimit: num(r.pointLimit, b.points),
    slots,
    attributes,
    output: {
      material: id(o.material),
      unit: id(o.unit),
      phase: id(o.phase),
      massMg: model(o.massMg),
      volumeUl: model(o.volumeUl),
      properties,
    },
    scrap: {
      material: id(s.material),
      unit: id(s.unit),
      phase: id(s.phase),
      massMg: num(s.massMg, Number.MAX_SAFE_INTEGER, 1),
      volumeUl: num(s.volumeUl),
      properties: scrapProperties,
    },
    workJ: num(r.workJ, Math.floor(Number.MAX_SAFE_INTEGER / 10), 1),
    maxPowerW: num(r.maxPowerW, Number.MAX_SAFE_INTEGER, 1),
  };
}
function selections(
  raw: unknown,
  r: CraftRecipe,
  stock: DimensionalStock,
  b: CraftBounds,
  available: boolean,
): CraftSelection[] {
  const selected = list(raw, b.selections, v => {
    const s = rec(v);
    return {
      slot: id(s.slot),
      container: id(s.container),
      batch: id(s.batch),
      quantity: num(s.quantity, Number.MAX_SAFE_INTEGER, 1),
    };
  });
  unique(selected, s => JSON.stringify([s.slot, s.container, s.batch]));
  const totals = new Map<string, bigint>();
  for (const s of selected) {
    const slot = r.slots.find(x => x.id === s.slot),
      batch = stock.batches.find(x => x.id === s.batch);
    if (
      !slot ||
      !batch ||
      !slot.materials.includes(batch.material) ||
      slot.unit !== batch.unit ||
      !stock.containers.some(x => x.id === s.container)
    )
      fail('selection');
    const key = JSON.stringify([s.container, s.batch]);
    totals.set(key, (totals.get(key) ?? 0n) + BigInt(s.quantity));
  }
  for (const slot of r.slots)
    if (selected.filter(s => s.slot === slot.id).reduce((n, s) => n + BigInt(s.quantity), 0n) !== BigInt(slot.quantity))
      fail('slot-quantity');
  if (available)
    for (const [key, quantity] of totals) {
      const [container, batch] = JSON.parse(key);
      if (BigInt(stock.positions.find(p => p.container === container && p.batch === batch)?.quantity ?? 0) < quantity)
        fail('insufficient');
    }
  return selected.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function values(
  r: CraftRecipe,
  selected: CraftSelection[],
  steps: CraftStep[],
  stock: DimensionalStock,
): CraftValues[] {
  return r.attributes.map(a => {
    let sum = 0n,
      weight = 0n;
    // Each property first receives a quantity-weighted slot mean; authored recipe weights then combine slots.
    for (const w of a.weights) {
      const parts = selected.filter(s => s.slot === w.slot);
      let property = 0n,
        quantity = 0n;
      for (const s of parts) {
        const batch = stock.batches.find(x => x.id === s.batch)!;
        property += BigInt(num(batch.properties[w.property], 1000)) * BigInt(s.quantity);
        quantity += BigInt(s.quantity);
      }
      sum += (property / quantity) * BigInt(w.weight);
      weight += BigInt(w.weight);
    }
    const ceiling = exact(sum / weight);
    let value = Math.floor((ceiling * a.initialPermille) / 1000);
    for (const step of steps.filter(s => s.attribute === a.id)) {
      const delta = Math.floor((ceiling * a.gainPermille * step.points * step.effectPermille) / 1000000);
      value = Math.max(0, Math.min(ceiling, value + delta));
    }
    return {id: a.id, ceiling, value};
  });
}
function capture(raw: unknown, r: CraftRecipe, stock: DimensionalStock, b: CraftBounds): CraftExperiment {
  const s = rec(raw),
    locked = s.locked;
  if (s.version !== 1 || s.recipe !== r.id || s.recipeVersion !== r.version || typeof locked !== 'boolean')
    fail('experiment');
  const pointBudget = num(s.pointBudget, r.pointLimit),
    steps = list(s.steps, b.steps, v => {
      const p = rec(v);
      return {
        attribute: id(p.attribute),
        points: num(p.points, b.points, 1),
        effectPermille: num(p.effectPermille, 1000, -1000),
      };
    });
  if (
    steps.some(s => !r.attributes.some(a => a.id === s.attribute && a.effectPermille === s.effectPermille)) ||
    steps.reduce((n, s) => n + s.points, 0) > pointBudget
  )
    fail('points');
  return {
    version: 1,
    id: id(s.id),
    recipe: r.id,
    recipeVersion: r.version,
    pointBudget,
    selections: selections(s.selections, r, stock, b, false),
    steps,
    locked: locked as boolean,
  };
}
function input(rawRecipe: unknown, input: CraftInput) {
  const b = bounds(input.bounds),
    r = recipe(rawRecipe, b),
    stock = parseDimensionalStock(input.stock, input.stockBounds);
  return {b, r, stock};
}
export function resolveCraftSlots(
  rawRecipe: CraftRecipe,
  selected: CraftSelection[],
  source: CraftInput,
): {selections: CraftSelection[]; values: CraftValues[]} {
  const {b, r, stock} = input(rawRecipe, source),
    resolved = selections(selected, r, stock, b, true);
  return {selections: resolved, values: values(r, resolved, [], stock)};
}
/** Caller must reserve/commit these exact units together with this candidate. */
export function beginCraftExperiment(
  rawRecipe: CraftRecipe,
  selected: CraftSelection[],
  options: {id: string; pointBudget: number},
  source: CraftInput,
): CraftExperiment {
  const {b, r, stock} = input(rawRecipe, source);
  return {
    version: 1,
    id: id(options.id),
    recipe: r.id,
    recipeVersion: r.version,
    pointBudget: num(options.pointBudget, r.pointLimit),
    selections: selections(selected, r, stock, b, true),
    steps: [],
    locked: false,
  };
}
export function applyCraftExperiment(
  raw: CraftExperiment,
  step: CraftStep,
  rawRecipe: CraftRecipe,
  source: CraftInput,
): {state: CraftExperiment; values: CraftValues[]} {
  const {b, r, stock} = input(rawRecipe, source),
    s = capture(raw, r, stock, b);
  if (s.locked) fail('locked');
  if (s.steps.length >= b.steps) fail('steps');
  const next = capture({...s, steps: [...s.steps, step]}, r, stock, b);
  return {state: next, values: values(r, next.selections, next.steps, stock)};
}
function model(m: CraftModel, attributes: CraftValues[]): number {
  let value = BigInt(m.base);
  for (const t of m.terms) {
    const product = BigInt(attributes.find(a => a.id === t.attribute)!.value) * BigInt(t.coefficient);
    value += product >= 0n ? product / 1000n : -((-product + 999n) / 1000n);
  }
  return exact(value);
}
function compile(
  s: CraftExperiment,
  ids: {manifest: string; output: string; scrap: string},
  r: CraftRecipe,
  stock: DimensionalStock,
): CraftManifest {
  const v = values(r, s.selections, s.steps, stock),
    properties: Record<string, number> = Object.create(null);
  for (const [key, m] of Object.entries(r.output.properties)) properties[key] = model(m, v);
  const output: StockBatch = {
    id: id(ids.output),
    material: r.output.material,
    unit: r.output.unit,
    phase: r.output.phase,
    massMg: model(r.output.massMg, v),
    volumeUl: model(r.output.volumeUl, v),
    properties,
  };
  if (!output.massMg) fail('output-mass');
  const scrap: StockBatch = {id: id(ids.scrap), ...r.scrap};
  if (scrap.id === output.id) fail('output-identity');
  const totals = new Map<string, number>();
  for (const selected of s.selections)
    totals.set(selected.batch, exact(BigInt(totals.get(selected.batch) ?? 0) + BigInt(selected.quantity)));
  const inputs = [...totals].map(([batch, quantity]) => ({batch, quantity}));
  const inputMass = inputs.reduce(
      (mass, p) => mass + BigInt(stock.batches.find(b => b.id === p.batch)!.massMg) * BigInt(p.quantity),
      0n,
    ),
    remainder = inputMass - BigInt(output.massMg);
  if (remainder < 0n || remainder % BigInt(scrap.massMg) !== 0n) fail('mass-balance');
  const outputs = [
    {batch: output, quantity: 1},
    ...(remainder > 0n ? [{batch: scrap, quantity: exact(remainder / BigInt(scrap.massMg))}] : []),
  ];
  return {
    version: 1,
    id: id(ids.manifest),
    experiment: {...s, locked: true},
    values: v,
    plan: {id: id(ids.manifest), inputs, outputs, workJ: r.workJ, maxPowerW: r.maxPowerW},
  };
}
function freeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const child of Object.values(v)) freeze(child);
    Object.freeze(v);
  }
  return v;
}
/** Locks a reproducible plan; stock publication and acceptance remain the enclosing transaction's job. */
export function lockCraftManifest(
  raw: CraftExperiment,
  ids: {manifest: string; output: string; scrap: string},
  rawRecipe: CraftRecipe,
  source: CraftInput,
): CraftManifest {
  const {b, r, stock} = input(rawRecipe, source),
    s = capture(raw, r, stock, b);
  if (s.locked) fail('locked');
  const manifest = compile(s, ids, r, stock);
  const check = prepareStockChange(stock, {issueBatches: manifest.plan.outputs.map(o => o.batch)}, source.stockBounds);
  if (!check.ok) fail(check.reason);
  return freeze(manifest);
}
/** Reconstructs rather than trusting stored output properties or experiment values. */
export function parseCraftManifest(raw: unknown, rawRecipe: CraftRecipe, source: CraftInput): CraftManifest {
  const {b, r, stock} = input(rawRecipe, source),
    m = rec(raw),
    s = capture(m.experiment, r, stock, b);
  if (m.version !== 1 || !s.locked) fail('manifest');
  const p = rec(m.plan),
    outputs = list(p.outputs, 2, v => {
      const o = rec(v),
        batch = rec(o.batch);
      return {batch, quantity: num(o.quantity, Number.MAX_SAFE_INTEGER, 1)};
    });
  if (!outputs.length) fail('outputs');
  // Only schema-admitted scalars are read. Extra caller graphs are never cloned/serialized.
  const outputId = id(outputs[0]!.batch.id),
    scrapId = outputs[1] ? id(outputs[1].batch.id) : outputId === 'unused-scrap' ? 'unused-scrap-2' : 'unused-scrap';
  const result = compile(s, {manifest: id(m.id), output: outputId, scrap: scrapId}, r, stock);
  const storedValues = list(m.values, b.attributes, v => {
    const a = rec(v);
    return {id: id(a.id), ceiling: num(a.ceiling, 1000), value: num(a.value, 1000)};
  });
  if (
    JSON.stringify(storedValues) !== JSON.stringify(result.values) ||
    p.id !== result.id ||
    p.workJ !== r.workJ ||
    p.maxPowerW !== r.maxPowerW
  )
    fail('manifest-derived');
  const inputs = list(p.inputs, b.selections, v => {
    const i = rec(v);
    return {batch: id(i.batch), quantity: num(i.quantity, Number.MAX_SAFE_INTEGER, 1)};
  });
  if (JSON.stringify(inputs) !== JSON.stringify(result.plan.inputs) || outputs.length !== result.plan.outputs.length)
    fail('manifest-inputs');
  for (let i = 0; i < outputs.length; i++) {
    const actual = outputs[i]!,
      expected = result.plan.outputs[i]!,
      batch = actual.batch,
      props = rec(batch.properties),
      keys = Object.keys(props).sort();
    if (keys.length > b.properties) fail('properties');
    if (
      actual.quantity !== expected.quantity ||
      (['id', 'material', 'unit', 'phase', 'massMg', 'volumeUl'] as const).some(k => batch[k] !== expected.batch[k]) ||
      keys.length !== Object.keys(expected.batch.properties).length ||
      keys.some(k => props[k] !== expected.batch.properties[k])
    )
      fail('manifest-output');
  }
  const checked = prepareStockChange(stock, {issueBatches: result.plan.outputs.map(o => o.batch)}, source.stockBounds);
  if (!checked.ok) fail(checked.reason);
  return freeze(result);
}
