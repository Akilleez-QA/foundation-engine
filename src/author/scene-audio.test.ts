import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSceneVoices} from './scene-audio';
test('teardown blocks reentrant playback and stops every handle despite failure', () => {
  let created = 0,
    stopped = 0;
  const owner = createSceneVoices((_cue, options) => {
    created++;
    return {
      ended: false,
      setGain: () => {},
      stop: () => {
        stopped++;
        options.onEnded?.();
        if (stopped === 1) throw Error('backend');
      },
    };
  });
  owner.play('a', {
    onEnded: () => {
      assert.equal(owner.play('late'), null);
    },
  });
  owner.play('b');
  assert.throws(() => owner.dispose(), AggregateError);
  owner.dispose();
  assert.equal(created, 2);
  assert.equal(stopped, 2);
  assert.equal(owner.play('c'), null);
});

test('scene music: voices are owned like cue voices and stopped on exit; testScene records songs silently', async () => {
  const {createSceneVoices} = await import('./scene-audio');
  const {testScene, defineScene} = await import('./index');
  type Song = {ended: boolean; stop(): void};
  const made: Song[] = [];
  const songs = createSceneVoices<Song, {at?: number; onEnded?: () => void}>(() => {
    const s = {
      ended: false,
      stop() {
        s.ended = true;
      },
    };
    made.push(s);
    return s;
  });
  songs.play('song', {at: 3});
  songs.play('other');
  songs.dispose();
  assert.deepEqual(
    made.map(s => s.ended),
    [true, true],
  );
  assert.equal(songs.play('late'), null, 'closed after exit');
  const scene = await testScene(
    defineScene({
      id: 'music',
      title: 'music',
      entities: [],
      enter(ctx) {
        ctx.playMusic('song', {at: 2, loop: {start: 4}});
      },
    }),
  );
  assert.deepEqual(scene.music, [{id: 'song', options: {at: 2, loop: {start: 4}}}]);
  assert.equal(await scene.ctx.loadMusic('song'), false, 'headless: nothing to decode on');
  scene.dispose();
});
