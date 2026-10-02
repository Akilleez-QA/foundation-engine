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
