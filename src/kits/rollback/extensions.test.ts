import test from 'node:test';
import assert from 'node:assert/strict';
import {rollbackChecksum} from './limits';
import {createRollbackSession} from './session';
import {createRollbackSpectator} from './spectator';
import {createRollbackExchange, type RollbackMessage} from './exchange';
import {createDesyncEvidenceStore} from './evidence';
import {recommendInputDelay, recommendPacing} from './pacing';
import {baseLimits, toyPorts, toyStart, toyStep, type ToyPorts} from './test-harness';
import type {RollbackDelayPolicy, RollbackLimits, RollbackOptions, RollbackSession} from './types';
import {must} from '../../testing/must';

const policy: RollbackDelayPolicy = {minDelay: 1, maxDelay: 5, maxStep: 2, minSpacing: 10, authority: 0};
type Overrides = Omit<Partial<RollbackOptions>, 'limits' | 'adaptiveDelay'> & {
  limits?: Partial<RollbackLimits>;
  adaptiveDelay?: RollbackDelayPolicy | null | undefined;
};
const make = (o: Overrides = {}, ports: ToyPorts = toyPorts()) =>
  createRollbackSession({
    local: 0,
    neutralInput: 'n',
    ...o,
    limits: {...baseLimits, ...o.limits},
    ports: o.ports ?? ports,
  } as RollbackOptions);
/** One tick: local input then advance. */
const tick = (s: RollbackSession, input = 'n') => {
  const l = s.local(input);
  return {l, a: s.advance()};
};
/** A tick that also confirms player 1's next input ('n'), so the session never stalls on it. */
const fed = (s: RollbackSession) => {
  let next = s.read().confirmedInputs[1]! + 1;
  return (input = 'n') => {
    const l = s.local(input);
    while (next <= s.read().confirmedInputs[0]!) s.remote(1, next++, 'n');
    return {l, a: s.advance()};
  };
};

test('EXTENSIONS invalid optional configuration is refused at construction; absent options keep the old config', () => {
  const bad: Overrides[] = [
    {adaptiveDelay: null},
    {adaptiveDelay: {...policy, minDelay: 3}}, // inputDelay 2 below the minimum
    {adaptiveDelay: {...policy, maxDelay: 31}},
    {adaptiveDelay: {...policy, maxStep: 0}},
    {adaptiveDelay: {...policy, minSpacing: 2}}, // must exceed maxStep
    {adaptiveDelay: {...policy, authority: 2}},
    {departure: {input: 'last' as 'repeat'}},
    {retainInputFrames: 3601},
    {retainInputFrames: 1.5},
    {start: {frame: -1, state: '{}', checksum: rollbackChecksum('{}')}},
    {evidence: {frames: 0, maxBytes: 64, chunkBytes: 64}},
    {evidence: {frames: 1, maxBytes: 63, chunkBytes: 64}},
  ];
  for (const o of bad) assert.throws(() => make(o), /rollback: invalid/, JSON.stringify(o));
  const describe: unknown = 3;
  assert.throws(
    () => make({evidence: {frames: 1, maxBytes: 64, chunkBytes: 64, describe: describe as () => string}}),
    /rollback: invalid evidence/,
  );
  const plain = make().read().config;
  assert.doesNotMatch(plain, /delay=|departure=|start=/, 'no extension, no config change');
  assert.match(make({adaptiveDelay: policy}).read().config, /:delay=1,5,2,10,0$/);
  assert.match(make({departure: {input: 'repeat'}}).read().config, /:departure=repeat,2$/, 'default: strict majority');
  assert.match(make({departure: {input: 'repeat', quorum: 1}}).read().config, /:departure=repeat,1$/);
  for (const quorum of [0, 3, 1.5])
    assert.throws(() => make({departure: {input: 'repeat', quorum}}), /rollback: invalid departure/);
});

