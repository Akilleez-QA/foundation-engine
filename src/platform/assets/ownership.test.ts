// assets.owns(): residents are identity-based page-lifetime holds; ownership unions registered owners.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ownership, residents} from './ownership';

test('residents own adopted objects by identity until released; a copy is not owned', () => {
  const held = residents(),
    a = {userData: {}},
    copy = {...a};
  assert.equal(held.adopt(a), a);
  assert.equal(held.owns(a), true);
  assert.equal(held.owns(copy), false);
  assert.equal(held.owns(null), false);
  assert.equal(held.owns('a'), false);
  held.release(a);
  assert.equal(held.owns(a), false);
});

test('ownership answers for any registered owner, and a removed owner stops answering', () => {
  const first = residents(),
    second = residents(),
    all = ownership(first),
    a = {},
    b = {};
  first.adopt(a);
  second.adopt(b);
  assert.equal(all.owns(a), true);
  assert.equal(all.owns(b), false);
  const remove = all.register(second);
  assert.equal(all.owns(b), true);
  remove();
  assert.equal(all.owns(b), false);
  assert.equal(all.owns(undefined), false);
});
