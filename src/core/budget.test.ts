import {test} from 'node:test';
import assert from 'node:assert/strict';
import {budgetFor} from './budget';
import type {Ported} from './tiers';

test('budgetFor: reference is the flat values; a preset inherits heavier ports, then the reference', () => {
  const b: Ported<{draws: number; triangles: number}> = {
    draws: 400,
    triangles: 1e6,
    ports: {high: {draws: 350}, low: {triangles: 2e5}},
  };
  assert.deepEqual(budgetFor(b, 'reference'), {draws: 400, triangles: 1e6});
  assert.deepEqual(budgetFor(b, 'high'), {draws: 350, triangles: 1e6});
  assert.deepEqual(budgetFor(b, 'medium'), {draws: 350, triangles: 1e6}, 'medium has no port: inherits high');
  assert.deepEqual(budgetFor(b, 'low'), {draws: 350, triangles: 2e5});
  assert.deepEqual(budgetFor({draws: 1}, 'low'), {draws: 1}, 'unported: the reference values');
});
