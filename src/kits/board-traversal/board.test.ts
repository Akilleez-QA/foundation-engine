import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_PRESETS,
  boardConfig,
  characterSlide,
  createBoard,
  defineRails,
  type Board,
  type BoardControls,
  type BoardEvent,
  type BoardGround,
  type BoardWorld,
} from './index';

const DT = 1 / 60;
/** Flat ground at height 0 (one-way: nothing above the query). */
const flat: BoardGround = (_x, _z, below, out) => {
  if (below < 0) return false;
  out.height = 0;
  out.nx = 0;
  out.ny = 1;
  out.nz = 0;
  return true;
};
const W: BoardWorld = {ground: flat};
const ride = (b: Board, c: BoardControls, ticks: number, world: BoardWorld = W) => {
  const events: BoardEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...b.step(DT, c, world).events);
  return events;
};
const untilGrounded = (b: Board, world: BoardWorld = W, c: BoardControls = {}) => {
  const events: BoardEvent[] = [];
  for (let i = 0; i < 600 && b.mode === 'air'; i++) events.push(...b.step(DT, c, world).events);
  return events;
};
const fresh = (preset: 'arcade' | 'sim-lite' = 'arcade', patch = {}) => {
  const b = createBoard(boardConfig(preset, patch));
  b.place({x: 0, y: 0, z: 0});
  return b;
};

for (const preset of ['arcade', 'sim-lite'] as const) {
  test(`board-traversal ${preset}: discrete pushes reach the push cap; coasting and braking slow without reversing`, () => {
    const c = boardConfig(preset);
    const b = fresh(preset);
    const events = ride(b, {push: true}, 600);
    assert.ok(Math.abs(b.speed - c.push.maxSpeed) < 0.2, `speed ${b.speed}`);
    const pushes = events.filter(e => e === 'push').length;
    assert.ok(pushes >= Math.ceil(c.push.maxSpeed / c.push.impulse) && pushes <= (600 * DT) / c.push.interval + 1);
    const before = b.speed;
    ride(b, {}, 60);
    assert.ok(b.speed < before && b.speed > before - 1);
    ride(b, {brake: 1}, 600);
    assert.equal(b.speed, 0);
    assert.ok(b.read().position[2] > 10, 'travelled along +z at yaw 0');
  });

  test(`board-traversal ${preset}: a charged ollie goes higher than a tap and both land clean`, () => {
    const c = boardConfig(preset);
    const apex = (hold: number) => {
      const b = fresh(preset);
      ride(b, {push: true}, 120);
      const events = ride(b, {ollie: true}, hold);
      events.push(...b.step(DT, {}, W).events);
      let top = 0;
      for (let i = 0; i < 300 && b.mode === 'air'; i++) {
        events.push(...b.step(DT, {}, W).events);
        top = Math.max(top, b.read().position[1]);
      }
      assert.deepEqual(
        events.filter(e => e !== 'push'),
        ['pop', 'land-clean'],
      );
      return top;
    };
    const tap = apex(1),
      full = apex(Math.ceil(c.ollie.chargeTime / DT) + 2);
    const h = (v: number) => (v * v) / (2 * c.gravity);
    assert.ok(full > tap * 1.5);
    assert.ok(Math.abs(full - h(c.ollie.maxPop)) < 0.03, `${full} vs ${h(c.ollie.maxPop)}`);
    assert.ok(tap >= h(c.ollie.minPop) - 0.03 && tap < h(c.ollie.minPop) + 0.2);
  });

  test(`board-traversal ${preset}: landing judges board yaw against travel: clean, switched, sketchy and bail`, () => {
    const c = boardConfig(preset);
    const land = (spin: number) => {
      const rate = 8;
      const b = fresh(preset, {air: {spinRate: rate}, ollie: {minPop: 6, maxPop: 6, chargeTime: 0}});
      ride(b, {push: true}, 120);
      const speed = b.speed;
      ride(b, {ollie: true}, 1);
      b.step(DT, {}, W);
      // Spin `spin` radians, then hold still until landing.
      let turned = 0;
      while (turned < spin - 1e-9 && b.mode === 'air') {
        const steer = Math.min(1, (spin - turned) / (rate * DT));
        b.step(DT, {steer}, W);
        turned += steer * rate * DT;
      }
      assert.ok(Math.abs(turned - spin) < 1e-9, 'the spin finished in the air');
      const events = untilGrounded(b);
      return {b, events, speed};
    };
    const clean = land(c.landing.clean * 0.5);
    assert.ok(clean.events.includes('land-clean') && clean.b.mode === 'rolling');
    const sketchy = land((c.landing.clean + c.landing.sketchy) / 2);
    assert.ok(sketchy.events.includes('land-sketchy'));
    assert.ok(sketchy.b.speed < sketchy.speed * c.landing.sketchyKeep + 0.2);
    const bail = land((c.landing.sketchy + Math.PI / 2) / 2);
    assert.ok(bail.events.includes('bail'));
    assert.equal(bail.b.read().bailReason, 'angle');
    const fakie = land(Math.PI);
    assert.ok(fakie.events.includes('switch') && fakie.events.includes('land-clean'));
    assert.equal(fakie.b.read().stance, -1);
    assert.ok(fakie.b.speed > 1, 'rides away backwards relative to the board');
  });
}

