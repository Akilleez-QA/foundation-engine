import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS, coreKnobs, createKnobRegistry, createQuality, detectPreset, knobProblems, pixelRatio, readDeviceSignals,
  resolveKnobs, textureVariant, ResolutionGovernor, graphicsSettingsSection, defaultGraphicsSettings, shadowMapFor,
  type DeviceSignals, type GraphicsChoiceStore, type GraphicsSettings, type KnobDef, type QualityChange, type QualityPreset,
} from './quality';
import {must} from '../../testing/must';

// Fake effects augment the knob map exactly as a real effect module would.
declare module './quality-knobs' {
  interface GraphicsKnobs {
    'test.fake-clouds': 'map-only' | 'shell' | 'raymarch';
    'test.fake-scatter': number;
  }
}
const fakeClouds: KnobDef<'test.fake-clouds'> = {
  id: 'test.fake-clouds', group: 'clouds', label: 'graphics.test.clouds', owner: 'test.fake-clouds-effect',
  control: { kind: 'choice', options: ['map-only', 'shell', 'raymarch'] },
  presets: { reference: 'raymarch', high: 'shell', medium: 'shell', low: 'map-only' },
  applies: 'live', cost: v => ({ 'map-only': 0.02, shell: 0.1, raymarch: 1 })[v],
};
const fakeScatter: KnobDef<'test.fake-scatter'> = {
  id: 'test.fake-scatter', group: 'terrain', label: 'graphics.test.scatter', owner: 'test.fake-scatter-effect',
  control: { kind: 'range', min: 0, max: 1, step: 0.05 },
  presets: { reference: 1, high: 0.75, medium: 0.5, low: 0.25 },
  floor: { value: 0.25, reason: 'scatter density ≥ 0.25' }, applies: 'reenter-scene',
};

