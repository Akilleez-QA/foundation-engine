import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEquipment, type ItemInstance} from './index';
import {createInventoryLedger} from '../inventory';
const item = (id = 'tool'): ItemInstance => ({id, definition:'authored-tool', slots:['hand'], functional:true});
const empty = (capacity = 2, revision = 0) => createEquipment(['hand'], capacity, {revision, items:[], equipped:[]});

test('custody admits, selects, explicitly releases and restores unique instances', () => {
  const e = empty();
  assert.equal(e.acquire(item(), 0), 'applied');
  const preview = e.preview('tool');
  assert.equal(e.acquire(item('other'), 1), 'applied');
  assert.equal(e.commit('tool', preview.revision), 'stale');
  assert.equal(e.commit('tool', 2), 'applied');
  const before = e.snapshot();
  assert.equal(e.release('tool', 3), 'equipped');
  assert.deepEqual(e.snapshot(), before);
  assert.equal(e.commit('tool', 3, false), 'applied');
  assert.equal(e.release('tool', 4), 'applied');
  assert.equal(e.release('tool', 5), 'missing');
  assert.equal(e.acquire(item(), 4), 'stale');
  assert.equal(e.acquire(item(), 5), 'applied'); // Reuse allowed only as a new revision, no issuance guarantee.
  assert.deepEqual(createEquipment(['hand'], 2, e.snapshot()).snapshot(), e.snapshot());
});

test('custody failures leave facts and revision unchanged', () => {
  const e = empty(1); e.acquire(item(), 0); const before = e.snapshot();
  assert.equal(e.acquire({...item(), definition:'replacement'}, 1), 'duplicate');
  assert.equal(e.acquire(item('extra'), 1), 'capacity');
  assert.throws(() => e.acquire({...item('bad'), slots:['unknown']}, 1));
  assert.throws(() => e.acquire(item('x'.repeat(257)), 1));
  assert.throws(() => e.release('', 1));
  assert.throws(() => e.release('tool', NaN));
  assert.throws(() => e.acquire(item('extra'), -1));
  assert.throws(() => e.commit('tool', Infinity));
  assert.deepEqual(e.snapshot(), before);
  const exhausted = empty(2, Number.MAX_SAFE_INTEGER), old = exhausted.snapshot();
  assert.throws(() => exhausted.acquire(item(), Number.MAX_SAFE_INTEGER), /exhausted/);
  assert.deepEqual(exhausted.snapshot(), old);
  const terminal = createEquipment(['hand'], 1, {revision:Number.MAX_SAFE_INTEGER, items:[item()], equipped:[]});
  const terminalBefore = terminal.snapshot();
  assert.throws(() => terminal.release('tool', Number.MAX_SAFE_INTEGER), /exhausted/);
  assert.throws(() => terminal.commit('tool', Number.MAX_SAFE_INTEGER), /exhausted/);
  assert.deepEqual(terminal.snapshot(), terminalBefore);
  const full = createEquipment(['hand'], 4097, {revision:0, items:Array.from({length:4096}, (_, i) => item(String(i))), equipped:[]});
  assert.equal(full.acquire(item('new'), 0), 'limit');
  assert.equal(full.snapshot().revision, 0);
});

test('custody captures bounded indexed facts and blocks reentrant getters', () => {
  const e = empty(), arrangement = ['hand'];
  arrangement.map = () => { throw Error('caller method must not run'); };
  arrangement[Symbol.iterator] = () => { throw Error('caller iterator must not run'); };
  const source = {...item(), slots:arrangement};
  assert.equal(e.acquire(source, 0), 'applied');
  source.definition = 'changed'; arrangement[0] = 'changed';
  assert.equal(e.snapshot().items[0].definition, 'authored-tool');
  assert.deepEqual(e.snapshot().items[0].slots, ['hand']);
  const before = e.snapshot();
  assert.equal(e.acquire({get id(): string { throw Error('stale payload read'); }, definition:'ignored', functional:true, slots:['hand']}, 0), 'stale');
  assert.throws(() => e.acquire({get id(){ e.release('tool', 1); return 'new'; }, definition:'x', functional:true, slots:['hand']}, 1), /reentrant/);
  assert.deepEqual(e.snapshot(), before);
  const huge = new Proxy(new Array(65), {get(target, key, receiver){if(key === '0')throw Error('unbounded read');return Reflect.get(target, key, receiver);}});
  assert.throws(() => e.acquire({...item('big'), slots:huge}, 1), /record limit/);
  assert.equal(e.acquire(item('new'), 1), 'applied'); // Guard released after failure.
});

test('equipped presentation includes cosmetics and returns detached facts', () => {
  const e = empty(); e.acquire({...item(), functional:false}, 0); e.commit('tool', 1);
  assert.equal(e.equipped().length, 1); assert.deepEqual(e.active(), []);
  const view = e.equipped(); view[0].definition = 'mutated'; (view[0].slots as string[])[0] = 'other'; view.length = 0;
  assert.deepEqual(e.equipped(), [{...item(), functional:false}]);
});

test('consumer stages inventory conversion, delivery receipt and equipment in one envelope', () => {
  const options = {capacities:{bag:2}};
  const inventory = createInventoryLedger(options);
  inventory.transact('seed', [], [{container:'bag', batch:{id:'material', material:'authored', properties:{}}, quantity:2}]);
  let envelope = {inventory:inventory.snapshot(), equipment:empty(1).snapshot(), delivered:false};
  const deliver = (publish: boolean) => {
    if (envelope.delivered) return 'duplicate';
    const bag = createInventoryLedger(options, envelope.inventory);
    const gear = createEquipment(['hand'], 1, envelope.equipment);
    if (!bag.transact('conversion', [{container:'bag', batchId:'material', quantity:1}], []).ok) return 'inventory';
    if (gear.acquire(item(), gear.snapshot().revision) !== 'applied') return 'equipment';
    const candidate = {inventory:bag.snapshot(), equipment:gear.snapshot(), delivered:true};
    if (!publish) return 'rejected'; // Application-controlled local publication, not durable I/O rollback.
    envelope = candidate; return 'applied';
  };
  const before = structuredClone(envelope);
  assert.equal(deliver(false), 'rejected'); assert.equal(JSON.stringify(envelope), JSON.stringify(before));
  envelope.equipment = createEquipment(['hand'], 1, {revision:0, items:[item('occupied')], equipped:[]}).snapshot();
  const full = structuredClone(envelope); assert.equal(deliver(true), 'equipment'); assert.equal(JSON.stringify(envelope), JSON.stringify(full));
  envelope = before; assert.equal(deliver(true), 'applied'); assert.equal(deliver(true), 'duplicate');
  const restored = JSON.parse(JSON.stringify(envelope)) as typeof envelope;
  const gear = createEquipment(['hand'], 1, restored.equipment);
  assert.equal(createInventoryLedger(options, restored.inventory).quantity('bag', 'material'), 1);
  assert.equal(gear.commit('tool', gear.snapshot().revision), 'applied');
  assert.equal(gear.active()[0].id, 'tool');
  assert.equal(gear.commit('tool', gear.snapshot().revision, false), 'applied');
  assert.equal(gear.release('tool', gear.snapshot().revision), 'applied');
  assert.deepEqual(gear.snapshot().items, []);
});
