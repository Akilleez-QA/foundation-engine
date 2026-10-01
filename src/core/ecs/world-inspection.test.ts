import test from 'node:test';
import assert from 'node:assert/strict';
import {World, component} from './world';

const First = component('first-component', {value: 1});
const Second = component('second-component', {value: 2});

test('metadata inspection includes unnamed entities without reading component values', () => {
  const world = new World();
  const id = world.spawn(First(), Second());
  Object.defineProperty(world.get(id, First)!, 'value', {get() { throw Error('must not serialize values'); }});
  const page = world.inspectMetadata({maxLabelLength: 5});
  assert.equal(page.entities[0]!.id, id);
  assert.deepEqual(page.entities[0]!.components, [{label: 'first', truncated: true}, {label: 'secon', truncated: true}]);
  assert.equal(page.entities[0]!.componentsComplete, true);
  assert.equal(page.checks, 3);
  page.entities[0]!.components[0]!.label = 'mutated';
  page.entities.length = 0;
  assert.equal(world.inspectMetadata().entities[0]!.components[0]!.label, 'first-component');
});

test('deleted ID gaps consume budget and empty pages make bounded progress', () => {
  const world = new World();
  for (let i = 0; i < 7; i++) world.despawn(world.spawn());
  const alive = world.spawn();
  const first = world.inspectMetadata({maxChecks: 3});
  assert.deepEqual(first.entities, []);
  assert.equal(first.checks, 3);
  assert.equal(first.nextAfterId, 3);
  const second = world.inspectMetadata({afterId: first.nextAfterId!, maxChecks: 3});
  assert.equal(second.nextAfterId, 6);
  const third = world.inspectMetadata({afterId: second.nextAfterId!, maxChecks: 3});
  assert.equal(third.entities[0]!.id, alive);
  assert.equal(third.nextAfterId, null);
  assert.equal(third.checks, 2);
});

test('component membership and entity slots share one budget; partial metadata is explicit', () => {
  const world = new World();
  world.spawn(First(), Second());
  world.spawn(Second());
  const page = world.inspectMetadata({maxChecks: 2});
  assert.equal(page.checks, 2);
  assert.equal(page.entities.length, 1);
  assert.equal(page.entities[0]!.componentStoresExamined, 1);
  assert.equal(page.entities[0]!.componentsComplete, false);
  assert.equal(page.nextAfterId, 1);
  const next = world.inspectMetadata({afterId: page.nextAfterId!, maxChecks: 3});
  assert.deepEqual(next.entities[0]!.components, [{label: 'second-component', truncated: false}]);
  assert.equal(next.entities[0]!.componentsComplete, true);
});

test('metadata pages report structural changes without retaining dead entities', () => {
  const world = new World();
  const first = world.spawn(First()), second = world.spawn(Second());
  const page = world.inspectMetadata({limit: 1});
  world.despawn(first); world.despawn(second);
  const third = world.spawn();
  const next = world.inspectMetadata({afterId: page.nextAfterId!});
  assert.notEqual(next.version, page.version);
  assert.deepEqual(next.entities.map(row => row.id), [third]);
  assert.equal(next.total, 1);
  assert.equal(world.inspectMetadata({maxChecks: 0}).checks, 0);
  assert.deepEqual(world.inspectMetadata({limit: 0}).entities, []);
  for (const field of ['afterId', 'limit', 'maxChecks', 'maxLabelLength']) {
    for (const value of [-1, 0.5, Infinity, NaN]) assert.throws(() => world.inspectMetadata({[field]: value}), RangeError);
  }
  assert.throws(() => world.inspectMetadata({maxLabelLength: 0}), RangeError);
});
