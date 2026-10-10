import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../../core/rng';
import {defineScene, defineSystem, testScene, type Vec3} from '../../author';
import {
  AIM_ASSIST_LIMITS,
  aimAngles,
  aimDirection,
  createAimAssist,
  type AimAssistOptions,
  type AimCandidate,
} from './aim';

const base: AimAssistOptions = {coneHalfAngle: 0.3, range: 50};
const at = (id: string, yaw: number, pitch: number, dist: number, radius = 0.5, extra: Partial<AimCandidate> = {}) => {
  const d = aimDirection(yaw, pitch);
  return {id, position: [d[0] * dist, d[1] * dist, d[2] * dist] as Vec3, radius, ...extra};
};
const frame = (o: {yaw?: number; pitch?: number; dy?: number; dp?: number; dt?: number; c?: AimCandidate[]}) => ({
  origin: [0, 0, 0] as Vec3,
  yaw: o.yaw ?? 0,
  pitch: o.pitch ?? 0,
  delta: {yaw: o.dy ?? 0, pitch: o.dp ?? 0},
  dt: o.dt ?? 1 / 60,
  candidates: o.c ?? [],
});

test('AIM options: bounds and strengths in [0, 1] are validated once; the result is frozen', () => {
  const bad: unknown[] = [
    null,
    {},
    {coneHalfAngle: 0, range: 1},
    {coneHalfAngle: 2, range: 1},
    {coneHalfAngle: 0.3, range: 0},
    {coneHalfAngle: 0.3, range: 2e6},
    {...base, maxCandidates: 0},
    {...base, maxCandidates: 257},
    {...base, maxCandidates: 1.5},
    {...base, magnetism: 1.1},
    {...base, friction: -0.1},
    {...base, stickiness: 2},
    {...base, idlePull: Number.NaN},
    {...base, pullRate: 0},
    {...base, frictionFloor: 0},
    {...base, frictionMargin: 1},
    {...base, planar: 'yes'},
    {...base, math: 'fast'},
  ];
  for (const o of bad) assert.throws(() => createAimAssist(o as AimAssistOptions), RangeError, JSON.stringify(o));
  const a = createAimAssist(base);
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.options));
  assert.equal(a.options.maxCandidates, 32);
  assert.equal(a.options.magnetism, 0);
});

test('AIM frames: malformed frames, duplicate ids and too many candidates throw rather than answer from a part', () => {
  const a = createAimAssist({...base, maxCandidates: 2});
  const ok = at('a', 0, 0, 10);
  assert.throws(() => a.evaluate(frame({c: [ok, ok]})), RangeError, 'duplicate');
  assert.throws(() => a.evaluate(frame({c: [ok, at('b', 0, 0, 5), at('c', 0, 0, 6)]})), RangeError);
  assert.throws(() => a.evaluate(frame({dt: -1})), RangeError);
  assert.throws(() => a.evaluate(frame({dy: Number.NaN})), RangeError);
  assert.throws(() => a.evaluate({...frame({}), origin: [0, 0] as never}), RangeError);
  assert.throws(() => a.evaluate(frame({c: [{...ok, radius: -1}]})), RangeError);
  assert.throws(() => a.evaluate(frame({c: [{...ok, weight: 0}]})), RangeError);
  assert.throws(() => a.evaluate(frame({c: [{...ok, priority: 0.5}]})), RangeError);
  assert.throws(() => a.evaluate(frame({c: [{...ok, id: ''}]})), RangeError);
  assert.equal(AIM_ASSIST_LIMITS.candidates, 256);
});

test('AIM identity: with zero strengths the delta is exactly the raw delta, whatever the targets', () => {
  const rng = createRng('aim-identity');
  const zero = [
    createAimAssist(base),
    createAimAssist({...base, stickiness: 1, pullRate: 3, frictionMargin: 0.5}),
    createAimAssist({...base, planar: true}),
  ];
  for (let i = 0; i < 500; i++) {
    const c = Array.from({length: rng.int(0, 8)}, (_, k) =>
      at(`t${k}`, rng.next() - 0.5, rng.next() - 0.5, 1 + rng.next() * 40, rng.next()),
    );
    const f = frame({yaw: rng.next() * 6 - 3, pitch: rng.next() - 0.5, dy: rng.next() - 0.5, dp: rng.next() - 0.5, c});
    for (const a of zero) {
      const r = a.evaluate(f);
      assert.ok(Object.is(r.delta.yaw, f.delta.yaw) && Object.is(r.delta.pitch, f.delta.pitch), `trial ${i}`);
      assert.equal(r.friction, 1);
      assert.deepEqual({...r.pull}, {yaw: 0, pitch: 0});
    }
  }
});

