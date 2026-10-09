import test from 'node:test';
import assert from 'node:assert/strict';
import {createItinerary} from './itinerary.ts';
import {patrolFixture, deliveryFixture} from './fixtures.mjs';

const order = (id = 'tower', generation = 0, tag = 'visit', value = 1) => ({tag, destination: {id, generation}, value});
const create = (maxOrders = 8) => createItinerary({maxOrders, maxTextLength: 32, tags: ['visit']});
function edit(route, change) {
  return route.edit(route.snapshot().revision, change);
}
function insert(route, index, value = order()) {
  assert.equal(edit(route, {type: 'insert', index, order: value}), 'accepted');
  return route.snapshot().orders[index].id;
}
function seeded() {
  const route = create();
  const ids = [insert(route, 0), insert(route, 1), insert(route, 2)];
  assert.equal(route.start(route.snapshot().revision, ids[1]), 'accepted');
  return {route, ids, ticket: route.begin()};
}

for (const index of [0, 1, 2, 3]) {
  test(`insertion at ${index} preserves active identity and in-flight completion`, () => {
    const {route, ids, ticket} = seeded();
    const inserted = insert(route, index);
    assert.equal(route.snapshot().activeId, ids[1]);
    assert.equal(route.check(ticket), true);
    assert.equal(route.finish(ticket), true);
    assert.equal(route.snapshot().activeId, index === 2 ? inserted : ids[2]);
    assert.equal(route.finish(ticket), false);
  });
}
for (const index of [0, 2]) {
  test(`deletion ${index === 0 ? 'before' : 'after'} active preserves ticket`, () => {
    const {route, ids, ticket} = seeded();
    assert.equal(edit(route, {type: 'remove', id: ids[index], current: 'stop'}), 'accepted');
    assert.equal(route.snapshot().activeId, ids[1]);
    assert.equal(route.finish(ticket), true);
    assert.equal(route.snapshot().activeId, index === 0 ? ids[2] : null);
  });
}
for (const current of ['stop', 'advance']) {
  test(`deleting active uses explicit ${current} policy and rejects late completion`, () => {
    const {route, ids, ticket} = seeded();
    assert.equal(edit(route, {type: 'remove', id: ids[1], current}), 'accepted');
    assert.equal(route.snapshot().activeId, current === 'stop' ? null : ids[2]);
    const before = route.snapshot();
    assert.equal(route.finish(ticket), false);
    assert.deepEqual(route.snapshot(), before);
  });
}
test('full admission, malformed edit and stale revision preserve all state and authority', () => {
  const route = create(1);
  const id = insert(route, 0);
  route.start(route.snapshot().revision, id);
  const ticket = route.begin();
  const before = route.snapshot();
  assert.equal(edit(route, {type: 'insert', index: 1, order: order()}), 'saturated');
  assert.equal(route.edit(0, {type: 'remove', id, current: 'stop'}), 'stale');
  assert.throws(() => edit(route, {type: 'replace', id, order: order('tower', 0, 'unknown')}));
  assert.throws(() => edit(route, {type: 'remove', id}));
  assert.deepEqual(route.snapshot(), before);
  assert.equal(route.finish(ticket), true);
});
test('replacement retains ID, increments generation and rejects copied, foreign and replayed tickets', () => {
  const {route, ids, ticket} = seeded();
  assert.equal(route.finish({...ticket}), false);
  assert.equal(create().finish(ticket), false);
  assert.equal(edit(route, {type: 'replace', id: ids[1], order: order('gate', 1)}), 'accepted');
  const next = route.begin();
  assert.equal(next.order.id, ticket.order.id);
  assert.equal(next.order.generation, ticket.order.generation + 1);
  assert.equal(route.finish(ticket), false);
  assert.equal(route.finish(next), true);
  assert.equal(route.finish(next), false);
  assert.equal(route.finish(null), false);
  assert.equal(route.finish(undefined), false);
});
test('destination incarnation invalidates every reference but cannot invalidate a recycled destination', () => {
  const {route, ids, ticket} = seeded();
  assert.equal(route.invalidateDestination({id: 'tower', generation: 0}), 'accepted');
  assert.equal(route.begin(), null);
  assert.equal(route.finish(ticket), false);
  assert.ok(route.snapshot().orders.every(entry => !entry.valid));
  assert.equal(edit(route, {type: 'replace', id: ids[1], order: order('tower', 1)}), 'accepted');
  const replacement = route.begin();
  assert.equal(route.invalidateDestination({id: 'tower', generation: 0}), 'stale');
  assert.equal(route.check(replacement), true);
  assert.equal(route.finish(ticket), false);
  assert.equal(route.finish(replacement), true);
});
test('cancel retries the same active order; disposal permanently retires all attempts', () => {
  const {route, ticket} = seeded();
  assert.equal(route.begin(), null);
  assert.equal(route.cancel(), true);
  assert.equal(route.cancel(), false);
  assert.equal(route.finish(ticket), false);
  const retry = route.begin();
  assert.equal(retry.order.id, ticket.order.id);
  route.dispose();
  route.dispose();
  assert.equal(route.finish(retry), false);
  assert.equal(route.begin(), null);
  assert.equal(route.start(route.snapshot().revision, retry.order.id), 'closed');
  assert.equal(route.restore(route.snapshot().revision, route.snapshot()), 'closed');
  assert.equal(route.snapshot().orders.length, 0);
});
test('snapshots detach input and restore cursor while retiring previous attempts and revision commands', () => {
  const {route, ticket} = seeded();
  const saved = route.snapshot();
  assert.throws(() => {
    saved.orders[0].destination.id = 'mutated';
  });
  assert.throws(() => {
    saved.orders.push(saved.orders[0]);
  });
  const plain = JSON.parse(JSON.stringify(saved));
  assert.equal(route.restore(saved.revision, plain), 'accepted');
  plain.orders[0].destination.id = 'changed';
  assert.equal(route.snapshot().orders[0].destination.id, 'tower');
  assert.equal(route.snapshot().activeId, saved.activeId);
  assert.equal(route.finish(ticket), false);
  assert.equal(route.start(saved.revision, saved.activeId), 'stale');
  const restored = create();
  assert.equal(restored.restore(0, saved), 'accepted');
  assert.equal(restored.finish(ticket), false);
  assert.equal(restored.finish(restored.begin()), true);
});
test('malformed or oversized snapshots do not mutate active state', () => {
  const {route, ticket} = seeded();
  const original = route.snapshot();
  const cases = [
    s => {
      s.version = 2;
    },
    s => {
      s.orders[1].id = s.orders[0].id;
    },
    s => {
      s.activeId = 999;
    },
    s => {
      s.nextId = 1;
    },
    s => {
      s.orders[0].generation = -1;
    },
    s => {
      s.orders[0].destination.generation = NaN;
    },
    s => {
      s.orders[0].tag = 'unknown';
    },
    s => {
      s.orders[0].value = Infinity;
    },
    s => {
      s.orders[0].valid = 'yes';
    },
    s => {
      s.orders[0].destination.id = 'x'.repeat(33);
    },
    s => {
      delete s.orders[0];
    },
    s => {
      s.extra = true;
    },
    s => {
      Object.defineProperty(s, 'activeId', {
        get() {
          throw Error('getter ran');
        },
      });
    },
  ];
  for (const corrupt of cases) {
    const candidate = JSON.parse(JSON.stringify(original));
    corrupt(candidate);
    assert.throws(() => route.restore(original.revision, candidate));
    assert.deepEqual(route.snapshot(), original);
    assert.equal(route.check(ticket), true);
  }
  const large = {...original, orders: Array(9).fill(original.orders[0])};
  assert.equal(route.restore(original.revision, large), 'saturated');
  assert.deepEqual(route.snapshot(), original);
});
test('monotonic identity survives rollback and integer exhaustion refuses edits without losing cancellation', () => {
  const {route, ticket} = seeded();
  const earlier = route.snapshot();
  const lastId = insert(route, 3);
  route.restore(route.snapshot().revision, earlier);
  assert.ok(insert(route, 3) > lastId);
  const terminal = {...route.snapshot(), revision: Number.MAX_SAFE_INTEGER - 1};
  assert.equal(route.restore(route.snapshot().revision, terminal), 'accepted');
  const before = route.snapshot();
  assert.equal(edit(route, {type: 'insert', index: 0, order: order()}), 'exhausted');
  assert.deepEqual(route.snapshot(), before);
  assert.equal(route.finish(ticket), false);
  assert.equal(route.invalidateDestination(order().destination), 'accepted');
  assert.ok(route.snapshot().orders.every(entry => !entry.valid));
  route.dispose();
});

