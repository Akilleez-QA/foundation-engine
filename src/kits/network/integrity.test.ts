import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDisclosure,
  createAuthorityGenesis,
  createClosePolicy,
  createDurableAuthority,
  createIntegrity,
  createNetworkIntake,
  createPrediction,
  DEFAULT_TERMINAL_CLOSE_REASONS,
  findDisclosureLeaks,
  INTEGRITY_CLOSE_REASON,
  integrityFlag,
  integrityOk,
  integrityReject,
  integrityRules,
  type AuthorityStorage,
  type ConnectionHandle,
  type Integrity,
  type IntegrityInput,
  type IntegrityRule,
} from './index';

type Cmd = {value: number};
type State = Record<string, never>;
const limits = {maxKeys: 4, maxHistoryPerKey: 3, maxAudit: 8};
const S: State = {};
const input = (value: number, tick: number | null = null): IntegrityInput<Cmd, State> => ({
  command: {value},
  state: S,
  tick,
});
/** Flags `value` as its weight; 0 passes. */
const mark: IntegrityRule<Cmd, State> = {
  id: 'mark',
  check: ({command}) => (command.value > 0 ? integrityFlag('mark', command.value) : integrityOk()),
};
/** Rejects negative values with weight 1. */
const sign: IntegrityRule<Cmd, State> = {
  id: 'sign',
  check: ({command}) => (command.value < 0 ? integrityReject('sign', 1, {value: command.value}) : integrityOk()),
};

test('SEC01: an owner with no rules or thresholds allows every command, scores nothing and audits nothing', () => {
  const owner = createIntegrity<Cmd, State>({rules: [], limits, decayPerSecond: 1});
  for (let i = 0; i < 50; i++)
    assert.deepEqual(owner.check('a', input(i), i), {action: 'allow', score: 0, observed: null});
  assert.equal(owner.read('a')?.score, 0);
  assert.equal(owner.audit().length, 0);
  assert.equal(owner.stats().rejected, 0);
});

test('SEC01: assess is pure and deterministic; an assessment can be recorded once, by its own owner only', () => {
  const owner = createIntegrity<Cmd, State>({rules: [mark, sign], limits, decayPerSecond: 1});
  const a = owner.assess(input(-2)),
    b = owner.assess(input(-2));
  assert.deepEqual(a, b);
  assert.deepEqual(a, {
    verdict: 'invalid',
    wouldBe: 'invalid',
    rule: 'sign',
    reason: 'sign',
    findings: [{rule: 'sign', kind: 'reject', reason: 'sign', weight: 1, observed: false, evidence: {value: -2}}],
  });
  assert.equal(owner.stats().keys, 0, 'assessing touches no key');
  assert.equal(owner.audit().length, 0);
  assert.equal(owner.record('a', a, 0).action, 'allow');
  assert.deepEqual(owner.record('a', a, 0), {action: 'refused', reason: 'invalid-assessment'}, 'no double counting');
  const other = createIntegrity<Cmd, State>({rules: [sign], limits, decayPerSecond: 1});
  assert.deepEqual(owner.record('a', other.assess(input(-1)), 0), {action: 'refused', reason: 'invalid-assessment'});
  assert.deepEqual(owner.record('a', {...b}, 0), {action: 'refused', reason: 'invalid-assessment'});
  assert.equal(owner.read('a')?.score, 1);
});

