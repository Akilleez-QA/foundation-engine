import test from 'node:test';
import assert from 'node:assert/strict';
import {defineSystem, testScene, Transform} from '../../author';
import {createRng} from '../../core/rng';
import {FixedStepHost, PointMassSim, type ForceTerm} from '../../domain/sim/host';
import game from '../../../templates/arcade/game/game';
import play from '../../../templates/arcade/game/play';
import steer from '../../../templates/arcade/game/steer';
import restart from '../../../templates/arcade/game/restart';
import {compareDigests, createDigestTrace} from './digest';
import {hashText} from './hash';
import {createReplayRecorder, openReplay, type OpenLimits} from './log';
import {
  createSceneInputTap,
  encodeSceneTick,
  recordSceneRun,
  replaySceneLog,
  sceneReplayConfig,
  worldDigestText,
  type SceneTickFacts,
} from './scene';
import {must} from '../../testing/must';

const inputs = [steer, restart];
const limits = {maxTicks: 2000, maxBytes: 65536, input: {maxBytes: 512, maxNodes: 32, maxDepth: 4}};
const open: OpenLimits = {...limits, log: {maxBytes: 1 << 20, maxNodes: 1 << 16, maxDepth: 8}};
const trace = {every: 1, maxEntries: 2000, maxDigestLength: 16};
/** Steer left, wait, steer right with the pointer, then idle: the run spawns blocks from the seeded stream. */
const script = (tick: number): SceneTickFacts =>
  tick < 90
    ? {held: [], axes: {steer: -1}}
    : tick < 150
      ? {}
      : tick < 240
        ? {pointer: {x: 0.6, y: 0.1, down: true, pressed: tick === 150}}
        : {};

test('SIM-01 scene: the browser ?seed= stream and testScene seed are the same mulberry32 stream', async () => {
  const t = await testScene(play, {game, seed: 7});
  const rng = createRng(7); // author/runtime.ts: `?seed=7` → createRng(7) → ctx.random
  try {
    for (let i = 0; i < 64; i++) assert.equal(t.ctx.random(), rng.next());
  } finally {
    t.dispose();
  }
});

test('SIM-01 scene: a seeded arcade run replays exactly from its tick-input log', async () => {
  const recorded = await recordSceneRun(play, {game, inputs, seed: 7, ticks: 600, limits, script, trace});
  assert.equal(recorded.recorder.status, 'recording');
  assert.equal(recorded.recorder.ticks, 600);
  assert.ok(recorded.recorder.runs < 20, `run-length encoding keeps ${recorded.recorder.runs} runs for 600 ticks`);
  const replayed = await replaySceneLog(play, {game, inputs, log: recorded.log, limits: open, trace});
  assert.equal(replayed.status, 'replayed');
  if (replayed.status !== 'replayed') return;
  assert.deepEqual(replayed.comparison, {status: 'equal', from: 0, through: 599, samples: 600});
  // The run did something: blocks spawned from the seeded stream, so the world changed tick to tick.
  assert.ok(new Set(replayed.digests.entries.map(([, d]) => d)).size > 500);
  // Another seed is another run: the digests differ, and the log cannot pass as the other seed's.
  const other = await recordSceneRun(play, {game, inputs, seed: 8, ticks: 600, limits, script, trace});
  assert.equal(
    compareDigests(recorded.digests, other.digests).status,
    'incomparable',
    'the seed is part of the trace identity',
  );
  assert.notDeepEqual(recorded.digests.entries.at(-1), other.digests.entries.at(-1));
});

test('SIM-01 scene: injected nondeterminism is detected at the tick it first changes state', async () => {
  const recorded = await recordSceneRun(play, {game, inputs, seed: 7, ticks: 300, limits, script, trace});
  // A fault the log cannot explain: an outside value (as a wall-clock read would be) nudges the ball at tick 137.
  let tick = 0,
    outside = 0;
  const fault = defineSystem({
    id: 'injected-fault',
    run(ctx) {
      if (tick++ === 137) outside = 0.001;
      const e = ctx.named('player'),
        tr = e === undefined ? undefined : ctx.world.get(e, Transform);
      if (tr && outside) {
        tr.x += outside;
        outside = 0;
      }
    },
  });
  const replayed = await replaySceneLog(play, {game, inputs, log: recorded.log, limits: open, trace, systems: [fault]});
  assert.equal(replayed.status, 'replayed');
  if (replayed.status !== 'replayed') return;
  const c = replayed.comparison!;
  assert.equal(c.status, 'diverged');
  if (c.status === 'diverged') {
    assert.equal(c.tick, 137);
    assert.equal(c.after, 136);
    assert.equal(c.exact, true);
  }
  // With a sample every 25 ticks the same fault is bracketed: after 125, seen at 150.
  tick = 0;
  const coarse = {...trace, every: 25};
  const recordedCoarse = await recordSceneRun(play, {game, inputs, seed: 7, ticks: 300, limits, script, trace: coarse});
  const replayedCoarse = await replaySceneLog(play, {
    game,
    inputs,
    log: recordedCoarse.log,
    limits: open,
    trace: coarse,
    systems: [fault],
  });
  assert.equal(replayedCoarse.status, 'replayed');
  if (replayedCoarse.status === 'replayed')
    assert.deepEqual(
      [
        replayedCoarse.comparison!.status,
        (replayedCoarse.comparison as {tick: number}).tick,
        (replayedCoarse.comparison as {after: number}).after,
      ],
      ['diverged', 150, 125],
    );
});

