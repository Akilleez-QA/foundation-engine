import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {readFileSync} from 'node:fs';
import {createDigestTrace, compareDigests, checkDigestSnapshot} from '../../src/kits/replay/digest.ts';
import {MemoryBackend} from '../../src/core/save/storage-port.ts';
import {createSaveStore} from '../../src/core/save/store.ts';
import {assessEvidence} from './report.mjs';

function envelope(id, required, cases) {
  // Synthetic fixture identity only: actual acceptance runners must supply measured artifact/environment identities.
  const identity = {artifact: 'synthetic-consumer-v1', configuration: id, oracle: 'exact-v1', environment: 'node'};
  return assessEvidence({format: 'acceptance/1', identity, required}, {format: 'acceptance/1', identity, cases});
}

test('replay consumer retains required sample coverage and propagates actual divergence', () => {
  const trace = value => {
    const t = createDigestTrace({identity: 'counter-v1', every: 1, maxEntries: 4, maxDigestLength: 32});
    for (let tick = 0; tick < 4; tick++) t.observe(tick, () => String(value(tick)));
    return t.read();
  };
  const reference = trace(tick => tick * 2);
  const assess = candidate => {
    const comparison = compareDigests(reference, candidate);
    return envelope(
      'replay',
      [{id: 'counter', minSamples: 4}],
      [
        {
          id: 'counter',
          status: comparison.status === 'equal' ? 'passed' : 'failed',
          samples: comparison.status === 'equal' ? comparison.samples : 0,
        },
      ],
    );
  };
  assert.equal(assess(trace(tick => tick + tick)).status, 'passed');
  assert.equal(assess(trace(tick => (tick === 2 ? 99 : tick * 2))).status, 'failed');
  const empty = createDigestTrace({identity: 'counter-v1', every: 1, maxEntries: 4, maxDigestLength: 32}).read();
  assert.equal(assess(empty).status, 'failed');
  assert.throws(() => checkDigestSnapshot({...reference, entries: reference.entries.slice(1)}, 4, 32), /sample count/);
});

test('save consumer reads retained historical bytes and compares migration plus fresh-owner reopen', () => {
  const backend = new MemoryBackend();
  const key = 'game|p:1|compat.record';
  const raw = readFileSync(new URL('../../src/core/save/fixtures/migrations/v1.json', import.meta.url), 'utf8');
  backend.data.set(key, raw);
  const definition = {
    id: 'compat.record',
    scope: 'player',
    version: 3,
    initial: () => ({total: 0, labels: []}),
    parse: value => {
      if (
        !Number.isSafeInteger(value?.total) ||
        !Array.isArray(value.labels) ||
        value.labels.some(x => typeof x !== 'string')
      )
        throw Error('invalid record');
      return {total: value.total, labels: [...value.labels]};
    },
    migrations: {1: old => ({total: old.count}), 2: old => ({...old, labels: []})},
  };
  const create = () =>
    createSaveStore({
      local: backend.port(),
      session: new MemoryBackend().port(0, 'session'),
      build: 'evidence-fixture',
      timers: {now: () => 0, set: () => 0, clear: () => {}},
      sections: [definition],
    });
  const cases = [];
  const first = create();
  try {
    const value = first.section(definition).get();
    first.flush();
    cases.push({
      id: 'migration',
      status:
        isDeepStrictEqual(value, {total: 7, labels: []}) && backend.data.get(`game-bak|${key}|v1`) === raw
          ? 'passed'
          : 'failed',
      samples: 1,
    });
  } finally {
    first.dispose();
  }
  const second = create();
  try {
    const writes = backend.writes;
    const value = second.section(definition).get();
    second.flush();
    cases.push({
      id: 'reopen',
      status: isDeepStrictEqual(value, {total: 7, labels: []}) && backend.writes === writes ? 'passed' : 'failed',
      samples: 1,
    });
  } finally {
    second.dispose();
  }
  const required = [
    {id: 'migration', minSamples: 1},
    {id: 'reopen', minSamples: 1},
  ];
  assert.equal(envelope('save', required, cases).status, 'passed');
  assert.equal(envelope('save', required, cases.slice(0, 1)).status, 'failed', 'reopen cannot be silently omitted');
});
