import test from 'node:test';
import assert from 'node:assert/strict';
import {captureRollbackLimits, rollbackChecksum, utf8BytesWithin} from './limits';
import {createRollbackSession} from './session';
import {baseLimits, referenceChecksums, runPeers, toyPorts, type ToyPorts} from './test-harness';
import type {RollbackLimits, RollbackOptions, RollbackSession} from './types';
import {must} from '../../testing/must';

const make = (
  o: Omit<Partial<RollbackOptions>, 'limits'> & {limits?: Partial<RollbackLimits>} = {},
  ports: ToyPorts = toyPorts(),
) => {
  const session = createRollbackSession({
    local: 0,
    neutralInput: 'n',
    ...o,
    limits: {...baseLimits, ...o.limits},
    ports: o.ports ?? ports,
  });
  return {session, ports};
};
/** Run `n` ticks of local input then advance; returns the advance statuses. */
const tick = (s: RollbackSession, n: number, input = 'n') => {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    s.local(input);
    out.push(s.advance().status);
  }
  return out;
};

test('ROLLBACK limits: exact keys, safe integers and ranges are required before any work', () => {
  const bad: unknown[] = [
    null,
    undefined,
    {},
    {...baseLimits, players: 1},
    {...baseLimits, players: 9},
    {...baseLimits, maxPredictionFrames: -1},
    {...baseLimits, maxPredictionFrames: 61},
    {...baseLimits, inputDelay: 1.5},
    {...baseLimits, maxStateBytes: Number.POSITIVE_INFINITY},
    {...baseLimits, checksumInterval: 0},
    {...baseLimits, extra: 1},
    {...baseLimits, maxPendingChecksums: Number.NaN},
    (({maxChecksumHistory: _, ...rest}) => rest)(baseLimits),
  ];
  for (const limits of bad)
    assert.throws(() => captureRollbackLimits(limits as RollbackLimits), /rollback: invalid limits/);
  const supplied = {...baseLimits};
  const s = createRollbackSession({local: 1, neutralInput: 'n', limits: supplied, ports: toyPorts()});
  supplied.maxPredictionFrames = 0;
  assert.match(s.read().config, /"maxPredictionFrames":8/);
  for (const options of [
    {local: 2},
    {local: -1},
    {local: 0.5},
    {neutralInput: 'x'},
    {neutralInput: 'n'.repeat(9)},
    {neutralInput: 3},
    {ports: null},
    {ports: {save: () => ''}},
    {signal: {}},
  ])
    assert.throws(
      () =>
        createRollbackSession({
          local: 0,
          neutralInput: 'n',
          limits: baseLimits,
          ports: toyPorts(),
          ...options,
        } as unknown as RollbackOptions),
      /rollback: invalid/,
    );
});

test('ROLLBACK utf8 bound counts exact UTF-8 bytes, lone surrogates as U+FFFD, and stops at the limit', () => {
  for (const text of ['', 'abc', 'é', '€', '😀', '\ud800', 'a\udc00b', '😀\ud83d'])
    assert.equal(utf8BytesWithin(text, 100), new TextEncoder().encode(text).length);
  assert.equal(utf8BytesWithin('€€', 5), Infinity);
  assert.equal(utf8BytesWithin('x'.repeat(10), 9), Infinity);
});

