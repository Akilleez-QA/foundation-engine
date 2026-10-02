import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioTimeline, defineScene, defineSystem, testScene, type AudioClockReading, type AudioTimeline, type SceneContext } from './index';

/**
 * The recipe's shape, through the author API only: a scene owns an audio timeline, schedules four cues on it,
 * pumps it from a frame system, plays each cue at its context time, and grades a press by its own timestamp.
 */
function syncedScene(log: { cues: { cue: string; at: number | undefined }[]; grades: number[] }) {
  let timeline: AudioTimeline<string> | null = null;
  const pump = defineSystem({ id: 'music-clock', phase: 'frame', run(ctx) {
    timeline!.pump();
    const pressedAt = ctx.input.pressedAt('hit');
    if (pressedAt !== null) {
      const heard = timeline!.inputPosition(pressedAt);
      const nearest = Math.round(heard / .5) * .5;
      log.grades.push(Math.round((heard - nearest) * 1000));
    }
  } });
  return defineScene({
    id: 'synced', title: 'synced', systems: [pump],
    enter(ctx: SceneContext) {
      timeline = createAudioTimeline<string>({
        read: () => ctx.audioClock(), now: () => ctx.time.now, calibration: { inputMs: 20, visualMs: 0 },
        dispatch: e => { log.cues.push({ cue: e.payload, at: e.when ?? undefined }); ctx.playVoice(e.payload, { at: e.when ?? undefined }); },
      });
      for (let i = 1; i <= 4; i++) timeline.schedule(i * .5, 'ui.count');
      timeline.start(0);
    },
    exit() { timeline?.dispose(); timeline = null; },
  });
}

test('a scene syncs cues and grades presses on the audio clock through the author API', async () => {
  // A running context whose clock started 3 s before the visit, heard 25 ms after it renders.
  const audioClock = (pageMs: number): AudioClockReading => ({ currentTime: 3 + pageMs / 1000, performanceTime: pageMs, outputLatency: .02, baseLatency: .005, output: null });
  const log = { cues: [] as { cue: string; at: number | undefined }[], grades: [] as number[] };
  const scene = await testScene(syncedScene(log), { audioClock });
  scene.run(1);
  assert.equal(scene.cues.length, 2, 'cues within the lookahead of 1.0 s are dispatched');
  assert.deepEqual(log.cues.map(c => +c.at!.toFixed(6)), [3.5, 4], 'each cue starts at its exact context time');
  // The player presses 40 ms after hearing the 1.5 s cue: 1.5 s on the timeline is heard at page 1525 ms.
  scene.run(.5); scene.press('hit', 1525 + 40); scene.run(1 / 60);
  assert.deepEqual(log.grades, [20], 'graded by the press timestamp, minus the 20 ms calibration, not the frame time');
  scene.dispose();
});

test('the same scene runs headless and silent on the page-clock fallback', async () => {
  const log = { cues: [] as { cue: string; at: number | undefined }[], grades: [] as number[] };
  const scene = await testScene(syncedScene(log));
  assert.equal(scene.ctx.audioClock(), null);
  scene.run(2.5);
  assert.deepEqual(log.cues.map(c => c.at), [undefined, undefined, undefined, undefined], 'no context time without audio');
  assert.equal(scene.cues.length, 4);
  scene.press('hit', 1000 + 5); scene.run(1 / 60);
  assert.deepEqual(log.grades, [-15]);
  assert.equal(scene.ctx.input.pressedAt('hit'), null, 'presses last one frame');
  assert.throws(() => scene.press('hit', NaN));
  scene.dispose();
});

test('ctx.time.now is the frame timestamp in milliseconds, and a default press is stamped at it', async () => {
  const seen: { now: number; at: number | null }[] = [];
  const scene = await testScene(defineScene({ id: 'clock', title: 'clock', systems: [defineSystem({ id: 'read', phase: 'frame', run(ctx) { seen.push({ now: ctx.time.now, at: ctx.input.pressedAt('hit') }); } })] }));
  scene.run(1 / 60); scene.press('hit'); scene.press('hit', 999); scene.run(1 / 60);
  assert.equal(seen.length, 2);
  assert.ok(Math.abs(seen[0].now - 1000 / 60) < 1e-9);
  assert.ok(Math.abs(seen[1].at! - 1000 / 60) < 1e-9, 'the first press in a frame wins');
  scene.dispose();
});
