import test from 'node:test';
import assert from 'node:assert/strict';
import type { CueVoice, CueVoiceOptions } from '../../author';
import { airCutoff, classGain, createSpatialAudio, segmentQueryFromRaycast, type SoundClass } from './index';

/** A recording stand-in for `ctx.playVoice`: voices end only when the test says so. */
function fakeOutput(o: { hrtfLimit?: number; refuse?: boolean } = {}) {
  const voices: (CueVoice & { options: CueVoiceOptions; positions: number[][]; filters: [number, number, number][]; stops: number; end(): void })[] = [];
  return {
    voices,
    playing: () => voices.filter(v => !v.ended),
    playVoice(_id: string, options: CueVoiceOptions = {}) {
      if (o.refuse) return null;
      let ended = false;
      const hrtf = options.spatial?.panning === 'HRTF' && voices.filter(v => !v.ended && v.panning === 'HRTF').length < (o.hrtfLimit ?? 64);
      const voice = {
        options, positions: [] as number[][], filters: [] as [number, number, number][], stops: 0,
        get ended() { return ended; }, panning: hrtf ? 'HRTF' as const : 'equalpower' as const,
        setGain() {}, setPosition(p: readonly number[]) { voice.positions.push([...p]); },
        setFilter(f: { cutoffHz: number; gain?: number }, tau = .03) { voice.filters.push([f.cutoffHz, f.gain ?? 1, tau]); },
        stop() { if (ended) return; voice.stops++; ended = true; }, end() { ended = true; },
      };
      voices.push(voice); return voice;
    },
  };
}
const classes: Record<string, SoundClass> = {
  step: { refDistance: 2, cutoffDistance: 25, localise: true, importance: 2, air: { nearHz: 16000, farHz: 3000 } },
  shot: { refDistance: 6, cutoffDistance: 140, localise: true, importance: 4 },
  ambience: { refDistance: 4, cutoffDistance: 40, distanceModel: 'linear' },
};
const origin = [0, 0, 0] as const;

test('class curves: spec distance gain within the cutoff, 0 beyond; air low-pass interpolates in log frequency', () => {
  assert.equal(classGain(classes.step, 2), 1);
  assert.ok(Math.abs(classGain(classes.step, 10) - 2 / (2 + 8)) < 1e-12);
  assert.ok(classGain(classes.step, 25) > 0); assert.equal(classGain(classes.step, 25.01), 0);
  assert.ok(Math.abs(classGain(classes.ambience, 22) - (1 - 18 / 36)) < 1e-12, 'linear reads cutoff as maxDistance');
  assert.equal(airCutoff(classes.step, 0), 16000); assert.equal(airCutoff(classes.step, 25), 3000);
  assert.ok(Math.abs(airCutoff(classes.step, 13.5) - Math.sqrt(16000 * 3000)) < 1e-6);
  assert.equal(airCutoff(classes.shot, 100), 20000);
  for (const bad of [{ refDistance: 0, cutoffDistance: 5 }, { refDistance: 5, cutoffDistance: 4 }, { refDistance: 1, cutoffDistance: 5, air: { nearHz: 5, farHz: 100 } }, { refDistance: 1, cutoffDistance: 5, importance: -1 }])
    assert.throws(() => createSpatialAudio({ output: fakeOutput(), classes: { bad: bad as SoundClass } }), /invalid sound class 'bad'/);
});

test('limits and inputs are validated before anything is tracked', () => {
  const output = fakeOutput();
  for (const limits of [{ maxSources: 0 }, { maxSources: 1025 }, { maxVoices: 65 }, { maxVoices: 4, maxHrtfVoices: 5 }, { raysPerPump: 257 }, { maxLateness: 3 }, { stealRatio: .5 }])
    assert.throws(() => createSpatialAudio({ output, classes, limits }), /invalid limits/);
  assert.throws(() => createSpatialAudio({ output, classes: {} }));
  const audio = createSpatialAudio({ output, classes });
  assert.throws(() => audio.emit({ cue: 'x', class: 'nope', position: [0, 0, 0] }, 0), /unknown sound class/);
  assert.throws(() => audio.emit({ cue: 'x', class: 'step', position: [0, NaN, 0] }, 0), /invalid source/);
  assert.throws(() => audio.emit({ cue: 'x', class: 'step', position: [0, 0, 0], every: .01 }, 0), /invalid source/);
  assert.throws(() => audio.pump(0, [0, 0, Infinity]));
  audio.pump(1, origin); assert.throws(() => audio.pump(.5, origin), /monotonic/);
});

