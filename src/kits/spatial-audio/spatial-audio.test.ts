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
  // Second pump: half the budget refreshes the playing voice with the oldest information (a tie at 0.1 s, so the
  // highest score: -4); the other half goes to the never-queried path (-8).
  assert.deepEqual(queries.map(q => q[2]), [-4, -6, -4, -8]);
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
  assert.equal(audio.stats.sources, 1); assert.deepEqual(step.filters.at(-1), [airCutoff(classes.step, 4), 0, .01], 'aborted voice fades at its current cutoff (no brightening)');
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

// Review regressions (PR #55).
const flat: Record<string, SoundClass> = { weak: { refDistance: 1, cutoffDistance: 100 }, strong: { refDistance: 1, cutoffDistance: 100, importance: 10 }, near: { refDistance: 1, cutoffDistance: 100, localise: true } };

test('one emission steals at most one voice, even across several pumps inside the fade', () => {
  const output = fakeOutput(); const audio = createSpatialAudio({ output, classes: flat, limits: { maxVoices: 4, maxLateness: .5 } });
  for (const z of [-5, -6, -7, -8]) audio.emit({ cue: 'w', class: 'weak', position: [0, 0, z] }, 0);
  audio.pump(0, origin);
  audio.emit({ cue: 's', class: 'strong', position: [0, 0, -2] }, 0);
  for (let t = 0; t < .2; t += 1 / 60) audio.pump(t, origin);
  assert.equal(audio.stats.stolen, 1);
  assert.equal(output.voices.filter(v => v.stops === 1).length, 1, 'one weak voice stopped');
  assert.equal(output.voices.at(-1)!.options.spatial!.position[2], -2, 'the strong emission plays');
  assert.ok(audio.stats.voices <= 4);
});

test('equal-score emissions are admitted oldest-pending first, so newer sources cannot starve older ones', () => {
  const output = fakeOutput(); const audio = createSpatialAudio({ output, classes: flat, limits: { maxVoices: 2, maxLateness: .3 } });
  const played = new Map<number, number>();
  const positions = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as const;
  positions.forEach(p => audio.emit({ cue: 'r', class: 'weak', position: p, every: .1 }, 0));
  for (let t = 0; t <= 2; t += 1 / 60) {
    const before = output.voices.length; audio.pump(t, origin);
    for (const v of output.voices.slice(before)) { const k = positions.findIndex(p => p[0] === v.options.spatial!.position[0] && p[2] === v.options.spatial!.position[2]); played.set(k, (played.get(k) ?? 0) + 1); }
    for (const v of output.voices) if (!v.ended && output.voices.indexOf(v) < output.voices.length - 2) v.end();
  }
  for (let k = 0; k < 4; k++) assert.ok((played.get(k) ?? 0) > 0, `source ${k} played`);
});

test('a repeater replaces its own voice within the voice cap: with no free slot its old voice fades first; nothing is stolen', () => {
  const output = fakeOutput(); const audio = createSpatialAudio({ output, classes: flat, limits: { maxVoices: 2 } });
  audio.emit({ cue: 'r', class: 'weak', position: [0, 0, -2], every: .5 }, 0);
  audio.emit({ cue: 'other', class: 'weak', position: [0, 0, -3], every: 100 }, 0);
  audio.pump(0, origin); assert.equal(output.voices.length, 2);
  audio.pump(.5, origin);
  assert.equal(output.voices.length, 2, 'full: the repeat waits for its own fade');
  assert.deepEqual(output.voices[0].filters.at(-1)?.[1], 0, 'its own previous voice fades');
  assert.deepEqual([audio.stats.voices, audio.stats.fading], [2, 1], 'the fade holds its slot');
  audio.pump(.57, origin);
  assert.equal(output.voices.length, 3, 'the repeat starts when its fade frees the slot'); assert.equal(output.voices[0].stops, 1);
  assert.equal(output.voices[1].stops + output.voices[1].filters.length, 0, 'the other source is untouched');
  assert.deepEqual([audio.stats.stolen, audio.stats.rotated, audio.stats.voices, output.playing().length], [0, 0, 2, 2]);
  // With a free slot the repeat crossfades at once.
  const roomy = fakeOutput(); const spare = createSpatialAudio({ output: roomy, classes: flat, limits: { maxVoices: 2 } });
  spare.emit({ cue: 'r', class: 'weak', position: [0, 0, -2], every: .5 }, 0); spare.pump(0, origin); spare.pump(.5, origin);
  assert.equal(roomy.voices.length, 2); assert.equal(spare.stats.voices, 2);
});

test('HRTF is not flipped on repeats: a source replacing its own HRTF voice keeps HRTF', () => {
  // Cues shorter than the interval: each repeat starts with no voice of its own playing and keeps HRTF.
  const short = timedOutput(() => .3); const audio = createSpatialAudio({ output: short, classes: flat, limits: { maxHrtfVoices: 1 } });
  audio.emit({ cue: 'r', class: 'near', position: [0, 0, -2], every: .5 }, 0);
  for (let i = 0; i <= 100; i++) { short.time = i / 60; audio.pump(i / 60, origin); }
  assert.deepEqual(short.voices.map(v => v.options.spatial!.panning), ['HRTF', 'HRTF', 'HRTF', 'HRTF']);
  // Overlapping repeats at the HRTF cap: no wait for the HRTF fade (each starts on its beat); the first overlapping
  // repeat starts equal-power and its overlapping repeats stay equal-power (one switch, no per-emission flip); the
  // fading HRTF voice counts against the cap.
  const long = timedOutput(); const over = createSpatialAudio({ output: long, classes: flat, limits: { maxHrtfVoices: 1 } });
  over.emit({ cue: 'r', class: 'near', position: [0, 0, -2], every: .5 }, 0);
  for (let i = 0; i <= 100; i++) { long.time = i / 60; over.pump(i / 60, origin); assert.ok(long.hrtf() <= 1); }
  assert.deepEqual(long.voices.map(v => +v.startT.toFixed(3)), [0, .5, 1, 1.5]);
  assert.deepEqual(long.voices.map(v => v.options.spatial!.panning), ['HRTF', 'equalpower', 'equalpower', 'equalpower']);
});