for (const [name, limits, minDelay, maxDelay] of [
  ['delay 2, prediction 8, jittery 0-6 tick links', {inputDelay: 2, maxPredictionFrames: 8}, 0, 6],
  ['delay 0, prediction 8, links slower than the window', {inputDelay: 0, maxPredictionFrames: 8}, 6, 14],
  ['delay 3, prediction 2', {inputDelay: 3, maxPredictionFrames: 2}, 1, 7],
  ['three players', {players: 3, inputDelay: 1, maxPredictionFrames: 6}, 0, 5],
] as const) {
  test(`ROLLBACK peers converge on the no-network reference: ${name}`, () => {
    const ticks = 240;
    for (const seed of [1, 2, 3]) {
      const run = runPeers({limits, ticks, seed, minDelay, maxDelay});
      const merged = {...baseLimits, ...limits};
      const reference = referenceChecksums(run, ticks, merged.inputDelay, rollbackChecksum);
      assert.ok(reference.length > ticks, 'every frame has queued inputs from every peer');
      for (const [i, s] of run.sessions.entries()) {
        const r = s.read();
        assert.equal(r.status, 'running', `peer ${i}: ${r.reason}`);
        assert.ok(r.confirmedFrame >= ticks, `peer ${i} confirmed ${r.confirmedFrame}`);
        assert.ok(must(run.published[i]).size >= ticks / merged.checksumInterval - 1);
        for (const [frame, checksum] of must(run.published[i]))
          assert.equal(checksum, reference[frame], `peer ${i} frame ${frame}`);
        const confirmed = s.confirmedState()!;
        assert.equal(rollbackChecksum(confirmed.state), reference[confirmed.frame]);
        assert.equal(confirmed.checksum, reference[confirmed.frame]);
        assert.ok(r.stats.maxRollback <= merged.maxPredictionFrames);
        assert.equal(must(run.results[i]).filter(x => x.includes('desync') || x.includes('failed')).length, 0);
      }
      assert.ok(
        run.sessions.some(s => s.read().stats.rollbacks > 0),
        'the scenario exercised rollback',
      );
      assert.ok(run.results.flat().filter(r => r === 'checksum:match').length > 10, 'peers compared checksums');
      // Work bound: one advance runs at most maxPredictionFrames resimulated steps plus the new one.
      assert.ok(run.maxWorkPerAdvance <= merged.maxPredictionFrames + 1, `work ${run.maxWorkPerAdvance}`);
      if (minDelay > merged.maxPredictionFrames) assert.ok(run.sessions.every(s => s.read().stats.stalls > 0));
    }
  });
}

test('ROLLBACK prediction 0 is lockstep: never predicts, never rolls back, still converges', () => {
  const run = runPeers({
    limits: {maxPredictionFrames: 0, inputDelay: 1},
    ticks: 120,
    seed: 9,
    minDelay: 0,
    maxDelay: 3,
  });
  const reference = referenceChecksums(run, 120, 1, rollbackChecksum);
  for (const [i, s] of run.sessions.entries()) {
    assert.equal(s.read().stats.rollbacks, 0);
    assert.equal(must(run.ports[i]).calls.load, 0);
    for (const [frame, checksum] of must(run.published[i])) assert.equal(checksum, reference[frame]);
  }
});

test('ROLLBACK desync: a nondeterministic peer is reported at the first differing checksum frame and stops', () => {
  const run = runPeers({
    ticks: 200,
    seed: 4,
    minDelay: 0,
    maxDelay: 3,
    tamper: peer =>
      peer === 1
        ? (state, frame) => {
            if (frame === 41) state.hits += 1000;
          }
        : undefined,
  });
  for (const s of run.sessions) {
    const r = s.read();
    assert.equal(r.status, 'desynced');
    assert.equal(r.reason, 'checksum-mismatch');
    assert.equal(r.desync!.frame, 44, 'first checksum frame after the tampered frame 41 (interval 4)');
    assert.notEqual(r.desync!.local, r.desync!.remote);
    assert.deepEqual(s.advance(), {status: 'desynced', reason: 'checksum-mismatch'});
    assert.equal(s.confirmedState()!.frame >= 41, true, 'the last confirmed state stays readable for diagnosis');
    assert.equal(s.local('n').status, 'desynced');
  }
});

test('ROLLBACK remote protocol: duplicates are idempotent; gaps, conflicts, leads, self, early frames and bad input fail closed', () => {
  const cases: [string, (s: RollbackSession) => unknown][] = [
    ['remote-gap', s => s.remote(1, 3, 'n')],
    ['remote-frame', s => s.remote(1, 1, 'n')],
    ['remote-frame', s => s.remote(1, -2, 'n')],
    ['remote-frame', s => s.remote(1, 2.5, 'n')],
    ['remote-player', s => s.remote(0, 2, 'n')],
    ['remote-player', s => s.remote(2, 2, 'n')],
    ['remote-input-invalid', s => s.remote(1, 2, 'zz')],
    ['remote-input-invalid', s => s.remote(1, 2, 'n'.repeat(9))],
    ['remote-input-invalid', s => s.remote(1, 2, 7 as unknown as string)],
    [
      'remote-conflict',
      s => {
        s.remote(1, 2, 'l');
        return s.remote(1, 2, 'r');
      },
    ],
  ];
  for (const [reason, act] of cases) {
    const {session} = make();
    act(session);
    assert.equal(session.read().status, 'failed', reason);
    assert.equal(session.read().reason, reason);
    assert.deepEqual(session.advance(), {status: 'failed', reason});
  }
  const {session} = make();
  assert.deepEqual(session.remote(1, 2, 'l'), {status: 'accepted', rollbackFrom: null});
  assert.deepEqual(session.remote(1, 2, 'l'), {status: 'duplicate', rollbackFrom: null});
  // Lead: with identical limits a legitimate peer is at most prediction + 2 * delay + 2 frames ahead.
  const lead = make().session;
  for (let f = 2; f <= 8 + 4 + 2; f++) assert.equal(lead.remote(1, f, 'n').status, 'accepted', `frame ${f}`);
  assert.equal(lead.remote(1, 15, 'n').status, 'failed');
  assert.equal(lead.read().reason, 'remote-lead');
});

