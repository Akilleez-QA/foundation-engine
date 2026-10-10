import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAR_PRESETS,
  carConfig,
  createCarHandling,
  createGroundHit,
  evalCurve,
  planeGround,
  sampledGround,
  type CarControls,
  type CarHandling,
  type GroundQuery,
} from './index';

const DT = 1 / 60;
const flat = planeGround();
const settle = (car: CarHandling, ground: GroundQuery = flat, seconds = 4) => {
  for (let i = 0; i < seconds / DT; i++) car.step(DT, {}, ground);
};
const run = (car: CarHandling, controls: CarControls, seconds: number, ground: GroundQuery = flat) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) car.step(DT, controls, ground);
};
const yawOf = (car: CarHandling) => car.pose().ry;
const upDot = (car: CarHandling) => {
  const [qx, , qz] = car.read().orientation;
  return 1 - 2 * (qx * qx + qz * qz);
};

for (const preset of ['arcade', 'sim-lite'] as const) {
  test(`car-handling ${preset}: settles at the static suspension compression and stays put`, () => {
    const c = carConfig(preset);
    const car = createCarHandling(c);
    car.place({x: 3, y: 1, z: -2, yaw: 0.4});
    settle(car, flat, 6);
    const s = car.read();
    assert.equal(s.grounded, 4);
    assert.ok(s.speed < 1e-3, `speed ${s.speed}`);
    // Static load per corner over the spring rate, within the share a longer wheelbase end carries.
    const mw = c.mass / 4,
      k = mw * (2 * Math.PI * c.suspension.frequency) ** 2;
    const expected = (mw * c.gravity) / k;
    for (const w of s.wheels) assert.ok(Math.abs(w.compression - expected) < expected * 0.2, `${w.compression}`);
    const p = s.position;
    run(car, {}, 5);
    const q = car.read().position;
    assert.ok(Math.hypot(q[0] - p[0], q[2] - p[2]) < 1e-3, 'no creep at rest');
    assert.ok(Math.abs(yawOf(car) - 0.4) < 1e-3);
  });

  test(`car-handling ${preset}: throttle accelerates to a top speed under the curve's limit and drives straight`, () => {
    const c = carConfig(preset);
    const car = createCarHandling(c);
    car.place({x: 0, y: 0.8, z: 0});
    settle(car);
    let max = 0;
    for (let i = 0; i < 40 / DT; i++) {
      car.step(DT, {throttle: 1}, flat);
      max = Math.max(max, car.forwardSpeed);
    }
    assert.ok(max <= c.engine.topSpeed + 1e-9, `max ${max}`);
    assert.ok(max > c.engine.topSpeed * 0.85, `max ${max}`);
    const s = car.read();
    assert.ok(Math.abs(s.position[0]) < 1e-6, `straight: x ${s.position[0]}`);
    assert.ok(s.position[2] > 500);
  });

  test(`car-handling ${preset}: the brake stops the car without reversing it, then brake-to-reverse backs it up`, () => {
    const c = carConfig(preset);
    const car = createCarHandling(c);
    car.place({x: 0, y: 0.8, z: 0});
    settle(car);
    run(car, {throttle: 1}, 5);
    const v0 = car.forwardSpeed;
    let t = 0;
    while (car.forwardSpeed > c.brakes.reverseSpeed && t < 30) {
      car.step(DT, {brake: 1, throttle: 0.0001}, flat); // throttle held: no reverse
      t += DT;
    }
    const decel = v0 / t;
    assert.ok(decel > 5 && decel < 1.6 * c.gravity, `decel ${decel}`);
    run(car, {brake: 1, throttle: 0.0001}, 2);
    assert.ok(Math.abs(car.forwardSpeed) < 0.05, `stopped ${car.forwardSpeed}`);
    run(car, {brake: 1}, 3);
    assert.ok(car.forwardSpeed < -1, `reversing ${car.forwardSpeed}`);
    assert.ok(car.forwardSpeed >= -c.engine.reverseTopSpeed - 1e-9);
  });

  test(`car-handling ${preset}: positive steer turns right, and the turn widens with speed`, () => {
    const radius = (speed: number) => {
      const car = createCarHandling(carConfig(preset));
      car.place({x: 0, y: 0.8, z: 0});
      settle(car);
      while (car.forwardSpeed < speed) car.step(DT, {throttle: 1}, flat);
      const yaw0 = yawOf(car);
      for (let i = 0; i < 30; i++) car.step(DT, {steer: 1, throttle: car.forwardSpeed < speed ? 0.6 : 0}, flat);
      const yaw1 = yawOf(car),
        s = car.read();
      assert.ok(yaw1 < yaw0, 'yaw decreases: a right turn in this frame');
      assert.ok(s.position[0] < 0, 'moves toward -x, the right of a +z heading');
      return car.forwardSpeed / Math.abs(s.angularVelocity[1]);
    };
    assert.ok(radius(20) > radius(6) * 1.5);
  });

  test(`car-handling ${preset}: the handbrake breaks rear grip into a slide that recovers after release`, () => {
    const slide = (handbrake: number) => {
      const car = createCarHandling(carConfig(preset));
      car.place({x: 0, y: 0.8, z: 0});
      settle(car);
      while (car.forwardSpeed < 15) car.step(DT, {throttle: 1}, flat);
      let maxRear = 0;
      for (let i = 0; i < 40; i++) {
        car.step(DT, {steer: 0.6, handbrake}, flat);
        const w = car.read().wheels;
        maxRear = Math.max(maxRear, Math.abs(w[2]!.slip), Math.abs(w[3]!.slip));
      }
      return {car, maxRear};
    };
    const plain = slide(0),
      drift = slide(1);
    assert.ok(drift.maxRear > plain.maxRear * 2, `rear slip ${drift.maxRear} vs ${plain.maxRear}`);
    assert.equal(drift.car.read().drift, 1);
    run(drift.car, {}, carConfig(preset).drift.recoveryTime + 0.1);
    assert.equal(drift.car.read().drift, 0, 'grip recovered');
  });
}