test('when full, admission work stays bounded: one failed steal ends the pass', () => {
  const output = fakeOutput(); const audio = createSpatialAudio({ output, classes: flat, limits: { maxSources: 1024, maxVoices: 64, maxLateness: 2 } });
  for (let i = 0; i < 1024; i++) audio.emit({ cue: 'w', class: 'weak', position: [0, 0, -2 - (i % 50)], every: 1 }, 0);
  audio.pump(0, origin);
  assert.equal(output.voices.length, 64); assert.equal(audio.stats.waiting, 960); assert.equal(audio.stats.stolen, 0);
  const t0 = performance.now(); for (let k = 1; k <= 20; k++) audio.pump(k / 1000, origin); const ms = (performance.now() - t0) / 20;
  assert.ok(ms < 8, `pump with 960 waiting took ${ms.toFixed(2)} ms`);
});

test('occlusion refresh of playing voices is not starved by new emissions; staleness is reported', () => {
  const output = fakeOutput(); let checks = 0;
  const audio = createSpatialAudio({ output, classes: flat, limits: { raysPerPump: 2, maxVoices: 64 }, occlusion: { query: (_f, to) => { checks++; return to[2] === -10 ? 5 : null; }, maxAge: .5 } });
  const walled = audio.emit({ cue: 'loop', class: 'weak', position: [0, 0, -10], every: 100 }, 0)!;
  const born = new Map<object, number>();
  for (let t = 0, n = 0; t <= 2; t += 1 / 60, n++) {
    audio.emit({ cue: 'a', class: 'weak', position: [n % 7, 0, -3] }, t); audio.emit({ cue: 'b', class: 'weak', position: [-(n % 5), 0, -4] }, t);
    // One-shot cues last 0.15 s; the walled source's voice keeps playing.
    for (const v of output.voices.slice(1)) { if (!born.has(v)) born.set(v, t); else if (t - born.get(v)! > .15) v.end(); }
    audio.pump(t, origin);
    if (t > .1) assert.equal(audio.occluded(walled), true);
  }
  assert.ok(output.voices[0].filters.every(f => f[1] < 1), 'the walled voice never opened');
  // Every playing voice that has a result is fresh; the only stale ones are new one-shots that started without a
  // result (two per pump against one ray for new emissions), and stats say so.
  assert.equal(audio.stats.stale, audio.stats.unqueried, JSON.stringify(audio.stats)); assert.ok(audio.stats.oldestRayAge <= .5, `oldest ${audio.stats.oldestRayAge}`);
  const starved = createSpatialAudio({ output: fakeOutput(), classes: flat, limits: { raysPerPump: 1 }, occlusion: { query: () => null, maxAge: .03 } });
  for (const z of [-2, -3, -4, -5]) starved.emit({ cue: 'x', class: 'weak', position: [0, 0, z], every: 100 }, 0);
  for (let t = 0; t <= .2; t += 1 / 60) starved.pump(t, origin);
  assert.ok(starved.stats.stale > 0, 'a budget that cannot keep up shows in stats');
  assert.ok(checks > 0);
});

test('a throwing voice method is reported once and does not break later pumps; long gaps restart the rhythm from now', () => {
  const output = fakeOutput(); const reports: string[] = [];
  const audio = createSpatialAudio({ output, classes: flat, report: m => reports.push(m) });
  let at: [number, number, number] = [0, 0, -2];
  audio.emit({ cue: 'r', class: 'weak', position: () => at, every: .5 }, 0);
  audio.pump(0, origin);
  output.voices[0].setPosition = () => { throw Error('node gone'); };
  at = [1, 0, -2]; audio.pump(.1, origin); at = [2, 0, -2]; audio.pump(.2, origin);
  assert.equal(reports.filter(r => r.includes('voice update')).length, 1);
  audio.pump(.5, origin); assert.equal(output.voices.length, 2, 'still pumping and emitting');
  audio.pump(10, origin); assert.equal(output.voices.length, 3);
  audio.pump(10.4, origin); assert.equal(output.voices.length, 3); audio.pump(10.5, origin); assert.equal(output.voices.length, 4, 'next beat is now + every');
});

test('occlusion margin ignores hits at the ends of the segment (own colliders)', () => {
  const output = fakeOutput(); let hit = .02;
  const audio = createSpatialAudio({ output, classes: flat, occlusion: { query: () => hit } });
  const id = audio.emit({ cue: 'x', class: 'weak', position: [0, 0, -4], every: 100 }, 0)!;
  audio.pump(0, origin); assert.equal(audio.occluded(id), false, 'listener-side hit ignored');
  hit = 3.97; audio.pump(1, origin); assert.equal(audio.occluded(id), false, 'source-side hit ignored');
  hit = 2; audio.pump(2, origin); assert.equal(audio.occluded(id), true);
  assert.throws(() => createSpatialAudio({ output, classes: flat, occlusion: { query: () => null, margin: -1 } }));
});