test('beyond the class cutoff an emission is culled while the source stays tracked silently; it plays once in range', () => {
  const output = fakeOutput(); const audio = createSpatialAudio({ output, classes });
  let at: [number, number, number] = [0, 0, -40];
  const id = audio.emit({ cue: 'enemy.step', class: 'step', position: () => at, every: .5 }, 0)!;
  audio.pump(0, origin);
  assert.equal(output.voices.length, 0); assert.equal(audio.stats.culled, 1); assert.equal(audio.stats.sources, 1, 'still tracked');
  at = [0, 0, -10]; audio.pump(.5, origin);
  assert.equal(output.voices.length, 1);
  const spatial = output.voices[0].options.spatial!;
  assert.deepEqual([spatial.cutoffDistance, spatial.refDistance, spatial.panning], [25, 2, 'HRTF']);
  assert.ok(output.voices[0].options.filter, 'every kit voice has the filter stage');
  assert.ok(audio.cancel(id)); assert.equal(audio.cancel(id), false); assert.equal(audio.stats.sources, 0);
});

test('importance ranking: the voice limit goes to the strongest emissions; the rest wait virtually and drop when stale', () => {
  const output = fakeOutput(); const audio = createSpatialAudio({ output, classes, limits: { maxVoices: 2, maxLateness: .1 } });
  const far = audio.emit({ cue: 'amb', class: 'ambience', position: [0, 0, -30] }, 0)!;
  audio.emit({ cue: 'enemy.step', class: 'step', position: [0, 0, -3] }, 0);
  audio.emit({ cue: 'enemy.shot', class: 'shot', position: [0, 0, -20] }, 0);
  const r = audio.pump(0, origin);
  assert.equal(r.realised, 2); assert.equal(r.waiting, 1);
  // Scores: step at 3 m 2 × 0.67 = 1.33, shot at 20 m 4 × 0.3 = 1.2, ambience (linear) at 30 m 1 × 0.28.
  assert.deepEqual(output.voices.map(v => v.options.spatial!.refDistance), [2, 6]);
  audio.pump(.05, origin); assert.equal(audio.stats.waiting, 1, 'still within lateness');
  audio.pump(.2, origin); assert.equal(audio.stats.dropped, 1); assert.equal(audio.stats.waiting, 0);
  assert.equal(audio.occluded(far), null); assert.equal(audio.stats.sources, 2, 'the dropped one-shot is retired');
});

test('a much stronger emission steals the weakest voice with a fade, never an abrupt stop, then plays', () => {
  const output = fakeOutput(); const audio = createSpatialAudio({ output, classes, limits: { maxVoices: 1, maxLateness: .5 } });
  audio.emit({ cue: 'amb', class: 'ambience', position: [0, 0, -30] }, 0); audio.pump(0, origin);
  audio.emit({ cue: 'enemy.shot', class: 'shot', position: [0, 0, -6] }, .01); audio.pump(.01, origin);
  const weak = output.voices[0];
  assert.equal(audio.stats.stolen, 1); assert.equal(weak.stops, 0, 'fading, not stopped');
  assert.deepEqual(weak.filters.at(-1), [20000, 0, .01]);
  assert.equal(output.voices.length, 1, 'the slot frees after the fade');
  audio.pump(.08, origin);
  assert.equal(weak.stops, 1); assert.equal(output.voices.length, 2); assert.equal(output.voices[1].options.spatial!.refDistance, 6);
  // A comparable emission does not steal (hysteresis).
  audio.emit({ cue: 'enemy.shot', class: 'shot', position: [0, 0, -6] }, .09); audio.pump(.09, origin);
  assert.equal(audio.stats.stolen, 1);
});

