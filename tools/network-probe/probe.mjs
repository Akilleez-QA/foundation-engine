// NW-07 overload and goodput probe (scalability study proposal N4). Tools only: no engine runtime change.
//
// Drives the loopback reference hosts past saturation over real WebSockets and reports offered load against
// goodput, rejections by reason, latency of admitted work, retained high-water marks, physical non-reading peers
// and a reconnect storm paced by createRetrySchedule. Every host runs in a child process this probe forks and
// owns; every socket and process it starts is closed in `finally`, and only those child PIDs are ever signalled.
//
// Evidence scope: one machine, loopback TCP, Node `ws` clients. Not WAN, not physical devices, not browsers,
// not multiple machines. Host RSS is an observation, not a guarantee.
import { fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { createClosePolicy, createRetrySchedule } from '../../src/kits/network/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const HOST = join(HERE, 'host.mjs');
const now = () => performance.now();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const SCOPE = Object.freeze({
  evidence: 'loopback-process',
  statement:
    'Single machine, loopback TCP (127.0.0.1), Node ws clients against reference hosts in child processes. ' +
    'Not WAN, not physical devices, not browsers, not multi-machine. Host RSS is an observation, not a guarantee.',
});

/** Default scenario: about 45 s of wall time. */
export const DEFAULTS = Object.freeze({
  seed: 7,
  overload: {
    healthyClients: 5,
    rampPerClient: [8, 16, 24], // commands per second per healthy client; each step is one offered load
    stepMs: 1500,
    driverMs: 50, // host pump every 50 ms with 4 dispatches per pump: about 80 dispatches/s of host capacity
    // NW-06 queue age on the reference host, one ramp per entry (probe fixture policy). null = FIFO, no shedding.
    queueAgeVariants: [null, 300, 600],
    onTimeMs: 500,
    adversaries: true, // per step: a flooder, a wrong credential and one connection over the bound
    flooderPerSecond: 200,
    nonReaderPerSecond: 8,
    drainMs: 600,
  },
  nonReader: { entityCount: 64, healthyClients: 3, changeEveryMs: 20, settleMs: 1000, maxAttackMs: 20000 },
  storm: {
    variants: [
      { policy: 'jitter', clients: 8 },
      { policy: 'no-jitter', clients: 8 },
      { policy: 'jitter', clients: 16 },
    ],
    downtimeMs: 400,
    binMs: 100,
    observeMs: 9000,
    retry: { baseMs: 250, capMs: 2000, maxAttempts: 6, budget: { capacity: 8, refillEveryMs: 15000 } },
  },
  abort: { rssMb: 1024, readTimeoutMs: 3000 },
});

/** Hard caps on any configuration, whatever the caller asks for. */
export const CAPS = Object.freeze({
  healthyClients: 5, // network host admits 8 connections: 5 healthy + 1 non-reader + 2 transient adversaries
  ratePerClient: 30, // below the host's 32/s per-peer token bucket, so healthy clients are never rate-closed
  steps: 8,
  stepMs: 10000,
  flooderPerSecond: 1000,
  nonReaderPerSecond: 30,
  replicationHealthy: 6,
  attackMs: 30000,
  stormClients: 32,
  stormVariants: 4,
  observeMs: 20000,
  totalMs: 180000,
  rssMb: 4096,
});

// ---------- small utilities ----------

/** Deterministic PRNG (mulberry32), uniform [0, 1). */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function percentile(samples, p) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}
const round = (x, digits = 2) => (x === null || x === undefined ? null : Number(x.toFixed(digits)));
const latencySummary = (samples) => ({
  samples: samples.length,
  p50Ms: round(percentile(samples, 0.5)),
  p95Ms: round(percentile(samples, 0.95)),
  p99Ms: round(percentile(samples, 0.99)),
  maxMs: round(samples.length ? Math.max(...samples) : null),
});
const bump = (record, key, by = 1) => {
  record[key] = (record[key] ?? 0) + by;
};
const closePolicy = createClosePolicy();
const describeClose = (code, reason) => ({
  code,
  reason,
  class: closePolicy.classify({ code, reason }),
});
const capInt = (value, min, max, name) => {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw RangeError(`probe config: ${name} must be an integer in [${min}, ${max}]`);
  return value;
};

/** Merge caller options over defaults and enforce CAPS. Throws on anything out of bounds. */
export function resolveConfig(options = {}) {
  const c = structuredClone(DEFAULTS);
  for (const key of ['overload', 'nonReader', 'storm', 'abort'])
    if (options[key]) Object.assign(c[key], structuredClone(options[key]));
  if (options.seed !== undefined) c.seed = options.seed;
  c.scenarios = options.scenarios ?? ['overload', 'non-reader', 'storm'];
  for (const s of c.scenarios)
    if (!['overload', 'non-reader', 'storm'].includes(s)) throw RangeError(`probe config: scenario ${s}`);
  capInt(c.seed, 0, 2 ** 31, 'seed');
  const o = c.overload;
  capInt(o.healthyClients, 1, CAPS.healthyClients, 'overload.healthyClients');
  if (!Array.isArray(o.rampPerClient) || o.rampPerClient.length < 1 || o.rampPerClient.length > CAPS.steps)
    throw RangeError('probe config: overload.rampPerClient');
  o.rampPerClient.forEach((r) => capInt(r, 1, CAPS.ratePerClient, 'overload.rampPerClient[]'));
  capInt(o.stepMs, 200, CAPS.stepMs, 'overload.stepMs');
  capInt(o.driverMs, 1, 1000, 'overload.driverMs');
  if (!Array.isArray(o.queueAgeVariants) || o.queueAgeVariants.length < 1 || o.queueAgeVariants.length > 3)
    throw RangeError('probe config: overload.queueAgeVariants');
  for (const age of o.queueAgeVariants) if (age !== null) capInt(age, 1, 60000, 'overload.queueAgeVariants[]');
  capInt(o.onTimeMs, 1, 60000, 'overload.onTimeMs');
  capInt(o.flooderPerSecond, 50, CAPS.flooderPerSecond, 'overload.flooderPerSecond');
  capInt(o.nonReaderPerSecond, 0, CAPS.nonReaderPerSecond, 'overload.nonReaderPerSecond');
  capInt(o.drainMs, 0, 5000, 'overload.drainMs');
  const n = c.nonReader;
  capInt(n.entityCount, 1, 64, 'nonReader.entityCount');
  capInt(n.healthyClients, 1, CAPS.replicationHealthy, 'nonReader.healthyClients');
  capInt(n.changeEveryMs, 5, 1000, 'nonReader.changeEveryMs');
  capInt(n.settleMs, 0, 10000, 'nonReader.settleMs');
  capInt(n.maxAttackMs, 100, CAPS.attackMs, 'nonReader.maxAttackMs');
  const s = c.storm;
  if (!Array.isArray(s.variants) || s.variants.length < 1 || s.variants.length > CAPS.stormVariants)
    throw RangeError('probe config: storm.variants');
  for (const v of s.variants) {
    if (!['jitter', 'no-jitter'].includes(v.policy)) throw RangeError('probe config: storm policy');
    capInt(v.clients, 1, CAPS.stormClients, 'storm.variants[].clients');
  }
  capInt(s.downtimeMs, 0, 5000, 'storm.downtimeMs');
  capInt(s.binMs, 10, 1000, 'storm.binMs');
  capInt(s.observeMs, 500, CAPS.observeMs, 'storm.observeMs');
  capInt(c.abort.rssMb, 64, CAPS.rssMb, 'abort.rssMb');
  capInt(c.abort.readTimeoutMs, 100, 10000, 'abort.readTimeoutMs');
  return c;
}

