import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBackend } from '../../core/save/storage-port';
import { createSaveStore } from '../../core/save/store';
import { defineGenerationSeedSection, parseGenerationSeed } from './seed-section';

const run = defineGenerationSeedSection('procgen-test.run', { contentVersion: 3 });
function store(backend: MemoryBackend) {
  let id = 0; const q = new Map<number, () => void>();
  const timers = { now: () => 0, set: (fn: () => void) => { q.set(++id, fn); return id; }, clear: (h: unknown) => { q.delete(h as number); } };
  return createSaveStore({ local: backend.port(0), session: new MemoryBackend().port(0, 'session'), build: 'game@test', timers, sections: [run.section] });
}

test('GEN-01 seed section round-trips a root seed and an ended run through the real save store', () => {
  const backend = new MemoryBackend();
  const first = store(backend), handle = first.section(run.section);
  assert.deepEqual(handle.get(), { seed: null, contentVersion: 3 });
  assert.equal(handle.update(d => { d.seed = 0xffffffff; d.contentVersion = 4; }, { now: true }), 'saved');
  first.dispose?.();
  const second = store(backend).section(run.section);
  assert.deepEqual(second.get(), { seed: 0xffffffff, contentVersion: 4 }, 'the content version travels with the seed');
  second.update(d => { d.seed = null; }, { now: true });
  assert.deepEqual(store(backend).section(run.section).get(), { seed: null, contentVersion: 4 });
});

test('GEN-01 corrupt or unversioned seed saves are quarantined, never adopted or overwritten unseen', () => {
  for (const data of [{ seed: '7', contentVersion: 0 }, { seed: 1.5, contentVersion: 0 }, { seed: -1, contentVersion: 0 }, { seed: 2 ** 32, contentVersion: 0 }, { seed: 7, contentVersion: 0, extra: 1 }, { seed: 7 }, { seed: 7, contentVersion: -1 }, { seed: 7, contentVersion: 1.5 }, [7], null, 7, {}]) {
    const backend = new MemoryBackend();
    const key = [...(() => { const s = store(backend); s.section(run.section).update(d => { d.seed = 1; }, { now: true }); return backend.data.keys(); })()].find(k => k.endsWith('procgen-test.run'))!;
    const raw = JSON.stringify({ v: 1, data });
    backend.data.set(key, raw);
    const handle = store(backend).section(run.section);
    assert.deepEqual(handle.get(), { seed: null, contentVersion: 3 }, JSON.stringify(data));
    assert.equal(handle.status(), 'quarantined');
    assert.ok([...backend.data.entries()].some(([k, v]) => k !== key && v === raw), 'the unreadable bytes are kept in quarantine');
  }
  assert.throws(() => parseGenerationSeed(Object.create({ seed: 1, contentVersion: 0 })));
  assert.deepEqual(parseGenerationSeed({ contentVersion: 0, seed: 0 }), { seed: 0, contentVersion: 0 });
  assert.throws(() => defineGenerationSeedSection('procgen-test.bad', { contentVersion: -1 }));
});