test('HRTF goes to localisation-critical classes, highest score first, within the kit limit', () => {
  const output = fakeOutput(); const audio = createSpatialAudio({ output, classes, limits: { maxHrtfVoices: 1 } });
  audio.emit({ cue: 'amb', class: 'ambience', position: [0, 0, -5] }, 0);
  audio.emit({ cue: 'enemy.step', class: 'step', position: [0, 0, -20] }, 0);
  audio.emit({ cue: 'enemy.shot', class: 'shot', position: [0, 0, -8] }, 0);
  audio.pump(0, origin);
  const panning = Object.fromEntries(output.voices.map(v => [v.options.spatial!.refDistance, v.options.spatial!.panning]));
  assert.deepEqual(panning, { 6: 'HRTF', 2: 'equalpower', 4: 'equalpower' });
  assert.equal(audio.stats.hrtf, 1);
});

test('the output HRTF limit is respected: a downgraded voice is not counted as HRTF', () => {
  const output = fakeOutput({ hrtfLimit: 0 }); const audio = createSpatialAudio({ output, classes });
  audio.emit({ cue: 'enemy.shot', class: 'shot', position: [0, 0, -8] }, 0); audio.pump(0, origin);
  assert.equal(output.voices[0].panning, 'equalpower'); assert.equal(audio.stats.hrtf, 0);
});

test('occlusion: rays per pump are bounded, stalest first, and drive the smoothed filter; stale results fall back', () => {
  const output = fakeOutput(); const queries: number[][] = [];
  let wall = true;
  const audio = createSpatialAudio({ output, classes, limits: { raysPerPump: 2 }, filterSmoothing: .1,
    occlusion: { query: (from, to) => { queries.push([...to]); return wall ? 1 : null; }, blocked: { cutoffHz: 800, gain: .4 }, maxAge: .5 } });
  const ids = [-4, -6, -8].map(z => audio.emit({ cue: 'enemy.step', class: 'step', position: [0, 0, z], every: 10 }, 0)!);
  const r = audio.pump(0, origin);
  assert.equal(r.rays, 2); assert.equal(audio.stats.raysDeferred, 1);
  assert.deepEqual(queries.map(q => q[2]), [-4, -6], 'never-queried sources, highest score first');
  const at = (z: number) => output.voices.find(v => v.options.spatial!.position[2] === z)!;
  assert.deepEqual([at(-4).options.filter!.cutoffHz, at(-4).options.filter!.gain], [800, .4], 'starts at the blocked filter');
  assert.equal(at(-8).options.filter!.gain, 1, 'unqueried path starts open');
  assert.equal(output.voices[0], at(-8), 'occlusion lowers the score: the open source ranks first');
  audio.pump(.1, origin);
  assert.deepEqual(queries.map(q => q[2]), [-4, -6, -8, -4], 'the stalest path next');
  assert.deepEqual(at(-8).filters.at(-1), [800, .4, .1], 'smoothed change to blocked');
  wall = false; audio.pump(.2, origin); audio.pump(.3, origin);
  assert.equal(audio.occluded(ids[0]), false);
  const opened = at(-4).filters.at(-1)!;
  assert.equal(opened[1], 1); assert.ok(opened[0] > 10000, 'back to the air cutoff'); assert.equal(opened[2], .1);
  const writes = at(-4).filters.length; audio.pump(.31, origin);
  assert.equal(at(-4).filters.length, writes, 'unchanged filter: no write');
});

test('a stale result falls back to the creator default; with no budget nothing is queried', () => {
  const output = fakeOutput(); let calls = 0;
  const audio = createSpatialAudio({ output, classes, limits: { raysPerPump: 0 }, occlusion: { query: () => { calls++; return 1; }, unknown: 'blocked' } });
  audio.emit({ cue: 'enemy.step', class: 'step', position: [0, 0, -4] }, 0); audio.pump(0, origin);
  assert.equal(calls, 0); assert.equal(output.voices[0].options.filter!.gain, .5, 'unknown treated as blocked by choice');
});

test('a failing port is reported once per source and never stops the pump; a bad position retires the source', () => {
  const output = fakeOutput(); const reports: string[] = [];
  const audio = createSpatialAudio({ output, classes, report: m => reports.push(m), occlusion: { query: () => { throw Error('geometry gone'); } } });
  audio.emit({ cue: 'enemy.step', class: 'step', position: [0, 0, -4], every: .1, importance: () => { throw Error('no threat'); } }, 0);
  const broken = audio.emit({ cue: 'enemy.step', class: 'step', position: () => [NaN, 0, 0] as never }, 0)!;
  audio.pump(0, origin); audio.pump(.1, origin);
  assert.equal(reports.filter(r => r.includes('occlusion')).length, 1);
  assert.equal(reports.filter(r => r.includes('importance')).length, 1);
  assert.ok(reports.some(r => r.includes('position failed')));
  assert.equal(audio.cancel(broken), false, 'retired'); assert.equal(output.voices.length, 2, 'the healthy source kept playing each interval');
});