test('board-traversal: an unfinished trick or a hard impact bails; the rider recovers after bail.time', () => {
  const c = boardConfig('arcade');
  const b = fresh();
  ride(b, {push: true}, 60);
  ride(b, {ollie: true}, 1);
  const events = [...b.step(DT, {trick: 5}, W).events];
  events.push(...untilGrounded(b));
  assert.ok(events.includes('trick-start') && events.includes('bail'));
  assert.equal(b.read().bailReason, 'trick');
  assert.equal(b.mode, 'bail');
  const after = ride(b, {push: true}, Math.ceil(c.bail.time / DT) + 2);
  assert.ok(after.includes('recover'));
  assert.equal(b.mode, 'rolling');
  // A short trick completes.
  ride(b, {push: true}, 60);
  ride(b, {ollie: true}, 20);
  b.step(DT, {trick: 0.2}, W);
  assert.ok(untilGrounded(b).includes('land-clean'));
  // Impact: dropped from high.
  const drop = fresh('sim-lite');
  drop.place({x: 0, y: 30, z: 0});
  drop.step(DT, {}, W); // no ground within snap: leaves the ground
  assert.equal(drop.mode, 'air');
  untilGrounded(drop);
  assert.equal(drop.read().bailReason, 'impact');
});

test('board-traversal: a board catches an authored rail from above, grinds along it and leaves at its end', () => {
  const rails = defineRails({
    revision: 3,
    maxSegments: 8,
    rails: [
      {
        id: 'ledge',
        points: [
          [0.1, 0.4, 2],
          [0.1, 0.4, 30],
          [0.1, 0.1, 34],
        ],
      },
    ],
  });
  const world = {ground: flat, rails};
  const b = fresh('arcade', {grind: {instability: 0, disturbance: 0}});
  ride(b, {push: true}, 90, world);
  const events = ride(b, {ollie: true}, 12, world);
  for (let i = 0; i < 300 && !events.includes('grind-start'); i++) events.push(...b.step(DT, {}, world).events);
  assert.ok(events.includes('grind-start'));
  const s = b.read();
  assert.equal(s.mode, 'grind');
  assert.equal(s.rail, 'ledge');
  assert.ok(Math.abs(s.position[0] - 0.1) < 1e-12, 'snapped onto the rail');
  let maxZ = 0;
  for (let i = 0; i < 600 && b.mode === 'grind'; i++) {
    events.push(...b.step(DT, {}, world).events);
    maxZ = Math.max(maxZ, b.read().position[2]);
  }
  assert.ok(maxZ > 33.9, `followed both segments to the end: ${maxZ}`);
  events.push(...untilGrounded(b, world));
  assert.deepEqual(
    events.filter(e => e !== 'push'),
    ['pop', 'grind-start', 'grind-end', 'launch', 'land-clean'],
  );
});

