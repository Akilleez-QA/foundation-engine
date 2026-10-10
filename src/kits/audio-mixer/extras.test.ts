import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blendListener,
  createInstanceLimits,
  createMusicClock,
  createMusicDirector,
  createRetrigger,
  dopplerRate,
} from './index';
import {defineScene, defineSystem, Name, testScene, Transform, type Vec3} from '../../author';
import type {CueVoice} from '../../platform/audio/audio-output';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

test('blendListener: position from camera to character, orientation from the camera', () => {
  const camera = {position: [0, 5, 10] as const, target: [0, 1, 0] as const};
  const at = (blend: number) => blendListener({camera, character: [0, 1.6, 0], blend});
  assert.deepEqual(at(0).position, [0, 5, 10]);
  assert.deepEqual(at(1).position, [0, 1.6, 0]);
  assert.deepEqual(at(0.5).position, [0, 3.3, 5]);
  const f = at(1).forward,
    u = at(1).up;
  assert.ok(near(Math.hypot(...f), 1) && near(Math.hypot(...u), 1));
  assert.ok(near(f[0] * u[0] + f[1] * u[1] + f[2] * u[2], 0), 'up is perpendicular to forward');
  const down = blendListener({camera: {position: [0, 10, 0], target: [0, 0, 0]}, character: [0, 0, 0], blend: 0});
  assert.ok(Object.values(down.up).every(Number.isFinite), 'straight-down camera keeps a valid frame');
  for (const blend of [-0.1, 1.1, NaN]) assert.throws(() => at(blend), RangeError);
  assert.throws(() =>
    blendListener({camera: {position: [0, 0, 0], target: [0, 0, 0]}, character: [0, 0, 0], blend: 0}),
  );
});

test('dopplerRate: approaching raises pitch, receding lowers it, clamped and scaled', () => {
  const base = {source: [0, 0, 0] as const, listener: [100, 0, 0] as const};
  assert.equal(dopplerRate({...base, sourceVelocity: [0, 0, 0]}), 1);
  const toward = dopplerRate({...base, sourceVelocity: [34.3, 0, 0]});
  assert.ok(near(toward, 343 / (343 - 34.3)));
  const away = dopplerRate({...base, sourceVelocity: [-34.3, 0, 0]});
  assert.ok(near(away, 343 / (343 + 34.3)));
  assert.equal(dopplerRate({...base, sourceVelocity: [0, 50, 0]}), 1, 'tangential motion has no shift');
  assert.ok(
    near(dopplerRate({...base, sourceVelocity: [0, 0, 0], listenerVelocity: [-34.3, 0, 0]}), (343 + 34.3) / 343),
  );
  assert.equal(dopplerRate({...base, sourceVelocity: [1000, 0, 0]}), 2, 'clamped to max');
  assert.equal(dopplerRate({...base, sourceVelocity: [34.3, 0, 0], factor: 0}), 1);
  assert.equal(dopplerRate({source: [1, 1, 1], listener: [1, 1, 1], sourceVelocity: [9, 9, 9]}), 1, 'coincident');
  assert.throws(() => dopplerRate({...base, sourceVelocity: [0, 0, 0], min: 1.2}), RangeError);
  assert.throws(() => dopplerRate({...base, sourceVelocity: [0, 0, NaN]}), RangeError);
});

test('createRetrigger: rapid triggers climb in pitch, a gap resets, steps are capped', () => {
  const r = createRetrigger({window: 0.5, semitones: 1, maxSteps: 3});
  const rates = [0, 0.2, 0.4, 0.6, 0.8].map(t => r.trigger('coin', t));
  assert.deepEqual(
    rates.map(x => Math.round(Math.log2(x) * 12)),
    [0, 1, 2, 3, 3],
  );
  assert.equal(r.trigger('coin', 2), 1, 'reset after the window');
  assert.equal(r.trigger('gem', 2.1), 1, 'keys are independent');
  assert.equal(r.peek('coin', 2.2), 1);
  assert.throws(() => r.trigger('coin', 1), RangeError, 'time must not go backwards');
  assert.throws(() => createRetrigger({window: 1, semitones: 12, maxSteps: 3}), RangeError, 'beyond two octaves');
  const bounded = createRetrigger({window: 1, semitones: 1, maxSteps: 2, maxKeys: 2});
  bounded.trigger('a', 0);
  bounded.trigger('b', 0);
  bounded.trigger('c', 0);
  assert.equal(bounded.peek('a', 0.1), 0, 'the oldest key was forgotten');
});