test('AIM selection: cone and range to the bounding sphere, priority, weight, stickiness and ties by id', () => {
  const a = createAimAssist({...base, stickiness: 0.5});
  assert.equal(a.evaluate(frame({c: [at('far', 0, 0, 60)]})).target, null, 'beyond range');
  assert.equal(a.evaluate(frame({c: [at('wide', 0.5, 0, 10, 0.1)]})).target, null, 'outside the cone');
  assert.equal(a.evaluate(frame({c: [at('big', 0.5, 0, 10, 3)]})).target, 'big', 'its sphere reaches the cone');
  const near = at('near', 0.05, 0, 10),
    off = at('off', 0.2, 0, 10);
  assert.equal(a.evaluate(frame({c: [off, near]})).target, 'near', 'smaller angle wins');
  assert.equal(a.evaluate(frame({c: [near, {...off, priority: 1}]})).target, 'off', 'priority first');
  assert.equal(a.evaluate(frame({c: [near, {...off, weight: 20}]})).target, 'off', 'weight divides the score');
  // Mirror images score exactly alike: the smaller id wins regardless of order.
  const l = at('l', -0.15, 0, 10, 0),
    r = at('r', 0.15, 0, 10, 0);
  assert.equal(a.evaluate(frame({c: [r, l]})).target, 'l');
  assert.equal(a.evaluate(frame({c: [l, r]})).target, 'l');
  assert.equal(a.evaluate({...frame({c: [l, r]}), previous: 'r'}).target, 'r', 'stickiness keeps the previous');
  const plain = createAimAssist(base);
  assert.equal(plain.evaluate({...frame({c: [l, r]}), previous: 'r'}).target, 'l', 'no stickiness by default');
});

test('AIM magnetism: no pull without aim input unless configured; never passes the target', () => {
  const a = createAimAssist({...base, magnetism: 1, pullRate: 2});
  const t = at('t', 0.2, 0.05, 10, 0.2);
  const still = a.evaluate(frame({c: [t]}));
  assert.equal(still.target, 't');
  assert.deepEqual({...still.delta}, {yaw: 0, pitch: 0}, 'zero input: aim does not move');
  const idle = createAimAssist({...base, magnetism: 1, pullRate: 2, idlePull: 1}).evaluate(frame({c: [t]}));
  assert.ok(idle.delta.yaw > 0 && idle.delta.pitch > 0, 'idlePull moves aim with no input');

  const rng = createRng('aim-overshoot');
  const strong = createAimAssist({...base, coneHalfAngle: 1.2, magnetism: 1, pullRate: 4 * Math.PI, idlePull: 1});
  for (let i = 0; i < 500; i++) {
    const tyaw = rng.next() * 2 - 1,
      tpitch = rng.next() - 0.5;
    const c = [at('t', tyaw, tpitch, 5 + rng.next() * 20, 0.3)];
    const dy = (rng.next() - 0.5) * 0.05,
      dp = (rng.next() - 0.5) * 0.05;
    const r = strong.evaluate(frame({dy, dp, dt: rng.next() * 0.3, c}));
    if (r.target === null) continue;
    // Pull runs from the post-input aim toward the target and stops at it: per component, same sign and no farther.
    const offYaw = tyaw - dy,
      offPitch = tpitch - dp;
    for (const [pull, off] of [
      [r.pull.yaw, offYaw],
      [r.pull.pitch, offPitch],
    ] as const) {
      assert.ok(pull * off >= 0, `trial ${i}: pull points at the target`);
      assert.ok(Math.abs(pull) <= Math.abs(off) + 1e-12, `trial ${i}: no overshoot`);
    }
  }
  // Repeated frames converge onto the target and stay there.
  let yaw = 0,
    pitch = 0;
  for (let f = 0; f < 600; f++) {
    const r = strong.evaluate(frame({yaw, pitch, dt: 1 / 60, c: [t]}));
    yaw += r.delta.yaw;
    pitch += r.delta.pitch;
  }
  const goal = aimAngles(t.position);
  assert.ok(Math.abs(yaw - goal.yaw) < 1e-12 && Math.abs(pitch - goal.pitch) < 1e-12);
});

