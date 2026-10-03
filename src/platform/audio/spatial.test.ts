// Spatial voice configuration (slices 1 and 2): panning and distance models, the audible cutoff, the HRTF voice limit,
// the filter stage and smoothed updates. A fake context records what the output writes; no audio is rendered here.
// The rendered-signal evidence is scripts/play/spatial-audio-check.mjs (OfflineAudioContext in a muted browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { audibleGain, createAudioOutput, CUTOFF_TIME_CONSTANT, distanceGain, FILTER_TIME_CONSTANT, type AudioOutputOptions } from './audio-output';
import { HEADPHONE_3D_SETTING, hrtfLimitFor, spatialAudioSettings, validateSpatialAudioOptions } from './module';
import { defineGame } from '../../author/defs';
import {must} from '../../testing/must';

type Call = [string, ...number[]];
function param(value = 0) {
  const calls: Call[] = [];
  return {
    calls,
    get value() { return value; }, set value(v: number) { value = v; calls.push(['value', v]); },
    cancelScheduledValues(t: number) { calls.push(['cancel', t]); },
    setTargetAtTime(v: number, t: number, tau: number) { calls.push(['target', v, t, tau]); value = v; },
    setValueAtTime(v: number, t: number) { calls.push(['at', v, t]); value = v; },
  };
}
type Param = ReturnType<typeof param>;
interface FakePanner { panningModel: string; distanceModel: string; refDistance: number; maxDistance: number; rolloffFactor: number; positionX: Param; positionY: Param; positionZ: Param; disconnected: boolean }
function fake(o: { legacyListener?: boolean } = {}) {
  const panners: FakePanner[] = [], filters: { type: string; frequency: Param; disconnected: boolean }[] = [], gains: { gain: Param; disconnected: boolean }[] = [];
  const sources: { onended: (() => void) | null }[] = [];
  const node = <T extends object>(n: T) => { const x = Object.assign(n, { disconnected: false, connect() {}, disconnect() { x.disconnected = true; } }); return x; };
  const listener = o.legacyListener ? { positions: [] as number[][], setPosition(...p: number[]) { this.positions.push(p); }, setOrientation() {} }
    : { positionX: param(), positionY: param(), positionZ: param(), forwardX: param(), forwardY: param(), forwardZ: param(-1), upX: param(), upY: param(1), upZ: param() };
  const ctx = {
    state: 'running', sampleRate: 48000, currentTime: 0, destination: {}, listener,
    createGain: () => { const g = node({ gain: param(1) }); gains.push(g); return g; },
    createPanner: () => { const p = node({ panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 1, maxDistance: 10000, rolloffFactor: 1, positionX: param(), positionY: param(), positionZ: param() }); panners.push(p); return p; },
    createBiquadFilter: () => { const f = node({ type: 'lowpass', frequency: param(350) }); filters.push(f); return f; },
    createBuffer: (_c: number, n: number) => ({ length: n, copyToChannel() {} }),
    createBufferSource: () => { const s = node({ onended: null as (() => void) | null, buffer: null, start() {}, stop() {} }); sources.push(s); return s; },
    resume: async () => {}, suspend: async () => {}, close: async () => {},
  };
  return { ctx, panners, filters, gains, sources, listener };
}
const output = (f: ReturnType<typeof fake>, extra: Partial<AudioOutputOptions> = {}) =>
  createAudioOutput({ silent: () => false, muted: () => false, effects: () => 1, music: () => 1, createContext: () => f.ctx as unknown as AudioContext, ...extra });