test('board-traversal: rails need alignment and the catch window; a sideways or low pass does not grind', () => {
  const rails = defineRails({
    revision: 1,
    maxSegments: 4,
    rails: [
      {
        id: 'r',
        points: [
          [-5, 0.4, 5],
          [5, 0.4, 5],
        ],
      },
    ],
  });
  const across = fresh();
  ride(across, {push: true}, 90, {ground: flat, rails});
  const events = ride(across, {ollie: true}, 12, {ground: flat, rails});
  events.push(...untilGrounded(across, {ground: flat, rails}));
  assert.ok(!events.includes('grind-start'), 'crossing at 90 degrees is not a grind');
  const along = defineRails({
    revision: 1,
    maxSegments: 4,
    rails: [
      {
        id: 'r',
        points: [
          [0, 3, 2],
          [0, 3, 20],
        ],
      },
    ],
  });
  const low = fresh();
  ride(low, {push: true}, 90, {ground: flat, rails: along});
  const e2 = ride(low, {ollie: true}, 12, {ground: flat, rails: along});
  e2.push(...untilGrounded(low, {ground: flat, rails: along}));
  assert.ok(!e2.includes('grind-start'), 'a rail far above the arc is never caught from below');
});

test('board-traversal: grind balance falls without correction and holds with it', () => {
  const rails = defineRails({
    revision: 1,
    maxSegments: 4,
    rails: [
      {
        id: 'long',
        points: [
          [0, 0.4, 2],
          [0, 0.4, 400],
        ],
      },
    ],
  });
  const world = {ground: flat, rails};
  const grindFor = (correct: boolean) => {
    const b = fresh('sim-lite', {grind: {friction: 0}, rolling: {resistance: 0, drag: 0}});
    ride(b, {push: true}, 120, world);
    ride(b, {ollie: true}, 12, world);
    for (let i = 0; i < 120 && b.mode !== 'grind'; i++) b.step(DT, {}, world);
    assert.equal(b.mode, 'grind');
    let t = 0;
    for (let i = 0; i < 600 && b.mode === 'grind'; i++) {
      const steer = correct ? Math.max(-1, Math.min(1, b.read().balance * 3 + 0.5 * Math.sign(b.read().balance))) : 0;
      b.step(DT, {steer}, world);
      t += DT;
    }
    return {b, t};
  };
  const loose = grindFor(false);
  assert.equal(loose.b.read().bailReason, 'balance');
  assert.ok(loose.t < 3);
  const held = grindFor(true);
  assert.equal(held.b.mode, 'grind');
  assert.ok(held.t >= 10 - 1e-9);
});

test('board-traversal: rail data changing mid-grind drops the board off instead of following stale rails', () => {
  const rails = defineRails({
    revision: 1,
    maxSegments: 4,
    rails: [
      {
        id: 'r',
        points: [
          [0, 0.4, 2],
          [0, 0.4, 50],
        ],
      },
    ],
  });
  const b = fresh('arcade', {grind: {instability: 0, disturbance: 0}});
  ride(b, {push: true}, 90, {ground: flat, rails});
  ride(b, {ollie: true}, 12, {ground: flat, rails});
  for (let i = 0; i < 120 && b.mode !== 'grind'; i++) b.step(DT, {}, {ground: flat, rails});
  assert.equal(b.mode, 'grind');
  const moved = defineRails({
    revision: 2,
    maxSegments: 4,
    rails: [
      {
        id: 'r',
        points: [
          [3, 0.4, 2],
          [3, 0.4, 50],
        ],
      },
    ],
  });
  const r = b.step(DT, {}, {ground: flat, rails: moved});
  assert.ok(r.events.includes('grind-end'));
  assert.equal(b.mode, 'air');
  assert.ok(untilGrounded(b, {ground: flat, rails: moved}).length > 0);
});