// Re-verification regressions (PR #55).
type Fake = ReturnType<typeof fakeOutput>;
/** Starts per source, keyed by the voice's position. */
const key = (p: readonly number[]) => `${p[0]},${p[2]}`;
const startsByX = (output: Fake) => { const n = new Map<string, number>(); for (const v of output.voices) { const k = key(v.options.spatial!.position); n.set(k, (n.get(k) ?? 0) + 1); } return n; };
/** Equal sources: the same distance from the listener at the origin, told apart by x. */
const ring = (k: number, count: number): [number, number, number] => [Math.cos(2 * Math.PI * k / count) * 5, 0, Math.sin(2 * Math.PI * k / count) * 5];

test('equal-score repeaters started together share the voices fairly under default lateness', () => {
  const output = fakeOutput(); const audio = createSpatialAudio({ output, classes: flat, limits: { maxVoices: 4 } });
  const xs = Array.from({ length: 8 }, (_, k) => { const p = ring(k, 8); audio.emit({ cue: 'r', class: 'weak', position: p, every: .5 }, 0); return key(p); });
  for (let i = 0; i <= 600; i++) { audio.pump(i / 60, origin); assert.ok(output.playing().length <= 4); }
  const n = startsByX(output);
  for (const x of xs) { const plays = n.get(x) ?? 0; assert.ok(plays >= 9 && plays <= 11, `source ${x} played ${plays} of 20 beats: ${[...n.values()]}`); }
  assert.equal(audio.stats.stolen, 0, 'equal sources rotate; nothing is stolen'); assert.ok(audio.stats.rotated > 0);
});

test('opt-in rotation and carryLate: equal-score repeaters out of phase with long voices share them fairly', () => {
  const output = fakeOutput(); const audio = createSpatialAudio({ output, classes: flat, limits: { maxVoices: 4, rotateAfter: .25 } });
  const xs: string[] = [];
  for (let i = 0; i <= 600; i++) {
    const t = i / 60;
    if (i % 4 === 0 && xs.length < 8) { const p = ring(xs.length, 8); xs.push(key(p)); audio.emit({ cue: 'r', class: 'weak', position: p, every: .5, carryLate: true }, t); }
    audio.pump(t, origin); assert.ok(output.playing().length <= 4);
  }
  const plays = xs.map(x => startsByX(output).get(x) ?? 0);
  // Long voices never free a slot, so a late emission must carry over to the next voice it can take (measured
  // spread 1 at 10, 20 and 60 s and staggers of 3 to 7 frames; without carryLate, out-of-phase shares are uneven).
  assert.ok(Math.min(...plays) >= 10 && Math.max(...plays) - Math.min(...plays) <= 1, `plays ${plays}`);
});

test('opt-in rotation: equal one-shots get turns against older long voices, without cutting each other', () => {
  const output = fakeOutput(); const audio = createSpatialAudio({ output, classes: flat, limits: { maxVoices: 2, rotateAfter: .25 } });
  audio.emit({ cue: 'long', class: 'weak', position: ring(0, 12), every: 100 }, 0); audio.emit({ cue: 'long', class: 'weak', position: ring(1, 12), every: 100 }, 0);
  const xs: string[] = [];
  for (let i = 0; i <= 360; i++) {
    const t = i / 60;
    if (i >= 60 && i % 30 === 0 && xs.length < 9) { const p = ring(2 + xs.length, 12); xs.push(key(p)); audio.emit({ cue: 'shot', class: 'weak', position: p }, t); }
    audio.pump(t, origin); assert.ok(output.playing().length <= 2);
  }
  const n = startsByX(output);
  assert.deepEqual(xs.map(x => n.get(x) ?? 0), Array(9).fill(1), 'each newer equal one-shot played');
  assert.equal(audio.stats.dropped, 0); assert.equal(audio.stats.stolen, 0); assert.equal(audio.stats.rotated, 9);
  // Nine at once: the two slots rotate once to two of them; the newcomers do not cut each other.
  const burst = fakeOutput(); const busy = createSpatialAudio({ output: burst, classes: flat, limits: { maxVoices: 2, rotateAfter: .25 } });
  busy.emit({ cue: 'long', class: 'weak', position: ring(0, 12), every: 100 }, 0); busy.emit({ cue: 'long', class: 'weak', position: ring(1, 12), every: 100 }, 0);
  busy.pump(0, origin);
  for (let k = 0; k < 9; k++) busy.emit({ cue: 'shot', class: 'weak', position: ring(2 + k, 12) }, 1);
  for (let i = 0; i <= 60; i++) busy.pump(1 + i / 60, origin);
  assert.equal(burst.voices.length, 4); assert.equal(busy.stats.dropped, 7); assert.equal(busy.stats.rotated, 2);
  assert.equal(burst.voices.slice(2).filter(v => v.stops === 0).length, 2, 'the two newcomers keep playing');
});

test('a critical repeater among 20 equal ones at importance 1 gets its share', () => {
  const output = fakeOutput(); const audio = createSpatialAudio({ output, classes: flat, limits: { maxVoices: 4 } });
  const xs = Array.from({ length: 21 }, (_, k) => { const p = ring(k, 21); audio.emit({ cue: k === 20 ? 'critical' : 'r', class: 'weak', position: p, every: .5, importance: () => 1 }, 0); return key(p); });
  for (let i = 0; i <= 600; i++) audio.pump(i / 60, origin);
  const plays = xs.map(x => startsByX(output).get(x) ?? 0);
  // 20 beats × 4 voices / 21 sources ≈ 3.8 plays each.
  assert.ok(plays[20] >= 3, `critical played ${plays[20]}`); assert.ok(Math.min(...plays) >= 3, `plays ${plays}`);
});

