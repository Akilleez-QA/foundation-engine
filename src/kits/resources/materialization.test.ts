import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  createMaterializationOwner,
  type MaterializationCommand,
  type MaterializationOptions,
  type MaterializationOutput,
  type MaterializationSnapshot,
} from './materialization';
import {createRetirementInventory} from '../inventory/retirement';
import {createSaveStore} from '../../core/save/store';
import {MemoryBackend} from '../../core/save/storage-port';
import type {SaveSection} from '../../core/save/section';
const limits = {maxBytes: 1000000, maxNodes: 100000, maxDepth: 30};
const options: MaterializationOptions = {
  inventory: {capacities: {input: 20, output: 4}, maxOperations: 100, maxMaterials: 30},
  maxPending: 4,
  maxReceipts: 40,
  limits,
};
const facts = (localId: string, grade: number): MaterializationOutput => ({
  localId,
  material: 'creator-output',
  properties: {grade},
  container: 'output',
  quantity: 1,
});
const consume = [{container: 'input', batchId: '0:input', quantity: 1}];
type Owner = ReturnType<typeof createMaterializationOwner>;
function apply(owner: Owner, command: MaterializationCommand) {
  const prepared = owner.prepare(owner.epoch, command);
  assert.equal(prepared.status, 'prepared');
  if (prepared.status !== 'prepared') throw Error(JSON.stringify(prepared));
  const published = owner.publish(prepared.candidate);
  assert.equal(published.status, 'accepted');
  return prepared.result;
}
function seed(owner: Owner, amount = 4) {
  apply(owner, {
    kind: 'exchange',
    id: 'seed',
    consume: [],
    produce: [
      {container: 'input', batch: {id: '0:input', material: 'input', properties: {grade: 1}}, quantity: amount},
    ],
  });
}
function stock(owner: Owner, selected = options) {
  return createRetirementInventory(selected.inventory, owner.snapshot().inventory);
}

test('two-version consumer freezes and pins grade 2 while current selection creates grade 9 with original admission costs', () => {
  const owner = createMaterializationOwner(options);
  seed(owner);
  const definition = {id: 'creator-definition', revision: 1, output: facts('pinned', 2)};
  const frozen = apply(owner, {
    kind: 'admit',
    id: 'freeze',
    consume,
    policy: {kind: 'frozen', output: facts('frozen', 2)},
  }).request!;
  const pinned = apply(owner, {kind: 'admit', id: 'pin', consume, policy: {kind: 'pinned', definition}}).request!;
  const current = apply(owner, {
    kind: 'admit',
    id: 'admit-current',
    consume,
    policy: {kind: 'current', definitionId: definition.id},
  }).request!;
  definition.revision = 2;
  definition.output = facts('current', 9);
  assert.deepEqual(owner.prepare(0, {id: 'too-soon', kind: 'settle', request: current}), {
    status: 'rejected',
    reason: 'selection-required',
  });
  apply(owner, {kind: 'select', id: 'choose', request: current, definition});
  definition.output.properties.grade = 99; // The creator's later mutation cannot change selected facts.
  for (const [request, id] of [
    [frozen, 'frozen'],
    [pinned, 'pinned'],
    [current, 'current'],
  ] as const)
    apply(owner, {kind: 'settle', id, request});
  const inventory = stock(owner);
  assert.equal(inventory.quantity('input', '0:input'), 1);
  assert.equal(inventory.material('0:frozen')!.properties.grade, 2);
  assert.equal(inventory.material('0:pinned')!.properties.grade, 2);
  assert.equal(inventory.material('0:current')!.properties.grade, 9);
  assert.equal(inventory.quantity('output', '0:current'), 1);
  const restored = createMaterializationOwner(options, owner.snapshot());
  assert.equal(restored.prepare(0, {kind: 'settle', id: 'current', request: current}).status, 'duplicate');
  assert.deepEqual(restored.prepare(0, {kind: 'cancel', id: 'current', request: current}), {
    status: 'rejected',
    reason: 'conflict',
  });
  assert.deepEqual(restored.snapshot(), owner.snapshot());
});

