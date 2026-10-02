import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  createNetworkIntake,
  createRateAdmission,
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
} = {}) {
  if (
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
    metrics = {
      receivedFrames: 0,
      dispatched: 0,
      refused: 0,
      closed: 0,
      driverRounds: 0,
      sentBytes: 0,
      transportRefusals: 0,
    };
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port,
    path: '/socket',
    maxPayload: hostLimits.message.maxBytes,
    perMessageDeflate: false,
    clientTracking: true,
  });
  const now = () => performance.now();
  // One bucket per live intake peer; the intake connection bound bounds the keys.
  const frameRate = createRateAdmission({
    maxKeys: hostLimits.maxConnections,
    capacity: MAX_FRAMES_PER_SECOND,
    refillPerSecond: MAX_FRAMES_PER_SECOND,
  });
  const intake = createNetworkIntake({
    limits: hostLimits,
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
        if (!allowed) refuse(peer, 'unauthorized', command.id);
        return !!allowed;
      },
      dispatch({ peer, command }) {
        counters[command.target] += command.delta;
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
      send: transportSend,
      close(peer, reason) {
        const state = peers.get(peer);
        held.delete(peer);
        if (!state) return;
        peers.delete(peer);
        frameRate.forget(peer);
        metrics.closed++;
        state.socket.removeListener('message', state.message);
        if (state.socket.readyState === WebSocket.OPEN)
          state.socket.close(
            reason.includes('capacity') || reason.includes('queue')
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
  }
  wss.on('connection', (socket) => {
    socket.on('error', () => {});
    const result = intake.open(now());
    if (result.status !== 'opened') {
      socket.close(1013, 'connection-capacity');
      socket.terminate();
      return;
    }
    const peer = result.peer,
      state = {
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
        counters: { ...counters },
        metrics: { ...metrics },
        intake: intake.stats(),
        peers: [...peers].map(([peer, state]) => ({
          state: intake.read(peer)?.state,
          principal: intake.read(peer)?.principal?.id ?? null,
          bufferedBytes: state.socket.bufferedAmount,
        })),
        heldAuthentication: held.size,
      };
    },
    pump,
    blockSends(principal, value) {
      if (!['alpha', 'beta'].includes(principal)) throw Error('principal');
      if (value === true) blockedSends.add(principal);
      else blockedSends.delete(principal);
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
  const host = await startNetworkWorkbench();
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