test('real voices never exceed maxVoices, fades included, and stats report them', () => {
  for (const maxVoices of [64, 24]) {
    const output = fakeOutput(); const audio = createSpatialAudio({ output, classes: flat, limits: { maxSources: 64, maxVoices } });
    for (let k = 0; k < 64; k++) audio.emit({ cue: 'r', class: 'weak', position: ring(k, 64), every: .05 }, 0);
    let peak = 0;
    for (let i = 0; i <= 120; i++) {
      audio.pump(i / 60, origin);
      const real = output.playing().length; peak = Math.max(peak, real);
      assert.equal(audio.stats.voices, real, 'stats.voices counts real voices'); assert.ok(real <= maxVoices, `${real} real voices > ${maxVoices}`);
    }
    assert.equal(peak, maxVoices); assert.ok(output.voices.length > maxVoices, 'still emitting');
  }
});

test('a budget of one ray still queries new emissions before they start; unqueried voices count as stale', () => {
  const output = fakeOutput(); let calls = 0;
  const audio = createSpatialAudio({ output, classes: flat, limits: { raysPerPump: 1, maxVoices: 64 }, occlusion: { query: () => { calls++; return null; }, unknown: 'blocked' } });
  for (const z of [-2, -3, -4]) audio.emit({ cue: 'loop', class: 'weak', position: [0, 0, z], every: 100 }, 0);
  // Three loops started in one pump: one gets the ray; the next pumps (nothing waiting) give the others theirs.
  for (let i = 0; i < 6; i++) audio.pump(i / 60, origin);
  assert.equal(audio.stats.unqueried, 0);
  for (let i = 6; i < 66; i++) { audio.emit({ cue: 'shot', class: 'weak', position: [i % 7, 0, -5] }, i / 60); audio.pump(i / 60, origin); }
  const shots = output.voices.slice(3);
  assert.equal(shots.length, 60); assert.ok(shots.every(v => v.options.filter!.gain === 1), 'every new emission started with its own result (open)');
  assert.equal(calls, 66);
  assert.equal(audio.stats.unqueried, 0); assert.ok(audio.stats.stale > 0, 'playing voices the budget could not refresh show as stale');
  const none = createSpatialAudio({ output: fakeOutput(), classes: flat, limits: { raysPerPump: 0 }, occlusion: { query: () => null } });
  none.emit({ cue: 'x', class: 'weak', position: [0, 0, -2], every: 100 }, 0); none.pump(0, origin);
  assert.deepEqual([none.stats.unqueried, none.stats.stale], [1, 1], 'a voice that started with no result is stale at once');
});

test('HRTF has hysteresis: near-equal short cues do not flip panning; a much stronger one takes a free claim', () => {
  const output = fakeOutput(); const audio = createSpatialAudio({ output, classes: flat, limits: { maxHrtfVoices: 1 } });
  let wobble = 0;
  audio.emit({ cue: 'a', class: 'near', position: [3, 0, 0], every: .3, importance: () => 1 + .02 * Math.sin(wobble) }, 0);
  // In phase: each beat, the order of the two (by a wobbling 2% score difference) changes which one starts first.
  audio.emit({ cue: 'b', class: 'near', position: [-3, 0, 0], every: .3, importance: () => 1 + .02 * Math.cos(wobble) }, 0);
  const born = new Map<object, number>();
  for (let i = 0; i <= 600; i++) {
    const t = i / 60; wobble = t * 7;
    for (const v of output.voices) { if (!born.has(v)) born.set(v, t); else if (t - born.get(v)! >= .2) v.end(); }
    audio.pump(t, origin);
  }
  const flips = (x: number) => { const p = output.voices.filter(v => v.options.spatial!.position[0] === x).map(v => v.options.spatial!.panning); return p.slice(1).filter((m, k) => m !== p[k]).length; };
  assert.equal(flips(3) + flips(-3), 0, 'each source keeps its panning model');
  assert.ok(audio.stats.hrtf <= 1);
  // A source with 2x the score takes the claim when the claimant is not playing.
  const out2 = fakeOutput(); const two = createSpatialAudio({ output: out2, classes: flat, limits: { maxHrtfVoices: 1 } });
  two.emit({ cue: 'a', class: 'near', position: [3, 0, 0] }, 0); two.pump(0, origin); out2.voices[0].end(); two.pump(.1, origin);
  two.emit({ cue: 'b', class: 'near', position: [-3, 0, 0], every: 100, importance: () => 2 }, .2); two.pump(.2, origin);
  assert.equal(out2.voices[1].options.spatial!.panning, 'HRTF');
});

