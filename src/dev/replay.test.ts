import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../core/ecs/world';
import { createSystemRunner } from '../core/ecs/systems';
import { createRng } from '../core/rng';
import { openSceneTickTap, type SceneTickTap } from '../author/scene-tick-tap';
import { defineComponent, Transform, type SceneReplayDigest } from '../author/defs';
import type { InputSource } from '../author/defs';
import { replayDigest } from '../kits/replay';
import { createReplayDev, type ReplayDevRequest } from './replay';

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

/**
 * The demo game's case (W1-1): a cosmetic orb bobbed by a frame-phase system on frame time. Its Transform depends on the
 * frame grouping, so the default digest (every Transform) can never replay; a digest that excludes the cosmetic tag can.
 */
const Cosmetic = defineComponent('cosmetic', {});
const Score = defineComponent('score', { value: 0 });
function orbVisit(seed: number, live: InputSource, replayDigest: SceneReplayDigest | null = null) {
  const world = new World();
  const body = world.spawn(Transform({ x: 0 }), Score({ value: 0 }));
  const orb = world.spawn(Transform({ x: 2, y: 1 }), Cosmetic());
  const tap = openSceneTickTap({ scene: 'demo', game: { id: 'demo', version: '1.0.0' }, inputs: [{ id: 'steer', axis: true }, { id: 'jump', axis: false }],
    seed, step: 1 / 60, world, replayDigest, live, invalidate() {} });
  const rng = createRng(seed);
  const input = tap?.input ?? live;
  let clock = 0;
  const systems = [
    { id: 'b', run: () => tap!.beforeTick() },
    { id: 'move', run: () => { const t = world.get(body, Transform)!; t.x += input.axis('steer') * 0.1 + rng.next() * 0.01; if (input.pressed('jump')) world.get(body, Score)!.value++; } },
    { id: 'e', run: () => tap!.afterTick() },
    { id: 'bob', phase: 'frame' as const, run: (_: unknown, dt: number) => { clock += dt; world.get(orb, Transform)!.y = 1 + Math.sin(clock * 3) * 0.25; } },
  ];
  const runner = createSystemRunner(systems);
  return { tap, world, body, orb, frame(dt: number) { if (tap!.running()) runner.frame({}, dt); } };
}
/** Record under a ragged frame grouping, then replay under a steady 60 Hz one; returns the replay's final state. */
function recordAndReplay(dev: ReturnType<typeof createReplayDev>, request: Partial<ReplayDevRequest>, replayRequest: Partial<ReplayDevRequest> = { digest: request.digest },
  sceneDigest: SceneReplayDigest | null = null, fault?: (visit: ReturnType<typeof orbVisit>, frame: number) => void) {
  assert.equal(dev.arm({ mode: 'record', ...request }, 'demo').status, 'started');
  const live = liveInput(), a = orbVisit(7, live.input, sceneDigest);
  a.tap!.arrive();
  for (let f = 0; f < 50; f++) { live.state.axis = f < 25 ? -1 : 1; live.state.jump = f === 30; a.frame(f % 3 === 0 ? 0.05 : 0.008); }
  const recorded = dev.read();
  dev.stop();
  const start = dev.arm({ mode: 'replay', log: recorded.log!, ...replayRequest }, 'demo');
  assert.equal(start.status, 'started', JSON.stringify(start));
  const b = orbVisit(7, liveInput().input, sceneDigest);
  if (!b.tap) return { recorded, replayed: dev.read() };
  b.tap.arrive();
  for (let f = 0; f < 400 && dev.read().status === 'replaying'; f++) { fault?.(b, f); b.frame(1 / 60); }
  return { recorded, replayed: dev.read() };
}