test('board-traversal: manuals start while rolling, end on release, and a fall needs a release before the next', () => {
  const b = fresh('arcade', {manual: {disturbance: 0, instability: 0}});
  ride(b, {push: true}, 120);
  let e = ride(b, {manual: 1}, 60);
  assert.deepEqual(e, ['manual-start']);
  assert.equal(b.mode, 'manual');
  e = ride(b, {}, 1);
  assert.deepEqual(e, ['manual-end']);
  const fall = fresh('arcade');
  ride(fall, {push: true}, 120);
  e = ride(fall, {manual: 1}, 600);
  assert.deepEqual(e, ['manual-start', 'manual-end'], 'fell once, no restart while held');
  assert.equal(fall.mode, 'rolling');
  ride(fall, {}, 1);
  assert.deepEqual(ride(fall, {manual: -1}, 1), ['manual-start']);
  const strict = fresh('sim-lite');
  ride(strict, {push: true}, 120);
  e = ride(strict, {manual: 1}, 600);
  assert.ok(e.includes('bail'));
  assert.equal(strict.read().bailReason ?? 'recovered', 'recovered');
});

test('board-traversal: a kicker launches the board, slopes accelerate it, and walls stop or bail it', () => {
  // A 30-degree kicker from z = 5 to z = 6.5 (top 0.866 m), flat beyond at 0.
  const kicker: BoardGround = (_x, z, below, out) => {
    const k = Math.tan(Math.PI / 6);
    const h = z >= 5 && z <= 6.5 ? (z - 5) * k : 0;
    const top = h <= below ? h : 0;
    if (top > below) return false;
    out.height = top;
    const onRamp = top === h && z >= 5 && z <= 6.5;
    const l = Math.hypot(k, 1);
    out.nx = 0;
    out.ny = onRamp ? 1 / l : 1;
    out.nz = onRamp ? -k / l : 0;
    return true;
  };
  const b = fresh();
  b.place({x: 0, y: 0, z: -25});
  const events = ride(b, {push: true}, 150, {ground: kicker});
  for (let i = 0; i < 400 && !events.includes('launch'); i++) events.push(...b.step(DT, {}, {ground: kicker}).events);
  assert.ok(events.includes('launch'), 'left the lip');
  let top = 0;
  for (let i = 0; i < 300 && b.mode === 'air'; i++) {
    b.step(DT, {}, {ground: kicker});
    top = Math.max(top, b.read().position[1]);
  }
  assert.ok(top > 0.95, `flew above the lip: ${top}`);
  // Downhill: a 10 % slope toward +z.
  const slope: BoardGround = (_x, z, below, out) => {
    const h = -0.1 * z;
    if (h > below) return false;
    const l = Math.hypot(0.1, 1);
    Object.assign(out, {height: h, nx: 0, ny: 1 / l, nz: 0.1 / l});
    return true;
  };
  const d = fresh('sim-lite');
  d.place({x: 0, y: 0, z: 0});
  ride(d, {}, 180, {ground: slope});
  const c = boardConfig('sim-lite');
  const expected = (c.gravity * (0.1 / Math.hypot(0.1, 1)) - c.rolling.resistance) * 3;
  assert.ok(Math.abs(d.speed - expected) < expected * 0.05 && d.mode === 'rolling', `rolled downhill: ${d.speed}`);
  // Walls: a slow touch stops along the wall, a fast hit bails.
  const area = {minX: -50, maxX: 50, minZ: -50, maxZ: 6};
  const slow = fresh('arcade', {bail: {wallSpeed: 8}});
  ride(slow, {push: true}, 60, {ground: flat, slide: characterSlide(area, 0.3)});
  assert.ok(slow.read().position[2] <= 6 - 0.3 + 1e-9 && slow.mode === 'rolling');
  const fast = fresh('arcade', {bail: {wallSpeed: 3}});
  const e2 = ride(fast, {push: true}, 120, {ground: flat, slide: characterSlide(area, 0.3)});
  assert.ok(e2.includes('bail'));
  assert.equal(fast.read().bailReason, 'wall');
});

