import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app';
import { installAppSaveStore, resetAppSaveStoreForTests } from '../save/app-store';
import { MemoryBackend } from '../save/storage-port';
import { createSaveStore } from '../save/store';
import { appFeatures, bindAppFeatures, coreFeatures, featureUrl } from './app-features';
import { createFeatures, featureOverridesSection } from './features';
import module from './features-module';

const timers = { now: () => 0, set: () => 0, clear: () => {} };
const open = (disk = new MemoryBackend(), tab = 0) => installAppSaveStore(createSaveStore({
  local: disk.port(tab), session: new MemoryBackend().port(tab, 'session'), build: 'game@test', timers,
  sections: [featureOverridesSection],
}));
afterEach(() => { bindAppFeatures(null); resetAppSaveStoreForTests(); });

const demo = { id: 'ui.minimap', stage: 'stable' as const, default: true, description: 'Mini map' };

test('silent-test is a nonpersistent alias, explicit flags win, production stays off', () => {
  const read = (url: string, dev = true) => createFeatures([...coreFeatures, demo], { dev, url: featureUrl(url), overrides: {} });
  assert.equal(read('/?silent-test').enabled('dev.silent'), true);
  assert.equal(read('/?silent-test&flags=-dev.silent').enabled('dev.silent'), false);
  assert.equal(read('/?silent-test', false).enabled('dev.silent'), false);
  assert.equal(read('/?flags=render.webgpu-map').enabled('render.webgpu-map'), false, 'an unknown flag is off');
  assert.equal(read('/').enabled('ui.minimap'), true, 'a stable flag is on by default');
});

test('the running service follows device overrides, other tabs, reset and replacement stores', () => {
  const disk = new MemoryBackend(), store = open(disk);
  bindAppFeatures(() => [...coreFeatures, demo]);
  const flags = appFeatures();
  assert.equal(flags.enabled('ui.minimap'), true);
  store.section(featureOverridesSection).replace({ 'ui.minimap': false, 'future.flag': true });
  assert.equal(flags.enabled('ui.minimap'), false);
  store.flush();
  assert.equal(JSON.parse(disk.data.get('game|device|settings.flags')!).data['future.flag'], true);
  assert.ok(!('settings.flags' in store.exportPlayer('1').sections), 'device preferences are not player exports');
  disk.port(1).set('game|device|settings.flags', JSON.stringify({ v: 1, by: 'other-tab', data: { 'ui.minimap': true } }));
  assert.equal(flags.enabled('ui.minimap'), true);
  store.section(featureOverridesSection).replace({ 'ui.minimap': false });
  store.flush();
  store.resetAll();
  assert.equal(flags.enabled('ui.minimap'), true);
  const next = open();
  next.section(featureOverridesSection).replace({ 'ui.minimap': false });
  assert.equal(flags.enabled('ui.minimap'), false);
  store.dispose();
});

test('real kernel registers flags, resolves patch needs and exposes service explanations as a probe', async () => {
  open();
  const app = createApp([module, { id: 'core.save', version: '1.0.0', defines: { saveSections: {} } }, {
    id: 'pack.flag-test', version: '1.0.0', requires: ['core.features'],
    register(r) { r.features.add(demo, 'pack.flag-test'); r.features.add({ id: 'test.extra', stage: 'stable', default: true, description: 'extra' }, 'pack.flag-test'); },
    patches: [{ id: 'flag-gated', registry: 'features', target: 'ui.minimap', needs: 'flag:test.extra', op: { kind: 'merge', merge: { default: false } } }],
  }], { mode: 'test', flag: id => appFeatures().enabled(id), log: () => {} });
  bindAppFeatures(() => app.registries.features.all());
  try {
    const report = await app.boot();
    assert.deepEqual(report.problems, []);
    assert.ok(report.modules.every(m => m.status === 'installed'));
    assert.equal(app.services.features.enabled('test.extra'), true);
    assert.equal(app.services.features.enabled('ui.minimap'), false);
    assert.equal(report.patches.applied.length, 1);
    assert.deepEqual(app.probes.read('features'), app.services.features.explain());
  } finally { app.dispose(); }
});