test('capacity refusal preserves reservation and selected revision across reload and retry', () => {
  const small = {...options, inventory: {...options.inventory, capacities: {input: 20, output: 1}}};
  let owner = createMaterializationOwner(small);
  seed(owner);
  apply(owner, {
    id: 'fill',
    kind: 'exchange',
    consume: [],
    produce: [{container: 'output', batch: {id: '0:block', material: 'block', properties: {}}, quantity: 1}],
  });
  const request = apply(owner, {
    id: 'admit',
    kind: 'admit',
    consume,
    policy: {kind: 'current', definitionId: 'catalog'},
  }).request!;
  apply(owner, {
    id: 'select',
    kind: 'select',
    request,
    definition: {id: 'catalog', revision: 2, output: facts('v2', 9)},
  });
  const before = owner.snapshot();
  const settle: MaterializationCommand = {id: 'settle', kind: 'settle', request};
  assert.deepEqual(owner.prepare(0, settle), {status: 'rejected', reason: 'capacity'});
  assert.deepEqual(owner.snapshot(), before);
  owner = createMaterializationOwner(small, before);
  assert.equal(stock(owner, small).available('input', '0:input'), 3);
  assert.deepEqual(
    owner.prepare(0, {
      id: 'v3',
      kind: 'select',
      request,
      definition: {id: 'catalog', revision: 3, output: facts('v3', 22)},
    }),
    {status: 'rejected', reason: 'already-selected'},
  );
  apply(owner, {
    id: 'free',
    kind: 'exchange',
    consume: [{container: 'output', batchId: '0:block', quantity: 1}],
    produce: [],
  });
  const receipt = apply(owner, settle);
  assert.equal(receipt.selection!.definition!.revision, 2);
  assert.equal(stock(owner, small).material('0:v2')!.properties.grade, 9);
});

test('retirement before settlement qualifies future output then epoch pruning rejects delayed commands', () => {
  const owner = createMaterializationOwner(options);
  seed(owner);
  apply(owner, {
    id: 'temporary',
    kind: 'exchange',
    consume: [],
    produce: [{container: 'output', batch: {id: '0:old', material: 'old', properties: {}}, quantity: 1}],
  });
  apply(owner, {
    id: 'remove',
    kind: 'exchange',
    consume: [{container: 'output', batchId: '0:old', quantity: 1}],
    produce: [],
  });
  const request = apply(owner, {
    id: 'admit',
    kind: 'admit',
    consume,
    policy: {kind: 'frozen', output: facts('future', 2)},
  }).request!;
  apply(owner, {id: 'retire', kind: 'retire', batchIds: ['0:old']});
  assert.equal(owner.epoch, 1);
  assert.equal(stock(owner).available('input', '0:input'), 3);
  const result = apply(owner, {id: 'settle', kind: 'settle', request});
  assert.equal(result.batchId, '1:future');
  apply(owner, {id: 'prune', kind: 'checkpoint'});
  assert.deepEqual(owner.prepare(1, {id: 'settle', kind: 'settle', request}), {
    status: 'rejected',
    reason: 'stale-epoch',
  });
  assert.deepEqual(owner.prepare(2, {id: 'settle-again', kind: 'settle', request}), {
    status: 'rejected',
    reason: 'unknown-request',
  });
});

test('same local name with changed facts fails explicitly without consuming admitted input', () => {
  const owner = createMaterializationOwner(options);
  seed(owner);
  for (const grade of [2, 9]) {
    const request = apply(owner, {
      id: `admit-${grade}`,
      kind: 'admit',
      consume,
      policy: {kind: 'frozen', output: facts('same', grade)},
    }).request!;
    if (grade === 2) apply(owner, {id: 'settle-2', kind: 'settle', request});
    else {
      const before = owner.snapshot();
      assert.deepEqual(owner.prepare(0, {id: 'settle-9', kind: 'settle', request}), {
        status: 'rejected',
        reason: 'batch-conflict',
      });
      assert.deepEqual(owner.snapshot(), before);
      apply(owner, {id: 'cancel', kind: 'cancel', request});
    }
  }
  assert.equal(stock(owner).quantity('input', '0:input'), 3);
  assert.equal(stock(owner).available('input', '0:input'), 3);
});

test('one SaveStore envelope retries the exact settlement after quota failure and reloads without a duplicate delivery', () => {
  const owner = createMaterializationOwner(options);
  seed(owner);
  const request = apply(owner, {
    id: 'admit',
    kind: 'admit',
    consume,
    policy: {kind: 'pinned', definition: {id: 'catalog', revision: 1, output: facts('saved', 2)}},
  }).request!;
  const baseline = owner.snapshot();
  const section: SaveSection<MaterializationSnapshot> = {
    id: 'consumer.materialization',
    scope: 'device',
    version: 1,
    initial: () => baseline,
    parse: raw => createMaterializationOwner(options, raw as MaterializationSnapshot).snapshot(),
  };
  const backend = new MemoryBackend();
  const timers = {now: () => 0, set: () => 0, clear: () => {}};
  const createStore = () =>
    createSaveStore({
      local: backend.port(),
      session: new MemoryBackend().port(),
      build: 'test',
      timers,
      sections: [section],
    });
  const store = createStore(),
    handle = store.section(section);
  handle.replace(baseline, {now: true});
  const staged = owner.prepare(0, {id: 'settle', kind: 'settle', request});
  assert.equal(staged.status, 'prepared');
  if (staged.status !== 'prepared') return;
  const seen: string[] = [];
  backend.failSet = () => true;
  const save = (snapshot: MaterializationSnapshot) => {
    seen.push(JSON.stringify(snapshot));
    return handle.replace(snapshot, {now: true}) === 'saved';
  };
  assert.deepEqual(owner.publish(staged.candidate, save), {status: 'pending'});
  assert.deepEqual(owner.snapshot(), baseline);
  assert.equal(
    owner.discard(staged.candidate),
    false,
    'a save may still be dirty; do not discard after an external attempt',
  );
  assert.deepEqual(owner.prepare(0, {id: 'other', kind: 'checkpoint'}), {
    status: 'rejected',
    reason: 'publication-pending',
  });
  backend.failSet = () => false;
  assert.equal(owner.publish(staged.candidate, save).status, 'accepted');
  assert.equal(seen[0], seen[1]);
  store.dispose();
  const loadedStore = createStore(),
    restored = createMaterializationOwner(options, loadedStore.section(section).get());
  assert.equal(stock(restored).quantity('output', '0:saved'), 1);
  assert.equal(restored.prepare(0, {id: 'settle', kind: 'settle', request}).status, 'duplicate');
  loadedStore.dispose();
});