test('board-traversal: configurations and rails are validated; presets are generic archetypes', () => {
  assert.throws(() => boardConfig('arcade', {gravity: -1}), RangeError);
  assert.throws(() => boardConfig('arcade', {ollie: {minPop: 5, maxPop: 4}}), /maxPop/);
  assert.throws(() => boardConfig('arcade', {landing: {clean: 1, sketchy: 0.5}}), /sketchy/);
  assert.throws(() => boardConfig('arcade', {manual: {fail: 'explode' as 'roll'}}), /fail/);
  assert.throws(() => boardConfig('arcade', {limits: {maxSubsteps: 1.5}}), /integer/);
  assert.throws(() => boardConfig('vert' as 'arcade'), /unknown preset/);
  const c = boardConfig('sim-lite', {gravity: 12});
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.grind));
  assert.equal(c.grind.control, BOARD_PRESETS['sim-lite'].grind.control);
  const ok = {
    id: 'a',
    points: [
      [0, 0, 0],
      [1, 0, 0],
    ] as [number, number, number][],
  };
  assert.throws(() => defineRails({revision: 1, maxSegments: 1, rails: [ok, {...ok, id: 'b'}]}), /maxSegments/);
  assert.throws(() => defineRails({revision: 1, maxSegments: 4, rails: [ok, ok]}), /duplicate/);
  assert.throws(
    () =>
      defineRails({
        revision: 1,
        maxSegments: 4,
        rails: [
          {
            id: 'c',
            points: [
              [0, 0, 0],
              [0, 0, 0.001],
            ],
          },
        ],
      }),
    /1 cm/,
  );
  assert.throws(() => defineRails({revision: -1, maxSegments: 4, rails: []}), /revision/);
  const b = fresh();
  assert.throws(() => b.step(DT, {}, {ground: flat, rails: {revision: 1, ids: [], segmentCount: 0}}), /defineRails/);
  // Order independence: same rails in another order give the same ids.
  const r1 = defineRails({revision: 1, maxSegments: 4, rails: [ok, {...ok, id: '0'}]});
  assert.deepEqual(r1.ids, ['0', 'a']);
});

test('board-traversal: bad steps and port answers throw and leave the rider unchanged; work is bounded', () => {
  const b = fresh();
  ride(b, {push: true}, 60);
  const before = JSON.stringify(b.snapshot());
  const same = () => assert.equal(JSON.stringify(b.snapshot()), before);
  assert.throws(() => b.step(0, {}, W), RangeError);
  assert.throws(() => b.step(0.1, {}, W), /sub-steps/);
  assert.throws(() => b.step(DT, {steer: 2}, W), /steer/);
  assert.throws(() => b.step(DT, {manual: 2 as 1}, W), /manual/);
  assert.throws(() => b.step(DT, {trick: 11}, W), /trick/);
  assert.throws(
    () =>
      b.step(
        DT,
        {},
        {
          ground: () => {
            throw new Error('streaming');
          },
        },
      ),
    /streaming/,
  );
  assert.throws(
    () =>
      b.step(
        DT,
        {},
        {ground: (_x, _z, below, out) => Object.assign(out, {height: below + 1, nx: 0, ny: 1, nz: 0}) !== null},
      ),
    /at or below/,
  );
  assert.throws(
    () => b.step(DT, {}, {ground: (_x, _z, _b, out) => Object.assign(out, {height: 0, nx: 0, ny: -1, nz: 0}) !== null}),
    /normal/,
  );
  assert.throws(
    () => b.step(DT, {}, {ground: flat, slide: (_x, _z, _dx, _dz, out) => void (out.x = 1e9)}),
    /no further/,
  );
  same();
  const rails = defineRails({
    revision: 1,
    maxSegments: 64,
    rails: Array.from({length: 8}, (_, i) => ({
      id: `r${i}`,
      points: Array.from({length: 9}, (_, k) => [50 + i * 3, 0.5, k * 2] as [number, number, number]),
    })),
  });
  const air = fresh();
  ride(air, {push: true}, 90, {ground: flat, rails});
  ride(air, {ollie: true}, 12, {ground: flat, rails});
  let maxChecks = 0,
    maxQueries = 0;
  for (let i = 0; i < 20; i++) {
    const r = air.step(1 / 15, {}, {ground: flat, rails});
    maxChecks = Math.max(maxChecks, r.railChecks);
    maxQueries = Math.max(maxQueries, r.groundQueries);
  }
  const bound = air.maxWorkPerStep(rails.segmentCount);
  assert.ok(maxChecks > 0 && maxChecks <= bound.railChecks);
  assert.ok(maxQueries <= bound.groundQueries);
  assert.deepEqual(bound, {groundQueries: 8, railChecks: 8 * 64});
});

