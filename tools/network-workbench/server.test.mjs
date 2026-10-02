import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { startNetworkWorkbench, hostLimits } from './server.mjs';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  const end = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > end) throw Error('native socket condition timeout');
    await delay(5);
  }
}
async function connect(host, token) {
  const socket = new WebSocket(host.url),
    frames = [];
  socket.on('error', () => {});
  socket.on('message', (data) => frames.push(JSON.parse(data.toString())));
  await once(socket, 'open');
  if (token) {
    socket.send(JSON.stringify({ v: 1, type: 'auth', token }));
    await until(
      () =>
        frames.some((f) => f.type === 'authenticated') ||
        socket.readyState === WebSocket.CLOSED,
    );
  }
  return { socket, frames };
}
const command = (peer, id, target, delta = 1) =>
  peer.socket.send(
    JSON.stringify({ v: 1, type: 'command', id, target, delta }),
  );
async function shutdown(host, peers = []) {
  for (const p of peers) p.socket.terminate();
  await host.close();
  assert.equal(host.read().intake.connections, 0);
  assert.equal(host.read().intake.queuedMessages, 0);
}

test('real sockets authenticate opaque credentials and enforce principal-target scope without private peer state', async () => {
  const host = await startNetworkWorkbench({ autoDriver: false }),
    peers = [];
  try {
    const a = await connect(host, host.credentials.alpha),
      b = await connect(host, host.credentials.beta);
    peers.push(a, b);
    command(a, 'own', 'alpha', 2);
    command(a, 'other', 'beta', 5);
    command(b, 'own', 'beta', 3);
    await until(() => host.read().intake.queuedMessages === 3);
    host.pump();
    await until(() => a.frames.length === 3 && b.frames.length === 2);
    assert.deepEqual(host.read().counters, { alpha: 2, beta: 3 });
    assert.ok(
      a.frames.some(
        (f) =>
          f.type === 'refused' &&
          f.id === 'other' &&
          f.reason === 'unauthorized',
      ),
    );
    assert.ok(
      a.frames.every(
        (f) => !Object.hasOwn(f, 'counters') && f.target !== 'beta',
      ),
    );
    for (const p of peers)
      for (const frame of p.frames) {
        const wire = JSON.stringify(frame);
        assert.ok(
          !wire.includes(host.credentials.alpha) &&
            !wire.includes(host.credentials.beta),
        );
      }
  } finally {
    await shutdown(host, peers);
  }
});

test('wrong credential and unauthenticated commands cannot dispatch', async () => {
  const host = await startNetworkWorkbench({ autoDriver: false }),
    peers = [];
  try {
    const wrong = await connect(host, 'not-a-credential');
    peers.push(wrong);
    assert.equal(wrong.socket.readyState, WebSocket.CLOSED);
    const anonymous = await connect(host);
    peers.push(anonymous);
    command(anonymous, 'missing', 'alpha');
    await until(() => anonymous.frames.some((f) => f.type === 'refused'));
    host.pump();
    assert.equal(host.read().metrics.dispatched, 0);
  } finally {
    await shutdown(host, peers);
  }
});

test('held native authentication completion cannot revive a closed connection or its replacement', async () => {
  const host = await startNetworkWorkbench({ autoDriver: false }),
    peers = [];
  try {
    host.holdAuthentication(true);
    const old = await connect(host);
    peers.push(old);
    old.socket.send(
      JSON.stringify({ v: 1, type: 'auth', token: host.credentials.alpha }),
    );
    await until(() => host.read().heldAuthentication === 1);
    const [late] = host.captureAuthentication();
    old.socket.terminate();
    await until(() => host.read().intake.connections === 0);
    const replacement = await connect(host);
    peers.push(replacement);
    late();
    assert.equal(host.read().intake.pendingAuth, 0);
    assert.equal(host.read().peers[0].state, 'pre-auth');
    assert.equal(host.read().peers[0].principal, null);
    host.holdAuthentication(false);
    replacement.socket.send(
      JSON.stringify({ v: 1, type: 'auth', token: host.credentials.beta }),
    );
    await until(() =>
      replacement.frames.some((f) => f.type === 'authenticated'),
    );
    assert.equal(replacement.frames[0].principal, 'beta');
  } finally {
    await shutdown(host, peers);
  }
});

