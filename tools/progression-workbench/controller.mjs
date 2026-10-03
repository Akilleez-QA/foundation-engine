import {createAuthoredDocument} from '../../src/kits/authoring/document.ts';
import {createInventoryLedger} from '../../src/kits/inventory/ledger.ts';
import {createModifiers} from '../../src/kits/capabilities/modifiers.ts';
import {
  createProgressionState,
  prepareProgressionChange,
  inspectProgressionChange,
  deriveProgressionGrantSources,
} from '../../src/kits/capabilities/progression.ts';
import {prepareResourceChange} from '../../src/kits/capabilities/resource-values.ts';

export const storageKey = 'progression-workbench|device|workbench.session';
/** Sample one-writer adapter. Compare/write is synchronous, not cross-process atomic CAS. */
export function createWorkbenchStoragePort(port) {
  let seen = false,
    expected = null;
  const check = () => {
    if (!seen || port.get(storageKey) !== expected) throw Error('workbench external storage conflict');
  };
  return {
    kind: port.kind,
    get(key) {
      const raw = port.get(key);
      if (key === storageKey && !seen) {
        expected = raw;
        seen = true;
      }
      return raw;
    },
    set(key, value) {
      if (key === storageKey) {
        check();
        port.set(key, value);
        expected = value;
      } else port.set(key, value);
    },
    remove(key) {
      if (key === storageKey) {
        check();
        port.remove(key);
        expected = null;
      } else port.remove(key);
    },
    keys: () => port.keys(),
    ...(port.subscribe ? {subscribe: fn => port.subscribe(fn)} : {}),
  };
}
const epoch = 'sample-epoch-v1',
  rulesId = 'sample-v1';
