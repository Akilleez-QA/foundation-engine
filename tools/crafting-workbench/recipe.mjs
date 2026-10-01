import {
  resolveCraftSlots,
  beginCraftExperiment,
} from '../../src/kits/resources/crafting.ts';
export const recipeLimits = Object.freeze({
  maxBytes: 131072,
  maxNodes: 16384,
  maxDepth: 24,
});
export const craftBounds = Object.freeze({
  slots: 4,
  selections: 8,
  attributes: 4,
  weights: 16,
  points: 16,
  steps: 8,
  properties: 8,
});
export const stockBounds = Object.freeze({
  containers: 32,
  batches: 16,
  positions: 64,
  changes: 32,
  properties: 8,
});
export const recipeStorageKey = 'crafting-workbench|device|crafting.recipe';
const freeze = (v) => {
  if (v && typeof v === 'object') {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
};
const id = (v) => {
  if (typeof v !== 'string' || !v.length || v.length > 96)
    throw Error('recipe identity');
  return v;
};
const num = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(v) || v < min || v > max || Object.is(v, -0))
    throw Error('recipe integer');
  return v;
};
const record = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw Error('recipe record');
  return v;
};
const list = (v, max, read) => {
  if (!Array.isArray(v)) throw Error('recipe list');
  const length = v.length;
  num(length, 0, max);
  const out = [];
  for (let i = 0; i < length; i++) out.push(read(v[i]));
  return out;
};
const properties = (v, read) => {
  record(v);
  const keys = Object.keys(v);
  if (keys.length > 8) throw Error('recipe property limit');
  const out = Object.create(null);
  for (const k of keys.sort()) out[id(k)] = read(v[k]);
  return out;
};
/** Canonical finite evaluator schema. Unrelated input fields never enter captured historical facts. */
export function captureRecipe(raw) {
  if (typeof raw === 'string') {
    if (
      raw.length > recipeLimits.maxBytes ||
      new TextEncoder().encode(raw).length > recipeLimits.maxBytes
    )
      throw Error('recipe byte limit');
    raw = JSON.parse(raw);
  }
  const r = record(raw),
    model = (v) => {
      const m = record(v);
      return {
        base: num(m.base),
        terms: list(m.terms, 4, (v) => {
          const t = record(v);
          return {
            attribute: id(t.attribute),
            coefficient: num(t.coefficient, -Number.MAX_SAFE_INTEGER),
          };
        }),
      };
    };
  const o = record(r.output),
    s = record(r.scrap);
  const result = {
    id: id(r.id),
    version: num(r.version, 1),
    pointLimit: num(r.pointLimit, 0, 16),
    slots: list(r.slots, 4, (v) => {
      const x = record(v);
      return {
        id: id(x.id),
        materials: list(x.materials, 8, id),
        unit: id(x.unit),
        quantity: num(x.quantity, 1),
      };
    }),
    attributes: list(r.attributes, 4, (v) => {
      const a = record(v);
      return {
        id: id(a.id),
        weights: list(a.weights, 16, (v) => {
          const w = record(v);
          return {
            slot: id(w.slot),
            property: id(w.property),
            weight: num(w.weight, 1, 1000000),
          };
        }),
        initialPermille: num(a.initialPermille, 0, 1000),
        gainPermille: num(a.gainPermille, 0, 1000),
        effectPermille: num(a.effectPermille, -1000, 1000),
      };
    }),
    output: {
      material: id(o.material),
      unit: id(o.unit),
      phase: id(o.phase),
      massMg: model(o.massMg),
      volumeUl: model(o.volumeUl),
      properties: properties(o.properties, model),
    },
    scrap: {
      material: id(s.material),
      unit: id(s.unit),
      phase: id(s.phase),
      massMg: num(s.massMg, 1),
      volumeUl: num(s.volumeUl),
      properties: properties(s.properties, (v) => num(v)),
    },
    workJ: num(r.workJ, 1, Math.floor(Number.MAX_SAFE_INTEGER / 10)),
    maxPowerW: num(r.maxPowerW, 1),
  };
  // Synthetic rows exercise the real recipe parser independently of available preview ingredients.
  const stock = { version: 1, containers: [], batches: [], positions: [] },
    selected = [];
  result.slots.forEach((slot, i) => {
    const container = `validation-${i}`,
      batch = `validation-batch-${i}`,
      props = Object.create(null);
    for (const a of result.attributes)
      for (const w of a.weights) if (w.slot === slot.id) props[w.property] = 0;
    stock.containers.push({
      id: container,
      maxMassMg: Number.MAX_SAFE_INTEGER,
      maxVolumeUl: Number.MAX_SAFE_INTEGER,
      phases: ['solid'],
    });
    stock.batches.push({
      id: batch,
      material: slot.materials[0],
      unit: slot.unit,
      phase: 'solid',
      massMg: 0,
      volumeUl: 0,
      properties: props,
    });
    stock.positions.push({ container, batch, quantity: slot.quantity });
    selected.push({ slot: slot.id, container, batch, quantity: slot.quantity });
  });
  resolveCraftSlots(result, selected, {
    stock,
    stockBounds: { ...stockBounds, properties: 64 },
    bounds: craftBounds,
  });
  const json = JSON.stringify(result);
  if (new TextEncoder().encode(json).length > recipeLimits.maxBytes)
    throw Error('recipe byte limit');
  let nodes = 0;
  const queue = [{ v: result, d: 0 }];
  while (queue.length) {
    const { v, d } = queue.pop();
    if (++nodes > recipeLimits.maxNodes || d > 24)
      throw Error('recipe structure');
    if (v && typeof v === 'object')
      for (const c of Object.values(v)) queue.push({ v: c, d: d + 1 });
  }
  return freeze(result);
}
export function initialRecipe() {
  return captureRecipe({
    id: 'authored-recipe',
    version: 1,
    pointLimit: 4,
    slots: [{ id: 'feed', materials: ['input'], unit: 'unit', quantity: 2 }],
    attributes: [
      {
        id: 'quality',
        weights: [{ slot: 'feed', property: 'grade', weight: 1 }],
        initialPermille: 500,
        gainPermille: 250,
        effectPermille: 1000,
      },
    ],
    output: {
      material: 'crafted',
      unit: 'unit',
      phase: 'solid',
      massMg: { base: 18, terms: [] },
      volumeUl: { base: 8, terms: [] },
      properties: {
        grade: {
          base: 0,
          terms: [{ attribute: 'quality', coefficient: 1000 }],
        },
      },
    },
    scrap: {
      material: 'scrap',
      unit: 'unit',
      phase: 'solid',
      massMg: 1,
      volumeUl: 1,
      properties: {},
    },
    workJ: 10,
    maxPowerW: 10,
  });
}
export function initialStock() {
  return {
    version: 1,
    containers: ['source-a', 'source-b'].map((id) => ({
      id,
      maxMassMg: 40,
      maxVolumeUl: 20,
      phases: ['solid'],
    })),
    batches: [400, 800].map((grade, i) => ({
      id: `input-${i ? 'b' : 'a'}`,
      material: 'input',
      unit: 'unit',
      phase: 'solid',
      massMg: 10,
      volumeUl: 5,
      properties: { grade },
    })),
    positions: ['a', 'b'].map((s) => ({
      container: `source-${s}`,
      batch: `input-${s}`,
      quantity: 4,
    })),
  };
}
export function initialSelections() {
  return ['a', 'b'].map((s) => ({
    slot: 'feed',
    container: `source-${s}`,
    batch: `input-${s}`,
    quantity: 1,
  }));
}
export function evaluateRecipe(
  raw,
  selections = initialSelections(),
  stock = initialStock(),
) {
  const recipe = captureRecipe(raw),
    input = { stock, stockBounds, bounds: craftBounds };
  return freeze({
    experiment: beginCraftExperiment(
      recipe,
      selections,
      { id: 'isolated-preview', pointBudget: recipe.pointLimit },
      input,
    ),
    ...resolveCraftSlots(recipe, selections, input),
  });
}
export const recipeSectionDefinition = {
  id: 'crafting.recipe',
  scope: 'device',
  version: 1,
  maxChars: 131072,
  initial: initialRecipe,
  parse: captureRecipe,
};
/** Single-writer observed-byte guard; not cross-process compare-and-swap. */
export function createRecipeStoragePort(port) {
  let seen = false,
    expected = null,
    conflicted = false;
  const refuse = () => {
    conflicted = true;
    throw Error('recipe external-conflict');
  };
  const check = () => {
    if (conflicted || !seen || port.get(recipeStorageKey) !== expected)
      refuse();
  };
  return {
    kind: port.kind,
    get(key) {
      const raw = port.get(key);
      if (key === recipeStorageKey) {
        if (conflicted) refuse();
        if (
          raw !== null &&
          (typeof raw !== 'string' ||
            raw.length > recipeLimits.maxBytes ||
            new TextEncoder().encode(raw).length > recipeLimits.maxBytes)
        ) {
          conflicted = true;
          throw Error('recipe storage byte limit');
        }
        if (!seen) {
          seen = true;
          expected = raw;
        } else if (raw !== expected) refuse();
      }
      return raw;
    },
    set(key, value) {
      if (key === recipeStorageKey) {
        check();
        port.set(key, value);
        expected = value;
      } else port.set(key, value);
    },
    remove(key) {
      if (key === recipeStorageKey) {
        check();
        port.remove(key);
        expected = null;
      } else port.remove(key);
    },
    keys: () => port.keys(),
    ...(port.subscribe ? { subscribe: (fn) => port.subscribe(fn) } : {}),
  };
}
