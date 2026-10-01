import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../core/rng';
import { FrameLoop } from '../../core/activity/loop';
import type { ClockDriverPort, Coverage } from '../../core/activity/ports';
import {
  FixedStepHost, PointMassSim, deriveMaxSubsteps, forcesRhs, orderTerms, simTicker, tickerCoverage,
  LOCAL_HITCH_S, type ForceTerm, type SimEvent, type Simulation,
} from './host';
import { dragTerm, gravityTerm, thrustTerm } from './forces';

const MU = 4e14, R = 6_400_000;
const body = { mu: MU, radius: R, omega: 7.3e-5, density: (h: number) => 1.225 * Math.exp(-Math.max(0, h) / 8500) };
const params = { body, cdA: 2.56 };
const surface = { id: 'surface', g: (_t: number, y: Float64Array) => Math.sqrt(y[0] * y[0] + y[1] * y[1] + y[2] * y[2]) - R, direction: -1 as const, terminal: true };
const makeProbe = (h = 1 / 60) => new PointMassSim('probe', h, new Float64Array([R + 120_000, 0, 0, 0, 7800, 0, 1000]), [gravityTerm, dragTerm()], 'rk4', [surface]);

/** A deterministic local sim: integrates held input and counts commands, so tick input can be audited. */
class CounterSim implements Simulation<{ x: number; commands: number; ticks: number[] }, { hold: number; command: boolean }> {
  readonly id = 'counter';
  readonly clock = 'local' as const;
  state = { x: 0, commands: 0, ticks: [] as number[] };
  constructor(readonly fixedStep: number, readonly whenCovered: 'freeze' | { hz: number } = 'freeze') {}
  step(s: CounterSim['state'], input: { hold: number; command: boolean }, dt: number, t: number) {
    s.x += input.hold * dt; if (input.command) s.commands++; s.ticks.push(Math.round(t / dt));
  }
}

test('sim host determinism: the state after N steps is bit-identical whatever the frame timing (world clock)', () => {
  const ref = makeProbe(), snaps: number[][] = [[...ref.state]];
  for (let k = 0; k < 3600; k++) { ref.step(ref.state, params, 1 / 60, k / 60); snaps.push([...ref.state]); }
  for (const seed of [1, 2, 3]) {
    const host = new FixedStepHost(makeProbe(), { maxPhysicsWarp: 4 }), rng = createRng(seed);
    let checked = 0;
    while (host.stepsTaken < 3600) {
      // The coordinator grants at most the host's capacity (ADR 0049): a refused excess is dilation, not a drop.
      host.advance(Math.min(rng.range(0.004, 0.06), host.capacityS()), () => params);
      if (host.stepsTaken <= 3600) { assert.deepEqual([...host.sim.state], snaps[host.stepsTaken]); checked++; }
    }
    assert.ok(checked > 500, `checked ${checked}`);
  }
});

test('sim host determinism: tick-addressed input gives identical local states under 30/60/144 Hz, hitches and zero-step frames', () => {
  const inputAt = (tick: number) => ({ hold: Math.sin(tick * 0.37), command: tick % 97 === 0 });
  const ref = new CounterSim(1 / 240), xs = [0], cs = [0];
  for (let k = 0; k < 6000; k++) { ref.step(ref.state, inputAt(k), 1 / 240, k / 240); xs.push(ref.state.x); cs.push(ref.state.commands); }
  const frames: Record<string, (i: number, rng: ReturnType<typeof createRng>) => number> = {
    '30Hz': () => 1 / 30, '60Hz': () => 1 / 60, '144Hz': () => 1 / 144,
    random: (_i, rng) => rng.range(0, 0.05),                                   // includes frames shorter than a step
    hitchy: (i, rng) => i % 50 === 7 ? 0.6 : rng.range(0.001, 0.02),           // hitches beyond the local clamp
  };
  for (const [name, frame] of Object.entries(frames)) {
    const sim = new CounterSim(1 / 240), host = new FixedStepHost(sim, { maxPhysicsWarp: 1 }), rng = createRng(name);
    const asked: number[] = [];
    let dropped = 0;
    for (let i = 0; host.stepsTaken < 4800; i++) {
      const r = host.advance(frame(i, rng), tick => { asked.push(tick); return inputAt(tick); });
      dropped += r.dropped;
      assert.ok(r.alpha >= 0 && r.alpha < 1, `${name}: alpha ${r.alpha}`);
    }
    // Each tick's input is fetched exactly once, in order, however frames grouped the time.
    assert.deepEqual(asked, Array.from({ length: host.stepsTaken }, (_, k) => k), name);
    const n = host.stepsTaken;
    assert.deepEqual(sim.state.ticks, ref.state.ticks.slice(0, n), name);
    assert.equal(sim.state.x, xs[n], name);
    assert.equal(sim.state.commands, cs[n], name);
    if (name === 'hitchy') assert.ok(dropped > 0, 'a hitch beyond the clamp is reported as dropped');
    else assert.equal(dropped, 0, name);
  }
});

