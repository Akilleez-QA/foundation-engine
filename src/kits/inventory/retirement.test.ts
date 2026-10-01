import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRetirementInventory, qualifiedInventoryId} from './retirement';
import type {InventoryOperation} from './ledger';
const options = {capacities: {bag: 10}, maxOperations: 20, maxMaterials: 3, maxReferences: 2};
const batch = (id: string, grade = 2) => ({id, material: 'creator-material', properties: {grade}});
const put = (id: string, batchId: string, grade = 2): InventoryOperation => ({kind: 'exchange', id, consume: [], produce: [{container: 'bag', batch: batch(batchId, grade), quantity: 1}]});
const take = (id: string, batchId: string): InventoryOperation => ({kind: 'exchange', id, consume: [{container: 'bag', batchId, quantity: 1}], produce: []});

test('consumer preserves pinned consumed A and reserved B, retires A and refuses historical identity resurrection after reload', () => {
  let owner = createRetirementInventory(options);
  const a = owner.qualify('A'), b = owner.qualify('B');
  assert.equal(owner.apply(0, put('get-a', a)).ok, true);
  const jobReference = owner.claim(a)!;
  assert.equal(owner.apply(0, take('use-a', a)).ok, true);
  assert.equal(owner.apply(0, put('get-b', b)).ok, true);
  assert.equal(owner.apply(0, {kind: 'reserve', id: 'hold-b', consume: [{container: 'bag', batchId: b, quantity: 1}]}).ok, true);
  const original = owner.snapshot();
  assert.deepEqual(owner.retire([a]), {ok: false, reason: 'referenced'});
  assert.deepEqual(owner.retire([b]), {ok: false, reason: 'stock'});
  assert.deepEqual(owner.snapshot(), original);
  assert.equal(owner.releaseClaim(jobReference), true);
  const beforeMixed = owner.snapshot();
  assert.deepEqual(owner.retire([a, b]), {ok: false, reason: 'stock'});
  assert.deepEqual(owner.snapshot(), beforeMixed);
  assert.deepEqual(owner.retire([a]), {ok: true, epoch: 1, generation: 1});
  owner = createRetirementInventory(options, owner.snapshot());
  assert.equal(owner.material(a), undefined);
  assert.equal(owner.quantity('bag', b), 1); assert.equal(owner.available('bag', b), 0);
  for (const grade of [2, 9]) assert.deepEqual(owner.apply(1, put(`revive-${grade}`, a, grade)), {ok: false, reason: 'retired-generation'});
  assert.deepEqual(owner.apply(0, put('get-a', a)), {ok: false, reason: 'stale-epoch'});
  assert.deepEqual(owner.apply(1, put('change-b', b, 9)), {ok: false, reason: 'batch-conflict'});
  const replacement = owner.qualify('A'); assert.notEqual(replacement, a);
  assert.equal(owner.apply(1, put('new-a', replacement, 9)).ok, true);
  assert.equal(owner.quantity('bag', replacement), 1);
  assert.equal(owner.apply(1, {kind: 'commit', id: 'finish-b', reservationId: 'hold-b', produce: []}).ok, true);
  assert.equal(owner.quantity('bag', b), 0);
});

test('current epoch retries survive failed retirement and checkpoint changes only request epoch', () => {
  const owner = createRetirementInventory(options), a = owner.qualify('A'), op = put('get', a);
  owner.apply(0, op); owner.retire([a]);
  assert.deepEqual(owner.apply(0, op), {ok: true, duplicate: true});
  assert.deepEqual(owner.apply(0, put('get', a, 9)), {ok: false, reason: 'conflict'});
  assert.deepEqual(owner.apply(0, put('get', qualifiedInventoryId(9, 'future'))), {ok: false, reason: 'conflict'});
  owner.checkpoint(); assert.equal(owner.generation, 0);
  assert.equal(owner.apply(1, put('another', owner.qualify('C'))).ok, true);
  assert.deepEqual(owner.apply(1, put('future', qualifiedInventoryId(1, 'future'))), {ok: false, reason: 'retired-generation'});
  assert.throws(() => owner.apply(1, put('raw', 'unqualified')));
});