test('SEC01: an invalid sequenced command is consumed as a domain rejection, so the stream continues and prediction reconciles', async () => {
  // Validity rule: a step may change the total by at most 3 (the client sends +5).
  type Total = number;
  const integrity = createIntegrity<number, Total>({
    rules: [
      integrityRules.maxRateOfChange({
        id: 'step',
        perTick: 3,
        current: ({state}) => state,
        proposed: ({state, command}) => state + command,
        elapsedTicks: () => 1,
      }),
    ],
    limits,
    decayPerSecond: 1,
    close: {score: 10},
  });
  const json = {maxBytes: 4096, maxNodes: 64, maxDepth: 4};
  const authorityLimits = {
    envelope: {maxBytes: 65536, maxNodes: 4096, maxDepth: 12},
    state: json,
    input: json,
    result: json,
    maxStreams: 2,
    maxReceiptsPerStream: 4,
  };
  const validators = {
    validateState: (v: unknown) => Number.isSafeInteger(v),
    validateInput: (v: unknown) => Number.isSafeInteger(v),
    validateResult: (v: unknown) => v !== null && typeof v === 'object',
  };
  let raw: string | null = createAuthorityGenesis({
    lineage: 'w',
    schema: 's',
    limits: authorityLimits,
    stateJson: '0',
    ...validators,
  });
  const storage: AuthorityStorage = {
    async settle() {},
    async read() {
      return raw;
    },
    async compareAndSwap(q) {
      raw = q.json;
      return 'committed';
    },
  };
  let last: ReturnType<typeof integrity.assess> | null = null;
  const authority = createDurableAuthority({
    lineage: 'w',
    schema: 's',
    limits: authorityLimits,
    storage,
    ...validators,
    authorize: () => true,
    reduce({state, input: command}) {
      // Pure validity inside the reducer: an invalid command leaves state unchanged and says why.
      last = integrity.assess({command: command as number, state: state as number, tick: null});
      if (last.verdict === 'invalid')
        return {stateJson: JSON.stringify(state), resultJson: JSON.stringify({rejected: last.rule})};
      return {
        stateJson: JSON.stringify((state as number) + (command as number)),
        resultJson: JSON.stringify({ok: true}),
      };
    },
  });
  assert.equal((await authority.recover()).status, 'recovered');
  // The client predicts all three inputs with its naive reducer.
  const prediction = createPrediction({
    epoch: 'e',
    baseline: {revision: 0, processedThrough: 0, stateJson: '0'},
    limits: {state: json, input: json, maxPending: 8, maxPendingBytes: 1024, maxReplaySteps: 8},
    validateState: v => Number.isSafeInteger(v),
    validateInput: v => Number.isSafeInteger(v),
    reduce: (state, command) => JSON.stringify((state as number) + (command as number)),
  });
  for (const step of ['2', '5', '1']) prediction.push(step);
  assert.equal(prediction.read().predicted?.value, 8);
  const outcomes = [];
  for (const [sequence, inputJson] of [
    [1, '2'],
    [2, '5'],
    [3, '1'],
  ] as const) {
    const out = await authority.submit({stream: 'p', sequence, inputJson});
    outcomes.push(out.status === 'committed' ? out.result : out.status);
    if (out.status === 'committed') integrity.record('p', last!, sequence * 10, {stream: 'p', sequence});
  }
  assert.deepEqual(outcomes, [{ok: true}, {rejected: 'step'}, {ok: true}], 'no gap: sequence 3 commits');
  const snapshot = authority.read().snapshot!;
  assert.deepEqual(snapshot.envelope.state, 3);
  const reconciled = prediction.reconcile({
    epoch: 'e',
    revision: snapshot.envelope.revision,
    processedThrough: 3,
    stateJson: JSON.stringify(snapshot.envelope.state),
  });
  assert.equal(reconciled.status, 'reconciled');
  assert.equal(prediction.read().predicted?.value, 3, 'the client is set back to authoritative state');
  assert.equal(prediction.read().pending.length, 0);
  assert.deepEqual(
    integrity.audit().map(e => [e.kind, e.rule, e.ref?.sequence]),
    [['reject', 'step', 2]],
  );
  // Contrast: refusing the same command before submit leaves sequence 2 unconsumed; sequence 3 then hits `gap`.
  raw = createAuthorityGenesis({lineage: 'w', schema: 's', limits: authorityLimits, stateJson: '0', ...validators});
  const gapped = createDurableAuthority({
    lineage: 'w',
    schema: 's',
    limits: authorityLimits,
    storage,
    ...validators,
    authorize: () => true,
    reduce: ({state}) => ({stateJson: JSON.stringify(state), resultJson: '{}'}),
  });
  await gapped.recover();
  await gapped.submit({stream: 'p', sequence: 1, inputJson: '2'});
  assert.equal((await gapped.submit({stream: 'p', sequence: 3, inputJson: '1'})).status, 'gap');
});

test('SEC01: a throwing or malformed rule fails closed in assess; observed rules never act', () => {
  let later = 0;
  const malformed: unknown[] = [
    undefined,
    null,
    7,
    {kind: 'maybe'},
    {kind: 'reject', reason: 'has space', weight: 0},
    {kind: 'flag', reason: 'ok', weight: Number.NaN},
    {kind: 'flag', reason: 'ok', weight: -1},
    {
      get kind(): string {
        throw Error('getter');
      },
    },
    {
      kind: 'flag',
      get reason(): string {
        throw Error('getter');
      },
      weight: 1,
    },
  ];
  for (const verdict of [...malformed, 'throw']) {
    const owner = createIntegrity<Cmd, State>({
      rules: [
        {
          id: 'broken',
          check: () => {
            if (verdict === 'throw') throw Error('bug');
            return verdict as never;
          },
        },
        {
          id: 'later',
          check: () => {
            later++;
            return integrityOk();
          },
        },
      ],
      limits,
      decayPerSecond: 1,
    });
    assert.deepEqual(owner.check('a', input(1), 0), {action: 'reject', reason: 'rule-error', rule: 'broken', score: 0});
    assert.equal(owner.stats().ruleErrors, 1);
  }
  assert.equal(later, 0, 'later rules do not run after a fail-closed error');
  const observed = createIntegrity<Cmd, State>({
    rules: [
      {
        id: 'broken',
        mode: 'observe',
        check: () => {
          throw Error('bug');
        },
      },
      sign,
    ],
    limits,
    decayPerSecond: 1,
    ruleErrorWeight: 5,
  });
  const a = observed.assess(input(1));
  assert.equal(a.verdict, 'ok');
  assert.deepEqual(
    a.findings.map(f => [f.kind, f.observed]),
    [['rule-error', true]],
  );
  assert.equal(observed.record('a', a, 0).action, 'allow');
  assert.equal(observed.read('a')?.score, 0, 'an observed rule error never scores');
  assert.equal(observed.audit()[0]?.observed, true);
});

test('SEC01: owner observe mode computes and audits every action but never acts', () => {
  const owner = createIntegrity<Cmd, State>({
    rules: [sign, mark],
    limits,
    decayPerSecond: 0.001,
    enforcement: 'observe',
    throttle: {score: 1, capacity: 1, refillPerSecond: 0.001},
    close: {score: 3},
    tickBudget: {ticksPerSecond: 1, maxCatchUpTicks: 1},
  });
  const decisions = [owner.check('a', input(-1), 0), owner.check('a', input(-1), 0), owner.check('a', input(-1), 0)];
  assert.deepEqual(
    decisions.map(d => d.action),
    ['allow', 'allow', 'allow'],
  );
  assert.deepEqual(
    decisions.map(d => d.action === 'allow' && d.observed),
    ['reject', 'reject', 'close'],
  );
  assert.equal(owner.check('a', input(0), 0, {ticks: 1}).action, 'allow');
  const s = owner.stats();
  assert.ok(s.wouldReject >= 3 && s.wouldClose >= 1 && s.wouldThrottle >= 1, JSON.stringify(s));
  assert.equal(s.rejected + s.throttled + s.closed, 0);
  assert.ok(
    owner
      .audit()
      .filter(e => e.kind !== 'flag')
      .every(e => e.observed),
  );
});

