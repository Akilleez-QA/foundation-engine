import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createModifiers, createCapabilities} from './index';
test('modifier removal rejects overflow without dropping the source', () => {
  const m = createModifiers({x: 1e300});
  m.set('b', [{stat: 'x', add: 0, multiply: 1e-100}]);
  m.set('a', [{stat: 'x', add: 0, multiply: 1e100}]);
  const before = m.values().x;
  assert.throws(() => m.remove('b'));
  assert.equal(m.values().x, before);
});
test('capability definitions reject unreachable empty evidence keys', () => {
  assert.throws(() => createCapabilities([{id: 'read', requires: [], evidence: ['']}]));
});
