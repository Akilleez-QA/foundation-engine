import test from 'node:test';
import assert from 'node:assert/strict';
import { createCueMixer, createDucking } from './index';
import { defineScene, testScene } from '../../author';
import type { CueVoiceOptions } from '../../platform/audio/audio-output';
const cue = (cue = 'a', priority = 0, expiresAt = 10) => ({ cue, priority, expiresAt });
function setup(fails = false) {
  const voices: { cue: string; gain: number; ended: boolean; stop(): void; setGain(v: number): void }[] = [];
  const mixer = createCueMixer({ output: { playVoice(cue: string, o: CueVoiceOptions = {}) {
    if (fails) return null;
    const voice = { cue, gain: o.gain ?? 1, ended: false,
      stop() { if (voice.ended) return; voice.ended = true; o.onEnded?.(); },
      setGain(v: number) { voice.gain = v; } };
    voices.push(voice); return voice;
  } }, maxLogical: 3, maxAudible: 1 });
  return { mixer, voices };
}
test('logical and audible caps independently bound work until actual completion, not elapsed time', () => {
  const { mixer, voices } = setup();
  mixer.request(cue('a'), 0); mixer.request(cue('b', 5), 0); mixer.request(cue('c'), 0);
  assert.equal(mixer.request(cue(), 0), null); assert.equal(mixer.pump(0), 1); assert.equal(voices[0].cue, 'b');
  assert.deepEqual(mixer.stats, { pending: 2, active: 1, logical: 3 }); assert.equal(mixer.pump(5), 0);
  voices[0].stop(); assert.equal(mixer.pump(5), 1); assert.equal(voices[1].cue, 'a');
  voices[1].stop(); assert.equal(mixer.pump(5), 1); assert.equal(voices[2].cue, 'c');
});
test('pending cancellation, expiry and failed playback release logical slots', () => {
  const { mixer } = setup(true), id = mixer.request(cue(), 0)!;
  assert.equal(mixer.cancel(id), true); mixer.request(cue('a', 0, 1), 0); assert.equal(mixer.pump(1), 0);
  mixer.request(cue(), 1); assert.equal(mixer.pump(1), 0); assert.equal(mixer.stats.logical, 0);
});
test('cancel and dispose stop only owned voices and reject new work', () => {
  const { mixer, voices } = setup(); const id = mixer.request(cue(), 0)!; mixer.pump(0);
  assert.equal(mixer.cancel(id), true); assert.equal(voices[0].ended, true);
  mixer.request(cue(), 0); mixer.pump(0); mixer.dispose(); mixer.dispose();
  assert.equal(voices[1].ended, true); assert.equal(mixer.request(cue(), 0), null); assert.equal(mixer.stats.active, 0);
});
test('ducking affects both playing and subsequent voices without modifying user settings', () => {
  const { mixer, voices } = setup(); mixer.request(cue(), 0); mixer.pump(0);
  const a = mixer.duck(.5), b = mixer.duck(.2); a(); assert.equal(voices[0].gain, .2);
  voices[0].stop(); mixer.request(cue(), 0); mixer.pump(0); assert.equal(voices[1].gain, .2);
  b(); assert.equal(voices[1].gain, 1);
});
test('scheduler rejects invalid budgets, data and backwards clocks', () => {
  assert.throws(() => createCueMixer({ output: { playVoice: () => null }, maxLogical: 1, maxAudible: 2 }));
  const { mixer } = setup(); assert.throws(() => mixer.request(cue('a', NaN), 0)); mixer.pump(1); assert.throws(() => mixer.pump(0));
});
test('duck leases release on abort and dispose, including repeated cleanup', () => {
  const duck = createDucking(), a = new AbortController(), b = new AbortController();
  a.abort(); duck.acquire(.1, a.signal); assert.equal(duck.gain, 1);
  const release = duck.acquire(.4, b.signal); b.abort(); assert.equal(duck.gain, 1); release();
  duck.acquire(.3); duck.dispose(); duck.dispose(); assert.equal(duck.gain, 1);
  assert.throws(() => duck.acquire(.5)); assert.throws(() => createDucking().acquire(NaN));
});

test('a game scene context is the mixer output without importing platform code', async () => {
  const scene = await testScene(defineScene({ id: 'audio-example', title: 'audio.example', entities: [] }));
  const mixer = createCueMixer({ output: scene.ctx, maxLogical: 2, maxAudible: 1 });
  mixer.request(cue('ui.click'), 0); mixer.pump(0);
  assert.deepEqual(scene.cues, ['ui.click']); assert.equal(mixer.stats.active, 0, 'headless scene stays silent');
});

test('disposal during borrowed playback retires the returned voice instead of publishing it', () => {
  let stops = 0;
  const mixer = createCueMixer({ maxLogical: 2, maxAudible: 2, output: { playVoice() {
    mixer.dispose();
    return { ended: false, setGain() {}, stop() { stops++; } };
  } } });
  mixer.request(cue('first'), 0); mixer.request(cue('second'), 0);
  assert.equal(mixer.pump(0), 0);
  assert.equal(stops, 1);
  assert.deepEqual(mixer.stats, { pending: 0, active: 0, logical: 0 });
});

test('playback reentry retains admission and cancellation invalidates ranked requests', () => {
  const played: string[] = [];
  let stopped = 0, first: number, second: number;
  const mixer = createCueMixer({ maxLogical: 2, maxAudible: 1, output: { playVoice(id) {
    played.push(id);
    assert.equal(mixer.request(cue('overflow'), 0), null);
    assert.equal(mixer.pump(0), 0);
    assert.equal(mixer.cancel(first), true);
    assert.equal(mixer.cancel(second), true);
    return { ended: false, setGain() {}, stop() { stopped++; } };
  } } });
  first = mixer.request(cue('first'), 0)!; second = mixer.request(cue('second'), 0)!;
  assert.equal(mixer.pump(0), 0);
  assert.deepEqual(played, ['first']); assert.equal(stopped, 1);
  assert.equal(mixer.stats.logical, 0);
});

test('disposal drains sibling voices and duck leases when a borrowed voice throws', () => {
  const failure = new Error('stop failed');
  const stopped: string[] = [];
  const mixer = createCueMixer({ maxLogical: 2, maxAudible: 2, output: { playVoice(id) {
    return { ended: false, setGain() {}, stop() { stopped.push(id); if (id === 'first') throw failure; } };
  } } });
  const signal = new AbortController(); mixer.duck(.5, signal.signal);
  mixer.request(cue('first'), 0); mixer.request(cue('second'), 0); mixer.pump(0);
  assert.throws(() => mixer.dispose(), (error: unknown) => error instanceof AggregateError && error.errors[0] === failure);
  assert.deepEqual(stopped, ['first', 'second']); assert.equal(mixer.stats.logical, 0);
  assert.throws(() => mixer.duck(.5), /disposed/);
  mixer.dispose(); signal.abort();
});