test('ROLLBACK a corrected remote input rolls back exactly to that frame and replays with the confirmed input', () => {
  const {session, ports} = make({limits: {inputDelay: 0}});
  assert.deepEqual(tick(session, 5, 'r'), ['advanced', 'advanced', 'advanced', 'advanced', 'advanced']);
  assert.equal(session.read().predictedFrames, 5);
  assert.equal(session.remote(1, 0, 'n').status, 'accepted');
  assert.deepEqual(session.remote(1, 1, 'n'), {status: 'accepted', rollbackFrom: null}, 'prediction was right');
  assert.deepEqual(session.remote(1, 2, 'l'), {status: 'accepted', rollbackFrom: 2});
  assert.deepEqual(session.remote(1, 3, 'n'), {status: 'accepted', rollbackFrom: null}, 'frame 3 was simulated with n');
  const loads = ports.calls.load,
    steps = ports.calls.step;
  session.local('n');
  const result = session.advance();
  assert.equal(result.status, 'advanced');
  assert.equal(
    (result as {resimulated: number}).resimulated,
    3,
    'frames 2..4 resimulated from the earliest correction',
  );
  assert.equal(ports.calls.load - loads, 1);
  assert.equal(ports.calls.step - steps, 4);
  // The resimulated state equals a straight run with the confirmed inputs (remote frame 4 still predicted = n).
  const straight = toyPorts();
  for (const [f, remote] of ['n', 'n', 'l', 'n', 'n', 'n'].entries()) straight.step([f < 5 ? 'r' : 'n', remote], f);
  assert.deepEqual(ports.state, straight.state);
});

test('ROLLBACK stalls at the prediction window, names the waiting players, then resumes', () => {
  const {session} = make({limits: {inputDelay: 0, maxPredictionFrames: 3}});
  assert.deepEqual(tick(session, 5), ['advanced', 'advanced', 'advanced', 'stalled', 'stalled']);
  const stalled = session.local('n');
  assert.equal(stalled.status, 'full', 'intent while stalled is not queued twice for one frame');
  const r = session.advance();
  assert.equal(r.status, 'stalled');
  assert.deepEqual((r as {waitingFor: readonly number[]}).waitingFor, [1]);
  assert.equal(session.read().stats.stalls, 3);
  session.remote(1, 0, 'n');
  assert.equal(session.advance().status, 'advanced');
  assert.equal(session.read().frame, 4);
});

test('ROLLBACK local input: one frame per tick, invalid input is not queued, missing input pauses with needs-local-input', () => {
  const {session} = make({limits: {inputDelay: 1}});
  assert.deepEqual(session.local('r'), {status: 'queued', frame: 1, input: 'r'});
  assert.deepEqual(session.local('l'), {status: 'full', frame: 2});
  assert.equal(session.advance().status, 'advanced', 'frame 0 uses the neutral delay prefix');
  assert.deepEqual(session.local('zz'), {status: 'invalid', frame: 2});
  assert.equal(session.read().status, 'running');
  assert.equal(session.advance().status, 'advanced');
  const waiting = session.advance();
  assert.equal(waiting.status, 'needs-local-input');
  assert.equal(session.read().frame, 2);
  const throwing = make({
    ports: {
      ...toyPorts(),
      validateInput: (input: string) => {
        if (input === 'a') throw Error('x');
        return true;
      },
    },
  }).session;
  assert.equal(throwing.local('a').status, 'failed');
  assert.equal(throwing.read().reason, 'validate-failed');
});

