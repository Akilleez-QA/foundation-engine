// The audio module's creator wiring, booted for real in node (no DOM, so the output stays without a context): the
// optional headphone setting row, and the effective HRTF limit following that setting and the quality preset.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../core/app';
import { saveModule } from '../../core/save/module';
import { settingsModule } from '../../core/settings/module';
import features from '../../core/settings/features-module';
import { resetAppSettingsForTests } from '../../core/settings/app-settings';
import { qualityModule } from '../render/quality-module';
import { audioModule, spatialAudioSettings, type SpatialAudioOptions } from './module';

async function boot(spatial?: SpatialAudioOptions) {
  resetAppSettingsForTests();
  const app = createApp([saveModule({ namespace: 'audio-test', build: 'audio-test@1.0.0' }), settingsModule({ game: spatialAudioSettings(spatial) }), qualityModule({ initialPreset: 'reference', build: 'audio-test@1.0.0' }), features, audioModule(spatial)], { mode: 'test', log: () => {} });
  const report = await app.boot();
  assert.deepEqual(report.modules.filter(m => m.status !== 'installed').map(m => `${m.id}: ${m.status} ${m.reason ?? ''}`), []);
  return app;
}

test('without creator options the HRTF limit is the default and no headphone setting exists', async () => {
  const app = await boot();
  assert.equal(app.services.audio.stats.hrtfLimit, 8);
  assert.equal(app.services.settings.defs('sound').some(d => d.id === 'sound.headphone-3d'), false);
  app.dispose();
});

test('the headphone setting and the quality preset drive the HRTF limit live', async () => {
  const app = await boot({ headphoneSetting: true, hrtf: { maxVoices: 6, ports: { medium: { maxVoices: 2 }, low: { maxVoices: 0 } } } });
  const { audio, settings, quality } = app.services;
  assert.equal(settings.get('sound.headphone-3d'), true); assert.equal(audio.stats.hrtfLimit, 6);
  quality.setPreset('medium'); assert.equal(audio.stats.hrtfLimit, 2);
  settings.set('sound.headphone-3d', false); assert.equal(audio.stats.hrtfLimit, 0);
  quality.setPreset('high'); assert.equal(audio.stats.hrtfLimit, 0, 'the setting off wins over the preset');
  settings.set('sound.headphone-3d', true); assert.equal(audio.stats.hrtfLimit, 6);
  quality.setPreset('low'); assert.equal(audio.stats.hrtfLimit, 0);
  app.dispose();
});
