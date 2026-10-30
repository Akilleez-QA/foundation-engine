/**
 * SEC-01 review probes kept as regression tests: the recipe's full setup (tick budget + tick band + monotonic claims +
 * per-tick movement + cooldown) driven end to end through admit -> assess (reducer) -> record. Cheaters must gain
 * essentially nothing over honest play; honest clients under stalls, reconnects and jitter must never be closed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createIntegrity, integrityRules, integrityOk, integrityFlag} from './index';

type Cmd = {action: 'move' | 'use'; tick: number; to?: number; amount: number};
type View = {me: {position: number; positionTick: number; lastUseTick: number | null}; limit: number; hostTick: number};
const PER_TICK = 0.2,
  ALLOW = 0.002,
  FRAME = 1000 / 60,
  START = 10_000;
const lastTick = (me: View['me']) => Math.max(me.positionTick, me.lastUseTick ?? -Infinity);

/** The recipe's owner (docs/recipes/add-command-integrity.md), enforcing. */
function recipeOwner(order = true) {
  return createIntegrity<Cmd, View>({
    rules: [
      integrityRules.claimedTickInBand({
        id: 'tick-band',
        maxBehindTicks: 30,
        maxAheadTicks: 2,
        claimed: ({command}) => command.tick,
        hostTick: ({state}) => state.hostTick,
      }),
      ...(order
        ? [
            integrityRules.monotonic<Cmd, View>({
              id: 'tick-order',
              weight: 0,
              value: ({command}) => command.tick,
              previous: ({state}) => lastTick(state.me),
            }),
          ]
        : []),
      integrityRules.maxRateOfChange({
        id: 'move-rate',
        perTick: PER_TICK,
        allowance: ALLOW,
        maxElapsedTicks: 8,
        current: ({state, command}) => (command.action === 'move' ? state.me.position : null),
        proposed: ({command}) => command.to!,
        elapsedTicks: ({state, tick}) => (tick === null ? null : tick - state.me.positionTick),
      }),
      integrityRules.valueInSet({id: 'action', allowed: ['move', 'use'], value: ({command}) => command.action}),
      integrityRules.cooldown({
        id: 'use-cooldown',
        cooldownTicks: 60,
        lastTick: ({state, command}) => (command.action === 'use' ? state.me.lastUseTick : null),
      }),
      {
        id: 'custom',
        check: ({command, state}) => (command.amount <= state.limit ? integrityOk() : integrityFlag('custom', 2)),
      },
    ],
    limits: {maxKeys: 256, maxHistoryPerKey: 8, maxAudit: 512},
    decayPerSecond: 0.5,
    tickBudget: {ticksPerSecond: 60, maxCatchUpTicks: 16},
    close: {score: 6, requires: {violations: 5, withinMs: 10_000}},
  });
}

function makeHost(order = true) {
  const integrity = recipeOwner(order);
  const me = {position: 0, positionTick: 600, lastUseTick: null as number | null};
  let closed = false;
  const hostTick = (now: number) => Math.floor((now * 60) / 1000);
  function submit(now: number, cmd: Cmd): string {
    if (closed) return 'closed';
    const gate = integrity.admit('p', now, {tick: cmd.tick});
    if (gate.action === 'close') {
      closed = true;
      return 'closed';
    }
    if (gate.action === 'throttle') return `throttle:${gate.retryAfterMs}`;
    if (gate.action !== 'allow' && gate.action !== 'reject') return gate.action;
    if (gate.action === 'reject') return 'void'; // consumed as a no-op
    const a = integrity.assess({
      command: cmd,
      state: {me: {...me}, limit: 10, hostTick: hostTick(now)},
      tick: cmd.tick,
    });
    if (a.verdict === 'ok') {
      if (cmd.action === 'move') {
        me.position = cmd.to!;
        me.positionTick = cmd.tick;
      } else me.lastUseTick = cmd.tick;
    }
    if (integrity.record('p', a, now).action === 'close') {
      closed = true;
      return 'closed';
    }
    return a.verdict;
  }
  const greedyTo = (claim: number) =>
    me.position + (ALLOW + PER_TICK * Math.min(8, Math.max(1, claim - me.positionTick))) * (1 - 1e-9);
  const honestTo = (claim: number) => me.position + PER_TICK * Math.min(1, Math.max(0, claim - me.positionTick));
  return {
    integrity,
    me,
    submit,
    greedyTo,
    honestTo,
    hostTick,
    get closed() {
      return closed;
    },
  };
}