test('AIM friction: slows the raw delta only over or near a candidate, fading to none at the margin', () => {
  const a = createAimAssist({...base, friction: 1, frictionFloor: 0.25, frictionMargin: 0.1});
  const over = a.evaluate(frame({dy: 0.01, c: [at('t', 0, 0, 10, 1)]}));
  assert.equal(over.friction, 0.25);
  assert.equal(over.delta.yaw, 0.01 * 0.25);
  const half = createAimAssist({...base, friction: 0.5, frictionMargin: 0.1}).evaluate(
    frame({dy: 0.01, c: [at('t', 0, 0, 10, 1)]}),
  );
  assert.equal(half.friction, 1 - 0.5 * 0.75);
  // Edge of a 0-radius candidate at 0.05 rad: half way through the margin.
  const mid = a.evaluate(frame({dy: 0.01, c: [at('t', 0.05, 0, 10, 0)]}));
  assert.ok(Math.abs(mid.friction - (1 - 0.75 * 0.5)) < 1e-9);
  for (const yaw of [0.1, 0.2, 1, 2]) {
    const far = a.evaluate(frame({dy: 0.01, dp: 0.02, c: [at('t', yaw, 0, 10, 0)]}));
    assert.equal(far.friction, 1, `no friction ${yaw} rad away`);
    assert.ok(Object.is(far.delta.yaw, 0.01) && Object.is(far.delta.pitch, 0.02));
  }
  // A candidate out of range never slows aim, even dead centre.
  assert.equal(a.evaluate(frame({dy: 0.01, c: [at('t', 0, 0, 51, 1)]})).friction, 1);
});

test('AIM frame-rate independence: the same input for one second pulls the same amount at 30, 60 and 120 Hz', () => {
  const run = (hz: number, o: AimAssistOptions, stick: number) => {
    const a = createAimAssist(o);
    const t = at('t', 0.25, 0, 20, 0.1);
    let yaw = 0,
      pitch = 0,
      pulled = 0;
    for (let f = 0; f < hz; f++) {
      // Aim input from an action value (a constant stick deflection times a turn speed times dt), turning away
      // from the target so the pull is never capped by the remaining offset.
      const r = a.evaluate(frame({yaw, pitch, dy: -stick * 0.4 * (1 / hz), dt: 1 / hz, c: [t]}));
      yaw += r.delta.yaw;
      pitch += r.delta.pitch;
      pulled += r.pull.yaw;
    }
    return {yaw, pitch, pulled};
  };
  const uncapped = {...base, coneHalfAngle: 1, magnetism: 0.5, pullRate: 0.2, fullInputSpeed: 0.4};
  const ref = run(60, uncapped, 1);
  assert.ok(Math.abs(ref.pulled - 0.5 * 0.2) < 0.01, `total pull ≈ strength × rate × 1 s (${ref.pulled})`);
  for (const hz of [30, 120]) {
    const r = run(hz, uncapped, 1);
    assert.ok(Math.abs(r.pulled - ref.pulled) < 0.002, `${hz} Hz pulled ${r.pulled} vs ${ref.pulled}`);
    assert.ok(Math.abs(r.yaw - r.pulled - (ref.yaw - ref.pulled)) < 1e-9, 'input part unchanged');
  }
  // A strong pull that reaches the target lands it at every rate.
  const capped = {...uncapped, magnetism: 1, pullRate: 3, friction: 0.5};
  for (const hz of [30, 60, 120]) {
    const r = run(hz, capped, 0.5);
    assert.ok(Math.abs(r.yaw - 0.25) < 0.01, `${hz} Hz ended at yaw ${r.yaw}`);
  }
});

