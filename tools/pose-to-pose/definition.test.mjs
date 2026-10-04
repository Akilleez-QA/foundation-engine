import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DefinitionError, loadDefinition, parseDefinition} from './definition.mjs';

const robot = new URL('./examples/robot/animations.json', import.meta.url).pathname;
const base = clip => ({schema: 1, fps: 30, clips: {c: clip}});
const pose = (p, more = {}) => ({pose: p, ...more});
const rejects = (clip, pattern) => assert.throws(() => parseDefinition(base(clip)), pattern);

test('the robot definition expands its mirrored walk into a closed four-key-pose loop', () => {
  const def = loadDefinition(robot);
  const walk = def.clips.walk;
  assert.equal(walk.playback, 'loop');
  assert.equal(walk.frames, 32);
  assert.deepEqual(
    walk.keys.map(k => `${k.pose}${k.mirror ? '~' : ''}@${k.frame}`),
    [
      'walk_contact@0',
      'walk_down@3',
      'walk_passing@8',
      'walk_up@12',
      'walk_contact~@16',
      'walk_down~@19',
      'walk_passing~@24',
      'walk_up~@28',
      'walk_contact@32',
    ],
  );
  assert.deepEqual(
    walk.events.map(e => [e.name, e.frame]),
    [
      ['step_L', 3],
      ['step_R', 19],
    ],
  );
  assert.equal(def.clips.wave.playback, 'hold');
  assert.equal(def.clips.wave.frames, 18);
  assert.equal(def.clips.walk_turn_left.rootMotion.yawPerCycle, 20);
  assert.equal(def.clips.walk_turn_right.rootMotion.yawPerCycle, -20);
  assert.equal(def.clips.walk_turn_right.frames, 32);
});

test('a loop must end on its first pose, and a mirrored half cycle on the mirror of it', () => {
  rejects({playback: 'loop', keys: [pose('a'), pose('b', {frames: 4})]}, /must end on its first pose/);
  rejects(
    {playback: 'loop', repeatMirrored: true, keys: [pose('a'), pose('b', {frames: 4})]},
    /end on the mirror of its first pose/,
  );
  rejects(
    {playback: 'once', repeatMirrored: true, keys: [pose('a'), pose('a', {mirror: true, frames: 4})]},
    /set playback: loop/,
  );
});

test('segment timing, speed, trim and fps are explicit', () => {
  rejects({playback: 'once', keys: [pose('a'), pose('b')]}, /exactly one of frames or seconds/);
  rejects({playback: 'once', keys: [pose('a', {frames: 2}), pose('b', {frames: 2})]}, /first key starts the clip/);
  rejects({playback: 'once', keys: [pose('a'), pose('b', {seconds: 0.11})]}, /land on whole frames/);
  rejects({playback: 'once', fps: 24, keys: [pose('a'), pose('b', {frames: 3})]}, /resample the clip/);
  rejects({playback: 'loop', trim: {start: 1}, keys: [pose('a'), pose('a', {frames: 3})]}, /a loop cannot be trimmed/);
  // Reference recorded at half speed, retimed with a global speed scale, then trimmed to game length.
  const def = parseDefinition(
    base({playback: 'once', speed: 2, trim: {start: 0, end: 8}, keys: [pose('a'), pose('b', {frames: 24})]}),
  );
  assert.equal(def.clips.c.frames, 8);
  assert.equal(def.clips.c.duration, 8 / 30);
  assert.deepEqual(def.clips.c.keys, [{pose: 'a', mirror: false, frame: 0}]);
});

test('events are named seconds with derived frames, inside the clip', () => {
  const def = parseDefinition(
    base({playback: 'once', keys: [pose('a'), pose('b', {frames: 15})], events: [{name: 'impact', at: 0.42}]}),
  );
  assert.deepEqual(def.clips.c.events, [{name: 'impact', at: 0.42, frame: 13, floor: []}]);
  rejects(
    {playback: 'once', keys: [pose('a'), pose('b', {frames: 15})], events: [{name: 'x', at: 0.5}]},
    /at is seconds/,
  );
  rejects(
    {
      playback: 'once',
      keys: [pose('a'), pose('b', {frames: 15})],
      events: [
        {name: 'x', at: 0},
        {name: 'x', at: 0.1},
      ],
    },
    /unique/,
  );
});

test('unknown fields and easings are rejected with the clip and key named', () => {
  rejects({playback: 'once', keys: [pose('a'), pose('b', {frames: 2, ease: 'linear'})]}, /key 1: unknown fields ease/);
  rejects({playback: 'once', keys: [pose('a'), pose('b', {frames: 2, easing: 'bounce'})]}, /key 1: easing/);
  rejects({playback: 'sometimes', keys: [pose('a'), pose('b', {frames: 2})]}, /playback is loop, once or hold/);
  rejects({playback: 'once', loop: true, keys: [pose('a'), pose('b', {frames: 2})]}, /unknown fields loop/);
  assert.ok(
    parseDefinition(
      base({playback: 'once', keys: [pose('a'), pose('b', {frames: 2, easing: {bezier: [0.3, 0, 0.2, 1.4]}})]}),
    ),
  );
  assert.throws(() => parseDefinition({schema: 2, clips: {}}), DefinitionError);
});