test('SIM-01 scene: a detail window shows what differed at the first divergent tick', async () => {
  const detailed = {...trace, detail: {from: 0, to: 300, maxChars: 1 << 20}};
  const recorded = await recordSceneRun(play, {
    game,
    inputs,
    seed: 7,
    ticks: 120,
    limits,
    script,
    trace: detailed,
    detail: ctx => worldDigestText(ctx.world),
  });
  const nudge = defineSystem({
    id: 'injected-score',
    run(ctx) {
      if ((ctx.state.time as number) > 1) ctx.state.score = 99;
    },
  });
  const replayed = await replaySceneLog(play, {
    game,
    inputs,
    log: recorded.log,
    limits: open,
    trace: detailed,
    detail: ctx => worldDigestText(ctx.world),
    systems: [nudge],
  });
  assert.equal(replayed.status, 'replayed');
  if (replayed.status !== 'replayed' || replayed.comparison?.status !== 'diverged')
    return assert.fail('expected a divergence');
  const {a, b} = replayed.comparison.detail;
  assert.match(a!, /"score":0/);
  assert.match(b!, /"score":99/);
});

test('SIM-01 scene: a truncated recording replays its prefix and says it is truncated', async () => {
  const small = {...limits, maxTicks: 200};
  const recorded = await recordSceneRun(play, {game, inputs, seed: 7, ticks: 600, limits: small, script, trace});
  assert.equal(recorded.recorder.status, 'truncated');
  assert.equal(recorded.recorder.truncatedAt, 200);
  assert.equal(recorded.digests.lastTick, 199, 'the run stops with its log');
  const replayed = await replaySceneLog(play, {
    game,
    inputs,
    log: recorded.log,
    limits: {...open, maxTicks: 200},
    trace,
  });
  assert.equal(replayed.status, 'replayed');
  if (replayed.status === 'replayed') {
    assert.equal(replayed.truncatedAt, 200);
    assert.equal(replayed.ticks, 200);
    assert.equal(replayed.comparison?.status, 'equal');
  }
});

test('SIM-01 scene: a log from another game version or input signature is refused before any tick runs', async () => {
  const recorded = await recordSceneRun(play, {game, inputs, seed: 7, ticks: 30, limits, script, trace});
  const newer = {...game, version: '0.2.0'};
  const refused = await replaySceneLog(play, {game: newer, inputs, log: recorded.log, limits: open, trace});
  assert.deepEqual(refused, {status: 'incompatible', field: 'build', expected: 'arcade@0.2.0', actual: 'arcade@0.1.0'});
  const fewer = await replaySceneLog(play, {game, inputs: [steer], log: recorded.log, limits: open, trace});
  assert.equal((fewer as {field?: string}).field, 'config');
  const corrupted = await replaySceneLog(play, {
    game,
    inputs,
    log: recorded.log.replace('"seed":7', '"seed":9'),
    limits: open,
    trace,
  });
  assert.deepEqual(corrupted, {status: 'corrupt', reason: 'checksum'});
});

