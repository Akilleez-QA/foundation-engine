import test from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, defineSystem} from '../../author';
import {testScene} from '../../author/testing';
import {createLossyLink} from './lossy-link';
import {createRollbackExchange, type RollbackMessage} from './exchange';
import {createRollbackSession} from './session';
import {networkReference, runNetwork, type NetworkRun} from './network-harness';
import {baseLimits, INPUTS, toyPorts} from './test-harness';
import {createRng} from '../../core/rng';
import type {RollbackSession} from './types';
import {must} from '../../testing/must';

/** Every frame's checksums agree across all publishers (peers and spectators) and with the reference replay. */
function assertAgreement(run: NetworkRun, label: string) {
  const reference = networkReference(run, 2000, baseLimits.inputDelay);
  let compared = 0,
    spectatorFrames = 0;
  for (const [frame, row] of run.published) {
    const values = new Set(row.values());
    assert.equal(values.size, 1, `${label}: frame ${frame} differs: ${JSON.stringify([...row])}`);
    const expected = reference.get(frame);
    if (expected !== undefined) {
      compared++;
      assert.equal([...values][0], expected, `${label}: frame ${frame} differs from the reference`);
    }
    if ([...row.keys()].some(k => k.startsWith('s'))) spectatorFrames++;
  }
  return {compared, spectatorFrames};
}

test('NETWORK the exchange lets two sessions survive 40% loss, duplication and reordering; plain sessions cannot', () => {
  const seed = 11;
  const run = runNetwork({
    seed,
    players: 2,
    ticks: 240,
    link: {loss: 0.4, duplicate: 0.2, reorder: 0.3, latency: [1, 5]},
    delay: {minDelay: 2, maxDelay: 2, maxStep: 1, minSpacing: 2, authority: 0},
  });
  for (const s of run.sessions) assert.equal(s.read().status, 'running', String(s.read().reason));
  const {compared} = assertAgreement(run, 'two peers');
  assert.ok(compared >= 58, `compared ${compared} checksum frames`);
  assert.ok(run.link.lost > 200 && run.link.duplicated > 50 && run.link.reordered > 100);
  // The same link without the exchange: inputs sent once, in arrival order.
  const link = createLossyLink<{player: number; frame: number; input: string}>({
    seed,
    loss: 0.4,
    duplicate: 0.2,
    reorder: 0.3,
    latency: [1, 5],
  });
  const plain = [0, 1].map(local =>
    createRollbackSession({local, neutralInput: 'n', limits: baseLimits, ports: toyPorts()}),
  );
  const rng = createRng(seed);
  for (let t = 0; t < 240; t++)
    for (const [i, s] of plain.entries()) {
      for (const m of link.receive(i, t)) s.remote(m.player, m.frame, m.input);
      const l = s.local(INPUTS[rng.int(0, 3)]!); // rng.int(0, 3) indexes the four INPUTS
      if (l.status === 'queued') link.send(i, 1 - i, {player: i, frame: l.frame, input: l.input}, t);
      s.advance();
    }
  assert.ok(
    plain.some(s => s.read().status === 'failed' && s.read().reason === 'remote-gap'),
    'without resend a lost input is a protocol fault',
  );
});

const scenarios = [
  {players: 3, link: {loss: 0.25, duplicate: 0.1, reorder: 0.2, latency: [0, 5] as const, bandwidth: 6000}},
  {players: 4, link: {loss: 0.35, duplicate: 0.2, reorder: 0.3, latency: [1, 8] as const}},
];
test('NETWORK seeded peers and spectators stay checksum-identical across delay changes, a departure and a late join', () => {
  let relayed = 0,
    increases = 0,
    decreases = 0;
  for (const [k, sc] of scenarios.entries())
    for (const seed of [3, 17, 29, 41, 53, 67]) {
      const label = `players ${sc.players} seed ${seed}`;
      const leaver = 1 + (seed % (sc.players - 1));
      const run = runNetwork({
        seed: seed + k * 1000,
        players: sc.players,
        ticks: 260,
        link: {...sc.link, latency: [...sc.link.latency]},
        disconnect: [{player: leaver, at: 80 + (seed % 60)}],
        spectators: [
          {join: 0, feed: 0},
          {join: 150 + (seed % 40), feed: leaver === sc.players - 1 ? 0 : sc.players - 1},
        ],
        timeout: 30,
      });
      const survivors = run.sessions.filter((_, i) => i !== leaver).map(s => s.read());
      for (const r of survivors) {
        assert.equal(r.status, 'running', `${label}: ${r.reason}`);
        assert.ok(r.confirmedFrame >= 268, `${label}: confirmed ${r.confirmedFrame}`);
      }
      // Identical departure agreement on every survivor.
      const agreed = survivors.map(r => JSON.stringify(r.departures));
      assert.equal(new Set(agreed).size, 1, `${label}: ${agreed.join(' vs ')}`);
      const d = must(survivors[0]!.departures[0]);
      assert.equal(d.player, leaver);
      assert.ok(d.final && d.decided !== null);
      if (new Set(d.reports.map(r => r[1])).size > 1) relayed++;
      // Identical delay schedule on every survivor.
      const logs = run.delayLog.filter((_, i) => i !== leaver).map(l => l.join(' '));
      assert.equal(new Set(logs).size, 1, `${label}: delay logs ${logs.join(' | ')}`);
      const changes = must(run.delayLog[0]).map(e => Number(e.split(':')[1]));
      let prev = baseLimits.inputDelay;
      for (const c of changes) {
        if (c > prev) increases++;
        else decreases++;
        prev = c;
      }
      for (const [i, sp] of run.spectators.entries()) {
        const r = must(sp).read();
        assert.equal(r.status, 'running', `${label}: spectator ${i}: ${r.reason}`);
        assert.ok(r.frame >= 260, `${label}: spectator ${i} at ${r.frame}`);
        assert.ok(r.stats.checked > 20, `${label}: spectator ${i} compared checksums`);
      }
      const {compared, spectatorFrames} = assertAgreement(run, label);
      assert.ok(compared >= 64, `${label}: compared ${compared}`);
      assert.ok(spectatorFrames >= 60, `${label}: spectator frames ${spectatorFrames}`);
      // The late spectator joined from a confirmed state, not from frame 0.
      assert.ok(must(run.spectators[1]).read().stats.frames < 260);
    }
  assert.ok(relayed > 0, 'some survivors held different amounts of the leaver`s input (relay exercised)');
  assert.ok(increases > 0 && decreases > 0, `delay rose ${increases} and fell ${decreases} times`);
});

