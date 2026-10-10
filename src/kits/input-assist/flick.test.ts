import test from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, defineSystem, testScene} from '../../author';
import {
  createFlickDetector,
  FLICK_DIRECTIONS_4,
  FLICK_DIRECTIONS_8,
  type FlickDetector,
  type FlickOptions,
} from './flick';

/** Feed a path of [x, y] samples at `hz`, starting at time `t0`; returns the flicks reported. */
function feed(d: FlickDetector, path: readonly (readonly [number, number])[], hz = 60, t0 = 0) {
  const out = [];
  for (const [i, [x, y]] of path.entries()) {
    const r = d.sample(t0 + i / hz, x, y);
    if (r.status === 'flick') out.push(r.flick);
    else assert.equal(r.status, 'none');
  }
  return out;
}
/** Rest, a ramp out to `peak` along `angle` over `out` samples, hold `hold` samples, ramp back over `back`, rest. */
function stroke(angle: number, o: {peak?: number; out?: number; hold?: number; back?: number} = {}) {
  const peak = o.peak ?? 1,
    out = o.out ?? 3,
    hold = o.hold ?? 1,
    back = o.back ?? 2;
  const at = (m: number) => [Math.cos(angle) * m, Math.sin(angle) * m] as const;
  return [
    at(0),
    at(0),
    ...Array.from({length: out}, (_, i) => at((peak * (i + 1)) / out)),
    ...Array.from({length: hold}, () => at(peak)),
    ...Array.from({length: back}, (_, i) => at(peak * (1 - (i + 1) / back))),
    at(0),
  ];
}

test('FLICK options: radii ordered, durations and history bounded, refusals are RangeError', () => {
  const bad: unknown[] = [
    null,
    {threshold: 0},
    {threshold: 2},
    {centreRadius: 0.9, threshold: 0.85},
    {centreRadius: 0},
    {rearmRadius: 0.5},
    {releaseRadius: 0.9},
    {maxDuration: 0},
    {maxHold: 6},
    {historySize: 0},
    {historySize: 257},
    {historySize: 2.5},
    {confirm: 'hold'},
    {math: 'exact'},
  ];
  for (const o of bad) assert.throws(() => createFlickDetector(o as FlickOptions), RangeError, JSON.stringify(o));
  const d = createFlickDetector();
  assert.deepEqual(
    {...d.options},
    {
      centreRadius: 0.3,
      threshold: 0.85,
      maxDuration: 0.12,
      confirm: 'release',
      releaseRadius: 0.3,
      maxHold: 0.25,
      rearmRadius: 0.3 * 0.8,
      historySize: 8,
      math: 'platform',
    },
  );
  assert.ok(Object.isFrozen(d) && Object.isFrozen(d.options));
});

test('FLICK directions: each of the 8 ways is reported once with its 8-way and 4-way quantisation', () => {
  const d = createFlickDetector();
  for (let k = 0; k < 8; k++) {
    const angle = (k * Math.PI) / 4 + 0.1; // off-axis but within the sector
    const flicks = feed(d, stroke(angle), 60, k);
    assert.equal(flicks.length, 1, FLICK_DIRECTIONS_8[k]);
    const f = flicks[0]!;
    assert.equal(f.dir8, k);
    assert.equal(FLICK_DIRECTIONS_8[f.dir8], FLICK_DIRECTIONS_8[k]);
    assert.ok(Math.abs(Math.atan2(Math.sin(f.angle - angle), Math.cos(f.angle - angle))) < 1e-9);
    assert.ok(Math.abs(f.magnitude - 1) < 1e-9);
    assert.ok(f.start < f.crossed && f.crossed < f.t && f.speed > 0);
  }
  // 4-way: off-diagonal angles round to the nearest axis.
  const four = createFlickDetector();
  const ways = [0, 0.7, Math.PI / 2, 2.4, Math.PI, -2.4, -Math.PI / 2, -0.7].map(
    (a, i) => feed(four, stroke(a), 60, 100 + i)[0]!,
  );
  assert.deepEqual(
    ways.map(f => FLICK_DIRECTIONS_4[f.dir4]),
    ['right', 'right', 'up', 'left', 'left', 'left', 'down', 'right'],
  );
  assert.equal(d.recent().length, 8);
});