test('EXTENSIONS delay proposals are refused unless the authority asks for an in-range, rate-limited change', () => {
  assert.deepEqual(make().proposeDelay(3), {status: 'invalid', reason: 'disabled'});
  assert.deepEqual(make({local: 1, adaptiveDelay: policy}).proposeDelay(3), {
    status: 'invalid',
    reason: 'not-authority',
  });
  const s = make({adaptiveDelay: policy});
  assert.deepEqual(s.proposeDelay(6), {status: 'invalid', reason: 'range'});
  assert.deepEqual(s.proposeDelay(2), {status: 'invalid', reason: 'unchanged'});
  assert.deepEqual(s.proposeDelay(5), {status: 'invalid', reason: 'step'});
  assert.deepEqual(s.proposeDelay(4), {status: 'pending', delay: 4});
  assert.deepEqual(s.proposeDelay(3), {status: 'invalid', reason: 'busy-proposal'});
});

test('EXTENSIONS a delay increase takes effect at the agreed frame and fills the new frames with the held input', () => {
  const s = make({adaptiveDelay: policy});
  const step = fed(s);
  s.proposeDelay(4);
  const {l} = step('r');
  // Attached to input frame 2; effective at 2 + maxPrediction 8 + maxDelay 5 + 1 = 16.
  assert.deepEqual(l, {status: 'queued', frame: 2, input: 'r', delay: {delay: 4, from: 16}});
  for (let i = 0; i < 13; i++) assert.equal(step('l').l.status, 'queued');
  assert.equal(s.read().delay, 4, 'the next input frame (16) uses the new delay');
  const grown = s.local('a');
  assert.deepEqual(grown, {status: 'queued', frame: 16, input: 'a', through: 18});
  assert.deepEqual(must(s.history(0, 16, 10)).status, 'ok');
  const h = s.history(0, 16, 10);
  assert.ok(h.status === 'ok');
  assert.deepEqual(
    h.entries.map(e => [e.frame, e.input]),
    [
      [16, 'a'],
      [17, 'a'],
      [18, 'a'],
    ],
  );
});

test('EXTENSIONS a delay decrease skips queueing until the frontier meets the shorter delay', () => {
  const s = make({adaptiveDelay: {...policy, minDelay: 0}, limits: {inputDelay: 3}});
  const step = fed(s);
  s.proposeDelay(1);
  step();
  for (let i = 0; i < 13; i++) assert.equal(step().l.status, 'queued');
  // Input frames through 16 were queued with delay 3; the change from frame 3 + 8 + 5 + 1 = 17 skips 2 ticks.
  const results: string[] = [];
  for (let i = 0; i < 6; i++) results.push(step().l.status);
  assert.ok(results.includes('full'), results.join());
  assert.equal(results.filter(r => r === 'full').length, 2);
  assert.equal(s.read().delay, 1);
});

test('EXTENSIONS remote delay decisions must come from the authority, respect the bounds and arrive in time', () => {
  const remote = (o: Overrides, change: {delay: number; from: number}, frame = 2) => {
    const s = make({local: 1, adaptiveDelay: policy, ...o});
    s.remote(0, frame, 'n', change);
    return s.read().reason;
  };
  assert.equal(remote({}, {delay: 4, from: 16}), null, 'a valid decision is accepted');
  assert.equal(remote({}, {delay: 4, from: 15}), 'remote-delay', 'effective too early');
  assert.equal(remote({}, {delay: 5, from: 16}), 'remote-delay', 'step too large');
  assert.equal(remote({}, {delay: 2, from: 16}), 'remote-delay', 'unchanged');
  assert.equal(remote({}, {delay: 9, from: 16}), 'remote-delay', 'out of range');
  assert.equal(remote({adaptiveDelay: undefined}, {delay: 4, from: 16}), 'remote-delay');
  const s = make({local: 2, adaptiveDelay: policy, limits: {players: 3}});
  s.remote(1, 2, 'n', {delay: 4, from: 16});
  assert.equal(s.read().reason, 'remote-delay', 'only the authority decides');
  // Spacing: a second decision closer than minSpacing to the first is a fault.
  const t = make({local: 1, adaptiveDelay: policy});
  t.remote(0, 2, 'n', {delay: 4, from: 16});
  t.remote(0, 3, 'n', {delay: 3, from: 25});
  assert.equal(t.read().reason, 'remote-delay');
  // A decision attached later in the stream is accepted while this peer is still behind its effective frame.
  const u = make({local: 1, adaptiveDelay: policy});
  for (let i = 0; i < 16; i++) {
    u.local('n');
    u.remote(0, 2 + i, 'n');
    u.advance();
  }
  u.remote(0, 18, 'n', {delay: 3, from: 18 + 8 + 5 + 1});
  assert.equal(u.read().status, 'running');
});

