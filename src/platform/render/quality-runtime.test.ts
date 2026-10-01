import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBackend } from '../../core/save/storage-port';
import { createSaveStore } from '../../core/save/store';
import { createQuality, graphicsSettingsSection as graphicsSettings, type DeviceSignals, type GraphicsChoiceStore, type GraphicsSettings } from './quality';
import { appQuality, bindAppQuality, createAppQuality, livePixelRatio, liveShadowMap, pinnedPreset } from './quality-runtime';

const RTX: DeviceSignals = { coarsePointer: false, deviceMemory: 8, cores: 32, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)', maxTextureSize: 16384 };
const PHONE: DeviceSignals = { coarsePointer: true, deviceMemory: 4, cores: 8, gpu: 'Adreno (TM) 740', maxTextureSize: 16384 };

function memoryStore(initial?: GraphicsSettings) {
  let saved = initial, writes = 0;
  const store: GraphicsChoiceStore = { read: () => saved, write: v => { saved = v; writes++; } };
  return { store, saved: () => saved, writes: () => writes };
}
/** The engine's store over one memory "device", with the graphics section as the composition root wires it. */
function deviceStore(b = new MemoryBackend()) {
  const save = createSaveStore({ local: b.port(), session: new MemoryBackend().port(0, 'session'), build: 'game@test', sections: [graphicsSettings], timers: { set: () => 0, clear: () => {}, now: () => 0 } });
  const choice = save.section(graphicsSettings);
  return { b, store: { read: () => choice.get() ?? undefined, write: (v: GraphicsSettings) => { choice.replace(v, { now: true }); } } as GraphicsChoiceStore };
}

test('?quality=<preset> pins only the four presets', () => {
  assert.equal(pinnedPreset('?quality=reference'), 'reference');
  assert.equal(pinnedPreset('?silent-test&quality=low'), 'low');
  assert.equal(pinnedPreset('?quality=ultra'), undefined);
  assert.equal(pinnedPreset(''), undefined);
});

test('a pinned run reads nothing, writes nothing and never detects', () => {
  const m = memoryStore({ preset: 'low', overrides: {}, governor: false });
  let probed = 0;
  const q = createAppQuality({ store: m.store, search: '?quality=reference', signals: () => { probed++; return PHONE; } });
  assert.equal(q.preset, 'reference'); assert.equal(q.source, 'pinned'); assert.equal(probed, 0);
  q.setPreset('medium');
  assert.equal(q.preset, 'medium'); assert.equal(m.writes(), 0); assert.equal(m.saved()!.preset, 'low');
});

test('detection picks the FIRST preset only; the saved choice always wins afterwards', () => {
  const dev = deviceStore();
  let probed = 0;
  const first = createAppQuality({ store: dev.store, build: 'game@test', signals: () => { probed++; return RTX; } });
  assert.equal(first.preset, 'reference'); assert.equal(first.source, 'detected'); assert.equal(probed, 1);
  assert.deepEqual(first.settings.detected?.reasons, ['reference-class GPU ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)', '32 cores']);
  first.setPreset('low');
  // Next boot on the same device: no probe, the player's Low stays even though the device looks like a reference machine.
  const again = createAppQuality({ store: deviceStore(dev.b).store, signals: () => { probed++; return RTX; } });
  assert.equal(again.preset, 'low'); assert.equal(again.source, 'player'); assert.equal(probed, 1);
  assert.equal(again.settings.detected?.preset, 'reference');
});