test('SEC01: a slow rule is bounded by the intake pump budget, one evaluation per attempted command', () => {
  let calls = 0;
  const integrity = createIntegrity<Cmd, State>({
    rules: [
      {
        id: 'slow',
        check: () => {
          calls++;
          const end = performance.now() + 2;
          while (performance.now() < end) {
            /* deliberately slow creator rule */
          }
          return integrityOk();
        },
      },
    ],
    limits,
    decayPerSecond: 1,
  });
  const completions: ((json: string | null) => void)[] = [];
  let dispatched = 0;
  const intake = createNetworkIntake({
    limits: {
      maxConnections: 2,
      maxPendingAuth: 1,
      maxPreAuthMessages: 2,
      authTimeoutMs: 1000,
      maxQueuedMessagesPerPeer: 16,
      maxQueuedBytesPerPeer: 4096,
      maxQueuedMessages: 16,
      maxQueuedBytes: 4096,
      maxPumpOperations: 3,
      message: {maxBytes: 128, maxNodes: 8, maxDepth: 2},
      principal: {maxBytes: 64, maxNodes: 4, maxDepth: 2},
    },
    ports: {
      authenticate: ({complete}) => {
        completions.push(complete);
      },
      authorize: ({command}) =>
        integrity.check('a', {command: command as Cmd, state: S, tick: null}, 0).action === 'allow',
      dispatch: () => {
        dispatched++;
      },
      send: () => true,
      close: () => {},
    },
  });
  const opened = intake.open(0) as {peer: ConnectionHandle};
  intake.authenticate(opened.peer, '{}', 0);
  completions[0]!('{"id":"a"}');
  for (let i = 0; i < 12; i++) assert.equal(intake.receive(opened.peer, `{"value":${i}}`, 0).status, 'queued');
  for (let round = 1; round <= 4; round++) {
    intake.pump(0);
    assert.equal(calls, round * 3, 'at most maxPumpOperations evaluations per pump');
  }
  assert.equal(dispatched, 12);
});

test('SEC01: scores decay linearly with host time, never below zero, and a backwards clock grants no decay', () => {
  const owner = createIntegrity<Cmd, State>({rules: [mark], limits, decayPerSecond: 2});
  owner.check('a', input(4), 1000);
  assert.deepEqual(
    [1000, 1500, 2000, 3000, 1e9].map(t => owner.read('a', t)?.score),
    [4, 3, 2, 0, 0],
  );
  owner.check('a', input(4), 1000); // 8
  owner.check('a', input(4), 100); // backwards: treated as 1000, no decay, +4
  assert.equal(owner.read('a')?.score, 12);
  assert.equal(owner.stats().clockRegressions, 1);
  for (const bad of [-1, Number.NaN, Infinity, 2 ** 53 + 2])
    assert.deepEqual(owner.check('b', input(0), bad), {action: 'refused', reason: 'invalid-time'});
});

test('SEC01: key churn stays within maxKeys and never refuses an honest new key', () => {
  const owner = createIntegrity<Cmd, State>({rules: [mark], limits, decayPerSecond: 1, close: {score: 3}});
  // Offenders fill every slot with high scores.
  for (const k of ['o1', 'o2', 'o3', 'o4']) assert.equal(owner.check(k, input(5), 0).action, 'close');
  for (let i = 0; i < 1000; i++) {
    assert.equal(owner.check(`honest-${i}`, input(0), 0).action, 'allow');
    assert.ok(owner.stats().keys <= limits.maxKeys);
  }
  assert.equal(owner.stats().evictedScored, 4, 'evicting scored keys is counted');
  assert.equal(owner.stats().evicted, 1000);
  // A recently seen key survives churn by other keys up to the bound.
  owner.check('kept', input(2), 0);
  for (let i = 0; i < limits.maxKeys - 1; i++) owner.check(`n-${i}`, input(0), 0);
  assert.equal(owner.read('kept')?.score, 2);
  assert.deepEqual(owner.check('', input(0), 0), {action: 'refused', reason: 'invalid-key'});
});

test('SEC01: close triggers exactly at the threshold, optionally only with N violations within T', () => {
  const owner = createIntegrity<Cmd, State>({rules: [mark], limits, decayPerSecond: 1, close: {score: 3}});
  assert.equal(owner.check('a', input(2.999), 0).action, 'allow');
  assert.deepEqual(
    createIntegrity<Cmd, State>({rules: [mark], limits, decayPerSecond: 1, close: {score: 3}}).check('a', input(3), 0),
    {action: 'close', reason: INTEGRITY_CLOSE_REASON, score: 3},
  );
  // One heavy flag reaches the score but not the window: no close.
  const windowed = createIntegrity<Cmd, State>({
    rules: [mark],
    limits,
    decayPerSecond: 0.001,
    close: {score: 3, requires: {violations: 3, withinMs: 1000}},
  });
  assert.equal(windowed.check('a', input(10), 0).action, 'allow');
  assert.equal(windowed.check('a', input(1), 500).action, 'allow');
  assert.equal(windowed.check('a', input(1), 1000).action, 'close', 'three violations within 1000 ms');
  const slow = createIntegrity<Cmd, State>({
    rules: [mark],
    limits,
    decayPerSecond: 0.001,
    close: {score: 3, requires: {violations: 3, withinMs: 1000}},
  });
  slow.check('a', input(10), 0);
  slow.check('a', input(1), 600);
  assert.equal(slow.check('a', input(1), 1001).action, 'allow', 'the window is 1001 ms wide: no close');
  // Admit closes a key already at the threshold, without running rules.
  assert.equal(owner.admit('a', 0).action, 'allow');
  owner.check('a', input(1), 0);
  assert.equal(owner.admit('a', 0).action, 'close');
});

