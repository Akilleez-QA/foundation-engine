import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEquipment} from './index';
import {must} from '../../testing/must';
const items = [
  {id: 'left', definition: 'tool', slots: ['left'], functional: true},
  {id: 'right', definition: 'tool', slots: ['right'], functional: true},
  {id: 'both', definition: 'wide', slots: ['left', 'right'], functional: true},
];
test('multi-slot exchange previews all displacement and rejects full bag atomically', () => {
  const e = createEquipment(['left', 'right'], 1, {revision: 0, items, equipped: ['left', 'right']});
  assert.deepEqual(e.preview('both'), {revision: 0, displaced: ['left', 'right'], fits: false});
  const old = e.snapshot();
  assert.equal(e.commit('both', 0), 'capacity');
  assert.deepEqual(e.snapshot(), old);
});
test('successful exchange preserves unique custody; stale and duplicate commands do not reapply', () => {
  const e = createEquipment(['left', 'right'], 3, {revision: 0, items, equipped: ['left', 'right']});
  assert.equal(e.commit('both', 0), 'applied');
  assert.deepEqual(e.snapshot().equipped, ['both']);
  assert.equal(e.commit('left', 0), 'stale');
  assert.equal(e.commit('both', 1), 'unchanged');
  assert.deepEqual(createEquipment(['left', 'right'], 3, e.snapshot()).snapshot(), e.snapshot());
});
test('cosmetics do not grant functional capabilities and contradictory saved slots fail', () => {
  assert.throws(() => createEquipment(['left', 'right'], 3, {revision: 0, items, equipped: ['left', 'both']}));
  const e = createEquipment(['left'], 1, {
    revision: 0,
    items: [{...must(items[0]), functional: false}],
    equipped: ['left'],
  });
  assert.deepEqual(e.active(), []);
});