test('world capacity is derived, and a world host refuses uncommitted excess instead of dropping world time', () => {
  assert.equal(deriveMaxSubsteps({ fixedStep: 1 / 240, clock: 'world' }, { maxPhysicsWarp: 4 }), 16);   // ADR 0049's number
  assert.equal(deriveMaxSubsteps({ fixedStep: 1 / 240, clock: 'world' }, { maxPhysicsWarp: 2 }), 8);
  assert.equal(deriveMaxSubsteps({ fixedStep: 1 / 60, clock: 'world' }, { maxPhysicsWarp: 1, frameBudgetS: 1 / 30 }), 2);
  assert.equal(deriveMaxSubsteps({ fixedStep: 1 / 60, clock: 'local' }, { maxPhysicsWarp: 1 }), 15);      // the 0.25 s hitch
  assert.throws(() => deriveMaxSubsteps({ fixedStep: 0, clock: 'world' }, { maxPhysicsWarp: 1 }));
  assert.throws(() => deriveMaxSubsteps({ fixedStep: 1 / 60, clock: 'world' }, { maxPhysicsWarp: 0.5 }));

  const sim = new PointMassSim('probe', 1 / 240, new Float64Array([7e6, 0, 0, 0, 7500, 0, 1]), [gravityTerm], 'rk4');
  const host = new FixedStepHost(sim, { maxPhysicsWarp: 2 });
  const input = () => ({ body: { mu: MU, radius: R } });
  assert.throws(() => host.advance(1, input), /capacity/);
  assert.equal(host.stepsTaken, 0);
  assert.throws(() => host.advance(-1, input));
  assert.throws(() => host.advance(Number.NaN, input));
  const r = host.advance(host.capacityS(), input);
  assert.equal(r.steps, 8);
  assert.equal(r.dropped, 0);
  assert.ok(Math.abs(host.accountedUt() - 8 / 240) < 1e-15);
  host.rebase(10);
  assert.ok(Math.abs(host.accountedUt() - (10 + 8 / 240)) < 1e-12, 'rebase moves the epoch, not the integrated state');
});

test('a local host clamps a hitch at 0.25 s, reports what it drops, and never spirals', () => {
  const sim = new CounterSim(1 / 60), host = new FixedStepHost(sim, { maxPhysicsWarp: 1 });
  const r = host.advance(1.0, () => ({ hold: 1, command: false }));
  assert.equal(r.steps, Math.round(LOCAL_HITCH_S * 60));
  assert.ok(Math.abs(r.dropped - 0.75) < 1e-12, `dropped ${r.dropped}`);
  assert.ok(Math.abs(host.simTime - 0.25) < 1e-12);
  assert.equal(host.simTime, host.stepsTaken / 60, 'simTime is multiplied, never accumulated');
});

test('events located inside a step reach the advance report; a terminal event stops the body', () => {
  const sim = new PointMassSim('drop', 1 / 60, new Float64Array([R + 100, 0, 0, 0, 0, 0, 1]), [gravityTerm], 'rk4', [surface]);
  const host = new FixedStepHost(sim, { maxPhysicsWarp: 1 });
  const seen: SimEvent[] = [];
  for (let i = 0; i < 400 && !sim.stopped; i++) { const r = host.advance(1 / 60, () => ({ body: { mu: MU, radius: R } })); seen.push(...r.events); }
  assert.equal(sim.stopped, 'surface');
  assert.equal(seen.length, 1);
  const g = MU / (R * R), tFall = Math.sqrt(2 * 100 / g);
  assert.ok(Math.abs(seen[0].t - tFall) < 1e-3, `hit at ${seen[0].t}, expected ${tFall}`);
  const x = sim.state[0];
  host.advance(1 / 60, () => ({ body: { mu: MU, radius: R } }));
  assert.equal(sim.state[0], x, 'a stopped sim steps nothing');
  assert.equal(sim.drainEvents().length, 0);
});