test('SEC01: a per-rule ceiling stops one noisy rule from closing a key alone', () => {
  const noisy = {...mark, maxScore: 2};
  const owner = createIntegrity<Cmd, State>({rules: [noisy, sign], limits, decayPerSecond: 1, close: {score: 3}});
  for (let i = 0; i < 20; i++) assert.equal(owner.check('a', input(5), 0).action, 'allow');
  assert.equal(owner.read('a')?.score, 2);
  assert.equal(owner.audit().at(-1)?.weight, 0, 'the audit records the weight actually applied');
  assert.equal(owner.check('a', input(-1), 0).action, 'close', 'a second rule adds to the capped score');
});

test('SEC01: the tick budget bounds claimed ticks to host time; a client that waits is never scored', () => {
  const owner = createIntegrity<Cmd, State>({
    rules: [],
    limits,
    decayPerSecond: 0.001,
    tickBudget: {ticksPerSecond: 60, maxCatchUpTicks: 8, weight: 1},
    close: {score: 5},
  });
  // Honest: one tick per 1000/60 ms, then one bounded catch-up burst after a long idle.
  for (let i = 0; i < 600; i++) assert.equal(owner.admit('honest', (i * 1000) / 60, {ticks: 1}).action, 'allow');
  let burst = 0;
  while (owner.admit('honest', 1e6, {ticks: 1}).action === 'allow') burst++;
  assert.equal(burst, 8, 'a long idle banks no more than maxCatchUpTicks');
  // The honest client waits retryAfterMs; refill slack (5%) restores headroom while it plays at the exact rate.
  let t = 1e6 + 1000 / 60;
  for (let i = 0; i < 1200; i++, t += 1000 / 60) {
    const d = owner.admit('honest', t, {ticks: 1});
    if (d.action === 'throttle') {
      t += d.retryAfterMs;
      i--;
      continue;
    }
    assert.equal(d.action, 'allow');
  }
  assert.equal(owner.admit('honest', t, {ticks: 1}).action, 'allow');
  assert.ok(owner.stats().throttled < 5, `headroom returns: ${owner.stats().throttled} throttles`);
  assert.equal(owner.read('honest')?.score, 0, 'throttles that were not early retries score nothing');
  // A client that ignores retryAfterMs (retrying every millisecond): early retries score, then close.
  const actions: string[] = [];
  for (let i = 0; i < 60; i++) actions.push(owner.admit('fast', 2e6 + i, {ticks: 1}).action);
  assert.ok(actions.includes('throttle'));
  assert.equal(actions.at(-1), 'close');
});

test('SEC01: impossible tick claims are rejected, not throttled forever; same-tick claims cost one tick', () => {
  const owner = createIntegrity<Cmd, State>({
    rules: [],
    limits,
    decayPerSecond: 1,
    tickBudget: {ticksPerSecond: 60, maxCatchUpTicks: 8},
  });
  for (const claim of [{ticks: 9}, {ticks: 0}, {ticks: 0.5}, {ticks: -1}, {tick: -1}, {tick: 1.5}]) {
    const d = owner.admit(`k${JSON.stringify(claim)}`, 0, claim);
    assert.deepEqual(d.action === 'reject' && [d.reason, d.rule], ['tick-claim', 'tick-budget'], JSON.stringify(claim));
  }
  assert.equal(owner.admit('t', 0, {tick: 100}).action, 'allow'); // first claim costs 1
  for (let i = 0; i < 7; i++) assert.equal(owner.admit('t', 0, {tick: 100}).action, 'allow', 'same tick costs 1');
  assert.equal(owner.admit('t', 0, {tick: 100}).action, 'throttle');
  assert.equal(owner.admit('t', 1000, {tick: 10_000}).action, 'allow', 'a resynchronised jump costs one full bucket');
  assert.equal(owner.admit('t', 1000, {tick: 10_001}).action, 'throttle', 'and leaves nothing for a burst behind it');
});

