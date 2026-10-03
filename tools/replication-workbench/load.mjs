import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {WebSocket} from 'ws';
import {startReplicationWorkbench, viewLimits} from './server.mjs';
const delay = () => new Promise(r => setTimeout(r, 1));
const percentile = (samples, p) =>
  [...samples].sort((a, b) => a - b)[Math.max(0, Math.ceil(samples.length * p) - 1)] ?? 0;
async function until(fn) {
  const end = performance.now() + 3000;
  while (!fn()) {
    if (performance.now() > end) throw Error('load transport timeout');
    await delay();
  }
}
/** Explicit loopback/application-credit workload; not a WAN or device benchmark. No engine frame loop. */
export async function runReplicationLoad() {
  const cases = [];
  for (const peerCount of [2, 8])
    for (const entityCount of [8, 64]) {
      const host = await startReplicationWorkbench({autoDriver: false, entityCount}),
        clients = [],
        adoption = [];
      try {
        for (let i = 0; i < peerCount; i++) {
          const principal = i % 2 ? 'beta' : 'alpha',
            socket = new WebSocket(host.url),
            c = {socket, principal, session: null, views: [], bytes: 0};
          socket.on('error', () => {});
          socket.on('message', data => {
            const start = performance.now(),
              text = data.toString(),
              f = JSON.parse(text);
            c.bytes += Buffer.byteLength(text);
            if (f.type === 'authenticated') c.session = f.session;
            else if (f.type === 'view') {
              assert.equal(f.session, c.session);
              assert.equal(f.entities.length, entityCount);
              assert.ok(f.entities.every(e => e.fields.private === `${principal}:${e.id}`));
              assert.ok(Buffer.byteLength(text) <= viewLimits.maxBytes);
              c.views.push(f);
              adoption.push(performance.now() - start);
            } else throw Error(`unexpected frame ${f.type}`);
          });
          await until(() => socket.readyState === WebSocket.OPEN);
          socket.send(JSON.stringify({v: 1, type: 'auth', token: host.credentials[principal]}));
          await until(() => c.session);
          clients.push(c);
        }
        host.pump();
        await until(() => clients.every(c => c.views.length === 1));
        let healthyRounds = 0;
        for (let round = 1; round <= 100; round++) {
          // Peer zero deliberately withholds its first application credit for all rounds.
          const before = host.read().metrics.received;
          for (const c of clients.slice(1))
            c.socket.send(
              JSON.stringify({v: 1, type: 'view-ack', session: c.session, sequence: c.views.at(-1).sequence}),
            );
          await until(() => host.read().metrics.received >= before + peerCount - 1);
          host.changeWorld({id: 'entity-0', value: round});
          const driverBefore = host.read().metrics.rounds;
          host.pump();
          await until(() => clients.slice(1).every(c => c.views.at(-1).entities[0].fields.value === round));
          assert.equal(host.read().metrics.rounds - driverBefore, 1);
          healthyRounds++;
          const state = host.read();
          assert.ok(state.peers.every(p => p.publisher.outstanding));
          assert.ok(state.metrics.maxOutstanding <= peerCount);
          assert.ok(state.metrics.maxOutstandingBytes <= peerCount * viewLimits.maxBytes);
        }
        assert.equal(clients[0].views.length, 1);
        const state = host.read(),
          p95 = percentile(state.timings.samples, 0.95);
        assert.ok(state.timings.samples.length < state.timings.capacity, 'timing retention must not truncate workload');
        assert.ok(p95 < 16, `publisher p95 ${p95}ms misses declared 16ms target`);
        cases.push({
          peerCount,
          entityCount,
          rounds: 100,
          healthyRounds,
          applicationStalledPeerViews: clients[0].views.length,
          timingLabel: state.timings.kind,
          publisherSamples: state.timings.samples.length,
          publisherP95Ms: p95,
          publisherMaxMs: Math.max(...state.timings.samples),
          consumerLabel: 'Node JSON parse + independent validation only; not browser ECS/render adoption',
          consumerP95Ms: percentile(adoption, 0.95),
          admittedPayloadBytes: state.metrics.sentBytes,
          receivedPayloadBytes: clients.reduce((n, c) => n + c.bytes, 0),
          maxOutstanding: state.metrics.maxOutstanding,
          maxOutstandingBytes: state.metrics.maxOutstandingBytes,
          maxNativeBufferedBytes: state.metrics.maxBufferedBytes,
          queuedMessages: state.intake.queuedMessages,
          queuedBytes: state.intake.queuedBytes,
        });
      } finally {
        await host.close();
      }
    }
  return {
    scope: 'headless loopback host, application credit withholding; no physical slow-reader/WAN/device certification',
    limits: viewLimits,
    cases,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.stdout.write(`${JSON.stringify(await runReplicationLoad(), null, 2)}\n`);
