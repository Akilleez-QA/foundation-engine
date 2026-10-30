import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../app';
import {defineModule} from '../module';
import {saveModule} from './module';
import {MemoryBackend} from './storage-port';
import type {SaveSection} from './section';

interface Counter {
  count: number;
  label: string;
}
const counter: SaveSection<Counter> = {
  id: 'demo.counter',
  scope: 'player',
  version: 2,
  initial: () => ({count: 0, label: ''}),
  parse: raw => {
    const o = raw as Counter;
    if (!o || !Number.isFinite(o.count)) throw Error('Invalid counter');
    return {count: o.count, label: String(o.label ?? '')};
  },
  migrations: {1: (old: {n: number}) => ({count: old.n, label: 'migrated'})},
};
const timers = {
  set: (fn: () => void) => {
    fn();
    return 0;
  },
  clear() {},
  now: () => 0,
};

function boot(
  backend: MemoryBackend,
  extra = defineModule({
    id: 'feature.demo',
    version: '1.0.0',
    requires: ['core.save'],
    register(r) {
      r.saveSections.add(counter, 'feature.demo');
    },
  }),
) {
  const app = createApp(
    [
      saveModule({
        namespace: 'demo',
        build: 'demo@1.0.0',
        storage: () => ({local: backend.port(0, 'local'), session: backend.port(0, 'session')}),
        timers,
      }),
      extra,
    ],
    {mode: 'test', log() {}},
  );
  return app;
}

test('core.save: modules register sections as rows; the store is built from the frozen set and provided as `save`', async () => {
  const backend = new MemoryBackend();
  const app = boot(backend);
  const report = await app.boot();
  assert.deepEqual(
    report.modules.map(m => [m.id, m.status]),
    [
      ['core.save', 'installed'],
      ['feature.demo', 'installed'],
    ],
  );
  const h = app.services.save.section(counter);
  h.update(
    d => {
      d.count = 3;
    },
    {now: true},
  );
  assert.ok(
    [...backend.data.keys()].some(k => k.startsWith('demo|')),
    'keys are namespaced',
  );
  assert.deepEqual(app.probes.read('save')?.sections, ['demo.counter']);
  app.dispose();
});

test('core.save: a stored v1 envelope migrates to v2 on read', async () => {
  const backend = new MemoryBackend();
  const first = boot(backend);
  await first.boot();
  first.services.save.section(counter).update(
    d => {
      d.count = 1;
    },
    {now: true},
  );
  const key = [...backend.data.keys()].find(k => k.includes('demo.counter'))!;
  const env = JSON.parse(backend.data.get(key)!);
  env.v = 1;
  env.data = {n: 7};
  backend.data.set(key, JSON.stringify(env));
  first.dispose();
  const second = boot(backend);
  await second.boot();
  assert.deepEqual(second.services.save.section(counter).get(), {count: 7, label: 'migrated'});
  second.dispose();
});

test('core.save: a malformed section id is refused before anything installs', async () => {
  const bad = defineModule({
    id: 'feature.bad',
    version: '1.0.0',
    requires: ['core.save'],
    register(r) {
      r.saveSections.add({...counter, id: 'Counter'}, 'feature.bad');
    },
  });
  const app = boot(new MemoryBackend(), bad);
  await assert.rejects(app.boot());
});
