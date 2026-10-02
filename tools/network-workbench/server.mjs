import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  createConnectionDrain,
  createIntegrity,
  createNetworkIntake,
  createRateAdmission,
  DRAIN_CLOSE_CODE,
  integrityRules,
} from '../../src/kits/network/index.ts';

export const hostLimits = Object.freeze({
  maxConnections: 8,
  maxPendingAuth: 2,
  maxPreAuthMessages: 2,
  authTimeoutMs: 1500,
  maxQueuedMessagesPerPeer: 8,
  maxQueuedBytesPerPeer: 4096,
  maxQueuedMessages: 32,
  maxQueuedBytes: 16384,
  maxPumpOperations: 4,
  message: { maxBytes: 1024, maxNodes: 32, maxDepth: 4 },
  principal: { maxBytes: 256, maxNodes: 8, maxDepth: 2 },
});
const MAX_BUFFERED = 8192,
  ACTIVE_IDLE_MS = 15000,
  MAX_FRAMES_PER_SECOND = 32;
/**
 * Optional command integrity example (SEC-01), off unless `integrity: true` / `--integrity`. Counter commands are
 * unsequenced (IDs only correlate replies), so `check` may refuse one without leaving a gap. One plausibility rule:
 * a counter may rise by at most 20 units per second of host time since its last authoritative change (host time is
 * the jitter-sensitive variant; a ticked game should pass tick differences instead). Each implausible command is
 * refused and scores 1 against the principal (not the connection, so reconnecting keeps the score). Three
 * violations within 5 s reaching a score of 2.5 close the connection with the terminal reason
 * `integrity-violation`. Scores decay by 0.5 per second. Example values for this diagnostic, not recommended limits.
 */
export const integrityExample = Object.freeze({
  perSecond: 20,
  closeScore: 2.5,
  closeViolations: 3,
  closeWithinMs: 5000,
  decayPerSecond: 0.5,
});
function createIntegrityExample() {
  return createIntegrity({
    rules: [
      integrityRules.maxRateOfChange({
        id: 'counter-rate',
        // Host milliseconds stand in for ticks here.
        perTick: integrityExample.perSecond / 1000,
        current: ({ state, command }) => state.counters[command.target],
        proposed: ({ state, command }) =>
          state.counters[command.target] + command.delta,
        elapsedTicks: ({ state, command }) =>
          state.changedAt[command.target] === null
            ? null
            : state.now - state.changedAt[command.target],
      }),
    ],
    limits: {
      // Keys are principals (two here); well above the connection bound so live keys are never evicted.
      maxKeys: 8 * hostLimits.maxConnections,
      maxHistoryPerKey: 8,
      maxAudit: 64,
    },
    decayPerSecond: integrityExample.decayPerSecond,
    config: 'network-workbench-v1',
    close: {
      score: integrityExample.closeScore,
      requires: {
        violations: integrityExample.closeViolations,
        withinMs: integrityExample.closeWithinMs,
      },
    },
  });
}
const stringify = (value) => JSON.stringify(value);
const exact = (value, keys) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((k) => Object.hasOwn(value, k));
const validId = (id) =>
  typeof id === 'string' &&
  id.length > 0 &&
  id.length <= 32 &&
  /^[a-zA-Z0-9_-]+$/.test(id);