test('candidate ownership, callback reentrancy, bounded requests and malformed snapshots fail without partial state', () => {
  const owner = createMaterializationOwner({...options, maxPending: 1});
  seed(owner);
  const pending = owner.prepare(0, {
    id: 'admit',
    kind: 'admit',
    consume,
    policy: {kind: 'frozen', output: facts('one', 2)},
  });
  assert.equal(pending.status, 'prepared');
  if (pending.status !== 'prepared') return;
  assert.deepEqual(owner.publish({...pending.candidate}), {status: 'rejected', reason: 'stale-candidate'});
  assert.throws(
    () =>
      owner.publish(pending.candidate, () => {
        owner.close();
        return true;
      }),
    /reentrant/,
  );
  assert.equal(owner.publish(pending.candidate).status, 'accepted');
  assert.deepEqual(
    owner.prepare(0, {id: 'full', kind: 'admit', consume, policy: {kind: 'frozen', output: facts('two', 2)}}),
    {status: 'rejected', reason: 'pending-full'},
  );
  for (const mutate of [
    (s: MaterializationSnapshot) => {
      s.inventory = null as never;
    },
    (s: MaterializationSnapshot) => {
      s.requests[0]!.consume[0]!.quantity = 2;
    },
    (s: MaterializationSnapshot) => {
      s.requests.push({...s.requests[0]!});
    },
    (s: MaterializationSnapshot) => {
      s.nextRequest = 0;
    },
  ]) {
    const snapshot = owner.snapshot();
    mutate(snapshot);
    assert.throws(() => createMaterializationOwner(options, snapshot));
  }
  owner.close();
  assert.deepEqual(owner.prepare(0, {id: 'later', kind: 'checkpoint'}), {status: 'rejected', reason: 'retired'});
});

test('bounded receipts require an explicit checkpoint and old request serials cannot target replacements', () => {
  const o = {...options, maxReceipts: 2},
    owner = createMaterializationOwner(o);
  seed(owner);
  const first = apply(owner, {
    id: 'admit',
    kind: 'admit',
    consume,
    policy: {kind: 'frozen', output: facts('first', 2)},
  }).request!;
  assert.deepEqual(owner.prepare(0, {id: 'cancel', kind: 'cancel', request: first}), {
    status: 'rejected',
    reason: 'checkpoint-required',
  });
  apply(owner, {id: 'checkpoint', kind: 'checkpoint'});
  assert.deepEqual(
    owner.prepare(0, {id: 'admit', kind: 'admit', consume, policy: {kind: 'frozen', output: facts('first', 2)}}),
    {status: 'rejected', reason: 'stale-epoch'},
  );
  apply(owner, {id: 'cancel', kind: 'cancel', request: first});
  const second = apply(owner, {
    id: 'admit',
    kind: 'admit',
    consume,
    policy: {kind: 'frozen', output: facts('second', 9)},
  }).request!;
  assert.notEqual(first, second);
  apply(owner, {id: 'checkpoint', kind: 'checkpoint'});
  assert.deepEqual(owner.prepare(2, {id: 'stale', kind: 'settle', request: first}), {
    status: 'rejected',
    reason: 'unknown-request',
  });
  const staged = owner.prepare(2, {id: 'settle', kind: 'settle', request: second});
  assert.equal(staged.status, 'prepared');
  if (staged.status !== 'prepared') return;
  assert.equal(owner.discard(staged.candidate), true);
  assert.equal(stock(owner, o).quantity('output', '0:second'), 0);
  assert.deepEqual(owner.publish(staged.candidate), {status: 'rejected', reason: 'stale-candidate'});
});