test('EXTENSIONS recommendations: delay hides half the round trip within the policy; pacing halves the difference', () => {
  const p = {minDelay: 1, maxDelay: 8, maxStep: 2};
  assert.equal(
    recommendInputDelay({roundTrip: 100, frameTime: 16, current: 2, policy: p}),
    4,
    'ceil(50/16)+1 = 5, step 2',
  );
  assert.equal(recommendInputDelay({roundTrip: 100, frameTime: 16, current: 4, policy: p}), 5);
  assert.equal(recommendInputDelay({roundTrip: 1000, frameTime: 16, current: 7, policy: p}), 8, 'clamped to max');
  assert.equal(recommendInputDelay({roundTrip: 0, frameTime: 16, current: 2, policy: p}), 2, 'hysteresis holds');
  assert.equal(recommendInputDelay({roundTrip: 0, frameTime: 16, current: 5, policy: p}), 3, 'falls by maxStep');
  assert.equal(recommendInputDelay({roundTrip: Number.NaN, frameTime: 16, current: 3, policy: p}), 3);
  assert.equal(recommendInputDelay({roundTrip: 10, frameTime: 0, current: 3, policy: p}), 3);
  assert.deepEqual(recommendPacing(6, 2, 1), {advantage: 2, skip: true});
  assert.deepEqual(recommendPacing(2, 2, 1), {advantage: 0, skip: false});
  assert.deepEqual(recommendPacing(Number.NaN, 2, 1), {advantage: 0, skip: false});
});

for (const rule of ['repeat', 'neutral'] as const)
  test(`EXTENSIONS departure (${rule}): two players agree alone and fix the departed input after the last frame`, () => {
    assert.deepEqual(make().disconnect(1), {status: 'unsupported'});
    const ports = toyPorts();
    const s = make({departure: {input: rule, quorum: 1}}, ports);
    tick(s, 'r');
    s.remote(1, 2, 'l');
    s.remote(1, 3, 'r');
    for (let i = 0; i < 4; i++) tick(s, 'r');
    // Predictions for player 1 used 'r' (its last input); it departs with last frame 3.
    assert.deepEqual(s.disconnect(1), {status: 'departed', decided: 3});
    assert.equal(s.remote(1, 4, 'a').status, 'ignored', 'later inputs of a departed player are ignored');
    for (let i = 0; i < 20; i++) assert.notEqual(tick(s, 'n').a.status, 'stalled');
    assert.equal(s.read().frameAdvantage[1], 0);
    const fixedInput = rule === 'repeat' ? 'r' : 'n';
    assert.deepEqual(s.read().departures, [{player: 1, reports: [[0, 3]], decided: 3, final: true, input: fixedInput}]);
    const confirmed = s.confirmedState()!;
    const state = toyStart();
    for (let f = 0; f < confirmed.frame; f++) {
      const p1 = f < 2 ? 'n' : f === 2 ? 'l' : f === 3 ? 'r' : fixedInput;
      const p0 = f < 2 ? 'n' : f < 7 ? 'r' : 'n';
      toyStep(state, [p0, p1], f);
    }
    assert.ok(confirmed.frame >= 20);
    assert.equal(confirmed.state, JSON.stringify(state), 'the corrected state matches the agreed inputs');
    // 'repeat' equals the prediction, so nothing is resimulated; 'neutral' rolls the predicted frames back.
    assert.equal(ports.calls.load > 0, rule === 'neutral');
  });

test('EXTENSIONS departure with three players waits for every survivor, takes the largest report and accepts relays', () => {
  const s = make({departure: {input: 'neutral'}, limits: {players: 3}});
  for (let f = 2; f <= 4; f++) s.remote(2, f, 'l');
  s.remote(1, 2, 'n');
  assert.deepEqual(s.disconnect(2), {status: 'leaving', decided: null});
  assert.equal(s.remote(2, 5, 'l').status, 'ignored', 'nothing beyond this peer`s own report before a decision');
  // Survivor 1 held more of player 2 (through frame 6).
  assert.deepEqual(s.remoteDeparture(1, 2, [[1, 6]], null), {status: 'leaving', decided: 6});
  assert.equal(s.remote(2, 5, 'r').status, 'accepted', 'a relayed input up to the decision is accepted');
  assert.deepEqual(s.remote(2, 6, 'r'), {status: 'accepted', rollbackFrom: null});
  assert.equal(s.read().departures[0]!.final, true);
  assert.equal(s.remote(2, 7, 'r').status, 'ignored');
  assert.deepEqual(s.read().departures[0]!.reports, [
    [0, 4],
    [1, 6],
  ]);
});

