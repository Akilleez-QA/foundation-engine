import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lengthOf, pathOf, tickLabels, type BoardItem } from './board';
import { must } from '../../testing/must';

test('chalkboard: every item kind has a path and a length; text has neither', () => {
  const items: BoardItem[] = [
    { id: 'l', kind: 'line', from: [0, 0], to: [3, 4] },
    { id: 'a', kind: 'arrow', from: [0, 0], to: [10, 0] },
    { id: 'c', kind: 'circle', at: [10, 10], r: 5 },
    { id: 'r', kind: 'rect', at: [0, 0], w: 4, h: 2 },
    { id: 'x', kind: 'axes', at: [10, 50], w: 40, h: 30 },
    { id: 'n', kind: 'number-line', from: [10, 80], to: [110, 80], min: 0, max: 10, step: 5 },
    { id: 'p', kind: 'path', points: [[0, 0], [3, 4], [3, 0]], closed: true },
  ];
  for (const i of items) { assert.ok(pathOf(i).startsWith('M'), i.id); assert.ok(lengthOf(i) > 0, i.id); }
  assert.equal(lengthOf(must(items[0])), 5);
  assert.equal(lengthOf(must(items[6])), 5 + 4 + 3);
  assert.deepEqual(tickLabels(items[5] as Extract<BoardItem, { kind: 'number-line' }>).map(t => t.text), ['0', '5', '10']);
  assert.equal(pathOf({ id: 't', kind: 'text', at: [0, 0], text: 'k' }), '');
});