function fakeVoice(): CueVoice & {stopped: boolean} {
  let ended = false;
  return {
    stopped: false,
    get ended() {
      return ended;
    },
    setGain() {},
    stop() {
      ended = true;
      this.stopped = true;
    },
  };
}

test('createInstanceLimits: per-key caps with oldest-steal or refuse; ended voices free slots', () => {
  const steal = createInstanceLimits({limits: {explosion: 2}, defaultLimit: 4, policy: 'oldest'});
  const v = [fakeVoice(), fakeVoice(), fakeVoice()];
  for (const voice of v.slice(0, 2)) {
    assert.equal(steal.admit('explosion'), true);
    steal.track('explosion', voice);
  }
  assert.equal(steal.admit('explosion'), true);
  assert.equal(v[0]!.stopped, true, 'the oldest voice was stopped');
  steal.track('explosion', v[2]!);
  assert.equal(steal.count('explosion'), 2);
  assert.equal(steal.stats.stolen, 1);
  const refuse = createInstanceLimits({defaultLimit: 1, policy: 'refuse'});
  const one = fakeVoice();
  assert.equal(refuse.admit('step'), true);
  refuse.track('step', one);
  assert.equal(refuse.admit('step'), false);
  one.stop();
  assert.equal(refuse.admit('step'), true, 'an ended voice frees its slot');
  refuse.track('step', null);
  assert.throws(() => createInstanceLimits({defaultLimit: 0, policy: 'refuse'}), RangeError);
});

test('music clock: beats, bars and phrases, with exact boundaries', () => {
  const clock = createMusicClock({bpm: 120, beatsPerBar: 4, barsPerPhrase: 4, origin: 1});
  assert.equal(clock.beatAt(2), 2);
  assert.equal(clock.next(1, 'bar'), 1, 'a boundary at now counts');
  assert.equal(clock.next(1, 'bar', true), 3);
  assert.equal(clock.next(1.1, 'beat'), 1.5);
  assert.equal(clock.next(1.1, 'phrase'), 9);
  assert.equal(clock.next(0, 'bar'), 1, 'before the origin');
  assert.deepEqual(clock.position(3.6), {bar: 1, beat: 1, phrase: 0});
  // Accumulated rounding never skips a boundary.
  let t = 1;
  for (let i = 0; i < 1000; i++) t += 0.5;
  assert.equal(clock.next(t, 'beat'), t);
  assert.throws(() => createMusicClock({bpm: 10, origin: 0}), RangeError);
});

test('music director: requests wait for the bar, fade over beats, intensity has hysteresis', () => {
  const clock = createMusicClock({bpm: 120, origin: 0}); // 2 s bars
  const director = createMusicDirector({
    clock,
    stems: ['pads', 'drums', 'lead'],
    states: {
      calm: {stems: {pads: 1}, minIntensity: 0},
      tense: {stems: {pads: 1, drums: 0.8}, minIntensity: 0.4},
      fight: {stems: {pads: 0.5, drums: 1, lead: 1}, minIntensity: 0.8},
    },
    initial: 'calm',
    fadeBeats: 2, // 1 s
  });
  assert.deepEqual(director.pump(0).gains, [1, 0, 0]);
  assert.deepEqual(director.setIntensity(0.5, 0.3), {kind: 'scheduled', state: 'tense', at: 2});
  assert.deepEqual(director.pump(1.9).gains, [1, 0, 0], 'nothing changes before the bar');
  const start = director.pump(2.5);
  assert.deepEqual(start.changes, [{kind: 'started', state: 'tense', at: 2}]);
  assert.ok(near(start.gains[1]!, 0.4), 'halfway through the 1 s fade');
  const settled = director.pump(3.2);
  assert.deepEqual(settled.gains, [1, 0.8, 0]);
  assert.deepEqual(settled.changes, [{kind: 'settled', state: 'tense', at: 3}]);
  assert.equal(director.setIntensity(0.37, 3.3), null, 'within the hysteresis band below tense');
  assert.deepEqual(director.setIntensity(0.3, 3.4), {kind: 'scheduled', state: 'calm', at: 4});
  assert.equal(director.request('tense', 3.5), null, 'requesting the current state cancels the pending change');
  assert.equal(director.pending, null);
  director.request('fight', 3.6, {quantum: 'phrase'});
  assert.equal(director.pump(7.9).changes.length, 0);
  assert.equal(director.pump(8).changes[0]?.state, 'fight', 'phrase boundary at 8 s');
  assert.throws(() => director.pump(7), RangeError, 'time is nondecreasing');
  assert.throws(
    () => createMusicDirector({clock, stems: ['a'], states: {x: {stems: {b: 1}}}, initial: 'x'}),
    RangeError,
    'unknown stem',
  );
});