test('repeating sources emit on schedule without bursts; one-shots retire after their voice ends', () => {
  const output = fakeOutput(); const audio = createSpatialAudio({ output, classes });
  audio.emit({ cue: 'enemy.step', class: 'step', position: [0, 0, -4], every: .5 }, 0);
  for (const t of [0, .2, .5, .7, 1.0]) audio.pump(t, origin);
  assert.equal(output.voices.length, 3);
  audio.pump(5, origin); assert.equal(output.voices.length, 4, 'a long gap emits once, not a catch-up burst');
  assert.ok(output.voices[2].filters.length + output.voices[2].stops >= 1, 'a replaced voice fades out');
  const one = audio.emit({ cue: 'enemy.shot', class: 'shot', position: [0, 0, -8] }, 5)!;
  audio.pump(5, origin); output.voices.at(-1)!.end(); audio.pump(5.1, origin);
  assert.equal(audio.cancel(one), false, 'retired after its voice ended');
});

test('positions are followed with writes only on change; refusal by the output is counted', () => {
  const output = fakeOutput(); const audio = createSpatialAudio({ output, classes });
  let at: [number, number, number] = [0, 0, -4];
  audio.emit({ cue: 'enemy.step', class: 'step', position: () => at, every: 10 }, 0);
  audio.pump(0, origin); audio.pump(.1, origin); assert.equal(output.voices[0].positions.length, 0);
  at = [1, 0, -4]; audio.pump(.2, origin); assert.deepEqual(output.voices[0].positions, [[1, 0, -4]]);
  const refusing = createSpatialAudio({ output: fakeOutput({ refuse: true }), classes });
  refusing.emit({ cue: 'x', class: 'shot', position: [0, 0, -1] }, 0); refusing.pump(0, origin);
  assert.equal(refusing.stats.dropped, 1); assert.equal(refusing.stats.sources, 0);
});

test('abort, cancel and dispose stop only this kit\'s voices, once; disposed kits admit nothing', () => {
  const output = fakeOutput(); const audio = createSpatialAudio({ output, classes });
  const controller = new AbortController();
  audio.emit({ cue: 'enemy.step', class: 'step', position: [0, 0, -4], every: .5, signal: controller.signal }, 0);
  audio.emit({ cue: 'enemy.shot', class: 'shot', position: [0, 0, -8], every: 1 }, 0);
  audio.pump(0, origin); controller.abort();
  const step = output.voices.find(v => v.options.spatial!.refDistance === 2)!, shot = output.voices.find(v => v.options.spatial!.refDistance === 6)!;
  assert.equal(audio.stats.sources, 1); assert.deepEqual(step.filters.at(-1), [20000, 0, .01], 'aborted voice fades');
  const aborted = new AbortController(); aborted.abort();
  assert.equal(audio.emit({ cue: 'x', class: 'step', position: [0, 0, 0], signal: aborted.signal }, 0), null);
  audio.dispose(); audio.dispose();
  assert.equal(output.playing().length, 0); assert.equal(shot.stops, 1); assert.equal(step.stops, 1, 'the fading voice is stopped too');
  assert.equal(audio.emit({ cue: 'x', class: 'step', position: [0, 0, 0] }, 1), null);
  assert.deepEqual(audio.pump(2, origin), { realised: 0, waiting: 0, rays: 0, dropped: 0 });
});

test('a terrain-style ray cast adapts to the segment query', () => {
  const seen: number[] = [];
  const query = segmentQueryFromRaycast((_o, d, max) => { seen.push(d.z, max); return max > 5 ? { distance: 5 } : null; });
  assert.equal(query([0, 0, 0], [0, 0, -10]), 5); assert.equal(query([0, 0, 0], [0, 0, -3]), null); assert.equal(query([1, 1, 1], [1, 1, 1]), null);
  assert.deepEqual(seen, [-1, 10, -1, 3]);
});