// ---------- owned resources ----------

/** Every child process and socket this probe starts. Cleanup touches only these. */
function createOwner() {
  const children = new Set(),
    sockets = new Set(),
    pids = [];
  return {
    children,
    pids,
    sockets,
    socket(url) {
      const socket = new WebSocket(url, { perMessageDeflate: false });
      sockets.add(socket);
      socket.on('error', () => {});
      socket.once('close', () => sockets.delete(socket));
      return socket;
    },
    async cleanup() {
      for (const socket of sockets) socket.terminate();
      sockets.clear();
      await Promise.all([...children].map((h) => h.close()));
    },
  };
}

/** Fork one reference host in a child process and speak its trusted IPC. */
async function startHost(owner, kind, options, abort) {
  const child = fork(HOST, [JSON.stringify({ kind, options })], {
    cwd: ROOT,
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr = (stderr + d).slice(-2000);
  });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const pending = new Map();
  let nextId = 1,
    closing = null;
  child.on('message', (m) => {
    if (m?.type !== 'reply') return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.error) p.reject(Error(m.error));
    else p.resolve(m.value);
  });
  const handle = {
    kind,
    pid: child.pid,
    call(method, payload, timeoutMs = abort.readTimeoutMs) {
      return new Promise((resolve, reject) => {
        if (child.exitCode !== null || child.signalCode !== null || !child.connected)
          return reject(Error('host-gone'));
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error('host-read-timeout'));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        child.send({ id, method, payload });
      });
    },
    /** Graceful close, then SIGKILL to this exact child PID only if it has not exited within 2 s. */
    close() {
      closing ??= (async () => {
        try {
          await handle.call('close', undefined, 3000);
        } catch {
          /* fall through to the bounded wait and the PID-specific kill */
        }
        const done = await Promise.race([exited, delay(2000).then(() => null)]);
        if (!done && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
          await exited;
        }
        owner.children.delete(handle);
      })();
      return closing;
    },
  };
  owner.children.add(handle);
  owner.pids.push(child.pid);
  const ready = await Promise.race([
    new Promise((resolve) => {
      const listen = (m) => {
        if (m?.type === 'ready') {
          child.off('message', listen);
          resolve(m);
        }
      };
      child.on('message', listen);
    }),
    exited.then((e) => {
      throw Error(`probe host exited before ready (${e.code ?? e.signal}): ${stderr.trim()}`);
    }),
    delay(15000).then(() => {
      throw Error('probe host ready timeout');
    }),
  ]).catch(async (error) => {
    await handle.close();
    throw error;
  });
  handle.url = ready.url;
  handle.credentials = ready.credentials;
  handle.port = Number(new URL(ready.url).port);
  return handle;
}

/** Background sampler of host high-water marks; sets `state.abort` on an RSS breach or unresponsive host. */
function sampleHost(host, cfg, state, observe) {
  const high = { queuedMessages: 0, queuedBytes: 0, peerBufferedBytes: 0, connections: 0, samples: 0 };
  let busy = false,
    last = null;
  const timer = setInterval(async () => {
    if (busy || state.abort) return;
    busy = true;
    try {
      const r = await host.call('sample');
      last = r;
      high.samples++;
      high.queuedMessages = Math.max(high.queuedMessages, r.host.intake.queuedMessages);
      high.queuedBytes = Math.max(high.queuedBytes, r.host.intake.queuedBytes);
      high.connections = Math.max(high.connections, r.host.intake.connections);
      for (const p of r.host.peers) high.peerBufferedBytes = Math.max(high.peerBufferedBytes, p.bufferedBytes);
      observe?.(r);
      if (r.process.high.rssBytes > cfg.abort.rssMb * 1048576)
        state.abort = `host RSS ${Math.round(r.process.high.rssBytes / 1048576)} MiB above abort threshold ${cfg.abort.rssMb} MiB`;
    } catch (error) {
      if (!state.stopping) state.abort = `host sampler: ${error.message}`;
    } finally {
      busy = false;
    }
  }, 50);
  return {
    high,
    last: () => last,
    stop: () => clearInterval(timer),
  };
}

const opened = (socket) =>
  socket.readyState === WebSocket.OPEN
    ? Promise.resolve(true)
    : new Promise((resolve) => {
        socket.once('open', () => resolve(true));
        socket.once('close', () => resolve(false));
      });