test('AIM planar mode ignores height and pitch; directions round-trip with the camera convention', () => {
  const a = createAimAssist({...base, planar: true, magnetism: 1, idlePull: 1, pullRate: 1});
  const r = a.evaluate({
    ...frame({pitch: 0.7, dp: 0.03}),
    candidates: [{id: 'up', position: [3, 40, 10], radius: 0.1}],
  });
  assert.equal(r.target, 'up', 'height does not take it out of range or cone');
  assert.equal(r.pull.pitch, 0);
  assert.equal(r.delta.pitch, 0.03);
  assert.ok(r.delta.yaw > 0);
  const d = aimDirection(0.4, -0.3);
  assert.deepEqual(
    d.map(v => +v.toFixed(12)),
    [Math.sin(0.4) * Math.cos(-0.3), Math.sin(-0.3), Math.cos(0.4) * Math.cos(-0.3)].map(v => +v.toFixed(12)),
  );
  const back = aimAngles(d);
  assert.ok(Math.abs(back.yaw - 0.4) < 1e-12 && Math.abs(back.pitch + 0.3) < 1e-12);
  assert.throws(() => aimAngles([0, 0, 0]), RangeError);
  // Deterministic arithmetic gives the same selection.
  const det = createAimAssist({...base, magnetism: 1, idlePull: 1, math: 'deterministic'});
  assert.equal(det.evaluate(frame({c: [at('t', 0.1, 0, 5)]})).target, 't');
});

test('AIM in a scene: a fixed system reads the aim axis action (never a device) and applies the assisted delta', async () => {
  const assist = createAimAssist({...base, magnetism: 1, pullRate: 1, friction: 0.5});
  const target = at('t', 0.2, 0, 10, 0.2);
  const aim = {yaw: 0, pitch: 0, target: null as string | null};
  const system = defineSystem({
    id: 'input-assist-aim',
    run(ctx, dt) {
      const r = assist.evaluate({
        origin: [0, 0, 0],
        yaw: aim.yaw,
        pitch: aim.pitch,
        delta: {yaw: ctx.input.axis('look-x') * 0.5 * dt, pitch: ctx.input.axis('look-y') * 0.5 * dt},
        dt,
        candidates: [target],
        previous: aim.target,
      });
      aim.yaw += r.delta.yaw;
      aim.pitch += r.delta.pitch;
      aim.target = r.target;
    },
  });
  const t = await testScene(defineScene({id: 'input-assist-aim', title: 'Aim', systems: [system]}));
  t.run(0.5);
  assert.deepEqual({...aim, target: aim.target}, {yaw: 0, pitch: 0, target: 't'}, 'no input: aim does not move');
  t.hold('look-y', 0.2);
  t.run(1);
  t.release('look-y');
  assert.ok(aim.yaw > 0.05 && aim.yaw <= 0.2 + 1e-12, `pulled toward the target while aiming (${aim.yaw})`);
  const settled = aim.yaw;
  t.run(0.5);
  assert.equal(aim.yaw, settled, 'input released: magnetism stops');
  t.dispose();
});

test('AIM review regressions: fields read once, indexed candidates, pitch range, and a centred candidate', () => {
  const a = createAimAssist({...base, friction: 1, maxCandidates: 1});
  // A getter that would pass validation and then change is read once.
  let reads = 0;
  const f = {
    ...frame({c: [at('t', 0, 0, 10)]}),
    get dt() {
      reads++;
      return reads === 1 ? 1 / 60 : Number.NaN;
    },
  };
  assert.equal(a.evaluate(f).target, 't');
  assert.equal(reads, 1);
  // A list whose iterator yields more than its length cannot slip past maxCandidates.
  const list: AimCandidate[] = [at('only', 0.5, 0, 10, 0)];
  Object.defineProperty(list, Symbol.iterator, {
    value: function* () {
      yield* [at('only', 0.5, 0, 10, 0), at('hidden', 0, 0, 10, 1)];
    },
  });
  const r = a.evaluate(frame({dy: 0.01, c: list}));
  assert.equal(r.target, null, 'only the indexed candidate (outside the cone) was considered');
  assert.equal(r.friction, 1);
  // Pitch beyond straight up or down is refused (planar mode ignores pitch).
  assert.throws(() => a.evaluate(frame({pitch: 1.6})), RangeError);
  assert.equal(createAimAssist({...base, planar: true}).evaluate(frame({pitch: 3})).target, null);
  // A candidate centred on the origin neither slows nor attracts; one with the origin inside its sphere slows fully.
  assert.equal(a.evaluate(frame({dy: 0.01, c: [{id: 'c', position: [0, 0, 0], radius: 1}]})).friction, 1);
  assert.equal(a.evaluate(frame({dy: 0.01, c: [{id: 'c', position: [0, 0, -0.5], radius: 1}]})).friction, 0.25);
});
