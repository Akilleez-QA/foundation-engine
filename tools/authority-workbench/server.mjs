import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, WebSocket } from 'ws';
import { createNetworkIntake } from '../../src/kits/network/intake.ts';
import {
  createDurableAuthority,
  createAuthorityGenesis,
} from '../../src/kits/network/authority.ts';
import {
  initializeAuthorityStorage,
  openAuthorityStorage,
} from './storage.mjs';

const exact = (x, keys) =>
  x !== null &&
  typeof x === 'object' &&
  !Array.isArray(x) &&
  Object.keys(x).length === keys.length &&
  keys.every((k) => Object.hasOwn(x, k));
const integer = Number.isSafeInteger;
const json = { maxBytes: 65536, maxNodes: 4096, maxDepth: 12 };
export const authorityLimits = Object.freeze({
  envelope: json,
  state: { maxBytes: 64, maxNodes: 1, maxDepth: 1 },
  input: { maxBytes: 128, maxNodes: 4, maxDepth: 2 },
  result: { maxBytes: 128, maxNodes: 4, maxDepth: 2 },
  maxStreams: 3,
  maxReceiptsPerStream: 4,
});
const intakeLimits = {
  maxConnections: 8,
  maxPendingAuth: 8,
  maxPreAuthMessages: 2,
  authTimeoutMs: 1500,
  maxQueuedMessagesPerPeer: 1,
  maxQueuedBytesPerPeer: 1024,
  maxQueuedMessages: 8,
  maxQueuedBytes: 8192,
  maxPumpOperations: 8,
  message: { maxBytes: 1024, maxNodes: 16, maxDepth: 3 },
  principal: { maxBytes: 128, maxNodes: 4, maxDepth: 2 },
};
const schema = 'numeric-total-v1';
const random = () => randomBytes(24).toString('base64url');
/** Explicit operator creation. Starting the service never manufactures a missing checkpoint. */
export async function initializeAuthorityWorkbench({ directory }) {
  await mkdir(directory, { recursive: true });
  const identity = {
    version: 1,
    lineage: random(),
    schema,
    credentials: { a: random(), b: random() },
  };
  await writeFile(
    join(directory, 'principals.json'),
    JSON.stringify(identity),
    { flag: 'wx', mode: 0o600 },
  );
  await initializeAuthorityStorage({
    path: join(directory, 'world.db'),
    initialJson: createAuthorityGenesis({
      lineage: identity.lineage,
      schema,
      stateJson: '0',
      limits: authorityLimits,
      validateState: integer,
    }),
    limits: json,
  });
}
export async function startAuthorityWorkbench({
  directory = process.env.AUTHORITY_WORKBENCH_DIRECTORY,
  port = 0,
  autoDriver = true,
  driverMs = 10,
} = {}) {
  if (
    typeof directory !== 'string' ||
    !integer(port) ||
    port < 0 ||
    port > 65535 ||
    !integer(driverMs) ||
    driverMs < 1 ||
    driverMs > 1000
  )
    throw Error('host-options');
  const raw = await readFile(join(directory, 'principals.json'), 'utf8');
  if (Buffer.byteLength(raw) > 2048) throw Error('operator-identity');
  const identity = JSON.parse(raw);
  if (
    !exact(identity, ['version', 'lineage', 'schema', 'credentials']) ||
    identity.version !== 1 ||
    identity.schema !== schema ||
    typeof identity.lineage !== 'string' ||
    !exact(identity.credentials, ['a', 'b']) ||
    Object.values(identity.credentials).some(
      (t) => typeof t !== 'string' || t.length !== 32,
    ) ||
    identity.credentials.a === identity.credentials.b
  )
    throw Error('operator-identity');
  const db = await openAuthorityStorage({
    path: join(directory, 'world.db'),
    limits: json,
  });
  const peers = new Map(),
    controllers = new Map(),
    revoked = new Set(),
    held = new Set();
  let closed = false,
    timer,
    closing,
    heldCommit = false,
    releaseCommit = null,
    inFlight = null,
    operator = false;
  const metrics = { commits: 0, commands: 0, sent: 0, refused: 0 };
  const storage = {
    settle: () => db.settle(),
    read: () => db.read(),
    async compareAndSwap(request) {
      const result = await db.compareAndSwap(request);
      if (result === 'committed') {
        metrics.commits++;
        if (heldCommit)
          await new Promise((resolve) => {
            releaseCommit = resolve;
          });
      }
      return result;
    },
  };
  const current = (s) =>
    !closed &&
    peers.get(s.peer) === s &&
    controllers.get(s.principal) === s &&
    !revoked.has(s.principal) &&
    s.socket.readyState === WebSocket.OPEN;
  const owner = createDurableAuthority({
    lineage: identity.lineage,
    schema,
    limits: authorityLimits,
    storage,
    validateState: integer,
    validateInput: (x) =>
      exact(x, ['add']) && integer(x.add) && x.add >= -10 && x.add <= 10,
    validateResult: (x) => exact(x, ['value']) && integer(x.value),
    authorize: ({ stream }) =>
      stream === 'operator'
        ? operator
        : !!inFlight && inFlight.principal === stream && current(inFlight),
    reduce: ({ state, input }) => {
      const value = state + input.add;
      if (!integer(value)) throw Error('total-overflow');
      return {
        stateJson: JSON.stringify(value),
        resultJson: JSON.stringify({ value }),
      };
    },
  });
  const recovered = await owner.recover();
  if (recovered.status !== 'recovered') {
    db.close();
    throw Error(`checkpoint-${recovered.status}`);
  }
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port,
    path: '/socket',
    maxPayload: 1024,
    perMessageDeflate: false,
  });
  function send(s, frame) {
    if (!current(s)) return false;
    const raw = JSON.stringify(frame);
    if (
      Buffer.byteLength(raw) > 4096 ||
      s.socket.bufferedAmount + Buffer.byteLength(raw) > 16384
    ) {
      intake.close(s.peer, 'outgoing-capacity');
      return false;
    }
    s.socket.send(raw, (error) => {
      if (error) intake.close(s.peer, 'send-failed');
    });
    metrics.sent++;
    return true;
  }
  function baseline(s) {
    const snapshot = owner.read().snapshot;
    if (!snapshot || !current(s)) return null;
    const e = snapshot.envelope;
    return {
      v: 1,
      type: 'baseline',
      session: s.session,
      epoch: s.epoch,
      revision: e.revision,
      processedThrough:
        e.streams.find((x) => x.id === s.principal)?.through ?? 0,
      stateJson: JSON.stringify(e.state),
    };
  }
  function publish(s) {
    if (held.has(s.principal)) {
      s.dirty = true;
      return;
    }
    const frame = baseline(s);
    if (frame && send(s, frame)) s.dirty = false;
  }
  function publishAll() {
    for (const s of controllers.values()) publish(s);
  }
  async function command(s, c) {
    if (inFlight || operator || owner.read().status !== 'ready') {
      send(s, {
        v: 1,
        type: 'result',
        session: s.session,
        epoch: s.epoch,
        sequence: c.sequence,
        status: 'busy',
      });
      return;
    }
    inFlight = s;
    metrics.commands++;
    try {
      const out = await owner.submit({
        stream: s.principal,
        sequence: c.sequence,
        inputJson: c.inputJson,
      });
      if (current(s) && !held.has(s.principal))
        send(s, {
          v: 1,
          type: 'result',
          session: s.session,
          epoch: s.epoch,
          sequence: c.sequence,
          status: out.status,
          ...('revision' in out ? { revision: out.revision } : {}),
          ...('result' in out
            ? { resultJson: JSON.stringify(out.result) }
            : {}),
        });
      publishAll();
    } finally {
      inFlight = null;
    }
  }
  const intake = createNetworkIntake({
    limits: intakeLimits,
    ports: {
      authenticate({ credential, complete }) {
        const p = Object.entries(identity.credentials).find(
          ([, token]) => token === credential?.token,
        )?.[0];
        complete(p && !revoked.has(p) ? JSON.stringify({ id: p }) : null);
      },
      authorize({ peer, principal, command: c }) {
        const s = peers.get(peer);
        return (
          !!s &&
          s.principal === principal.id &&
          current(s) &&
          c.session === s.session &&
          c.epoch === s.epoch
        );
      },
      dispatch({ peer, command: c }) {
        const s = peers.get(peer);
        if (s)
          void command(s, c).catch(() => intake.close(peer, 'command-error'));
      },
      send() {
        return false;
      },
      close(peer) {
        const s = peers.get(peer);
        if (!s) return;
        peers.delete(peer);
        if (controllers.get(s.principal) === s) controllers.delete(s.principal);
        s.socket.removeListener('message', s.message);
        s.socket.terminate();
      },
    },
  });
  function announce(s) {
    if (s.session) return;
    const state = intake.read(s.peer);
    if (state?.state !== 'active') return;
    s.principal = state.principal.id;
    const previous = controllers.get(s.principal);
    if (previous) intake.close(previous.peer, 'controller-replaced');
    s.session = random();
    s.epoch = random();
    controllers.set(s.principal, s);
    send(s, {
      v: 1,
      type: 'authenticated',
      principal: s.principal,
      session: s.session,
      epoch: s.epoch,
    });
    publish(s);
  }
  function pump() {
    if (closed) return;
    const now = performance.now();
    for (const s of peers.values())
      if (now - s.lastFrame > 15000) intake.close(s.peer, 'idle');
    intake.pump(now);
    for (const s of peers.values()) {
      announce(s);
      if (s.dirty && !held.has(s.principal)) publish(s);
    }
  }
  wss.on('connection', (socket) => {
    const admission = intake.open(performance.now());
    if (admission.status !== 'opened') {
      socket.terminate();
      return;
    }
    const s = {
      peer: admission.peer,
      socket,
      principal: null,
      session: null,
      epoch: null,
      lastFrame: performance.now(),
      window: performance.now(),
      count: 0,
      dirty: false,
    };
    peers.set(s.peer, s);
    s.message = (bytes, binary) => {
      const now = performance.now();
      if (now - s.window >= 1000) {
        s.window = now;
        s.count = 0;
      }
      if (binary || bytes.length > 1024 || ++s.count > 128) {
        intake.close(s.peer, 'frame-limit');
        return;
      }
      s.lastFrame = now;
      let c;
      try {
        c = JSON.parse(bytes.toString());
      } catch {
        intake.close(s.peer, 'frame');
        return;
      }
      if (
        exact(c, ['v', 'type', 'token']) &&
        c.v === 1 &&
        c.type === 'auth' &&
        typeof c.token === 'string' &&
        c.token.length <= 64
      ) {
        intake.authenticate(s.peer, JSON.stringify({ token: c.token }), now);
        announce(s);
        return;
      }
      if (
        !exact(c, ['v', 'type', 'session', 'epoch', 'sequence', 'inputJson']) ||
        c.v !== 1 ||
        c.type !== 'command' ||
        typeof c.session !== 'string' ||
        c.session.length > 64 ||
        typeof c.epoch !== 'string' ||
        c.epoch.length > 64 ||
        !integer(c.sequence) ||
        c.sequence < 1 ||
        typeof c.inputJson !== 'string' ||
        Buffer.byteLength(c.inputJson) > 128
      ) {
        intake.close(s.peer, 'command-shape');
        return;
      }
      if (intake.receive(s.peer, JSON.stringify(c), now).status !== 'queued') {
        metrics.refused++;
        send(s, {
          v: 1,
          type: 'result',
          session: s.session,
          epoch: s.epoch,
          sequence: c.sequence,
          status: 'busy',
        });
      }
    };
    socket.on('message', s.message);
    socket.on('close', () => intake.close(s.peer, 'socket-closed'));
    socket.on('error', () => intake.close(s.peer, 'socket-error'));
  });
  await new Promise((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });
  if (autoDriver) timer = setInterval(pump, driverMs);
  const api = {
    url: `ws://127.0.0.1:${wss.address().port}/socket`,
    credentials: Object.freeze({ ...identity.credentials }),
    pump,
    read() {
      const state = owner.read();
      return {
        status: state.status,
        checkpoint: state.snapshot?.envelope ?? null,
        lastConfirmed: state.lastConfirmed?.envelope ?? null,
        metrics: { ...metrics },
        commitResponseHeld: releaseCommit !== null,
        peers: [...controllers.values()].map((s) => ({
          principal: s.principal,
          session: s.session,
          epoch: s.epoch,
          dirty: s.dirty,
        })),
      };
    },
    revoke(principal) {
      if (!['a', 'b'].includes(principal)) throw Error('principal');
      revoked.add(principal);
      const s = controllers.get(principal);
      if (s) intake.revoke(s.peer);
    },
    holdCommitResponse(enabled = true) {
      heldCommit = enabled;
    },
    releaseCommitResponse() {
      heldCommit = false;
      const release = releaseCommit;
      releaseCommit = null;
      release?.();
    },
    holdDisclosure({ principal, enabled = true }) {
      if (!['a', 'b'].includes(principal)) throw Error('principal');
      if (enabled) held.add(principal);
      else {
        held.delete(principal);
        const s = controllers.get(principal);
        if (s) publish(s);
      }
    },
    releaseDisclosure(principal) {
      api.holdDisclosure({ principal, enabled: false });
    },
    captureBaseline(principal) {
      const s = controllers.get(principal);
      return s ? baseline(s) : null;
    },
    deliverBaseline({ principal, baseline: frame }) {
      const s = controllers.get(principal);
      if (
        !s ||
        !exact(frame, [
          'v',
          'type',
          'session',
          'epoch',
          'revision',
          'processedThrough',
          'stateJson',
        ]) ||
        frame.type !== 'baseline' ||
        frame.v !== 1 ||
        frame.session !== s.session ||
        frame.epoch !== s.epoch ||
        !integer(frame.revision) ||
        !integer(frame.processedThrough) ||
        typeof frame.stateJson !== 'string' ||
        frame.stateJson.length > 64
      )
        return false;
      return send(s, frame);
    },
    async operatorAdd({ add }) {
      if (operator || inFlight || owner.read().status !== 'ready')
        return { status: 'busy' };
      operator = true;
      try {
        const e = owner.read().snapshot.envelope;
        const sequence =
          (e.streams.find((x) => x.id === 'operator')?.through ?? 0) + 1;
        const out = await owner.submit({
          stream: 'operator',
          sequence,
          inputJson: JSON.stringify({ add }),
        });
        publishAll();
        return out;
      } finally {
        operator = false;
      }
    },
    async close() {
      if (closing) return closing;
      closed = true;
      clearInterval(timer);
      owner.dispose();
      intake.dispose();
      api.releaseCommitResponse();
      closing = new Promise((resolve) => wss.close(resolve)).then(() =>
        db.close(),
      );
      return closing;
    },
  };
  return Object.freeze(api);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const host = await startAuthorityWorkbench();
  process.send?.({
    type: 'ready',
    url: host.url,
    credentials: host.credentials,
  });
  process.on('message', async (request) => {
    const { id, method } = request ?? {};
    try {
      let value;
      switch (method) {
        case 'read':
          value = host.read();
          break;
        case 'pump':
          value = host.pump();
          break;
        case 'revoke':
          value = host.revoke(request.principal);
          break;
        case 'operatorAdd':
          value = await host.operatorAdd(
            request.payload ?? { add: request.add },
          );
          break;
        case 'holdCommitResponse':
          value = host.holdCommitResponse(request.enabled);
          break;
        case 'releaseCommitResponse':
          value = host.releaseCommitResponse();
          break;
        case 'holdDisclosure':
          value = host.holdDisclosure(request.payload ?? request);
          break;
        case 'releaseDisclosure':
          value = host.releaseDisclosure(request.principal);
          break;
        case 'captureBaseline':
          value = host.captureBaseline(request.principal);
          break;
        case 'deliverBaseline':
          value = host.deliverBaseline(request.payload ?? request);
          break;
        case 'close':
          await host.close();
          process.send?.({ type: 'reply', id, value: true }, () =>
            process.disconnect(),
          );
          return;
        default:
          throw Error('control');
      }
      process.send?.({ type: 'reply', id, value: value ?? null });
    } catch (error) {
      process.send?.({ type: 'reply', id, error: error.message });
    }
  });
  process.once('disconnect', () => void host.close());
  process.once('SIGTERM', () => void host.close().then(() => process.exit(0)));
}