test('FLICK non-flicks: a slow drag, a held push and sparse samples report nothing; cross mode reports a push', () => {
  const d = createFlickDetector();
  assert.deepEqual(feed(d, stroke(0, {out: 20})), [], 'slow drag: 20 frames to reach the edge');
  assert.deepEqual(feed(d, stroke(0, {hold: 30}), 60, 10), [], 'held push: returns after maxHold');
  assert.deepEqual(feed(d, stroke(0, {peak: 0.8}), 60, 20), [], 'never reaches the threshold');
  assert.deepEqual(
    feed(
      d,
      [
        [0, 0],
        [1, 0],
        [0, 0],
      ],
      4,
      30,
    ),
    [],
    'a quarter second between samples is not fast',
  );
  const cross = createFlickDetector({confirm: 'cross'});
  const pushed = feed(cross, stroke(Math.PI / 2, {hold: 30}));
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0]!.t, pushed[0]!.crossed, 'reported at the crossing');
  assert.deepEqual(feed(cross, stroke(0, {out: 20}), 60, 10), [], 'still not a slow drag');
});

test('FLICK hysteresis: jitter near the centre cannot re-arm; one excursion reports once', () => {
  const d = createFlickDetector({confirm: 'cross'});
  // After a flick the value hovers at 0.28: inside centreRadius but outside rearmRadius (0.24), then flicks again.
  const path: [number, number][] = [
    [0, 0],
    [0.5, 0],
    [1, 0],
    [0.28, 0],
    [0.29, 0],
    [1, 0],
    [0.28, 0],
    [0.9, 0],
  ];
  assert.equal(feed(d, path).length, 1, 'no second flick without returning inside rearmRadius');
  assert.equal(d.phase(), 'disarmed');
  assert.equal(
    feed(
      d,
      [
        [0.1, 0],
        [1, 0],
      ],
      60,
      1,
    ).length,
    1,
    'rearmed after a real return',
  );
  // Release mode: oscillating beyond the threshold before releasing is still one flick.
  const r = createFlickDetector();
  assert.equal(
    feed(r, [
      [0, 0],
      [1, 0],
      [0.9, 0],
      [1, 0],
      [0, 0],
    ]).length,
    1,
  );
});

test('FLICK samples: stale and invalid samples are refused without changing state; history is bounded', () => {
  const d = createFlickDetector({historySize: 2, confirm: 'cross'});
  assert.equal(d.sample(1, 0, 0).status, 'none');
  assert.equal(d.sample(0.5, 1, 0).status, 'stale');
  assert.equal(d.sample(1.01, Number.NaN, 0).status, 'invalid');
  assert.equal(d.sample(1.01, 3, 0).status, 'invalid');
  assert.equal(d.phase(), 'armed');
  for (let k = 0; k < 5; k++)
    feed(
      d,
      [
        [0, 0],
        [1, 0],
      ],
      60,
      2 + k,
    );
  assert.deepEqual(
    d.recent().map(f => f.n),
    [4, 5],
  );
  assert.ok(Object.isFrozen(d.recent()));
  d.reset();
  assert.equal(d.recent().length, 0);
  assert.equal(d.phase(), 'disarmed');
});

test('FLICK sampling rate: the same physical motion classifies alike at 30, 60 and 120 Hz', () => {
  // A 50 ms flick and a 400 ms drag, sampled at three rates.
  const motion = (ms: number, hz: number) => {
    const n = Math.max(1, Math.round((ms / 1000) * hz));
    return stroke(0.3, {out: n, back: n, hold: 1});
  };
  for (const hz of [30, 60, 120]) {
    assert.equal(feed(createFlickDetector(), motion(50, hz), hz).length, 1, `flick at ${hz} Hz`);
    assert.equal(feed(createFlickDetector(), motion(400, hz), hz).length, 0, `drag at ${hz} Hz`);
  }
});

test('FLICK in a scene: a fixed system samples the stick axis actions with the scene time', async () => {
  const detector = createFlickDetector();
  const seen: number[] = [];
  const system = defineSystem({
    id: 'input-assist-flick',
    run(ctx) {
      const r = detector.sample(ctx.time.t, ctx.input.axis('stick-x'), ctx.input.axis('stick-y'));
      if (r.status === 'flick') seen.push(r.flick.dir8);
    },
  });
  const t = await testScene(defineScene({id: 'input-assist-flick', title: 'Flick', systems: [system]}));
  t.run(0.1);
  t.hold('stick-y', -1); // a digital axis jumps straight to the edge: always fast
  t.run(2 / 60);
  t.release('stick-y');
  t.run(0.1);
  assert.deepEqual(seen, [6], 'one downward flick');
  t.hold('stick-x', 1);
  t.run(1); // held a second: a push, not a flick
  t.release('stick-x');
  t.run(0.1);
  assert.deepEqual(seen, [6]);
  t.dispose();
});