const closedWithin = (socket, ms) =>
  new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) return resolve(socket._probeClose ?? null);
    const timer = setTimeout(() => resolve(null), ms);
    socket.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
async function waitFor(check, ms, label) {
  const end = now() + ms;
  while (!check()) {
    if (now() > end) throw Error(`probe wait timeout: ${label}`);
    await delay(5);
  }
}

// ---------- scenario 1: overload ramp against the network workbench ----------

async function runOverload(cfg, owner, state) {
  const variants = [];
  for (const age of cfg.overload.queueAgeVariants) {
    if (state.abort) break;
    variants.push(await runOverloadRamp(cfg, owner, state, age));
  }
  return { variants };
}

async function runOverloadRamp(cfg, owner, state, maxQueuedAgeMs) {
  const o = cfg.overload;
  const host = await startHost(
    owner,
    'network',
    { driverMs: o.driverMs, ...(maxQueuedAgeMs === null ? {} : { maxQueuedAgeMs }) },
    cfg.abort,
  );
  const sampler = sampleHost(host, cfg, state);
  const rng = seeded(cfg.seed);
  const steps = o.rampPerClient.map((rate, index) => ({
    index,
    ratePerClient: rate,
    sent: 0,
    results: 0,
    onTime: 0,
    latency: [],
    refused: {},
    hostBefore: null,
    hostAfter: null,
  }));
  let current = -1;
  const healthy = [];
  const unexpectedHealthyCloses = [];
  try {
    // Healthy clients: read every frame, send within the per-peer token bucket.
    for (let i = 0; i < o.healthyClients; i++) {
      const principal = i % 2 ? 'beta' : 'alpha';
      const socket = owner.socket(host.url),
        c = { socket, principal, n: 0, inflight: new Map(), authed: false, rate: 0, timer: null };
      socket.on('message', (data) => {
        const f = JSON.parse(data.toString());
        if (f.type === 'authenticated') c.authed = true;
        else if ((f.type === 'result' || f.type === 'refused') && c.inflight.has(f.id)) {
          const sent = c.inflight.get(f.id);
          c.inflight.delete(f.id);
          const step = steps[sent.step];
          if (f.type === 'result') {
            const ms = now() - sent.at;
            step.results++;
            step.latency.push(ms);
            if (ms <= o.onTimeMs) step.onTime++;
          } else bump(step.refused, f.reason);
        }
      });
      socket.once('close', (code, reason) => {
        if (!state.stopping) unexpectedHealthyCloses.push({ client: i, ...describeClose(code, reason.toString()) });
      });
      await opened(socket);
      socket.send(JSON.stringify({ v: 1, type: 'auth', token: host.credentials[principal] }));
      await waitFor(() => c.authed, 3000, 'healthy authentication');
      const tick = () => {
        if (state.stopping || state.abort || socket.readyState !== WebSocket.OPEN || current < 0) return;
        const id = `h${i}-${++c.n}`;
        c.inflight.set(id, { at: now(), step: current });
        steps[current].sent++;
        socket.send(JSON.stringify({ v: 1, type: 'command', id, target: principal, delta: 1 }));
        // Jittered period (seeded): 0.8x to 1.2x of 1000 / rate keeps every healthy peer inside its token bucket.
        c.timer = setTimeout(tick, (1000 / c.rate) * (0.8 + 0.4 * rng()));
      };
      c.start = () => {
        clearTimeout(c.timer);
        c.timer = setTimeout(tick, (1000 / c.rate) * rng());
      };
      healthy.push(c);
    }

    // A physical non-reader: authenticates, then stops reading its socket while still sending commands.
    const nonReader = { socket: owner.socket(host.url), authed: false, sent: 0, timer: null, backlogFrames: 0, backlogBytes: 0 };
    nonReader.socket.on('message', (data) => {
      const f = JSON.parse(data.toString());
      if (f.type === 'authenticated') {
        nonReader.authed = true;
        nonReader.socket.pause();
      } else {
        nonReader.backlogFrames++;
        nonReader.backlogBytes += data.length;
      }
    });
    if (o.nonReaderPerSecond > 0) {
      await opened(nonReader.socket);
      nonReader.socket.send(JSON.stringify({ v: 1, type: 'auth', token: host.credentials.beta }));
      await waitFor(() => nonReader.authed, 3000, 'non-reader authentication');
      nonReader.timer = setInterval(() => {
        if (state.stopping || nonReader.socket.readyState !== WebSocket.OPEN) return;
        nonReader.socket.send(
          JSON.stringify({ v: 1, type: 'command', id: `n-${++nonReader.sent}`, target: 'beta', delta: 1 }),
        );
      }, 1000 / o.nonReaderPerSecond);
    }

    const adversaries = [];
    async function adversaryRound(step) {
      const t = now();
      // Flooder: a valid principal that sends far above the per-peer token bucket.
      const flood = owner.socket(host.url);
      let floodAuthed = false,
        floodSent = 0;
      flood.on('message', (d) => {
        if (JSON.parse(d.toString()).type === 'authenticated') floodAuthed = true;
      });
      const floodClosed = closedWithin(flood, 4000);
      await opened(flood);
      flood.send(JSON.stringify({ v: 1, type: 'auth', token: host.credentials.alpha }));
      await waitFor(() => floodAuthed || flood.readyState !== WebSocket.OPEN, 3000, 'flooder authentication');
      // Wrong credential, held open until the over-bound connection has been attempted.
      const bad = owner.socket(host.url),
        badClosed = closedWithin(bad, 4000);
      await opened(bad);
      const excess = owner.socket(host.url),
        excessClosed = closedWithin(excess, 4000);
      const excessOpened = await opened(excess);
      const excessClose = await excessClosed;
      bad.send(JSON.stringify({ v: 1, type: 'auth', token: 'x'.repeat(43) }));
      const badClose = await badClosed;
      const floodStart = now();
      // Catch up on elapsed time so a starved probe timer still offers the configured flood rate.
      const floodTimer = setInterval(() => {
        const due = Math.floor(((now() - floodStart) / 1000) * o.flooderPerSecond) - floodSent;
        for (let k = 0; k < Math.min(due, 200) && flood.readyState === WebSocket.OPEN; k++)
          flood.send(JSON.stringify({ v: 1, type: 'command', id: `f-${++floodSent}`, target: 'alpha', delta: 1 }));
      }, 10);
      const floodClose = await floodClosed;
      clearInterval(floodTimer);
      for (const s of [flood, bad, excess]) s.terminate();
      const label = (close) => (close ? describeClose(close.code, close.reason) : { code: null, reason: 'not closed within 4 s', class: null });
      adversaries.push(
        { step, kind: 'flooder', sentBeforeClose: floodSent, closeAfterMs: round(now() - floodStart),
          achievedPerSecond: round(floodSent / Math.max(0.001, (now() - floodStart) / 1000)), ...label(floodClose) },
        { step, kind: 'wrong-credential', ...label(badClose) },
        { step, kind: 'over-connection-bound', transportOpened: excessOpened, ...label(excessClose) },
      );
      return now() - t;
    }

    const runStart = now();
    for (const step of steps) {
      if (state.abort) break;
      step.hostBefore = (await host.call('read')).host.metrics;
      current = step.index;
      step.startedAt = round(now() - runStart);
      for (const c of healthy) {
        c.rate = step.ratePerClient;
        c.start();
      }
      const adv = o.adversaries ? adversaryRound(step.index).catch((e) => ({ error: e.message })) : null;
      const end = now() + o.stepMs;
      while (now() < end && !state.abort) await delay(20);
      await adv;
      step.durationMs = round(now() - runStart - step.startedAt);
      step.hostAfter = (await host.call('read')).host.metrics;
    }
    current = -1;
    for (const c of healthy) clearTimeout(c.timer);
    clearInterval(nonReader.timer);
    await delay(o.drainMs);
    const final = await host.call('read');
    // Peek at the non-reader's peer-side backlog: resume reading and count what the kernel had absorbed.
    const nonReaderHostBuffered = Math.max(
      0,
      ...final.host.peers.filter((p) => p.principal === 'beta').map((p) => p.bufferedBytes),
    );
    nonReader.socket.resume();
    await delay(300);
    state.stopping = true;
    sampler.stop();

    const lost = healthy.reduce((n, c) => n + c.inflight.size, 0);
    const stepRows = steps.map((s) => {
      const secs = (s.durationMs ?? o.stepMs) / 1000;
      const dispatched = s.hostAfter && s.hostBefore ? s.hostAfter.dispatched - s.hostBefore.dispatched : null;
      return {
        step: s.index,
        ratePerHealthyClient: s.ratePerClient,
        offeredPerSecond: round(s.sent / secs),
        goodputPerSecond: round(s.results / secs),
        onTimeGoodputPerSecond: round(s.onTime / secs),
        sent: s.sent,
        results: s.results,
        refusedByReason: s.refused,
        admittedLatency: latencySummary(s.latency),
        hostDispatchedPerSecond: dispatched === null ? null : round(dispatched / secs),
        hostStaleShed: s.hostAfter && s.hostBefore ? s.hostAfter.stale - s.hostBefore.stale : null,
      };
    });
    const goodputs = stepRows.map((r) => r.goodputPerSecond);
    const capacityPerSecond = round((1000 / o.driverMs) * 4);
    // Time for the pump to drain a full global queue (32 messages) at its nominal attempt budget, and the
    // worst wait under fair per-peer rotation: a command 8th in its peer queue waits 8 rotations of every peer.
    const fullQueueDrainMs = round((32 / capacityPerSecond) * 1000);
    const peersWithQueues = o.healthyClients + (o.nonReaderPerSecond > 0 ? 1 : 0) + (o.adversaries ? 1 : 0);
    const fairRotationWaitBoundMs = round(((8 * peersWithQueues) / capacityPerSecond) * 1000);
    return {
      host: {
        kind: 'tools/network-workbench (child process)',
        driverMs: o.driverMs,
        dispatchCapacityPerSecond: capacityPerSecond,
        maxQueuedAgeMs,
        fullQueueDrainMs,
        fairRotationWaitBoundMs,
        note: 'Both wait bounds assume the nominal pump cadence; host event-loop lag lengthens real waits.',
        limits: {
          maxConnections: 8,
          perPeerQueue: '8 messages / 4096 bytes',
          globalQueue: '32 messages / 16384 bytes',
          perPeerFrameBucket: 'burst 32, 32/s',
          maxBufferedBytesPerPeer: 8192,
        },
      },
      steps: stepRows,
      adversaries,
      unexpectedHealthyCloses,
      healthyUnansweredAtEnd: lost,
      nonReader: {
        sentCommands: nonReader.sent,
        maxHostBufferedBytesAmongBetaPeersAtEnd: nonReaderHostBuffered,
        backlogFramesDeliveredOnResume: nonReader.backlogFrames,
        backlogBytesDeliveredOnResume: nonReader.backlogBytes,
        note:
          'Replies of about 80 bytes at this rate fit in loopback kernel buffers, so the host-side 8192-byte ' +
          'buffered cap is not reached within the run; the backlog is delivered once the peer reads again.',
      },
      highWater: {
        sampledEveryMs: 50,
        ...sampler.high,
        hostDispatched: final.host.metrics.dispatched,
        hostTransportRefusals: final.host.metrics.transportRefusals,
        hostClosed: final.host.metrics.closed,
        hostCloseReasons: final.host.closeReasons,
        hostRssBytes: final.process.high.rssBytes,
        hostHeapUsedBytes: final.process.high.heapUsedBytes,
        hostEventLoopLagMaxMs: round(final.process.high.eventLoopLagMs),
      },
      derived: {
        peakGoodputPerSecond: Math.max(...goodputs),
        finalGoodputPerSecond: goodputs.at(-1),
        plateauRatio: round(goodputs.at(-1) / Math.max(1e-9, Math.max(...goodputs)), 3),
      },
    };
  } finally {
    state.stopping = true;
    sampler.stop();
    for (const c of healthy) clearTimeout(c.timer);
    await host.close();
    state.stopping = false;
  }
}