test('board-traversal: identical runs give identical bits; snapshot JSON round trips resume exactly (both math modes)', () => {
  const rails = defineRails({
    revision: 1,
    maxSegments: 8,
    rails: [
      {
        id: 'ledge',
        points: [
          [0.2, 0.4, 6],
          [0.2, 0.4, 14],
          [2, 0.2, 20],
        ],
      },
    ],
  });
  const world = {ground: flat, rails};
  const script = (i: number): BoardControls => ({
    push: i % 240 < 100,
    ollie: i % 240 >= 100 && i % 240 < 112,
    steer: i % 240 > 112 ? Math.sin(i / 13) : 0,
    manual: i % 400 > 300 && i % 400 < 340 ? 1 : 0,
    trick: i % 240 === 115 ? 0.25 : 0,
  });
  for (const math of ['platform', 'deterministic'] as const) {
    const run = (b: Board, from: number, to: number) => {
      const events: BoardEvent[] = [];
      for (let i = from; i < to; i++) events.push(...b.step(DT, script(i), world).events);
      return events;
    };
    const a = createBoard(boardConfig('arcade'), {math}),
      b = createBoard(boardConfig('arcade'), {math});
    a.place({x: 0, y: 0, z: 0});
    b.place({x: 0, y: 0, z: 0});
    const ea = run(a, 0, 1200);
    run(b, 0, 600);
    const mid = JSON.parse(JSON.stringify(b.snapshot()));
    run(b, 600, 1200);
    assert.deepEqual(b.snapshot(), a.snapshot());
    assert.ok(ea.includes('pop') && ea.includes('land-clean'), ea.join(','));
    const c = createBoard(boardConfig('arcade'), {math});
    c.restore(mid);
    run(c, 600, 1200);
    assert.deepEqual(c.snapshot(), a.snapshot(), `${math}: resumed bit for bit`);
  }
  const s = createBoard(boardConfig('arcade'));
  const good = s.snapshot();
  assert.throws(() => createBoard(boardConfig('sim-lite')).restore(good), /different configuration/);
  const bad = [...good.values];
  bad[9] = 7;
  assert.throws(() => s.restore({...good, values: bad}), /out of range/);
  assert.throws(() => s.restore({...good, values: good.values.slice(1)}), /length/);
  assert.deepEqual(s.snapshot(), good);
});

test('board-traversal: a plain ollie while riding switched lands in the same stance at speed', () => {
  const b = fresh('arcade', {air: {spinRate: 8}});
  ride(b, {push: true}, 120);
  ride(b, {ollie: true}, 1);
  b.step(DT, {}, W);
  // Spin half a turn: lands switched.
  let turned = 0;
  while (turned < Math.PI - 1e-9 && b.mode === 'air') {
    const steer = Math.min(1, (Math.PI - turned) / (8 * DT));
    b.step(DT, {steer}, W);
    turned += steer * 8 * DT;
  }
  untilGrounded(b);
  assert.equal(b.read().stance, -1);
  const speed = b.speed;
  ride(b, {ollie: true}, 1);
  const events = [...b.step(DT, {}, W).events, ...untilGrounded(b)];
  assert.deepEqual(events, ['pop', 'land-clean'], 'no switch, no bail');
  assert.equal(b.read().stance, -1);
  assert.ok(b.speed > speed - 1, `kept its speed: ${b.speed}`);
});

test('board-traversal: a bail on landing slides the way the board was travelling', () => {
  const b = fresh('arcade', {air: {spinRate: 8}});
  ride(b, {push: true}, 120);
  ride(b, {ollie: true}, 1);
  b.step(DT, {}, W);
  for (let i = 0; i < 10; i++) b.step(DT, {steer: 1}, W); // 1.33 rad of spin: beyond sketchy, short of switched
  untilGrounded(b);
  assert.equal(b.read().bailReason, 'angle');
  assert.ok(Math.abs(b.read().heading) < 1e-9, `slides along +z: ${b.read().heading}`);
  assert.ok(b.speed > 1);
  assert.deepEqual(
    b.read().velocity.map(v => Math.abs(v) > 0),
    [false, false, true],
  );
});