// Round-3 re-verification regressions (PR #55).
/** A fake output with a clock: voices end after their cue's duration; a gain-0 filter write records the cut time. */
function timedOutput(duration: (cue: string) => number = () => Infinity, hrtfLimit = Infinity) {
  let now = 0;
  type TVoice = CueVoice & { cue: string; options: CueVoiceOptions; startT: number; cutAt: number | null; stopT: number };
  const voices: TVoice[] = [];
  const o = {
    voices, set time(t: number) { now = t; },
    live: () => voices.filter(v => !v.ended),
    hrtf: () => voices.filter(v => !v.ended && v.panning === 'HRTF').length,
    playVoice(cue: string, options: CueVoiceOptions = {}) {
      let stopped = false; const startT = now, d = duration(cue);
      const voice: TVoice = {
        cue, options, startT, cutAt: null, stopT: Infinity,
        get ended() { return stopped || now >= startT + d; },
        panning: options.spatial?.panning === 'HRTF' && o.hrtf() < hrtfLimit ? 'HRTF' : 'equalpower',
        setGain() {}, setPosition() {},
        setFilter(f: { cutoffHz: number; gain?: number }) { if (f.gain === 0 && voice.cutAt === null) voice.cutAt = now; },
        stop() { if (!stopped) { stopped = true; voice.stopT = now; } },
      };
      voices.push(voice); return voice;
    },
  };
  return o;
}
/** Every voice the kit cut (faded) has a voice started within one fade plus one pump of the cut. */
const cutsReplaced = (out: ReturnType<typeof timedOutput>, pump: number) => out.voices.filter(v => v.cutAt !== null)
  .every(v => out.voices.some(w => w !== v && w.startT >= v.cutAt! && w.startT <= v.cutAt! + .06 + pump + 1e-9));

test('a victim is never cut unless its replacement starts: rotation at 60 Hz and a steal at 10 Hz', () => {
  // One long voice A; an equal one-shot B at 0.15 s; opt-in rotation with the default 0.15 s lateness. A becomes
  // rotatable at 0.2 s or 0.25 s while B is still within its lateness: A is cut for B and B starts, on time at .2, and
  // at .25 one fade after its lateness (counted in `late`). Either way, never silent and nothing dropped.
  for (const [rotateAfter, late] of [[.2, 0], [.25, 1]] as const) {
    const out = timedOutput(); const audio = createSpatialAudio({ output: out, classes: flat, limits: { maxVoices: 1, rotateAfter } });
    audio.emit({ cue: 'A', class: 'weak', position: [2, 0, 0] }, 0); audio.pump(0, origin);
    audio.emit({ cue: 'B', class: 'weak', position: [2, 0, 0] }, .15);
    for (let i = 9; i <= 60; i++) { out.time = i / 60; audio.pump(i / 60, origin); }
    const a = out.voices[0], b = out.voices.find(v => v.cue === 'B');
    assert.ok(a.cutAt !== null && b, 'A cut and B started'); assert.ok(b!.startT >= a.cutAt! && b!.startT - .15 <= .15 + .06 + 1 / 60, `B started ${b!.startT}`);
    assert.ok(cutsReplaced(out, 1 / 60)); assert.equal(out.live().length, 1, 'never silent');
    assert.deepEqual([audio.stats.dropped, audio.stats.late], [0, late]);
  }
  // Defaults (rotation off): the long voice is never cut for an equal emission; B is dropped instead.
  const off = timedOutput(); const plain = createSpatialAudio({ output: off, classes: flat, limits: { maxVoices: 1 } });
  plain.emit({ cue: 'A', class: 'weak', position: [2, 0, 0] }, 0); plain.pump(0, origin);
  plain.emit({ cue: 'B', class: 'weak', position: [2, 0, 0] }, .15);
  for (let i = 9; i <= 60; i++) { off.time = i / 60; plain.pump(i / 60, origin); }
  assert.deepEqual([off.voices.length, off.voices[0].cutAt, plain.stats.dropped], [1, null, 1]);
  // A steal pumped at 10 Hz: the stealer starts on the pump after the fade, past maxLateness, instead of being dropped.
  const slow = timedOutput(); const steal = createSpatialAudio({ output: slow, classes: flat, limits: { maxVoices: 1 } });
  steal.emit({ cue: 'A', class: 'weak', position: [2, 0, 0] }, 0); steal.pump(0, origin);
  steal.emit({ cue: 'S', class: 'strong', position: [2, 0, 0] }, 0);
  for (const t of [.1, .2, .3, .4]) { slow.time = t; steal.pump(t, origin); }
  assert.ok(slow.voices.some(v => v.cue === 'S'), 'the stealer started'); assert.equal(steal.stats.dropped, 0); assert.ok(cutsReplaced(slow, .1));
});

test('10 equal loops a frame apart on 4 voices: never silent, every cut replaced (opt-in rotation); defaults cut nothing', () => {
  for (const rotateAfter of [.25, undefined]) {
    const out = timedOutput(); const audio = createSpatialAudio({ output: out, classes: flat, limits: { maxVoices: 4, rotateAfter } });
    for (let i = 0; i <= 300; i++) {
      out.time = i / 60;
      if (i < 10) audio.emit({ cue: `L${i}`, class: 'weak', position: ring(i, 10) }, i / 60);
      audio.pump(i / 60, origin);
      if (i >= 4) assert.ok(out.live().length >= 4 - audio.stats.fading, `silence at frame ${i}`);
    }
    assert.ok(cutsReplaced(out, 1 / 60));
    if (rotateAfter === undefined) assert.equal(out.voices.filter(v => v.cutAt !== null).length, 0, 'rotation is off by default');
  }
});