test('EXTENSIONS departure conflicts and being voted out fail closed', () => {
  const opts = {departure: {input: 'neutral' as const}, limits: {players: 3}};
  const a = make(opts);
  a.remoteDeparture(1, 2, [[1, 5]], null);
  a.remoteDeparture(1, 2, [[1, 6]], null);
  assert.equal(a.read().reason, 'departure-conflict', 'a reporter changed its report');
  const b = make(opts);
  for (let f = 2; f <= 6; f++) b.remote(2, f, 'n');
  b.remoteDeparture(1, 2, [[1, 3]], 3);
  assert.equal(b.read().reason, 'departure-conflict', 'a decision below what this peer holds');
  const c = make(opts);
  c.remoteDeparture(1, 0, [[1, 3]], null);
  assert.equal(c.read().reason, 'local-departed');
  const d = make(opts);
  d.remoteDeparture(1, 2, [[2, 3]], null);
  assert.equal(d.read().reason, 'remote-departure', 'a player cannot report on itself');
  const e = make(opts);
  e.disconnect(1);
  assert.deepEqual(
    e.remoteDeparture(1, 2, [[1, 3]], null),
    {status: 'ignored'},
    'a leaving peer`s reports are ignored',
  );
});

test('EXTENSIONS start: resume from an agreed state at frame F; mismatches are refused', () => {
  const state = JSON.stringify({...toyStart(), frame: 40});
  assert.throws(
    () => make({start: {frame: 40, state, checksum: rollbackChecksum(state) ^ 1}}),
    /start checksum mismatch/,
  );
  assert.throws(() => make({start: {frame: 40, state: 'x'.repeat(5000), checksum: 0}}), /state-bytes/);
  const failing = toyPorts();
  failing.load = () => {
    throw Error('no');
  };
  assert.throws(() => make({start: {frame: 40, state, checksum: rollbackChecksum(state)}}, failing), /refused by load/);
  const ports = [toyPorts(), toyPorts()];
  const start = {frame: 40, state, checksum: rollbackChecksum(state)};
  const [a, b] = ports.map((p, local) => make({local, start}, p)) as [RollbackSession, RollbackSession];
  assert.match(a.read().config, /:start=40,\d+$/);
  assert.equal(a.read().frame, 40);
  assert.equal(a.read().startFrame, 40);
  assert.deepEqual(a.confirmedState(), {frame: 40, checksum: start.checksum, state});
  assert.deepEqual(a.remoteChecksum(1, 36, 5), {status: 'inconclusive'}, 'below the checksum floor');
  const probe = make({start});
  assert.deepEqual(probe.local('r'), {status: 'queued', frame: 42, input: 'r'}, 'frames 40 and 41 are neutral');
  const c = make({local: 1, start});
  c.remote(0, 41, 'n');
  assert.equal(c.read().reason, 'remote-frame', 'a neutral frame cannot carry input');
  // Both peers continue in lockstep from frame 40 and agree.
  for (let i = 0; i < 30; i++) {
    const la = a.local('r'),
      lb = b.local('l');
    if (la.status === 'queued') b.remote(0, la.frame, la.input);
    if (lb.status === 'queued') a.remote(1, lb.frame, lb.input);
    a.advance();
    b.advance();
  }
  const ca = a.confirmedState()!,
    cb = b.confirmedState()!;
  assert.equal(ca.frame, cb.frame);
  assert.equal(ca.checksum, cb.checksum);
  assert.ok(ca.frame > 60);
});

