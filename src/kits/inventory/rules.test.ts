import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRuledInventory, defineInventoryRules, inventoryPresets} from './pure';

const potion = {id: 'potion', material: 'potion', properties: {}};
const ether = {id: 'ether', material: 'ether', properties: {}};
const bike = {id: 'bike', material: 'key-bike', properties: {}};

test('handheld bag: 99 per slot, overflow spills into new slots, 20 slots, refused adds change nothing', () => {
  const rules = defineInventoryRules({
    ...inventoryPresets.handheldBag,
    materials: {'key-bike': {key: true, maxOwned: 1}},
  });
  const inv = createRuledInventory(rules);
  assert.equal(inv.transact('a', [], [{container: 'bag', batch: potion, quantity: 150}]).ok, true);
  assert.equal(inv.slotsUsed('bag'), 2, '150 potions fill one stack of 99 and spill 51');
  for (let i = 0; i < 18; i++)
    inv.transact(
      `f${i}`,
      [],
      [{container: 'bag', batch: {id: `item-${i}`, material: `m${i}`, properties: {}}, quantity: 1}],
    );
  assert.equal(inv.slotsUsed('bag'), 20);
  const before = inv.snapshot();
  assert.deepEqual(inv.transact('x', [], [{container: 'bag', batch: ether, quantity: 1}]), {
    ok: false,
    reason: 'slots',
    container: 'bag',
  });
  assert.equal(
    inv.transact('y', [], [{container: 'bag', batch: potion, quantity: 47}]).ok,
    true,
    'fits the open stack',
  );
  assert.equal(
    inv.transact('z', [], [{container: 'bag', batch: potion, quantity: 2}]).ok,
    false,
    '199 would need a third slot',
  );
  assert.equal(inv.room('bag', potion), 1);
  assert.equal(inv.room('box', potion), 50 * 99);
  assert.notDeepEqual(inv.snapshot(), before);
});

test('key items cannot be discarded; scripted use must say so; unique items cap ownership', () => {
  const inv = createRuledInventory(
    defineInventoryRules({...inventoryPresets.handheldBag, materials: {'key-bike': {key: true, maxOwned: 1}}}),
  );
  inv.transact('get-bike', [], [{container: 'bag', batch: bike, quantity: 1}]);
  assert.deepEqual(inv.discard('toss', 'bag', 'bike', 1), {
    ok: false,
    reason: 'key-item',
    container: 'bag',
    material: 'key-bike',
  });
  assert.equal(inv.transact('trade', [{container: 'bag', batchId: 'bike', quantity: 1}], []).ok, false);
  assert.equal(inv.transfer('store', 'bag', 'box', 'bike', 1).ok, true, 'key items may move');
  assert.deepEqual(inv.transact('second', [], [{container: 'bag', batch: bike, quantity: 1}]), {
    ok: false,
    reason: 'owned',
    material: 'key-bike',
  });
  assert.equal(
    inv.transact('quest', [{container: 'box', batchId: 'bike', quantity: 1}], [], {allowKey: true}).ok,
    true,
  );
  assert.equal(inv.quantity('box', 'bike'), 0);
});

test('single-slot stacks, unstackable materials and container placement', () => {
  const inv = createRuledInventory(
    defineInventoryRules({
      containers: {pack: {slots: 2, stackSize: 5, overflow: 'single'}, belt: {slots: 1, stackSize: 5}},
      materials: {tool: {stackSize: 1, containers: ['belt']}},
    }),
  );
  assert.deepEqual(inv.transact('a', [], [{container: 'pack', batch: potion, quantity: 6}]), {
    ok: false,
    reason: 'stack',
    container: 'pack',
    material: 'potion',
  });
  assert.deepEqual(
    inv.transact('b', [], [{container: 'pack', batch: {id: 'axe', material: 'tool', properties: {}}, quantity: 1}]),
    {
      ok: false,
      reason: 'container',
      container: 'pack',
      material: 'tool',
    },
  );
  assert.equal(
    inv.transact('c', [], [{container: 'belt', batch: {id: 'axe', material: 'tool', properties: {}}, quantity: 1}]).ok,
    true,
  );
  assert.equal(
    inv.transact('d', [], [{container: 'belt', batch: {id: 'saw', material: 'tool', properties: {}}, quantity: 1}]).ok,
    false,
  );
});

