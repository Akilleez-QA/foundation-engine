import {createAuthoredDocument} from '../../src/kits/authoring/document.ts';
import {createEquipment} from '../../src/kits/equipment/pure.ts';
import {createMaterializationOwner} from '../../src/kits/resources/materialization.ts';
import {createRetirementInventory} from '../../src/kits/inventory/retirement.ts';

export const storageKey = 'custody-composition|device|custody.session';
const limits = {maxBytes: 131072, maxNodes: 16384, maxDepth: 24};
const materialOptions = {
  inventory: {capacities: {input: 2, output: 1}, maxOperations: 128, maxMaterials: 8},
  maxPending: 1,
  maxReceipts: 128,
  limits,
};
const definition = {
  id: 'authored-pattern',
  revision: 1,
  output: {localId: 'crafted', material: 'authored-material', properties: {grade: 7}, container: 'output', quantity: 1},
};
const catalog = Object.fromEntries(
  ['blocker', 'a', 'b', 'crafted'].map(id => [
    id,
    {id, definition: id === 'crafted' ? 'authored-pattern@1' : `authored-${id}`, slots: ['hand'], functional: true},
  ]),
);
const positions = {blocker: [-3, 0.5, -1.5], a: [-3, 0.5, -0.5], b: [-3, 0.5, 0.5], crafted: [-3, 0.5, 1.5]};
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) freeze(v);
    Object.freeze(value);
  }
  return value;
};
const equal = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Reflect.ownKeys(a),
    bk = Reflect.ownKeys(b);
  return ak.length === bk.length && ak.every(k => bk.includes(k) && equal(a[k], b[k]));
};
function fields(raw, keys) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('invalid');
  const own = Reflect.ownKeys(raw);
  if (own.length !== keys.length || own.some(k => !keys.includes(k))) throw Error('invalid');
  return raw;
}
function integer(v) {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw Error('invalid');
  return v;
}
function capture(raw) {
  const r = fields(raw, ['epoch', 'id', 'payload']),
    epoch = integer(r.epoch),
    id = r.id;
  if (typeof id !== 'string' || !id.length || id.length > 64) throw Error('invalid');
  const p = r.payload,
    kind = p?.kind;
  let payload;
  if (['pickup', 'drop', 'equip', 'unequip'].includes(kind)) {
    fields(p, ['kind', 'item']);
    const item = p.item;
    if (typeof item !== 'string' || !Object.hasOwn(catalog, item)) throw Error('unknown-item');
    payload = {kind, item};
  } else if (['reserve', 'checkpoint'].includes(kind)) {
    fields(p, ['kind']);
    payload = {kind};
  } else if (['settle', 'cancel-reservation'].includes(kind)) {
    fields(p, ['kind', 'request']);
    payload = {kind, request: integer(p.request)};
  } else throw Error('invalid');
  return freeze({epoch, id, payload});
}
function materialChange(snapshot, command) {
  const owner = createMaterializationOwner(materialOptions, snapshot);
  try {
    const p = owner.prepare(owner.epoch, command);
    if (p.status !== 'prepared') throw Error(p.reason ?? p.status);
    const result = owner.publish(p.candidate);
    if (result.status !== 'accepted') throw Error(result.status);
    return {snapshot: owner.snapshot(), result: p.result};
  } finally {
    owner.close();
  }
}
export function initialEnvelope() {
  const owner = createMaterializationOwner(materialOptions);
  let materialization;
  try {
    const p = owner.prepare(owner.epoch, {
      kind: 'exchange',
      id: 'seed',
      consume: [],
      produce: [
        {container: 'input', batch: {id: '0:input', material: 'authored-input', properties: {grade: 3}}, quantity: 2},
      ],
    });
    if (p.status !== 'prepared') throw Error('seed');
    owner.publish(p.candidate);
    materialization = owner.snapshot();
  } finally {
    owner.close();
  }
  const equipment = createEquipment(['hand'], 1, {revision: 0, items: [catalog.blocker], equipped: []}).snapshot();
  return {
    version: 1,
    rules: 'custody-sample-v1',
    epoch: 0,
    revision: 0,
    locations: {blocker: 'bag', a: 'world', b: 'world', crafted: 'unissued'},
    equipment,
    materialization,
    issuance: [],
    receipts: [],
    journal: [],
  };
}
function transition(value, c) {
  if (c.epoch !== value.epoch) throw Error('epoch');
  const previous = value.receipts.find(r => r.id === c.id);
  if (previous) {
    if (!equal(previous, c)) throw Error('conflict');
    return null;
  }
  if (value.journal.length >= 64) throw Error('history-full');
  if (value.receipts.length >= 16 && c.payload.kind !== 'checkpoint') throw Error('receipts-full');
  const next = structuredClone(value),
    p = c.payload,
    equipment = createEquipment(['hand'], 1, next.equipment);
  const requireApplied = result => {
    if (result !== 'applied') throw Error(result);
  };
  const revision = () => equipment.snapshot().revision;
  if (p.kind === 'pickup') {
    if (next.locations[p.item] !== 'world') throw Error('location');
    requireApplied(equipment.acquire(catalog[p.item], revision()));
    next.locations[p.item] = 'bag';
  } else if (p.kind === 'drop') {
    if (next.locations[p.item] !== 'bag') throw Error('location');
    requireApplied(equipment.release(p.item, revision()));
    next.locations[p.item] = 'world';
  } else if (p.kind === 'equip' || p.kind === 'unequip') {
    if (next.locations[p.item] !== (p.kind === 'equip' ? 'bag' : 'equipped')) throw Error('location');
    requireApplied(equipment.commit(p.item, revision(), p.kind === 'equip'));
    const state = equipment.snapshot();
    for (const item of state.items) next.locations[item.id] = state.equipped.includes(item.id) ? 'equipped' : 'bag';
  } else if (p.kind === 'reserve') {
    if (next.issuance.length) throw Error('issued');
    const result = materialChange(next.materialization, {
      id: c.id,
      kind: 'admit',
      consume: [{container: 'input', batchId: '0:input', quantity: 1}],
      policy: {kind: 'pinned', definition},
    });
    next.materialization = result.snapshot;
  } else if (p.kind === 'settle') {
    if (next.issuance.length || next.locations.crafted !== 'unissued') throw Error('issued');
    // Capacity is proven before even the private materialization proposal is attempted.
    requireApplied(equipment.acquire(catalog.crafted, revision()));
    const settled = materialChange(next.materialization, {id: c.id, kind: 'settle', request: p.request});
    const batchId = settled.result.batchId;
    const withdrawn = materialChange(settled.snapshot, {
      id: `delivery:${c.id}`,
      kind: 'exchange',
      consume: [{container: 'output', batchId, quantity: 1}],
      produce: [],
    });
    next.materialization = withdrawn.snapshot;
    next.locations.crafted = 'bag';
    next.issuance.push({item: 'crafted', batchId, selection: settled.result.selection, request: p.request});
  } else if (p.kind === 'cancel-reservation') {
    next.materialization = materialChange(next.materialization, {
      id: c.id,
      kind: 'cancel',
      request: p.request,
    }).snapshot;
  } else {
    next.materialization = materialChange(next.materialization, {id: c.id, kind: 'checkpoint'}).snapshot;
    next.epoch++;
    next.receipts = [];
  }
  next.equipment = equipment.snapshot();
  next.revision++;
  next.journal.push(c);
  if (p.kind !== 'checkpoint') next.receipts.push(c);
  return next;
}
/** Replaying the bounded authored commands validates cross-owner coupling, not just each schema. */
export function parseEnvelope(raw) {
  const r = fields(raw, [
    'version',
    'rules',
    'epoch',
    'revision',
    'locations',
    'equipment',
    'materialization',
    'issuance',
    'receipts',
    'journal',
  ]);
  if (r.version !== 1 || r.rules !== 'custody-sample-v1') throw Error('rules');
  if (!Array.isArray(r.journal)) throw Error('journal');
  const length = r.journal.length;
  if (!Number.isSafeInteger(length) || length > 64) throw Error('history-full');
  let expected = initialEnvelope();
  for (let i = 0; i < length; i++) {
    const next = transition(expected, capture(r.journal[i]));
    if (!next) throw Error('duplicate-journal');
    expected = next;
  }
  if (!equal(r, expected)) throw Error('incoherent-envelope');
  return expected;
}
export const sectionDefinition = {
  id: 'custody.session',
  scope: 'device',
  version: 1,
  maxChars: 131072,
  initial: initialEnvelope,
  parse: parseEnvelope,
};
/** Sample single-writer guard. The synchronous compare/write is not cross-process atomic CAS. */
export function createCustodyStoragePort(port) {
  let seen = false,
    expected = null;
  const check = () => {
    if (!seen || port.get(storageKey) !== expected) throw Error('external-conflict');
  };
  return {
    kind: port.kind,
    get(key) {
      const raw = port.get(key);
      if (key === storageKey) {
        if (!seen) {
          seen = true;
          expected = raw;
        } else if (raw !== expected) throw Error('external-conflict');
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
function project(envelope) {
  const world = [],
    bag = [],
    equipped = [];
  for (const [id, location] of Object.entries(envelope.locations)) {
    if (location === 'world') world.push({...catalog[id], position: [...positions[id]]});
    else if (location === 'bag') bag.push({...catalog[id]});
    else if (location === 'equipped') equipped.push({...catalog[id]});
  }
  const inventory = createRetirementInventory(materialOptions.inventory, envelope.materialization.inventory);
  return freeze({
    world,
    bag,
    equipped,
    reservation: envelope.materialization.requests[0]?.serial ?? null,
    stock: inventory.available('input', '0:input'),
    issued: envelope.issuance.length === 1,
  });
}
/** One visible document; kit proposals are temporary drafts, never independent pending authorities. */
export function createCustodyController({saveHandle, readPersisted}) {
  if (typeof readPersisted !== 'function') throw Error('readPersisted required');
  let blocked = null,
    retired = false,
    busy = false,
    pending = null,
    message = 'Preview an authored custody action.',
    terminal = null;
  let starting = initialEnvelope(),
    lastRaw;
  try {
    if (['quarantined', 'newer', 'unavailable'].includes(saveHandle.status()))
      throw Error(`recovery-required:${saveHandle.status()}`);
    starting = parseEnvelope(saveHandle.get());
    lastRaw = readPersisted();
  } catch (error) {
    blocked = error.message;
  }
  const document = createAuthoredDocument({
    id: 'custody-sample',
    json: JSON.stringify(starting),
    limits,
    validate: value => {
      try {
        parseEnvelope(value);
        return true;
      } catch {
        return false;
      }
    },
  });
  const candidates = new WeakSet();
  let projectedValue, projectedView, parsedRaw, parsedValue;
  const projection = value => {
    if (projectedValue !== value) {
      projectedView = project(value);
      projectedValue = value;
    }
    return projectedView;
  };
  const physical = raw => {
    if (raw !== parsedRaw) {
      if (typeof raw !== 'string' || raw.length > 131072) throw Error('invalid-storage');
      const wrapper = JSON.parse(raw);
      if (wrapper.v !== 1) throw Error('version');
      const value = parseEnvelope(wrapper.data);
      parsedValue = value;
      parsedRaw = raw;
    }
    return parsedValue;
  };
  try {
    if (lastRaw !== null && lastRaw !== undefined && !equal(physical(lastRaw), starting))
      blocked ??= 'external-conflict';
    else if (lastRaw === null && !equal(starting, initialEnvelope())) blocked ??= 'external-conflict';
  } catch (error) {
    blocked ??= `recovery-required:${error.message}`;
  }
  const observe = () => {
    let saveStatus = 'unavailable',
      durable = false,
      canAcknowledge = false;
    try {
      saveStatus = saveHandle.status();
      if (['quarantined', 'newer', 'unavailable'].includes(saveStatus)) blocked ??= `recovery-required:${saveStatus}`;
      const accepted = document.read().value,
        expected = pending?.value ?? accepted;
      if (!equal(saveHandle.get(), expected)) blocked ??= 'external-conflict';
      const raw = readPersisted();
      if (raw !== null) {
        const stored = physical(raw),
          matches = equal(stored, expected);
        if (raw !== lastRaw && !matches) blocked ??= 'external-conflict';
        durable = saveStatus === 'saved' && equal(stored, accepted);
        canAcknowledge = !!pending && saveStatus === 'saved' && matches;
        if (matches) lastRaw = raw;
      } else if (lastRaw !== null && lastRaw !== undefined) blocked ??= 'external-conflict';
    } catch (error) {
      blocked ??= `recovery-required:${error.message}`;
    }
    return {saveStatus, durable, canAcknowledge: canAcknowledge && !blocked};
  };
  const read = () => {
    if (terminal) return terminal;
    const persistence = observe(),
      envelope = document.read().value;
    return Object.freeze({
      envelope,
      view: projection(envelope),
      ...persistence,
      pending: !!pending,
      pendingRevision: pending?.value.revision ?? null,
      blocked,
      retired,
      message,
    });
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
  const write = () => {
    try {
      saveHandle.update(
        draft => {
          for (const k of Object.keys(draft)) delete draft[k];
          Object.assign(draft, structuredClone(pending.value));
        },
        {now: true},
      );
    } catch (error) {
      message = `Exact candidate retained: ${error.message}`;
    }
    message = 'Write attempted; only explicit acknowledgement can publish.';
    return {status: 'pending', canAcknowledge: observe().canAcknowledge};
  };
  return {
    read,
    preview: raw =>
      guard(() => {
        if (pending) return {status: 'refused', reason: 'pending'};
        const c = capture(raw),
          before = document.read(),
          next = transition(before.value, c);
        if (!next) return {status: 'duplicate'};
        const result = document.prepare(before.ticket, () => JSON.stringify(next));
        if (result.status === 'prepared') {
          candidates.add(result.candidate);
          return {...result, view: project(result.candidate.value)};
        }
        return result;
      }),
    commit: candidate =>
      guard(() => {
        if (pending) return {status: 'refused', reason: 'pending'};
        if (!candidates.has(candidate) || candidate.ticket !== document.read().ticket) return {status: 'stale'};
        pending = candidate;
        return write();
      }),
    cancel: candidate =>
      guard(() => {
        if (pending) return {status: 'refused', reason: 'pending'};
        if (!candidates.has(candidate)) return {status: 'stale'};
        candidates.delete(candidate);
        document.discard(candidate);
        return {status: 'cancelled'};
      }),
    retry: () => guard(() => (pending ? write() : {status: 'refused', reason: 'no-pending'})),
    acknowledge: () =>
      guard(() => {
        if (!pending) return {status: 'refused', reason: 'no-pending'};
        if (!observe().canAcknowledge) return {status: 'refused', reason: 'not-durable'};
        const result = document.publish(pending);
        if (result.status === 'accepted') {
          candidates.delete(pending);
          pending = null;
          message = 'Exact durable envelope accepted.';
        }
        return {status: result.status};
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
