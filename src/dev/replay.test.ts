import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../core/ecs/world';
import { createSystemRunner } from '../core/ecs/systems';
import { createRng } from '../core/rng';
import { openSceneTickTap, type SceneTickTap } from '../author/scene-tick-tap';
import { Transform } from '../author/defs';
import type { InputSource } from '../author/defs';
import { createReplayDev } from './replay';

/** A stand-in visit: one fixed system moves a body by the steer axis plus a seeded jitter, like a scene would. */
function visit(seed: number | null, live: InputSource) {
  const world = new World();
  const body = world.spawn(Transform({ x: 0 }));
  const tap = openSceneTickTap({ scene: 'demo', game: { id: 'demo', version: '1.0.0' }, inputs: [{ id: 'steer', axis: true }, { id: 'jump', axis: false }],
    seed, step: 1 / 60, world, live, invalidate() {} });
  const rng = createRng(seed ?? 0);
  const input = tap?.input ?? live;
  const move = { id: 'move', run: () => { const t = world.get(body, Transform)!; t.x += input.axis('steer') * 0.1 + rng.next() * 0.01 + (input.pressed('jump') ? 1 : 0); } };
  const systems = tap ? [{ id: 'b', run: () => tap.beforeTick() }, move, { id: 'e', run: () => tap.afterTick() }] : [move];
  const runner = createSystemRunner(systems);
  return {
    tap, world, x: () => world.get(body, Transform)!.x,
    frame(dt: number) { if (!tap || tap.running()) runner.frame({}, dt); },
  };
}
function liveInput() {
  const state = { axis: 0, jump: false };
  const input: InputSource = { describe: () => null, pressed: id => id === 'jump' && state.jump, held: () => false, axis: id => (id === 'steer' ? state.axis : 0), pointer: { x: 0, y: 0, down: false, pressed: false } };
  return { state, input };
}

test('SIM-01 dev replay: a recorded visit replays exactly under another frame grouping', () => {
  const dev = createReplayDev();
  try {
    assert.equal(dev.arm({ mode: 'record' }, 'demo').status, 'started');
    const live = liveInput(), a = visit(7, live.input);
    assert.ok(a.tap);
    a.frame(1 / 60);
    assert.equal(dev.read().ticks, 0, 'the lane holds until arrival');
    a.tap!.arrive();
    assert.equal(dev.read().status, 'recording');
    for (let f = 0; f < 40; f++) { live.state.axis = f < 20 ? -1 : 1; live.state.jump = f === 25; a.frame(f % 3 === 0 ? 0.05 : 0.008); }
    const recorded = dev.read();
    assert.ok(recorded.ticks > 40);
    const log = recorded.log!;
    dev.stop();
    assert.equal(dev.read().status, 'stopped');

    // Replay in a fresh visit with a steady 60 Hz grouping and no live input at all.
    assert.equal(dev.arm({ mode: 'replay', log }, 'demo').status, 'started');
    const b = visit(7, liveInput().input);
    b.tap!.arrive();
    for (let f = 0; f < 400 && dev.read().status === 'replaying'; f++) b.frame(1 / 60);
    const replayed = dev.read();
    assert.equal(replayed.status, 'complete');
    assert.equal(replayed.ticks, recorded.ticks);
    assert.deepEqual(replayed.comparison, { status: 'equal', from: 0, through: recorded.ticks - 1, samples: recorded.ticks });
    const x = b.x();
    b.frame(1);
    assert.equal(b.x(), x, 'the lane holds once the log is spent');
  } finally { dev.dispose(); }
});