test('EXTENSIONS evidence: retained per checksum frame, capped, chunked and kept after a desync', () => {
  assert.deepEqual(make().evidence(0), {status: 'unavailable', frame: 0, reason: 'disabled'});
  const tampered = toyPorts(2, (state, frame) => {
    if (frame === 9) state.hits += 100;
  });
  const opts = {evidence: {frames: 2, maxBytes: 100, chunkBytes: 64}};
  const a = make({...opts, local: 0}),
    b = make({...opts, local: 1}, tampered);
  for (let i = 0; i < 20; i++) {
    const la = a.local('a'),
      lb = b.local('a');
    if (la.status === 'queued') b.remote(0, la.frame, la.input);
    if (lb.status === 'queued') a.remote(1, lb.frame, lb.input);
    const ra = a.advance(),
      rb = b.advance();
    if ('checksums' in ra) for (const c of ra.checksums) b.remoteChecksum(0, c.frame, c.checksum);
    if ('checksums' in rb) for (const c of rb.checksums) a.remoteChecksum(1, c.frame, c.checksum);
  }
  const frame = must(a.read().desync).frame;
  assert.equal(frame, 12);
  const ea = a.evidence(),
    eb = b.evidence(frame);
  assert.ok(ea.status === 'ready' && eb.status === 'ready');
  assert.equal(ea.truncated, false);
  for (const c of [...ea.chunks, ...eb.chunks]) assert.ok(new TextEncoder().encode(c.text).length <= 64);
  assert.deepEqual(a.evidence(0), {status: 'unavailable', frame: 0, reason: 'not-retained'}, 'only 2 frames kept');
  const store = createDesyncEvidenceStore({maxBytes: 4096, maxChunks: 16, maxTexts: 8});
  for (const c of [...ea.chunks].reverse()) store.add('a', c);
  for (const c of eb.chunks) store.add('b', c);
  const cmp = store.compare(frame, 'a', 'b');
  assert.equal(cmp.status, 'different');
  assert.ok(cmp.status === 'different' && cmp.json?.status === 'found' && cmp.json.path === 'hits');
  // Truncation and a failing describe.
  const big = make({evidence: {frames: 1, maxBytes: 64, chunkBytes: 64, describe: s => s.repeat(10)}});
  tick(big);
  const e = big.evidence(0);
  assert.ok(e.status === 'ready' && e.truncated && e.chunks.length === 1);
  const broken = make({
    evidence: {
      frames: 1,
      maxBytes: 64,
      chunkBytes: 64,
      describe: () => {
        throw Error('x');
      },
    },
  });
  tick(broken);
  assert.deepEqual(broken.evidence(0), {status: 'unavailable', frame: 0, reason: 'describe-failed'});
});

test('EXTENSIONS evidence store refuses malformed, conflicting and over-budget chunks', () => {
  assert.throws(() => createDesyncEvidenceStore({maxBytes: 1, maxChunks: 1, maxTexts: 1}), /invalid limits/);
  const store = createDesyncEvidenceStore({maxBytes: 64, maxChunks: 2, maxTexts: 1});
  const chunk = {frame: 4, checksum: 1, index: 0, count: 2, truncated: false, text: 'line one\n'};
  assert.deepEqual(store.add('a', {...chunk, index: 2}), {status: 'refused', reason: 'chunk'});
  assert.deepEqual(store.add('a', {...chunk, count: 3}), {status: 'refused', reason: 'chunk'});
  assert.deepEqual(store.add('a', chunk), {status: 'stored'});
  assert.deepEqual(store.add('a', chunk), {status: 'duplicate'});
  assert.deepEqual(store.add('a', {...chunk, text: 'other'}), {status: 'refused', reason: 'conflict'});
  assert.deepEqual(store.add('a', {...chunk, index: 1, checksum: 2}), {status: 'refused', reason: 'conflict'});
  assert.deepEqual(store.add('b', chunk), {status: 'refused', reason: 'texts'});
  assert.deepEqual(store.add('a', {...chunk, index: 1, text: 'x'.repeat(60)}), {status: 'refused', reason: 'bytes'});
  assert.equal(store.text('a', 4), null);
  assert.deepEqual(store.add('a', {...chunk, index: 1, text: 'line two'}), {status: 'complete'});
  assert.equal(store.text('a', 4)!.text, 'line one\nline two');
  assert.deepEqual(store.compare(4, 'a', 'b'), {status: 'incomplete', missing: ['b']});
  store.clear();
  assert.deepEqual(store.read(), {bytes: 0, texts: 0, complete: 0});
  const two = createDesyncEvidenceStore({maxBytes: 4096, maxChunks: 1, maxTexts: 2});
  two.add('a', {...chunk, count: 1, text: 'x\ny'});
  two.add('b', {...chunk, count: 1, text: 'x\nz'});
  assert.deepEqual(two.compare(4, 'a', 'b'), {status: 'different', frame: 4, line: 2, a: 'y', b: 'z', json: null});
});