// ---------- scenario 2: physical non-reader against the replication workbench ----------

async function runNonReader(cfg, owner, state) {
  const n = cfg.nonReader;
  const host = await startHost(owner, 'replication', { entityCount: n.entityCount }, cfg.abort);
  let attacker = null; // { session, lastOutstanding, maxBuffered, retiredAt }
  const sampler = sampleHost(host, cfg, state);
  const phases = { baseline: [], attack: [], after: [] };
  let phase = 'baseline';
  const changes = []; // { value, at }
  const healthy = [];
  const unexpectedHealthyCloses = [];
  let operatorTimer = null;
  try {
    for (let i = 0; i < n.healthyClients; i++) {
      const principal = i % 2 ? 'beta' : 'alpha';
      const socket = owner.socket(host.url),
        c = { socket, session: null, views: 0, viewsByPhase: { baseline: 0, attack: 0, after: 0 }, adopted: 0, maxBytes: 0 };
      socket.on('message', (data) => {
        const f = JSON.parse(data.toString());
        if (f.type === 'authenticated') c.session = f.session;
        else if (f.type === 'view') {
          c.views++;
          c.viewsByPhase[phase]++;
          c.maxBytes = Math.max(c.maxBytes, data.length);
          const value = f.entities.find((e) => e.id === 'entity-0')?.fields.value;
          // Adoption latency: from the operator change to the first view that carries it (or a later value).
          while (c.adopted < changes.length && changes[c.adopted].value <= value) {
            phases[changes[c.adopted].phase].push(now() - changes[c.adopted].at);
            c.adopted++;
          }
          socket.send(JSON.stringify({ v: 1, type: 'view-ack', session: c.session, sequence: f.sequence }));
        }
      });
      socket.once('close', (code, reason) => {
        if (!state.stopping) unexpectedHealthyCloses.push({ client: i, ...describeClose(code, reason.toString()) });
      });
      await opened(socket);
      socket.send(JSON.stringify({ v: 1, type: 'auth', token: host.credentials[principal] }));
      await waitFor(() => c.session, 3000, 'replication authentication');
      healthy.push(c);
    }
    let value = 1000;
    const operate = async () => {
      if (state.stopping || state.abort) return;
      value++;
      changes.push({ value, at: now(), phase });
      try {
        await host.call('changeWorld', { id: 'entity-0', value });
      } catch (error) {
        if (!state.stopping) state.abort = `operator change: ${error.message}`;
        return;
      }
      operatorTimer = setTimeout(operate, n.changeEveryMs);
    };
    operate();
    await delay(n.settleMs);

    // Adversarial non-reader: reads only its authentication frame, then pauses the socket and acknowledges
    // every outstanding view without reading it (sequence learned from the trusted operator read, which models
    // the worst case of a client that guesses sequences perfectly), so application credit never throttles it.
    phase = 'attack';
    const socket = owner.socket(host.url);
    attacker = { session: null, acks: 0, lastAcked: 0, lastSequence: 0, maxBuffered: 0, retiredAfterMs: null };
    socket.on('message', (data) => {
      const f = JSON.parse(data.toString());
      if (f.type === 'authenticated') {
        attacker.session = f.session;
        socket.pause();
      }
    });
    await opened(socket);
    socket.send(JSON.stringify({ v: 1, type: 'auth', token: host.credentials.alpha }));
    await waitFor(() => attacker.session, 3000, 'non-reader authentication');
    const attackStart = now();
    while (now() - attackStart < n.maxAttackMs && !state.abort) {
      const r = await host.call('sample');
      const peer = r.host.peers.find((p) => p.session === attacker.session);
      if (!peer) {
        attacker.retiredAfterMs = round(now() - attackStart);
        break;
      }
      attacker.maxBuffered = Math.max(attacker.maxBuffered, peer.bufferedBytes);
      attacker.lastSequence = peer.sequence ?? attacker.lastSequence;
      const o = peer.outstanding;
      // One acknowledgement per view, so the attacker stays inside the 256/s frame bucket: only the
      // buffered-send cap, not the rate bound, can retire it. Operator changes keep its view dirty.
      if (o && o.sequence > attacker.lastAcked && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ v: 1, type: 'view-ack', session: attacker.session, sequence: o.sequence }));
        attacker.lastAcked = o.sequence;
        attacker.acks++;
      }
      await delay(5);
    }
    attacker.clientSawClose = socket.readyState === WebSocket.CLOSED;
    socket.terminate();
    phase = 'after';
    await delay(n.settleMs);
    clearTimeout(operatorTimer);
    state.stopping = true;
    await delay(100);
    const final = await host.call('read');
    sampler.stop();
    const viewMaxBytes = Math.max(...healthy.map((c) => c.maxBytes));
    return {
      host: {
        kind: 'tools/replication-workbench (child process)',
        entityCount: n.entityCount,
        driverMs: 10,
        maxBufferedBytesPerPeer: 131072,
        perPeerFrameBucket: 'burst 256, 256/s',
        viewFrameBytes: viewMaxBytes,
      },
      operatorChangeEveryMs: n.changeEveryMs,
      nonReader: {
        model: 'reads its authentication frame, pauses the socket, acknowledges every outstanding view unread',
        retiredByHost: attacker.retiredAfterMs !== null,
        retiredAfterMs: attacker.retiredAfterMs,
        acknowledgementsSent: attacker.acks,
        viewsSentBeforeRetire: attacker.lastSequence,
        approxBytesAbsorbedByKernelBeforeRetire: attacker.lastSequence * viewMaxBytes,
        maxSampledHostBufferedBytes: attacker.maxBuffered,
        clientObservedClose: attacker.clientSawClose,
        note: 'A paused socket cannot observe the close until it reads; the host terminates the transport (no close frame).',
      },
      healthy: {
        clients: n.healthyClients,
        viewsByPhase: healthy.map((c) => c.viewsByPhase),
        adoptionLatency: {
          baseline: latencySummary(phases.baseline),
          duringAttack: latencySummary(phases.attack),
          afterRetire: latencySummary(phases.after),
        },
        adoptionRoundsP99: {
          baseline: phases.baseline.length ? Math.ceil(percentile(phases.baseline, 0.99) / 10) : null,
          duringAttack: phases.attack.length ? Math.ceil(percentile(phases.attack, 0.99) / 10) : null,
          afterRetire: phases.after.length ? Math.ceil(percentile(phases.after, 0.99) / 10) : null,
        },
        unexpectedCloses: unexpectedHealthyCloses,
      },
      highWater: {
        sampledEveryMs: 50,
        ...sampler.high,
        hostMaxBufferedBytesAtSend: final.host.metrics.maxBufferedBytes,
        hostMaxOutstanding: final.host.metrics.maxOutstanding,
        hostMaxOutstandingBytes: final.host.metrics.maxOutstandingBytes,
        hostClosed: final.host.metrics.closed,
        hostCloseReasons: final.host.closeReasons,
        hostRssBytes: final.process.high.rssBytes,
        hostHeapUsedBytes: final.process.high.heapUsedBytes,
        hostEventLoopLagMaxMs: round(final.process.high.eventLoopLagMs),
      },
    };
  } finally {
    state.stopping = true;
    clearTimeout(operatorTimer);
    sampler.stop();
    await host.close();
    state.stopping = false;
  }
}