test('board-traversal: changed or foreign rail data never wedges a grinding board', () => {
  const rails = defineRails({
    revision: 1,
    maxSegments: 4,
    rails: [
      {
        id: 'r',
        points: [
          [0, 0.4, 2],
          [0, 0.4, 50],
        ],
      },
    ],
  });
  const b = fresh('arcade', {grind: {instability: 0, disturbance: 0}});
  ride(b, {push: true}, 90, {ground: flat, rails});
  ride(b, {ollie: true}, 12, {ground: flat, rails});
  for (let i = 0; i < 120 && b.mode !== 'grind'; i++) b.step(DT, {}, {ground: flat, rails});
  assert.equal(b.mode, 'grind');
  const grinding = b.snapshot();
  const speed = b.speed;
  // Same revision, different data: a creator reusing a revision number.
  const other = defineRails({
    revision: 1,
    maxSegments: 8,
    rails: [
      {
        id: 'a',
        points: [
          [5, 0.4, 0],
          [5, 0.4, 1],
        ],
      },
      {
        id: 'b',
        points: [
          [9, 0.4, 0],
          [9, 0.4, 1],
          [9, 0.4, 2],
        ],
      },
    ],
  });
  const r = b.step(DT, {}, {ground: flat, rails: other});
  assert.deepEqual(r.events, ['grind-end', 'launch']);
  assert.ok(Math.abs(b.read().velocity[2] - speed) < 0.5, 'left with its rail velocity');
  untilGrounded(b, {ground: flat, rails: other});
  assert.ok(b.speed > speed - 1);
  // A restored grinding snapshot with a rail index beyond the rails given also drops off instead of throwing.
  const c = fresh('arcade', {grind: {instability: 0, disturbance: 0}});
  const values = [...grinding.values];
  values[15] = 7;
  c.restore({...grinding, values});
  // (It may catch the real rail below it again on the next sub-step.)
  assert.deepEqual(c.step(DT, {}, {ground: flat, rails}).events.slice(0, 2), ['grind-end', 'launch']);
});

test('board-traversal: the re-catch delay applies only to the rail just left, until the board lands', () => {
  const rails = defineRails({
    revision: 1,
    maxSegments: 4,
    rails: [
      {
        id: 'low',
        points: [
          [0, 0.15, 3],
          [0, 0.15, 6],
        ],
      },
    ],
  });
  const world = {ground: flat, rails};
  const pass = (b: Board) => {
    b.place({x: 0, y: 0, z: 0});
    ride(b, {push: true}, 40, world);
    const e = ride(b, {ollie: true}, 1, world);
    e.push(...b.step(DT, {}, world).events);
    for (let i = 0; i < 300 && b.mode !== 'rolling'; i++) e.push(...b.step(DT, {}, world).events);
    return e;
  };
  const b = fresh('arcade', {
    grind: {recatchTime: 2, instability: 0, disturbance: 0},
    ollie: {minPop: 3, maxPop: 3},
  });
  const first = pass(b);
  assert.ok(first.includes('grind-start'), first.join(','));
  ride(b, {}, 600, world);
  const again = pass(b);
  assert.ok(again.includes('grind-start'), `caught again after landing: ${again.join(',')}`);
  // Also after a balance bail off the rail and a recovery.
  const fall = fresh('arcade', {grind: {recatchTime: 2, instability: 50}, ollie: {minPop: 3, maxPop: 3}});
  const e1 = pass(fall);
  for (let i = 0; i < 300 && fall.mode !== 'rolling'; i++) e1.push(...fall.step(DT, {}, world).events);
  assert.ok(e1.includes('grind-start') && e1.includes('bail') && e1.includes('recover'), e1.join(','));
  ride(fall, {}, 300, world);
  assert.ok(pass(fall).includes('grind-start'), 'caught again after a bail landing');
});

