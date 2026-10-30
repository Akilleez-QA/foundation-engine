import test from 'node:test';
import assert from 'node:assert/strict';
import {createOccupancy, type OccupancyOutside} from './occupancy';
const make = (values: number[], width: number, outside: OccupancyOutside = 'clear', work = values.length) =>
  createOccupancy({
    values: new Uint8Array(values),
    width,
    height: values.length / width,
    revision: 7,
    maxCells: values.length,
    maxCellsPerQuery: work,
    outside,
  });

test('immutable mask, integer rectangle bounds, explicit outside and overload', () => {
  const values = new Uint8Array([0, 1, 0, 0]);
  const a = createOccupancy({
    values,
    width: 2,
    height: 2,
    revision: 2,
    maxCells: 4,
    maxCellsPerQuery: 1,
    outside: 'clear',
  });
  values[1] = 0;
  assert.equal(a.point(1, 0).status, 'hit');
  assert.equal(a.rectangle(0, 0, 2, 2).status, 'too-wide');
  assert.equal(a.rectangle(-100, -100, 0, 0).status, 'clear');
  assert.equal(a.rectangle(0, 0, 0, 4).cellsVisited, 0);
  assert.throws(() => a.point(0.5, 0));
  assert.throws(() => a.rectangle(2, 0, 1, 1));
  for (const outside of ['clear', 'blocked', 'refuse'] as const) {
    const r = make([0], 1, outside);
    assert.equal(r.point(-1, 0).status, outside === 'clear' ? 'clear' : outside === 'blocked' ? 'hit' : 'outside');
    assert.equal(
      r.segment(-1, 0.5, 2, 0.5).status,
      outside === 'clear' ? 'clear' : outside === 'blocked' ? 'hit' : 'outside',
    );
  }
  assert.throws(() => make([2], 1));
});
test('closed corner/edge and endpoint contacts, zero length and entire tie-group budget', () => {
  const a = make([0, 1, 1, 0], 2);
  assert.deepEqual(a.segment(0.5, 0.5, 1.5, 1.5).cell, {x: 1, y: 0});
  assert.equal(a.segment(0.5, 0.5, 1, 1).t, 1);
  assert.deepEqual(a.segment(1, 1, 1, 1).cell, {x: 1, y: 0});
  assert.deepEqual(a.segment(1, 0.1, 1, 1.9).cell, {x: 1, y: 0});
  assert.equal(make([0, 1, 1, 0], 2, 'clear', 2).segment(0.5, 0.5, 1.5, 1.5).status, 'too-wide');
  assert.equal(make([0], 1, 'blocked').segment(0.5, 0.5, 2, 0.5).t, 1 / 3);
});
test('distant adjacent contacts do not turn rounded fractions into false ties; numeric bounds and subnormal motion', () => {
  // Reverse ray: x=2 is reached before x=1, although naive Number division collapses their fractions.
  const a = make([1, 1, 0], 3);
  assert.deepEqual(a.segment(Number.MAX_SAFE_INTEGER, 0.5, -Number.MAX_SAFE_INTEGER, 0.5).cell, {x: 1, y: 0});
  assert.equal(a.segment(Number.MAX_VALUE, 0, 0, 0).status, 'numeric-refusal');
  assert.throws(() => a.segment(NaN, 0, 0, 0));
  assert.equal(make([0, 1], 2).segment(Number.MIN_VALUE, 0.5, 1, 0.5).status, 'hit');
  assert.equal(make([0], 1).segment(-0, 0.5, 0, 0.5).status, 'clear');
});
test('long diagonal uses crossed cells rather than bounding-box area', () => {
  const width = 1024;
  const a = createOccupancy({
    values: new Uint8Array(width * width),
    width,
    height: width,
    revision: 0,
    maxCells: width * width,
    maxCellsPerQuery: 4 * width,
    outside: 'clear',
  });
  const r = a.segment(0, 0, width, width);
  assert.equal(r.status, 'clear');
  assert.ok(r.cellsVisited <= 4 * width);
  assert.ok(r.cellsVisited >= width);
});

// Independent exhaustive cell-slab oracle. Integer half-cell inputs keep cross-products exact in Number.
type Ratio = [number, number];
const cmp = (a: Ratio, b: Ratio) => a[0] * b[1] - b[0] * a[1];
function oracle(mask: number[], width: number, ray: number[]) {
  let best: {id: number; t: Ratio} | undefined;
  for (let id = 0; id < mask.length; id++) {
    if (!mask[id]) continue;
    let low: Ratio = [0, 1],
      high: Ratio = [1, 1],
      valid = true;
    for (let axis = 0; axis < 2; axis++) {
      const origin = ray[axis]! * 2,
        delta = (ray[axis + 2]! - ray[axis]!) * 2;
      const start = (axis === 0 ? id % width : Math.floor(id / width)) * 2;
      if (!delta) {
        if (origin < start || origin > start + 2) valid = false;
        continue;
      }
      let a: Ratio = [start - origin, delta],
        b: Ratio = [start + 2 - origin, delta];
      if (delta < 0) {
        a = [-a[0], -a[1]];
        b = [-b[0], -b[1]];
      }
      if (cmp(a, b) > 0) [a, b] = [b, a];
      if (cmp(a, low) > 0) low = a;
      if (cmp(b, high) < 0) high = b;
    }
    if (valid && cmp(low, high) <= 0 && (!best || cmp(low, best.t) < 0)) best = {id, t: low};
  }
  return best;
}
test('supercover agrees with independent exhaustive rational cell contacts', () => {
  const masks = [
    [1, 0, 1, 0, 1, 0],
    [0, 1, 0, 1, 0, 1],
    [1, 1, 1, 1, 1, 1],
  ];
  for (const mask of masks) {
    const a = make(mask, 3);
    for (let x0 = -1; x0 <= 4; x0 += 0.5)
      for (let y0 = -1; y0 <= 3; y0 += 0.5)
        for (let x1 = -1; x1 <= 4; x1 += 0.5)
          for (let y1 = -1; y1 <= 3; y1 += 0.5) {
            const expected = oracle(mask, 3, [x0, y0, x1, y1]),
              actual = a.segment(x0, y0, x1, y1);
            assert.equal(actual.status, expected ? 'hit' : 'clear', JSON.stringify([x0, y0, x1, y1]));
            if (expected) {
              assert.deepEqual(actual.cell, {x: expected.id % 3, y: Math.floor(expected.id / 3)});
              assert.ok(Math.abs(actual.t! - expected.t[0] / expected.t[1]) < 1e-14);
            }
          }
  }
});
