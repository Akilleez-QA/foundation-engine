import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from './index';
const initial = () => ({
  balances: {buyer: 100, seller: 0},
  offers: [{id: 'offer', revision: 1, seller: 'seller', item: 'part', quantity: 3, unitPrice: 10, expires: 100}],
  receipts: [],
});
const request = {id: 'purchase', offer: 'offer', revision: 1, buyer: 'buyer', quantity: 2};
test('settlement conserves money and stock; full bag leaves durable claim without second charge', () => {
  const m = createMarket(initial());
  assert.equal(m.purchase(request, 0).ok, true);
  assert.equal(m.balance('buyer'), 80);
  assert.equal(m.balance('seller'), 20);
  assert.equal(m.quote('offer')!.quantity, 1);
  assert.equal(m.collect('purchase', 'buyer', 1), null);
  const reload = createMarket(m.snapshot());
  assert.equal(reload.purchase(request, 200).ok, true);
  assert.equal(reload.balance('buyer'), 80);
  assert.equal(reload.collect('purchase', 'buyer', 2)!.quantity, 2);
  assert.equal(reload.collect('purchase', 'buyer', 2), null);
});
test('stale/conflicting/insufficient purchases do not mutate; claim ownership checked', () => {
  const m = createMarket(initial()),
    old = m.snapshot();
  assert.equal(m.purchase({...request, revision: 0}, 0).ok, false);
  assert.equal(m.purchase({...request, quantity: 4}, 0).ok, false);
  assert.deepEqual(m.snapshot(), old);
  m.purchase(request, 0);
  assert.equal(m.purchase({...request, quantity: 1}, 0).ok, false);
  assert.equal(m.collect('purchase', 'seller', 10), null);
});
test('expiry work is bounded and does not destroy paid claims', () => {
  const m = createMarket(initial());
  m.purchase(request, 0);
  assert.equal(m.expire(101, 0), 0);
  assert.equal(m.expire(101, 1), 1);
  assert.equal(m.quote('offer'), undefined);
  assert.equal(m.collect('purchase', 'buyer', 2)!.quantity, 2);
});