test('snapshots replay through the rules; a history that breaks them is refused', () => {
  const rules = defineInventoryRules(inventoryPresets.hotbarAndPack);
  const inv = createRuledInventory(rules);
  inv.transact('a', [], [{container: 'hotbar', batch: potion, quantity: 100}]);
  inv.transfer('b', 'hotbar', 'pack', 'potion', 40);
  const saved = JSON.parse(JSON.stringify(inv.snapshot()));
  const again = createRuledInventory(rules, {}, saved);
  assert.deepEqual(again.contents('pack'), [{batchId: 'potion', quantity: 40}]);
  const tight = defineInventoryRules({
    containers: {hotbar: {slots: 1, stackSize: 64}, pack: {slots: 27, stackSize: 64}},
  });
  assert.throws(() => createRuledInventory(tight, {}, saved), /breaks these rules/);
  assert.throws(() => defineInventoryRules({containers: {}}), /1\.\.64/);
  assert.throws(
    () => defineInventoryRules({containers: {a: {slots: 1, stackSize: 1}}, materials: {x: {containers: ['b']}}}),
    /unknown container/,
  );
});

test('review: retries keep ledger idempotency; reservations respect key items and project their inputs', () => {
  const rules = defineInventoryRules({
    containers: {bag: {slots: 1, stackSize: 99}},
    materials: {'key-bike': {key: true, maxOwned: 1}, elixir: {stackSize: 10}},
  });
  const inv = createRuledInventory(rules);
  assert.equal(inv.transact('a', [], [{container: 'bag', batch: potion, quantity: 99}]).ok, true);
  assert.deepEqual(inv.transact('a', [], [{container: 'bag', batch: potion, quantity: 99}]), {
    ok: true,
    duplicate: true,
  });
  assert.deepEqual(inv.transact('a', [], [{container: 'bag', batch: potion, quantity: 98}]), {
    ok: false,
    reason: 'conflict',
  });
  assert.equal(inv.reserve('r', [{container: 'bag', batchId: 'potion', quantity: 99}]).ok, true);
  assert.equal(
    inv.commitReservation('c', 'r', [
      {container: 'bag', batch: {id: 'elixir', material: 'elixir', properties: {}}, quantity: 1},
    ]).ok,
    true,
    'the reserved potions free their slot for the output',
  );
  const keyed = createRuledInventory(
    defineInventoryRules({...inventoryPresets.handheldBag, materials: {'key-bike': {key: true}}}),
  );
  keyed.transact('get', [], [{container: 'bag', batch: bike, quantity: 1}]);
  assert.deepEqual(keyed.reserve('r', [{container: 'bag', batchId: 'bike', quantity: 1}]), {
    ok: false,
    reason: 'key-item',
    container: 'bag',
    material: 'key-bike',
  });
  assert.equal(keyed.quantity('bag', 'bike'), 1);
  assert.throws(() => keyed.room('nowhere', potion), /unknown container/);
  assert.equal(keyed.room('bag', {...potion, properties: {strength: 1}}), keyed.room('bag', potion));
  keyed.transact('p', [], [{container: 'bag', batch: potion, quantity: 1}]);
  assert.equal(keyed.room('bag', {...potion, properties: {strength: 1}}), 0, 'a conflicting batch id has no room');
});

test('review: tighter rules with the same containers refuse an old history; new material rules keep saves', () => {
  const loose = defineInventoryRules({containers: {bag: {slots: 5, stackSize: 99}}, materials: {gem: {maxOwned: 3}}});
  const inv = createRuledInventory(loose);
  inv.transact('a', [], [{container: 'bag', batch: {id: 'gem', material: 'gem', properties: {}}, quantity: 3}]);
  const saved = JSON.parse(JSON.stringify(inv.snapshot()));
  const tighter = defineInventoryRules({containers: {bag: {slots: 5, stackSize: 99}}, materials: {gem: {maxOwned: 2}}});
  assert.throws(() => createRuledInventory(tighter, {}, saved), /breaks these rules/);
  const extended = defineInventoryRules({
    containers: {bag: {slots: 5, stackSize: 99}},
    materials: {gem: {maxOwned: 3}, arrows: {stackSize: 999}},
  });
  assert.doesNotThrow(() => createRuledInventory(extended, {}, saved));
  assert.throws(
    () =>
      defineInventoryRules(
        JSON.parse('{"containers":{"bag":{"slots":1,"stackSize":1}},"materials":{"__proto__":{"key":true}}}'),
      ),
    /invalid key/,
  );
});