test('rotation is off by default: long equal loops repeating every 4 s are not chopped; with carryLate all take turns', () => {
  const run = (carryLate: boolean) => {
    const out = timedOutput(() => 4); const audio = createSpatialAudio({ output: out, classes: flat, limits: { maxVoices: 4 } });
    for (let i = 0, k = 0; i <= 40 * 60; i++) {
      out.time = i / 60;
      if (k < 10 && i >= Math.round(k * .37 * 60)) { audio.emit({ cue: String(k), class: 'weak', position: ring(k, 10), every: 4, carryLate }, i / 60); k++; }
      audio.pump(i / 60, origin);
    }
    return { out, audio, plays: Array.from({ length: 10 }, (_, k) => out.voices.filter(v => v.cue === String(k)).length) };
  };
  // Without carryLate the loops that hold the voices keep them: the others' emissions are dropped on time.
  const plain = run(false);
  assert.equal(plain.out.voices.filter(v => v.cutAt !== null && v.cutAt < v.startT + 4 - 1 / 60).length, 0); assert.equal(plain.audio.stats.late, 0);
  assert.equal(plain.plays.filter(p => p === 0).length, 6, `plays ${plain.plays}`);
  const { out, audio } = run(true);
  // A repeat replacing its own voice right at the clip's end fades it within a frame of it; nothing is cut earlier.
  assert.equal(out.voices.filter(v => v.cutAt !== null && v.cutAt < v.startT + 4 - 1 / 60).length, 0, 'no voice cut early'); assert.equal(audio.stats.rotated, 0);
  assert.ok(out.voices.length >= 40);
  // carryLate: a late repeater keeps waiting (with its credit) up to one interval and takes the slot an equal holder
  // leaves on its own beat; it never starts more than one interval late.
  const plays = Array.from({ length: 10 }, (_, k) => out.voices.filter(v => v.cue === String(k)).length);
  assert.ok(Math.min(...plays) >= 3 && Math.max(...plays) - Math.min(...plays) <= 1, `plays ${plays}`);
  assert.ok(audio.stats.late > 0);
});

test('fair shares with fewer than twice as many sources as voices (served count breaks ties)', () => {
  for (const [n, k] of [[3, 2], [5, 3], [6, 4], [5, 4], [8, 4]]) {
    const out = timedOutput(() => .4); const audio = createSpatialAudio({ output: out, classes: flat, limits: { maxVoices: k } });
    for (let j = 0; j < n; j++) audio.emit({ cue: String(j), class: 'weak', position: ring(j, n), every: .5 }, 0);
    for (let i = 0; i <= 1200; i++) { out.time = i / 60; audio.pump(i / 60, origin); }
    // Fair share of the plays that happened (a late repeater starts in the next gap, so there are more than beats).
    const plays = Array.from({ length: n }, (_, j) => out.voices.filter(v => v.cue === String(j)).length), fair = plays.reduce((a, b) => a + b) / n;
    assert.ok(plays.every(p => Math.abs(p - fair) <= 2), `${n} on ${k}: plays ${plays}, fair ${fair.toFixed(1)}`);
    assert.ok(Math.min(...plays) >= 41 * k / n - 2, `${n} on ${k}: plays ${plays} below the beat share`);
  }
});

test('a stronger due repeater takes the free slot before a weaker waiter; full, it fades first (one fade plus a pump)', () => {
  const out = timedOutput(); const audio = createSpatialAudio({ output: out, classes: flat, limits: { maxVoices: 2 } });
  audio.emit({ cue: 'C', class: 'strong', position: [1, 0, 0], every: .5 }, 0);
  audio.emit({ cue: 'w', class: 'weak', position: [2, 0, 0] }, 0);
  for (let i = 0; i <= 29; i++) { out.time = i / 60; audio.pump(i / 60, origin); }
  audio.emit({ cue: 'x', class: 'weak', position: [3, 0, 0] }, 29 / 60); out.voices.find(v => v.cue === 'w')!.stop();
  for (let i = 30; i <= 70; i++) { out.time = i / 60; audio.pump(i / 60, origin); }
  const starts = (cue: string) => out.voices.filter(v => v.cue === cue).map(v => +v.startT.toFixed(3));
  assert.deepEqual(starts('C'), [0, .5, 1.067]); assert.deepEqual(starts('x'), [.567]);
});

test('a source cancelled from inside playVoice does not leak its voice', () => {
  const out = timedOutput(); const controller = new AbortController(); const inner = out.playVoice.bind(out);
  const audio = createSpatialAudio({ output: { playVoice: (cue, options) => { if (cue === 'x') controller.abort(); return inner(cue, options); } }, classes: flat, limits: { maxVoices: 1 } });
  audio.emit({ cue: 'x', class: 'weak', position: [1, 0, 0], every: .5, signal: controller.signal }, 0); audio.pump(0, origin);
  assert.equal(audio.stats.sources, 0); assert.equal(audio.stats.voices, out.live().length, 'the orphan is tracked as fading');
  audio.emit({ cue: 'y', class: 'weak', position: [1, 0, 0] }, 0);
  out.time = .1; audio.pump(.1, origin);
  assert.equal(out.voices.find(v => v.cue === 'x')!.ended, true); assert.ok(out.live().length <= 1);
  audio.dispose(); assert.equal(out.live().length, 0);
});

