import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplayRecorder, encodeReplay, openReplay, REPLAY_VERSION, RUN_OVERHEAD_BYTES, type OpenLimits, type ReplayLogData } from './log';
import { hashText } from './hash';
import { createDigestTrace } from './digest';

const header = { build: 'demo@1.0.0', config: 'scene:demo;inputs:jump,steer~', seed: 7, step: 1 / 60 };
const input = { maxBytes: 256, maxNodes: 32, maxDepth: 4 };
const limits = { maxTicks: 100, maxBytes: 4096, input };
const open: OpenLimits = { ...limits, log: { maxBytes: 65536, maxNodes: 4096, maxDepth: 8 } };
const expect = { build: header.build, config: header.config, step: header.step };

function recorded(ticks: number, at: (tick: number) => string = t => (t < 5 ? '{}' : t < 9 ? '{"a":{"steer":-1}}' : '{"p":["jump"]}')) {
  const r = createReplayRecorder({ header, limits });
  for (let t = 0; t < ticks; t++) assert.equal(r.record(t, at(t)).status, 'recorded');
  return r;
}
/** Re-encode a decoded log with a change, so the checksum is valid and only the changed rule can refuse it. */
function reencode(text: string, change: (d: Record<string, unknown>) => void) {
  const raw = JSON.parse(text) as Record<string, unknown>;
  delete raw.checksum;
  change(raw);
  // Recompute over the same canonical v1 body the codec checksums (sorted keys at every level).
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort((v as Record<string, unknown>)[k])])) : v;
  const body = JSON.stringify(sort(raw));
  return `{"checksum":${JSON.stringify(hashText(body))},${body.slice(1)}`;
}

test('SIM-01 log: a recording round-trips, run-length encoded, and replays tick by tick', () => {
  const r = recorded(12);
  assert.deepEqual(r.read(), { status: 'recording', reason: null, ticks: 12, runs: 3, bytes: 2 + 18 + 14 + 3 * RUN_OVERHEAD_BYTES, truncatedAt: null });
  const text = r.export();
  const opened = openReplay(text, open, expect);
  assert.equal(opened.status, 'ready');
  if (opened.status !== 'ready') return;
  const p = opened.player;
  assert.equal(p.ticks, 12);
  assert.equal(p.truncatedAt, null);
  assert.deepEqual(p.header, header);
  assert.deepEqual([0, 4, 5, 8, 9, 11].map(t => p.json(t)), ['{}', '{}', '{"a":{"steer":-1}}', '{"a":{"steer":-1}}', '{"p":["jump"]}', '{"p":["jump"]}']);
  assert.deepEqual(p.input(6), { a: { steer: -1 } });
  assert.ok(Object.isFrozen(p.input(6)));
  // Random access after sequential access, and past the end.
  assert.equal(p.json(2), '{}');
  assert.equal(p.json(12), undefined);
  assert.equal(p.input(-1), undefined);
  assert.equal(openReplay(r.export(), open, expect).status, 'ready', 'export is repeatable');
});

test('SIM-01 log: inputs are canonicalised, so key order and spacing do not create a new run', () => {
  const r = createReplayRecorder({ header, limits });
  r.record(0, '{"b":1,"a":2}');
  r.record(1, '{ "a": 2, "b": 1 }');
  assert.equal(r.read().runs, 1);
});

test('SIM-01 log: tick overflow stops at an explicit, replayable prefix', () => {
  const r = createReplayRecorder({ header, limits: { ...limits, maxTicks: 10 } });
  for (let t = 0; t < 10; t++) assert.equal(r.record(t, `{"n":${t % 3}}`).status, 'recorded');
  assert.deepEqual(r.record(10, '{"n":1}'), { status: 'truncated', truncatedAt: 10 });
  assert.deepEqual(r.record(11, '{"n":1}'), { status: 'truncated', truncatedAt: 10 }, 'later ticks change nothing');
  assert.equal(r.read().status, 'truncated');
  const opened = openReplay(r.export(), { ...open, maxTicks: 10 }, expect);
  assert.equal(opened.status, 'ready');
  if (opened.status === 'ready') { assert.equal(opened.player.ticks, 10); assert.equal(opened.player.truncatedAt, 10); }
});

