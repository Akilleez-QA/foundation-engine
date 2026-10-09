import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSaveStore, type Timers} from '../../core/save/store';
import {MemoryBackend} from '../../core/save/storage-port';
import type {SaveSection, SaveStore} from '../../core/save/section';
import {createInventoryLedger, type InventoryResult, type InventorySnapshot, type MaterialBatch} from './ledger';

const options = {capacities: {source: 8, destination: 8}, maxOperations: 16};
const material: MaterialBatch = {id: 'unit', material: 'unit', properties: {grade: 2}};
const receipt: MaterialBatch = {id: 'receipt', material: 'receipt', properties: {}};
const key = 'game|p:1|test.inventory-continuation';
const maxPending = 4;
interface Continuation {
  inventory: InventorySnapshot;
  pending: string[];
}

// Test-only creator composition, not a new inventory or effects framework. The creator owns
// pending effects, their bounds and lifetime; SaveStore owns the one coherent envelope.
const continuation: SaveSection<Continuation> = {
  id: 'test.inventory-continuation',
  scope: 'player',
  version: 1,
  flush: 'lazy',
  initial() {
    const ledger = createInventoryLedger(options);
    ledger.transact('initial', [], [{container: 'source', batch: material, quantity: 4}]);
    return {inventory: ledger.snapshot(), pending: []};
  },
  parse(raw) {
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      !Object.hasOwn(raw, 'inventory') ||
      !('inventory' in raw) ||
      !raw.inventory ||
      typeof raw.inventory !== 'object' ||
      Array.isArray(raw.inventory)
    )
      throw Error('invalid inventory envelope');
    const value = raw as Continuation;
    if (
      !value ||
      !Array.isArray(value.pending) ||
      value.pending.length > maxPending ||
      value.pending.some(id => typeof id !== 'string' || !id.startsWith('transfer:')) ||
      new Set(value.pending).size !== value.pending.length
    )
      throw Error('invalid pending effects');
    const inventory = createInventoryLedger(options, value.inventory).snapshot();
    const ids = new Set(inventory.operations.map(op => op.id));
    for (const id of value.pending)
      if (!ids.has(id) || ids.has(`effect:${id}`)) throw Error('invalid effect ownership');
    for (const id of ids)
      if (id.startsWith('transfer:') && value.pending.includes(id) === ids.has(`effect:${id}`))
        throw Error('transfer must have exactly one pending effect or applied receipt');
    return {inventory, pending: [...value.pending]};
  },
};

function open(disk = new MemoryBackend()) {
  // Lazy sections flush explicitly; the roster's timer is retained/cleared without wall-clock work.
  const callbacks = new Set<() => void>();
  const timers: Timers = {
    now: () => 0,
    set: fn => {
      callbacks.add(fn);
      return fn;
    },
    clear: handle => callbacks.delete(handle as () => void),
  };
  const store = createSaveStore({
    local: disk.port(),
    session: new MemoryBackend().port(0, 'session'),
    build: 'continuation@test',
    timers,
    sections: [continuation],
  });
  return {disk, store};
}

function copyDisk(disk: MemoryBackend) {
  const copy = new MemoryBackend();
  for (const [k, value] of disk.data) copy.data.set(k, value);
  return copy;
}

function owner(store: SaveStore, signal: AbortSignal) {
  const player = store.activePlayer();
  const handle = store.section(continuation).of(player);
  const update = (change: (draft: Continuation) => InventoryResult) => {
    if (signal.aborted) return {ok: false as const, reason: 'stale-owner'};
    let result: InventoryResult | undefined;
    handle.update(draft => {
      result = change(draft);
    });
    assert.ok(result);
    return result;
  };
  return {
    transfer(id: string) {
      return update(draft => {
        const ledger = createInventoryLedger(options, draft.inventory);
        const result = ledger.transfer(`transfer:${id}`, 'source', 'destination', material.id, 1);
        if (result.ok && !result.duplicate) {
          if (draft.pending.length === maxPending) throw Error('pending effects full');
          draft.pending.push(`transfer:${id}`);
          draft.inventory = ledger.snapshot();
        }
        return result;
      });
    },
    applyEffect(id: string) {
      return update(draft => {
        const transfer = `transfer:${id}`;
        const applied = draft.inventory.operations.some(op => op.id === `effect:${transfer}`);
        if (!draft.pending.includes(transfer) && !applied) throw Error('effect has no committed transfer');
        const ledger = createInventoryLedger(options, draft.inventory);
        const result = ledger.transact(
          `effect:${transfer}`,
          [],
          [{container: 'destination', batch: receipt, quantity: 1}],
        );
        if (result.ok) {
          draft.pending = draft.pending.filter(pending => pending !== transfer);
          draft.inventory = ledger.snapshot();
        }
        return result;
      });
    },
    snapshot: () => handle.get(),
  };
}

