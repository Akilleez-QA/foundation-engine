// NW-07 regression-sized overload probe: real loopback WebSockets against child-process reference hosts.
// Run once in CI with `npm run test:network-probe` (about 30 to 60 s; it lowers its own priority). It is not a
// `*.test.mjs` file, so per-template `npm test` runs do not repeat it.
// Evidence scope: loopback/process only; not WAN, not physical devices. Floors are loose so a loaded machine does
// not flake, while a flooder or non-reader that harmed healthy peers, or a broken bound, still fails.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { runNetworkProbe } from './probe.mjs';

try {
  os.setPriority(Math.max(os.getPriority(), 10));
} catch {
  /* not permitted on this platform */
}

let report;
before(async () => {
  report = await runNetworkProbe({
    seed: 11,
    overload: { queueAgeVariants: [null], rampPerClient: [8, 24], stepMs: 1000, drainMs: 400 },
    // Operator changes every 5 ms keep the non-reader's view dirty, so it is driven until the buffered-send cap.
    nonReader: { healthyClients: 2, settleMs: 300, changeEveryMs: 5, maxAttackMs: 30000 },
    // Enough attempts (cumulative backoff up to 11.75 s) and observation that every client resolves even when a
    // loaded machine delays the restarted host.
    storm: {
      variants: [{ policy: 'jitter', clients: 8 }],
      observeMs: 15000,
      retry: { baseMs: 250, capMs: 2000, maxAttempts: 8, budget: { capacity: 10, refillEveryMs: 15000 } },
    },
  });
});

test('NW07: healthy goodput stays above a floor past saturation while a flooder is rate-limited', () => {
  assert.equal(report.aborted, null);
  const [o] = report.scenarios.overload.variants;
  assert.equal(o.unexpectedHealthyCloses.length, 0, 'no healthy peer is closed');
  assert.deepEqual(o.adversaries.filter((a) => a.kind === 'round-error'), []);
  const floods = o.adversaries.filter((a) => a.kind === 'flooder');
  assert.equal(floods.length, o.steps.length);
  // Host-side retirement reason is authoritative; a loaded machine can lose the client-visible close frame.
  assert.equal(o.highWater.hostCloseReasons['rate-capacity'], floods.length);
  for (const f of floods) assert.ok(f.code === 1006 || (f.code === 1013 && f.reason === 'rate-capacity'), `${f.code} ${f.reason}`);
  const wrong = o.adversaries.filter((a) => a.kind === 'wrong-credential');
  assert.equal(o.highWater.hostCloseReasons['auth-rejected'], wrong.length);
  for (const a of wrong)
    assert.ok(a.code === 1006 || (a.code === 1008 && a.reason === 'auth-rejected' && a.class === 'terminal'), `${a.code} ${a.reason}`);
  const saturated = o.steps.at(-1);
  assert.ok(saturated.offeredPerSecond > saturated.goodputPerSecond, 'the last step is past saturation');
  // Nominal capacity is 80 dispatches/s; a quarter of it is a floor that only a real regression breaks.
  assert.ok(saturated.goodputPerSecond >= o.host.dispatchCapacityPerSecond / 4, `goodput ${saturated.goodputPerSecond}/s`);
  assert.ok(o.highWater.queuedMessages <= 32 && o.highWater.queuedBytes <= 16384);
  assert.ok(o.highWater.peerBufferedBytes <= 8192);
  assert.ok(o.highWater.connections <= 8);
});

test('NW07: a physical non-reading peer is retired by the buffered-send cap; healthy peers keep current views', () => {
  const n = report.scenarios.nonReader;
  assert.equal(n.nonReader.retiredByHost, true, `not retired within the window: ${JSON.stringify(n.nonReader)}`);
  assert.deepEqual(n.highWater.hostCloseReasons, { 'send-refused': 1 });
  assert.ok(n.highWater.hostMaxBufferedBytesAtSend > 0, 'the host buffered views before refusing');
  assert.ok(n.highWater.hostMaxBufferedBytesAtSend <= 131072, `${n.highWater.hostMaxBufferedBytesAtSend}`);
  assert.equal(n.healthy.unexpectedCloses.length, 0);
  for (const v of n.healthy.viewsByPhase) assert.ok(v.attack > 0, 'healthy peers receive views during the attack');
  // One application credit per peer, observed end to end: the delayed acknowledger never receives a view while its
  // acknowledgement is pending, sequences are consecutive, and the non-reader got at most one view past its acks.
  assert.equal(n.healthy.slowAcknowledgerMs, 30);
  assert.equal(n.healthy.creditViolations, 0);
  assert.equal(n.healthy.sequenceGaps, 0);
  assert.equal(n.nonReader.creditRespected, true);
  assert.ok(n.highWater.hostRssBytes < 512 * 1048576, 'host memory high-water bounded');
});

test('NW07: reconnect storm after a host restart is paced and bounded; every owned resource is released', () => {
  const [v] = report.scenarios.storm.variants;
  const detail = `host ready after ${v.hostReadyAfterMs} ms; ${JSON.stringify(v.outcomes)}; closes ${JSON.stringify(v.closesDuringStorm)}`;
  // No client is refused for capacity or treated as terminal (for example by a stale credential), and none is stuck.
  assert.equal(v.outcomes.terminal, 0, detail);
  assert.equal(v.outcomes.unresolved, 0, detail);
  assert.equal(v.closesDuringStorm['1013 connection-capacity'], undefined, detail);
  assert.equal(v.closesDuringStorm['1008 auth-rejected'], undefined, detail);
  // Every client that attempted after the host reported ready reconnected; any other stopped by its own bound.
  assert.equal(v.attemptedAfterReadyReconnected, v.attemptedAfterReady, detail);
  assert.equal(v.outcomes.reconnected + v.stoppedBeforeReady, v.clients, detail);
  assert.ok(v.outcomes.reconnected >= 1, detail);
  assert.ok(v.distinctAttemptBins > 1, `jittered attempts spread over ${v.distinctAttemptBins} bins`);
  assert.ok(v.maxAttemptsPerClient <= v.attemptBoundPerClient);
  assert.ok(v.maxAttemptsPerClient <= v.retryBudgetBoundPerClient);
  assert.ok(v.hostConnectionsAtEnd <= v.hostConnectionBound);
  const owned = report.ownedResourcesAfterCleanup;
  assert.equal(owned.children, 0);
  assert.equal(owned.socketsNotClosed, 0, `${owned.socketsNotClosed} of ${owned.socketsStarted} sockets still open`);
  assert.ok(owned.socketsStarted > 0);
  for (const pid of owned.startedHostPids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `host ${pid} exited`);
  for (const row of report.invariants) if (!row.finding && !row.inconclusive) assert.equal(row.ok, true, `${row.id}: ${row.detail}`);
});