test('a weak device (software GL) starts on High, today\'s ratio, with Low only suggested', () => {
  const dev = deviceStore();
  const q = createAppQuality({ store: dev.store, signals: () => ({ coarsePointer: false, gpu: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))', maxTextureSize: 8192 }) });
  assert.equal(q.preset, 'high'); assert.equal(q.settings.detected?.suggested, 'low');
  assert.equal(JSON.parse(dev.b.data.get('game|device|graphics.settings')!).data.detected.suggested, 'low');
  assert.equal(createAppQuality({ store: deviceStore(dev.b).store }).settings.detected?.suggested, 'low');   // kept across boots
});

test('the choice is one device section envelope, never exported', () => {
  const dev = deviceStore();
  const q = createAppQuality({ store: dev.store, signals: () => PHONE });
  q.setKnob('resolution.scale', 0.75);
  const keys = [...dev.b.data.keys()];
  assert.deepEqual(keys, ['game|device|graphics.settings']);
  assert.deepEqual(JSON.parse(dev.b.data.get('game|device|graphics.settings')!).data, { preset: 'high', overrides: { 'resolution.scale': 0.75 }, governor: false, detected: { preset: 'high', reasons: ['GPU Adreno (TM) 740', '4 GB memory'], build: '', suggested: 'medium' } });
  assert.equal(graphicsSettings.scope, 'device'); assert.equal(graphicsSettings.export, false);
  // Per device: another device (another backend) knows nothing of it and detects for itself.
  const other = createAppQuality({ store: deviceStore().store, signals: () => RTX });
  assert.equal(other.preset, 'reference');
});

test('unreadable stored choice is quarantined and the device detects again', () => {
  const b = new MemoryBackend(); b.data.set('game|device|graphics.settings', JSON.stringify({ v: 1, by: 'x', data: [1, 2] }));
  const q = createAppQuality({ store: deviceStore(b).store, signals: () => RTX });
  assert.equal(q.preset, 'reference'); assert.equal(q.source, 'detected');
});

test('livePixelRatio applies quality.pixelRatio(max) now and on every change, until dispose', () => {
  const q = createQuality({ devicePixelRatio: () => 2 });
  const calls: number[] = [];
  let ratio = 0, disposed = 0;
  const renderer = { setPixelRatio: (r: number) => { ratio = r; calls.push(r); }, getPixelRatio: () => ratio, dispose() { disposed++; } };
  livePixelRatio(renderer, 1.7, q);
  assert.deepEqual(calls, [1.7]);                         // reference: min(dpr 2, max 1.7, cap 2) × 1, today's desktop value
  q.setPreset('medium'); assert.equal(ratio, 1.5);         // medium caps at 1.5, today's touch cap
  q.setPreset('low'); assert.equal(ratio, 0.85);           // low: cap 1 × scale 0.85
  q.setKnob('frame-rate.cap', 60); assert.equal(calls.length, 3); // a change that leaves the ratio alone sets nothing
  q.setPreset('reference'); assert.equal(ratio, 1.7);
  renderer.dispose(); assert.equal(disposed, 1);
  q.setPreset('low'); assert.equal(ratio, 1.7);            // disposed: no longer followed
});

function fakeLight(size = 512) {
  let disposed = 0;
  const light = { castShadow: true, shadow: { mapSize: { x: size, set(x: number, _y: number) { this.x = x; } }, map: { dispose() { disposed++; } } as { dispose(): void } | null } };
  return { light, disposed: () => disposed };
}

test('liveShadowMap keeps today’s request at Reference and follows shadows.quality live until the renderer goes', () => {
  const q = createQuality({ pinned: 'reference' });
  const { light, disposed } = fakeLight();
  let rendererDisposed = 0;
  const renderer = { dispose() { rendererDisposed++; } };
  liveShadowMap(light, 2048, renderer, q);
  assert.equal(light.shadow.mapSize.x, 2048, 'Reference draws the map the scene asked for');
  assert.equal(disposed(), 1); assert.equal(light.shadow.map, null);
  light.shadow.map = { dispose() {} };
  q.setKnob('shadows.quality', 'low');
  assert.equal(light.shadow.mapSize.x, 1024, 'a lower quality shrinks it live');
  assert.equal(light.shadow.map, null, 'the old map is released and redrawn');
  q.setKnob('shadows.quality', 'off');
  assert.equal(light.castShadow, false, 'off stops the light casting');
  q.setKnob('shadows.quality', 'ultra');
  assert.equal(light.castShadow, true); assert.equal(light.shadow.mapSize.x, 2048);
  renderer.dispose();
  assert.equal(rendererDisposed, 1);
  q.setKnob('shadows.quality', 'low');
  assert.equal(light.shadow.mapSize.x, 2048, 'no longer follows after the renderer is disposed');
});

test('liveShadowMap takes a new request (a scene that sizes its map by its view) and leaves an unchanged map alone', () => {
  const q = createQuality({ pinned: 'medium' });
  const { light, disposed } = fakeLight(1024);
  const h = liveShadowMap(light, 1024, undefined, q);
  assert.equal(disposed(), 0, 'an already-right map is kept');
  h.request(2048);
  assert.equal(light.shadow.mapSize.x, 2048, 'Medium keeps today’s 2048 on a wide touch screen');
  light.castShadow = false;                        // the scene's own choice is not the knob's to undo
  q.setKnob('shadows.quality', 'low');
  assert.equal(light.castShadow, false);
  h.dispose();
});

test('a bench or gate page (?quality=reference) never governs, whatever this device saved', () => {
  const m = memoryStore({ preset: 'low', overrides: { 'resolution.scale': 0.5 }, governor: true });
  const q = createAppQuality({ store: m.store, search: '?quality=reference', signals: () => PHONE });
  assert.equal(q.preset, 'reference'); assert.equal(q.source, 'pinned');
  assert.equal(q.governing, false);
  assert.equal(q.knob('resolution.scale'), 1);
  for (let i = 0; i < 600; i++) q.frame({ intervalMs: 200, rendered: true, hidden: false, sinceEnterMs: 10_000 + i * 200, draws: 1, triangles: 1 });
  assert.equal(q.pixelRatio(2), 1, 'slow frames never move a pinned ratio');
  q.setGovernor(true);
  assert.equal(q.governing, false);
  assert.equal(m.writes(), 0, 'a pinned page writes nothing');
});


test('owned quality bindings distinguish repeated installations of the same instance', () => {
  const q = createQuality({ initialPreset: 'low' });
  const retireOld = bindAppQuality(q);
  const retireNew = bindAppQuality(q);
  retireOld();
  assert.equal(appQuality(), q);
  retireNew();
  assert.notEqual(appQuality(), q);
  retireOld(); retireNew();
  assert.notEqual(appQuality(), q);
});
