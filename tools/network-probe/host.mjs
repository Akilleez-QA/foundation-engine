// Child-process wrapper for the overload probe (NW-07). It starts ONE reference host in this process so the
// probe's clients and the host do not share an event loop, and answers trusted IPC requests from its parent only.
// Tools only: no engine runtime change. The parent owns this process and is the only caller.
import {performance} from 'node:perf_hooks';
import {startNetworkWorkbench} from '../network-workbench/server.mjs';
import {startReplicationWorkbench} from '../replication-workbench/server.mjs';

const kinds = new Set(['network', 'replication']);
const config = JSON.parse(process.argv[2] ?? '{}');
if (!kinds.has(config.kind)) throw Error('probe host: kind');
if (typeof process.send !== 'function') throw Error('probe host: IPC parent required');

const host =
  config.kind === 'network'
    ? await startNetworkWorkbench(config.options ?? {})
    : await startReplicationWorkbench(config.options ?? {});

// Process-level observations sampled on every read and on a 25 ms timer; RSS is an observation, not a guarantee.
const high = {rssBytes: 0, heapUsedBytes: 0, externalBytes: 0, arrayBuffersBytes: 0, eventLoopLagMs: 0};
let last = performance.now();
function sample() {
  const m = process.memoryUsage();
  high.rssBytes = Math.max(high.rssBytes, m.rss);
  high.heapUsedBytes = Math.max(high.heapUsedBytes, m.heapUsed);
  high.externalBytes = Math.max(high.externalBytes, m.external);
  high.arrayBuffersBytes = Math.max(high.arrayBuffersBytes, m.arrayBuffers);
  return m;
}
const sampler = setInterval(() => {
  const t = performance.now();
  high.eventLoopLagMs = Math.max(high.eventLoopLagMs, t - last - 25);
  last = t;
  sample();
}, 25);
sample();

function read() {
  const m = sample();
  return {host: host.read(), process: {pid: process.pid, rssBytes: m.rss, heapUsedBytes: m.heapUsed, high: {...high}}};
}

/** Small observation for frequent polling: no entity clones or timing arrays cross IPC. */
function sampleLight() {
  const m = sample(),
    h = host.read();
  return {
    host: {
      intake: h.intake,
      metrics: h.metrics,
      closeReasons: h.closeReasons,
      peers: h.peers.map(p => ({
        principal: p.principal,
        bufferedBytes: p.bufferedBytes,
        ...(p.session === undefined
          ? {}
          : {
              session: p.session,
              sequence: p.publisher?.sequence ?? null,
              outstanding: p.publisher?.outstanding ?? null,
            }),
      })),
    },
    process: {pid: process.pid, rssBytes: m.rss, heapUsedBytes: m.heapUsed, high: {...high}},
  };
}

let closing = null;
async function shutdown() {
  closing ??= (async () => {
    clearInterval(sampler);
    await host.close();
  })();
  return closing;
}

process.on('message', async request => {
  if (!request || typeof request.id !== 'number') return;
  try {
    let value;
    if (request.method === 'read') value = read();
    else if (request.method === 'sample') value = sampleLight();
    else if (request.method === 'changeWorld' && config.kind === 'replication') {
      host.changeWorld(request.payload);
      value = null;
    } else if (request.method === 'close') {
      await shutdown();
      value = {closed: true};
    } else throw Error('probe host: method');
    process.send({type: 'reply', id: request.id, value});
    if (request.method === 'close') process.disconnect();
  } catch (error) {
    process.send?.({type: 'reply', id: request.id, error: String(error?.message ?? error)});
  }
});
// The parent going away (crash or kill) must not leave a listening host behind.
process.once('disconnect', () => void shutdown().then(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().then(() => process.exit(0)));
process.send({type: 'ready', url: host.url, credentials: host.credentials, pid: process.pid});