test('EXTENSIONS spectator runs only confirmed frames, bounds its buffer, catches up and detects a desync', () => {
  const limits = {...baseLimits};
  const opts = {limits, neutralInput: 'n', maxBufferedFrames: 10, catchUpThreshold: 3, catchUpFrames: 4};
  assert.throws(() => createRollbackSpectator({...opts, ports: toyPorts(), maxBufferedFrames: 0}), /invalid limits/);
  assert.throws(
    () => createRollbackSpectator({...opts, ports: toyPorts(), join: {frame: 5, state: '{}', checksum: 1}}),
    /join checksum mismatch/,
  );
  const sp = createRollbackSpectator({...opts, ports: toyPorts()});
  const msg = (inputs: [number, number, string][], checksums: [number, number][] = []): RollbackMessage => ({
    from: 0,
    sentAt: 0,
    echo: null,
    echoAge: 0,
    advantage: 0,
    ack: [0, 0],
    inputs: inputs.map(([player, frame, input]) => ({player, frame, input})),
    checksums: checksums.map(([frame, checksum]) => ({frame, checksum})),
    departures: [],
  });
  // Frames 0 and 1 are neutral; frame 2 needs both players.
  assert.deepEqual(sp.advance(), {
    status: 'advanced',
    frame: 1,
    frames: 1,
    ready: 1,
    checksums: [{frame: 0, checksum: rollbackChecksum(JSON.stringify(toyStart()))}],
  });
  sp.advance();
  assert.deepEqual(sp.advance(), {status: 'waiting', frame: 2, waitingFor: [0, 1]});
  const rows: [number, number, string][] = [];
  for (let f = 2; f < 30; f++) rows.push([0, f, 'r'], [1, f, 'l']);
  sp.receive(msg(rows));
  assert.deepEqual(sp.ack(), [12, 12], 'buffer of 10 frames beyond frame 2');
  assert.ok(sp.read().stats.full > 0);
  const first = sp.advance();
  assert.ok(first.status === 'advanced' && first.frames === 4, 'catches up 4 frames when more than 3 are ready');
  while (sp.advance().status === 'advanced');
  assert.equal(sp.read().frame, 13);
  sp.receive(msg(rows, [[16, 123]]));
  let last;
  do last = sp.advance();
  while (last.status === 'advanced');
  assert.equal(last.status, 'desynced');
  assert.equal(sp.read().desync!.frame, 16);
  assert.equal(sp.receive(msg([])).status, 'desynced');
  const aborted = new AbortController();
  const gone = createRollbackSpectator({...opts, ports: toyPorts(), signal: aborted.signal});
  aborted.abort();
  assert.equal(gone.advance().status, 'retired');
  const bad = createRollbackSpectator({...opts, ports: toyPorts()});
  bad.receive({...msg([]), ack: [1]});
  assert.equal(bad.read().reason, 'message-invalid');
});

