import test from 'node:test';
import assert from 'node:assert/strict';
import {layerModules} from '../../app/layer-modules';
import {defineGame} from '../../author/defs';
import {createApp} from '../../core/app';
import type {EngineModule} from '../../core/module';
import {saveModule} from '../../core/save/module';
import {MemoryBackend} from '../../core/save/storage-port';
import {qualityModule, type QualityModuleOptions} from './quality-module';
import {appQuality, livePixelRatio} from './quality-runtime';
import {graphicsSettingsSection} from './quality';

const quietTimers = {set: () => 0, clear() {}, now: () => 0};
function setup(options: QualityModuleOptions, disk = new MemoryBackend(), extra: EngineModule[] = []) {
  const app = createApp(
    [
      ...extra,
      qualityModule(options),
      saveModule({
        namespace: 'quality-test',
        build: 'quality-test@1',
        timers: quietTimers,
        storage: () => ({local: disk.port(), session: new MemoryBackend().port(0, 'session')}),
      }),
    ],
    {mode: 'test', log() {}},
  );
  return {app, disk};
}

test('quality module registers device storage and binds authored quality before dependent rendering', async () => {
  let ratio = 0,
    observed = '';
  const renderer = {
    setPixelRatio(value: number) {
      ratio = value;
    },
    dispose() {},
  };
  const {app} = setup(
    {
      initialPreset: 'low',
      signals: () => {
        throw Error('no probe');
      },
    },
    undefined,
    [
      {
        id: 'feature.render-test',
        version: '1.0.0',
        requires: ['platform.quality'],
        install(s) {
          assert.equal(appQuality(), s.quality);
          observed = s.quality.preset;
          livePixelRatio(renderer);
          return {dispose: () => renderer.dispose()};
        },
      },
    ],
  );
  try {
    const result = await app.boot();
    assert.ok(result.modules.every(m => m.status === 'installed'));
    assert.equal(observed, 'low');
    assert.equal(ratio, 0.85);
    assert.ok(
      app.registries.saveSections
        .all()
        .some(s => s.id === 'graphics.settings' && s.scope === 'device' && s.export === false),
    );
    assert.deepEqual(app.probes.read('quality'), {preset: 'low', source: 'default', governing: false});
  } finally {
    app.dispose();
  }
  assert.notEqual(appQuality().preset, 'low', 'retired binding cannot leak into another app');
});

test('saved explicit quality survives reload and wins over a changed authored startup', async () => {
  const {app, disk} = setup({initialPreset: 'low'});
  await app.boot();
  app.services.quality.setPreset('medium');
  app.services.save.flush('test');
  app.dispose();
  const next = setup(
    {
      initialPreset: 'reference',
      signals: () => {
        throw Error('saved choice must not probe');
      },
    },
    disk,
  ).app;
  try {
    await next.boot();
    assert.equal(next.services.quality.preset, 'medium');
    assert.equal(next.services.save.section(graphicsSettingsSection).get()?.preset, 'medium');
  } finally {
    next.dispose();
  }
});

test('query pin wins without rewriting saved quality or probing', async () => {
  const {app, disk} = setup({initialPreset: 'medium'});
  await app.boot();
  app.services.quality.setPreset('low');
  app.services.save.flush('test');
  app.dispose();
  const before = new Map(disk.data);
  const pinned = setup(
    {
      initialPreset: 'medium',
      search: '?quality=high',
      signals: () => {
        throw Error('no probe');
      },
    },
    disk,
  ).app;
  try {
    await pinned.boot();
    assert.equal(pinned.services.quality.preset, 'high');
    assert.equal(pinned.services.quality.source, 'pinned');
    assert.equal(pinned.services.quality.governing, false);
    assert.deepEqual(disk.data, before);
  } finally {
    pinned.dispose();
  }
});

test('older module disposal cannot clear the newer app quality binding', async () => {
  const older = setup({initialPreset: 'low'}).app;
  const newer = setup({initialPreset: 'medium'}).app;
  await older.boot();
  await newer.boot();
  older.dispose();
  try {
    assert.equal(appQuality(), newer.services.quality);
  } finally {
    newer.dispose();
  }
  assert.notEqual(appQuality(), newer.services.quality);
});

test('quality installation failure disables a dependent renderer', async () => {
  let rendered = false;
  const {app} = setup({initialPreset: 'invalid' as never}, undefined, [
    {
      id: 'feature.render-test',
      version: '1.0.0',
      requires: ['platform.quality'],
      install() {
        rendered = true;
      },
    },
  ]);
  try {
    const report = await app.boot();
    assert.equal(report.modules.find(m => m.id === 'platform.quality')?.status, 'failed');
    assert.notEqual(report.modules.find(m => m.id === 'feature.render-test')?.status, 'installed');
    assert.equal(rendered, false);
  } finally {
    app.dispose();
  }
});

test('invalid saved quality is quarantined before authored fallback is used', async () => {
  const disk = new MemoryBackend();
  const key = 'quality-test|device|graphics.settings';
  const damaged = JSON.stringify({v: 1, by: 'old', data: [1, 2]});
  disk.data.set(key, damaged);
  const {app} = setup(
    {
      initialPreset: 'medium',
      signals: () => {
        throw Error('no probe');
      },
    },
    disk,
  );
  try {
    await app.boot();
    assert.equal(app.services.quality.preset, 'medium');
    assert.equal(app.services.quality.source, 'default');
    assert.ok(
      [...disk.data.entries()].some(([k, v]) => k !== key && v.includes('[1,2]')),
      'damaged data retained in quarantine',
    );
  } finally {
    app.dispose();
  }
});

test('pinned module never reads the graphics section from storage', async () => {
  const disk = new MemoryBackend(),
    port = disk.port();
  const reads: string[] = [];
  const local = {
    ...port,
    get(key: string) {
      reads.push(key);
      return port.get(key);
    },
  };
  const app = createApp(
    [
      qualityModule({
        initialPreset: 'low',
        search: '?quality=reference',
        signals: () => {
          throw Error('no probe');
        },
      }),
      saveModule({
        namespace: 'quality-test',
        build: 'quality-test@1',
        timers: quietTimers,
        storage: () => ({local, session: new MemoryBackend().port(0, 'session')}),
      }),
    ],
    {mode: 'test', log() {}},
  );
  try {
    await app.boot();
    assert.equal(app.services.quality.source, 'pinned');
    assert.ok(!reads.some(key => key.includes('graphics.settings')));
  } finally {
    app.dispose();
  }
});

test('application composition forwards the authored quality tier into actual runtime service', async () => {
  const game = defineGame({id: 'quality-demo', version: '1.0.0', title: 'Quality demo', firstScene: 'sample'});
  const quality = layerModules(game, {quality: {tier: 'medium', tierDeclared: true, views: []}}).find(
    m => m.id === 'platform.quality',
  )!;
  const app = createApp(
    [
      quality,
      saveModule({
        namespace: game.id,
        build: 'test',
        timers: quietTimers,
        storage: () => ({local: new MemoryBackend().port(), session: new MemoryBackend().port(0, 'session')}),
      }),
    ],
    {mode: 'test', log() {}},
  );
  try {
    await app.boot();
    assert.equal(app.services.quality.preset, 'medium');
    assert.equal(appQuality(), app.services.quality);
  } finally {
    app.dispose();
  }
});