test('force terms run in (order, id) order, reject duplicate ids and compose into dy = [v, Σa, ṁ]', () => {
  const log: string[] = [];
  const t = (id: string, order: number, ax: number): ForceTerm<null> => ({ id, order, accumulate(_c, acc) { log.push(id); acc[0] += ax; } });
  assert.deepEqual(orderTerms([t('b', 5, 0), t('a', 5, 0), t('g', 0, 0), t('p', 1000, 0)]).map(x => x.id), ['g', 'a', 'b', 'p']);
  assert.throws(() => orderTerms([t('a', 0, 0), t('a', 1, 0)]), /duplicate/);
  const rhs = forcesRhs([t('two', 200, 2), t('one', 0, 1)], () => null);
  const y = new Float64Array([1, 2, 3, 4, 5, 6, 7, 99]), dy = new Float64Array(8).fill(NaN);
  rhs(0, y, dy);
  assert.deepEqual(log, ['one', 'two']);
  assert.deepEqual([...dy], [4, 5, 6, 3, 0, 0, 0, 0]);

  // Thrust: a 1,000 kg craft with 10 kN along +x at Isp 300 s, no gravity: a = F/m, ṁ = −F/(Isp·g0).
  const thrust = { thrustN: 10_000, ispS: 300, dir: [1, 0, 0], dryMassKg: 500 };
  const burn = forcesRhs([thrustTerm<{ thrust: typeof thrust }>()], () => ({ thrust }));
  const s = new Float64Array([R, 0, 0, 0, 0, 0, 1000]), d = new Float64Array(7);
  burn(0, s, d);
  assert.equal(d[3], 10);
  assert.ok(Math.abs(d[6] + 10_000 / (300 * 9.80665)) < 1e-12);
  s[6] = 500; burn(0, s, d);
  assert.equal(d[3], 0, 'an empty tank has no thrust');
});

test('drag opposes the air-relative velocity and vanishes outside the atmosphere', () => {
  const rhs = forcesRhs([dragTerm<typeof params>()], () => params), d = new Float64Array(7);
  rhs(0, new Float64Array([R + 10_000, 0, 0, 0, 1000, 0, 1000]), d);
  const vAir = 1000 - body.omega * (R + 10_000);
  assert.ok(d[4] < 0 && Math.sign(d[4]) === -Math.sign(vAir) && d[3] === 0 && d[5] === 0);
  rhs(0, new Float64Array([R + 10_000, 0, 0, 0, 1000, 0, 1000]), d);
  const rho = body.density(10_000), expect = -0.5 * rho * Math.abs(vAir) * 2.56 / 1000 * vAir;
  assert.ok(Math.abs(d[4] - expect) < 1e-12 * Math.abs(expect));
  const vacuum = { ...params, body: { ...body, density: () => 0 } };
  const rhs0 = forcesRhs([dragTerm<typeof vacuum>()], () => vacuum);
  rhs0(0, new Float64Array([R + 10_000, 0, 0, 0, 1000, 0, 1000]), d);
  assert.deepEqual([...d.subarray(3, 6)], [0, 0, 0]);
});

// ------------------------------------------------------------------ driven by FrameLoop tickers

function fakeLoop(clock?: ClockDriverPort) {
  const pending = new Map<number, (t: number) => void>(), cov = new Map<string, Coverage>(), listeners = new Set<() => void>();
  let serial = 0;
  const loop = new FrameLoop({
    scheduler: { request(cb) { pending.set(++serial, cb); return serial; }, cancel(id) { pending.delete(id); } },
    layers: { coverage: o => cov.get(o) ?? 'top', onChange(l) { listeners.add(l); return () => listeners.delete(l); } },
    calm: () => false, now: () => 0, clock, report: (_o, e) => { throw e; },
  });
  return {
    loop,
    run(ms: number) { const work = [...pending.values()]; pending.clear(); for (const cb of work) cb(ms); },
    cover(owner: string, c: Coverage) { cov.set(owner, c); for (const l of [...listeners]) l(); },
  };
}