/** The recipe's setup: rules use the claimed tick gap; admit charges the same gap. */
function recipeHost(claimAhead: number, respectRetry: boolean, seconds: number) {
  type Move = {tick: number; to: number};
  type Me = {position: number; positionTick: number | null; hostTick: number};
  const integrity = createIntegrity<Move, Me>({
    rules: [
      integrityRules.claimedTickInBand({
        id: 'tick-band',
        maxBehindTicks: 30,
        maxAheadTicks: 2,
        claimed: ({command}) => command.tick,
        hostTick: ({state}) => state.hostTick,
      }),
      integrityRules.maxRateOfChange({
        id: 'move-rate',
        perTick: 1,
        maxElapsedTicks: 8,
        current: ({state}) => state.position,
        proposed: ({command}) => command.to,
        elapsedTicks: ({state, tick}) =>
          tick === null || state.positionTick === null ? null : tick - state.positionTick,
      }),
    ],
    limits,
    decayPerSecond: 0.5,
    tickBudget: {ticksPerSecond: 60, maxCatchUpTicks: 8},
    close: {score: 6, requires: {violations: 5, withinMs: 10_000}},
  });
  const me: Me = {position: 0, positionTick: null, hostTick: 0};
  let now = 0,
    claim = 0,
    closed = false,
    wait = 0;
  while (now < seconds * 1000 && !closed) {
    me.hostTick = Math.floor((now * 60) / 1000);
    const command = {tick: claim, to: me.position + (claim - (me.positionTick ?? claim)) * 1 || me.position};
    const gate = integrity.admit('p', now, {tick: command.tick});
    if (gate.action === 'close') {
      closed = true;
      break;
    }
    if (gate.action === 'throttle') {
      wait = respectRetry ? gate.retryAfterMs : 0;
      now += Math.max(wait, 1000 / 60);
      continue;
    }
    const a = integrity.assess({command, state: me, tick: command.tick});
    if (a.verdict === 'ok') {
      me.position = command.to;
      me.positionTick = command.tick;
    }
    if (integrity.record('p', a, now).action === 'close') {
      closed = true;
      break;
    }
    claim += claimAhead;
    now += 1000 / 60;
  }
  return {position: me.position, closed, score: integrity.read('p')?.score ?? 0};
}

test('SEC01: the recipe setup stops an 8x tick-claim speed hack (regression)', () => {
  const honest = recipeHost(1, true, 10);
  assert.equal(honest.closed, false);
  assert.equal(honest.score, 0);
  assert.ok(honest.position >= 590 && honest.position <= 600, `honest ${honest.position}`);
  const patient = recipeHost(8, true, 10);
  assert.ok(patient.position <= 600 * 1.05 + 8 + 2, `a waiting cheater gains nothing: ${patient.position}`);
  const greedy = recipeHost(8, false, 10);
  assert.ok(greedy.position <= 600 * 1.05 + 8 + 2, `greedy ${greedy.position}`);
  assert.equal(greedy.closed, true, 'ignoring retryAfterMs is scored and closed');
});

test('SEC01: honest probes never close: reconnect with 24 pending inputs, a hidden-tab stall and jitter', () => {
  const owner = createIntegrity<Cmd, State>({
    rules: [],
    limits,
    decayPerSecond: 0.5,
    tickBudget: {ticksPerSecond: 60, maxCatchUpTicks: 24},
    close: {score: 6, requires: {violations: 5, withinMs: 10_000}},
  });
  // Reconnect: 24 pending inputs, resent one at a time; the host holds later ones while one is throttled.
  let now = 0,
    tick = 0;
  for (let i = 0; i < 600; i++) {
    owner.admit('a', now, {tick: tick++});
    now += 1000 / 60;
  }
  now += 400; // 24 inputs buffered during the outage
  for (let sent = 0; sent < 24 + 60;) {
    const d = owner.admit('a', now, {tick});
    assert.notEqual(d.action, 'close');
    if (d.action === 'throttle') {
      now += d.retryAfterMs;
      continue;
    }
    tick++;
    sent++;
    now += sent < 24 ? 0 : 1000 / 60;
  }
  // Hidden tab: animation frames stop, so the client's tick pauses for 5 s; then jittered bunches of 3 every 50 ms.
  now += 5000;
  for (let i = 0; i < 24; i++) assert.equal(owner.admit('a', now, {tick: tick++}).action, 'allow');
  for (let round = 0; round < 200; round++) {
    for (let k = 0; k < 3; k++) {
      const d = owner.admit('a', now, {tick});
      assert.notEqual(d.action, 'close');
      if (d.action === 'throttle') {
        now += d.retryAfterMs;
        k--;
        continue;
      }
      tick++;
    }
    now += 50;
  }
  assert.equal(owner.read('a')?.score, 0);
  assert.equal(owner.stats().closed, 0);
});

test("SEC01: one key flooding refusals cannot evict another key's evidence", () => {
  const owner = createIntegrity<Cmd, State>({
    rules: [sign],
    limits: {...limits, maxAudit: 8},
    decayPerSecond: 0.001,
    tickBudget: {ticksPerSecond: 1, maxCatchUpTicks: 1},
    close: {score: 1},
  });
  owner.check('victim', input(-1), 0); // scored evidence, then close
  const evidence = () => owner.audit().some(e => e.subject === 'victim' && e.kind === 'reject');
  for (let i = 0; i < 40; i++) owner.admit('flood', 0, {ticks: 1});
  for (let i = 0; i < 40; i++) owner.admit('victim', 0);
  assert.ok(evidence());
  assert.ok(owner.audit().filter(e => e.subject === 'victim').length <= 1 + limits.maxHistoryPerKey);
  assert.ok(owner.stats().auditSuppressed >= 70);
  // Reviewer probe: alternating clean admits and respected throttles for 20 s, never scored.
  const alt = createIntegrity<{tick: number}, State>({
    rules: [integrityRules.valueInRange({id: 'r', min: 0, max: 1e9, value: ({command}) => command.tick})],
    limits: {maxKeys: 256, maxHistoryPerKey: 8, maxAudit: 512},
    decayPerSecond: 0.5,
    tickBudget: {ticksPerSecond: 60, maxCatchUpTicks: 16},
    close: {score: 6, requires: {violations: 5, withinMs: 10_000}},
  });
  alt.check('victim', {command: {tick: -1}, state: S, tick: null}, 0);
  let t = 1,
    tick = 0;
  for (let k = 0; k < 16; k++) alt.admit('flood', t, {tick: tick++});
  while (t < 20_000) {
    const d = alt.admit('flood', t, {tick});
    if (d.action === 'throttle') {
      t += d.retryAfterMs;
      continue;
    }
    assert.equal(d.action, 'allow');
    tick++;
  }
  assert.ok(
    alt.audit().some(e => e.subject === 'victim' && e.kind === 'reject'),
    'victim evidence survives',
  );
  assert.equal(alt.stats().dropped, 0);
  assert.ok(alt.audit().filter(e => e.subject === 'flood').length <= 8 + 20, 'about one unscored row per second');
  // Scored refusals are always audited.
  const scored = createIntegrity<Cmd, State>({
    rules: [],
    limits: {...limits, maxAudit: 64},
    decayPerSecond: 0.001,
    tickBudget: {ticksPerSecond: 1, maxCatchUpTicks: 1},
  });
  scored.admit('c', 0, {ticks: 1});
  for (let k = 0; k < 10; k++) scored.admit('c', k, {ticks: 1});
  assert.equal(scored.audit().filter(e => e.weight > 0).length, scored.read('c')?.violations);
});

