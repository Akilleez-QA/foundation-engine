import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMarket} from './index';
import {must} from '../../testing/must';
const initial = () => ({
  balances: {seller: 0, buyer: 10},
  offers: [{id: 'offer', revision: 1, seller: 'seller', item: 'ore', quantity: 5, unitPrice: 2, expires: 10}],
  receipts: [],
});
test('market retries compare canonical requests rather than object property order', () => {
  const m = createMarket(initial());
  assert.equal(m.purchase({id: 'p', offer: 'offer', revision: 1, buyer: 'buyer', quantity: 1}, 0).ok, true);
  const retry = m.purchase({quantity: 1, buyer: 'buyer', revision: 1, offer: 'offer', id: 'p'}, 0);
  assert.ok(retry.ok && retry.duplicate);
  assert.equal(m.balance('buyer'), 8);
});
test('market rejects malformed restored receipt request even with a plausible claim', () => {
  const m = createMarket(initial());
  m.purchase({id: 'p', offer: 'offer', revision: 1, buyer: 'buyer', quantity: 1}, 0);
  const s = m.snapshot();
  must(s.receipts[0]).request.revision = NaN;
  assert.throws(() => createMarket(s));
});