test('SIM-01 log: byte overflow stops before the run that would exceed the limit', () => {
  const big = `{"s":"${'x'.repeat(40)}"}`;
  const cost = new TextEncoder().encode(big).length + RUN_OVERHEAD_BYTES;
  const r = createReplayRecorder({ header, limits: { ...limits, maxBytes: cost * 2 } });
  assert.equal(r.record(0, big).status, 'recorded');
  assert.equal(r.record(1, big).status, 'recorded', 'repeating the last input costs no new run');
  assert.equal(r.record(2, '{}').status, 'recorded');
  assert.equal(r.record(3, big).status, 'truncated');
  assert.deepEqual({ ticks: r.read().ticks, truncatedAt: r.read().truncatedAt }, { ticks: 3, truncatedAt: 3 });
  assert.ok(r.read().bytes <= cost * 2);
});

test('SIM-01 log: out-of-order ticks and malformed or oversized input fail the recording', () => {
  const a = createReplayRecorder({ header, limits });
  a.record(0, '{}');
  assert.deepEqual(a.record(2, '{}'), { status: 'failed', reason: 'tick-order' });
  assert.deepEqual(a.record(1, '{}'), { status: 'failed', reason: 'tick-order' }, 'a failed recording stays failed');
  assert.throws(() => a.export(), /failed recording/);
  const b = createReplayRecorder({ header, limits });
  assert.deepEqual(b.record(0, '{"x":'), { status: 'failed', reason: 'input' });
  const c = createReplayRecorder({ header, limits });
  assert.deepEqual(c.record(0, `"${'x'.repeat(300)}"`), { status: 'failed', reason: 'input' });
  const d = createReplayRecorder({ header, limits });
  assert.deepEqual(d.record(0, '1e999'), { status: 'failed', reason: 'input' }, 'non-finite numbers are refused');
});

test('SIM-01 log: invalid headers and limits are refused at construction', () => {
  assert.throws(() => createReplayRecorder({ header: { ...header, seed: -1 }, limits }), /seed/);
  assert.throws(() => createReplayRecorder({ header: { ...header, seed: 2 ** 32 }, limits }), /seed/);
  assert.throws(() => createReplayRecorder({ header: { ...header, step: 0 }, limits }), /step/);
  assert.throws(() => createReplayRecorder({ header: { ...header, build: '' }, limits }), /build/);
  assert.throws(() => createReplayRecorder({ header, limits: { ...limits, maxTicks: 0 } }), /maxTicks/);
  assert.throws(() => createReplayRecorder({ header, limits: { ...limits, input: { ...input, maxDepth: 0 } } }), /limits/);
});

test('SIM-01 log: another version is refused before its checksum or structure is trusted', () => {
  const text = recorded(4).export();
  for (const version of [REPLAY_VERSION + 1, 0, '1', null]) {
    const changed = reencode(text, d => { d.version = version; });
    assert.deepEqual(openReplay(changed, open, expect), { status: 'unsupported-version', version });
  }
});

test('SIM-01 log: a log for another build, configuration, step or seed is refused', () => {
  const text = recorded(4).export();
  assert.deepEqual(openReplay(text, open, { ...expect, build: 'demo@1.0.1' }),
    { status: 'incompatible', field: 'build', expected: 'demo@1.0.1', actual: 'demo@1.0.0' });
  assert.equal((openReplay(text, open, { ...expect, config: 'scene:other;inputs:' }) as { field: string }).field, 'config');
  assert.equal((openReplay(text, open, { ...expect, step: 1 / 30 }) as { field: string }).field, 'step');
  assert.deepEqual(openReplay(text, open, { ...expect, seed: 8 }), { status: 'incompatible', field: 'seed', expected: 8, actual: 7 });
  assert.equal(openReplay(text, open, { ...expect, seed: 7 }).status, 'ready');
});