test('SIM-01 dev replay: unseeded visits, corrupted logs and another scene are refused', () => {
  const dev = createReplayDev();
  try {
    dev.arm({ mode: 'record' }, 'demo');
    assert.equal(visit(null, liveInput().input).tap, null);
    assert.deepEqual([dev.read().status, dev.read().reason], ['refused', 'seed-required']);
    dev.arm({ mode: 'record' }, 'other');
    assert.equal(visit(7, liveInput().input).tap, null);
    assert.equal(dev.read().reason, 'scene-changed');
    assert.deepEqual(dev.arm({ mode: 'replay', log: '{"format":"foundation.replay","version":1}' }, 'demo'), { status: 'refused', reason: 'corrupt-fields' });
    assert.deepEqual(dev.arm({ mode: 'replay', log: '{"format":"foundation.replay","version":2}' }, 'demo'), { status: 'refused', reason: 'unsupported-version' });
    assert.deepEqual(dev.arm({ mode: 'record', every: 0 }, 'demo'), { status: 'refused', reason: 'every' });
    assert.equal(visit(7, liveInput().input).tap, null, 'a refused request arms nothing');
    // A log recorded with another seed is refused at the visit, which then runs untapped.
    dev.arm({ mode: 'record' }, 'demo');
    const a = visit(9, liveInput().input); a.tap!.arrive(); a.frame(0.1);
    const log = dev.read().log!;
    dev.arm({ mode: 'replay', log }, 'demo');
    assert.equal(visit(7, liveInput().input).tap, null);
    assert.equal(dev.read().reason, 'incompatible-seed');
  } finally { dev.dispose(); }
  assert.equal(openSceneTickTap({ scene: 'demo', game: { id: 'demo', version: '1' }, inputs: [], seed: 1, step: 1, world: new World(), live: liveInput().input, invalidate() {} }), null,
    'dispose removes the factory');
});

test('SIM-01 dev replay: recording overflow is explicit and keeps a replayable prefix', () => {
  const dev = createReplayDev();
  try {
    dev.arm({ mode: 'record', maxTicks: 10 }, 'demo');
    const live = liveInput(), a = visit(3, live.input);
    a.tap!.arrive();
    for (let f = 0; f < 20; f++) { live.state.axis = f % 2 ? 1 : -1; a.frame(1 / 60); }
    const s = dev.read();
    assert.equal(s.status, 'truncated');
    assert.equal(s.ticks, 10);
    assert.match(s.reason!, /tick 10/);
    dev.arm({ mode: 'replay', log: s.log! }, 'demo');
    const b = visit(3, liveInput().input); b.tap!.arrive();
    for (let f = 0; f < 20; f++) b.frame(1 / 60);
    assert.equal(dev.read().comparison?.status, 'equal');
  } finally { dev.dispose(); }
});

test('SIM-01 dev replay: an empty recording replays as complete, with no claimed pass', () => {
  const dev = createReplayDev();
  try {
    dev.arm({ mode: 'record' }, 'demo');
    const a = visit(5, liveInput().input); a.tap!.arrive();
    dev.stop();                                   // stopped before the first tick
    const empty = dev.read();
    assert.deepEqual([empty.status, empty.ticks], ['stopped', 0]);
    assert.equal(dev.arm({ mode: 'replay', log: empty.log! }, 'demo').status, 'started');
    const b = visit(5, liveInput().input);
    assert.ok(b.tap, 'the visit is tapped (the factory did not throw)');
    b.tap!.arrive();
    assert.deepEqual([dev.read().status, dev.read().comparison], ['complete', { status: 'incomparable', reason: 'no-overlap' }]);
  } finally { dev.dispose(); }
});