function cheat(
  seconds: number,
  next: (h: ReturnType<typeof makeHost>, now: number, i: number) => number,
  gapMs = FRAME,
  honourRetry = true,
  honestMoves = false,
  order = true,
) {
  const h = makeHost(order);
  let now = START,
    i = 0,
    pending: number | null = null;
  while (now < START + seconds * 1000 && !h.closed) {
    const claim: number = pending ?? next(h, now, i);
    const r = h.submit(now, {
      action: 'move',
      tick: claim,
      to: honestMoves ? h.honestTo(claim) : h.greedyTo(claim),
      amount: 0,
    });
    if (r.startsWith('throttle:')) {
      pending = claim;
      now += honourRetry ? +r.slice(9) : 1;
      continue;
    }
    pending = null;
    i++;
    now += gapMs;
  }
  return {ratio: h.me.position / (PER_TICK * 60 * seconds), closed: h.closed, score: h.integrity.read('p')?.score ?? 0};
}

test('SEC01 probe: claim poisoning, ping-pong, same-tick spam and runaway claims gain essentially nothing', () => {
  const honest = cheat(10, (h, now) => h.hostTick(now), FRAME, true, true);
  assert.equal(honest.closed, false);
  assert.equal(honest.score, 0);
  const cases: [string, ReturnType<typeof cheat>][] = [];
  for (const k of [2, 4, 8, 1e9]) {
    let c = 600,
      d = 600;
    cases.push([`naive +${k}`, cheat(10, () => (c += k))]);
    cases.push([`band-capped +${k}`, cheat(10, (h, now) => (d = Math.min(d + k, h.hostTick(now) + 2)))]);
  }
  const pingPong = (h: ReturnType<typeof makeHost>, now: number, i: number) => h.hostTick(now) + 2 - (i % 2 ? 8 : 0);
  cases.push(['ping-pong 60/s', cheat(10, pingPong)]);
  cases.push(['ping-pong as fast as budget', cheat(10, pingPong, 1)]);
  cases.push(['ping-pong lagging band', cheat(10, (h, now, i) => h.hostTick(now) - 22 - (i % 2 ? 8 : 0), 1)]);
  cases.push(['poison then ping-pong', cheat(10, (h, now, i) => (i === 0 ? 1e12 : pingPong(h, now, i)), 1)]);
  cases.push(['poison then same tick', cheat(10, (h, now, i) => (i === 0 ? 1e12 : h.hostTick(now)), 1)]);
  cases.push(['same tick spam', cheat(10, (h, now) => h.hostTick(now), 1)]);
  cases.push(['jump every 0.5 s', cheat(10, (h, now) => h.hostTick(now) + 2, 500)]);
  const impatient = cheat(10, pingPong, 1, false);
  cases.push(['ping-pong ignoring retryAfter', impatient]);
  for (const [name, r] of cases) assert.ok(r.ratio <= 1.05, `${name}: x${r.ratio.toFixed(3)}`);
});

test("SEC01 probe: the owner itself resists claim poisoning, without the recipe's tick-order rule", () => {
  // The tick budget charges the gap from the last admitted claim, so one absurd claim does not make later claims cheap.
  const pingPong = (h: ReturnType<typeof makeHost>, now: number, i: number) => h.hostTick(now) + 2 - (i % 2 ? 8 : 0);
  const poison = cheat(10, (h, now, i) => (i === 0 ? 1e12 : pingPong(h, now, i)), 1, true, false, false);
  assert.ok(poison.ratio <= 1.1, `poison then ping-pong: x${poison.ratio.toFixed(3)}`);
  const plain = cheat(10, pingPong, 1, true, false, false);
  assert.ok(plain.ratio <= 1.1, `ping-pong: x${plain.ratio.toFixed(3)}`);
});

