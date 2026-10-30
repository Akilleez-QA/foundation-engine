import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {clipEvents, clipRootMotion, manifestClip} from './clip-events.ts';

const manifest = name => JSON.parse(readFileSync(new URL(`./public/models/${name}.clips.json`, import.meta.url)));

test('the strike impact marker fires once, at its clip time, on the clip clock', () => {
  const strike = manifestClip(manifest('pose-bug'), 'strike');
  const track = clipEvents(strike, 'bug-strike-1');
  const fired = [];
  for (let frame = 1; frame <= 70; frame++) fired.push(...track.advance(frame / 60)); // past the end: clamped
  assert.deepEqual(
    fired.map(e => [e.marker, e.at]),
    [
      ['impact', 0.4333],
      ['planted', 0.4333],
    ],
  );
  assert.equal(fired[0].key, JSON.stringify(['bug-strike-1', 0, 'impact']));
  // A second playing is a new action: its occurrences have their own keys.
  const again = clipEvents(strike, 'bug-strike-2').advance(1);
  assert.equal(again[0].key, JSON.stringify(['bug-strike-2', 0, 'impact']));
});

test('loop events repeat every cycle; the event at time zero fires at each loop boundary', () => {
  const scuttle = manifestClip(manifest('pose-bug'), 'scuttle');
  const track = clipEvents(scuttle, 'bug-scuttle');
  const fired = track.advance(scuttle.duration * 2.5).map(e => `${e.marker}@${e.cycle}`);
  assert.deepEqual(fired, ['step_B@0', 'step_A@1', 'step_B@1', 'step_A@2', 'step_B@2']);
});

test('the walk root motion moves one stride per cycle, forward along +z', () => {
  const walk = manifestClip(manifest('pose-robot'), 'walk');
  const motion = clipRootMotion(walk);
  const d = motion.advance(walk.duration);
  assert.ok(Math.abs(d.z - 1) < 1e-9 && Math.abs(d.x) < 1e-9 && d.yaw === 0);
  const turn = clipRootMotion(manifestClip(manifest('pose-robot'), 'walk_turn_left')).advance(walk.duration);
  assert.ok(Math.abs(turn.yaw - (20 * Math.PI) / 180) < 1e-6 && turn.x > 0, 'a left turn curves toward +x');
});