test('SEC01: one command counts as one violation in the close window, however many rules it trips', () => {
  const both: IntegrityRule<Cmd, State>[] = [
    mark,
    {id: 'mark2', check: ({command}) => (command.value > 0 ? integrityFlag('mark2', command.value) : integrityOk())},
  ];
  const owner = createIntegrity<Cmd, State>({
    rules: both,
    limits,
    decayPerSecond: 0.001,
    close: {score: 3, requires: {violations: 2, withinMs: 1000}},
  });
  assert.equal(owner.check('a', input(5), 0).action, 'allow', 'two findings, one violation');
  assert.equal(owner.read('a')?.violations, 1);
  assert.equal(owner.check('a', input(1), 1).action, 'close');
  const observing = createIntegrity<Cmd, State>({rules: [mark], limits, decayPerSecond: 1, enforcement: 'observe'});
  observing.check('a', input(1), 0);
  assert.equal(observing.audit()[0]?.observed, true, 'observe mode marks flags observed too');
});

test('SEC01: the close reason is terminal under a close policy that names it, and must be a close token', () => {
  const owner = createIntegrity<Cmd, State>({rules: [mark], limits, decayPerSecond: 1, close: {score: 1}});
  const decision = owner.check('a', input(1), 0);
  assert.equal(decision.action, 'close');
  const reason = decision.action === 'close' ? decision.reason : '';
  const policy = createClosePolicy({terminalReasons: [...DEFAULT_TERMINAL_CLOSE_REASONS, INTEGRITY_CLOSE_REASON]});
  assert.equal(policy.classify({code: 1008, reason}), 'terminal');
  assert.equal(
    createClosePolicy().classify({code: 1008, reason}),
    'transient',
    'the stock default is unchanged: opt in',
  );
  for (const bad of ['', 'has space', 'x'.repeat(65), '-lead'])
    assert.throws(() =>
      createIntegrity<Cmd, State>({rules: [], limits, decayPerSecond: 1, close: {score: 1, reason: bad}}),
    );
});

test('SEC01: audit entries are bounded, reviewable and exportable as local text', () => {
  const owner = createIntegrity<Cmd, State>({
    rules: [
      sign,
      {
        id: 'big',
        check: ({command}) => (command.value === 7 ? integrityFlag('big', 0, {blob: 'x'.repeat(2000)}) : integrityOk()),
      },
    ],
    limits,
    decayPerSecond: 1,
    config: 'rules-v2',
    subject: key => `player:${String(key)}`,
    onAudit: () => {
      throw Error('sink');
    },
  });
  for (let i = 0; i < 10; i++)
    owner.check(i % 2 ? 'a' : 'b', input(-1, 100 + i), i, {ref: {stream: 's', sequence: i + 1, tick: 100 + i}});
  owner.check('a', input(7), 11);
  const entries = owner.audit();
  assert.equal(entries.length, limits.maxAudit);
  assert.equal(owner.stats().dropped, 3);
  assert.deepEqual(
    entries.map(e => e.seq),
    [4, 5, 6, 7, 8, 9, 10, 11],
  );
  assert.deepEqual(entries[0], {
    seq: 4,
    at: 3,
    subject: 'player:a',
    config: 'rules-v2',
    kind: 'reject',
    rule: 'sign',
    reason: 'sign',
    weight: 1,
    score: owner.audit()[0]!.score,
    observed: false,
    ref: {stream: 's', sequence: 4, tick: 103},
    evidence: {value: -1},
  });
  assert.equal(entries.at(-1)?.evidence, null, 'oversized evidence is dropped, not truncated');
  assert.equal(owner.stats().evidenceDropped, 1);
  assert.equal(owner.read('a')?.history.length, limits.maxHistoryPerKey);
  assert.equal(owner.stats().auditErrors, 11);
  const exported = JSON.parse(owner.exportAudit());
  assert.equal(exported.format, 'foundation.integrity-audit');
  assert.equal(exported.version, 1);
  assert.equal(exported.dropped, 3);
  assert.equal(exported.entries.length, limits.maxAudit);
  assert.ok(Object.isFrozen(entries) && Object.isFrozen(entries[0]));
});