const bounds = {xpTypes: 1, skills: 4, prerequisites: 1, grants: 3, learned: 4};
const rules = {
  id: rulesId,
  allocationLimit: 6,
  xpTypes: [{id: 'practice', maxBalance: 100}],
  skills: [
    {id: 'alpha', xpType: 'practice', xpCost: 2, pointCost: 2, requires: [], certificates: ['access'], schematics: []},
    {id: 'beta', xpType: 'practice', xpCost: 2, pointCost: 2, requires: [], certificates: ['access'], schematics: []},
    {
      id: 'advanced',
      xpType: 'practice',
      xpCost: 3,
      pointCost: 2,
      requires: ['alpha'],
      certificates: [],
      schematics: [],
    },
    {id: 'delta', xpType: 'practice', xpCost: 2, pointCost: 3, requires: [], certificates: [], schematics: ['pattern']},
  ],
};
const inventoryOptions = {capacities: {awards: 3, vouchers: 2}, maxOperations: 25};
const policy = {overflow: 'clamp', rounding: 'reject'};
const external = [{kind: 'certificate', id: 'access', source: 'tutorial'}];
const batch = id => ({id, material: id, properties: {}});
const output = (container, id, quantity = 1) => ({container, batch: batch(id), quantity});
const consume = (container, batchId, quantity = 1) => ({container, batchId, quantity});
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
function fields(raw, keys) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('invalid');
  const own = Reflect.ownKeys(raw);
  if (own.length !== keys.length || own.some(k => !keys.includes(k))) throw Error('invalid');
  return raw;
}
function text(raw) {
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > 64) throw Error('invalid');
  return raw;
}
function number(raw, min, max, integer = false) {
  if (
    typeof raw !== 'number' ||
    !Number.isFinite(raw) ||
    raw < min ||
    raw > max ||
    (integer && !Number.isSafeInteger(raw))
  )
    throw Error('invalid');
  return raw === 0 ? 0 : raw;
}
function command(raw) {
  const r = fields(raw, ['epoch', 'id', 'payload']),
    e = text(r.epoch),
    id = text(r.id),
    p = r.payload;
  if (!p || typeof p !== 'object') throw Error('invalid');
  const kind = p.kind;
  let payload;
  if (kind === 'learn' || kind === 'surrender') {
    fields(p, ['kind', 'skill']);
    const skill = text(p.skill);
    if (!rules.skills.some(s => s.id === skill)) throw Error('unknown');
    payload = {kind, skill};
  } else if (kind === 'free' || kind === 'voucher') {
    fields(p, ['kind']);
    payload = {kind};
  } else if (kind === 'earn') {
    fields(p, ['kind', 'amount']);
    payload = {kind, amount: number(p.amount, 1, 20, true)};
  } else if (kind === 'adjust') {
    fields(p, ['kind', 'resource', 'delta']);
    const resource = p.resource;
    if (resource !== 'capacity' && resource !== 'continuous') throw Error('invalid');
    payload = {kind, resource, delta: number(p.delta, -100, 100)};
  } else throw Error('invalid');
  return freeze({epoch: e, id, payload});
}
function stats(value) {
  const owner = createModifiers({capacity: 10}, 4);
  for (const skill of value.progression.learned) {
    const add = {alpha: 2, beta: 3, advanced: 0, delta: 4}[skill];
    owner.set(skill, [{stat: 'capacity', add, multiply: skill === 'advanced' ? 2 : 1}]);
  }
  return owner;
}
export function initialEnvelope() {
  const progression = createProgressionState(rules, bounds);
  progression.xp[0].balance = 12;
  const inventory = createInventoryLedger(inventoryOptions);
  inventory.transact('seed', [], [output('awards', 'blocker', 3)]);
  return {
    version: 1,
    rulesId,
    epoch,
    revision: 0,
    progression,
    inventory: inventory.snapshot(),
    external: structuredClone(external),
    resources: {
      capacity: {version: 1, mode: 'safe-integer', min: 0, max: 10, current: 8},
      continuous: {version: 1, mode: 'continuous', min: 0, max: 1, current: 0.75},
    },
    receipts: [],
  };
}
function transition(value, c) {
  if (c.epoch !== value.epoch) throw Error('epoch');
  const prior = value.receipts.find(r => r.id === c.id);
  if (prior) {
    if (JSON.stringify(prior) !== JSON.stringify(c)) throw Error('conflict');
    return null;
  }
  if (value.receipts.length >= 24) throw Error('history-full');
  const next = structuredClone(value),
    p = c.payload,
    inventory = createInventoryLedger(inventoryOptions, next.inventory);
  const exchange = (take, give) => {
    const result = inventory.transact(c.id, take, give);
    if (!result.ok) throw Error(result.reason);
  };
  if (p.kind === 'learn' || p.kind === 'surrender' || p.kind === 'earn') {
    const change = p.kind === 'earn' ? {kind: 'earn', xpType: 'practice', amount: p.amount} : p;
    const result = prepareProgressionChange(next.progression, change, rules, bounds);
    if (!result.ok) throw Error(result.reason);
    if (p.kind === 'learn') exchange([], [output('awards', `token-${p.skill}`)]);
    if (p.kind === 'surrender') exchange([consume('awards', `token-${p.skill}`), consume('vouchers', 'voucher')], []);
    next.progression = result.state;
    const capacity = prepareResourceChange(
      next.resources.capacity,
      {kind: 'bounds', min: 0, max: stats(next).values().capacity, adjust: 'retain'},
      policy,
    );
    if (!capacity.ok) throw Error(capacity.reason);
    next.resources.capacity = capacity.state;
  } else if (p.kind === 'free') {
    const quantity = inventory.quantity('awards', 'blocker');
    if (!quantity) throw Error('already-free');
    exchange([consume('awards', 'blocker', quantity)], []);
  } else if (p.kind === 'voucher') exchange([], [output('vouchers', 'voucher')]);
  else {
    const result = prepareResourceChange(next.resources[p.resource], {kind: 'add', delta: p.delta}, policy);
    if (!result.ok) throw Error(result.reason);
    next.resources[p.resource] = result.state;
  }
  next.inventory = inventory.snapshot();
  next.receipts.push(c);
  next.revision++;
  return next;
}
// Replay is bounded by 24 commands. Exact structural equality also rejects unknown nested fields.
function equal(actual, expected) {
  if (actual === expected) return true;
  if (
    !actual ||
    !expected ||
    typeof actual !== 'object' ||
    typeof expected !== 'object' ||
    Array.isArray(actual) !== Array.isArray(expected)
  )
    return false;
  const keys = Reflect.ownKeys(actual),
    wanted = Reflect.ownKeys(expected);
  return keys.length === wanted.length && keys.every(k => wanted.includes(k) && equal(actual[k], expected[k]));
}
export function parseEnvelope(raw) {
  const r = fields(raw, [
    'version',
    'rulesId',
    'epoch',
    'revision',
    'progression',
    'inventory',
    'external',
    'resources',
    'receipts',
  ]);
  if (r.version !== 1 || r.rulesId !== rulesId || r.epoch !== epoch) throw Error('rules-mismatch');
  if (!Array.isArray(r.receipts)) throw Error('invalid');
  const length = r.receipts.length;
  if (!Number.isSafeInteger(length) || length > 24) throw Error('history-full');
  let expected = initialEnvelope();
  for (let i = 0; i < length; i++) {
    const next = transition(expected, command(r.receipts[i]));
    if (!next) throw Error('duplicate-receipt');
    expected = next;
  }
  if (!equal(r, expected)) throw Error('incoherent-envelope');
  return expected;
}
export const sectionDefinition = {
  id: 'workbench.session',
  scope: 'device',
  version: 1,
  maxChars: 65536,
  initial: initialEnvelope,
  parse: parseEnvelope,
  // SaveStore catches a throwing merge as corrupt input. Preserve the valid external record instead;
  // the controller detects this divergence and blocks, including after automatic retry/disposal.
  merge: (stored, incoming) => (equal(stored, incoming) ? parseEnvelope(incoming) : parseEnvelope(stored)),
};
function view(value) {
  const trace = stats(value).explain('capacity'),
    inventory = createInventoryLedger(inventoryOptions, value.inventory);
  const grants = deriveProgressionGrantSources(value.progression, rules, bounds).map(g => ({
    kind: g.kind,
    id: g.id,
    sources: g.skills.map(s => `skill:${s}`),
  }));
  for (const fact of value.external) {
    let grant = grants.find(g => g.kind === fact.kind && g.id === fact.id);
    if (!grant) {
      grant = {kind: fact.kind, id: fact.id, sources: []};
      grants.push(grant);
    }
    grant.sources.push(`external:${fact.source}`);
  }
  return freeze({
    capacity: trace.value,
    trace,
    grants,
    skills: rules.skills.map(s => ({
      id: s.id,
      learn: inspectProgressionChange(value.progression, {kind: 'learn', skill: s.id}, rules, bounds),
      surrender: inspectProgressionChange(value.progression, {kind: 'surrender', skill: s.id}, rules, bounds),
    })),
    blockers: inventory.quantity('awards', 'blocker'),
    vouchers: inventory.quantity('vouchers', 'voucher'),
    resources: structuredClone(value.resources),
  });
}
/** Finite author-owned sample. SaveStore owns persistence; AuthoredDocument owns edit authority. */
export function createWorkbenchController({saveHandle, hasEnvelope, readPersisted}) {
  if (typeof readPersisted !== 'function' || typeof hasEnvelope !== 'function')
    throw Error('Persistence observations required');
  let blocked = null,
    retired = false,
    busy = false,
    message = 'Preview a choice before accepting it.',
    terminal = null;
  let starting = initialEnvelope();
  try {
    const status = saveHandle.status();
    if (['quarantined', 'newer', 'unavailable'].includes(status)) throw Error(`recovery-required:${status}`);
    starting = parseEnvelope(saveHandle.get());
  } catch (error) {
    blocked = error.message;
  }
  const document = createAuthoredDocument({
    id: 'allocation-workbench',
    json: JSON.stringify(starting),
    limits: {maxBytes: 65536, maxNodes: 8192, maxDepth: 20},
    validate: value => {
      try {
        parseEnvelope(value);
        return true;
      } catch {
        return false;
      }
    },
  });
  // A prior durable record may lag accepted memory after a refused storage write.
  let lastPersisted;
  try {
    lastPersisted = readPersisted();
  } catch {
    blocked ??= 'recovery-required:unreadable';
  }
  // One retained accepted projection and one parsed physical envelope per controller lifetime.
  // Preview projections never populate this cache; successful publication changes value identity.
  let projectedValue,
    projectedView,
    parsedRaw,
    parsedValue,
    comparedValue,
    persistedMatches = false;
  const acceptedView = value => {
    if (value !== projectedValue) {
      projectedView = view(value);
      projectedValue = value;
    }
    return projectedView;
  };
  const persistedValue = raw => {
    if (raw !== parsedRaw) {
      if (typeof raw !== 'string' || raw.length > 65536) throw Error('invalid-storage');
      const stored = JSON.parse(raw);
      if (stored.v !== 1) throw Error('version');
      const value = parseEnvelope(stored.data);
      parsedValue = value;
      parsedRaw = raw;
      comparedValue = undefined;
    }
    const accepted = document.read().value;
    if (accepted !== comparedValue) {
      persistedMatches = equal(parsedValue, accepted);
      comparedValue = accepted;
    }
    return persistedMatches;
  };
  const observe = () => {
    let saveStatus = 'unavailable',
      durable = false;
    try {
      saveStatus = saveHandle.status();
      if (['quarantined', 'newer', 'unavailable'].includes(saveStatus)) blocked ??= `recovery-required:${saveStatus}`;
      if (!equal(saveHandle.get(), document.read().value)) blocked ??= 'external-conflict';
      const raw = readPersisted();
      if (raw !== null) {
        durable = persistedValue(raw) && hasEnvelope();
        if (raw !== lastPersisted && !durable) blocked ??= 'external-conflict';
        if (durable) lastPersisted = raw;
      } else if (lastPersisted !== null && lastPersisted !== undefined) blocked ??= 'external-conflict';
    } catch (error) {
      blocked ??= `recovery-required:${error.message}`;
    }
    return {saveStatus, durable};
  };
  const read = () => {
    if (terminal) return terminal;
    const persistence = observe(),
      envelope = document.read().value;
    return Object.freeze({envelope, view: acceptedView(envelope), ...persistence, blocked, retired, message});
  };
  const guard = fn => {
    if (retired) return {status: 'refused', reason: 'retired'};
    if (busy) return {status: 'refused', reason: 'busy'};
    busy = true;
    try {
      observe();
      if (blocked) return {status: 'refused', reason: blocked};
      return fn();
    } catch (error) {
      message = error.message;
      return {status: 'refused', reason: error.message};
    } finally {
      busy = false;
    }
  };
  const publishSave = () => {
    const value = document.read().value;
    saveHandle.update(
      draft => {
        for (const k of Object.keys(draft)) delete draft[k];
        Object.assign(draft, structuredClone(value));
      },
      {now: true},
    );
  };
  return {
    read,
    preview: raw =>
      guard(() => {
        const captured = command(raw),
          before = document.read(),
          next = transition(before.value, captured);
        if (!next) {
          message = 'Exact command already accepted.';
          return {status: 'duplicate'};
        }
        const result = document.prepare(before.ticket, () => JSON.stringify(next));
        if (result.status !== 'prepared') return result;
        message = 'Candidate only; accepted state is unchanged.';
        return {status: 'prepared', candidate: result.candidate, view: view(result.candidate.value)};
      }),
    commit: candidate =>
      guard(() => {
        const result = document.publish(candidate);
        if (result.status !== 'accepted') return result;
        message = 'Accepted in memory; durability is reported separately.';
        try {
          publishSave();
        } catch (error) {
          message = `Accepted in memory; save raised: ${error.message}`;
        }
        observe();
        return {status: 'accepted'};
      }),
    cancel: candidate =>
      guard(() => {
        document.discard(candidate);
        message = 'Candidate cancelled.';
        return {status: 'cancelled'};
      }),
    save: () =>
      guard(() => {
        publishSave();
        message = 'Retried latest accepted envelope.';
        return {status: 'saved', durable: observe().durable};
      }),
    dispose() {
      if (retired) return;
      if (busy) throw Error('busy');
      terminal = read();
      retired = true;
      document.dispose();
      terminal = freeze({...terminal, retired: true});
    },
  };
}
