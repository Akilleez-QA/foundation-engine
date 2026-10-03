import test from 'node:test';
import assert from 'node:assert/strict';
import { measureUiOcclusion, UI_OCCLUSION_LIMITS, type OcclusionRect } from './occlusion';
import {must} from '../../testing/must';

const rect = (x: number, y: number, width: number, height: number): OcclusionRect => ({ x, y, width, height });
const viewport = rect(0, 0, 100, 100);

test('UI occupancy measures clipped union rather than summed or bounding-box area', () => {
  const footprints = [rect(-10, 0, 50, 50), rect(20, 20, 50, 50), rect(90, 90, 20, 20)];
  const report = measureUiOcclusion(viewport, footprints);
  assert.equal(report.area, 10_000);
  assert.equal(report.occupiedArea, 4_000); // 2000 + 2500 - 600 + 100
  assert.equal(report.occupiedRatio, 0.4);
  assert.deepEqual(measureUiOcclusion(viewport, [...footprints].reverse()), report);
  assert.deepEqual(measureUiOcclusion(viewport, [...footprints, ...footprints]), report);
});

test('critical regions use independent viewport-clipped denominators', () => {
  const report = measureUiOcclusion(viewport, [rect(0, 0, 50, 50)], [
    rect(10, 10, 20, 20), rect(-10, 0, 30, 100), rect(200, 200, 10, 10), rect(0, 0, 0, 30),
  ]);
  assert.deepEqual(report.criticalRegions, [
    { area: 400, occupiedArea: 400, occupiedRatio: 1 },
    { area: 2000, occupiedArea: 1000, occupiedRatio: 0.5 },
    { area: 0, occupiedArea: 0, occupiedRatio: 0 },
    { area: 0, occupiedArea: 0, occupiedRatio: 0 },
  ]);
  assert.equal(report.occupiedRatio, 0.25, 'small whole-view ratio can hide an entire critical region');
});

test('empty footprints, zero-area views and touching edges have zero occupancy', () => {
  assert.equal(measureUiOcclusion(viewport, []).occupiedArea, 0);
  assert.deepEqual(measureUiOcclusion(rect(0, 0, 0, 100), [viewport]), {
    area: 0, occupiedArea: 0, occupiedRatio: 0, criticalRegions: [],
  });
  assert.equal(measureUiOcclusion(viewport, [rect(100, 0, 100, 100), rect(0, 0, 0, 100)]).occupiedArea, 0);
});

test('caller-supplied transparent hit blockers count fully and inputs stay unchanged', () => {
  const blocker = Object.freeze({ ...rect(0, 0, 40, 50), opacity: 0 });
  const inputs = Object.freeze([blocker]);
  const report = measureUiOcclusion(Object.freeze(viewport), inputs, Object.freeze([viewport]));
  assert.equal(report.occupiedArea, 2000);
  assert.equal(must(report.criticalRegions[0]).occupiedArea, 2000);
  assert.equal(blocker.opacity, 0);
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.criticalRegions));
  assert.ok(Object.isFrozen(report.criticalRegions[0]));
});

test('invalid dimensions, coordinates, overflow and bounded admission fail explicitly', () => {
  for (const bad of [rect(NaN, 0, 1, 1), rect(0, Infinity, 1, 1), rect(0, 0, -1, 2),
    rect(0, 0, 1, -1), rect(0, 0, Infinity, 1), rect(Number.MAX_VALUE, 0, Number.MAX_VALUE, 1),
    rect(0, 0, 1e200, 1e200)]) {
    assert.throws(() => measureUiOcclusion(bad, []), RangeError);
    assert.throws(() => measureUiOcclusion(viewport, [bad]), RangeError);
    assert.throws(() => measureUiOcclusion(viewport, [], [bad]), RangeError);
  }
  assert.throws(() => measureUiOcclusion(viewport, Array(UI_OCCLUSION_LIMITS.footprints + 1).fill(viewport)), /limit/);
  assert.throws(() => measureUiOcclusion(viewport, [], Array(UI_OCCLUSION_LIMITS.criticalRegions + 1).fill(viewport)), /limit/);
});

test('union agrees with independent grid occupancy for many intersecting rectangles', () => {
  // Integer-cell oracle, independent of the slab/interval implementation.
  let state = 23;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  for (let run = 0; run < 80; run++) {
    const footprints = Array.from({ length: 12 }, () => rect(next() % 16 - 4, next() % 16 - 4, next() % 8, next() % 8));
    let occupied = 0;
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
      if (footprints.some(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)) occupied++;
    }
    assert.equal(measureUiOcclusion(rect(0, 0, 10, 10), footprints).occupiedArea, occupied);
  }
});


test('fractional rectangles share a translated coordinate space without pixel rounding', () => {
  const report = measureUiOcclusion(rect(-2.5, 3.5, 2, 2), [rect(-2, 4, 1, 1), rect(-1.5, 4.5, 1, 1)]);
  assert.equal(report.area, 4);
  assert.equal(report.occupiedArea, 1.75);
  assert.equal(report.occupiedRatio, 0.4375);
});