test('SEC01: reentry is busy; forget or dispose during a rule cannot publish a decision for retired state', () => {
  let owner: Integrity<Cmd, State> = createIntegrity<Cmd, State>({
    rules: [
      {
        id: 'nest',
        check: () => {
          assert.deepEqual(owner.check('a', input(0), 0), {action: 'refused', reason: 'busy'});
          owner.forget('a');
          return integrityOk();
        },
      },
    ],
    limits,
    decayPerSecond: 1,
  });
  assert.deepEqual(owner.check('a', input(0), 0), {action: 'refused', reason: 'retired'});
  owner = createIntegrity<Cmd, State>({
    rules: [
      {
        id: 'end',
        check: () => {
          owner.dispose();
          return integrityOk();
        },
      },
    ],
    limits,
    decayPerSecond: 1,
  });
  assert.deepEqual(owner.check('a', input(0), 0), {action: 'refused', reason: 'disposed'});
  assert.equal(owner.stats().keys, 0);
  assert.deepEqual(owner.admit('a', 0), {action: 'refused', reason: 'disposed'});
});

test('SEC01: configuration errors throw at construction', () => {
  const ok = {rules: [], limits, decayPerSecond: 1};
  const bad: unknown[] = [
    {...ok, rules: null},
    {...ok, rules: Array.from({length: 33}, (_, i) => ({id: `r${i}`, check: integrityOk}))},
    {
      ...ok,
      rules: [
        {id: 'dup', check: integrityOk},
        {id: 'dup', check: integrityOk},
      ],
    },
    {...ok, rules: [{id: 'no check'}]},
    {...ok, rules: [{id: 'm', mode: 'shadow', check: integrityOk}]},
    {...ok, rules: [{id: 'c', maxScore: 0, check: integrityOk}]},
    {...ok, limits: {...limits, maxKeys: 0}},
    {...ok, limits: {...limits, maxAudit: 1.5}},
    {...ok, limits: {...limits, maxEvidenceBytes: 0}},
    {...ok, decayPerSecond: 0},
    {...ok, decayPerSecond: Infinity},
    {...ok, enforcement: 'off'},
    {...ok, config: 'a b'},
    {...ok, ruleErrorWeight: -1},
    {...ok, close: {score: 0}},
    {...ok, close: {score: 1, requires: {violations: 0, withinMs: 1}}},
    {...ok, close: {score: 1, requires: {violations: 65, withinMs: 1}}},
    {...ok, throttle: {score: 1, capacity: 0, refillPerSecond: 1}},
    {...ok, tickBudget: {ticksPerSecond: 0, maxCatchUpTicks: 1}},
    {...ok, tickBudget: {ticksPerSecond: 60, maxCatchUpTicks: 8, mode: 'x'}},
    {...ok, onAudit: 'log'},
    {...ok, subject: 'x'},
  ];
  for (const options of bad)
    assert.throws(() => createIntegrity(options as never), JSON.stringify(options)?.slice(0, 80));
  assert.deepEqual(integrityReject('r'), {kind: 'reject', reason: 'r', weight: 0});
  assert.deepEqual(integrityFlag('f'), {kind: 'flag', reason: 'f', weight: 1});
});

type Pos = {to?: number[]; n?: unknown; seq?: unknown; claimed?: unknown};
type World = {pos: number[] | null; posTick: number | null; seq: number | null; lastUse: number | null};
const world: World = {pos: [0, 0], posTick: 10, seq: 4, lastUse: 10};
function only(rule: IntegrityRule<Pos, World>, state = world) {
  const owner = createIntegrity({rules: [rule], limits, decayPerSecond: 1});
  return (command: Pos, tick: number | null = null) => owner.assess({command, state, tick}).verdict;
}

test('SEC01: maxRateOfChange bounds distance per elapsed tick, clamped, and passes without an authoritative value', () => {
  const rule = integrityRules.maxRateOfChange<Pos, World>({
    id: 'move',
    perTick: 1,
    allowance: 0.5,
    maxElapsedTicks: 4,
    current: ({state}) => state.pos,
    proposed: ({command}) => command.to!,
    elapsedTicks: ({state, tick}) => (state.posTick === null || tick === null ? null : tick - state.posTick),
  });
  const run = only(rule);
  assert.equal(run({to: [3, 4]}, 15), 'invalid'); // 5 > 0.5 + 1 * min(4, 5)
  assert.equal(run({to: [3, 4]}, 10), 'invalid'); // elapsed 0 clamps to 1: 5 > 1.5
  assert.equal(run({to: [0.9, 1.2]}, 10), 'ok'); // 1.5 <= 1.5
  assert.equal(run({to: [2.4, 3.2]}, 14), 'ok'); // 4 <= 4.5
  assert.equal(run({to: [1, 2, 3]}, 20), 'invalid', 'dimension mismatch fails closed');
  assert.equal(run({to: [Number.NaN, 0]}, 20), 'invalid');
  assert.equal(only(rule, {...world, pos: null})({to: [1e9, 0]}, 20), 'ok', 'no authoritative value yet');
  const owner = createIntegrity({rules: [rule], limits, decayPerSecond: 1});
  assert.deepEqual(owner.assess({command: {to: [3, 4]}, state: world, tick: 12}).findings[0]?.evidence, {
    distance: 5,
    allowed: 2.5,
  });
});