test('reference claims are bounded, detached, restored and never reused', () => {
  let owner = createRetirementInventory({...options, maxReferences: 1});
  const a = owner.qualify('A'); owner.apply(0, put('get', a)); owner.apply(0, take('use', a));
  const first = owner.claim(a)!; assert.equal(owner.claim(a), null);
  const saved = owner.snapshot(); saved.references[0]!.batchId = 'wrong';
  assert.deepEqual(owner.retire([a]), {ok: false, reason: 'referenced'});
  owner = createRetirementInventory({...options, maxReferences: 1}, owner.snapshot());
  owner.releaseClaim(first); const second = owner.claim(a)!; assert.notEqual(first, second);
  assert.equal(owner.releaseClaim(first), false); assert.deepEqual(owner.retire([a]), {ok: false, reason: 'referenced'});
  assert.throws(() => createRetirementInventory(options, saved));
  const duplicate = owner.snapshot(); duplicate.references.push({...duplicate.references[0]!});
  assert.throws(() => createRetirementInventory(options, duplicate));
  const future = owner.snapshot(); future.generation = 1;
  assert.throws(() => createRetirementInventory(options, future), /generation exceeds epoch/);
});

test('exhausted counters and invalid candidates leave the entire envelope unchanged', () => {
  const base = createRetirementInventory(options); const a = base.qualify('A'); base.apply(0, put('get', a)); base.apply(0, take('use', a));
  const saved = base.snapshot(); saved.generation = Number.MAX_SAFE_INTEGER; saved.checkpoint.epoch = Number.MAX_SAFE_INTEGER; saved.nextClaim = Number.MAX_SAFE_INTEGER;
  const owner = createRetirementInventory(options, saved), before = owner.snapshot();
  assert.throws(() => owner.retire([a]), /exhausted/); assert.throws(() => owner.checkpoint(), /exhausted/); assert.throws(() => owner.claim(a), /exhausted/);
  assert.throws(() => owner.retire([a, a])); assert.throws(() => owner.retire([]));
  assert.deepEqual(owner.retire(['0:unknown']), {ok: false, reason: 'unknown-material'});
  assert.deepEqual(owner.snapshot(), before);
  for (const id of ['00:A', '-1:A', '1e0:A', '0:', 'Infinity:A']) assert.throws(() => base.apply(0, put('bad', id)));
});

test('caller getters cannot mutate owner during detached request or candidate reads', () => {
  const owner = createRetirementInventory(options), a = owner.qualify('A');
  const malicious = put('get', a);
  Object.defineProperty(malicious, 'id', {enumerable: true, get() { owner.checkpoint(); return 'get'; }});
  const before = owner.snapshot(); assert.throws(() => owner.apply(0, malicious), /reentrant/); assert.deepEqual(owner.snapshot(), before);
  owner.apply(0, put('get', a)); owner.apply(0, take('use', a));
  const candidates = [a]; Object.defineProperty(candidates, 0, {get() { owner.claim(a); return a; }});
  assert.throws(() => owner.retire(candidates), /reentrant/);
  assert.equal(owner.retire([a]).ok, true);
});

test('save parser rejects every missing or nonrecord checkpoint instead of restoring empty stock', () => {
  const owner = createRetirementInventory(options), a = owner.qualify('A'); owner.apply(0, put('get', a));
  for (const value of [undefined, null, false, 0, '', [], true, 1, 'checkpoint']) {
    const invalid = {...owner.snapshot(), checkpoint: value};
    assert.throws(() => createRetirementInventory(options, invalid as unknown as ReturnType<typeof owner.snapshot>), /checkpoint record/);
  }
  for (const value of [undefined, null, false, 0, '', []]) {
    const invalid = owner.snapshot();
    (invalid.checkpoint as unknown as {base: unknown}).base = value;
    assert.throws(() => createRetirementInventory(options, invalid), /base record/);
  }
  const missing = owner.snapshot(); delete (missing as Partial<typeof missing>).checkpoint;
  assert.throws(() => createRetirementInventory(options, missing), /checkpoint record/);
  assert.equal(createRetirementInventory(options, owner.snapshot()).quantity('bag', a), 1);
});