test('SIM-02 replay digest: the demo case (frame-phase orb animation) diverges by default and the detail names the orb', () => {
  const dev = createReplayDev();
  try {
    const { recorded, replayed } = recordAndReplay(dev, { detail: true });
    assert.equal(recorded.digest, null);
    assert.equal(replayed.status, 'complete');
    assert.equal(replayed.comparison?.status, 'diverged');
    const d = replayed.divergence!;
    assert.equal(d.status, 'found', JSON.stringify(d));
    if (d.status !== 'found') return;
    assert.deepEqual([d.kind, d.entity, d.component, d.field], ['value', 2, 'transform', 'y'], JSON.stringify(d));
    assert.equal(d.tick, (replayed.comparison as { tick: number }).tick);
    assert.match(d.path, /^entities\[1\]\[1\]\.transform\.y$/);
    assert.ok(d.a !== d.b && d.a !== null && d.b !== null);
  } finally { dev.dispose(); }
});

test('SIM-02 replay digest: excluding the cosmetic tag replays the demo case exactly (request digest)', () => {
  const dev = createReplayDev();
  try {
    const digest = { exclude: ['cosmetic'], components: ['transform', 'score'] };
    const { recorded, replayed } = recordAndReplay(dev, { digest, detail: true });
    assert.equal(recorded.digest, 'select:c=transform,score;x=cosmetic;r=all');
    assert.match(JSON.parse(recorded.log!).digests.identity, /\|digest:select:c=transform,score;x=cosmetic;r=all$/);
    assert.equal(replayed.status, 'complete');
    assert.deepEqual(replayed.comparison, { status: 'equal', from: 0, through: recorded.ticks - 1, samples: recorded.ticks });
    assert.equal(replayed.divergence, null);
    assert.equal(replayed.digest, recorded.digest);
  } finally { dev.dispose(); }
});

test('SIM-02 replay digest: a scene definition digest is the default, and gameplay faults are still found by field', () => {
  const dev = createReplayDev();
  try {
    const scene = replayDigest({ id: 'orb-run-v1', components: [Transform, Score], exclude: [Cosmetic], resources: false });
    const clean = recordAndReplay(dev, { detail: true }, { }, scene);
    assert.equal(clean.recorded.digest, 'orb-run-v1');
    assert.equal(clean.replayed.comparison?.status, 'equal');
    // A fault the log cannot explain: the score changes outside the fixed lane in the replay only.
    const faulty = recordAndReplay(dev, { detail: true }, {}, scene, (v, f) => { if (f === 20) v.world.get(v.body, Score)!.value += 5; });
    assert.equal(faulty.replayed.comparison?.status, 'diverged');
    const d = faulty.replayed.divergence!;
    assert.equal(d.status, 'found');
    if (d.status !== 'found') return;
    assert.deepEqual([d.kind, d.entity, d.component, d.field], ['value', 1, 'score', 'value']);
    // Without detail in the log the divergence is still found, but not explained.
    const bare = recordAndReplay(dev, {}, {}, scene, (v, f) => { if (f === 20) v.world.get(v.body, Score)!.value += 5; });
    assert.equal(bare.replayed.comparison?.status, 'diverged');
    assert.deepEqual(bare.replayed.divergence, { status: 'unavailable', tick: d.tick, reason: 'no-detail' });
  } finally { dev.dispose(); }
});