test('SIM-01 dev replay: a record request is refused when its log could not be reopened', async () => {
  const { recordLogBound } = await import('./replay');
  const log = { maxBytes: 64 << 10, maxNodes: 4096, maxDepth: 8 };
  const dev = createReplayDev({ log });
  try {
    // Largest digest ring that fits beside 8 KiB of input, by bytes and by nodes.
    const maxBytes = 8 << 10, maxTicks = 600;
    let maxDigests = 1;
    while (true) { const b = recordLogBound(maxTicks, maxBytes, maxDigests + 1); if (b.bytes > log.maxBytes || b.nodes > log.maxNodes) break; maxDigests++; }
    assert.deepEqual(dev.arm({ mode: 'record', maxTicks, maxBytes, maxDigests: maxDigests + 1 }, 'demo'), { status: 'refused', reason: 'log-limit' });
    const defaults = createReplayDev();   // installs its own tap factory: dispose it before using `dev` again
    try { assert.deepEqual(defaults.arm({ mode: 'record', maxTicks: 1 << 20 }, 'demo'), { status: 'refused', reason: 'log-limit' },
      'the default 8 MiB log cannot hold a digest of every one of 2^20 ticks'); } finally { defaults.dispose(); }
    // At the boundary: fill the input budget with distinct inputs (one run per tick) and every digest, then reopen.
    assert.equal(dev.arm({ mode: 'record', maxTicks, maxBytes, maxDigests }, 'demo').status, 'started');
    let n = 0;
    const quotes: InputSource = { describe: () => null, pressed: () => false, held: () => false, axis: () => (++n % 2 ? 1 : -1) * (1 + n / 7), pointer: { x: 0, y: 0, down: false, pressed: false } };
    const a = visit(1, quotes); a.tap!.arrive();
    for (let f = 0; f < maxTicks + 10; f++) a.frame(1 / 60);
    const s = dev.read();
    assert.ok(['recording', 'truncated'].includes(s.status));
    assert.ok(new TextEncoder().encode(s.log!).length <= log.maxBytes);
    dev.arm({ mode: 'replay', log: s.log! }, 'demo');
    assert.equal(dev.read().status, 'armed', 'the boundary log reopens under the same limits');
  } finally { dev.dispose(); }
});

test('SIM-01 dev replay: an oversized log is refused before it is parsed', () => {
  const dev = createReplayDev({ log: { maxBytes: 1024, maxNodes: 4096, maxDepth: 8 } });
  try {
    const big = `{"format":"foundation.replay","version":1,"pad":"${'x'.repeat(2000)}"}`;
    const parse = JSON.parse;
    let parsed = 0;
    JSON.parse = ((...args: Parameters<typeof JSON.parse>) => { parsed++; return parse(...args); }) as typeof JSON.parse;
    try { assert.deepEqual(dev.arm({ mode: 'replay', log: big }, 'demo'), { status: 'refused', reason: 'corrupt-unreadable-or-over-limit' }); }
    finally { JSON.parse = parse; }
    assert.equal(parsed, 0);
  } finally { dev.dispose(); }
});

test('SIM-01 dev replay: stopping an armed request disarms it with a reason', () => {
  const dev = createReplayDev();
  try {
    dev.arm({ mode: 'record' }, 'demo');
    dev.stop('arrival-timeout');
    assert.deepEqual([dev.read().status, dev.read().reason], ['stopped', 'arrival-timeout']);
    assert.equal(visit(7, liveInput().input).tap, null, 'the next visit does not consume it');
    dev.arm({ mode: 'record' }, 'demo');
    dev.stop();
    assert.deepEqual([dev.read().status, dev.read().reason], ['stopped', 'stopped-before-arrival']);
  } finally { dev.dispose(); }
});

test('SIM-01 dev replay: a checksummed log with an undeclared action or malformed field is refused before replay', async () => {
  const { encodeReplay } = await import('../kits/replay');
  const dev = createReplayDev();
  try {
    dev.arm({ mode: 'record' }, 'demo');
    const a = visit(7, liveInput().input); a.tap!.arrive(); a.frame(0.1);
    const good = JSON.parse(dev.read().log!);
    for (const [bad, reason] of [['{"p":["fly"]}', 'invalid-tick-input-2'], ['{"x":[0,0,3,0]}', 'invalid-tick-input-2'], ['{"a":{"steer":"left"}}', 'invalid-tick-input-2']] as const) {
      const log = encodeReplay({ ...good, runs: [[2, '{}'], [1, bad], [good.ticks - 3, '{"a":{"steer":1}}']] });
      assert.equal(dev.arm({ mode: 'replay', log }, 'demo').status, 'started');
      assert.equal(visit(7, liveInput().input).tap, null);
      assert.deepEqual([dev.read().status, dev.read().reason], ['refused', reason]);
    }
  } finally { dev.dispose(); }
});