test('EXTENSIONS exchange: malformed messages are rejected untouched; acknowledgements never move backwards', () => {
  const s = make({retainInputFrames: 40});
  assert.throws(
    () =>
      createRollbackExchange({
        session: s,
        limits: {maxInputsPerMessage: 0, maxChecksumsPerMessage: 0, roundTripSamples: 1},
      }),
    /invalid limits/,
  );
  const x = createRollbackExchange({
    session: s,
    limits: {maxInputsPerMessage: 3, maxChecksumsPerMessage: 2, roundTripSamples: 4},
  });
  for (let i = 0; i < 6; i++) tick(s, 'r');
  const out = x.outgoing(1, 10);
  assert.deepEqual(
    out.inputs.map(e => e.frame),
    [2, 3, 4],
    'oldest unacknowledged first, capped at 3',
  );
  const base: RollbackMessage = {
    from: 1,
    sentAt: 5,
    echo: 10,
    echoAge: 2,
    advantage: 0,
    ack: [4, 1],
    inputs: [],
    checksums: [],
    departures: [],
  };
  for (const bad of [
    {...base, from: 0},
    {...base, from: 7},
    {...base, ack: [1]},
    {...base, echoAge: -1},
    {...base, inputs: [{player: 1, frame: 2, input: 3}]},
    {
      ...base,
      inputs: [
        {player: 1, frame: 2, input: 'n'},
        {player: 1, frame: 3, input: 'n'},
        {player: 1, frame: 4, input: 'n'},
        {player: 1, frame: 5, input: 'n'},
      ],
    },
    {...base, checksums: [{frame: 1, checksum: -1}]},
  ])
    assert.equal(x.receive(bad as RollbackMessage, 12).status, 'rejected');
  assert.equal(s.read().status, 'running');
  assert.deepEqual(x.receive(base, 13), {status: 'applied', accepted: 0, duplicates: 0, ignored: 0, gaps: 0});
  assert.equal(x.read().roundTrip[1], 1, 'round trip = 13 - 10 - 2');
  assert.deepEqual(
    x.outgoing(1, 14).inputs.map(e => e.frame),
    [5, 6, 7],
  );
  x.receive({...base, sentAt: 4, ack: [2, 1]}, 15); // an older, reordered message
  assert.deepEqual(
    x.outgoing(1, 16).inputs.map(e => e.frame),
    [5, 6, 7],
    'a stale acknowledgement does not cause a resend of acknowledged frames',
  );
  // Gaps: frame 4 without 2 and 3 is skipped (and counted), not a protocol fault.
  const r = x.receive({...base, inputs: [{player: 1, frame: 4, input: 'l'}]}, 17);
  assert.deepEqual(r, {status: 'applied', accepted: 0, duplicates: 0, ignored: 0, gaps: 1});
  const r2 = x.receive({...base, inputs: [2, 3, 4].map(frame => ({player: 1, frame, input: 'l'}))}, 18);
  assert.deepEqual(r2, {status: 'applied', accepted: 3, duplicates: 0, ignored: 0, gaps: 0});
  assert.equal(s.read().confirmedInputs[1], 4);
});

test('EXTENSIONS exchange pacing: the peer that runs ahead is told to skip; timeouts start a departure', () => {
  const s = make({departure: {input: 'neutral', quorum: 1}});
  const x = createRollbackExchange({
    session: s,
    limits: {maxInputsPerMessage: 8, maxChecksumsPerMessage: 0, roundTripSamples: 2},
    pacingThreshold: 1,
    timeout: 10,
  });
  for (let i = 0; i < 6; i++) tick(s);
  const m: RollbackMessage = {
    from: 1,
    sentAt: 0,
    echo: null,
    echoAge: 0,
    advantage: -6,
    ack: [1, 1],
    inputs: [],
    checksums: [],
    departures: [],
  };
  x.receive(m, 0);
  assert.equal(s.read().frameAdvantage[1], 7, 'frame 6 against an estimated frame of 1 - 2');
  assert.deepEqual(x.read().pacing, {advantage: 6.5, skip: true});
  assert.deepEqual(x.expire(5), []);
  assert.deepEqual(x.expire(11), [1]);
  assert.equal(s.read().departures[0]!.final, true);
  assert.deepEqual(x.receive(m, 12), {status: 'ignored'}, 'messages of a departed peer are ignored');
});

test('EXTENSIONS new calls refuse while a port runs and after disposal', () => {
  const seen: string[] = [];
  let session: RollbackSession | null = null;
  const ports = toyPorts();
  const step = ports.step;
  ports.step = (inputs, frame) => {
    step(inputs, frame);
    const s = must(session);
    seen.push(s.proposeDelay(3).status, s.disconnect(1).status, s.remoteDeparture(1, 0, [[1, 1]], null).status);
    seen.push(s.history(0, 0, 4).status);
  };
  session = make({adaptiveDelay: policy, departure: {input: 'neutral'}}, ports);
  tick(session);
  assert.deepEqual(seen, ['busy', 'busy', 'busy', 'busy']);
  session.dispose();
  assert.equal(session.proposeDelay(3).status, 'retired');
  assert.equal(session.disconnect(1).status, 'retired');
  assert.equal(session.history(0, 0, 4).status, 'retired');
  assert.deepEqual(session.recentChecksums(4), []);
  assert.deepEqual(session.evidence(0), {status: 'unavailable', frame: 0, reason: 'disabled'});
});

