import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createViewSize} from './view-size';

test('viewport delivery isolates errors and respects removal and visit abort during delivery', () => {
  const lifetime = new AbortController();
  let width = 400;
  const errors: unknown[] = [];
  const sizes = createViewSize(
    lifetime.signal,
    () => ({width, height: 800}),
    error => errors.push(error),
  );
  const values: number[] = [];
  sizes.observe(() => {
    throw new Error('observer');
  });
  const stop = sizes.observe(size => {
    assert.equal(Object.isFrozen(size), true);
    values.push(size.width);
  });
  width = 600;
  sizes.refresh();
  assert.deepEqual(values, [400, 600]);
  assert.equal(errors.length, 2);
  stop();
  width = 700;
  sizes.refresh();
  assert.deepEqual(values, [400, 600]);
  sizes.observe(() => lifetime.abort());
  sizes.observe(size => values.push(size.width));
  width = 800;
  sizes.refresh();
  assert.deepEqual(values, [400, 600]);
});

test('throwing viewport reporters cannot hide unsubscribe handles or interrupt sibling delivery', () => {
  const lifetime = new AbortController();
  let width = 400,
    reports = 0;
  const sizes = createViewSize(
    lifetime.signal,
    () => ({width, height: 800}),
    () => {
      reports++;
      throw Error('reporter failed');
    },
  );
  const off = sizes.observe(() => {
    throw Error('observer failed');
  });
  const values: number[] = [];
  sizes.observe(size => values.push(size.width));
  width = 600;
  sizes.refresh();
  assert.deepEqual(values, [400, 600]);
  assert.equal(reports, 2);
  off();
  width = 700;
  sizes.refresh();
  assert.deepEqual(values, [400, 600, 700]);
  assert.equal(reports, 2);
  lifetime.abort();
});

test('reentrant refresh is bounded and siblings receive one coherent snapshot per delivery', () => {
  const lifetime = new AbortController();
  let width = 400,
    reenter = false;
  const sizes = createViewSize(
    lifetime.signal,
    () => ({width, height: 800}),
    () => {},
  );
  const first: number[] = [],
    second: number[] = [];
  sizes.observe(size => {
    first.push(size.width);
    if (reenter) {
      width++;
      sizes.refresh();
    }
  });
  sizes.observe(size => second.push(size.width));
  reenter = true;
  width = 600;
  sizes.refresh();
  assert.deepEqual(first, [400, 600]);
  assert.deepEqual(second, [400, 600]);
  assert.equal(width, 601);
  reenter = false;
  sizes.refresh();
  assert.deepEqual(first, [400, 600, 601]);
  assert.deepEqual(second, [400, 600, 601]);
  lifetime.abort();
});