// ---------- scenario 3: reconnect storm after a host restart ----------

async function runStormVariant(cfg, owner, state, variant, index) {
  const s = cfg.storm;
  let host = await startHost(owner, 'network', {}, cfg.abort);
  const port = host.port;
  const clients = [];
  const attempts = []; // relative to the host close
  const accepted = [];
  const closes = {};
  const outcomes = { reconnected: 0, exhausted: 0, 'budget-empty': 0, terminal: 0, unresolved: 0 };
  let t0 = 0,
    hostReadyAfterMs = null,
    driver = null,
    hostDown = true;
  try {
    const connectOnce = (c) => {
      const socket = owner.socket(host.url);
      c.socket = socket;
      c.authed = false;
      socket.on('open', () => {
        if (t0 && !hostDown) accepted.push(now() - t0);
        socket.send(JSON.stringify({ v: 1, type: 'auth', token: host.credentials[c.principal] }));
      });
      socket.on('message', (data) => {
        if (JSON.parse(data.toString()).type === 'authenticated') {
          c.authed = true;
          if (t0) {
            c.schedule.succeeded(now() - t0 + 1e6);
            c.reconnectedAt = now() - t0;
            c.state = 'connected';
          }
        }
      });
      socket.once('close', (code, reason) => {
        if (c.socket !== socket || state.stopping) return;
        const why = describeClose(code, reason.toString());
        if (t0) bump(closes, `${code}${why.reason ? ` ${why.reason}` : ''}`);
        if (!t0) return;
        if (why.class === 'terminal') {
          c.state = 'terminal';
          return;
        }
        const r = c.schedule.next(now() - t0 + 1e6);
        if (r.status === 'wait') c.state = 'waiting';
        else c.state = r.status;
      });
    };
    for (let i = 0; i < variant.clients; i++) {
      const random = variant.policy === 'jitter' ? seeded(cfg.seed * 1000 + index * 100 + i) : () => 0.9999;
      const c = { i, principal: i % 2 ? 'beta' : 'alpha', state: 'initial', schedule: createRetrySchedule({ limits: s.retry, random }) };
      clients.push(c);
      connectOnce(c);
    }
    hostDown = false;
    // Initial phase: up to the host's connection bound authenticate; the rest are refused (bounded), as in a full host.
    await delay(500);
    const initiallyConnected = clients.filter((c) => c.authed).length;
    for (const c of clients) if (!c.authed) c.socket.terminate();
    for (const c of clients) if (!c.authed) c.state = 'never-admitted';

    // Restart: close the host (terminates every socket), wait the downtime, start a fresh host on the same port.
    t0 = now();
    hostDown = true;
    // Every client wants a session after the restart; the ones the full host never admitted start an episode too.
    for (const c of clients)
      if (c.state === 'never-admitted') {
        const r = c.schedule.next(now() - t0 + 1e6);
        c.state = r.status === 'wait' ? 'waiting' : r.status;
      }
    const participants = clients;
    await host.close();
    driver = setInterval(() => {
      const t = now() - t0 + 1e6; // schedule time is any monotonic clock; offset keeps it positive
      for (const c of participants)
        if (c.state === 'waiting' && c.schedule.due(t)) {
          c.state = 'attempting';
          c.attempts = (c.attempts ?? 0) + 1;
          attempts.push(now() - t0);
          connectOnce(c);
        }
    }, 2);
    await delay(s.downtimeMs);
    host = await startHost(owner, 'network', { port }, cfg.abort);
    hostDown = false;
    hostReadyAfterMs = round(now() - t0);
    const end = t0 + s.observeMs;
    while (now() < end && !state.abort && participants.some((c) => c.state === 'waiting' || c.state === 'attempting'))
      await delay(20);
    clearInterval(driver);
    const final = await host.call('read');
    for (const c of participants) {
      if (c.state === 'connected') outcomes.reconnected++;
      else if (c.state in outcomes) outcomes[c.state]++;
      else outcomes.unresolved++;
    }
    const bins = {};
    for (const a of attempts) bump(bins, Math.floor(a / s.binMs) * s.binMs);
    const acceptedBins = {};
    for (const a of accepted) bump(acceptedBins, Math.floor(a / s.binMs) * s.binMs);
    const reconnect = participants.filter((c) => c.reconnectedAt !== undefined).map((c) => c.reconnectedAt);
    return {
      policy: variant.policy,
      randomPort: variant.policy === 'jitter' ? 'seeded mulberry32 stream per client' : 'constant 0.9999 (no jitter, same helper)',
      clients: variant.clients,
      hostConnectionBound: 8,
      initiallyConnected,
      configuredDowntimeMs: s.downtimeMs,
      hostReadyAfterMs,
      note: 'Attempts before the host is ready fail fast with ECONNREFUSED in the kernel; accepted opens are what the host sees.',
      attempts: attempts.length,
      attemptsPerBin: bins,
      peakAttemptsPerBin: Math.max(0, ...Object.values(bins)),
      acceptedTransportOpensPerBin: acceptedBins,
      peakAcceptedOpensPerBin: Math.max(0, ...Object.values(acceptedBins)),
      distinctAttemptBins: Object.keys(bins).length,
      closesDuringStorm: closes,
      outcomes,
      reconnectMs: {
        first: round(reconnect.length ? Math.min(...reconnect) : null),
        p50: round(percentile(reconnect, 0.5)),
        p95: round(percentile(reconnect, 0.95)),
        last: round(reconnect.length ? Math.max(...reconnect) : null),
      },
      maxAttemptsPerClient: Math.max(0, ...participants.map((c) => c.attempts ?? 0)),
      attemptBoundPerClient: s.retry.maxAttempts,
      attemptBoundNote: 'per episode; a client that reconnects and loses again starts a new episode, still within the budget',
      hostConnectionsAtEnd: final.host.intake.connections,
    };
  } finally {
    clearInterval(driver);
    state.stopping = true;
    for (const c of clients) c.socket?.terminate();
    for (const c of clients) c.schedule.dispose();
    await host.close();
    state.stopping = false;
  }
}