test('revocation retires queued authority and prevents reauthentication with the revoked credential', async () => {
  const host = await startNetworkWorkbench({ autoDriver: false }),
    peers = [];
  try {
    const a = await connect(host, host.credentials.alpha);
    peers.push(a);
    command(a, 'queued', 'alpha', 5);
    await until(() => host.read().intake.queuedMessages === 1);
    host.revoke('alpha');
    host.pump();
    assert.deepEqual(host.read().counters, { alpha: 0, beta: 0 });
    assert.equal(host.read().intake.queuedBytes, 0);
    const retry = await connect(host, host.credentials.alpha);
    peers.push(retry);
    assert.equal(retry.socket.readyState, WebSocket.CLOSED);
  } finally {
    await shutdown(host, peers);
  }
});

test('per-peer queue overflow refuses extra work while fair pumping serves a healthy peer', async () => {
  const host = await startNetworkWorkbench({ autoDriver: false }),
    peers = [];
  try {
    const a = await connect(host, host.credentials.alpha),
      b = await connect(host, host.credentials.beta);
    peers.push(a, b);
    for (let i = 0; i < 12; i++) command(a, `flood${i}`, 'alpha');
    command(b, 'healthy', 'beta');
    await until(() => host.read().metrics.receivedFrames === 15);
    assert.equal(host.read().intake.queuedMessages, 9);
    assert.ok(host.read().intake.queuedBytes <= hostLimits.maxQueuedBytes);
    host.pump();
    await until(() => b.frames.some((f) => f.type === 'result'));
    assert.equal(host.read().counters.beta, 1);
    assert.ok(host.read().metrics.dispatched <= hostLimits.maxPumpOperations);
    await until(() =>
      a.frames.some((f) => f.type === 'refused' && f.reason === 'queue-limit'),
    );
    a.socket.terminate();
    await until(() => host.read().intake.queuedMessages === 0);
  } finally {
    await shutdown(host, peers);
  }
});

test('transport byte bounds, malformed/deep/wrong-type frames never reach domain dispatch', async () => {
  const host = await startNetworkWorkbench({ autoDriver: false }),
    peers = [];
  try {
    for (const payload of [
      '{',
      JSON.stringify({
        v: 1,
        type: 'command',
        id: 'deep',
        target: { nested: { deeper: { value: 'alpha' } } },
        delta: 1,
      }),
      JSON.stringify({
        v: 1,
        type: 'command',
        id: 'coercion',
        target: 'alpha',
        delta: '1',
      }),
      'x'.repeat(1025),
    ]) {
      const p = await connect(host, host.credentials.alpha);
      peers.push(p);
      p.socket.send(payload);
      await until(
        () =>
          p.socket.readyState === WebSocket.CLOSED ||
          p.frames.some((f) => f.type === 'refused'),
      );
      host.pump();
      assert.equal(host.read().metrics.dispatched, 0);
      p.socket.terminate();
      await until(() => host.read().intake.connections === 0);
    }
  } finally {
    await shutdown(host, peers);
  }
});

test('pending authentication timeout releases admission without an incoming frame', async () => {
  const host = await startNetworkWorkbench(),
    peers = [];
  try {
    host.holdAuthentication(true);
    const p = await connect(host);
    peers.push(p);
    p.socket.send(
      JSON.stringify({ v: 1, type: 'auth', token: host.credentials.alpha }),
    );
    await until(() => host.read().intake.pendingAuth === 1);
    await until(() => p.socket.readyState === WebSocket.CLOSED);
    assert.equal(host.read().intake.pendingAuth, 0);
    assert.equal(host.read().heldAuthentication, 0);
  } finally {
    await shutdown(host, peers);
  }
});

test('connection bound releases capacity on socket close; command IDs are correlation only', async () => {
  const host = await startNetworkWorkbench({ autoDriver: false }),
    peers = [];
  try {
    for (let i = 0; i < hostLimits.maxConnections; i++)
      peers.push(await connect(host));
    const extra = await connect(host);
    peers.push(extra);
    await until(() => extra.socket.readyState === WebSocket.CLOSED);
    assert.equal(host.read().intake.connections, 8);
    peers[0].socket.terminate();
    await until(() => host.read().intake.connections === 7);
    const a = await connect(host, host.credentials.alpha);
    peers.push(a);
    command(a, 'same', 'alpha');
    command(a, 'same', 'alpha');
    await until(() => host.read().intake.queuedMessages === 2);
    host.pump();
    assert.equal(
      host.read().counters.alpha,
      2,
      'no dedup guarantee in ephemeral slice',
    );
  } finally {
    await shutdown(host, peers);
  }
});