test('a local sim ticker steps from the frame dt, freezes when covered and resumes without a catch-up burst', () => {
  const { loop, run, cover } = fakeLoop();
  const sim = new CounterSim(1 / 60), host = new FixedStepHost(sim, { maxPhysicsWarp: 1 });
  const reports: number[] = [];
  loop.add(simTicker(host, { owner: 'rally', input: () => ({ hold: 1, command: false }), onAdvance: r => reports.push(r.steps) }));
  let ms = 0;
  for (let i = 0; i < 61; i++) run(ms += 1000 / 60);
  assert.equal(host.stepsTaken, 60, 'one step per 60 Hz frame after the first (dt = 0) frame');
  cover('rally', 'scrim');                                   // 'freeze' → the ticker pauses under a scrim
  for (let i = 0; i < 120; i++) run(ms += 1000 / 60);
  assert.equal(host.stepsTaken, 60, 'a covered arcade sim steps nothing');
  cover('rally', 'top');
  run(ms += 1000 / 60);
  assert.equal(host.stepsTaken, 60, 'it resumes with dt = 0, not two seconds of catch-up');
  run(ms += 1000 / 60);
  assert.equal(host.stepsTaken, 61);
  assert.equal(Math.max(...reports), 1);
});

test('an ambient sim ticker throttles to its {hz} while covered', () => {
  assert.deepEqual(tickerCoverage({ hz: 10 }), { hz: 10 });
  assert.equal(tickerCoverage('rails'), 'pause');
  assert.throws(() => tickerCoverage({ hz: 0 }));
  const { loop, run, cover } = fakeLoop();
  const sim = new CounterSim(1 / 60, { hz: 10 }), host = new FixedStepHost(sim, { maxPhysicsWarp: 1 });
  let advances = 0;
  loop.add(simTicker(host, { owner: 'ambient', input: () => ({ hold: 0, command: false }), onAdvance: () => advances++ }));
  let ms = 0;
  run(ms);
  cover('ambient', 'scrim');
  advances = 0;
  for (let i = 0; i < 60; i++) run(ms += 1000 / 60);
  assert.ok(advances >= 9 && advances <= 11, `advances ${advances}`);
  assert.ok(Math.abs(host.simTime - 1) < 0.1 + 1e-9, `simTime ${host.simTime}`);
});

test('a world sim ticker advances by committed UT and rebases covered time, so host UT matches the clock', () => {
  let ut = 1000;
  const warp = { v: 1 };
  const clock: ClockDriverPort = { advance(dt) { ut += dt * warp.v; return { to: ut }; }, resumeFromAway() {} };
  const { loop, run, cover } = fakeLoop(clock);
  const sim = makeProbe(1 / 240), host = new FixedStepHost(sim, { maxPhysicsWarp: 4 });
  loop.add(simTicker(host, { owner: 'sim', input: () => params }));
  let ms = 0;
  run(ms);
  for (let i = 0; i < 60; i++) run(ms += 1000 / 60);
  assert.ok(Math.abs(host.accountedUt() - ut) < 1e-9, `host ${host.accountedUt()} vs clock ${ut}`);
  assert.ok(Math.abs(host.stepsTaken - 240) <= 1, `steps ${host.stepsTaken}`);
  warp.v = 4;
  for (let i = 0; i < 60; i++) run(ms += 1000 / 60);
  assert.ok(Math.abs(host.accountedUt() - ut) < 1e-9);
  const before = host.stepsTaken;
  cover('sim', 'opaque');
  for (let i = 0; i < 30; i++) run(ms += 1000 / 60);
  cover('sim', 'top');
  run(ms += 1000 / 60);
  assert.equal(host.stepsTaken, before, 'covered time is rebased (rails), not integrated');
  assert.ok(Math.abs(host.accountedUt() - ut) < 1e-9);
  run(ms += 1000 / 60);
  assert.ok(host.stepsTaken > before && Math.abs(host.accountedUt() - ut) < 1e-9);
});

test('force composition rejects duplicate identities separated by another order before evaluating terms', () => {
  let evaluated = 0;
  const term = (id: string, order: number): ForceTerm<null> => ({
    id, order, accumulate() { evaluated++; },
  });
  const terms = [term('repeat', -2), term('between', 0), term('repeat', 3)];
  for (const input of [terms, [...terms].reverse(), [terms[1], terms[2], terms[0]]]) {
    assert.throws(() => orderTerms(input), /duplicate force term 'repeat'/);
    assert.throws(() => forcesRhs(input, () => null), /duplicate force term 'repeat'/);
  }
  assert.equal(evaluated, 0, 'invalid compositions never execute caller forces');
});