function memoryStore(initial?: GraphicsSettings): GraphicsChoiceStore & { value?: GraphicsSettings | undefined; writes: number } {
  const s = { value: initial, writes: 0, read: () => s.value && structuredClone(s.value), write(next: GraphicsSettings) { s.writes++; s.value = structuredClone(next); } };
  return s;
}
const RTX4080: DeviceSignals = { coarsePointer: false, deviceMemory: 8, cores: 32, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', maxTextureSize: 16384 };
const PHONE: DeviceSignals = { coarsePointer: true, deviceMemory: 4, cores: 8, gpu: 'Adreno (TM) 740', maxTextureSize: 8192 };
const SWIFTSHADER: DeviceSignals = { coarsePointer: false, gpu: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', maxTextureSize: 8192 };

test('presets resolve: every core knob is legal for all four presets and reference is the design bar', () => {
  assert.deepEqual(PRESETS, ['reference', 'high', 'medium', 'low']);
  assert.deepEqual(knobProblems(coreKnobs as never), []);
  assert.equal(coreKnobs.length, 12);
  for (const preset of PRESETS) {
    const r = resolveKnobs(coreKnobs as never, { preset, overrides: {}, governor: false });
    assert.equal(r.preset, preset);
    for (const d of coreKnobs) assert.equal(r.get(d.id), d.presets[preset], `${d.id} @ ${preset}`);
  }
  const ref = createQuality({ pinned: 'reference', devicePixelRatio: () => 2 });
  assert.equal(ref.knob('shadows.quality'), 'ultra');
  assert.equal(ref.knob('textures.max-size'), 8192);
  assert.equal(ref.shadowMapSize(2048), 2048, 'reference never shrinks a requested map');
  const low = createQuality({ pinned: 'low', devicePixelRatio: () => 3 });
  assert.equal(low.shadowMapSize(2048), 1024);
  assert.equal(low.pixelRatio(1.5), 0.85);
  assert.equal(graphicsSettingsSection.initial(), null, 'no choice until detection or the player');
  assert.equal(defaultGraphicsSettings().preset, 'reference');
  assert.equal(graphicsSettingsSection.scope, 'device');
  assert.equal(graphicsSettingsSection.export, false);
});

test('reference pixelRatio equals today’s desktop renderPixelRatio(max) at every activity ceiling', () => {
  for (const dpr of [0.8, 1, 1.25, 4 / 3, 1.5, 2, 3]) for (const max of [1.25, 1.5, 1.6, 1.7, 1.75, 2]) {
    const q = createQuality({ pinned: 'reference', devicePixelRatio: () => dpr });
    assert.equal(q.pixelRatio(max), Math.min(dpr, max), `dpr ${dpr} max ${max}`);
  }
  // Today's coarse-pointer cap of 1.5 is the medium preset's ceiling.
  const medium = createQuality({ pinned: 'medium', devicePixelRatio: () => 3 });
  assert.equal(medium.pixelRatio(1.75), 1.5);
  assert.equal(pixelRatio(NaN, { maxPixelRatio: 2, scale: 1 }), 1);
});

test('detection picks the first preset from hardware, with reasons; weakness is only a suggestion', () => {
  assert.equal(detectPreset(RTX4080).preset, 'reference');
  assert.match(detectPreset(RTX4080).reasons.join(' '), /RTX 4080/);
  assert.equal(detectPreset({ ...RTX4080, cores: 4 }).preset, 'high');
  assert.equal(detectPreset(PHONE).preset, 'high');
  assert.deepEqual(detectPreset(PHONE).reasons, ['GPU Adreno (TM) 740', '4 GB memory']);
  assert.equal(detectPreset(PHONE).suggested, 'medium');
  assert.deepEqual(detectPreset(SWIFTSHADER), { preset: 'high', reasons: ['GPU ' + SWIFTSHADER.gpu, `software GL (${SWIFTSHADER.gpu})`], softwareGl: true, suggested: 'low', suggestedReasons: [`software GL (${SWIFTSHADER.gpu})`] });
  assert.deepEqual(detectPreset({ ...RTX4080, deviceMemory: 2 }), { preset: 'high', reasons: ['GPU ' + RTX4080.gpu, '2 GB memory'], softwareGl: false, suggested: 'low', suggestedReasons: ['2 GB memory'] });
  assert.equal(detectPreset({ coarsePointer: false, maxTextureSize: 16384 }).preset, 'high');
  const mali = detectPreset({ ...PHONE, gpu: 'Mali-G57 MC2' });
  assert.equal(mali.preset, 'high'); assert.equal(mali.suggested, 'low');
  assert.equal(detectPreset({ coarsePointer: false, cores: 8, deviceMemory: 4, maxTextureSize: 16384 }).suggested, 'medium');
});

// ADR 0070 replaces the historical touch cap; requested and preset ceilings still apply.

test('detection preserves requested ceilings regardless of pointer; Low remains a player choice', () => {
  const table: [string, DeviceSignals, QualityPreset][] = [
    ['reference desktop (RTX 4080, 32 cores)', RTX4080, 'reference'],
    ['desktop, 4 cores', { ...RTX4080, cores: 4 }, 'high'],
    ['desktop, GPU not reported', { coarsePointer: false, maxTextureSize: 16384 }, 'high'],
    ['reference desktop, 4 GB memory', { ...RTX4080, deviceMemory: 4 }, 'reference'],
    ['reference desktop, data saver', { ...RTX4080, saveData: true }, 'reference'],
    ['desktop, software GL', SWIFTSHADER, 'high'],
    ['desktop, entry-level GPU', { coarsePointer: false, cores: 4, gpu: 'Intel(R) HD Graphics 4000', maxTextureSize: 8192 }, 'high'],
    ['desktop, texture limit 2048', { coarsePointer: false, gpu: 'VideoCore IV', maxTextureSize: 2048 }, 'high'],
    ['desktop, 2 GB memory', { ...RTX4080, deviceMemory: 2 }, 'high'],
    ['touch reference-class tablet', { ...RTX4080, coarsePointer: true }, 'reference'],
    ['phone, 4 GB', PHONE, 'high'],
    ['phone, entry-level GPU, 2 GB', { coarsePointer: true, deviceMemory: 2, cores: 4, gpu: 'Mali-G52', maxTextureSize: 4096 }, 'high'],
    ['touch, software GL', { ...SWIFTSHADER, coarsePointer: true }, 'high'],
  ];
  for (const [name, signals, expected] of table) {
    const d = detectPreset(signals);
    assert.equal(d.preset, expected, name);
    assert.notEqual(d.preset, 'low', name);
    for (const dpr of [1, 1.25, 1.5, 2, 3]) for (const max of [1.25, 1.5, 1.6, 1.7, 1.75, 2]) {
      const q = createQuality({ signals: () => signals, devicePixelRatio: () => dpr });
      assert.equal(q.preset, expected, name);
      assert.equal(q.pixelRatio(max), Math.min(dpr, max), `${name}: dpr ${dpr} max ${max}`);
    }
  }
});

test('the probe reads an injected environment only', () => {
  const gl = { MAX_TEXTURE_SIZE: 0x0d33, getExtension: (n: string) => n === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null,
    getParameter: (p: number) => p === 0x9246 ? 'NVIDIA GeForce RTX 4080' : p === 0x0d33 ? 16384 : null };
  const s = readDeviceSignals({ gl, matchMedia: q => ({ matches: q === '(any-pointer: coarse)' }), navigator: { deviceMemory: 8, hardwareConcurrency: 32, connection: { saveData: false } } });
  assert.deepEqual(s, { coarsePointer: true, deviceMemory: 8, cores: 32, saveData: undefined, gpu: 'NVIDIA GeForce RTX 4080', maxTextureSize: 16384 });
  assert.deepEqual(readDeviceSignals({}), { coarsePointer: false, deviceMemory: undefined, cores: undefined, saveData: undefined, gpu: undefined, maxTextureSize: 4096 });
});

test('first run: detection picks the preset once, records reasons, and saves it', () => {
  const store = memoryStore();
  let probes = 0;
  const q = createQuality({ store, signals: () => { probes++; return PHONE; }, build: 'b1' });
  assert.equal(q.preset, 'high');
  assert.equal(q.source, 'detected');
  assert.equal(probes, 1);
  assert.deepEqual(store.value, { preset: 'high', overrides: {}, governor: false, detected: { preset: 'high', reasons: ['GPU Adreno (TM) 740', '4 GB memory'], build: 'b1', suggested: 'medium' } });
  // A later run with the same saved section never probes again.
  const again = createQuality({ store, signals: () => { probes++; return RTX4080; } });
  assert.equal(again.preset, 'high');
  assert.equal(probes, 1);
  // No probe and nothing saved: reference, and nothing written.
  const empty = memoryStore();
  const def = createQuality({ store: empty });
  assert.equal(def.preset, 'reference');
  assert.equal(def.source, 'default');
  assert.equal(empty.writes, 0);
});

test('the player’s choice beats detection, on every later run and after a device change', () => {
  const store = memoryStore();
  const first = createQuality({ store, signals: () => PHONE });
  assert.equal(first.preset, 'high');
  first.setPreset('reference');
  first.setKnob('shadows.quality', 'high');
  assert.equal(first.source, 'player');
  assert.equal(store.value!.preset, 'reference');
  assert.equal(store.value!.detected!.preset, 'high', 'detection reasons are kept for the screen');

  let probed = false;
  for (const signals of [PHONE, SWIFTSHADER, RTX4080]) {
    const q = createQuality({ store, signals: () => { probed = true; return signals; } });
    assert.equal(q.preset, 'reference');
    assert.equal(q.source, 'player');
    assert.equal(q.knob('shadows.quality'), 'high');
  }
  assert.equal(probed, false, 'detection never runs over a saved choice');

  // A player who picked Low on a reference machine stays on Low.
  const low = memoryStore({ preset: 'low', overrides: {}, governor: false, detected: { preset: 'reference', reasons: ['reference-class GPU'], build: '' } });
  assert.equal(createQuality({ store: low, signals: () => RTX4080 }).preset, 'low');
});

test('overrides: legal only, floors respected, setPreset clears them, stale overrides fall back', () => {
  const registry = createKnobRegistry();
  registry.add(fakeScatter);
  const store = memoryStore();
  const q = createQuality({ registry, store });
  assert.throws(() => q.setKnob('textures.max-size', 3000 as never), /illegal/);
  assert.throws(() => q.setKnob('test.fake-scatter', 0.1), /content floor/);
  q.setKnob('shadows.quality', 'off');                               // a floor the player may cross
  assert.equal(q.shadowMapSize(2048), 0);
  q.setKnob('shadows.quality', 'ultra');                             // back to the preset value: no override kept
  assert.deepEqual(store.value!.overrides, {});
  q.setKnob('post.mode', 'basic');
  q.setPreset('high');
  assert.deepEqual(q.settings.overrides, {});
  assert.equal(q.knob('post.mode'), 'full');
  // A saved override that is no longer legal (or crosses a hard floor) resolves to the preset value.
  const stale = createQuality({ registry, store: memoryStore({ preset: 'reference', overrides: { 'textures.max-size': 16384 as never, 'test.fake-scatter': 0.1 }, governor: false }) });
  assert.equal(stale.knob('textures.max-size'), 8192);
  assert.equal(stale.knob('test.fake-scatter'), 1);
  // A corrupt preset falls back to reference.
  assert.equal(createQuality({ store: memoryStore({ preset: 'ultra' as never, overrides: null as never, governor: false }) }).preset, 'reference');
});

test('knobs registered by fake effects appear in the resolved profile and on the screen list', () => {
  const registry = createKnobRegistry();
  const q = createQuality({ registry, store: memoryStore({ preset: 'medium', overrides: {}, governor: false }) });
  assert.throws(() => q.knob('test.fake-clouds'), /not registered/);
  registry.add(fakeClouds);                                          // an effect registering after the service exists
  registry.add(fakeScatter);
  const r = q.resolved();
  assert.equal(r.get('test.fake-clouds'), 'shell');
  assert.equal(r.get('test.fake-scatter'), 0.5);
  assert.equal(r.values.size, coreKnobs.length + 2);
  assert.equal(q.knob('test.fake-clouds'), 'shell');
  q.setPreset('reference');
  assert.equal(q.knob('test.fake-clouds'), 'raymarch');
  q.setKnob('test.fake-clouds', 'map-only');
  assert.equal(q.resolved().get('test.fake-clouds'), 'map-only');
  assert.equal(q.resolved().get('test.fake-scatter'), 1, 'an override moves only its own knob');
  // Screen order: group order, then registration order.
  const ids = q.knobs().map(d => d.id);
  assert.ok(ids.indexOf('shadows.quality') < ids.indexOf('test.fake-clouds'));
  assert.ok(ids.indexOf('test.fake-clouds') < ids.indexOf('test.fake-scatter'));
  assert.ok(ids.indexOf('test.fake-scatter') < ids.indexOf('textures.max-size'));
});

test('the registry rejects duplicates, missing presets and preset values below a content floor', () => {
  const registry = createKnobRegistry();
  registry.add(fakeClouds);
  assert.throws(() => registry.add(fakeClouds), /already registered by test.fake-clouds-effect/);
  const r2 = createKnobRegistry([]);
  assert.throws(() => r2.add({ ...fakeScatter, presets: { ...fakeScatter.presets, low: 0.1 } }), /crosses the content floor/);
  assert.throws(() => r2.add({ ...fakeScatter, presets: { reference: 1, high: 1, medium: 1 } as never }), /no value for preset low/);
  assert.throws(() => r2.add({ ...fakeClouds, presets: { ...fakeClouds.presets, high: 'cirrus' as never } }), /not a legal option/);
  assert.equal(r2.list().length, 0);
});

test('changes are announced with how they apply; unsubscribe by signal', () => {
  const q = createQuality({ store: memoryStore() });
  const seen: QualityChange[] = [];
  const ac = new AbortController();
  q.subscribe(c => seen.push(c), ac.signal);
  q.setKnob('textures.anisotropy', 4);
  q.setPreset('medium');                                             // antialias unchanged; live-contexts changes → next-context
  ac.abort();
  q.setPreset('low');
  assert.deepEqual(seen, [{ knob: 'textures.anisotropy', applies: 'reenter-scene' }, { preset: 'medium', applies: 'next-context' }]);
});

const slowFrame = (i: number) => ({ intervalMs: 40, rendered: true, hidden: false, sinceEnterMs: 5000 + i * 40, draws: 10, triangles: 100 });
const fastFrame = (i: number) => ({ ...slowFrame(i), intervalMs: 8 });

test('the governor stays off unless enabled', () => {
  const store = memoryStore();
  const q = createQuality({ store, signals: () => RTX4080, devicePixelRatio: () => 2 });
  assert.equal(q.settings.governor, false);
  assert.equal(q.governing, false);
  const changes: QualityChange[] = [];
  q.subscribe(c => changes.push(c));
  for (let i = 0; i < 600; i++) q.frame(slowFrame(i));             // ten slow windows
  assert.equal(q.pixelRatio(2), 2, 'no runtime change while off');
  assert.deepEqual(changes, []);
  assert.equal(q.stats().p50Ms, 40);

  const writesBefore = store.writes;
  q.setGovernor(true);
  assert.equal(store.writes, writesBefore + 1, 'the toggle itself is the player’s choice');
  for (let i = 0; i < 120; i++) q.frame(slowFrame(i));
  assert.equal(q.pixelRatio(2), 2 * 0.85, 'moves only the runtime resolution scale');
  assert.equal(q.knob('resolution.scale'), 1, 'never writes the player’s scale');
  assert.equal(store.writes, writesBefore + 1, 'governor steps never write settings');
  assert.deepEqual(changes, [{ knob: 'resolution.scale', applies: 'live', runtime: true }]);
  for (let i = 0; i < 1200; i++) q.frame(slowFrame(i));
  assert.equal(q.pixelRatio(2), 2 * 0.6, 'floored at 0.6');
  q.setGovernor(false);
  assert.equal(q.pixelRatio(2), 2, 'turning it off restores the player’s scale');

  // Pinned (gate or bench): the governor never runs, even if asked.
  const pinned = createQuality({ pinned: 'reference', devicePixelRatio: () => 2 });
  pinned.setGovernor(true);
  assert.equal(pinned.governing, false);
  for (let i = 0; i < 600; i++) pinned.frame(slowFrame(i));
  assert.equal(pinned.pixelRatio(2), 2);
});

test('governor unit: ignores idle, hidden and warm-up frames; steps up with hysteresis to the player’s ceiling', () => {
  const g = new ResolutionGovernor(0.9, 16.7);
  for (let i = 0; i < 600; i++) assert.equal(g.sample({ intervalMs: 40, rendered: false, hidden: false, sinceEnterMs: 9999 }), null);
  for (let i = 0; i < 600; i++) assert.equal(g.sample({ intervalMs: 40, rendered: true, hidden: true, sinceEnterMs: 9999 }), null);
  for (let i = 0; i < 600; i++) assert.equal(g.sample({ intervalMs: 40, rendered: true, hidden: false, sinceEnterMs: 1000 }), null);
  assert.equal(g.scale, 0.9);
  for (let i = 0; i < 60; i++) g.sample(slowFrame(i));
  assert.equal(g.scale, 0.9, 'one slow window is not enough');
  for (let i = 0; i < 60; i++) g.sample(slowFrame(i));
  assert.equal(g.scale, 0.765);
  for (let i = 0; i < 60 * 4; i++) g.sample(fastFrame(i));
  assert.equal(g.scale, 0.765, 'four fast windows are not enough');
  for (let i = 0; i < 60; i++) g.sample(fastFrame(i));
  assert.equal(g.scale, 0.842);
  for (let i = 0; i < 60 * 20; i++) g.sample(fastFrame(i));
  assert.equal(g.scale, 0.9, 'never above the player’s scale');
});

test('textureVariant: screen-size rule under the device ceiling', () => {
  assert.equal(textureVariant(8192, [1024, 2048, 4096, 8192]), 8192);
  assert.equal(textureVariant(4096, [1024, 2048, 4096, 8192]), 4096);
  assert.equal(textureVariant(8192, [1024, 2048, 4096, 8192], 300), 1024);
  assert.equal(textureVariant(8192, [1024, 2048, 4096, 8192], 900), 2048);
  assert.equal(textureVariant(1024, [2048, 4096]), 2048, 'the smallest variant when all exceed the ceiling');
  const q = createQuality({ pinned: 'medium' });
  assert.equal(q.textureVariant([1024, 2048, 4096, 8192]), 2048);
});

// ------------------------------------------------------------------------------------------------ contract tests
// Contract tests over the quality API: DeviceSignals carries no
// cssPixels or dpr, `pixelRatio` takes (dpr, knobs, activityMax), and `resolveKnobs` returns a ResolvedQuality.

test('proof: detection picks only the first preset; the reference machine gets Reference', () => {
  assert.equal(detectPreset({ coarsePointer: false, cores: 32, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', maxTextureSize: 32768 }).preset, 'reference');
  assert.equal(detectPreset({ coarsePointer: false, cores: 8, gpu: 'Apple M1', maxTextureSize: 16384 }).preset, 'high');
  assert.equal(detectPreset({ coarsePointer: true, cores: 6, gpu: 'Apple GPU', maxTextureSize: 16384 }).preset, 'high');
  assert.equal(detectPreset({ coarsePointer: false, gpu: 'Google SwiftShader', maxTextureSize: 8192 }).preset, 'high');
  assert.equal(detectPreset({ coarsePointer: false, gpu: 'Google SwiftShader', maxTextureSize: 8192 }).suggested, 'low');
});

test('proof: knob registry: every preset value is legal; overrides win; illegal overrides fall back to the preset', () => {
  assert.deepEqual(knobProblems(coreKnobs as never), []);
  const k = resolveKnobs(coreKnobs as never, { preset: 'medium', overrides: { 'shadows.quality': 'ultra', 'textures.max-size': 777 as never }, governor: false });
  assert.equal(k.get('shadows.quality'), 'ultra');
  assert.equal(k.get('textures.max-size'), 2048);
  const bad = { ...coreKnobs[0], id: 'resolution.scale', presets: { reference: 1, high: 1, medium: 1, low: 2 } } as KnobDef<'resolution.scale'>;
  assert.match(must(knobProblems([bad as never])[0]), /preset low/);
  assert.equal(shadowMapFor('ultra'), 4096);
});

test('proof: pixel ratio and texture variants', () => {
  assert.equal(pixelRatio(1.5, { maxPixelRatio: 2, scale: 1 }), 1.5);
  assert.equal(pixelRatio(3, { maxPixelRatio: 2, scale: 0.75 }, 1.5), 1.125);
  assert.equal(textureVariant(4096, [256, 512, 1024, 2048, 4096], 33 * 3.14), 256);   // a 33 px sphere far away
  assert.equal(textureVariant(2048, [256, 512, 1024, 2048, 4096]), 2048);
});

test('proof: governor (opt-in): moves only the runtime scale, ignores idle and warm-up frames, recovers with hysteresis', () => {
  const g = new ResolutionGovernor(1, 16.7);
  const feed = (ms: number, n: number, rendered = true) => { let last: number | null = null; for (let i = 0; i < n; i++) { const r = g.sample({ intervalMs: ms, rendered, hidden: false, sinceEnterMs: 5000 }); if (r !== null) last = r; } return last; };
  assert.equal(feed(40, 600, false), null, 'idle frames are not samples');
  assert.equal(feed(30, 60), null, 'one slow window is not enough');
  assert.equal(feed(30, 60), 0.85);
  for (let i = 0; i < 20; i++) feed(30, 120);
  assert.equal(g.scale, 0.6, 'floor');
  let up: number | null = null; for (let i = 0; i < 5; i++) up = feed(8, 60) ?? up;
  assert.equal(up, 0.66);
});


test('pointer capability cannot change quality or suggestions on identical hardware', () => {
  for (const signals of [RTX4080, PHONE, SWIFTSHADER, { maxTextureSize: 4096, coarsePointer: false }]) {
    assert.deepEqual(detectPreset({ ...signals, coarsePointer: true }), detectPreset({ ...signals, coarsePointer: false }));
  }
});

test('legacy detected touch preset is preserved without probing or rewriting saved settings', () => {
  const saved: GraphicsSettings = { preset: 'medium', overrides: {}, governor: false,
    detected: { preset: 'medium', reasons: ['touch device'], build: 'legacy' } };
  const store = memoryStore(saved);
  const q = createQuality({ store, signals: () => { throw Error('must not probe'); } });
  assert.equal(q.preset, 'medium');
  assert.deepEqual(store.value, saved);
  assert.equal(store.writes, 0);
});

test('authored startup preset is unsaved, skips detection, and yields to saved or pinned choices', () => {
  const store = memoryStore();
  const signals = () => { throw Error('authored startup must not probe'); };
  const authored = createQuality({ initialPreset: 'low', store, signals });
  assert.equal(authored.preset, 'low');
  assert.equal(authored.source, 'default');
  assert.equal(store.writes, 0);
  authored.setPreset('medium');
  assert.equal(store.writes, 1);
  assert.equal(createQuality({ initialPreset: 'reference', store, signals }).preset, 'medium');
  assert.equal(createQuality({ initialPreset: 'low', pinned: 'high', store, signals }).preset, 'high');
  assert.throws(() => createQuality({ initialPreset: 'invalid' as never }), /authored quality/);
});