test('transport refusal retires a real peer and queued reservations without claiming an accepted counter was rolled back', async () => {
  const host = await startNetworkWorkbench({ autoDriver: false }),
    peers = [];
  try {
    const a = await connect(host, host.credentials.alpha);
    peers.push(a);
    command(a, 'first', 'alpha');
    command(a, 'second', 'alpha');
    await until(() => host.read().intake.queuedMessages === 2);
    host.blockSends('alpha', true);
    host.pump();
    await until(() => a.socket.readyState === WebSocket.CLOSED);
    assert.equal(
      host.read().counters.alpha,
      1,
      'first dispatch happened before its reply was refused',
    );
    assert.equal(host.read().intake.queuedMessages, 0);
    assert.equal(host.read().intake.queuedBytes, 0);
    assert.equal(host.read().intake.connections, 0);
    assert.equal(host.read().metrics.transportRefusals, 1);
  } finally {
    await shutdown(host, peers);
  }
});

test('separate host process issues operator-only credentials and correlated IPC observations', async () => {
  const child = fork(
      fileURLToPath(new URL('./server.mjs', import.meta.url)),
      [],
      {
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    ),
    exit = once(child, 'exit');
  let peer;
  try {
    const [ready] = await once(child, 'message');
    assert.equal(ready.type, 'ready');
    assert.ok(ready.url.startsWith('ws://127.0.0.1:'));
    peer = await connect(ready, ready.credentials.alpha);
    command(peer, 'child', 'alpha', 4);
    await until(() => peer.frames.some((f) => f.type === 'result'));
    let reply = once(child, 'message');
    child.send({ id: 'observe', method: 'read' });
    const [observed] = await reply;
    assert.equal(observed.id, 'observe');
    assert.equal(observed.value.counters.alpha, 4);
    assert.ok(!Object.hasOwn(observed.value, 'credentials'));
    reply = once(child, 'message');
    child.send({ id: 'stop', method: 'close' });
    assert.equal((await reply)[0].id, 'stop');
    await exit;
  } finally {
    peer?.socket.terminate();
    if (child.exitCode === null) child.kill();
  }
});

test('NW05: per-peer token bucket admits a capacity burst, closes the next burst and leaves a healthy peer served', async () => {
  const host = await startNetworkWorkbench({ autoDriver: false }),
    peers = [];
  try {
    const a = await connect(host, host.credentials.alpha),
      b = await connect(host, host.credentials.beta);
    peers.push(a, b);
    const closed = once(a.socket, 'close');
    await delay(100); // refill the token spent on authentication
    const before = host.read().metrics.receivedFrames;
    // Version-mismatch frames are refused without closing, so only the rate bound can close this peer.
    for (let i = 0; i < 32; i++) a.socket.send(JSON.stringify({ v: 2 }));
    await until(() => host.read().metrics.receivedFrames === before + 32);
    assert.equal(a.socket.readyState, WebSocket.OPEN, 'a burst of exactly the capacity is admitted');
    for (let i = 0; i < 32; i++) a.socket.send(JSON.stringify({ v: 2 }));
    const [code, reason] = await closed;
    assert.equal(code, 1013);
    assert.equal(reason.toString(), 'rate-capacity');
    command(b, 'healthy', 'beta');
    await until(() => host.read().intake.queuedMessages === 1);
    host.pump();
    await until(() => b.frames.some((f) => f.type === 'result'));
    assert.equal(host.read().counters.beta, 1);
  } finally {
    await shutdown(host, peers);
  }
});

// NW-08: optional planned drain and capped connection lifetime.
const closed = (peer) =>
  new Promise((resolve) => {
    if (peer.socket.readyState === WebSocket.CLOSED) resolve(peer.closedWith);
    else
      peer.socket.once('close', (code, reason) =>
        resolve({ code, reason: reason.toString() }),
      );
  });
const watchClose = (peer) => {
  peer.socket.once('close', (code, reason) => {
    peer.closedWith = { code, reason: reason.toString() };
  });
  return peer;
};

test('NW-08 drain is off by default: no drain state and the operator drain refuses', async () => {
  const host = await startNetworkWorkbench({ autoDriver: false });
  try {
    assert.equal(host.read().drain, null);
    assert.throws(
      () => host.drain({ noticeMs: 0, reconnectAfterMs: 0 }),
      /drain-disabled/,
    );
    assert.throws(() => host.resume(), /drain-disabled/);
  } finally {
    await shutdown(host);
  }
});

test('NW-08 drain during in-flight work: queued commands still dispatch and reply; new commands are refused; the ignoring client is closed at the deadline', async () => {
  const host = await startNetworkWorkbench({ autoDriver: false, drain: {} }),
    peers = [];
  try {
    const a = watchClose(await connect(host, host.credentials.alpha));
    peers.push(a);
    command(a, 'queued-1', 'alpha', 2);
    command(a, 'queued-2', 'alpha', 3);
    await until(() => host.read().intake.queuedMessages === 2);
    // Two notices for the same peer: the second may only shorten the close.
    host.drain({ noticeMs: 300, reconnectAfterMs: 1000 });
    assert.throws(
      () => host.drain({ noticeMs: 60001, reconnectAfterMs: 0 }),
      /drain-invalid/,
    );
    await until(() => a.frames.some((f) => f.type === 'drain'));
    const results = a.frames.filter((f) => f.type === 'result');
    assert.deepEqual(
      results.map((f) => [f.id, f.value]),
      [
        ['queued-1', 2],
        ['queued-2', 5],
      ],
      'admitted work completes before the notice',
    );
    const { closeInMs, ...notice } = a.frames.find((f) => f.type === 'drain');
    assert.deepEqual(notice, {
      v: 1,
      type: 'drain',
      cause: 'planned',
      reconnectAfterMs: 1000,
    });
    // Whole milliseconds remaining on the host clock, never more than the requested notice.
    assert.ok(Number.isSafeInteger(closeInMs) && closeInMs <= 300 && closeInMs >= 250);
    command(a, 'late', 'alpha', 1);
    await until(() =>
      a.frames.some((f) => f.type === 'refused' && f.id === 'late'),
    );
    assert.equal(
      a.frames.find((f) => f.id === 'late').reason,
      'draining',
    );
    host.drain({ noticeMs: 5000, reconnectAfterMs: 1 });
    assert.equal(a.frames.filter((f) => f.type === 'drain').length, 1);
    // The client ignores the notice; the host still closes at the deadline with a transient code.
    const started = Date.now();
    const pumping = setInterval(() => host.pump(), 10);
    try {
      assert.deepEqual(await closed(a), { code: 1012, reason: 'drain' });
    } finally {
      clearInterval(pumping);
    }
    assert.ok(Date.now() - started < 1500);
    assert.deepEqual(host.read().counters, { alpha: 5, beta: 0 });
    assert.equal(host.read().metrics.dispatched, 2);
    assert.equal(host.read().metrics.drainRefusals, 1);
    assert.equal(host.read().intake.connections, 0);
  } finally {
    await shutdown(host, peers);
  }
});

test('NW-08 a draining host refuses new connections transiently until resume, then admits fresh sessions', async () => {
  const host = await startNetworkWorkbench({ autoDriver: false, drain: {} }),
    peers = [];
  try {
    host.drain({ noticeMs: 0, reconnectAfterMs: 0 });
    const refused = watchClose(await connect(host));
    peers.push(refused);
    assert.deepEqual(await closed(refused), { code: 1012, reason: 'drain' });
    assert.equal(host.read().drain.counts.refusedDraining, 1);
    assert.equal(host.read().intake.connections, 0);
    assert.equal(host.resume(), true);
    const fresh = await connect(host, host.credentials.beta);
    peers.push(fresh);
    assert.ok(fresh.frames.some((f) => f.type === 'authenticated'));
    command(fresh, 'after', 'beta', 4);
    await until(() => host.read().intake.queuedMessages === 1);
    host.pump();
    await until(() => fresh.frames.some((f) => f.type === 'result'));
    assert.deepEqual(host.read().counters, { alpha: 0, beta: 4 });
  } finally {
    await shutdown(host, peers);
  }
});

test('NW-08 capped lifetime: each connection is notified then closed within its dithered cap', async () => {
  const samples = [0, 0.99];
  const host = await startNetworkWorkbench({
      driverMs: 5,
      drain: {
        lifetime: {
          maxLifetimeMs: 600,
          jitterMs: 300,
          noticeMs: 100,
          reconnectAfterMs: 50,
        },
        random: () => samples.shift() ?? 0,
      },
    }),
    peers = [];
  try {
    const opened = Date.now();
    const a = watchClose(await connect(host, host.credentials.alpha));
    const b = watchClose(await connect(host, host.credentials.beta));
    peers.push(a, b);
    const [closeA, closeB] = await Promise.all([closed(a), closed(b)]);
    const elapsed = Date.now() - opened;
    assert.deepEqual(closeA, { code: 1012, reason: 'lifetime' });
    assert.deepEqual(closeB, { code: 1012, reason: 'lifetime' });
    for (const peer of [a, b]) {
      const notice = peer.frames.find((f) => f.type === 'drain');
      assert.equal(notice.cause, 'lifetime');
      assert.equal(notice.reconnectAfterMs, 50);
      assert.ok(notice.closeInMs <= 100);
    }
    assert.ok(elapsed < 1500, `closed within the cap plus scheduling slack (${elapsed} ms)`);
    assert.equal(host.read().metrics.drainNotices, 2);
    assert.equal(host.read().drain.tracked, 0);
  } finally {
    await shutdown(host, peers);
  }
});
