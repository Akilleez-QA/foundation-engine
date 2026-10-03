import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDependencyBudget} from '@engine';
import {createDoorway} from './doorway';
import {prepareShelter} from './shelter.body.mts';

const drain = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

test('shared preflight allowance covers both retained and incoming owners', async () => {
  const budget = createDependencyBudget(416);
  const outgoing = createDoorway(budget);
  const incoming = prepareShelter(new AbortController().signal, undefined, budget);
  try {
    await incoming.prepare(2);
    assert.equal(incoming.get('contact')?.heightAt?.(0, 0), 0);
    assert.equal(budget.stats.reservedBytes, 416);
    assert.equal(budget.stats.owners, 2);
    assert.throws(() => createDoorway(budget), /admission exceeded/);
    outgoing.dispose();
    await drain();
    assert.equal(budget.stats.reservedBytes, 208);
    assert.equal(budget.stats.owners, 1);
    assert.equal(incoming.get('contact')?.heightAt?.(0, 0), 0);
  } finally {
    outgoing.dispose();
    incoming.dispose();
    await drain();
  }
  assert.equal(budget.stats.reservedBytes, 0);
  assert.equal(budget.stats.owners, 0);
});

test('denied incoming preflight never acquires and can retry after the outgoing owner retires', async () => {
  const budget = createDependencyBudget(208);
  const outgoing = createDoorway(budget);
  let acquired = 0;
  assert.throws(
    () =>
      prepareShelter(
        new AbortController().signal,
        async () => {
          acquired++;
          return {bytes: 0, lease: {value: {}, release() {}}};
        },
        budget,
      ),
    /admission exceeded/,
  );
  assert.equal(acquired, 0);
  assert.equal(budget.stats.reservedBytes, 208);
  outgoing.dispose();
  await drain();
  const incoming = prepareShelter(new AbortController().signal, undefined, budget);
  try {
    await incoming.prepare(2);
    assert.equal(incoming.get('contact')?.heightAt?.(0, 0), 0);
  } finally {
    incoming.dispose();
    await drain();
  }
  assert.equal(budget.stats.reservedBytes, 0);
});