test('EXTENSIONS departure quorum: an isolated peer never decides; two players need quorum 1 to decide at all', () => {
  const two = make({departure: {input: 'neutral'}});
  assert.deepEqual(two.disconnect(1), {status: 'leaving', decided: null}, 'one of two is not a strict majority');
  for (let i = 0; i < 20; i++) tick(two);
  assert.equal(two.read().departures[0]!.decided, null);
  assert.ok(two.read().stats.stalls > 0, 'it stalls instead of deciding alone');
  // Three players: peer 0 alone (both others leaving in its view) cannot decide; 2 of 3 can.
  const alone = make({departure: {input: 'neutral'}, limits: {players: 3}});
  alone.disconnect(1);
  alone.disconnect(2);
  assert.ok(alone.read().departures.every(d => d.decided === null));
  const pair = make({departure: {input: 'neutral'}, limits: {players: 3}});
  pair.disconnect(2);
  pair.remoteDeparture(1, 2, [[1, 1]], null);
  assert.equal(pair.read().departures[0]!.decided, 1);
});

test('EXTENSIONS an accusation from a peer held as leaving fails this peer while its own decision is open', () => {
  const opts = {departure: {input: 'neutral' as const}, limits: {players: 3}};
  const open = make(opts);
  open.disconnect(1);
  open.remoteDeparture(1, 0, [[1, 1]], null);
  assert.equal(open.read().reason, 'local-departed');
  const settled = make(opts);
  settled.disconnect(1);
  settled.remoteDeparture(2, 1, [[2, 1]], null);
  assert.equal(settled.read().departures[0]!.decided, 1);
  assert.deepEqual(settled.remoteDeparture(1, 0, [[1, 1]], null), {status: 'ignored'}, 'decided with a quorum');
  assert.equal(settled.read().status, 'running');
});

test('EXTENSIONS exchange hardening: forged relays, acknowledgements and advantages are bounded; reentry is busy', () => {
  const s = make({departure: {input: 'neutral'}, limits: {players: 3}});
  const x = createRollbackExchange({
    session: s,
    limits: {maxInputsPerMessage: 8, maxChecksumsPerMessage: 0, roundTripSamples: 2},
  });
  const m: RollbackMessage = {
    from: 1,
    sentAt: 0,
    echo: null,
    echoAge: 0,
    advantage: -(2 ** 31),
    ack: [2 ** 53 - 1, 1, 1],
    inputs: [{player: 2, frame: 2, input: 'l'}],
    checksums: [],
    departures: [],
  };
  assert.deepEqual(x.receive(m, 0), {status: 'applied', accepted: 0, duplicates: 0, ignored: 1, gaps: 0});
  assert.equal(s.read().confirmedInputs[2], 1, 'peer 1 cannot inject peer 2`s input');
  assert.ok(x.read().pacing.advantage <= s.read().maxLead, 'advantage clamped');
  tick(s, 'r');
  assert.deepEqual(
    x.outgoing(1, 1).inputs.map(e => e.frame),
    [2],
    'an acknowledgement beyond what was sent does not stop resends',
  );
  const badReports: (readonly (readonly [number, number])[])[] = [[], [[2, 1]]];
  for (const reports of badReports)
    assert.equal(x.receive({...m, departures: [{player: 2, reports, decided: null}]}, 1).status, 'rejected');
  assert.equal(s.read().status, 'running');
  // Reentry from a port reports busy, not stopped.
  let inner: unknown = null;
  const ports = toyPorts(2);
  const validate = ports.validateInput!;
  let ex: ReturnType<typeof createRollbackExchange> | null = null;
  ports.validateInput = input => {
    if (input === 'a' && ex)
      inner = ex.receive({...m, ack: [1, 1], advantage: 0, inputs: [{player: 1, frame: 2, input: 'n'}]}, 2);
    return validate(input);
  };
  const t = make({}, ports);
  ex = createRollbackExchange({
    session: t,
    limits: {maxInputsPerMessage: 8, maxChecksumsPerMessage: 0, roundTripSamples: 2},
  });
  t.local('a');
  assert.deepEqual(inner, {status: 'busy'});
});