test('inventory continuation: checkpoint before deferred effect resumes identical receipts and state once', () => {
  const uninterrupted = open();
  const live = owner(uninterrupted.store, new AbortController().signal);
  assert.deepEqual(live.transfer('a'), {ok: true, duplicate: false});
  assert.deepEqual(live.snapshot().pending, ['transfer:a']);
  assert.deepEqual(uninterrupted.store.flush().failed, []);
  assert.ok(uninterrupted.disk.data.has(key));
  const resumed = open(copyDisk(uninterrupted.disk));
  try {
    const restored = owner(resumed.store, new AbortController().signal);
    assert.deepEqual(restored.snapshot(), live.snapshot());
    const advance = (current: ReturnType<typeof owner>) => [
      current.transfer('a'),
      current.applyEffect('a'),
      current.applyEffect('a'),
      current.transfer('b'),
      current.applyEffect('b'),
    ];
    const expected = advance(live);
    assert.deepEqual(advance(restored), expected);
    assert.deepEqual(expected, [
      {ok: true, duplicate: true},
      {ok: true, duplicate: false},
      {ok: true, duplicate: true},
      {ok: true, duplicate: false},
      {ok: true, duplicate: false},
    ]);
    assert.deepEqual(restored.snapshot(), live.snapshot());
    assert.deepEqual(restored.snapshot().pending, []);
    const inventory = createInventoryLedger(options, restored.snapshot().inventory);
    assert.equal(inventory.quantity('source', material.id), 2);
    assert.equal(inventory.quantity('destination', material.id), 2);
    assert.equal(inventory.quantity('destination', receipt.id), 2);
    resumed.store.flush();
    assert.equal(resumed.store.section(continuation).status(), 'saved');
    const next = open(copyDisk(resumed.disk));
    try {
      const retry = owner(next.store, new AbortController().signal);
      assert.deepEqual(retry.applyEffect('a'), {ok: true, duplicate: true});
      assert.deepEqual(retry.snapshot(), restored.snapshot());
    } finally {
      next.store.dispose();
    }
  } finally {
    uninterrupted.store.dispose();
    resumed.store.dispose();
  }
});

test('inventory continuation: failed flush preserves the complete prior checkpoint and retries one envelope', () => {
  const {disk, store} = open();
  try {
    const current = owner(store, new AbortController().signal);
    current.transfer('a');
    store.flush();
    const before = disk.data.get(key);
    disk.failSet = k => k === key;
    current.applyEffect('a');
    assert.deepEqual(store.flush().failed, [key]);
    assert.equal(store.section(continuation).status(), 'session');
    assert.equal(
      disk.data.get(key),
      before,
      'failed effect checkpoint must leave transfer and pending effect together',
    );
    const reload = open(copyDisk(disk));
    try {
      const restored = owner(reload.store, new AbortController().signal);
      assert.deepEqual(restored.snapshot().pending, ['transfer:a']);
      assert.deepEqual(restored.applyEffect('a'), {ok: true, duplicate: false});
      assert.deepEqual(restored.snapshot(), current.snapshot());
    } finally {
      reload.store.dispose();
    }
    disk.failSet = () => false;
    assert.deepEqual(store.flush().written, [key]);
    assert.equal(store.section(continuation).status(), 'saved');
  } finally {
    disk.failSet = () => false;
    store.dispose();
  }
});

test('inventory continuation: retired creator callback cannot publish into another player or a resumed owner', () => {
  const {disk, store} = open();
  const lifetime = new AbortController();
  const old = owner(store, lifetime.signal);
  old.transfer('a');
  store.flush();
  const before = old.snapshot();
  const delayed = () => old.applyEffect('a');
  const otherPlayer = store.addPlayer();
  store.setActivePlayer(otherPlayer);
  lifetime.abort();
  assert.deepEqual(delayed(), {ok: false, reason: 'stale-owner'});
  assert.deepEqual(store.section(continuation).of('1').get(), before);
  assert.deepEqual(store.section(continuation).get().pending, []);
  const retained = store.section(continuation).of('1');
  store.dispose();
  assert.throws(() => retained.update(() => undefined), /disposed/);
  const resumed = open(copyDisk(disk));
  try {
    resumed.store.setActivePlayer('1');
    const fresh = owner(resumed.store, new AbortController().signal);
    assert.deepEqual(delayed(), {ok: false, reason: 'stale-owner'});
    assert.deepEqual(fresh.applyEffect('a'), {ok: true, duplicate: false});
    assert.deepEqual(fresh.snapshot().pending, []);
  } finally {
    resumed.store.dispose();
  }
});

test('inventory continuation: creator parser rejects a checkpoint that loses its pending authoritative effect', () => {
  const {store} = open();
  try {
    const current = owner(store, new AbortController().signal);
    current.transfer('a');
    const before = current.snapshot();
    for (const malformed of [
      {pending: []},
      {pending: [], inventory: undefined},
      {pending: [], inventory: null},
      {pending: [], inventory: []},
      {pending: [], inventory: {}},
      {pending: [], inventory: {...before.inventory, operations: undefined}},
      Object.assign(Object.create({inventory: before.inventory}), {pending: []}),
    ])
      assert.throws(() => continuation.parse(malformed), /inventory|record/i);
    const missing = {...structuredClone(before), pending: []};
    assert.throws(() => store.section(continuation).replace(missing), /exactly one pending effect/);
    assert.deepEqual(current.snapshot(), before);
    assert.throws(() => current.applyEffect('unknown'), /no committed transfer/);
    assert.deepEqual(current.snapshot(), before);
  } finally {
    store.dispose();
  }
});