test('SIM-02 replay digest: a log is refused under another digest, and malformed digest or detail requests are refused', () => {
  const dev = createReplayDev();
  try {
    // Recorded with a selection, replayed with the default: refused at the visit, never compared.
    const { replayed } = recordAndReplay(dev, { digest: { exclude: ['cosmetic'] } }, { digest: undefined });
    assert.deepEqual([replayed.status, replayed.reason], ['refused', 'incompatible-digest']);
    // And the other way round, and between two selections.
    const again = recordAndReplay(dev, {}, { digest: { exclude: ['cosmetic'] } });
    assert.deepEqual([again.replayed.status, again.replayed.reason], ['refused', 'incompatible-digest']);
    const other = recordAndReplay(dev, { digest: { exclude: ['cosmetic'] } }, { digest: { exclude: ['cosmetic'], resources: false } });
    assert.equal(other.replayed.reason, 'incompatible-digest');
    for (const digest of [{ id: 'has space', state: () => 1 }, { id: 'x', state: 'nope' }, { id: 'bad id' }, { components: ['Not Kebab'] }, { components: 'transform' }, { exclude: ['a', 'a'] },
      { resources: [''] }, { count: 1 }, { components: Array.from({ length: 65 }, (_, i) => `c${i}`) }, null, 7]) {
      assert.deepEqual(dev.arm({ mode: 'record', digest: digest as never }, 'demo'), { status: 'refused', reason: 'digest' }, JSON.stringify(digest));
    }
    for (const detail of [{ from: -1 }, { from: 5, to: 4 }, { maxChars: 0 }, { maxChars: 1.5 }, 'yes']) {
      assert.deepEqual(dev.arm({ mode: 'record', detail: detail as never }, 'demo'), { status: 'refused', reason: 'detail' }, JSON.stringify(detail));
    }
    assert.deepEqual(dev.arm({ mode: 'record', detail: { maxChars: 8 << 20 } }, 'demo'), { status: 'refused', reason: 'log-limit' },
      'detail counts toward the log bound');
  } finally { dev.dispose(); }
});

test('SIM-02 replay digest: a throwing or oversized creator digest fails the session, and detail is bounded', () => {
  const dev = createReplayDev();
  try {
    const throwing = { id: 'boom', state: () => { throw Error('no'); } };
    const { recorded } = recordAndReplay(dev, { digest: throwing });
    assert.deepEqual([recorded.status, recorded.reason], ['failed', 'digest-threw']);
    const cyclic = { id: 'cyclic', state: () => { const o: Record<string, unknown> = {}; o.o = o; return o; } };
    assert.equal(recordAndReplay(dev, { digest: cyclic }).recorded.reason, 'digest-threw');
    const undef = { id: 'undefined', state: () => undefined };
    assert.equal(recordAndReplay(dev, { digest: undef }).recorded.reason, 'digest-threw');
    // A tiny detail budget keeps only the earliest samples; a later divergence is found but cannot be explained.
    const small = recordAndReplay(dev, { detail: { maxChars: 400 }, digest: { exclude: ['cosmetic'] } }, { digest: { exclude: ['cosmetic'] } }, null,
      (v, f) => { if (f === 30) v.world.get(v.body, Transform)!.z = 9; });
    const log = JSON.parse(small.recorded.log!);
    assert.equal(log.digests.detailTruncated, true);
    assert.ok(log.digests.details.reduce((n: number, [, t]: [number, string]) => n + t.length, 0) <= 400);
    assert.equal(small.replayed.comparison?.status, 'diverged');
    assert.equal(small.replayed.divergence?.status, 'unavailable');
  } finally { dev.dispose(); }
});

test('SIM-02 replay digest: coverage, replay-side detail and over-long identities are reported, not ignored', () => {
  const dev = createReplayDev();
  try {
    const { recorded, replayed } = recordAndReplay(dev, { digest: { components: ['transform', 'scroe'], exclude: ['cosmetic'] } });
    assert.deepEqual(recorded.coverage?.unmatched, ['scroe']);
    assert.deepEqual([replayed.comparison?.status, replayed.coverage?.unmatched], ['equal', ['scroe']]);
    assert.equal(recordAndReplay(dev, {}).recorded.coverage, null, 'the default digest has no selection coverage');
    assert.deepEqual(dev.arm({ mode: 'replay', log: recorded.log!, detail: true }, 'demo'), { status: 'refused', reason: 'detail' });
    // An identity over 512 characters is refused at the visit instead of leaving the session armed.
    dev.arm({ mode: 'record', digest: { id: 'd'.repeat(128), exclude: ['cosmetic'] } }, 'demo');
    const tap = openSceneTickTap({ scene: 'demo', game: { id: 'g'.repeat(400), version: '1' }, inputs: [], seed: 1, step: 1 / 60, world: new World(), live: liveInput().input, invalidate() {} });
    assert.equal(tap, null);
    assert.deepEqual([dev.read().status, dev.read().reason], ['refused', 'identity-too-long']);
  } finally { dev.dispose(); }
});
