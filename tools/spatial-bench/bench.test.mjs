// Work-count (not timing) checks for the spatial micro-benchmark: query cost follows local density, not population.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCase } from './bench.mjs';

test('spatial bench: per-query work stays bounded from 1,000 to 10,000 entries', () => {
  const small = runCase({ entries: 1000, ticks: 3 }), large = runCase({ entries: 10000, ticks: 3 });
  for (const c of [small, large]) {
    assert.equal(c.refused, 0, 'no query was too wide or truncated');
    assert.ok(c.perNeighbourQuery.cells <= 4, 'a radius-8 query touches at most 2 x 2 cells of 16');
    assert.ok(c.perInterestQuery.cells <= 81, 'a radius-64 query touches at most 9 x 9 cells');
  }
  // Constant density: 10x the population must not multiply per-query examination (allow 50 % noise).
  assert.ok(large.perNeighbourQuery.examined <= small.perNeighbourQuery.examined * 1.5);
  assert.ok(large.perInterestQuery.examined <= small.perInterestQuery.examined * 1.5);
  // And it examines a small fraction of the population a brute-force pass would test.
  assert.ok(large.perNeighbourQuery.examined < 10000 / 100);
});
