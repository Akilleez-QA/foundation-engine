import test from 'node:test';
import assert from 'node:assert/strict';
import {createCellEdits, CELL_BATCH_CEILING, type CellEdit} from './cell-edits';
const cell = (x: number, value = 1): CellEdit => ({x, y: 0, z: 0, value});
const setup = (revision = 0) =>
  createCellEdits(
    {cellsX: 4, cellsY: 1, cellsZ: 1, values: new Uint16Array(4)},
    {revision, maxBatch: 3, limits: {maxEdits: 2}},
  );
test('batch net capacity, single publication, stale and invalid suffix leave exact prior state', () => {
  const e = setup();
  assert.equal(e.batch(0, [cell(0), cell(1)]), 'changed');
  assert.equal(e.revision, 1);
  e.markSaved(1);
  const prior = e.encode();
  assert.equal(e.batch(0, [cell(0, 0)]), 'stale');
  assert.equal(e.batch(1, [cell(2)]), 'full');
  assert.throws(() => e.batch(1, [cell(0, 0), cell(4)]));
  assert.throws(() => e.batch(1, [cell(0, 0), cell(0)]));
  assert.deepEqual(e.encode(), prior);
  assert.equal(e.dirty, false);
  assert.equal(e.revision, 1);
  assert.equal(e.batch(1, [cell(2), cell(0, 0)]), 'changed');
  assert.equal(e.revision, 2);
  assert.deepEqual([...e.materialize()], [0, 1, 1, 0]);
  assert.equal(e.batch(2, [cell(1)]), 'unchanged');
  assert.equal(e.batch(2, []), 'unchanged');
});
test('batch owns data slots without invoking accessors or custom iteration; mutation guards include saved state', () => {
  const e = setup();
  let invoked = 0;
  const getter = Object.defineProperty({}, 'x', {
    get() {
      invoked++;
      return 0;
    },
    enumerable: true,
  });
  Object.assign(getter, {y: 0, z: 0, value: 1});
  assert.throws(() => e.batch(0, [getter as CellEdit]));
  const input = [cell(0)];
  Object.defineProperty(input, Symbol.iterator, {
    value() {
      invoked++;
      return [cell(1)][Symbol.iterator]();
    },
  });
  assert.throws(() => e.batch(0, input));
  assert.throws(() => e.batch(0, new Array<CellEdit>(1)));
  assert.equal(invoked, 0);
  e.set(0, 0, 0, 1);
  const proxied = new Proxy([cell(1)], {
    getPrototypeOf(target) {
      assert.throws(() => e.set(0, 0, 0, 0), /admission/);
      assert.throws(() => e.batch(1, []), /admission/);
      assert.throws(() => e.markSaved(1), /admission/);
      return Reflect.getPrototypeOf(target);
    },
  });
  assert.equal(e.batch(1, proxied), 'changed');
  assert.equal(e.dirty, true);
  assert.throws(
    () =>
      e.batch(
        2,
        new Proxy([], {
          ownKeys() {
            throw Error('trap');
          },
        }),
      ),
    /trap/,
  );
  e.markSaved(2); // finally released guard
  assert.equal(e.dirty, false);
});
test('configurable batch bound and safe revision exhaustion preserve scalar behavior', () => {
  const e = setup(Number.MAX_SAFE_INTEGER);
  assert.equal(e.set(0, 0, 0, 0), 'unchanged');
  assert.equal(e.batch(e.revision, []), 'unchanged');
  assert.throws(() => e.set(0, 0, 0, 1), /exhausted/);
  assert.throws(() => e.batch(e.revision, [cell(0)]), /exhausted/);
  assert.deepEqual([...e.materialize()], [0, 0, 0, 0]);
  assert.throws(() => setup().batch(0, [cell(0), cell(1), cell(2), cell(3)]), /bound/);
  assert.throws(() =>
    createCellEdits({cellsX: 1, cellsY: 1, cellsZ: 1, values: new Uint16Array(1)}, {maxBatch: CELL_BATCH_CEILING + 1}),
  );
});