test('car-handling: downforce adds wheel load at speed', () => {
  const load = (downforce: number) => {
    const car = createCarHandling(carConfig('arcade', {aero: {downforce, maxDownforce: 1e6}}));
    car.place({x: 0, y: 0.8, z: 0});
    settle(car);
    while (car.forwardSpeed < 30) car.step(DT, {throttle: 1}, flat);
    run(car, {}, 0.5);
    return car.read().wheels.reduce((sum, w) => sum + w.load, 0);
  };
  const none = load(0),
    some = load(3);
  assert.ok(some > none * 1.2, `${some} vs ${none}`);
});

test('car-handling: off a ledge the car is airborne, air pitch turns it, levelling restores it, and it lands', () => {
  // Floor at 0 for z < 20, at -6 beyond.
  const ledge: GroundQuery = (ox, oy, oz, dx, dy, dz, max, out) => {
    const floor = oz < 20 ? 0 : -6;
    if (dy >= 0 || oy < floor) return false;
    const t = (oy - floor) / -dy;
    if (t > max) return false;
    const z = oz + dz * t;
    if ((z < 20 ? 0 : -6) !== floor) return false;
    Object.assign(out, {distance: t, nx: 0, ny: 1, nz: 0, grip: 1, rolling: 0});
    return true;
  };
  const car = createCarHandling(carConfig('arcade'));
  car.place({x: 0, y: 0.8, z: 0});
  settle(car, ledge);
  while (car.read().position[2] < 22) car.step(DT, {throttle: 1}, ledge);
  let airborne = false,
    landed = false,
    pitched = 0;
  for (let i = 0; i < 300 && !landed; i++) {
    const r = car.step(DT, {pitch: i < 20 ? 1 : 0}, ledge);
    if (r.airborne) airborne = true;
    if (airborne && i < 20) pitched = car.pose().rx;
    if (r.landed) landed = true;
  }
  assert.ok(airborne && landed);
  assert.ok(pitched < -0.05, `nose up is negative rx about +x: ${pitched}`);
  run(car, {}, 2, ledge);
  assert.ok(upDot(car) > 0.99);
  assert.equal(car.grounded, 4);
});

test('car-handling: an upside-down car rests on its body and auto-reset sets it upright after the delay', () => {
  const c = carConfig('arcade');
  const car = createCarHandling(c);
  car.place({x: 5, y: 1.5, z: 5, yaw: 1});
  const values = [...car.snapshot().values];
  // Upside down: yaw(1) followed by a half turn about the body's forward axis, q = (sin 0.5, 0, cos 0.5, 0).
  values[6] = Math.sin(0.5);
  values[7] = 0;
  values[8] = Math.cos(0.5);
  values[9] = 0;
  car.restore({...car.snapshot(), values});
  assert.ok(upDot(car) < -0.99);
  let resetAt = -1,
    flippedAt = -1;
  for (let i = 0; i < 6 / DT; i++) {
    const r = car.step(DT, {}, flat);
    if (r.flipped && flippedAt < 0) flippedAt = i * DT;
    if (r.reset) {
      resetAt = i * DT;
      break;
    }
    if (i * DT > 0.8) assert.ok(car.read().position[1] > c.halfExtents[1] * 0.9, 'resting on the roof, not sunk');
  }
  assert.ok(resetAt > 0 && resetAt === flippedAt);
  assert.ok(upDot(car) > 0.999 && car.speed === 0);
  assert.ok(Math.abs(Math.abs(yawOf(car)) - 1) < 0.05 || Math.abs(Math.abs(yawOf(car)) - (Math.PI - 1)) < 0.05);
  settle(car);
  assert.equal(car.grounded, 4);

  const manual = createCarHandling(carConfig('arcade', {reset: {auto: false}}));
  manual.restore({...manual.snapshot(), values});
  let flipped = false;
  for (let i = 0; i < 4 / DT; i++) flipped = manual.step(DT, {}, flat).flipped || flipped;
  assert.ok(flipped && upDot(manual) < -0.99, 'reported, not acted on');
  manual.reset();
  assert.ok(upDot(manual) > 0.999);
});

