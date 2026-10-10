import test from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, defineSystem, Name, testScene, Transform, type InputState} from '../../author';
import {
  createCycleCurve,
  createDayClock,
  createRollup,
  createScreenTransition,
  createWeatherDirector,
  lockedInput,
  mountTransitionOverlay,
  presentation,
  rgbToHex,
  transitionCss,
} from './index';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

test('screen transitions cover, hold, uncover and lock input throughout', () => {
  const t = createScreenTransition({kind: 'fade', coverSeconds: 0.5, uncoverSeconds: 1});
  assert.deepEqual(t.update(0), {phase: 'idle', coverage: 0, locked: false, kind: 'fade', reached: null});
  t.cover(0);
  assert.equal(t.update(0.25).coverage, 0.5);
  assert.equal(t.update(0.25).locked, true, 'locked as soon as covering starts');
  const covered = t.update(0.6);
  assert.equal(covered.reached, 'covered');
  assert.equal(covered.coverage, 1);
  t.cover(0.7);
  assert.equal(t.phase, 'covered', 'idempotent');
  t.uncover(1);
  assert.equal(t.update(1.5).coverage, 0.5);
  t.cover(1.5); // reverse mid-uncover: starts from the coverage shown now
  assert.equal(t.update(1.5).coverage, 0.5);
  assert.equal(t.update(1.75).coverage, 0.75);
  t.uncover(2);
  const done = t.update(3.5);
  assert.equal(done.reached, 'idle');
  assert.equal(done.locked, false);
  assert.throws(() => t.update(1), RangeError, 'time is nondecreasing');
  const instant = createScreenTransition({kind: 'iris', coverSeconds: 0, uncoverSeconds: 0});
  instant.cover(0);
  assert.equal(instant.update(0).reached, 'covered');
});