test('composition: a scene hears from a blended listener and escalates pickup pitch', async () => {
  const retrigger = createRetrigger({window: 0.3, semitones: 2, maxSteps: 4});
  const rates: number[] = [];
  const scene = defineScene({
    id: 'audio',
    title: 'Audio',
    entities: [[Name({name: 'player'}), Transform({x: 2})]],
    systems: [
      defineSystem({
        id: 'listener',
        phase: 'frame',
        run(ctx) {
          const tr = ctx.world.get(ctx.named('player')!, Transform)!;
          ctx.view.listener = blendListener({
            camera: ctx.view.camera,
            character: [tr.x, tr.y + 1.6, tr.z],
            blend: 0.75,
          }) as {position: Vec3; forward: Vec3; up: Vec3};
        },
      }),
      defineSystem({
        id: 'pickups',
        run(ctx) {
          if (ctx.time.frame % 10 === 0) rates.push(retrigger.trigger('pickup', ctx.time.t));
        },
      }),
    ],
  });
  const t = await testScene(scene);
  t.run(0.5);
  const l = t.ctx.view.listener!;
  assert.ok(near(l.position[0], 1.5) && near(l.position[1], 8 * 0.25 + 1.6 * 0.75));
  assert.ok(rates.length >= 3 && rates[2]! > rates[1]! && rates[1]! > rates[0]!);
});

test('review regressions: stale keys, intensity ladder, due changes, read-only named, track caps, top-down frame', () => {
  const limits = createInstanceLimits({defaultLimit: 1, policy: 'refuse', maxKeys: 2});
  const a = fakeVoice(),
    b = fakeVoice();
  limits.admit('a');
  limits.track('a', a);
  limits.admit('b');
  limits.track('b', b);
  a.stop();
  b.stop();
  assert.equal(limits.admit('c'), true, 'keys whose voices all ended are swept');
  const capped = createInstanceLimits({defaultLimit: 1, policy: 'refuse'});
  const first = fakeVoice(),
    second = fakeVoice();
  capped.admit('k');
  capped.admit('k');
  capped.track('k', first);
  capped.track('k', second);
  assert.equal(second.stopped, true, 'track enforces the cap when admit was called twice');
  assert.equal(capped.count('k'), 1);

  const clock = createMusicClock({bpm: 120, origin: 0});
  const director = createMusicDirector({
    clock,
    stems: ['a', 'b'],
    states: {
      calm: {stems: {a: 1}, minIntensity: 0},
      victory: {stems: {b: 1}},
      combat: {stems: {a: 1, b: 1}, minIntensity: 0.6},
    },
    initial: 'calm',
  });
  assert.equal(director.setIntensity(0.1, 0), null, 'a state without minIntensity never joins the ladder');
  const ladder = createMusicDirector({
    clock,
    stems: ['a'],
    states: {calm: {stems: {a: 1}}, combat: {stems: {a: 0.5}, minIntensity: 0.6}},
    initial: 'calm',
  });
  assert.equal(ladder.setIntensity(0.1, 0), null, 'below every rung nothing changes');
  director.request('combat', 0.5); // due at 2
  assert.equal(director.request('calm', 2.5)?.at, 4, 'the due change started first; calm is scheduled after it');
  assert.equal(director.state, 'combat');
  assert.deepEqual(director.named(100), director.named(100), 'named does not advance or mutate');
  assert.doesNotThrow(() => director.pump(3));
  const down = blendListener({camera: {position: [0, 10, 0], target: [0, 0, 0]}, character: [0, 0, 0], blend: 0});
  assert.deepEqual(down.up, [0, 0, -1], 'matches a look-at camera looking down, so screen right is audio right');
  const r = createRetrigger({window: 1, semitones: 1, maxSteps: 2});
  r.trigger('x', 10);
  r.reset();
  assert.doesNotThrow(() => r.trigger('x', 0), 'a full reset accepts a restarted timebase');
});