async function runStorm(cfg, owner, state) {
  const variants = [];
  for (const [i, v] of cfg.storm.variants.entries()) {
    if (state.abort) break;
    variants.push(await runStormVariant(cfg, owner, state, v, i));
  }
  return {
    host: 'tools/network-workbench (child process), restarted on the same loopback port',
    credentialNote:
      'The fixture host issues fresh credentials per lifetime; the trusted harness hands each client the ' +
      'current credential at attempt time (a credential refresh), so authentication is not the variable under test.',
    retry: cfg.storm.retry,
    binMs: cfg.storm.binMs,
    variants,
  };
}

// ---------- invariants ----------

export function invariants(report) {
  const rows = [];
  const check = (id, ok, detail) => rows.push({ id, ok: !!ok, detail });
  for (const o of report.scenarios.overload?.variants ?? []) {
    const id = `overload[age=${o.host.maxQueuedAgeMs ?? 'none'}]`;
    check(`${id}.healthy-never-closed`, o.unexpectedHealthyCloses.length === 0, `${o.unexpectedHealthyCloses.length} unexpected closes`);
    const floods = o.adversaries.filter((a) => a.kind === 'flooder');
    if (floods.length) {
      // The host's own retirement reason is authoritative; the client-visible close frame can be lost (below).
      check(`${id}.flooder-rate-limited`,
        floods.every((a) => a.code !== null) && (o.highWater.hostCloseReasons['rate-capacity'] ?? 0) === floods.length,
        `host rate-capacity closes ${o.highWater.hostCloseReasons['rate-capacity'] ?? 0}/${floods.length}; client saw ` +
          floods.map((a) => `${a.code} ${a.reason || '(no reason)'} after ${a.sentBeforeClose} frames at ${a.achievedPerSecond}/s`).join('; '));
      const lost = o.adversaries.filter((a) => a.code === 1006);
      if (lost.length)
        rows.push({ id: `${id}.close-frame-lost`, ok: null, finding: true,
          detail: `${lost.length} adversary close(s) arrived as 1006 without the host's code/reason (close then immediate terminate)` });
    }
    const plateau = `final/peak goodput = ${o.derived.plateauRatio}`;
    if (o.host.maxQueuedAgeMs !== null)
      // Finding, reported rather than asserted: an aged shed costs a pump attempt, so once the real queued wait
      // exceeds the age limit most attempts are spent shedding. See the network-overload guide (NW-07).
      rows.push({ id: `${id}.goodput-with-queue-age`, ok: null, finding: true,
        detail: `${plateau}; age ${o.host.maxQueuedAgeMs} ms vs full-queue drain ${o.host.fullQueueDrainMs} ms, fair-rotation bound ${o.host.fairRotationWaitBoundMs} ms` });
    else check(`${id}.goodput-plateaus`, o.derived.plateauRatio >= 0.8, plateau);
    check(`${id}.global-queue-bound`, o.highWater.queuedMessages <= 32 && o.highWater.queuedBytes <= 16384,
      `sampled high-water ${o.highWater.queuedMessages} messages / ${o.highWater.queuedBytes} bytes`);
    check(`${id}.buffered-bound`, o.highWater.peerBufferedBytes <= 8192, `sampled ${o.highWater.peerBufferedBytes} bytes`);
    check(`${id}.host-rss-below-abort`, o.highWater.hostRssBytes <= report.config.abort.rssMb * 1048576,
      `${Math.round(o.highWater.hostRssBytes / 1048576)} MiB`);
  }
  const n = report.scenarios.nonReader;
  if (n) {
    check('non-reader.retired-or-bounded', n.nonReader.retiredByHost || n.highWater.hostMaxBufferedBytesAtSend <= 131072,
      n.nonReader.retiredByHost ? `retired after ${n.nonReader.retiredAfterMs} ms (${JSON.stringify(n.highWater.hostCloseReasons)})` : 'not retired; buffered within bound');
    check('non-reader.buffered-bound', n.highWater.hostMaxBufferedBytesAtSend <= 131072, `${n.highWater.hostMaxBufferedBytesAtSend} bytes`);
    check('non-reader.healthy-never-closed', n.healthy.unexpectedCloses.length === 0, `${n.healthy.unexpectedCloses.length}`);
    check('non-reader.healthy-served-during-attack', n.healthy.viewsByPhase.every((v) => v.attack > 0),
      n.healthy.viewsByPhase.map((v) => v.attack).join(','));
    check('non-reader.one-credit-per-peer', n.highWater.hostMaxOutstanding <= n.healthy.clients + 1, `${n.highWater.hostMaxOutstanding}`);
  }
  const s = report.scenarios.storm;
  if (s)
    for (const v of s.variants)
      check(`storm.${v.policy}.${v.clients}.attempts-bounded`,
        v.maxAttemptsPerClient <= v.attemptBoundPerClient && v.attempts <= v.clients * v.attemptBoundPerClient,
        `${v.attempts} attempts, max ${v.maxAttemptsPerClient} per client`);
  if (n)
    check('non-reader.host-rss-below-abort', n.highWater.hostRssBytes <= report.config.abort.rssMb * 1048576,
      `${Math.round(n.highWater.hostRssBytes / 1048576)} MiB`);
  return rows;
}

