import { createAuthoredDocument } from '../../src/kits/authoring/document.ts';
import {
  parseDimensionalStock,
  prepareStockChange,
  prepareStockTransfers,
} from '../../src/kits/inventory/dimensional.ts';
import {
  parseIndustrialState,
  prepareIndustryCommand,
} from '../../src/kits/resources/industry.ts';
import {
  beginCraftExperiment,
  applyCraftExperiment,
  lockCraftManifest,
  resolveCraftSlots,
} from '../../src/kits/resources/crafting.ts';
import { defineDeposit } from '../../src/kits/resources/deposits.ts';
import {
  captureRecipe,
  initialStock,
  stockBounds,
  craftBounds,
} from './recipe.mjs';
export const runtimeLimits = Object.freeze({
  maxBytes: 262144,
  maxNodes: 32768,
  maxDepth: 24,
});
export const industryBounds = Object.freeze({
  stock: stockBounds,
  deposits: 4,
  plans: 16,
  machines: 2,
  maxStepTicks: 100,
});
export const equal = (a, b) => {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const ak = Object.keys(a),
    bk = Object.keys(b);
  return (
    ak.length === bk.length &&
    ak.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]))
  );
};
export const freeze = (v) => {
  if (v && typeof v === 'object') {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
};
const integer = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(v) || v < min || v > max) throw Error('integer');
  return v;
};
const id = (v) => {
  if (typeof v !== 'string' || !v.length || v.length > 96)
    throw Error('identity');
  return v;
};
const fields = (v, names) => {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).length !== names.length ||
    Object.keys(v).some((k) => !names.includes(k))
  )
    throw Error('fields');
  return v;
};
/** Capture bounded indexed JSON data without invoking caller iterators or toJSON. */
export function captureData(raw) {
  let nodes = 0;
  const visit = (v, depth) => {
    if (++nodes > runtimeLimits.maxNodes || depth > 24)
      throw Error('capture-bound');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw Error('number');
      return v;
    }
    if (typeof v === 'string') {
      if (v.length > runtimeLimits.maxBytes) throw Error('string-bound');
      return v;
    }
    if (!v || typeof v !== 'object') throw Error('data');
    if (Array.isArray(v)) {
      const length = v.length;
      integer(length, 0, 64);
      const out = [];
      for (let i = 0; i < length; i++) out.push(visit(v[i], depth + 1));
      return out;
    }
    const keys = Reflect.ownKeys(v);
    if (
      keys.length > 64 ||
      keys.some((k) => typeof k !== 'string' || k === '__proto__')
    )
      throw Error('keys');
    const out = {};
    for (const k of keys) out[k] = visit(v[k], depth + 1);
    return out;
  };
  const result = visit(raw, 0),
    json = JSON.stringify(result);
  const check = createAuthoredDocument({
    id: 'capture',
    json,
    limits: runtimeLimits,
    validate: () => true,
  });
  check.dispose();
  return result;
}
const port = (id, mass = 100000, volume = 100000) => ({
  id,
  maxMassMg: mass,
  maxVolumeUl: volume,
  phases: ['solid'],
});
const input = (s) => ({
  stock: s.industry.stock,
  stockBounds,
  bounds: craftBounds,
});
const stock = (s) => {
  const parsed = parseIndustrialState(s.industry, industryBounds);
  s.industry = parsed;
};
function changed(s, change) {
  const result = prepareStockChange(s.industry.stock, change, stockBounds);
  if (!result.ok) throw Error(result.reason);
  s.industry.stock = result.state;
}
function moved(s, transfers) {
  const result = prepareStockTransfers(
    s.industry.stock,
    transfers,
    stockBounds,
  );
  if (!result.ok) throw Error(result.reason);
  s.industry.stock = result.state;
}
function industry(s, command) {
  const result = prepareIndustryCommand(s.industry, command, industryBounds);
  if (!result.ok) throw Error(result.reason);
  s.industry = result.state;
  return result;
}
const active = (s) => !['completed', 'cancelled'].includes(s.phase);
const claimed = (s, container) =>
  s.sessions.some(
    (row) =>
      active(row) &&
      (row.holding === container ||
        (row.machine && `${row.machine}.input` === container)),
  );