test('board-traversal: a trick starts once per step; manuals end before a wall bail; walls cost speed once', () => {
  const b = fresh('arcade', {limits: {maxSubstep: 1 / 480, maxSubsteps: 16}});
  ride(b, {push: true}, 60);
  ride(b, {ollie: true}, 1);
  b.step(DT, {}, W);
  const events = [...b.step(DT, {trick: 0.001}, W).events, ...b.step(DT, {trick: 0.001}, W).events];
  assert.equal(events.filter(e => e === 'trick-start').length, 2, 'one per step, not one per sub-step');

  const area = {minX: -50, maxX: 50, minZ: -50, maxZ: 6};
  const m = fresh('arcade', {bail: {wallSpeed: 1}, manual: {instability: 0, disturbance: 0}});
  ride(m, {push: true}, 40, {ground: flat, slide: characterSlide(area, 0.3)});
  const e2 = ride(m, {manual: 1}, 120, {ground: flat, slide: characterSlide(area, 0.3)});
  assert.deepEqual(e2.slice(0, 3), ['manual-start', 'manual-end', 'bail']);

  // Grazing a wall at a shallow angle: the speed kept does not depend on the sub-step.
  const graze = (maxSubstep: number) => {
    const g = fresh('arcade', {limits: {maxSubstep, maxSubsteps: 16}, bail: {wallSpeed: 100}});
    g.place({x: 0, y: 0, z: 0, yaw: 0.15});
    const wall = {minX: -50, maxX: 1, minZ: -50, maxZ: 500};
    ride(g, {push: true}, 120, {ground: flat, slide: characterSlide(wall, 0.3)});
    ride(g, {}, 60, {ground: flat, slide: characterSlide(wall, 0.3)});
    return g.speed;
  };
  const coarse = graze(1 / 60),
    fine = graze(1 / 240);
  assert.ok(coarse > 6 && Math.abs(coarse - fine) < 0.3, `${coarse} vs ${fine}`);
});

test('board-traversal: lost control does not pop a held ollie; huge normals, -0, re-entry and bad restores are safe', () => {
  const b = fresh();
  ride(b, {push: true}, 60);
  ride(b, {ollie: true}, 10);
  b.cancelInput();
  assert.deepEqual(ride(b, {}, 5), [], 'no pop after the controller was lost');
  const huge: BoardGround = (_x, _z, below, out) => {
    if (below < 0) return false;
    Object.assign(out, {height: 0, nx: 0, ny: 1e200, nz: 1e200});
    return true;
  };
  ride(b, {}, 5, {ground: huge});
  const flatish: BoardGround = (_x, _z, below, out) => {
    if (below < 0) return false;
    Object.assign(out, {height: 0, nx: 1e300, ny: 1e-300, nz: 0});
    return true;
  };
  const kept = JSON.stringify(b.snapshot());
  assert.throws(() => b.step(DT, {}, {ground: flatish}), /horizontal/);
  assert.equal(JSON.stringify(b.snapshot()), kept);
  assert.doesNotThrow(() => b.restore(JSON.parse(JSON.stringify(b.snapshot()))));
  const z = fresh();
  z.place({x: -0, y: -0, z: -0, yaw: -0});
  assert.ok(z.snapshot().values.every(v => !Object.is(v, -0)));
  const before = JSON.stringify(z.snapshot());
  const sneaky: BoardGround = (...args) => {
    z.step(DT, {}, W);
    return flat(...args);
  };
  assert.throws(() => z.step(DT, {}, {ground: sneaky}), /inside a step/);
  assert.equal(JSON.stringify(z.snapshot()), before);
  const swallowing: BoardGround = (...args) => {
    try {
      z.step(DT, {}, W);
    } catch {
      // the port hides the refusal
    }
    return flat(...args);
  };
  assert.throws(() => z.step(DT, {}, {ground: swallowing}), /re-entered/);
  assert.equal(JSON.stringify(z.snapshot()), before);
  const values = [...z.snapshot().values];
  for (const [i, v] of [
    [0, 2e6],
    [10, 3],
    [14, 0.5],
    [7, 10],
  ] as const) {
    const bad = [...values];
    bad[i] = v;
    assert.throws(() => z.restore({...z.snapshot(), values: bad}), RangeError, `index ${i}`);
  }
  assert.throws(() => boardConfig('arcade', {grind: {snapRaduis: 1} as never}), /unknown field grind.snapRaduis/);
  assert.throws(() => characterSlide(undefined as never), RangeError);
  assert.equal(createBoard(boardConfig('arcade'), {math: 'deterministic'}).math, 'deterministic');
});
