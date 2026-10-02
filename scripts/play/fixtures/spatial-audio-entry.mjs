// Spatial audio evidence: the real output (src/platform/audio/audio-output.ts) drives OfflineAudioContexts, which
// render into memory faster than real time and never reach an audio device. The page is opened in the muted test
// browser; no real-time AudioContext is created here. Results are numbers for scripts/play/spatial-audio-check.mjs.
//
// This proves configuration and signal behaviour (models, gains, cutoff, HRTF limit, ramps). It does not prove that
// listeners localise sounds correctly: that needs human headphone trials.
import {createAudioOutput, distanceGain} from '../../../src/platform/audio/audio-output.ts';

const RATE = 48000, BLOCK = 128;
const tone = (hz, duration = 1, gain = .5) => ({id: 'test.tone', duration, steps: [{tone: {at: 0, duration, hz, gain}}]});
// Broadband, deterministic (seeded) noise: pinna cues are spectral, so front/back differences need a wide spectrum.
const noise = (duration = 1) => ({id: 'test.tone', duration, steps: [{air: {at: 0, duration, cutoff: 16000, gain: .9}}]});

async function render({seconds = 1, cue = tone(1000), options = {}, setup, events = []}) {
  const ctx = new OfflineAudioContext(2, Math.round(seconds * RATE), RATE);
  // The output plays only on a running context; an offline context reports 'suspended' until it renders.
  Object.defineProperty(ctx, 'state', {get: () => 'running'});
  ctx.close = async () => {};
  const created = {panners: [], filters: []};
  const panner = ctx.createPanner.bind(ctx), filter = ctx.createBiquadFilter.bind(ctx);
  ctx.createPanner = () => { const n = panner(); created.panners.push(n); return n; };
  ctx.createBiquadFilter = () => { const n = filter(); created.filters.push(n); return n; };
  const out = createAudioOutput({silent: () => false, muted: () => false, effects: () => 1, music: () => 1, cues: [cue], createContext: () => ctx, report: () => {}, ...options});
  const state = setup(out);
  for (const [time, fn] of events) void ctx.suspend(time).then(() => { fn(out, state); return ctx.resume(); });
  const buffer = await ctx.startRendering();
  return {L: buffer.getChannelData(0), R: buffer.getChannelData(1), out, state, created};
}
const rms = (data, t0, t1) => { let s = 0; const a = Math.round(t0 * RATE), b = Math.round(t1 * RATE); for (let i = a; i < b; i++) s += data[i] * data[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const diffRms = (x, y, t0, t1) => { let s = 0; const a = Math.round(t0 * RATE), b = Math.round(t1 * RATE); for (let i = a; i < b; i++) s += (x[i] - y[i]) ** 2; return Math.sqrt(s / Math.max(1, b - a)); };
// A floor keeps exact silence in one channel finite (equal-power at 90 degrees is exactly 0 on the far side).
const db = (a, b) => 20 * Math.log10((a + 1e-12) / (b + 1e-12));

/** One spatial voice at `position` with the default listener (origin, facing -Z). */
const place = (position, spatial = {}, options = {}, cue = noise()) => render({cue, options, setup: out => out.playVoice('test.tone', {spatial: {position, ...spatial}})});

async function panning() {
  const W = [.3, .9];
  const result = {};
  for (const [name, spatial, options] of [['equalpower', {}, {}], ['HRTF', {panning: 'HRTF'}, {}], ['HRTF limit 0', {panning: 'HRTF'}, {maxHrtfVoices: 0}]]) {
    const front = await place([0, 0, -3], spatial, options), back = await place([0, 0, 3], spatial, options);
    const up = await place([0, 3, -.001], spatial, options), level = await place([0, 0, -3], spatial, options);
    const left = await place([-3, 0, 0], spatial, options);
    result[name] = {
      models: front.created.panners.map(p => p.panningModel), downgraded: front.out.stats.downgraded,
      frontRms: rms(front.L, ...W), frontBackDiff: (diffRms(front.L, back.L, ...W) + diffRms(front.R, back.R, ...W)) / (rms(front.L, ...W) + rms(front.R, ...W)),
      elevationDiff: (diffRms(up.L, level.L, ...W) + diffRms(up.R, level.R, ...W)) / (rms(level.L, ...W) + rms(level.R, ...W)),
      leftOverRightDb: db(rms(left.L, ...W), rms(left.R, ...W)),
    };
  }
  return result;
}

async function selection() {
  const r = await render({options: {maxHrtfVoices: 1}, setup: out => [1, 2, 3].map(() => out.playVoice('test.tone', {spatial: {position: [0, 0, -2], panning: 'HRTF'}}).panning)});
  return {voices: r.state, nodes: r.created.panners.map(p => p.panningModel), downgraded: r.out.stats.downgraded, refused: r.out.stats.skipped};
}

async function distance() {
  const rows = [];
  for (const [model, spatial] of [['inverse', {refDistance: 2, maxDistance: 40, rolloffFactor: 1}], ['linear', {refDistance: 2, maxDistance: 40, rolloffFactor: 1}], ['exponential', {refDistance: 2, maxDistance: 40, rolloffFactor: 1.5}]]) {
    const reference = rms((await place([0, 0, -2], {...spatial, distanceModel: model}, {}, tone(1000))).L, .2, .8);
    for (const d of [5, 20, 39, 60]) {
      const measured = rms((await place([0, 0, -d], {...spatial, distanceModel: model}, {}, tone(1000))).L, .2, .8) / reference;
      rows.push({model, distance: d, measured, expected: distanceGain(model, d, spatial)});
    }
  }
  return rows;
}

async function cutoff() {
  const spatial = {refDistance: 4, rolloffFactor: .5, cutoffDistance: 60};
  let culled = null;
  const r = await render({cue: tone(1000, 1), setup: out => {
    culled = {voice: out.playVoice('test.tone', {spatial: {...spatial, position: [0, 0, -61]}}), culled: out.stats.culled};
    return out.playVoice('test.tone', {spatial: {...spatial, position: [0, 0, -59]}});
  }, events: [[.25, (out, voice) => voice.setPosition([0, 0, -80])], [.55, out => out.setListener([0, 0, -30], [0, 0, -1], [0, 1, 0])]]});
  return {culledVoice: culled.voice, culled: culled.culled, before: rms(r.L, .05, .25), beyond: rms(r.L, .35, .55), back: rms(r.L, .65, .9), expectedBack: rms(r.L, .05, .25) * distanceGain('inverse', 50, spatial) / distanceGain('inverse', 59, spatial)};
}

async function filter() {
  const r = await render({cue: tone(3000, 1), setup: out => out.playVoice('test.tone', {filter: {cutoffHz: 20000, gain: 1}}),
    events: [[.3, (out, voice) => voice.setFilter({cutoffHz: 375, gain: .5}, .02)]]});
  const blocks = [];
  for (let t = .3; t < .45; t += BLOCK / RATE) blocks.push(rms(r.L, t, t + BLOCK / RATE));
  let worst = 0; for (let i = 1; i < blocks.length; i++) worst = Math.max(worst, Math.abs(db(blocks[i], blocks[i - 1])));
  return {frequencyAfter: r.created.filters[0].frequency.value, type: r.created.filters[0].type, attenuationDb: db(rms(r.L, .1, .3), rms(r.L, .6, .9)), worstBlockStepDb: worst};
}

async function smoothing() {
  const run = async smoothing => {
    const r = await render({cue: tone(1000, 1), options: {smoothing}, setup: out => out.playVoice('test.tone', {spatial: {position: [5, 0, 0]}}),
      events: [[.3, (out, voice) => voice.setPosition([-5, 0, 0])]]});
    const first = [.3 + BLOCK / RATE, .3 + 2 * BLOCK / RATE];
    return {firstBlockRightOverLeftDb: db(rms(r.R, ...first), rms(r.L, ...first)), settledRightOverLeftDb: db(rms(r.R, .6, .9), rms(r.L, .6, .9)), finalX: r.created.panners[0].positionX.value};
  };
  return {instant: await run(0), smoothed: await run(.02)};
}

window.spatialAudio = {
  async run() {
    return {userAgent: navigator.userAgent, sampleRate: RATE, panning: await panning(), selection: await selection(), distance: await distance(), cutoff: await cutoff(), filter: await filter(), smoothing: await smoothing()};
  },
};
window.spatialAudioReady = true;