/** Loopback-only ephemeral reference. Returned controls are trusted operator APIs, never HTTP endpoints. */
export async function startNetworkWorkbench({
  port = 0,
  autoDriver = true,
  driverMs = 10,
  drain: drainOptions,
  maxQueuedAgeMs,
  integrity: integrityEnabled = false,
} = {}) {
  if (
    (maxQueuedAgeMs !== undefined &&
      (!Number.isSafeInteger(maxQueuedAgeMs) ||
        maxQueuedAgeMs < 1 ||
        maxQueuedAgeMs > 60000)) ||
    !Number.isSafeInteger(port) ||
    port < 0 ||
    port > 65535 ||
    !Number.isSafeInteger(driverMs) ||
    driverMs < 1 ||
    driverMs > 1000
  )
    throw Error('host options');
  const credentials = Object.freeze({
    alpha: randomBytes(32).toString('base64url'),
    beta: randomBytes(32).toString('base64url'),
  });
  const tokens = new Map(
    Object.entries(credentials).map(([principal, token]) => [token, principal]),
  );
  const revoked = new Set(),
    blockedSends = new Set(),
    peers = new Map(),
    held = new Map();
  let hold = false,
    closed = false,
    timer;
  const counters = { alpha: 0, beta: 0 },
    // Host time of each counter's last authoritative change; read only by the optional integrity rule.
    changedAt = { alpha: null, beta: null },
    metrics = {
      receivedFrames: 0,
      dispatched: 0,
      refused: 0,
      closed: 0,
      driverRounds: 0,
      sentBytes: 0,
      transportRefusals: 0,
      drainNotices: 0,
      drainRefusals: 0,
      stale: 0,
    };
  // Retirement reasons by count (bounded: the intake reason set is closed).
  const closeReasons = {};
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port,
    path: '/socket',
    maxPayload: hostLimits.message.maxBytes,
    perMessageDeflate: false,
    clientTracking: true,
  });
  const now = () => performance.now();
  // Optional planned drain and capped lifetime (NW-08); absent unless the operator configures it.
  const drainPlan = drainOptions === undefined ? null : createConnectionDrain({
    limits: {
      maxKeys: hostLimits.maxConnections,
      maxNoticeMs: 60000,
      maxReconnectAfterMs: 60000,
      maxActionsPerPoll: 16,
      ...(drainOptions?.lifetime ? { lifetime: drainOptions.lifetime } : {}),
    },
    ...(drainOptions?.lifetime ? { random: drainOptions.random ?? Math.random } : {}),
  });
  const drainClose = (reason) => reason === 'drain' || reason === 'lifetime';
  // One bucket per live intake peer; the intake connection bound bounds the keys.
  const frameRate = createRateAdmission({
    maxKeys: hostLimits.maxConnections,
    capacity: MAX_FRAMES_PER_SECOND,
    refillPerSecond: MAX_FRAMES_PER_SECOND,
  });
  // Optional NW-06 queue age (off by default): aged commands are shed before authorize/dispatch.
  const limits =
    maxQueuedAgeMs === undefined
      ? hostLimits
      : { ...hostLimits, maxQueuedAgeMs };
  const integrity = integrityEnabled ? createIntegrityExample() : null;
  const intake = createNetworkIntake({
    limits,
    ports: {
      authenticate({ peer, credential, complete }) {
        const finish = () => {
          const principal = tokens.get(credential?.token);
          complete(
            principal && !revoked.has(principal)
              ? stringify({ id: principal, target: principal })
              : null,
          );
        };
        if (hold) held.set(peer, finish);
        else finish();
      },
      authorize({ peer, principal, command }) {
        const allowed =
          principal &&
          !revoked.has(principal.id) &&
          principal.target === command.target &&
          counters[command.target] + command.delta <= 100000;
        if (!allowed) {
          refuse(peer, 'unauthorized', command.id);
          return false;
        }
        if (!integrity) return true;
        // Evaluated against authoritative host state, after permission and before dispatch.
        const time = now();
        const decision = integrity.check(
          principal.id,
          { command, state: { counters, changedAt, now: time }, tick: null },
          time,
        );
        if (decision.action === 'allow') return true;
        if (decision.action === 'close') intake.close(peer, decision.reason);
        // Reject, throttle or owner refusal. Minimal disclosure: the client learns only that integrity refused.
        else refuse(peer, 'integrity', command.id);
        return false;
      },
      dispatch({ peer, command }) {
        counters[command.target] += command.delta;
        changedAt[command.target] = now();
        metrics.dispatched++;
        send(peer, {
          v: 1,
          type: 'result',
          id: command.id,
          target: command.target,
          value: counters[command.target],
          applied: true,
        });
      },
      ...(maxQueuedAgeMs === undefined
        ? {}
        : {
            stale({ peer, command }) {
              // Correlation only: authorization is not rechecked for this notice.
              metrics.stale++;
              refuse(peer, 'stale', command.id);
            },
          }),
      send: transportSend,
      close(peer, reason) {
        const state = peers.get(peer);
        held.delete(peer);
        if (!state) return;
        peers.delete(peer);
        frameRate.forget(peer);
        drainPlan?.forget(peer);
        metrics.closed++;
        closeReasons[reason] = (closeReasons[reason] ?? 0) + 1;
        state.socket.removeListener('message', state.message);
        if (state.socket.readyState === WebSocket.OPEN)
          state.socket.close(
            drainClose(reason)
              ? DRAIN_CLOSE_CODE
              : reason.includes('capacity') || reason.includes('queue')
                ? 1013
                : 1008,
            String(reason).slice(0, 100),
          );
        // A closed owner must not retain a slow peer waiting indefinitely for the close handshake.
        state.socket.terminate();
      },
    },
  });
  function transportSend(peer, json) {
    const state = peers.get(peer),
      bytes = Buffer.byteLength(json);
    if (
      !state ||
      blockedSends.has(intake.read(peer)?.principal?.id) ||
      state.socket.readyState !== WebSocket.OPEN ||
      state.socket.bufferedAmount + bytes > MAX_BUFFERED
    ) {
      metrics.transportRefusals++;
      return false;
    }
    try {
      state.socket.send(json, (error) => {
        if (error) intake.close(peer, 'send-failed');
      });
      metrics.sentBytes += bytes;
      return true;
    } catch {
      metrics.transportRefusals++;
      return false;
    }
  }
  function send(peer, value) {
    const result = intake.send(peer, stringify(value));
    if (result.status === 'refused') intake.close(peer, 'send-refused');
    return result;
  }
  function refuse(peer, reason, id) {
    metrics.refused++;
    const value = {
      v: 1,
      type: 'refused',
      reason,
      ...(validId(id) ? { id } : {}),
    };
    if (intake.read(peer)?.state === 'active') return send(peer, value);
    const json = stringify(value);
    if (
      Buffer.byteLength(json) > hostLimits.message.maxBytes ||
      !transportSend(peer, json)
    )
      intake.close(peer, 'send-refused');
    return { status: 'refused', reason };
  }
  function notify(peer, value) {
    if (intake.read(peer)?.state === 'active') return send(peer, value);
    if (!transportSend(peer, stringify(value))) intake.close(peer, 'send-refused');
  }
  function announce(peer) {
    const state = peers.get(peer),
      snapshot = intake.read(peer);
    if (state && !state.announced && snapshot?.state === 'active') {
      state.announced = true;
      send(peer, {
        v: 1,
        type: 'authenticated',
        principal: snapshot.principal.id,
      });
    }
  }
  function pump() {
    if (closed) return;
    metrics.driverRounds++;
    const time = now();
    for (const [peer, state] of peers) {
      if (time - state.lastFrame >= ACTIVE_IDLE_MS)
        intake.close(peer, 'idle-timeout');
    }
    intake.pump(time);
    for (const peer of peers.keys()) announce(peer);
    // Notices and closes follow the queued work served above; admitted commands are never revoked.
    for (const step of drainPlan?.poll(time) ?? []) {
      if (step.action === 'close') intake.close(step.key, step.cause === 'lifetime' ? 'lifetime' : 'drain');
      else if (peers.has(step.key)) {
        metrics.drainNotices++;
        notify(step.key, { v: 1, type: 'drain', ...step.notice });
      }
    }
  }
  wss.on('connection', (socket) => {
    socket.on('error', () => {});
    const result = intake.open(now());
    if (result.status !== 'opened') {
      socket.close(1013, 'connection-capacity');
      socket.terminate();
      return;
    }
    const peer = result.peer;
    const tracked = drainPlan?.track(peer, now());
    if (tracked && tracked.status !== 'tracked') {
      // Draining is planned (1012, transient); anything else is capacity (1013).
      if (tracked.reason === 'draining') socket.close(DRAIN_CLOSE_CODE, 'drain');
      else socket.close(1013, 'connection-capacity');
      socket.terminate();
      intake.close(peer, tracked.reason === 'draining' ? 'drain' : 'connection-capacity');
      return;
    }
    const state = {
        socket,
        announced: false,
        lastFrame: now(),
        preAuthFrames: 0,
        message: null,
      };
    peers.set(peer, state);
    state.message = (data, binary) => {
      if (closed || !peers.has(peer)) return;
      metrics.receivedFrames++;
      const time = now();
      state.lastFrame = time;
      // Token bucket: a burst of at most MAX_FRAMES_PER_SECOND, refilled at that rate (NW-05).
      if (frameRate.admit(peer, time).status !== 'admitted') {
        intake.close(peer, 'rate-capacity');
        return;
      }
      if (binary || data.length > hostLimits.message.maxBytes) {
        intake.close(peer, 'invalid-frame');
        return;
      }
      const before = intake.read(peer);
      if (
        before?.state !== 'active' &&
        ++state.preAuthFrames > hostLimits.maxPreAuthMessages
      ) {
        intake.close(peer, 'preauth-capacity');
        return;
      }
      let frame;
      try {
        frame = JSON.parse(data.toString('utf8'));
      } catch {
        refuse(peer, 'malformed');
        intake.close(peer, 'malformed');
        return;
      }
      if (frame?.v !== 1) {
        refuse(peer, 'version', frame?.id);
        return;
      }
      if (
        frame.type === 'auth' &&
        exact(frame, ['v', 'type', 'token']) &&
        typeof frame.token === 'string' &&
        frame.token.length <= 128
      ) {
        const outcome = intake.authenticate(
          peer,
          stringify({ token: frame.token }),
          time,
        );
        if (outcome.status === 'refused') refuse(peer, outcome.reason);
        announce(peer);
        return;
      }
      if (
        frame.type === 'command' &&
        exact(frame, ['v', 'type', 'id', 'target', 'delta']) &&
        validId(frame.id) &&
        ['alpha', 'beta'].includes(frame.target) &&
        Number.isSafeInteger(frame.delta) &&
        frame.delta >= 1 &&
        frame.delta <= 5
      ) {
        if (drainPlan && !drainPlan.admits(peer)) {
          // After a drain notice no new work is admitted; already queued work still runs.
          metrics.drainRefusals++;
          refuse(peer, 'draining', frame.id);
          return;
        }
        const outcome = intake.receive(
          peer,
          stringify({ id: frame.id, target: frame.target, delta: frame.delta }),
          time,
        );
        if (outcome.status === 'refused')
          refuse(peer, outcome.reason, frame.id);
        return;
      }
      refuse(peer, 'schema', frame?.id);
    };
    socket.on('message', state.message);
    socket.on('error', () => intake.close(peer, 'transport-error'));
    socket.on('close', () => intake.close(peer, 'transport-closed'));
  });
  await new Promise((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });
  if (autoDriver) timer = setInterval(pump, driverMs);
  let closePromise;
  const controls = {
    url: `ws://127.0.0.1:${wss.address().port}/socket`,
    credentials,
    read() {
      return {
        ephemeral: true,
        maxQueuedAgeMs: maxQueuedAgeMs ?? null,
        counters: { ...counters },
        metrics: { ...metrics },
        closeReasons: { ...closeReasons },
        intake: intake.stats(),
        peers: [...peers].map(([peer, state]) => ({
          state: intake.read(peer)?.state,
          principal: intake.read(peer)?.principal?.id ?? null,
          bufferedBytes: state.socket.bufferedAmount,
        })),
        heldAuthentication: held.size,
        drain: drainPlan?.read() ?? null,
        integrity: integrity
          ? {
              stats: integrity.stats(),
              audit: integrity.audit(),
              export: integrity.exportAudit(),
            }
          : null,
      };
    },
    pump,
    blockSends(principal, value) {
      if (!['alpha', 'beta'].includes(principal)) throw Error('principal');
      if (value === true) blockedSends.add(principal);
      else blockedSends.delete(principal);
    },
    /** Operator drain (NW-08): notify every peer, refuse new connections, close at the notice deadline. */
    drain(request) {
      if (!drainPlan) throw Error('drain-disabled');
      const result = drainPlan.drain(now(), request);
      if (result.status !== 'draining') throw Error('drain-' + result.reason);
      pump();
      return result;
    },
    /** End an operator drain: new connections are admitted again (the reference "host return"). */
    resume() {
      if (!drainPlan) throw Error('drain-disabled');
      return drainPlan.resume();
    },
    holdAuthentication(value) {
      hold = value === true;
    },
    captureAuthentication() {
      return [...held.values()];
    },
    releaseAuthentication() {
      const callbacks = [...held.values()];
      held.clear();
      for (const finish of callbacks) finish();
      for (const peer of peers.keys()) announce(peer);
    },
    revoke(principal) {
      if (!['alpha', 'beta'].includes(principal)) throw Error('principal');
      revoked.add(principal);
      for (const [peer] of peers)
        if (intake.read(peer)?.principal?.id === principal) intake.revoke(peer);
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      clearInterval(timer);
      intake.dispose();
      frameRate.dispose();
      drainPlan?.dispose();
      integrity?.dispose();
      held.clear();
      for (const socket of wss.clients) socket.terminate();
      closePromise = new Promise((resolve) => wss.close(resolve));
      return closePromise;
    },
  };
  return controls;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // `--drain` opts in to operator drain; `--drain=<lifetime JSON>` also caps connection lifetime (NW-08).
  // `--integrity` opts in to the command integrity example (SEC-01).
  const drainArg = process.argv.slice(2).find((arg) => arg === '--drain' || arg.startsWith('--drain='));
  const host = await startNetworkWorkbench({
    ...(drainArg === undefined
      ? {}
      : { drain: drainArg === '--drain' ? {} : { lifetime: JSON.parse(drainArg.slice('--drain='.length)) } }),
    integrity: process.argv.includes('--integrity'),
  });
  if (process.send)
    process.send({
      type: 'ready',
      url: host.url,
      credentials: host.credentials,
    });
  else
    process.stdout.write(
      `${JSON.stringify({ type: 'ready', url: host.url, credentials: host.credentials })}\n`,
    );
  process.on('message', async (request) => {
    if (!request || !validId(request.id)) return;
    try {
      let value;
      if (request.method === 'read') value = host.read();
      else if (request.method === 'pump') {
        host.pump();
        value = host.read();
      } else if (request.method === 'revoke') {
        host.revoke(request.principal);
        value = host.read();
      } else if (request.method === 'blockSends') {
        host.blockSends(request.principal, request.value);
        value = host.read();
      } else if (request.method === 'drain') {
        host.drain({ noticeMs: request.noticeMs, reconnectAfterMs: request.reconnectAfterMs });
        value = host.read();
      } else if (request.method === 'resume') {
        host.resume();
        value = host.read();
      } else if (request.method === 'holdAuthentication') {
        host.holdAuthentication(request.value);
        value = host.read();
      } else if (request.method === 'releaseAuthentication') {
        host.releaseAuthentication();
        value = host.read();
      } else if (request.method === 'close') {
        await host.close();
        value = { closed: true };
      } else throw Error('operator-method');
      process.send?.({ type: 'reply', id: request.id, value });
      if (request.method === 'close') process.disconnect?.();
    } catch (error) {
      process.send?.({ type: 'reply', id: request.id, error: error.message });
    }
  });
  process.once('SIGTERM', async () => {
    await host.close();
    process.exit(0);
  });
  process.once('disconnect', () => {
    void host.close();
  });
}
