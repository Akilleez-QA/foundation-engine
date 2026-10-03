import test from 'node:test';
import assert from 'node:assert/strict';
import {appAssets, installAppAssets, lazyTextureLibrary} from './app-assets';
import type {TextureLibrary} from './textures';

const fakeLibrary = (owned: object, policies: unknown[] = []): TextureLibrary => ({
  texture: async id => ({value: {id} as never, key: id, id, variant: {path: id} as never, release() {}}) as never,
  variant: async id => ({path: id}) as never,
  url: v => '/' + v.path,
  owns: r => r === owned,
  stats: () => ({
    residentMiB: 1,
    warmMiB: 0,
    loads: 1,
    hits: 0,
    uploads: 1,
    lateDrops: 0,
    disposed: 0,
    pinnedMiB: 0,
    evictions: 0,
    reloads: 0,
    pressure: 0,
    cleanupFailures: 0,
  }),
  setResidency: policy => {
    policies.push(policy);
  },
});

test('RES-01: a residency policy set before the library loads reaches it on load, and later ones directly', async () => {
  const policies: unknown[] = [];
  const lib = lazyTextureLibrary(async () => fakeLibrary({}, policies));
  lib.setResidency({warmBytes: 1});
  lib.setResidency({warmBytes: 2});
  assert.deepEqual(policies, [], 'nothing loads for a policy');
  await lib.variant('asset.a', 1);
  assert.deepEqual(policies, [{warmBytes: 2}], 'only the latest policy is applied on load');
  lib.setResidency({warmBytes: 3});
  assert.deepEqual(policies, [{warmBytes: 2}, {warmBytes: 3}]);
});

test('the lazy library loads its implementation on the first texture, once; before that it owns nothing', async () => {
  const owned = {};
  let loads = 0;
  const lib = lazyTextureLibrary(async () => {
    loads++;
    return fakeLibrary(owned);
  });
  assert.equal(loads, 0, 'installing it fetches nothing');
  assert.equal(lib.owns(owned), false);
  assert.equal(lib.stats().loads, 0);
  assert.throws(() => lib.url({path: 'x'} as never), /not loaded yet/);
  const [a, b] = await Promise.all([
    lib.texture('asset.a', {screenPx: 1, signal: new AbortController().signal}),
    lib.variant('asset.b', 1),
  ]);
  assert.equal(a.id, 'asset.a');
  assert.deepEqual(b, {path: 'asset.b'});
  assert.equal(loads, 1, 'one fetch for concurrent first uses');
  assert.equal(lib.owns(owned), true);
  assert.equal(lib.url({path: 'x'} as never), '/x');
  assert.equal(lib.stats().loads, 1);
});

test('a failed fetch is forgotten, so the next texture fetches again', async () => {
  let loads = 0;
  const lib = lazyTextureLibrary(async () => {
    if (loads++ === 0) throw new Error('offline');
    return fakeLibrary({});
  });
  await assert.rejects(lib.texture('asset.a', {screenPx: 1, signal: new AbortController().signal}), /offline/);
  assert.equal((await lib.texture('asset.a', {screenPx: 1, signal: new AbortController().signal})).id, 'asset.a');
  assert.equal(loads, 2);
});

test('appAssets() is the library the composition root installed', () => {
  const lib = fakeLibrary({});
  assert.equal(installAppAssets(lib), lib);
  assert.equal(appAssets(), lib);
});