test('ROLLBACK checksum reports: pending until confirmed, match, inconclusive when evicted or off-interval, bounded', () => {
  const {session} = make({limits: {inputDelay: 0, checksumInterval: 2, maxChecksumHistory: 2, maxPendingChecksums: 2}});
  assert.deepEqual(session.remoteChecksum(1, 4, 7), {status: 'pending'});
  assert.deepEqual(session.remoteChecksum(1, 4, 7), {status: 'pending'}, 'an equal repeat is idempotent');
  assert.deepEqual(session.remoteChecksum(1, 3, 7), {status: 'inconclusive'});
  const statuses: string[] = [];
  for (let f = 0; f < 8; f++) {
    session.local('n');
    session.remote(1, f, 'n');
    statuses.push(session.advance().status);
  }
  // Frame 4's held report (7) differs from the true checksum, so the session desyncs when it confirms frame 4.
  assert.deepEqual(statuses, [
    'advanced',
    'advanced',
    'advanced',
    'advanced',
    'desynced',
    'desynced',
    'desynced',
    'desynced',
  ]);
  const d = session.read().desync!;
  assert.equal(d.frame, 4);
  assert.equal(d.player, 1);
  assert.equal(d.remote, 7);
  assert.notEqual(d.local, 7);

  const ok = make({
    limits: {inputDelay: 0, checksumInterval: 2, maxChecksumHistory: 2, maxPendingChecksums: 2},
  }).session;
  const sums = new Map<number, number>();
  for (let f = 0; f < 10; f++) {
    ok.local('n');
    ok.remote(1, f, 'n');
    const r = ok.advance();
    if ('checksums' in r) for (const c of r.checksums) sums.set(c.frame, c.checksum);
  }
  assert.deepEqual([...sums.keys()], [0, 2, 4, 6, 8]);
  assert.deepEqual(ok.remoteChecksum(1, 8, sums.get(8)!), {status: 'match'});
  assert.deepEqual(ok.remoteChecksum(1, 2, sums.get(2)!), {status: 'inconclusive'}, 'evicted history is never a pass');
  assert.equal(ok.remoteChecksum(1, 100, 1).status, 'pending');
  assert.equal(ok.remoteChecksum(1, 102, 1).status, 'pending');
  assert.equal(ok.remoteChecksum(1, 104, 1).status, 'failed');
  assert.equal(ok.read().reason, 'checksum-overflow');

  for (const [args, reason] of [
    [[1, 4, -1], 'remote-checksum'],
    [[1, 4, 2 ** 32], 'remote-checksum'],
    [[0, 4, 1], 'remote-player'],
  ] as const) {
    const s = make().session;
    s.remoteChecksum(...(args as unknown as [number, number, number]));
    assert.equal(s.read().reason, reason);
  }
  const conflict = make().session;
  conflict.remoteChecksum(1, 8, 1);
  assert.equal(conflict.remoteChecksum(1, 8, 2).status, 'failed');
  assert.equal(conflict.read().reason, 'checksum-conflict');
});

test('ROLLBACK port failures fail closed with a reason and release buffers; later calls refuse', () => {
  const failing = (patch: Partial<ToyPorts>, limits: Partial<RollbackLimits> = {}) => {
    const ports = Object.assign(toyPorts(), patch);
    return make({limits: {inputDelay: 0, ...limits}}, ports).session;
  };
  const save = failing({
    save: () => {
      throw Error('x');
    },
  });
  save.local('n');
  assert.deepEqual(save.advance(), {status: 'failed', reason: 'save-failed'});
  const big = failing({save: () => 'x'.repeat(5000)});
  big.local('n');
  assert.deepEqual(big.advance(), {status: 'failed', reason: 'state-bytes'});
  const notText = failing({save: () => 5 as unknown as string});
  notText.local('n');
  assert.deepEqual(notText.advance(), {status: 'failed', reason: 'state-bytes'});
  const step = failing({
    step: () => {
      throw Error('x');
    },
  });
  step.local('n');
  assert.deepEqual(step.advance(), {status: 'failed', reason: 'step-failed'});
  assert.equal(step.local('n').status, 'failed');
  assert.equal(step.remote(1, 0, 'n').status, 'failed');
  const load = failing({
    load: () => {
      throw Error('x');
    },
  });
  tick(load, 3, 'n');
  load.remote(1, 0, 'l');
  load.local('n');
  assert.deepEqual(load.advance(), {status: 'failed', reason: 'load-failed'});
  assert.equal(load.confirmedState()?.frame ?? 0, 0);
});