test('car-handling: a sampled height field matches the exact plane for vertical and tilted rays', () => {
  const plane = planeGround({height: 1, slopeX: 0.2, slopeZ: -0.1});
  const sampled = sampledGround((x, z) => {
    const len = Math.hypot(0.2, 1, 0.1);
    return {height: 1 + 0.2 * x - 0.1 * z, normal: {x: -0.2 / len, y: 1 / len, z: 0.1 / len}};
  });
  const a = createGroundHit(),
    b = createGroundHit();
  for (const [dx, dy, dz] of [
    [0, -1, 0],
    [0.3, -0.9, 0.1],
  ] as const) {
    const l = Math.hypot(dx, dy, dz);
    assert.ok(plane(2, 5, 3, dx / l, dy / l, dz / l, 10, a));
    assert.ok(sampled(2, 5, 3, dx / l, dy / l, dz / l, 10, b));
    assert.ok(Math.abs(a.distance - b.distance) < 1e-3, `${a.distance} vs ${b.distance}`);
  }
  assert.equal(plane(2, 0, 3, 0, -1, 0, 10, a), false, 'origin below: no hit');
  assert.equal(sampled(2, 5, 3, 0, -1, 0, 1, b), false, 'out of range');
});

test('car-handling: configurations are validated and frozen; presets are generic archetypes', () => {
  assert.throws(() => carConfig('arcade', {mass: 0}), RangeError);
  assert.throws(() => carConfig('arcade', {wheels: [CAR_PRESETS.arcade.wheels[0]!]}), /2 to 8/);
  assert.throws(
    () =>
      carConfig('arcade', {
        engine: {
          curve: [
            [0, 1],
            [0, 0],
          ],
        },
      }),
    /strictly increase/,
  );
  assert.throws(() => carConfig('arcade', {limits: {maxSubsteps: 17}}), RangeError);
  assert.throws(() => carConfig('arcade', {tyre: {grip: Number.NaN}}), RangeError);
  assert.throws(() => carConfig('arcade', {nope: 1} as never), /unknown configuration section/);
  assert.throws(() => carConfig('rally' as never), /unknown preset/);
  const c = carConfig('sim-lite', {mass: 1000});
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.tyre) && Object.isFrozen(c.wheels[0]!.position));
  assert.equal(c.mass, 1000);
  assert.equal(c.tyre.grip, CAR_PRESETS['sim-lite'].tyre.grip);
  assert.equal(evalCurve(c.engine.curve, -1), c.engine.curve[0]![1]);
  assert.equal(evalCurve(c.engine.curve, 5), 0);
  assert.equal(
    evalCurve(
      [
        [0, 0],
        [2, 1],
      ],
      0.5,
    ),
    0.25,
  );
});

test('car-handling: bad steps and bad ground answers throw and leave the car exactly as it was', () => {
  const car = createCarHandling(carConfig('arcade'));
  car.place({x: 0, y: 0.8, z: 0});
  settle(car);
  run(car, {throttle: 1, steer: 0.3}, 1);
  const before = JSON.stringify(car.snapshot());
  const same = () => assert.equal(JSON.stringify(car.snapshot()), before);
  assert.throws(() => car.step(0, {}, flat), RangeError);
  assert.throws(() => car.step(0.3, {}, flat), RangeError);
  // 8 sub-steps of 1/120 s cover at most 1/15 s.
  assert.throws(() => car.step(0.1, {}, flat), /sub-steps/);
  assert.throws(() => car.step(DT, {throttle: 2}, flat), /throttle/);
  assert.throws(() => car.step(DT, {steer: Number.NaN}, flat), /steer/);
  same();
  let calls = 0;
  const flaky: GroundQuery = (...args) => {
    if (++calls === 7) throw new Error('lost collision data');
    return flat(...args);
  };
  assert.throws(() => car.step(DT, {throttle: 1}, flaky), /lost collision data/);
  same();
  const lying: GroundQuery = (_ox, _oy, _oz, _dx, _dy, _dz, max, out) => {
    Object.assign(out, {distance: max * 2, nx: 0, ny: 1, nz: 0, grip: 1, rolling: 0});
    return true;
  };
  assert.throws(() => car.step(DT, {}, lying), /distance/);
  const badNormal: GroundQuery = (...args) => {
    const r = flat(...args);
    args[7].nx = Number.POSITIVE_INFINITY;
    return r;
  };
  assert.throws(() => car.step(DT, {}, badNormal), /normal/);
  const slick: GroundQuery = (...args) => {
    const r = flat(...args);
    args[7].grip = 9;
    return r;
  };
  assert.throws(() => car.step(DT, {}, slick), /grip/);
  same();
  // Outside the configured extent.
  const near = createCarHandling(carConfig('arcade', {limits: {extent: 10}}));
  near.place({x: 0, y: 0.8, z: 9.99});
  settle(near, flat, 0.5);
  const snap = JSON.stringify(near.snapshot());
  assert.throws(() => run(near, {throttle: 1}, 5), /extent/);
  assert.notEqual(JSON.stringify(near.snapshot()), snap); // earlier steps committed...
  assert.ok(Math.abs(near.read().position[2]) <= 10); // ...the refused one did not
  assert.throws(() => car.place({x: Number.NaN, y: 0, z: 0}), RangeError);
});