test('SEC01: valueInRange, valueInSet, monotonic, cooldown and claimedTickInBand helpers', () => {
  const range = only(
    integrityRules.valueInRange({id: 'range', min: 1, max: 5, integer: true, value: ({command}) => command.n}),
  );
  assert.deepEqual(
    [1, 5, 0, 6, 2.5, '3', Number.NaN].map(n => range({n})),
    ['ok', 'ok', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid'],
  );
  const set = only(integrityRules.valueInSet({id: 'set', allowed: ['a', 2, true], value: ({command}) => command.n}));
  assert.deepEqual(
    ['a', 2, true, 'b', '2', 1].map(n => set({n})),
    ['ok', 'ok', 'ok', 'invalid', 'invalid', 'invalid'],
  );
  const seq = only(
    integrityRules.monotonic({
      id: 'seq',
      maxStep: 2,
      value: ({command}) => command.seq,
      previous: ({state}) => state.seq,
    }),
  );
  assert.deepEqual(
    [5, 6, 4, 7, '5'].map(s => seq({seq: s})),
    ['ok', 'ok', 'invalid', 'invalid', 'invalid'],
  );
  assert.equal(
    only(
      integrityRules.monotonic({
        id: 'seq',
        strict: false,
        value: ({command}) => command.seq,
        previous: ({state}) => state.seq,
      }),
    )({seq: 4}),
    'ok',
  );
  const cool = only(integrityRules.cooldown({id: 'cool', cooldownTicks: 30, lastTick: ({state}) => state.lastUse}));
  assert.deepEqual(
    [39, 40, null].map(t => cool({}, t)),
    ['invalid', 'ok', 'invalid'],
  );
  assert.equal(only(integrityRules.cooldown({id: 'cool', cooldownTicks: 30, lastTick: () => null}))({}, null), 'ok');
  const band = only(
    integrityRules.claimedTickInBand({
      id: 'band',
      maxBehindTicks: 12,
      maxAheadTicks: 2,
      claimed: ({command}) => command.claimed,
    }),
  );
  assert.deepEqual(
    [88, 100, 102, 87, 103, 'x'].map(c => band({claimed: c}, 100)),
    ['ok', 'ok', 'ok', 'invalid', 'invalid', 'invalid'],
  );
  const bandOwner = createIntegrity({
    rules: [
      integrityRules.claimedTickInBand<Pos, World>({
        id: 'band',
        maxBehindTicks: 12,
        maxAheadTicks: 2,
        claimed: ({command}) => command.claimed,
      }),
    ],
    limits,
    decayPerSecond: 1,
  });
  assert.equal(
    bandOwner.assess({command: {claimed: 87}, state: world, tick: 100}).findings[0]?.weight,
    0,
    'behind: unscored no-op',
  );
  assert.equal(
    bandOwner.assess({command: {claimed: 103}, state: world, tick: 100}).findings[0]?.weight,
    1,
    'ahead: scored',
  );
  const flagged = createIntegrity({
    rules: [
      integrityRules.cooldown<Pos, World>({
        id: 'cool',
        cooldownTicks: 30,
        violation: 'flag',
        weight: 2,
        lastTick: ({state}) => state.lastUse,
      }),
    ],
    limits,
    decayPerSecond: 1,
  });
  assert.deepEqual(flagged.check('k', {command: {}, state: world, tick: 11}, 0), {
    action: 'allow',
    score: 2,
    observed: null,
  });
  assert.throws(() => integrityRules.valueInRange({id: 'bad id', min: 0, max: 1, value: () => 0}));
  assert.throws(() => integrityRules.valueInRange({id: 'r', min: 2, max: 1, value: () => 0}));
  assert.throws(() => integrityRules.cooldown({id: 'c', cooldownTicks: -1, lastTick: () => null}));
  assert.throws(() => integrityRules.valueInSet({id: 's', allowed: [], value: () => 0}));
  assert.throws(() =>
    integrityRules.claimedTickInBand({id: 'b', maxBehindTicks: -1, maxAheadTicks: 0, claimed: () => 0}),
  );
  assert.throws(() =>
    integrityRules.maxRateOfChange({id: 'm', perTick: -1, current: () => 0, proposed: () => 0, elapsedTicks: () => 0}),
  );
  assert.throws(() =>
    integrityRules.maxRateOfChange({
      id: 'm',
      perTick: 1,
      maxElapsedTicks: 0,
      current: () => 0,
      proposed: () => 0,
      elapsedTicks: () => 0,
    }),
  );
});

test('SEC01: assertDisclosure finds entities and fields a projection must not disclose', () => {
  const projection = JSON.stringify({
    worldRevision: 3,
    entities: [
      {id: 'self', incarnation: 0, fields: {pos: [1, 2], secret: {code: 7}}},
      {id: 'hidden', incarnation: 0, fields: {pos: [9, 9]}},
      {id: 'visible', incarnation: 0, fields: {pos: [3, 4], items: []}},
    ],
  });
  const allowed = (id: string, path: string) => id !== 'hidden' && !path.startsWith('secret');
  assert.deepEqual(findDisclosureLeaks(projection, allowed), [
    {id: 'self', path: 'secret.code'},
    {id: 'hidden', path: ''},
  ]);
  assert.throws(() => assertDisclosure(projection, allowed), /2 leak\(s\): self:secret\.code, hidden:\(entity\)/);
  assert.doesNotThrow(() => assertDisclosure(projection, () => true));
  assert.deepEqual(
    findDisclosureLeaks(projection, (_id, path) => path !== 'items'),
    [{id: 'visible', path: 'items'}],
    'an empty container is a leaf',
  );
  assert.throws(() => findDisclosureLeaks('{"entities":7}', () => true));
});