test('seeded fuzz: voice and HRTF caps hold on the output, nothing leaks, and every cut is replaced', () => {
  const rng = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed), hostile = seed % 2 === 0; // hostile: refusals, throwing filters, cancels, aborts and re-entrant cancels
    let reentrant: (() => void) | null = null;
    const out = timedOutput(() => r() < .2 ? Infinity : .02 + r() * 1.5, 1 + Math.floor(r() * 8)), inner = out.playVoice.bind(out);
    const output = { playVoice: (cue: string, options?: CueVoiceOptions) => {
      reentrant?.(); if (hostile && r() < .1) return null;
      const v = inner(cue, options); const set = v.setFilter!.bind(v);
      if (hostile) v.setFilter = (f, tau) => { if (r() < .002) throw Error('x'); set(f, tau); };
      return v;
    } };
    const maxVoices = 1 + Math.floor(r() * 12), maxHrtf = Math.floor(r() * (maxVoices + 1));
    const audio = createSpatialAudio({ output, classes: { a: { refDistance: 1, cutoffDistance: 40, localise: true }, b: { refDistance: 1, cutoffDistance: 50, importance: 3 }, c: { refDistance: 2, cutoffDistance: 40, localise: true, importance: .5 } },
      limits: { maxVoices, maxHrtfVoices: maxHrtf, maxSources: 32, raysPerPump: Math.floor(r() * 4), maxLateness: r() * .3, rotateAfter: r() < .5 ? Infinity : r() * .5, stealRatio: 1 + r() * 2 },
      occlusion: { query: () => (r() < .3 ? r() * 10 : null), unknown: r() < .5 ? 'blocked' : 'open' } });
    const ids: number[] = [], controllers: AbortController[] = [];
    let t = 0, pump = 1 / 60;
    for (let step = 0; step < 300; step++) {
      const x = r();
      if (x < .35) {
        const c = new AbortController(); controllers.push(c);
        const p: [number, number, number] = [r() * 30 - 15, 0, r() * 30 - 15];
        const id = audio.emit({ cue: `k${step}`, class: 'abc'[Math.floor(r() * 3)], position: p, importance: r() < .3 ? () => r() * 2 : undefined, every: r() < .5 ? .05 + r() * .5 : undefined, carryLate: r() < .3, signal: hostile && r() < .5 ? c.signal : undefined }, t);
        if (id) ids.push(id);
      } else if (hostile && x < .42 && ids.length) audio.cancel(ids[Math.floor(r() * ids.length)]);
      else if (hostile && x < .47 && controllers.length) controllers[Math.floor(r() * controllers.length)].abort();
      else if (hostile && x < .5 && ids.length) { const id = ids[Math.floor(r() * ids.length)]; reentrant = () => { audio.cancel(id); reentrant = null; }; }
      else {
        pump = r() < .05 ? r() : r() * .05; t += pump; out.time = t; audio.pump(t, origin); reentrant = null;
        const live = out.live().length, st = audio.stats;
        assert.ok(live <= maxVoices, `seed ${seed} step ${step}: ${live} voices > ${maxVoices}`);
        assert.equal(st.voices, live, `seed ${seed} step ${step}: stats.voices`); assert.ok(st.fading <= st.voices);
        assert.ok(out.hrtf() <= maxHrtf, `seed ${seed} step ${step}: ${out.hrtf()} HRTF > ${maxHrtf}`);
      }
    }
    // Sources stay within every class cutoff here, so without hostile events each cut must have its replacement.
    // (Cuts in the last 1.1 s of the run have no time left for their replacement before cancel-all.)
    if (!hostile) for (const v of out.voices.filter(w => w.cutAt !== null && w.cutAt < t - 1.1)) assert.ok(out.voices.some(w => w !== v && w.startT >= v.cutAt! && w.startT <= v.cutAt! + 1.1), `seed ${seed}: voice cut at ${v.cutAt} not replaced`);
    for (const id of ids) audio.cancel(id);
    for (let k = 0; k < 10; k++) { t += .02; out.time = t; audio.pump(t, origin); }
    assert.equal(out.live().length, 0, `seed ${seed}: leaked after cancel-all`); assert.equal(audio.stats.sources, 0);
    audio.dispose(); assert.equal(out.live().length, 0, `seed ${seed}: leaked after dispose`);
  }
});

// Round-4 re-verification regressions (PR #55).
const gunRing = (k: number, c: number, r: number): [number, number, number] => [Math.cos(2 * Math.PI * k / c) * r, 0, Math.sin(2 * Math.PI * k / c) * r];

test('by default nothing plays late: 8 equal guns every 0.1 s on 4 voices start within maxLateness, and stats account for every beat', () => {
  const out = timedOutput(() => .3); const audio = createSpatialAudio({ output: out, classes: flat, limits: { maxVoices: 4 } });
  const t0 = (j: number) => j * .007;
  for (let j = 0; j < 8; j++) audio.emit({ cue: String(j), class: 'weak', position: gunRing(j, 8, 6), every: .1 }, t0(j));
  for (let i = 0; i <= 600; i++) { out.time = i / 60; audio.pump(i / 60, origin); }
  const st = audio.stats;
  assert.deepEqual([st.late, st.skipped], [0, 0]);
  // Every beat either started a voice, was dropped (never played), or is still waiting.
  // (Beats within a float error of the last pump at 10 s may or may not be due yet, and a source whose emission is
  // still waiting schedules its next beat when that one settles: at most one such beat per waiting source.)
  const beats = (end: number) => Array.from({ length: 8 }, (_, j) => Math.floor((end - t0(j)) / .1) + 1).reduce((a, b) => a + b);
  const accounted = out.voices.length + st.dropped + st.waiting;
  assert.ok(accounted + st.waiting >= beats(9.999) && accounted <= beats(10.001), `${accounted} accounted (+${st.waiting} pending), ${beats(9.999)}..${beats(10.001)} beats`);
  // A start is at most maxLateness after its beat, and never a beat behind (the rhythm is never shifted).
  for (const v of out.voices) { const j = +v.cue, lag = v.startT - t0(j) - Math.floor((v.startT - t0(j) + 1e-9) / .1) * .1; assert.ok(lag <= .15 + 1e-9, `lag ${lag}`); }
});