test('car-handling: work per step is bounded by sub-steps x (wheels + body corners) and speeds are clamped', () => {
  const car = createCarHandling(carConfig('arcade'));
  assert.equal(car.maxQueriesPerStep, (4 + 8) * 8);
  car.place({x: 0, y: 0.8, z: 0});
  let calls = 0;
  const counting: GroundQuery = (...args) => {
    calls++;
    return flat(...args);
  };
  const r = car.step(1 / 15, {}, counting);
  assert.equal(r.substeps, 8);
  assert.equal(r.queries, calls);
  assert.equal(calls, car.maxQueriesPerStep);
  const free = createCarHandling(carConfig('arcade', {body: {contacts: false}, gravity: 100, limits: {maxSpeed: 5}}));
  free.place({x: 0, y: 500, z: 0});
  let clamped = false;
  for (let i = 0; i < 60; i++) clamped = free.step(DT, {}, () => false).clamped || clamped;
  assert.ok(clamped && free.speed <= 5 + 1e-9);
  assert.equal(free.maxQueriesPerStep, 4 * 8);
});

test('car-handling: identical runs give identical bits, and snapshot/restore resumes exactly (platform and dmath)', () => {
  for (const math of ['platform', 'deterministic'] as const) {
    const script = (i: number): CarControls => ({
      throttle: i % 200 < 120 ? 1 : 0,
      brake: i % 200 >= 160 ? 0.7 : 0,
      steer: Math.sin(i / 37),
      handbrake: i % 300 > 260 ? 1 : 0,
    });
    const bumpy = sampledGround((x, z) => ({
      height: 0.3 * Math.sin(x / 7) * Math.cos(z / 5),
      normal: {x: 0, y: 1, z: 0},
    }));
    const drive = (car: CarHandling, from: number, to: number) => {
      for (let i = from; i < to; i++) car.step(DT, script(i), bumpy);
    };
    const a = createCarHandling(carConfig('arcade'), {math}),
      b = createCarHandling(carConfig('arcade'), {math});
    for (const car of [a, b]) car.place({x: 1, y: 1.2, z: 2, yaw: 0.3});
    drive(a, 0, 900);
    drive(b, 0, 450);
    const mid = JSON.parse(JSON.stringify(b.snapshot()));
    drive(b, 450, 900);
    assert.deepEqual(b.snapshot(), a.snapshot(), `${math}: identical inputs, identical state`);
    const c = createCarHandling(carConfig('arcade'), {math});
    c.restore(mid);
    drive(c, 450, 900);
    assert.deepEqual(c.snapshot(), a.snapshot(), `${math}: a JSON round trip resumes bit for bit`);
  }
});

test('car-handling: restore refuses foreign, malformed or non-unit snapshots and changes nothing', () => {
  const car = createCarHandling(carConfig('arcade'));
  car.place({x: 0, y: 0.8, z: 0});
  const good = car.snapshot();
  const other = createCarHandling(carConfig('arcade', {mass: 1300}));
  assert.throws(() => other.restore(good), /different configuration/);
  assert.throws(() => car.restore({...good, version: 2} as never), /version 1/);
  assert.throws(() => car.restore({...good, values: good.values.slice(1)}), /length/);
  const nan = [...good.values];
  nan[3] = Number.NaN;
  assert.throws(() => car.restore({...good, values: nan}), /finite/);
  const skew = [...good.values];
  skew[9] = 0.5;
  assert.throws(() => car.restore({...good, values: skew}), /unit quaternion/);
  const contact = [...good.values];
  contact[20] = 0.5;
  assert.throws(() => car.restore({...good, values: contact}), /contact/);
  assert.deepEqual(car.snapshot(), good);
  assert.ok(Object.isFrozen(good) && Object.isFrozen(good.values));
});