// ---------- entry ----------

function environment() {
  const cpus = os.cpus();
  let commit = null,
    dirty = null;
  try {
    commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim() || null;
    dirty = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().length > 0;
  } catch {
    /* not a checkout */
  }
  let ws = null;
  try {
    ws = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'ws', 'package.json'), 'utf8')).version;
  } catch {
    /* absent */
  }
  return {
    node: process.version,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: `${cpus.length} x ${cpus[0]?.model ?? 'unknown'}`,
    totalMemoryMiB: Math.round(os.totalmem() / 1048576),
    loadAverageAtStart: os.loadavg().map((x) => round(x)),
    niceness: (() => {
      try {
        return os.getPriority();
      } catch {
        return null;
      }
    })(),
    ws,
    commit,
    dirtyTree: dirty,
    startedAt: new Date().toISOString(),
  };
}

/** Run the configured scenarios; always cleans up its own sockets and child processes. */
export async function runNetworkProbe(options = {}) {
  const cfg = resolveConfig(options);
  const owner = createOwner();
  const state = { abort: null, stopping: false };
  const started = now();
  const report = {
    probe: 'NW-07 network overload and goodput probe (study N4)',
    scope: SCOPE,
    environment: environment(),
    config: cfg,
    scenarios: {},
    aborted: null,
  };
  const guard = setTimeout(() => {
    state.abort = `total runtime cap ${CAPS.totalMs} ms`;
  }, CAPS.totalMs);
  try {
    if (cfg.scenarios.includes('overload') && !state.abort) report.scenarios.overload = await runOverload(cfg, owner, state);
    if (cfg.scenarios.includes('non-reader') && !state.abort) report.scenarios.nonReader = await runNonReader(cfg, owner, state);
    if (cfg.scenarios.includes('storm') && !state.abort) report.scenarios.storm = await runStorm(cfg, owner, state);
  } finally {
    clearTimeout(guard);
    await owner.cleanup();
  }
  report.aborted = state.abort;
  report.durationMs = round(now() - started);
  report.invariants = invariants(report);
  report.ownedResourcesAfterCleanup = { children: owner.children.size, sockets: owner.sockets.size, startedHostPids: owner.pids };
  return report;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out.out = argv[++i];
    else if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--scenario') out.scenarios = argv[++i].split(',');
    else if (a === '--config') out.config = JSON.parse(readFileSync(argv[++i], 'utf8'));
    else throw Error(`unknown argument ${a}`);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Low priority for this process and (by inheritance) the hosts it forks; only our own PID is changed.
  try {
    os.setPriority(Math.max(os.getPriority(), 15));
  } catch {
    /* not permitted on this platform */
  }
  const args = parseArgs(process.argv.slice(2));
  const report = await runNetworkProbe({ ...(args.config ?? {}), ...(args.seed !== undefined ? { seed: args.seed } : {}), ...(args.scenarios ? { scenarios: args.scenarios } : {}) });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, text);
  }
  process.stdout.write(args.out ? summarize(report) : text);
  process.exitCode = report.aborted || report.invariants.some((r) => r.ok === false) ? 1 : 0;
}