test('NETWORK two departures in quick succession still end in one agreement on the two survivors', () => {
  for (const seed of [2, 5, 8, 13]) {
    const run = runNetwork({
      seed,
      players: 4,
      ticks: 200,
      link: {loss: 0.3, duplicate: 0.1, reorder: 0.2, latency: [0, 6]},
      disconnect: [
        {player: 2, at: 90},
        {player: 3, at: 90 + (seed % 5)},
      ],
      timeout: 30,
    });
    const survivors = [0, 1].map(i => must(run.sessions[i]).read());
    for (const r of survivors) assert.equal(r.status, 'running', `seed ${seed}: ${r.reason}`);
    assert.equal(JSON.stringify(survivors[0]!.departures), JSON.stringify(survivors[1]!.departures));
    assert.equal(survivors[0]!.departures.length, 2);
    assertAgreement(run, `overlap seed ${seed}`);
  }
});

/**
 * Representative consumer: two sessions and their exchanges driven from the stock fixed lane over the seeded lossy
 * link (time = the fixed tick count); the visit's signal retires both sessions.
 */
test('NETWORK sessions with exchanges run from a scene system over a lossy link and retire with the visit', async () => {
  const controller = new AbortController();
  const sessions: RollbackSession[] = [0, 1].map(local =>
    createRollbackSession({
      local,
      neutralInput: 'n',
      limits: baseLimits,
      ports: toyPorts(),
      signal: controller.signal,
      retainInputFrames: 40,
    }),
  );
  const exchanges = sessions.map(session =>
    createRollbackExchange({
      session,
      limits: {maxInputsPerMessage: 32, maxChecksumsPerMessage: 2, roundTripSamples: 8},
    }),
  );
  const link = createLossyLink<RollbackMessage>({seed: 4, loss: 0.2, duplicate: 0.05, reorder: 0.1, latency: [1, 3]});
  let now = 0;
  const netplay = defineSystem({
    id: 'rollback-lossy-netplay',
    run(ctx) {
      now++;
      for (const [i, s] of sessions.entries()) {
        for (const m of link.receive(i, now)) must(exchanges[i]).receive(m, now);
        if (!must(exchanges[i]).read().pacing.skip) {
          s.local(ctx.random() < 0.5 ? 'r' : 'l');
          s.advance();
        }
        link.send(i, 1 - i, must(exchanges[i]).outgoing(1 - i, now), now);
      }
    },
  });
  const scene = defineScene({
    id: 'rollback-lossy',
    title: 'Rollback lossy',
    systems: [netplay],
    exit: () => controller.abort(),
  });
  const t = await testScene(scene, {seed: 9});
  t.run(3);
  for (const s of sessions) assert.equal(s.read().status, 'running', String(s.read().reason));
  const [a, b] = sessions.map(s => s.confirmedState()!);
  assert.ok(a!.frame > 100 && b!.frame > 100, `confirmed ${a!.frame} ${b!.frame}`);
  const common = Math.min(a!.frame, b!.frame);
  const ca = sessions[0]!.recentChecksums(64).find(c => c.frame === common - (common % 4));
  const cb = sessions[1]!.recentChecksums(64).find(c => c.frame === common - (common % 4));
  assert.ok(ca && cb);
  assert.equal(ca.checksum, cb.checksum);
  assert.ok(must(exchanges[0]).read().roundTrip[1]! >= 2, 'a round trip was measured');
  t.dispose();
  assert.deepEqual(
    sessions.map(s => s.read().status),
    ['retired', 'retired'],
  );
});
