import test from 'node:test';
import assert from 'node:assert/strict';
import {createRunRandom} from './run-random';
import {createRng, mulberry32} from './rng';

test('visit seeds replay by player/name, vary per run, and do not consume another stream', () => {
  const a = createRunRandom(() => 1729000123456),
    b = createRunRandom(() => 1729000123456);
  const first = a.seed('river-trip', '1');
  a.seed('lift', '1');
  a.seed('river-trip', '2');
  assert.equal(first, b.seed('river-trip', '1'));
  const second = a.seed('river-trip', '1');
  assert.equal(second, b.seed('river-trip', '1'));
  assert.notEqual(first, second);
  for (let i = 0; i < 30; i++) {
    const seed = a.seed('rally', '2');
    assert.ok(seed >= 0 && seed < 100000);
    const old = mulberry32(seed),
      shared = createRng(seed);
    for (let j = 0; j < 100; j++) assert.equal(shared.next(), old());
  }
});

import {runRandom, installPresentationRandomSource} from './run-random';
test('presentation owners replay the legacy captured draw order without consuming simulation seeds', () => {
  const original = createRng('capture-fixed'),
    captured = createRng('capture-fixed');
  const restore = installPresentationRandomSource(() => captured.next());
  try {
    for (let i = 0; i < 100; i++)
      for (const owner of ['fx.gallery', 'ui.surprise', 'fx.sparks'] as const)
        assert.equal(runRandom.next(owner, '1'), original.next());
  } finally {
    restore();
  }
  const a = createRunRandom(() => 100),
    b = createRunRandom(() => 100);
  a.stream('fx.gallery', '1').next();
  a.stream('ui.surprise', '1').next();
  assert.equal(a.seed('lift', '1'), b.seed('lift', '1'));
  assert.equal(a.stream('fx.other', '1').next(), b.stream('fx.other', '1').next());
});

test('presentation reads reuse their stream without re-reading time or allocating a new seed', () => {
  let reads = 0;
  const a = createRunRandom(() => {
    reads++;
    return 123;
  });
  const first = a.stream('fx.paint', 'presentation-session');
  for (let i = 0; i < 100; i++) assert.equal(a.stream('fx.paint', 'presentation-session'), first);
  assert.equal(reads, 1);
});