/** Honest client with ordered, jittered transport; the host holds later inputs while one is throttled. */
function honest(o: {
  minutes: number;
  jitter: [number, number];
  stallEveryS?: number;
  stallS?: number;
  stallMode?: 'resync' | 'paused' | 'catchup';
  reconnectEveryS?: number;
  outageS?: number;
}) {
  let seed = 777;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const jit = () => o.jitter[0] + rnd() * (o.jitter[1] - o.jitter[0]);
  const h = makeHost();
  const maxPending = 16,
    END = START + o.minutes * 60_000;
  let hostFree = START,
    lastArrival = 0;
  const hostTick = (t: number) => Math.floor((t * 60) / 1000);
  let clientTick = hostTick(START),
    t = START;
  let nextStall = o.stallEveryS ? START + o.stallEveryS * 1000 : Infinity;
  let nextOutage = o.reconnectEveryS ? START + o.reconnectEveryS * 1000 + 7000 : Infinity;
  const deliver = (sendAt: number, claim: number) => {
    const arrive = Math.max(lastArrival, sendAt + jit());
    lastArrival = arrive;
    let at = Math.max(arrive, hostFree);
    for (;;) {
      const r = h.submit(at, {action: 'move', tick: claim, to: h.honestTo(claim), amount: 0});
      if (r.startsWith('throttle:')) {
        at = at + jit() + +r.slice(9) + jit();
        continue;
      }
      if (r === 'closed') return false;
      break;
    }
    hostFree = at;
    lastArrival = Math.max(lastArrival, at);
    return true;
  };
  while (t < END && !h.closed) {
    if (t >= nextOutage) {
      const t0 = t,
        inputs: number[] = [];
      for (let k = 0; k < maxPending; k++) inputs.push(hostTick(t0 + k * FRAME));
      const back = t0 + (o.outageS ?? 2) * 1000;
      for (const c of inputs) if (!deliver(back, c)) break;
      t = back;
      nextOutage += o.reconnectEveryS! * 1000;
      continue;
    }
    if (t >= nextStall) {
      const before = hostTick(t);
      t += o.stallS! * 1000;
      if (o.stallMode === 'paused') clientTick = before;
      else if (o.stallMode === 'catchup') for (let k = 1; k <= maxPending; k++) if (!deliver(t, before + k)) break;
      nextStall += o.stallEveryS! * 1000;
      if (o.stallMode !== 'paused') clientTick = hostTick(t);
      continue;
    }
    if (o.stallMode === 'paused') clientTick++;
    else clientTick = hostTick(t);
    if (!deliver(t, clientTick)) break;
    t += FRAME;
  }
  return {closed: h.closed, score: h.integrity.read('p')?.score ?? 0};
}

test('SEC01 probe: honest clients survive stalls, reconnects and resync under jitter (end to end)', () => {
  for (const jitter of [
    [40, 120],
    [5, 300],
  ] as [number, number][]) {
    const runs: [string, ReturnType<typeof honest>][] = [[`steady ${jitter}`, honest({minutes: 2, jitter})]];
    for (const S of [1, 5, 10])
      for (const stallMode of ['resync', 'catchup', 'paused'] as const)
        runs.push([
          `stall ${S}s ${stallMode} ${jitter}`,
          honest({minutes: 2, jitter, stallEveryS: 30, stallS: S, stallMode}),
        ]);
    for (const D of [0.2, 0.5, 1, 2, 5])
      runs.push([`reconnect outage ${D}s ${jitter}`, honest({minutes: 2, jitter, reconnectEveryS: 45, outageS: D})]);
    for (const [name, r] of runs) assert.equal(r.closed, false, `${name}: closed with score ${r.score.toFixed(2)}`);
  }
});

test('SEC01 probe: a flood of unscored no-op findings cannot evict scored evidence', () => {
  const o = recipeOwner();
  const view = (hostTick: number): View => ({
    me: {position: 0, positionTick: 600, lastUseTick: null},
    limit: 10,
    hostTick,
  });
  const ht = (x: number) => Math.floor((x * 60) / 1000);
  o.record(
    'victim',
    o.assess({command: {action: 'move', tick: 1000, to: 0, amount: 0}, state: view(600), tick: 1000}),
    START,
  );
  let t = START;
  o.record(
    'att',
    o.assess({command: {action: 'move', tick: ht(t) + 50, to: 0, amount: 0}, state: view(ht(t)), tick: ht(t) + 50}),
    t,
  );
  let noops = 0;
  for (; t < START + 20_000; t += FRAME) {
    if (o.admit('att', t, {tick: ht(t) - 40}).action !== 'allow') continue;
    o.record(
      'att',
      o.assess({command: {action: 'move', tick: ht(t) - 40, to: 0, amount: 0}, state: view(ht(t)), tick: ht(t) - 40}),
      t,
    );
    noops++;
  }
  assert.ok(noops > 1000);
  const log = o.audit();
  assert.ok(
    log.some(e => e.subject === 'victim' && e.weight > 0),
    'victim scored row kept in the shared log',
  );
  assert.ok(
    o.read('att')!.history.some(e => e.weight > 0),
    'attacker scored row kept in its own history',
  );
  assert.equal(o.stats().dropped, 0);
  assert.ok(log.filter(e => e.subject === 'att').length <= 8 + 21, `unscored rows limited: ${log.length}`);
  assert.ok(o.stats().auditSuppressed > 1000);
});
