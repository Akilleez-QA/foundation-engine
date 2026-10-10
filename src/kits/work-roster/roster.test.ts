import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorkRoster, type WorkRoster, type WorkTicket} from './index';

function add(r: WorkRoster, id: string): WorkTicket {
  const result = r.add(id);
  assert.equal(result.status, 'accepted');
  if (result.status !== 'accepted') throw Error('admission');
  return result.ticket;
}
function take(r: WorkRoster, n: number) {
  const result = r.take(n);
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') throw Error('closed');
  return result.tickets;
}

test('limits captured once; invalid admission and saturation never change order', () => {
  for (const value of [0, -1, 0.5, NaN, Infinity, 65537])
    assert.throws(() => createWorkRoster({maxEntries: value, maxIdLength: 4}));
  for (const value of [0, -1, 0.5, NaN, Infinity, 257])
    assert.throws(() => createWorkRoster({maxEntries: 4, maxIdLength: value}));
  let reads = 0;
  const r = createWorkRoster({
    get maxEntries() {
      reads++;
      return 2;
    },
    maxIdLength: 4,
  });
  const a = add(r, 'a'),
    b = add(r, 'b');
  assert.equal(reads, 1);
  assert.equal(r.add('a').status, 'duplicate');
  assert.equal(r.add('c').status, 'full');
  for (const id of ['', '12345', 1, null, {}]) assert.throws(() => Reflect.apply(r.add, r, [id]));
  for (const n of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => r.take(n));
  assert.deepEqual(take(r, 0), []);
  assert.deepEqual(take(r, Number.MAX_SAFE_INTEGER), [a, b]);
  assert.ok(Object.isFrozen(a));
  assert.ok(Object.isFrozen(take(r, 1)));
  r.dispose();
  r.dispose();
  assert.equal(r.size, 0);
  assert.equal(r.add('ok').status, 'closed');
  assert.equal(r.take(0).status, 'closed');
  assert.throws(() => r.add(''), 'invalid arguments precede closed');
  assert.throws(() => r.take(NaN));
  assert.equal(r.check(a), false);
});

test('membership never observes fabricated handles and replacement cannot inherit authority', () => {
  const r = createWorkRoster({maxEntries: 3, maxIdLength: 8});
  const a = add(r, 'a'),
    b = add(r, 'b');
  const other = createWorkRoster({maxEntries: 1, maxIdLength: 8});
  const foreign = add(other, 'a');
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const evil = {
    get id() {
      throw Error('must not read');
    },
  };
  for (const handle of [null, undefined, 1, 'a', {...a}, foreign, evil, revoked.proxy]) {
    assert.equal(r.check(handle), false);
    assert.equal(r.remove(handle), false);
  }
  assert.equal(r.remove(a), true);
  assert.equal(r.remove(a), false);
  const replacement = add(r, 'a');
  assert.equal(r.check(a), false);
  assert.equal(r.check(b), true);
  assert.deepEqual(take(r, 20), [b, replacement]);
  r.dispose();
  assert.equal(r.check(replacement), false);
  assert.equal(other.check(foreign), true);
});

test('independent array model agrees through deterministic bounded churn', () => {
  const r = createWorkRoster({maxEntries: 7, maxIdLength: 8});
  let model: WorkTicket[] = [],
    seed = 17;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let i = 0; i < 10000; i++) {
    const op = next() % 3;
    if (op === 0) {
      const id = `id${next() % 11}`,
        result = r.add(id);
      const expected = model.some(t => t.id === id) ? 'duplicate' : model.length === 7 ? 'full' : 'accepted';
      assert.equal(result.status, expected);
      if (result.status === 'accepted') model.push(result.ticket);
    } else if (op === 1 && model.length) {
      const index = next() % model.length,
        old = model[index]!;
      model = model.filter((_, n) => n !== index);
      assert.equal(r.remove(old), true);
      assert.equal(r.check(old), false);
    } else {
      const n = next() % 13,
        count = Math.min(n, model.length),
        expected = model.slice(0, count);
      model = [...model.slice(count), ...expected];
      assert.deepEqual(take(r, n), expected);
    }
    assert.equal(r.size, model.length);
    assert.ok(r.size <= 7);
  }
});

test('continuously live members progress despite served-member tail churn', () => {
  const r = createWorkRoster({maxEntries: 4, maxIdLength: 8});
  const tickets = ['a', 'b', 'c', 'd'].map(id => add(r, id));
  const selected: WorkTicket[] = [];
  for (let i = 0; i < 4; i++) {
    const ticket = take(r, 1)[0]!;
    selected.push(ticket);
    r.remove(ticket);
    add(r, ticket.id);
  }
  assert.deepEqual(selected, tickets);
});