test('patrol uses existing navigation: planning is not arrival, edits preserve observation and explicit restart loops', () => {
  const fixture = patrolFixture();
  const route = fixture.itinerary;
  const first = insert(route, 0, order('tower', 0, 'observe', 2));
  insert(route, 1, order('gate'));
  route.start(route.snapshot().revision, first);
  const ticket = route.begin();
  const search = fixture.prepare(ticket);
  for (let i = 0; i < 32 && search.result.status === 'pending'; i++) search.step(1);
  assert.equal(search.result.status, 'arrived');
  assert.deepEqual(fixture.state(), {position: 'gate', observations: 0});
  const inserted = insert(route, 1, order('gate'));
  assert.equal(fixture.arrive(ticket, 'tower', 1), false);
  assert.equal(fixture.arrive(ticket, 'tower', 0), true);
  assert.equal(fixture.arrive(ticket, 'tower', 0), false);
  assert.deepEqual(fixture.state(), {position: 'tower', observations: 2});
  assert.equal(route.snapshot().activeId, inserted);
  route.start(route.snapshot().revision, first);
  const next = route.begin();
  const cancelledSearch = fixture.prepare(next);
  fixture.cancel();
  assert.equal(cancelledSearch.result.status, 'cancelled');
  assert.equal(fixture.arrive(next, 'tower', 0), false);
  fixture.dispose();
});
test('delivery/services use authored quantity rules, refuse impossible transfer and reject duplicate late effects', () => {
  const fixture = deliveryFixture();
  const route = fixture.itinerary;
  const collect = insert(route, 0, order('depot', 0, 'collect', 3));
  const deliver = insert(route, 1, order('home', 0, 'deliver', 4));
  insert(route, 2, order('home', 0, 'service', 0));
  route.start(route.snapshot().revision, collect);
  const pickup = route.begin();
  assert.equal(fixture.accept(pickup, pickup.order.destination), true);
  const impossible = route.begin();
  assert.equal(fixture.accept(impossible, impossible.order.destination), false);
  assert.deepEqual(fixture.state(), {stock: 1, carried: 3, delivered: 0, services: 0});
  assert.equal(edit(route, {type: 'replace', id: deliver, order: order('home', 1, 'deliver', 3)}), 'accepted');
  const drop = route.begin();
  assert.equal(fixture.accept(impossible, impossible.order.destination), false);
  assert.equal(fixture.accept(drop, {id: 'home', generation: 0}), false);
  assert.equal(fixture.accept(drop, drop.order.destination), true);
  const service = route.begin();
  assert.equal(fixture.accept(service, service.order.destination), true);
  for (const stale of [pickup, impossible, drop, service])
    assert.equal(fixture.accept(stale, stale.order.destination), false);
  assert.deepEqual(fixture.state(), {stock: 1, carried: 0, delivered: 3, services: 1});
  assert.equal(route.snapshot().activeId, null);
});