export function summarize(report) {
  const lines = [`${report.probe}`, `scope: ${report.scope.statement}`];
  for (const o of report.scenarios.overload?.variants ?? [])
    for (const s of o.steps)
      lines.push(
        `overload age=${o.host.maxQueuedAgeMs ?? 'none'} step ${s.step}: offered ${s.offeredPerSecond}/s goodput ${s.goodputPerSecond}/s on-time ${s.onTimeGoodputPerSecond}/s ` +
          `p50/p95/p99 ${s.admittedLatency.p50Ms}/${s.admittedLatency.p95Ms}/${s.admittedLatency.p99Ms} ms refused ${JSON.stringify(s.refusedByReason)}`,
      );
  const n = report.scenarios.nonReader;
  if (n) lines.push(`non-reader: retired=${n.nonReader.retiredByHost} after ${n.nonReader.retiredAfterMs} ms (${JSON.stringify(n.highWater.hostCloseReasons)}); host max buffered ${n.highWater.hostMaxBufferedBytesAtSend} B; healthy adoption p99 ${n.healthy.adoptionLatency.duringAttack.p99Ms} ms during attack`);
  for (const v of report.scenarios.storm?.variants ?? [])
    lines.push(`storm ${v.policy} x${v.clients}: ${v.attempts} attempts, peak ${v.peakAttemptsPerBin}/bin, accepted peak ${v.peakAcceptedOpensPerBin}/bin, ${JSON.stringify(v.outcomes)}`);
  for (const r of report.invariants) lines.push(`${r.finding ? 'NOTE' : r.ok ? 'ok  ' : 'FAIL'} ${r.id}: ${r.detail}`);
  lines.push(`aborted: ${report.aborted ?? 'no'} · ${Math.round(report.durationMs / 1000)} s`);
  return `${lines.join('\n')}\n`;
}
