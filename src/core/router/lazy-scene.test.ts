import test from 'node:test';
import assert from 'node:assert/strict';
import {appI18n} from '../i18n/app-i18n';
import {lazy} from '../registry';
import {lazyScene} from './lazy-scene';
import type {LabelKey} from '../i18n/label';
import type {SceneVisit} from './handover';
const visit: SceneVisit = {
  epoch: 7,
  scene: 'scene.gallery',
  params: {},
  player: '2',
  signal: new AbortController().signal,
  current: () => true,
};
test('routing metadata is eager; loading prepares the body without entering it', async () => {
  let factories = 0,
    loads = 0,
    enters = 0;
  const run = {leave() {}};
  const row = lazyScene(
    {id: 'scene.gallery', label: 'Gallery', preload: 'idle'},
    lazy(async () => {
      factories++;
      return {
        id: 'scene.gallery',
        label: 'Gallery',
        load() {
          loads++;
          return 42;
        },
        enter(value, at) {
          enters++;
          assert.equal(value, 42);
          assert.equal(at, visit);
          return run;
        },
      };
    }),
  );
  assert.equal(row.id, 'scene.gallery');
  assert.equal(factories, 0);
  const loaded = await row.load();
  assert.deepEqual([factories, loads, enters], [1, 1, 0]);
  assert.equal(await row.enter(loaded, visit), run);
  await row.load();
  assert.deepEqual([factories, loads, enters], [1, 2, 1]);
});
test('a rejected body factory or payload remains retryable', async () => {
  let tries = 0,
    loads = 0;
  const row = lazyScene(
    {id: 'scene.gallery', label: 'Gallery'},
    lazy(async () => {
      if (++tries === 1) throw Error('body unavailable');
      return {
        id: 'scene.gallery',
        label: 'Gallery',
        load() {
          if (++loads === 1) throw Error('payload unavailable');
          return 'ready';
        },
        enter() {
          return {leave() {}};
        },
      };
    }),
  );
  await assert.rejects(Promise.resolve(row.load()), /body unavailable/);
  await assert.rejects(Promise.resolve(row.load()), /payload unavailable/);
  await row.load();
  assert.deepEqual([tries, loads], [2, 2]);
});

test('loading captions work before the lazy catalogue arrives and read it afterwards', () => {
  const row = lazyScene(
    {id: 'scene.gallery', label: {key: 'gallery.loading.gallery' as LabelKey, fallback: 'the Gallery'}},
    lazy(async () => {
      throw Error('must stay dormant');
    }),
  );
  assert.equal(row.label, 'the Gallery');
  appI18n.addCatalog('en', {'gallery.loading.gallery': 'Gallery catalogue caption'});
  assert.equal(row.label, 'Gallery catalogue caption');
});

test('a failed entry chunk is recovered before its exports are bound to the scene', async t => {
  const {lazyBody} = await import('./lazy-body'),
    {pageChunkRetry} = await import('./chunk-retry');
  const entry = {id: 'scene.gallery', label: 'Gallery', load: () => 42, enter: () => ({leave() {}})};
  let binds = 0;
  t.mock.method(pageChunkRetry, 'importUrl', async (url: string) => {
    assert.match(url, /entry\.js\?retry=1$/);
    return {scene: () => entry};
  });
  const body = lazyBody(
    async (): Promise<{scene: () => typeof entry}> => {
      throw new TypeError('Failed to fetch dynamically imported module: https://example.test/entry.js');
    },
    m => {
      binds++;
      return m.scene();
    },
  );
  await assert.rejects(body.load(), /dynamically imported module/);
  assert.equal(binds, 0);
  assert.equal(await body.load(), entry);
  assert.equal(await body.load(), entry);
  assert.equal(binds, 1);
});
