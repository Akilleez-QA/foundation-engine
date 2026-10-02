// NW-07 regression-sized overload probe: real loopback WebSockets against child-process reference hosts.
// Evidence scope: loopback/process only; not WAN, not physical devices. Floors are deliberately loose so a
// loaded developer machine does not flake, while still failing if a flooder or non-reader harms healthy peers.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { runNetworkProbe, resolveConfig, CAPS } from './probe.mjs';

let report;
before(async () => {
  report = await runNetworkProbe({
    seed: 11,
    overload: { queueAgeVariants: [null], rampPerClient: [8, 24], stepMs: 1000, drainMs: 400 },
    nonReader: { healthyClients: 2, settleMs: 300, maxAttackMs: 2000 },
    storm: { variants: [{ policy: 'jitter', clients: 8 }], observeMs: 6000 },
  });
});

test('NW07: probe configuration is capped and validated', () => {
  assert.throws(() => resolveConfig({ overload: { healthyClients: CAPS.healthyClients + 1 } }), RangeError);
  assert.throws(() => resolveConfig({ overload: { rampPerClient: [CAPS.ratePerClient + 1] } }), RangeError);
  assert.throws(() => resolveConfig({ storm: { variants: [{ policy: 'jitter', clients: CAPS.stormClients + 1 }] } }), RangeError);
  assert.throws(() => resolveConfig({ nonReader: { maxAttackMs: CAPS.attackMs + 1 } }), RangeError);
  assert.throws(() => resolveConfig({ scenarios: ['unknown'] }), RangeError);
  assert.equal(resolveConfig().seed, 7);
});

test('NW07: healthy goodput stays above a floor past saturation while a flooder is rate-limited', () => {
  assert.equal(report.aborted, null);
  const [o] = report.scenarios.overload.variants;
  assert.equal(o.unexpectedHealthyCloses.length, 0, 'no healthy peer is closed');
  const floods = o.adversaries.filter((a) => a.kind === 'flooder');
  assert.ok(floods.length > 0);
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
  assert.ok(o.derived.plateauRatio >= 0.5, `final/peak goodput ${o.derived.plateauRatio}`);
  assert.ok(o.highWater.queuedMessages <= 32 && o.highWater.queuedBytes <= 16384);
  assert.ok(o.highWater.peerBufferedBytes <= 8192);
});

test('NW07: a physical non-reading peer stays bounded or is retired; healthy peers keep current views', () => {
  const n = report.scenarios.nonReader;
  assert.ok(n.highWater.hostMaxBufferedBytesAtSend <= 131072, `${n.highWater.hostMaxBufferedBytesAtSend}`);
  if (n.nonReader.retiredByHost) assert.deepEqual(n.highWater.hostCloseReasons, { 'send-refused': 1 });
  assert.equal(n.healthy.unexpectedCloses.length, 0);
  for (const v of n.healthy.viewsByPhase) assert.ok(v.attack > 0, 'healthy peers receive views during the attack');
  assert.ok(n.highWater.hostMaxOutstanding <= n.healthy.clients + 1, 'one application credit per peer');
  assert.ok(n.highWater.hostRssBytes < 512 * 1048576, 'host memory high-water bounded');
});

test('NW07: reconnect storm after a host restart is paced and bounded; every owned resource is released', () => {
  const [v] = report.scenarios.storm.variants;
  assert.equal(v.outcomes.reconnected, 8);
  assert.ok(v.maxAttemptsPerClient <= v.attemptBoundPerClient);
  assert.ok(v.attempts <= v.clients * v.attemptBoundPerClient);
  assert.deepEqual(
    { children: report.ownedResourcesAfterCleanup.children, sockets: report.ownedResourcesAfterCleanup.sockets },
    { children: 0, sockets: 0 },
  );
  for (const pid of report.ownedResourcesAfterCleanup.startedHostPids)
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `host ${pid} exited`);
  for (const row of report.invariants) if (!row.finding && !row.inconclusive) assert.equal(row.ok, true, `${row.id}: ${row.detail}`);
});