test('distance gains follow the Web Audio formulas; inverse and exponential never read maxDistance', () => {
  const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} vs ${b}`);
  // The mechanics template's former values: inverse, ref 4, rolloff .5, "maxDistance" 60, still 12.5% at 60 m.
  close(distanceGain('inverse', 60, { refDistance: 4, maxDistance: 60, rolloffFactor: .5 }), 4 / (4 + .5 * 56));
  close(distanceGain('inverse', 600, { refDistance: 4, maxDistance: 60, rolloffFactor: .5 }), 4 / (4 + .5 * 596));
  close(distanceGain('inverse', .5, { refDistance: 2 }), 1);
  close(distanceGain('exponential', 8, { refDistance: 2, rolloffFactor: 2 }), Math.pow(4, -2));
  close(distanceGain('exponential', 8, { refDistance: 2, maxDistance: 4, rolloffFactor: 2 }), Math.pow(4, -2));
  close(distanceGain('linear', 50, { refDistance: 10, maxDistance: 90 }), .5);
  close(distanceGain('linear', 200, { refDistance: 10, maxDistance: 90 }), 0);
  close(distanceGain('linear', 200, { refDistance: 10, maxDistance: 90, rolloffFactor: 5 }), 0);
  close(distanceGain('linear', 90, { refDistance: 10, maxDistance: 90, rolloffFactor: .25 }), .75);
  close(distanceGain('linear', 3, { refDistance: 5, maxDistance: 5, rolloffFactor: .4 }), .6);
  assert.throws(() => distanceGain('inverse', -1));
  // The cutoff silences any model; at exactly the cutoff the model's gain still applies.
  const shot = { position: [0, 0, -60] as const, refDistance: 4, rolloffFactor: .5, cutoffDistance: 60 };
  close(audibleGain(shot, [0, 0, 0]), .125);
  assert.equal(audibleGain(shot, [0, 0, 1]), 0);
});

test('defaults are unchanged: equal-power, inverse, ref 1, max 100, rolloff 1, no extra stages', () => {
  const f = fake(); const out = output(f);
  const voice = out.playVoice('ui.click', { spatial: { position: [1, 2, 3] } })!;
  const p = must(f.panners[0]);
  assert.deepEqual([p.panningModel, p.distanceModel, p.refDistance, p.maxDistance, p.rolloffFactor], ['equalpower', 'inverse', 1, 100, 1]);
  assert.equal(voice.panning, 'equalpower'); assert.equal(f.filters.length, 0);
  assert.equal(f.gains.length, 2, 'master and voice level only: no filter or cutoff gain');
  assert.deepEqual(p.positionX.calls, [['value', 1]], 'instant writes without smoothing');
  voice.setPosition!([4, 5, 6]); assert.deepEqual(p.positionX.calls, [['value', 1], ['value', 4]]);
  assert.equal(out.playVoice('ui.click')!.panning, null);
  assert.deepEqual({ ...out.stats }, { contexts: 1, played: 2, skipped: 0, downgraded: 0, culled: 0, active: 2, hrtfActive: 0, hrtfLimit: 8 });
  out.dispose();
});

test('panning and distance models are selectable per voice and validated with bounds', () => {
  const f = fake(); const out = output(f);
  const voice = out.playVoice('ui.click', { spatial: { position: [0, 0, -5], panning: 'HRTF', distanceModel: 'linear', refDistance: 2, maxDistance: 40, rolloffFactor: .7 } })!;
  const p = must(f.panners[0]);
  assert.deepEqual([p.panningModel, p.distanceModel, p.refDistance, p.maxDistance, p.rolloffFactor], ['HRTF', 'linear', 2, 40, .7]);
  assert.equal(voice.panning, 'HRTF');
  out.playVoice('ui.click', { spatial: { position: [0, 0, 0], distanceModel: 'exponential' } });
  assert.equal(must(f.panners[1]).distanceModel, 'exponential');
  const bad = [
    { panning: 'hrtf' }, { distanceModel: 'log' }, { refDistance: 0 }, { refDistance: 2e6, maxDistance: 3e6 }, { maxDistance: 2e6 },
    { refDistance: 5, maxDistance: 4 }, { rolloffFactor: -1 }, { rolloffFactor: 101 }, { rolloffFactor: NaN }, { cutoffDistance: .5 },
    { cutoffDistance: Infinity }, { smoothing: -.1 }, { smoothing: 2 }, { refDistance: '1' },
  ];
  for (const extra of bad) assert.throws(() => out.playVoice('ui.click', { spatial: { position: [0, 0, 0], ...extra } as never }), /invalid spatial cue/, JSON.stringify(extra));
  assert.equal(f.panners.length, 2, 'invalid requests allocate nothing');
  out.dispose();
});

test('HRTF voices are capped; requests beyond the cap play equal-power, never refused, and slots are released', () => {
  const f = fake(); const out = output(f, { maxHrtfVoices: 2 });
  const hrtf = { position: [0, 0, 1] as const, panning: 'HRTF' as const };
  const a = out.playVoice('ui.click', { spatial: hrtf })!, b = out.playVoice('ui.click', { spatial: hrtf })!, c = out.playVoice('ui.click', { spatial: hrtf })!;
  assert.deepEqual([a.panning, b.panning, c.panning], ['HRTF', 'HRTF', 'equalpower']);
  assert.deepEqual(f.panners.map(p => p.panningModel), ['HRTF', 'HRTF', 'equalpower']);
  assert.equal(out.stats.downgraded, 1); assert.equal(out.stats.hrtfActive, 2); assert.equal(out.stats.skipped, 0);
  a.stop(); assert.equal(out.stats.hrtfActive, 1);
  must(f.sources[1]).onended!(); assert.equal(out.stats.hrtfActive, 0, 'natural end releases the slot');
  assert.equal(out.playVoice('ui.click', { spatial: hrtf })!.panning, 'HRTF');
  out.dispose(); assert.equal(out.stats.hrtfActive, 0); assert.equal(out.stats.active, 0);
});

test('lowering the HRTF limit moves the newest HRTF voices to equal-power; 0 disables HRTF', () => {
  const f = fake(); const out = output(f, { maxHrtfVoices: 3, maxVoices: 4 });
  const hrtf = { position: [0, 0, 1] as const, panning: 'HRTF' as const };
  const voices = [0, 1, 2].map(() => out.playVoice('ui.click', { spatial: hrtf })!);
  out.setHrtfLimit(1);
  assert.deepEqual(voices.map(v => v.panning), ['HRTF', 'equalpower', 'equalpower']);
  assert.deepEqual(f.panners.map(p => p.panningModel), ['HRTF', 'equalpower', 'equalpower']);
  assert.equal(out.stats.downgraded, 2); assert.equal(out.stats.hrtfLimit, 1);
  out.setHrtfLimit(0); assert.equal(must(voices[0]).panning, 'equalpower');
  assert.equal(out.playVoice('ui.click', { spatial: hrtf })!.panning, 'equalpower');
  out.setHrtfLimit(3); assert.equal(must(voices[0]).panning, 'equalpower', 'raising affects later starts only');
  assert.throws(() => out.setHrtfLimit(5)); assert.throws(() => out.setHrtfLimit(-1)); assert.throws(() => out.setHrtfLimit(1.5));
  assert.throws(() => output(fake(), { maxVoices: 4, maxHrtfVoices: 5 })); assert.throws(() => output(fake(), { smoothing: 3 }));
  assert.equal(output(fake(), { maxVoices: 4 }).stats.hrtfLimit, 4);
  out.dispose();
});

test('positions accept arrays and typed arrays of three finite numbers, and are copied', () => {
  const f = fake(); const out = output(f);
  const at = new Float32Array([1, 2, 3]);
  const voice = out.playVoice('ui.click', { spatial: { position: at as unknown as readonly [number, number, number] } })!;
  at[0] = 9; assert.equal(must(f.panners[0]).positionX.value, 1);
  voice.setPosition!(new Float64Array([4, 5, 6]) as unknown as readonly [number, number, number]); assert.equal(must(f.panners[0]).positionX.value, 4);
  out.setListener(new Float32Array([0, 0, 0]) as never, new Float32Array([0, 0, -1]) as never, new Float32Array([0, 1, 0]) as never);
  for (const bad of [[1, 2], [1, 2, NaN], new Float32Array([1, 2, Infinity]), null]) assert.throws(() => voice.setPosition!(bad as never), /invalid audio position/);
  out.dispose();
});

test('a voice silenced by its cutoff yields its HRTF slot to a new request once the fade has run', () => {
  const f = fake(); const out = output(f, { maxHrtfVoices: 1 });
  const far = out.playVoice('ui.click', { spatial: { position: [0, 0, -10], panning: 'HRTF', cutoffDistance: 20 } })!;
  far.setPosition!([0, 0, -30]); // beyond: fading out from t = 0
  f.ctx.currentTime = CUTOFF_TIME_CONSTANT; // fade still running: the slot is kept
  assert.equal(out.playVoice('ui.click', { spatial: { position: [0, 0, -2], panning: 'HRTF' } })!.panning, 'equalpower');
  f.ctx.currentTime = 1;
  const near = out.playVoice('ui.click', { spatial: { position: [0, 0, -2], panning: 'HRTF' } })!;
  assert.equal(near.panning, 'HRTF'); assert.equal(far.panning, 'equalpower'); assert.equal(must(f.panners[0]).panningModel, 'equalpower');
  assert.equal(out.stats.hrtfActive, 1); assert.equal(out.stats.downgraded, 2, 'the refused request and the reclaimed voice');
  far.setPosition!([0, 0, -5]); assert.equal(far.panning, 'equalpower', 'a reclaimed voice returns in range with equal-power');
  out.dispose();
});

test('the audible cutoff refuses distant starts and silences a voice that leaves range, for any model', () => {
  for (const distanceModel of ['inverse', 'linear', 'exponential'] as const) {
    const f = fake(); const out = output(f);
    const spatial = { position: [0, 0, -61] as const, refDistance: 4, rolloffFactor: .5, cutoffDistance: 60, distanceModel };
    assert.equal(out.playVoice('ui.click', { spatial }), null);
    assert.equal(out.stats.culled, 1); assert.equal(out.stats.skipped, 0); assert.equal(f.sources.length, 0, 'no nodes for a culled start');
    const voice = out.playVoice('ui.click', { spatial: { ...spatial, position: [0, 0, -59] } })!;
    const gate = must(f.gains[2]); assert.equal(gate.gain.value, 1);
    voice.setPosition!([0, 0, -59.5]); assert.deepEqual(gate.gain.calls, [], 'still in range: no write');
    voice.setPosition!([0, 0, -80]);
    assert.deepEqual(gate.gain.calls, [['cancel', 0], ['target', 0, 0, CUTOFF_TIME_CONSTANT]]);
    out.setListener([0, 0, -30], [0, 0, -1], [0, 1, 0]);
    assert.deepEqual(gate.gain.calls.at(-1), ['target', 1, 0, CUTOFF_TIME_CONSTANT], 'the listener moving closer restores it');
    out.setListener([0, 0, 40], [0, 0, -1], [0, 1, 0]);
    assert.deepEqual(gate.gain.calls.at(-1), ['target', 0, 0, CUTOFF_TIME_CONSTANT]);
    voice.stop(); assert.equal(gate.disconnected, true); const writes = gate.gain.calls.length;
    out.setListener([0, 0, 0], [0, 0, -1], [0, 1, 0]); assert.equal(gate.gain.calls.length, writes, 'ended voices are not rechecked');
    out.dispose();
  }
});

test('the filter stage exists only on request and ramps without an instant path', () => {
  const f = fake(); const out = output(f);
  const plain = out.playVoice('ui.click', { spatial: { position: [0, 0, 0] } })!;
  assert.throws(() => plain.setFilter!({ cutoffHz: 800 }), /no filter stage/);
  const voice = out.playVoice('ui.click', { spatial: { position: [0, 0, -3] }, filter: { cutoffHz: 12000, gain: .9 } })!;
  const filter = must(f.filters[0]), muffle = f.gains.at(-1)!;
  assert.equal(filter.type, 'lowpass'); assert.equal(filter.frequency.value, 12000); assert.equal(muffle.gain.value, .9);
  f.ctx.currentTime = 1.5;
  voice.setFilter!({ cutoffHz: 900, gain: .4 });
  assert.deepEqual(filter.frequency.calls.slice(-2), [['cancel', 1.5], ['target', 900, 1.5, FILTER_TIME_CONSTANT.default]]);
  assert.deepEqual(muffle.gain.calls.slice(-2), [['cancel', 1.5], ['target', .4, 1.5, FILTER_TIME_CONSTANT.default]]);
  voice.setFilter!({ cutoffHz: 2000 }, .2); assert.deepEqual(muffle.gain.calls.at(-1), ['target', 1, 1.5, .2]);
  for (const [value, tau] of [[{ cutoffHz: 5 }, .03], [{ cutoffHz: 30000 }, .03], [{ cutoffHz: 800, gain: 2 }, .03], [{ cutoffHz: 800 }, 0], [{ cutoffHz: 800 }, .001], [{ cutoffHz: 800 }, 3]] as const)
    assert.throws(() => voice.setFilter!(value, tau), /invalid cue filter/);
  assert.throws(() => out.playVoice('ui.click', { filter: { cutoffHz: NaN } }), /invalid cue filter/);
  voice.stop(); assert.equal(filter.disconnected, true); assert.equal(muffle.disconnected, true);
  const calls = filter.frequency.calls.length; voice.setFilter!({ cutoffHz: 500 }); assert.equal(filter.frequency.calls.length, calls, 'ended voices ignore updates');
  plain.stop(); assert.doesNotThrow(() => plain.setFilter!({ cutoffHz: 800 }), 'an ended voice ignores setFilter even without a stage');
  assert.throws(() => plain.setFilter!({ cutoffHz: 1 }), /invalid cue filter/, 'arguments are still validated');
  assert.ok(out.playVoice('ui.click', { filter: { cutoffHz: 500 } }), 'a 2D voice can be filtered too');
  out.dispose();
});

test('smoothing ramps position and listener updates after an instant first write, and skips unchanged listeners', () => {
  const f = fake(); const out = output(f, { smoothing: .02 });
  out.setListener([0, 0, 0], [0, 0, -1], [0, 1, 0]);
  const voice = out.playVoice('ui.click', { spatial: { position: [1, 0, 0] } })!;
  const p = must(f.panners[0]), l = f.listener as { positionX: Param };
  assert.deepEqual(p.positionX.calls, [['value', 1]]); assert.deepEqual(l.positionX.calls, [['value', 0]], 'the first listener write is instant');
  f.ctx.currentTime = .5;
  voice.setPosition!([-1, 0, 0]); assert.deepEqual(p.positionX.calls.slice(1), [['cancel', .5], ['target', -1, .5, .02]]);
  out.setListener([2, 0, 0], [0, 0, -1], [0, 1, 0]); assert.deepEqual(l.positionX.calls.slice(1), [['cancel', .5], ['target', 2, .5, .02]]);
  const count = l.positionX.calls.length;
  out.setListener([2, 0, 0], [0, 0, -1], [0, 1, 0]); assert.equal(l.positionX.calls.length, count, 'unchanged listener: no writes');
  const fast = out.playVoice('ui.click', { spatial: { position: [0, 0, 0], smoothing: 0 } })!;
  fast.setPosition!([3, 0, 0]); assert.deepEqual(must(f.panners[1]).positionX.calls.at(-1), ['value', 3], 'per-voice 0 overrides the output');
  voice.setGain(.5); assert.deepEqual(must(f.gains[1]).gain.calls.at(-1), ['value', .5]);
  // Only changed parameters are written: a move along x leaves y and z alone; a listener turn leaves its position alone.
  const ys = p.positionY.calls.length; voice.setPosition!([-2, 0, 0]); assert.equal(p.positionY.calls.length, ys);
  const lx = l.positionX.calls.length; out.setListener([2, 0, 0], [1, 0, 0], [0, 1, 0]); assert.equal(l.positionX.calls.length, lx);
  assert.deepEqual((f.listener as { forwardX: Param }).forwardX.calls.at(-1), ['target', 1, .5, .02]);
  out.dispose();
  const legacy = fake({ legacyListener: true }); const old = output(legacy, { smoothing: .02 });
  old.setListener([1, 2, 3], [0, 0, -1], [0, 1, 0]); old.playVoice('ui.click', { spatial: { position: [0, 0, 0] } });
  old.setListener([4, 5, 6], [0, 0, -1], [0, 1, 0]);
  assert.deepEqual((legacy.listener as { positions: number[][] }).positions, [[1, 2, 3], [4, 5, 6]], 'no listener AudioParams: instant fallback');
  old.dispose();
});

test('creator spatial options: HRTF limits per quality preset, validation, and the optional headphone setting row', () => {
  const options = { hrtf: { maxVoices: 8, ports: { medium: { maxVoices: 2 }, low: { maxVoices: 0 } } } };
  assert.deepEqual(['reference', 'high', 'medium', 'low'].map(p => hrtfLimitFor(options, p as never)), [8, 8, 2, 0]);
  assert.equal(hrtfLimitFor(undefined, 'low'), 8);
  // A preset without its own port falls back to the next heavier port, as budgets do (low → medium → high → reference).
  const mediumOnly = { hrtf: { maxVoices: 8, ports: { medium: { maxVoices: 2 } } } };
  assert.deepEqual(['reference', 'high', 'medium', 'low'].map(p => hrtfLimitFor(mediumOnly, p as never)), [8, 8, 2, 2]);
  const highOnly = { hrtf: { maxVoices: 8, ports: { high: { maxVoices: 4 } } } };
  assert.deepEqual(['reference', 'high', 'medium', 'low'].map(p => hrtfLimitFor(highOnly, p as never)), [8, 4, 4, 4]);
  for (const bad of [{ hrtf: { maxVoices: -1 } }, { hrtf: { maxVoices: 65 } }, { hrtf: { maxVoices: 2, ports: { low: { maxVoices: 1.5 } } } }, { hrtf: { maxVoices: 2, ports: { ultra: { maxVoices: 1 } } } }, { smoothing: 2 }])
    assert.throws(() => validateSpatialAudioOptions(bad as never));
  assert.deepEqual(spatialAudioSettings(undefined), []); assert.deepEqual(spatialAudioSettings({ headphoneSetting: true }), [HEADPHONE_3D_SETTING]);
  assert.equal(HEADPHONE_3D_SETTING.default, true);
  assert.throws(() => defineGame({ id: 'demo', title: 'Demo', version: '1.0.0', firstScene: 'start', audio: { smoothing: -1 } }));
  assert.equal(defineGame({ id: 'demo', title: 'Demo', version: '1.0.0', firstScene: 'start', audio: options }).audio, options);
});
