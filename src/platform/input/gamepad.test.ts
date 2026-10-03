import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buttonDown,
  GamepadInput,
  hatDirection,
  LOOK_CURVE,
  padFamily,
  scaledRadial,
  type GamepadOptions,
} from './gamepad';
import {fakePad, snapshots} from '../../testing/input-fakes';
import {must} from '../../testing/must';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const rig = (pads = [fakePad()], options: GamepadOptions = {}) => {
  const get = snapshots(pads);
  const g = new GamepadInput({getPads: get, ...options});
  let t = 0;
  const poll = (ms = 16) => g.poll(ms / 1000, (t += ms));
  return {g, get, pad: must(pads[0], 'pad'), pads, poll, time: () => t};
};
/** Poll once in neutral so the pad is armed. */
const armed = (pads = [fakePad()], options: GamepadOptions = {}) => {
  const r = rig(pads, options);
  r.poll();
  return r;
};

test('scaled radial dead zones: no kick at the edge, full range kept, magnitude ≤ 1 and the look curve', () => {
  assert.deepEqual(scaledRadial(0.1, 0.1, 0.18), {x: 0, y: 0});
  const edge = scaledRadial(0.19, 0, 0.18);
  assert.ok(edge.x > 0 && edge.x < 0.02);
  near(scaledRadial(0.95, 0, 0.18).x, 1);
  near(Math.hypot(scaledRadial(1, 1, 0.18).x, scaledRadial(1, 1, 0.18).y), 1);
  const diag = scaledRadial(0.5, 0.5, 0.18),
    cardinal = scaledRadial(Math.SQRT1_2, 0, 0.18);
  near(Math.hypot(diag.x, diag.y), cardinal.x, 1e-6);
  const half = scaledRadial(0.55, 0, 0.15, 0.95, LOOK_CURVE);
  near(half.x, Math.pow(0.5, LOOK_CURVE));
});
test('trigger hysteresis presses at .55 and releases at .45', () => {
  assert.equal(buttonDown({pressed: false, value: 0.54}, false), false);
  assert.equal(buttonDown({pressed: true, value: 0.55}, false), true);
  assert.equal(buttonDown({pressed: true, value: 0.46}, true), true);
  assert.equal(buttonDown({pressed: false, value: 0.45}, true), false);
  assert.equal(buttonDown({pressed: true, value: 0}, false), true, 'a digital button with no value');
  assert.equal(buttonDown(undefined, true), false);
});
test('getGamepads is called once per poll and the snapshot objects are never kept', () => {
  const r = armed();
  const before = r.get.calls;
  r.pad.press(0);
  r.poll();
  assert.equal(r.get.calls - before, 1);
  r.pad.release(0);
  assert.deepEqual(r.poll().edges, [], 'a later snapshot, not a stale object, decides');
});
test('the wake press is swallowed: a pad needs one neutral frame before any button counts', () => {
  const r = rig();
  r.pad.press(0);
  assert.deepEqual(r.poll().edges, []);
  assert.deepEqual(r.poll().edges, []);
  r.pad.release(0);
  r.poll();
  r.pad.press(0);
  assert.deepEqual(r.poll().edges, ['confirm']);
  assert.deepEqual(r.poll().edges, [], 'held is not a new press');
});
test('A confirms and B goes back; the Nintendo setting swaps them; Start pauses; View and R3 change the camera; Y recentres', () => {
  let swap = false;
  const r = armed([fakePad()], {nintendoSwap: () => swap});
  const tap = (i: number) => {
    r.pad.press(i);
    const e = r.poll().edges;
    r.pad.release(i);
    r.poll();
    return e;
  };
  assert.deepEqual(tap(0), ['confirm']);
  assert.deepEqual(tap(1), ['back']);
  assert.deepEqual(tap(9), ['pause']);
  assert.deepEqual(tap(8), ['view']);
  assert.deepEqual(tap(11), ['anchor']);
  assert.deepEqual(tap(3), ['recentre']);
  swap = true;
  assert.deepEqual(tap(1), ['confirm']);
  assert.deepEqual(tap(0), ['back']);
});
test('left stick moves (forward positive) and the right stick looks at up to 120°/s × 70°/s', () => {
  const r = armed();
  r.pad.stick(0, 0, -1);
  r.pad.stick(1, 1, 0);
  const f = r.poll(100);
  near(f.move.y, 1);
  near(f.move.x, 0);
  near(f.look.x, ((120 * Math.PI) / 180) * 0.1);
  near(f.look.y, 0);
  r.pad.stick(1, 0, 1);
  near(r.poll(250).look.y, ((70 * Math.PI) / 180) * 0.1, 1e-9);
  r.pad.stick(0, 0.1, 0.1);
  r.pad.stick(1, 0.1, -0.1);
  const idle = r.poll();
  assert.deepEqual(
    [idle.move, idle.look],
    [
      {x: 0, y: 0},
      {x: 0, y: 0},
    ],
    'drift inside the dead zones is ignored',
  );
});
test('d-pad zoom: one notch now, repeats after 400 ms every 150 ms as `repeat` steps', () => {
  const r = armed();
  r.pad.press(12);
  let steps = r.poll(16).zoom;
  assert.deepEqual(
    steps.map(z => [z.notches, z.source]),
    [[-1, 'pad']],
  );
  const all = [];
  for (let i = 0; i < 40; i++) all.push(...r.poll(16).zoom);
  // 640 ms more held: repeats at +400, +550 → two.
  assert.deepEqual(
    all.map(z => [z.notches, z.source]),
    [
      [-1, 'repeat'],
      [-1, 'repeat'],
      [-1, 'repeat'],
    ].slice(0, all.length),
  );
  assert.equal(all.length, 2);
  r.pad.release(12);
  r.poll();
  r.pad.press(13);
  steps = r.poll().zoom;
  assert.deepEqual(
    steps.map(z => [z.notches, z.source]),
    [[1, 'pad']],
  );
});
test('the d-pad can move instead (digital-only setting)', () => {
  const r = armed([fakePad()], {dpad: () => 'move'});
  r.pad.press(12);
  r.pad.press(15);
  const f = r.poll();
  assert.equal(f.zoom.length, 0);
  near(f.move.x, Math.SQRT1_2);
  near(f.move.y, Math.SQRT1_2);
});
test('menu direction from the stick uses .5 engage and .35 release on the dominant axis', () => {
  const r = armed();
  r.pad.stick(0, 0.45, 0);
  assert.equal(r.poll().nav, null);
  r.pad.stick(0, 0.6, 0.1);
  assert.equal(r.poll().nav, 'right');
  r.pad.stick(0, 0.4, 0);
  assert.equal(r.poll().nav, 'right', 'held between release and engage');
  r.pad.stick(0, 0.3, 0);
  assert.equal(r.poll().nav, null);
  r.pad.stick(0, 0, 0);
  r.pad.press(13);
  assert.equal(r.poll().nav, 'down');
});
test('disconnecting the active pad pauses once and clears held state; reconnecting needs neutral again', () => {
  const pads: ReturnType<typeof fakePad>[] = [fakePad()];
  const r = armed(pads);
  r.pad.stick(0, 0, -1);
  r.poll();
  r.poll();
  r.pad.connected = false;
  const gone = r.poll();
  assert.ok(gone.disconnected);
  assert.deepEqual(gone.edges, ['pause']);
  assert.deepEqual(gone.move, {x: 0, y: 0});
  assert.equal(r.poll().disconnected, false, 'pauses once');
  r.pad.connected = true;
  const back = r.poll();
  assert.deepEqual(back.move, {x: 0, y: 0}, 'a stick still held on reconnect does not move');
  const idle = rig();
  idle.poll();
  (idle.pads[0] as {connected: boolean}).connected = false;
  assert.equal(idle.poll().disconnected, false, 'an untouched pad leaving does not pause');
});
test('requireNeutral after a reset or context change: held buttons and sticks wait for release', () => {
  const r = armed();
  r.pad.stick(0, 0, -1);
  r.pad.press(0);
  r.poll();
  r.g.requireNeutral();
  const f = r.poll();
  assert.deepEqual(f.move, {x: 0, y: 0});
  assert.deepEqual(f.edges, []);
  r.pad.stick(0, 0, 0);
  r.pad.release(0);
  r.poll();
  r.pad.stick(0, 0, -1);
  assert.ok(r.poll().move.y > 0.9);
});
test('the most recent meaningful pad is active; a drifting spare cannot steer', () => {
  const a = fakePad(0),
    b = fakePad(1, '054c-0ce6-DualSense Wireless Controller');
  const r = armed([a, b]);
  b.stick(0, 0.3, 0);
  assert.deepEqual(r.poll().move, {x: 0, y: 0});
  a.stick(0, 0, -1);
  assert.ok(r.poll().move.y > 0.9);
  a.stick(0, 0, 0);
  r.poll();
  b.press(0);
  const f = r.poll();
  assert.deepEqual(f.edges, ['confirm']);
  assert.equal(f.family, 'playstation');
});
test('meaningful input for the device tracker: button edges or a strong stick for two frames, never noise', () => {
  const r = armed();
  r.pad.stick(0, 0.3, 0);
  assert.equal(r.poll().meaningful, false);
  r.pad.stick(0, 0.9, 0);
  assert.equal(r.poll().meaningful, false);
  assert.equal(r.poll().meaningful, true);
  r.pad.stick(0, 0, 0);
  r.poll();
  r.pad.press(16);
  assert.equal(r.poll().meaningful, false, 'Guide belongs to Steam or the OS');
  r.pad.press(2);
  assert.equal(r.poll().meaningful, true);
});
test('glyph family from the vendor id in Chrome, Firefox and Safari formats', () => {
  assert.equal(padFamily('Xbox 360 Controller (XInput STANDARD GAMEPAD)'), 'xbox');
  assert.equal(padFamily('045e-02ea-Microsoft X-Box One S pad'), 'xbox');
  assert.equal(padFamily('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'), 'playstation');
  assert.equal(padFamily('54c-ce6-DualSense'), 'playstation');
  assert.equal(padFamily('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)'), 'nintendo');
  assert.equal(padFamily('28de-11ff-Microsoft X-Box 360 pad 0'), 'steamdeck');
  assert.equal(padFamily('Generic USB Joystick (Vendor: 0079 Product: 0006)'), 'generic');
});
test('non-standard pads: sticks on axes 0–1, a hat-axis d-pad, and no look from trigger axes resting at −1', () => {
  const pad = fakePad(0, '0079-0006-Generic USB Joystick', '');
  pad.axes = [0, 0, -1, -1, 0, 0, 0, 0, 0, 1.2857];
  pad.buttons = pad.buttons.slice(0, 12);
  const r = armed([pad]);
  assert.deepEqual(r.poll().look, {x: 0, y: 0});
  pad.axes[9] = -1;
  const f = r.poll();
  assert.equal(f.nav, 'up');
  assert.deepEqual(
    f.zoom.map(z => z.notches),
    [-1],
  );
  assert.deepEqual(hatDirection(-3 / 7), {x: 1, y: 0});
  assert.deepEqual(hatDirection(1 / 7), {x: 0, y: -1});
  assert.deepEqual(hatDirection(0), {x: 0, y: 0});
  assert.deepEqual(hatDirection(1.2857), {x: 0, y: 0});
});
test('rumble is feature-detected, capped at 200 ms and .5, swallowed on failure and skipped while hidden', () => {
  const calls: unknown[] = [];
  const pad = fakePad();
  let hidden = false;
  pad.vibrationActuator = {
    playEffect: (type: string, params: object) => {
      calls.push([type, params]);
      return Promise.reject(new Error('NotSupported'));
    },
    reset: () => Promise.resolve(),
  };
  const r = armed([pad], {
    doc: {
      get hidden() {
        return hidden;
      },
    },
  });
  pad.press(0);
  r.poll();
  assert.equal(r.g.rumble(3, 5000), true);
  assert.deepEqual(calls[0], ['dual-rumble', {duration: 200, startDelay: 0, strongMagnitude: 0.5, weakMagnitude: 0.5}]);
  hidden = true;
  assert.equal(r.g.rumble(), false);
  hidden = false;
  pad.vibrationActuator = {
    playEffect: () => {
      throw new Error('boom');
    },
  };
  assert.equal(r.g.rumble(), false);
  delete pad.vibrationActuator;
  assert.equal(r.g.rumble(), false);
  r.g.stopRumble();
  assert.equal(
    new GamepadInput({
      getPads: () => {
        throw new Error('Permissions-Policy');
      },
    }).poll(0.016, 0).connected,
    false,
  );
});
test('the bumpers zoom (LB out, RB in) with either d-pad setting, repeating like the d-pad', () => {
  for (const dpad of ['zoom', 'move'] as const) {
    const r = armed([fakePad()], {dpad: () => dpad});
    r.pad.press(5);
    assert.deepEqual(
      r.poll().zoom.map(z => [z.notches, z.source]),
      [[-1, 'pad']],
    );
    assert.deepEqual(
      r.poll(450).zoom.map(z => z.source),
      ['repeat'],
    );
    r.pad.release(5);
    r.poll();
    r.pad.press(4);
    assert.deepEqual(
      r.poll().zoom.map(z => z.notches),
      [1],
    );
    r.pad.release(4);
    r.poll();
  }
  const r = armed([fakePad()], {dpad: () => 'move'});
  r.pad.press(12);
  const f = r.poll();
  assert.deepEqual(f.zoom, [], 'a moving d-pad never zooms');
  assert.deepEqual(f.move, {x: 0, y: 1});
});
test('stickNav off: the stick no longer moves menu focus, the d-pad still does', () => {
  const r = armed([fakePad()], {stickNav: () => false, dpad: () => 'move'});
  r.pad.stick(0, 1, 0);
  let f = r.poll();
  assert.equal(f.nav, null);
  assert.ok(f.move.x > 0.9);
  r.pad.stick(0, 0, 0);
  r.pad.press(15);
  f = r.poll();
  assert.equal(f.nav, 'right');
  assert.deepEqual(f.move, {x: 0, y: 0}, 'the d-pad does not play');
  r.pad.release(15);
  r.poll();
  r.pad.press(12);
  f = r.poll();
  assert.equal(f.nav, 'up');
  assert.equal(f.zoom.length, 0, 'nor zoom');
});
