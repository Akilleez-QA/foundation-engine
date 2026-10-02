import test from 'node:test';
import assert from 'node:assert/strict';
import { defineAsset, defineGame, defineScene, validatePlayOptions } from './defs';
import { defineBuild } from './build';
import { compileGame } from './compile';
import { testScene } from './testing';

const brief = defineBuild({ goal: 'Play a sound', pitch: 'Sound files', genre: 'custom', coreLoop: ['Listen'],
  devices: { targets: ['desktop'], minimum: 'desktop', input: ['keyboard'] }, success: [{ id: 'S1', check: 'A sound plays', how: 'manual' }] });
const chime = defineAsset({ id: 'chime', type: 'audio', url: '/sounds/chime.ogg', licence: 'CC0-1.0', author: 'Tests', source: 'generated' });

test('play options are checked field by field', () => {
  for (const ok of [undefined, {}, { volume: 0 }, { volume: 1, pitch: .25 }, { pitch: 4, position: [1, 2, 3] as [number, number, number] }]) validatePlayOptions(ok);
  for (const [bad, field] of [[{ volume: 1.2 }, /volume/], [{ volume: NaN }, /volume/], [{ pitch: .1 }, /pitch/], [{ pitch: 5 }, /pitch/],
    [{ position: [0, 0] }, /position/], [{ position: [0, Infinity, 0] }, /position/], [null, /object/]] as const)
    assert.throws(() => validatePlayOptions(bad as never), field);
});

test('an audio asset is an mp3, m4a, ogg or wav file', () => {
  for (const url of ['/a.mp3', '/a.m4a', '/a.ogg', '/a.WAV']) defineAsset({ id: 'a', type: 'audio', url, licence: 'CC0-1.0', author: 'x', source: 'y' });
  assert.throws(() => defineAsset({ id: 'a', type: 'audio', url: '/a.flac', licence: 'CC0-1.0', author: 'x', source: 'y' }), /mp3, m4a, ogg or wav/);
});

test('a scene\'s sounds must name audio assets of the game', () => {
  const scene = defineScene({ id: 'start', title: 'Start', sounds: ['chime'] });
  const game = defineGame({ id: 'sound-game', title: 'Sound', version: '1.0.0', firstScene: 'start' });
  assert.doesNotThrow(() => compileGame({ brief, game, defs: [scene, chime] }));
  assert.throws(() => compileGame({ brief, game, defs: [scene] }), /sound 'chime' has no defineAsset\(\{ type: 'audio' \}\)/);
  assert.throws(() => defineScene({ id: 'start', title: 'Start', sounds: ['Not Kebab'] }), /kebab/);
});

test('testScene records plays with their options and refuses what the runtime refuses', async () => {
  const t = await testScene(defineScene({ id: 'start', title: 'Start', enter(ctx) { ctx.play('chime', { volume: .5, position: [1, 0, 2] }); ctx.play('ui.click'); } }));
  assert.deepEqual(t.plays, [{ id: 'chime', options: { volume: .5, position: [1, 0, 2] } }, { id: 'ui.click' }]);
  assert.deepEqual(t.cues, ['chime', 'ui.click']);
  assert.throws(() => t.ctx.play('chime', { pitch: 9 }), /pitch/);
});

test('testScene records playVoice with its full options and refuses what the audio output refuses', async () => {
  const position = new Float32Array([3, 1, -4]) as unknown as [number, number, number];   // any array-like of three, as the output accepts
  let ended = 0;
  const t = await testScene(defineScene({ id: 'start', title: 'Start', enter(ctx) {
    const voice = ctx.playVoice('chime', {
      variant: 2, gain: .4, rate: 1.5, wait: 250, at: 12.5, onEnded: () => { ended++; },
      spatial: { position, refDistance: 2, maxDistance: 40, rolloffFactor: 1.5, panning: 'HRTF', distanceModel: 'linear', cutoffDistance: 30, smoothing: .05 },
      filter: { cutoffHz: 800, gain: .7 },
    });
    assert.equal(voice, null, 'a headless voice never plays');
    ctx.playVoice('ui.click');
  } }));
  position[0] = 99;   // the record is a copy, not the caller's buffer
  assert.deepEqual(t.voices, [
    { id: 'chime', options: {
      variant: 2, gain: .4, rate: 1.5, wait: 250, at: 12.5,
      spatial: { position: [3, 1, -4], refDistance: 2, maxDistance: 40, rolloffFactor: 1.5, panning: 'HRTF', distanceModel: 'linear', cutoffDistance: 30, smoothing: .05 },
      filter: { cutoffHz: 800, gain: .7 },
    } },
    { id: 'ui.click' },
  ]);
  assert.deepEqual(t.cues, ['chime', 'ui.click'], 'cues keeps its id-only shape');
  assert.equal(ended, 0);
  for (const [bad, message] of [
    [{ gain: 1.5 }, /gain/], [{ rate: 8 }, /rate/], [{ wait: -1 }, /wait/], [{ at: -2 }, /start time/], [{ variant: .5 }, /variant/],
    [{ spatial: { position: [0, 0] } }, /position/], [{ spatial: { position: [0, 0, 0], panning: 'binaural' } }, /spatial/],
    [{ spatial: { position: [0, 0, 0], refDistance: 5, cutoffDistance: 2 } }, /spatial/], [{ filter: { cutoffHz: 2 } }, /filter/],
  ] as const) assert.throws(() => t.ctx.playVoice('chime', bad as never), message);
  assert.equal(t.voices.length, 2, 'a refused voice is not recorded');
  // Normalised as the audio output normalises: the first three entries of an array-like; undefined fields dropped.
  t.ctx.playVoice('chime', { variant: undefined, gain: .5, spatial: { position: [1, 2, 3, 4] as unknown as [number, number, number], panning: undefined } });
  assert.deepEqual(t.voices[2], { id: 'chime', options: { gain: .5, spatial: { position: [1, 2, 3] } } });
  assert.deepEqual(Object.keys(t.voices[2].options!), ['gain', 'spatial']);
});