function aggregate(selected, from, to) {
  const rows = new Map();
  for (const row of selected) {
    const source = from(row),
      destination = to(row),
      key = JSON.stringify([source, destination, row.batch]),
      prior = rows.get(key);
    const quantity = (prior?.quantity ?? 0) + row.quantity;
    if (!Number.isSafeInteger(quantity)) throw Error('quantity');
    rows.set(key, {
      from: source,
      to: destination,
      batch: row.batch,
      quantity,
    });
  }
  return [...rows.values()];
}
export function initialRuntimeEnvelope() {
  const base = initialStock();
  base.containers.push(port('buffer'));
  for (const m of ['m-a', 'm-b'])
    for (const p of ['input', 'output', 'work', 'installed'])
      base.containers.push(
        port(
          `${m}.${p}`,
          p === 'output' ? 20 : 100000,
          p === 'output' ? 10 : 100000,
        ),
      );
  const initial = parseDimensionalStock(base, stockBounds),
    batch = initial.batches.find((b) => b.id === 'input-a');
  return {
    version: 1,
    revision: 0,
    clock: 0,
    spawnSerial: 0,
    industry: {
      version: 1,
      stock: initial,
      deposits: [
        {
          id: 'field',
          body: 'sample',
          region: 'field',
          batch: batch.id,
          remaining: 8,
        },
      ],
      plans: [],
      machines: [],
    },
    sessions: [],
    spawns: [
      {
        id: 'field',
        incarnation: 0,
        deposit: defineDeposit({
          id: 'field',
          revision: 0,
          seed: 1,
          cellSize: 1,
          expiresTick: 100,
          reserve: 8,
          batch: {
            id: batch.id,
            material: batch.material,
            properties: batch.properties,
          },
        }),
      },
    ],
    receipts: [],
  };
}
export function captureCommand(raw) {
  const c = captureData(raw);
  fields(c, ['id', 'payload']);
  id(c.id);
  const p = c.payload,
    kind = p?.kind;
  if (kind === 'begin') {
    fields(p, ['kind', 'recipe', 'selections', 'pointBudget']);
    p.recipe = captureRecipe(p.recipe);
    integer(p.pointBudget, 0, 16);
    if (!Array.isArray(p.selections) || p.selections.length > 8)
      throw Error('selection-bound');
    for (const r of p.selections) {
      fields(r, ['slot', 'container', 'batch', 'quantity']);
      id(r.slot);
      id(r.container);
      id(r.batch);
      integer(r.quantity, 1);
    }
  } else if (kind === 'repeat') {
    fields(p, ['kind', 'session', 'selections']);
    id(p.session);
    if (!Array.isArray(p.selections) || p.selections.length > 8)
      throw Error('selection-bound');
    for (const r of p.selections) {
      fields(r, ['slot', 'container', 'batch', 'quantity']);
      id(r.slot);
      id(r.container);
      id(r.batch);
      integer(r.quantity, 1);
    }
  } else if (kind === 'experiment') {
    fields(p, ['kind', 'session', 'attribute', 'points', 'effectPermille']);
    id(p.session);
    id(p.attribute);
    integer(p.points, 1, 16);
    integer(p.effectPermille, -1000, 1000);
  } else if (['lock', 'cancel-session'].includes(kind)) {
    fields(p, ['kind', 'session']);
    id(p.session);
  } else if (kind === 'assign') {
    fields(p, ['kind', 'session', 'machine']);
    id(p.session);
    if (!['m-a', 'm-b'].includes(p.machine)) throw Error('machine');
  } else if (kind === 'step') {
    fields(p, ['kind', 'session', 'ticks', 'power']);
    id(p.session);
    integer(p.ticks, 1, 100);
    integer(p.power);
  } else if (kind === 'transfer') {
    fields(p, ['kind', 'from', 'to', 'batch', 'quantity']);
    id(p.from);
    id(p.to);
    id(p.batch);
    integer(p.quantity, 1);
  } else if (kind === 'resize') {
    fields(p, ['kind', 'container', 'mass', 'volume']);
    id(p.container);
    integer(p.mass);
    integer(p.volume);
  } else if (kind === 'advance') {
    fields(p, ['kind', 'time']);
    integer(p.time);
  } else if (kind === 'harvest') {
    fields(p, ['kind', 'spawn', 'incarnation', 'container', 'quantity']);
    id(p.spawn);
    id(p.container);
    integer(p.incarnation);
    integer(p.quantity, 1);
  } else if (kind === 'replace-spawn') {
    fields(p, [
      'kind',
      'spawn',
      'seed',
      'cellSize',
      'expiresAt',
      'reserve',
      'grade',
    ]);
    id(p.spawn);
    integer(p.seed, 0, 0xffffffff);
    if (
      typeof p.cellSize !== 'number' ||
      !Number.isFinite(p.cellSize) ||
      p.cellSize <= 0
    )
      throw Error('cell-size');
    integer(p.expiresAt);
    integer(p.reserve);
    integer(p.grade, 0, 1000);
  } else throw Error('command');
  return freeze(c);
}
function applyTransition(value, c) {
  const prior = value.receipts.find((r) => r.id === c.id);
  if (prior) {
    if (!equal(prior, c)) throw Error('conflict');
    return null;
  }
  if (value.receipts.length >= 64) throw Error('receipt-capacity');
  const s = structuredClone(value),
    p = c.payload;
  let row;
  if (p.kind === 'begin') {
    if (s.sessions.filter(active).length >= 2)
      throw Error('live-session-capacity');
    if (s.sessions.length >= 16) throw Error('session-capacity');
    if (
      p.selections.some(
        (r) =>
          claimed(s, r.container) ||
          !['source-a', 'source-b', 'buffer'].includes(r.container),
      )
    )
      throw Error('protected-source');
    const serial = s.sessions.length + 1,
      session = `session-${serial}`,
      holding = `holding-${serial}`;
    const experiment = beginCraftExperiment(
        p.recipe,
        p.selections,
        { id: session, pointBudget: p.pointBudget },
        input(s),
      ),
      values = resolveCraftSlots(p.recipe, p.selections, input(s)).values;
    changed(s, { addContainers: [port(holding)] });
    moved(
      s,
      aggregate(
        experiment.selections,
        (r) => r.container,
        () => holding,
      ),
    );
    s.sessions.push({
      id: session,
      serial,
      phase: 'reserved',
      holding,
      recipe: p.recipe,
      experiment,
      values,
      manifest: null,
      machine: null,
      cycle: null,
    });
  } else if (p.kind === 'repeat') {
    const source = s.sessions.find((r) => r.id === p.session);
    if (!source || source.phase !== 'completed' || !source.manifest)
      throw Error('repeat-source');
    if (s.sessions.filter(active).length >= 2)
      throw Error('live-session-capacity');
    if (s.sessions.length >= 16) throw Error('session-capacity');
    if (
      p.selections.some(
        (r) =>
          claimed(s, r.container) ||
          !['source-a', 'source-b', 'buffer'].includes(r.container),
      )
    )
      throw Error('protected-source');
    const qualified = (rows) => {
      const totals = new Map();
      for (const row of rows) {
        const key = JSON.stringify([row.slot, row.batch]);
        totals.set(key, (totals.get(key) ?? 0) + row.quantity);
      }
      return [...totals].sort(([a], [b]) => a.localeCompare(b));
    };
    if (
      !equal(qualified(p.selections), qualified(source.experiment.selections))
    )
      throw Error('repeat-facts');
    const serial = s.sessions.length + 1,
      session = `session-${serial}`,
      holding = `holding-${serial}`;
    let experiment = beginCraftExperiment(
      source.recipe,
      p.selections,
      { id: session, pointBudget: source.experiment.pointBudget },
      input(s),
    );
    for (const step of source.experiment.steps)
      experiment = applyCraftExperiment(
        experiment,
        step,
        source.recipe,
        input(s),
      ).state;
    const manifest = lockCraftManifest(
      experiment,
      {
        manifest: source.manifest.id,
        output: source.manifest.plan.outputs[0].batch.id,
        scrap: source.manifest.plan.outputs[1]?.batch.id ?? `unused-${serial}`,
      },
      source.recipe,
      input(s),
    );
    const canonicalPlan = (plan) => ({
      ...plan,
      inputs: [...plan.inputs].sort((a, b) => a.batch.localeCompare(b.batch)),
    });
    if (
      !equal(canonicalPlan(manifest.plan), canonicalPlan(source.manifest.plan))
    )
      throw Error('repeat-plan');
    changed(s, { addContainers: [port(holding)] });
    moved(
      s,
      aggregate(
        experiment.selections,
        (r) => r.container,
        () => holding,
      ),
    );
    s.sessions.push({
      id: session,
      serial,
      phase: 'locked',
      holding,
      recipe: source.recipe,
      experiment: manifest.experiment,
      values: manifest.values,
      manifest,
      machine: null,
      cycle: null,
    });
  } else if (
    ['experiment', 'lock', 'assign', 'step', 'cancel-session'].includes(p.kind)
  ) {
    row = s.sessions.find((r) => r.id === p.session);
    if (!row) throw Error('session');
    if (p.kind === 'experiment') {
      if (!['reserved', 'experimenting'].includes(row.phase))
        throw Error('phase');
      const result = applyCraftExperiment(
        row.experiment,
        {
          attribute: p.attribute,
          points: p.points,
          effectPermille: p.effectPermille,
        },
        row.recipe,
        input(s),
      );
      row.experiment = result.state;
      row.values = result.values;
      row.phase = 'experimenting';
    } else if (p.kind === 'lock') {
      if (!['reserved', 'experimenting'].includes(row.phase))
        throw Error('phase');
      const manifest = lockCraftManifest(
        row.experiment,
        {
          manifest: `plan-${row.serial}`,
          output: `crafted-${row.serial}`,
          scrap: `scrap-${row.serial}`,
        },
        row.recipe,
        input(s),
      );
      if (s.industry.plans.length >= 16) throw Error('plan-capacity');
      changed(s, { issueBatches: manifest.plan.outputs.map((o) => o.batch) });
      s.industry.plans.push(manifest.plan);
      row.manifest = manifest;
      row.experiment = manifest.experiment;
      row.values = manifest.values;
      row.phase = 'locked';
    } else if (p.kind === 'assign') {
      if (row.phase !== 'locked') throw Error('phase');
      if (s.sessions.some((r) => active(r) && r.machine === p.machine))
        throw Error('machine-claimed');
      let machine = s.industry.machines.find((m) => m.id === p.machine);
      if (machine?.active) throw Error('machine-active');
      if (
        s.industry.stock.positions.some((r) =>
          [`${p.machine}.input`, `${p.machine}.work`].includes(r.container),
        )
      )
        throw Error('machine-input-occupied');
      if (!machine) {
        machine = {
          id: p.machine,
          plan: row.manifest.id,
          input: `${p.machine}.input`,
          output: `${p.machine}.output`,
          work: `${p.machine}.work`,
          installed: `${p.machine}.installed`,
          powered: true,
          active: false,
          progressJ: 0,
          completed: 0,
          energyRemainder: 0,
        };
        s.industry.machines.push(machine);
      }
      machine.plan = row.manifest.id;
      row.machine = p.machine;
      row.cycle = machine.completed + 1;
      moved(
        s,
        aggregate(
          row.experiment.selections,
          () => row.holding,
          () => machine.input,
        ),
      );
      row.phase = 'assigned';
    } else if (p.kind === 'step') {
      if (!['assigned', 'working'].includes(row.phase)) throw Error('phase');
      const result = industry(s, {
          kind: 'step',
          machine: row.machine,
          ticks: p.ticks,
          allocatedPowerW: p.power,
        }),
        machine = s.industry.machines.find((m) => m.id === row.machine);
      if (result.completed) {
        if (machine.completed !== row.cycle) throw Error('cycle');
        row.phase = 'completed';
      } else if (machine.active) row.phase = 'working';
    } else {
      if (!active(row)) throw Error('phase');
      let source = row.holding;
      if (row.machine) {
        industry(s, { kind: 'cancel', machine: row.machine });
        source = `${row.machine}.input`;
      }
      moved(
        s,
        aggregate(
          row.experiment.selections,
          () => source,
          (r) => r.container,
        ),
      );
      row.phase = 'cancelled';
    }
  } else if (p.kind === 'transfer') {
    if (claimed(s, p.from) || claimed(s, p.to)) throw Error('claimed-custody');
    industry(s, {
      kind: 'transfer',
      from: p.from,
      to: p.to,
      batch: p.batch,
      quantity: p.quantity,
    });
  } else if (p.kind === 'resize') {
    if (
      claimed(s, p.container) ||
      s.industry.machines.some(
        (m) =>
          [m.work, m.installed].includes(p.container) &&
          (m.active || s.sessions.some((r) => active(r) && r.machine === m.id)),
      )
    )
      throw Error('claimed-custody');
    changed(s, {
      resizeContainers: [
        { id: p.container, maxMassMg: p.mass, maxVolumeUl: p.volume },
      ],
    });
  } else if (p.kind === 'advance') {
    if (p.time < s.clock) throw Error('clock');
    s.clock = p.time;
  } else if (p.kind === 'harvest') {
    const spawn = s.spawns.find((r) => r.id === p.spawn);
    if (!spawn || spawn.incarnation !== p.incarnation)
      throw Error('stale-spawn');
    if (s.clock >= spawn.deposit.expiresTick) throw Error('expired-spawn');
    if (claimed(s, p.container)) throw Error('claimed-custody');
    industry(s, {
      kind: 'harvest',
      deposit: p.spawn,
      container: p.container,
      quantity: p.quantity,
    });
  } else if (p.kind === 'replace-spawn') {
    if (p.expiresAt <= s.clock) throw Error('expired-spawn');
    const prior = s.spawns.find((r) => r.id === p.spawn);
    if (!prior && s.spawns.length >= 4) throw Error('spawn-capacity');
    const serial = integer(s.spawnSerial + 1),
      batch = {
        id: `harvest-${serial}`,
        material: 'input',
        unit: 'unit',
        phase: 'solid',
        massMg: 10,
        volumeUl: 5,
        properties: { grade: p.grade },
      };
    changed(s, { issueBatches: [batch] });
    const spatial = {
      id: p.spawn,
      incarnation: serial,
      deposit: defineDeposit({
        id: p.spawn,
        revision: serial,
        seed: p.seed,
        cellSize: p.cellSize,
        expiresTick: p.expiresAt,
        reserve: p.reserve,
        batch: {
          id: batch.id,
          material: batch.material,
          properties: batch.properties,
        },
      }),
    };
    s.spawns = s.spawns.filter((r) => r.id !== p.spawn);
    s.spawns.push(spatial);
    s.industry.deposits = s.industry.deposits.filter((r) => r.id !== p.spawn);
    s.industry.deposits.push({
      id: p.spawn,
      body: 'sample',
      region: 'field',
      batch: batch.id,
      remaining: p.reserve,
    });
    s.spawnSerial = serial;
  }
  stock(s);
  s.revision++;
  s.receipts.push(c);
  return s;
}
/** A detached, bounded cancellation path reserves receipts and storage without publishing recovery. */
export function recoveryStates(value) {
  const live = value.sessions.filter(active);
  if (!live.length) return [];
  let state = value,
    serial = 0;
  const states = [],
    totals = new Map();
  for (const row of live)
    for (const selection of row.experiment.selections) {
      const batch = value.industry.stock.batches.find(
        (b) => b.id === selection.batch,
      );
      const total = totals.get(selection.container) ?? { mass: 0n, volume: 0n };
      total.mass += BigInt(selection.quantity) * BigInt(batch.massMg);
      total.volume += BigInt(selection.quantity) * BigInt(batch.volumeUl);
      totals.set(selection.container, total);
    }
  const receipt = () => {
    let key;
    do {
      key = (++serial)
        .toString(2)
        .padStart(96, '0')
        .replaceAll('0', '\u0000')
        .replaceAll('1', '\u0001');
    } while (state.receipts.some((r) => r.id === key));
    return key;
  };
  const apply = (payload) => {
    const next = applyTransition(state, { id: receipt(), payload });
    if (!next) throw Error('recovery-identity');
    captureData(next);
    states.push(next);
    state = next;
  };
  for (const [container, returned] of [...totals].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const current = value.industry.stock.containers.find(
      (c) => c.id === container,
    );
    let mass = returned.mass,
      volume = returned.volume;
    for (const p of value.industry.stock.positions.filter(
      (p) => p.container === container,
    )) {
      const batch = value.industry.stock.batches.find((b) => b.id === p.batch);
      mass += BigInt(p.quantity) * BigInt(batch.massMg);
      volume += BigInt(p.quantity) * BigInt(batch.volumeUl);
    }
    if (
      mass > BigInt(Number.MAX_SAFE_INTEGER) ||
      volume > BigInt(Number.MAX_SAFE_INTEGER)
    )
      throw Error('recovery-dimension-capacity');
    const neededMass = Math.max(current.maxMassMg, Number(mass)),
      neededVolume = Math.max(current.maxVolumeUl, Number(volume));
    if (
      neededMass !== current.maxMassMg ||
      neededVolume !== current.maxVolumeUl
    )
      apply({
        kind: 'resize',
        container,
        mass: neededMass,
        volume: neededVolume,
      });
  }
  for (const row of live) apply({ kind: 'cancel-session', session: row.id });
  return states;
}
export function transition(value, c) {
  const next = applyTransition(value, c);
  if (next)
    try {
      recoveryStates(next);
    } catch (error) {
      throw Error(`recovery-capacity: ${error.message}`);
    }
  return next;
}
export function parseRuntimeEnvelope(raw) {
  const value = captureData(raw);
  fields(value, [
    'version',
    'revision',
    'clock',
    'spawnSerial',
    'industry',
    'sessions',
    'spawns',
    'receipts',
  ]);
  if (value.version !== 1 || !Array.isArray(value.receipts))
    throw Error('envelope');
  let expected = initialRuntimeEnvelope();
  for (const rawCommand of value.receipts) {
    const next = applyTransition(expected, captureCommand(rawCommand));
    if (!next) throw Error('duplicate-receipt');
    expected = next;
  }
  if (!equal(value, expected)) throw Error('incoherent-envelope');
  recoveryStates(expected);
  return JSON.parse(JSON.stringify(expected));
}
export function project(value) {
  return freeze({
    sessions: value.sessions,
    stock: value.industry.stock,
    machines: value.industry.machines,
    clock: value.clock,
    spawns: value.spawns.map((s) => ({
      ...s,
      remaining: value.industry.deposits.find((d) => d.id === s.id).remaining,
    })),
  });
}