test('array admission rejects executable iterators and accessors before they run', () => {
  let executions = 0;
  const tags = ['visit'];
  tags[Symbol.iterator] = function* () {
    executions++;
    yield 'visit';
    yield 'extra';
  };
  assert.throws(() => createItinerary({maxOrders: 1, maxTextLength: 32, tags}));
  const {route, ticket} = seeded();
  const before = route.snapshot();
  const iterable = [];
  iterable[Symbol.iterator] = function* () {
    executions++;
    while (true) yield before.orders[0];
  };
  assert.throws(() => route.restore(before.revision, {...before, orders: iterable}));
  const accessor = [before.orders[0]];
  Object.defineProperty(accessor, '0', {
    get() {
      executions++;
      return before.orders[0];
    },
  });
  assert.throws(() => route.restore(before.revision, {...before, orders: accessor}));
  assert.equal(executions, 0);
  assert.deepEqual(route.snapshot(), before);
  assert.equal(route.check(ticket), true);
});

test('patrol route evidence belongs to its exact attempt and stale preparation cannot cancel current work', () => {
  const fixture = patrolFixture();
  const route = fixture.itinerary;
  const id = insert(route, 0, order('tower'));
  route.start(route.snapshot().revision, id);
  const original = route.begin();
  const oldSearch = fixture.prepare(original);
  for (let i = 0; i < 32 && oldSearch.result.status === 'pending'; i++) oldSearch.step(1);
  assert.equal(oldSearch.result.status, 'arrived');
  edit(route, {type: 'replace', id, order: order('gate')});
  const replacement = route.begin();
  assert.equal(fixture.arrive(replacement, 'gate', 0), false);
  const currentSearch = fixture.prepare(replacement);
  assert.throws(() => fixture.prepare(original), /retired/);
  assert.equal(currentSearch.result.status, 'pending');
  for (let i = 0; i < 32 && currentSearch.result.status === 'pending'; i++) currentSearch.step(1);
  assert.equal(fixture.arrive(replacement, 'gate', 0), true);
});