test('force ordering preserves caller stages and deterministic id ties without mutating input', () => {
  const log: string[] = [];
  const term = (id: string, order: number, acceleration: number, massRate: number): ForceTerm<null> => ({
    id, order,
    accumulate(_ctx, acc, dm) { log.push(id); acc[0] += acceleration; dm.value += massRate; },
  });
  const early = term('early', -1.5, -4, 2);
  const alpha = term('alpha', .25, 2, -3);
  const beta = term('beta', .25, 8, 4);
  const original = Object.freeze([beta, early, alpha]);
  assert.deepEqual(orderTerms(original), [early, alpha, beta]);
  assert.deepEqual(original, [beta, early, alpha]);
  for (const input of [original, [alpha, beta, early]]) {
    log.length = 0;
    const rhs = forcesRhs(input, () => null), dy = new Float64Array(7);
    rhs(0, new Float64Array([0, 0, 0, 1, 2, 3, 4]), dy);
    assert.deepEqual(log, ['early', 'alpha', 'beta']);
    assert.deepEqual([...dy], [1, 2, 3, 6, 0, 0, 3]);
  }
});

test('substep derivation rejects nonfinite inputs and unrepresentable capacities before stepping', () => {
  const world = { fixedStep: 1 / 60, clock: 'world' as const };
  for (const value of [Infinity, -Infinity, NaN]) {
    assert.throws(() => deriveMaxSubsteps(world, { maxPhysicsWarp: value }), /maxPhysicsWarp/);
    assert.throws(() => deriveMaxSubsteps(world, { maxPhysicsWarp: 1, frameBudgetS: value }), /frameBudgetS/);
    assert.throws(() => deriveMaxSubsteps({ ...world, fixedStep: value }, { maxPhysicsWarp: 1 }), /fixedStep/);
  }
  for (const options of [
    { maxPhysicsWarp: Number.MAX_VALUE, frameBudgetS: 2 },
    { maxPhysicsWarp: 1, frameBudgetS: Number.MAX_VALUE },
    { maxPhysicsWarp: Number.MAX_SAFE_INTEGER + 1, frameBudgetS: 1 / 60 },
  ]) {
    assert.throws(() => deriveMaxSubsteps(world, options), /derived substep capacity/);
  }
  for (const clock of ['world', 'local'] as const) {
    let stepped = false;
    const sim = { id: 'tiny-step', fixedStep: Number.MIN_VALUE, clock, state: null, step() { stepped = true; } };
    assert.throws(() => new FixedStepHost(sim, { maxPhysicsWarp: 1 }), /derived substep capacity/);
    assert.equal(stepped, false);
  }
});

test('substep bounds preserve large representable capacities and authored fractional timing', () => {
  assert.equal(deriveMaxSubsteps({ fixedStep: 1, clock: 'world' }, {
    maxPhysicsWarp: Number.MAX_SAFE_INTEGER, frameBudgetS: 1,
  }), Number.MAX_SAFE_INTEGER);
  assert.equal(deriveMaxSubsteps({ fixedStep: 0.125, clock: 'world' }, {
    maxPhysicsWarp: 1.5, frameBudgetS: 0.25,
  }), 3);
  assert.equal(deriveMaxSubsteps({ fixedStep: 1, clock: 'world' }, {
    maxPhysicsWarp: 1, frameBudgetS: Number.MIN_VALUE,
  }), 1);
  assert.equal(deriveMaxSubsteps({ fixedStep: 0.125, clock: 'local' }, {
    maxPhysicsWarp: Number.MAX_VALUE, frameBudgetS: Number.MAX_VALUE,
  }), 2, 'local capacity remains based on the hitch interval, not unused world options');
});

test('host construction rejects overflowing capacity duration while preserving representable maxima', () => {
  let stepped = false;
  const sim = {
    id: 'capacity-duration', clock: 'world' as const, fixedStep: Number.MAX_VALUE * .75,
    state: null, step() { stepped = true; },
  };
  assert.throws(() => new FixedStepHost(sim, {
    maxPhysicsWarp: 1, frameBudgetS: Number.MAX_VALUE,
  }), /capacity duration must be finite/);
  assert.equal(stepped, false);

  const single = new FixedStepHost({ ...sim, fixedStep: Number.MAX_VALUE }, {
    maxPhysicsWarp: 1, frameBudgetS: Number.MAX_VALUE,
  });
  assert.equal(single.maxSubsteps, 1);
  assert.equal(single.capacityS(), Number.MAX_VALUE);
  const many = new FixedStepHost({ ...sim, fixedStep: 1 }, {
    maxPhysicsWarp: Number.MAX_SAFE_INTEGER, frameBudgetS: 1,
  });
  assert.equal(many.maxSubsteps, Number.MAX_SAFE_INTEGER);
  assert.equal(many.capacityS(), Number.MAX_SAFE_INTEGER);
  assert.equal(stepped, false, 'representability is checked without executing impractically large workloads');
});