test('SIM-01 log: corrupted logs are refused, whole', () => {
  const text = recorded(12).export();
  const status = (t: string) => { const r = openReplay(t, open, expect); return r.status === 'corrupt' ? r.reason : r.status; };
  // A flipped character in the payload breaks the checksum.
  assert.ok(text.includes('\\"steer\\":-1'));
  assert.equal(status(text.replace('\\"steer\\":-1', '\\"steer\\":-2')), 'checksum');
  assert.equal(status(text.replace(/"seed":7/, '"seed":8')), 'checksum');
  // Cut text, wrong format, extra fields.
  assert.equal(status(text.slice(0, text.length - 5)), 'unreadable-or-over-limit');
  assert.equal(status('[]'), 'structure');
  assert.equal(status(reencode(text, d => { d.format = 'other'; })), 'format');
  assert.equal(status(reencode(text, d => { d.extra = 1; })), 'fields');
  assert.equal(status(reencode(text, d => { (d.header as Record<string, unknown>).extra = 1; })), 'header');
  // Structurally wrong but correctly checksummed: tick count, unmerged or non-canonical runs, bad truncation.
  assert.equal(status(reencode(text, d => { d.ticks = 13; })), 'tick-count');
  assert.equal(status(reencode(text, d => { d.runs = [[1, '{}'], [1, '{}']]; d.ticks = 2; })), 'unmerged-run');
  assert.equal(status(reencode(text, d => { d.runs = [[2, '{ }']]; d.ticks = 2; })), 'non-canonical-input');
  assert.equal(status(reencode(text, d => { d.runs = [[0, '{}']]; d.ticks = 0; })), 'structure');
  assert.equal(status(reencode(text, d => { d.truncatedAt = 3; })), 'truncatedAt');
  assert.equal(status(reencode(text, d => { d.runs = [[2, '{"x":']]; d.ticks = 2; })), 'input');
  // Over the reader's limits.
  assert.equal(openReplay(text, { ...open, maxTicks: 11 }, expect).status, 'corrupt');
  assert.equal(openReplay(text, { ...open, log: { ...open.log, maxBytes: 64 } }, expect).status, 'corrupt');
});

test('SIM-01 log: embedded digests are checked and survive the round trip', () => {
  const trace = createDigestTrace({ identity: 'x', every: 2, maxEntries: 4, maxDigestLength: 16 });
  for (let t = 0; t < 12; t++) trace.observe(t, () => `d${t}`);
  const text = recorded(12).export(trace.read());
  const opened = openReplay(text, open, expect);
  assert.equal(opened.status, 'ready');
  if (opened.status === 'ready') assert.deepEqual(opened.player.digests, trace.read());
  const broken = reencode(text, d => { ((d.digests as Record<string, unknown>).entries as unknown[][])[0][0] = 3; });
  assert.equal(openReplay(broken, open, expect).status, 'corrupt', 'an entry off the cadence is refused');
  assert.equal(openReplay(text, { ...open, digests: { maxEntries: 3, maxDigestLength: 16 } }, expect).status, 'corrupt', 'more entries than the reader admits');
  // A sample removed (or its tick shifted) and re-checksummed no longer passes as a complete trace.
  const removed = reencode(text, d => { ((d.digests as Record<string, unknown>).entries as unknown[]).splice(1, 1); });
  assert.deepEqual(openReplay(removed, open, expect), { status: 'corrupt', reason: 'structure' });
  const hidden = reencode(text, d => { const g = d.digests as Record<string, unknown>; (g.entries as unknown[]).splice(0, 1); g.dropped = 1; });
  assert.deepEqual(openReplay(hidden, open, expect), { status: 'corrupt', reason: 'structure' }, 'eviction count must match the samples kept');
  const shifted = reencode(text, d => { const g = d.digests as Record<string, unknown>; g.dropped = 3; });
  assert.equal(openReplay(shifted, open, expect).status, 'corrupt');
  const extended = reencode(text, d => { (d.digests as Record<string, unknown>).lastTick = 13; });
  assert.equal(openReplay(extended, open, expect).status, 'corrupt', 'a range with an unrecorded sample is refused');
  // Empty and failed traces are still accepted as recorded.
  const empty = createDigestTrace({ identity: 'x', every: 1, maxEntries: 4, maxDigestLength: 16 });
  assert.equal(openReplay(recorded(12).export(empty.read()), open, expect).status, 'ready');
  const failing = createDigestTrace({ identity: 'x', every: 1, maxEntries: 4, maxDigestLength: 16 });
  failing.observe(0, () => 'a'); failing.observe(1, () => '');
  assert.equal(openReplay(recorded(12).export(failing.read()), open, expect).status, 'ready');
});

test('SIM-01 log: encodeReplay output is the canonical text openReplay checks', () => {
  const data: ReplayLogData = { header, ticks: 2, truncatedAt: null, runs: [[2, '{}']], digests: null };
  const text = encodeReplay(data);
  assert.equal(openReplay(text, open, expect).status, 'ready');
  assert.equal(text, encodeReplay(data));
  assert.match(text, /^\{"checksum":"[0-9a-f]{16}","digests":null,"format":"foundation\.replay","header":/);
});