test('transition CSS: fade opacity, hard-edged wipe, iris closing on its centre', () => {
  assert.equal(transitionCss({kind: 'fade', coverSeconds: 1, uncoverSeconds: 1}, 0)['opacity'], '0.0000');
  assert.equal(transitionCss({kind: 'fade', coverSeconds: 1, uncoverSeconds: 1}, 1)['opacity'], '1.0000');
  const wipe = transitionCss({kind: 'wipe', coverSeconds: 1, uncoverSeconds: 1, direction: 'down'}, 0.5);
  assert.match(wipe['background']!, /linear-gradient\(to bottom, #000 50\.000%, transparent 50\.000%\)/);
  const iris = transitionCss({kind: 'iris', coverSeconds: 1, uncoverSeconds: 1, center: [0.25, 0.75]}, 1);
  assert.match(iris['background']!, /circle at 25\.00% 75\.00%, transparent 0\.000%/);
  assert.equal(transitionCss({kind: 'iris', coverSeconds: 1, uncoverSeconds: 1}, 0)['pointer-events'], 'none');
  for (const bad of [{color: 'url(x)'}, {center: [2, 0]}, {coverSeconds: -1}, {kind: 'spin'}])
    assert.throws(() => transitionCss({kind: 'fade', coverSeconds: 1, uncoverSeconds: 1, ...bad} as never, 0.5));
  assert.equal(mountTransitionOverlay(null).element, null, 'headless overlay is a no-op');
});

test('lockedInput reads neutral while locked and passes through otherwise', () => {
  let locked = true;
  const raw: InputState = {
    describe: () => null,
    pressed: () => true,
    pressedAt: () => 5,
    held: () => true,
    axis: () => 0.7,
    pointer: {x: 0.5, y: 0.5, down: true, pressed: true},
  };
  const input = lockedInput(raw, () => locked);
  assert.deepEqual(
    [input.pressed('a'), input.pressedAt('a'), input.held('a'), input.axis('a'), input.pointer.down],
    [false, null, false, 0, false],
  );
  locked = false;
  assert.deepEqual(
    [input.pressed('a'), input.pressedAt('a'), input.held('a'), input.axis('a'), input.pointer.down],
    [true, 5, true, 0.7, true],
  );
});

test('day clock and cyclic curves give time-of-day values that wrap smoothly', () => {
  const clock = createDayClock({dayLength: 600, startFraction: 0.25});
  assert.equal(clock.timeOfDay(0), 0.25);
  assert.equal(clock.timeOfDay(150), 0.5);
  assert.equal(clock.timeOfDay(450), 0);
  assert.equal(clock.day(450), 1);
  assert.equal(clock.nextAt(160, 0.5), 750, 'next noon');
  assert.equal(clock.nextAt(150, 0.5), 150, 'now counts');
  const sun = createCycleCurve([
    {at: 0.25, value: 0},
    {at: 0.5, value: 1},
    {at: 0.75, value: 0},
  ]);
  assert.equal(sun(0.5), 1);
  assert.equal(sun(0.375), 0.5);
  assert.equal(sun(0.875), 0, 'wraps from the last key to the first');
  assert.equal(sun(1.5), 1, 'positions wrap');
  const color = createCycleCurve(
    [
      {at: 0, value: [0.1, 0.1, 0.3]},
      {at: 0.5, value: [1, 0.95, 0.8]},
    ],
    {interpolation: 'smooth'},
  );
  assert.equal(rgbToHex(color(0.5)), rgbToHex([1, 0.95, 0.8]));
  assert.ok(near(color(0.25)[0]!, 0.55));
  assert.ok(near(color(0.75)[0]!, 0.55), 'symmetric around the wrap');
  assert.throws(
    () =>
      createCycleCurve([
        {at: 0.5, value: 1},
        {at: 0.4, value: 2},
      ]),
    RangeError,
  );
  assert.throws(
    () =>
      createCycleCurve([
        {at: 0, value: [1, 2]},
        {at: 0.5, value: [1]},
      ]),
    RangeError,
  );
});

test('weather director blends states with no jumps when retargeted mid-blend', () => {
  const w = createWeatherDirector({
    params: ['fog', 'rain', 'wind'],
    states: {clear: {wind: 0.1}, storm: {fog: 0.6, rain: 1, wind: 1}, mist: {fog: 0.9}},
    initial: 'clear',
  });
  assert.deepEqual(w.sample(0).values, [0, 0, 0.1]);
  w.set('storm', 0, 10);
  const mid = w.sample(5);
  assert.ok(near(mid.named['rain']!, 0.5) && mid.progress === 0.5);
  w.set('mist', 5, 4);
  assert.deepEqual(w.sample(5).values, mid.values, 'retargeting starts from what is shown');
  assert.deepEqual(w.sample(9).values, [0.9, 0, 0]);
  assert.equal(w.sample(9).progress, 1);
  assert.throws(() => w.set('hail', 9, 1), RangeError);
  assert.throws(() => createWeatherDirector({params: ['a'], states: {x: {b: 1}}, initial: 'x'}), RangeError);
});

test('roll-up counts toward the target within the time budget and snaps down', () => {
  const r = createRollup({maxSeconds: 0.5, minRate: 10});
  const seen: number[] = [];
  for (let i = 0; i < 40; i++) seen.push(r.update(1000, 1 / 60));
  assert.equal(seen.at(-1), 1000, 'arrives within the budget');
  assert.ok(seen[29]! === 1000 && seen[10]! < 1000, '0.5 s at 60 Hz is 30 frames');
  assert.ok(
    seen.every((v, i) => i === 0 || v >= seen[i - 1]!),
    'monotonic',
  );
  assert.equal(r.update(400, 1 / 60), 400, 'snaps down');
  let small = 400;
  for (let i = 0; i < 30; i++) small = r.update(403, 1 / 60);
  assert.equal(small, 403, 'small changes take at least 1/minRate per unit');
  assert.equal(r.rolling, false);
  r.set(7);
  assert.equal(r.shown, 7);
  assert.throws(() => r.update(1.5, 0.1), RangeError);
});

test('composition: a scene transition locks movement while covered and the counter rolls up', async () => {
  const transition = createScreenTransition({kind: 'iris', coverSeconds: 0.2, uncoverSeconds: 0.2});
  const counter = createRollup();
  let teleported = false;
  const scene = defineScene({
    id: 'door',
    title: 'Door',
    entities: [[Name({name: 'player'}), Transform()]],
    systems: [
      defineSystem({
        id: 'move',
        run(ctx) {
          const input = lockedInput(ctx.input, () => transition.peek().locked);
          if (!input.held('right')) ctx.world.get(ctx.named('player')!, Transform)!.x += 0.01;
        },
      }),
      defineSystem({
        id: 'door',
        phase: 'frame',
        run(ctx, dt) {
          if (ctx.time.frame === 3) transition.cover(ctx.time.t);
          const s = transition.update(ctx.time.t);
          if (s.reached === 'covered') {
            ctx.world.get(ctx.named('player')!, Transform)!.x = 100;
            teleported = true;
            transition.uncover(ctx.time.t);
          }
          ctx.state.shown = counter.update(250, dt);
        },
      }),
    ],
  });
  const t = await testScene(scene);
  t.run(1);
  assert.ok(teleported);
  assert.equal(transition.phase, 'idle');
  assert.equal(t.ctx.state.shown, 250);
  assert.equal(presentation().id, 'presentation');
});