test('SIM-01 scene: tick facts are canonical and limited to declared actions', () => {
  assert.equal(
    encodeSceneTick(
      {pressed: ['restart', 'restart'], axes: {steer: -0}, pointer: {x: -0, y: 0, down: false, pressed: false}},
      inputs,
    ),
    '{"p":["restart"]}',
  );
  assert.throws(() => encodeSceneTick({pressed: ['jump']}, inputs), /undeclared/);
  assert.throws(() => encodeSceneTick({axes: {steer: Number.NaN}}, inputs), /finite/);
  const tap = createSceneInputTap(inputs);
  assert.throws(() => tap.load({p: ['jump']}), /actions/);
  assert.throws(() => tap.load({q: 1}), /unknown/);
  assert.throws(() => tap.load({x: [0, 0, 2, 0]}), /pointer/);
  tap.load({a: {steer: 1}, x: [0.5, -0.5, 1, 0]});
  assert.deepEqual(
    [tap.input.axis('steer'), tap.input.pressed('restart'), tap.input.pointer.x, tap.input.pointer.down],
    [1, false, 0.5, true],
  );
  assert.equal(sceneReplayConfig('play', inputs), 'scene:play;inputs:restart,steer~');
  tap.load({p: ['restart']});
  assert.equal(tap.input.pressed('restart'), true);
  assert.equal(tap.input.pressedAt('restart'), null, 'a logged tick records presses, not their times');
  tap.passThrough({
    describe: () => null,
    pressed: () => true,
    pressedAt: () => 42,
    held: () => false,
    axis: () => 0,
    pointer: {x: 0, y: 0, down: false, pressed: false},
  });
  assert.equal(tap.input.pressedAt('restart'), 42, 'live reads keep the source timestamp');
});

// ------------------------------------------------------------------ the fixed-step host (domain/sim)

/** A pure thrust term driven by the tick input, plus an optional "outside" term the log cannot explain. */
function sim(outside?: () => number) {
  const thrust: ForceTerm<number> = {
    id: 'thrust',
    order: 100,
    accumulate(ctx, acc) {
      acc[0]! += ctx.params;
    },
  }; // acc is the 3-axis force accumulator
  const leak: ForceTerm<number> = {
    id: 'leak',
    order: 200,
    accumulate(_ctx, acc) {
      acc[1]! += outside!();
    },
  };
  return new FixedStepHost(
    new PointMassSim('probe', 0.01, new Float64Array([0, 0, 0, 0, 0, 0, 1]), outside ? [thrust, leak] : [thrust]),
    {maxPhysicsWarp: 10},
  );
}
const digestState = (y: Float64Array) => hashText(Array.from(y, v => v.toString()).join(','));

test('SIM-01 host: inputs fetched per tick replay exactly under a different frame grouping', () => {
  const header = {build: 'host-test', config: 'probe', seed: 1, step: 0.01};
  const hostLimits = {maxTicks: 1000, maxBytes: 32768, input: {maxBytes: 32, maxNodes: 1, maxDepth: 1}};
  const recorder = createReplayRecorder({header, limits: hostLimits});
  const live = createRng(3);
  const a = sim(),
    ta = createDigestTrace({identity: 'probe', every: 1, maxEntries: 1000, maxDigestLength: 16});
  // Irregular frames: the state at the start of each tick is digested where the host asks for that tick's input.
  const frames = [0.016, 0.034, 0.008, 0.016, 0.05, 0.016, 0.003];
  for (let f = 0; a.stepsTaken < 400; f++)
    a.advance(must(frames[f % frames.length]), tick => {
      ta.observe(tick, () => digestState(a.sim.state));
      const thrust = Math.round(live.range(-2, 2) * 100) / 100;
      assert.equal(recorder.record(tick, JSON.stringify(thrust)).status, 'recorded');
      return thrust;
    });
  const opened = openReplay(
    recorder.export(ta.read()),
    {...hostLimits, log: {maxBytes: 1 << 20, maxNodes: 1 << 14, maxDepth: 8}},
    {build: 'host-test', config: 'probe', step: 0.01},
  );
  assert.equal(opened.status, 'ready');
  if (opened.status !== 'ready') return;
  const replay = (outside?: () => number) => {
    const b = sim(outside),
      tb = createDigestTrace({identity: 'probe', every: 1, maxEntries: 1000, maxDigestLength: 16});
    while (b.stepsTaken < opened.player.ticks)
      b.advance(0.02, tick => {
        tb.observe(tick, () => digestState(b.sim.state));
        return opened.player.input(tick) as number;
      });
    return compareDigests(opened.player.digests!, tb.read(), {through: opened.player.ticks - 1});
  };
  assert.equal(replay().status, 'equal');
  // A term that reads something outside the log (here a counter standing in for the wall clock) diverges at the tick
  // whose input sees its first effect: the leak is non-zero from step 250, so the state entering tick 251 differs.
  let calls = 0;
  const diverged = replay(() => (++calls > 250 * 4 ? 1e-9 : 0)); // RK4: four evaluations per step
  assert.equal(diverged.status, 'diverged');
  if (diverged.status === 'diverged') {
    assert.equal(diverged.tick, 251);
    assert.equal(diverged.exact, true);
  }
});