test('carryLate is opt-in and bounded to one interval: the late emission starts when a slot frees, counted in late, not dropped', () => {
  for (const carryLate of [false, true]) {
    const out = timedOutput(); let queries = 0;
    const audio = createSpatialAudio({ output: out, classes: flat, limits: { maxVoices: 1, raysPerPump: 1 }, occlusion: { query: () => { queries++; return null; }, unknown: 'blocked' } });
    audio.emit({ cue: 'A', class: 'weak', position: [2, 0, 0] }, 0); out.time = 0; audio.pump(0, origin);
    audio.emit({ cue: 'B', class: 'weak', position: [0, 0, 2], every: .5, carryLate }, 0);
    for (let i = 1; i <= 120; i++) { out.time = i / 60; if (i === 78) out.voices[0].stop(); audio.pump(i / 60, origin); }
    const b = out.voices.filter(v => v.cue === 'B');
    if (carryLate) {
      // Beats 0 and .5 waited one interval each and were dropped; beat 1.0 carried and started when A stopped at 1.3.
      assert.equal(+b[0].startT.toFixed(3), 1.3); assert.ok(b[0].startT - 1 <= .5, 'at most one interval late');
      assert.deepEqual([audio.stats.dropped, audio.stats.late], [2, 1]);
      // The carried emission kept its ray priority while waiting: it started with its own (open) result.
      assert.equal(b[0].options.filter!.gain, 1);
    } else {
      assert.equal(+b[0].startT.toFixed(3), 1.5, 'the next beat, on time'); assert.deepEqual([audio.stats.dropped, audio.stats.late], [3, 0]);
    }
    assert.ok(queries > 0);
  }
});

test('localised repeats at the HRTF cap start on their beat (no fade-first wait) without per-emission flips', () => {
  for (const maxHrtfVoices of [6, 8]) {
    const out = timedOutput(() => .3); let peak = 0;
    const audio = createSpatialAudio({ output: out, classes: { shot: { refDistance: 2, cutoffDistance: 80, importance: 2, localise: true } }, limits: { maxVoices: 24, maxHrtfVoices } });
    for (let j = 0; j < 8; j++) audio.emit({ cue: String(j), class: 'shot', position: gunRing(j, 8, 6 + j), every: .1 }, 0);
    for (let i = 0; i <= 600; i++) { out.time = i / 60; audio.pump(i / 60, origin); peak = Math.max(peak, out.hrtf()); }
    const lags = out.voices.map(v => ((v.startT % .1) + .1) % .1).map(l => l > .1 - 1e-9 ? 0 : l).sort((a, b) => a - b);
    assert.ok(lags[lags.length >> 1] <= 1 / 60 + 1e-9, `p50 lag ${lags[lags.length >> 1]}`);
    assert.ok(peak <= maxHrtfVoices, `peak HRTF ${peak}`);
    const flips = Array.from({ length: 8 }, (_, j) => { const p = out.voices.filter(v => v.cue === String(j)).map(v => v.panning); return p.slice(1).filter((m, k) => m !== p[k]).length; });
    // At most about one switch per HRTF hold (1 s) per source, against one per emission without hysteresis.
    assert.ok(Math.max(...flips) <= 10, `flips ${flips}`);
    assert.ok(out.voices.filter(v => v.panning === 'HRTF').length > 200, 'spare HRTF capacity is still used');
  }
});

test('a reservation survives a pump gap over 1 s: the slot that frees on that pump is used before the timeout is checked', () => {
  const out = timedOutput(); const audio = createSpatialAudio({ output: out, classes: flat, limits: { maxVoices: 1 } });
  audio.emit({ cue: 'A', class: 'weak', position: [2, 0, 0] }, 0); audio.pump(0, origin);
  audio.emit({ cue: 'S', class: 'strong', position: [2, 0, 0] }, .1); out.time = .1; audio.pump(.1, origin);
  assert.equal(audio.stats.stolen, 1);
  out.time = 1.6; audio.pump(1.6, origin);   // a hidden tab: the next pump is 1.5 s later
  assert.ok(out.voices.some(v => v.cue === 'S'), 'the stealer started'); assert.deepEqual([audio.stats.dropped, audio.stats.late], [0, 1]);
});

test('rotation stays inside the 1% tie band: a 1.2x stronger sound below stealRatio does not rotate a voice out', () => {
  const out = timedOutput(); const audio = createSpatialAudio({ output: out, classes: flat, limits: { maxVoices: 1, rotateAfter: .25 } });
  audio.emit({ cue: 'amb', class: 'weak', position: [2, 0, 0] }, 0); audio.pump(0, origin);
  for (let i = 1; i <= 300; i++) {
    out.time = i / 60;
    if (i % 24 === 0) audio.emit({ cue: 'step', class: 'weak', position: [0, 0, 2], importance: () => 1.2 }, i / 60);
    audio.pump(i / 60, origin);
  }
  assert.equal(out.voices[0].cutAt, null, 'the ambient voice is never rotated out'); assert.equal(audio.stats.rotated, 0);
});

test('skipped counts beats lost to a pump gap; the source plays once and keeps its rhythm from then', () => {
  const out = timedOutput(); const audio = createSpatialAudio({ output: out, classes: flat });
  audio.emit({ cue: 'r', class: 'weak', position: [2, 0, 0], every: .5 }, 0); audio.pump(0, origin);
  out.time = 2; audio.pump(2, origin);
  assert.deepEqual([out.voices.length, audio.stats.skipped, audio.stats.dropped, audio.stats.late], [2, 3, 0, 0]);
});
