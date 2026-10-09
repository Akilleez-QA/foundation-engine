import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameLoop} from '../../core/activity/loop';
import {createClock} from '../../core/clock';
import {createMarkerTrack, type MarkerOccurrence} from './markers';

test('simulation pause at an action boundary permits repeated renders without replaying markers or authority', () => {
  const {clock, driver} = createClock({realNow: () => 0});
  const track = createMarkerTrack(
    {
      id: 'handoff',
      duration: 1,
      markers: [
        {id: 'present-handoff', at: 0.125},
        {id: 'present-next', at: 0.25},
      ],
    },
    {action: 'handoff:1'},
  );
  const occurrences: MarkerOccurrence[] = [];
  const authoritativeTimes: number[] = [];
  const renderedTimes: number[] = [];
  const reportErrors: unknown[] = [];
  const loop = new FrameLoop({
    clock: driver,
    calm: () => false,
    now: () => 0,
    scheduler: {request: () => 0, cancel: () => {}},
    layers: {coverage: () => 'top', onChange: () => () => {}},
    report: (_owner, error) => {
      reportErrors.push(error);
    },
  });
  loop.holdFrames(true);
  // Authority belongs to the simulation clock. Presentation only observes its resulting time.
  clock.schedule(0.125, () => {
    authoritativeTimes.push(clock.ut);
    clock.pause('dialog');
  });
  clock.schedule(0.25, () => authoritativeTimes.push(clock.ut));
  loop.add({
    owner: 'presentation',
    mode: 'continuous',
    render(frame) {
      renderedTimes.push(frame.ut);
      occurrences.push(...track.advance(frame.ut));
    },
  });
  try {
    loop.stepFrame(0);
    for (let i = 0; i < 4; i++) loop.stepFrame(1 / 32);
    assert.equal(clock.paused, true);
    assert.deepEqual(authoritativeTimes, [0.125]);
    assert.deepEqual(
      occurrences.map(event => event.marker),
      ['present-handoff'],
    );
    const beforePauseRenders = renderedTimes.length;
    for (let i = 0; i < 120; i++) loop.stepFrame(1 / 60);
    assert.equal(
      renderedTimes.length - beforePauseRenders,
      120,
      'presentation still renders while simulation is paused',
    );
    assert.ok(renderedTimes.slice(beforePauseRenders).every(time => time === 0.125));
    assert.equal(track.time, 0.125);
    assert.deepEqual(authoritativeTimes, [0.125], 'the pending simulation event cannot fire during paused rendering');
    assert.equal(occurrences.length, 1, 'a crossed marker is not redelivered at a repeated timestamp');

    clock.resume('dialog');
    for (let i = 0; i < 5; i++) loop.stepFrame(1 / 32);
    assert.deepEqual(authoritativeTimes, [0.125, 0.25]);
    assert.deepEqual(
      occurrences.map(event => event.marker),
      ['present-handoff', 'present-next'],
    );
    assert.equal(new Set(occurrences.map(event => event.key)).size, 2);
    assert.deepEqual(reportErrors, [], 'frame errors must fail even after expected markers have been emitted');
  } finally {
    loop.dispose();
  }
});