test('ROLLBACK reentrancy and cancellation: callbacks get busy, dispose inside a callback retires at once, abort disposes', () => {
  let session!: RollbackSession;
  const seen: string[] = [];
  const ports = toyPorts();
  const inner = ports.step;
  ports.step = (inputs, frame) => {
    seen.push(
      session.advance().status,
      session.local('n').status,
      session.remote(1, 0, 'n').status,
      session.remoteChecksum(1, 0, 0).status,
    );
    inner(inputs, frame);
  };
  session = make({limits: {inputDelay: 0}}, ports).session;
  session.local('n');
  assert.equal(session.advance().status, 'advanced');
  assert.deepEqual(seen, ['busy', 'busy', 'busy', 'busy']);

  const disposing = toyPorts();
  let target!: RollbackSession;
  disposing.step = () => target.dispose();
  target = make({limits: {inputDelay: 0}}, disposing).session;
  target.local('n');
  assert.deepEqual(target.advance(), {status: 'retired', reason: 'disposed'});
  assert.equal(target.read().status, 'retired');
  assert.equal(target.confirmedState(), null);
  target.dispose();

  const controller = new AbortController();
  const owned = make({signal: controller.signal}).session;
  controller.abort();
  assert.equal(owned.read().status, 'retired');
  assert.equal(owned.local('n').status, 'retired');
  const early = new AbortController();
  early.abort();
  assert.equal(make({signal: early.signal}).session.read().status, 'retired');
});

test('ROLLBACK read and results are frozen snapshots; confirmedState starts with the initial state', () => {
  const {session} = make();
  const r = session.read();
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.stats) && Object.isFrozen(r.confirmedInputs));
  assert.deepEqual(r.confirmedInputs, [1, 1]);
  assert.deepEqual(r.frameAdvantage, [0, 1], 'a peer with nothing queued is estimated at frame -1');
  assert.ok(Object.isFrozen(r.frameAdvantage));
  assert.equal(session.confirmedState(), null);
  session.local('n');
  session.advance();
  const c = session.confirmedState()!;
  assert.equal(c.frame, 0);
  assert.equal(c.checksum, rollbackChecksum(c.state));
  assert.ok(Object.isFrozen(c));
});

test('ROLLBACK frame advantage: a late peer leaves the other at full rollback depth unless the ahead peer paces', () => {
  const ticks = 300,
    late = 20;
  const measure = (pace?: number) => {
    const tail: number[] = [];
    let rollbacksAtHalf = 0;
    const run = runPeers({
      ticks,
      seed: 6,
      minDelay: 0,
      maxDelay: 1,
      late,
      pace,
      observe: (tick, sessions) => {
        if (tick === ticks / 2) rollbacksAtHalf = must(sessions[0]).read().stats.resimulated;
        if (tick >= ticks / 2 && tick < ticks) tail.push(must(must(sessions[0]).read().frameAdvantage[1]));
      },
    });
    const reference = referenceChecksums(run, ticks, baseLimits.inputDelay, rollbackChecksum);
    for (const [i, s] of run.sessions.entries()) {
      assert.equal(s.read().status, 'running');
      for (const [frame, checksum] of must(run.published[i])) assert.equal(checksum, reference[frame]);
    }
    return {
      maxTail: Math.max(...tail),
      lateResimulated: must(run.sessions[0]).read().stats.resimulated - rollbacksAtHalf,
    };
  };
  const unpaced = measure(),
    paced = measure(3);
  // Without pacing the early peer stays a full window ahead: every late input forces a deep rollback.
  assert.ok(unpaced.maxTail >= baseLimits.maxPredictionFrames, `unpaced advantage ${unpaced.maxTail}`);
  // Skipping ticks while ahead re-converges to the latency-inflated threshold and cuts resimulation.
  assert.ok(paced.maxTail <= 3 + 2, `paced advantage ${paced.maxTail}`);
  assert.ok(
    paced.lateResimulated * 3 < unpaced.lateResimulated,
    `${paced.lateResimulated} vs ${unpaced.lateResimulated}`,
  );
});
