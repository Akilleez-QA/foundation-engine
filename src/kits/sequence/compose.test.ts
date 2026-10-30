import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, defineSystem, Name, testScene, Transform} from '../../author';
import type {CueVoiceOptions} from '../../platform/audio/audio-output';
import {cameraSystem} from '../camera/index';
import {createCueMixer} from '../audio-mixer/index';
import {createSequence, defineSequence, type SequenceEvent} from './index';

const def = defineSequence({
  id: 'arrival',
  tracks: [
    {id: 'camera', cues: [{id: 'dolly', ticks: 60}]},
    {id: 'sound', cues: [{id: 'horn', ticks: 0, after: ['dolly']}]},
    {id: 'world', cues: [{id: 'unlock', ticks: 0, after: ['dolly'], effect: 'door-unlocked'}]},
  ],
});

function setup() {
  const played: string[] = [];
  const mixer = createCueMixer({
    output: {
      playVoice(cue: string, o: CueVoiceOptions = {}) {
        played.push(cue);
        const voice = {ended: false, stop: () => o.onEnded?.(), setGain() {}};
        return voice;
      },
    },
    maxLogical: 4,
    maxAudible: 2,
  });
  const run = createSequence(def, 'visit-1');
  const world = {unlocked: 0};
  let skipRequested = false;
  const apply = (events: readonly SequenceEvent[], now: number) => {
    for (const e of events) {
      if (e.kind === 'start' && e.track === 'sound') mixer.request({cue: e.cue, expiresAt: now + 1}, now);
      if (e.kind === 'effect' && e.effect === 'door-unlocked') world.unlocked++;
    }
    mixer.pump(now);
  };
  const director = defineSystem({
    id: 'arrival-director',
    run(ctx) {
      if (skipRequested) {
        skipRequested = false;
        apply(run.skip().events, ctx.time.t);
      } else apply(run.advance(1).events, ctx.time.t);
    },
  });
  // The camera kit stays the camera owner; the sequence only supplies the interpolation parameter.
  const camera = cameraSystem('fixed', {
    smooth: 0,
    lookAt: [0, 0, 0],
    options: () => {
      const a = run.active('camera')?.alpha ?? 1;
      return {position: [0, 10 - 6 * a, 20 - 12 * a]};
    },
  });
  const scene = defineScene({
    id: 'arrival',
    title: 'Arrival',
    entities: [[Name({name: 'player'}), Transform({})]],
    systems: [director, camera],
  });
  return {scene, run, played, world, skip: () => (skipRequested = true)};
}

test('a fixed-step system drives the sequence, the camera kit follows cue alpha and audio cues play once', async () => {
  const f = setup();
  const t = await testScene(f.scene);
  t.run(0.5);
  const mid = t.ctx.view.camera.position;
  assert.ok(mid[1] < 10 && mid[1] > 4, `camera part-way: ${mid}`);
  t.run(1);
  assert.deepEqual(t.ctx.view.camera.position, [0, 4, 8]);
  assert.deepEqual(f.played, ['horn']);
  assert.equal(f.world.unlocked, 1);
  assert.equal(f.run.status, 'finished');
});

test('skipping lands the gameplay effect once and plays no presentation cue', async () => {
  const f = setup();
  const t = await testScene(f.scene);
  t.run(0.25);
  f.skip();
  t.run(1);
  assert.deepEqual(f.played, []);
  assert.equal(f.world.unlocked, 1);
  assert.equal(f.run.status, 'skipped');
  assert.deepEqual(t.ctx.view.camera.position, [0, 4, 8], 'the camera lands on the final framing');
});
