// `npm run host` reference host over real loopback WebSockets (MP-01). Node `ws` clients stand in for browsers here;
// the browser workflow is scripts/play/session-check.mjs.
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {createSession} from '../src/kits/network/session-client.ts';
import {checkJoinCode, loadSessionRules, startSessionServer} from './host.mjs';
import {ROOT} from './lib/game-dir.mjs';
import {join} from 'node:path';

const rules = await loadSessionRules(join(ROOT, 'templates/shared-world/game'));

function client(url, headers = {}) {
  const socket = new WebSocket(url, {headers});
  const frames = [],
    waiters = [];
  socket.on('message', data => {
    frames.push(JSON.parse(data.toString()));
    for (const w of waiters.splice(0)) w();
  });
  const closed = new Promise(resolve =>
    socket.on('close', (code, reason) => resolve({code, reason: reason.toString()})),
  );
  const opened = new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return {
    socket,
    frames,
    closed,
    opened,
    send: frame => socket.send(JSON.stringify(frame)),
    async until(predicate, ms = 3000) {
      const deadline = Date.now() + ms;
      for (;;) {
        const hit = frames.find(predicate);
        if (hit) return hit;
        if (Date.now() > deadline) throw Error('timed out waiting for a frame');
        await new Promise(resolve => {
          waiters.push(resolve);
          setTimeout(resolve, 50);
        });
      }
    },
  };
}
const join_ = (c, code, key) =>
  c.send({v: 1, type: 'join', rules: rules.id, version: rules.version, token: code, player: key});
const ack = (c, view) => c.send({v: 1, type: 'ack', session: view.session, sequence: view.sequence});

test('MP01 host: two loopback clients share one world; actions apply once and reach the other player', async () => {
  const server = await startSessionServer({rules, port: 0, driverMs: 5});
  try {
    assert.match(server.url, /^ws:\/\/127\.0\.0\.1:\d+\/session$/);
    const a = client(server.url),
      b = client(server.url);
    await Promise.all([a.opened, b.opened]);
    join_(a, server.joinCode, 'page-key-a-0123456789');
    join_(b, server.joinCode, 'page-key-b-0123456789');
    const wa = await a.until(f => f.type === 'welcome'),
      wb = await b.until(f => f.type === 'welcome');
    assert.deepEqual([wa.player, wb.player].sort(), ['p1', 'p2']);
    ack(a, await a.until(f => f.type === 'view'));
    a.send({v: 1, type: 'action', seq: 1, action: {type: 'paint'}});
    // B sees A's paint in a later view (B acknowledges every view it adopts, which releases the next one).
    let seen = null;
    for (let i = 0; i < 40 && !seen; i++) {
      const view = await b.until(f => f.type === 'view' && !f.acked);
      view.acked = true;
      ack(b, view);
      const board = view.entities.find(e => e.id === 'board');
      if (board.fields.cells.some(Boolean)) seen = view;
    }
    assert.ok(seen, 'the other client saw the painted cell');
    const self = seen.entities.find(e => e.id === '@you');
    assert.deepEqual(self.fields, {player: wb.player, processed: 0});
    const state = server.read();
    assert.equal(state.metrics.applied, 1);
    assert.equal(state.players.length, 2);
    a.socket.close();
    b.socket.close();
  } finally {
    await server.close();
  }
});

test('MP01 host: a wrong join code closes 1008 auth-rejected; browser origins are limited by mode', async () => {
  const server = await startSessionServer({rules, port: 0, driverMs: 5});
  const lan = await startSessionServer({rules, port: 0, driverMs: 5, lan: true});
  try {
    const wrong = client(server.url);
    await wrong.opened;
    join_(wrong, 'not-the-code-000000000000', 'page-key-c-0123456789');
    assert.deepEqual(await wrong.closed, {code: 1008, reason: 'auth-rejected'});
    // Loopback mode: only pages served from loopback names.
    for (const origin of [
      'https://example.com',
      'http://192.168.1.20:5173',
      'http://box.local:5173',
      'http://app.localhost:5173',
      'http://169.254.1.1:5173',
    ])
      await assert.rejects(client(server.url, {Origin: origin}).opened, /40[13]/, origin);
    for (const origin of ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://[::1]:5173']) {
      const ok = client(server.url, {Origin: origin});
      await ok.opened;
      ok.socket.close();
    }
    // LAN mode: private LAN pages too, still no public sites.
    const local = client(lan.url, {Origin: 'http://192.168.1.20:5173'});
    await local.opened;
    local.socket.close();
    await assert.rejects(client(lan.url, {Origin: 'https://example.com'}).opened, /40[13]/);
    assert.equal(server.read().players.length, 0);
  } finally {
    await server.close();
    await lan.close();
  }
});

test('MP01 host: --join keeps a code across restarts and refuses weak codes', async () => {
  assert.equal(
    checkJoinCode('aaaaaaaaaaaaaaaaaaaa'),
    'the join code needs at least 10 different characters; reuse a code the host generated',
  );
  assert.match(checkJoinCode('short'), /16-128/);
  assert.match(checkJoinCode('has spaces in it ok?'), /16-128/);
  assert.equal(checkJoinCode('Zx8_k2Lp-q9Rv3Tn'), null);
  await assert.rejects(startSessionServer({rules, port: 0, joinCode: 'password-password'}), /different characters/);
  const first = await startSessionServer({rules, port: 0, driverMs: 5});
  const {port, joinCode} = first;
  await first.close();
  const again = await startSessionServer({rules, port, joinCode, driverMs: 5});
  try {
    const a = client(again.url);
    await a.opened;
    join_(a, joinCode, 'page-key-e-0123456789');
    assert.equal((await a.until(f => f.type === 'welcome')).player, 'p1');
    a.socket.close();
  } finally {
    await again.close();
  }
});

test('MP01 host: close stops the driver and closes clients with host-closing', async () => {
  const server = await startSessionServer({rules, port: 0, driverMs: 5});
  const a = client(server.url);
  await a.opened;
  join_(a, server.joinCode, 'page-key-d-0123456789');
  await a.until(f => f.type === 'welcome');
  await server.close();
  assert.deepEqual(await a.closed, {code: 1001, reason: 'host-closing'});
  await server.close();
});

// Importing startSessionServer bypasses the CLI block. Exercise the executable and
// use its printed link, then the existing IPC operator for portable graceful exit.
async function deadline(promise, message, ms = 5000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

for (const supplied of [undefined, 'Zx8_k2Lp-q9Rv3Tn']) {
  test(
    `MP01 host CLI: generated/supplied join code (${supplied ? 'supplied' : 'generated'}) reaches admission and graceful shutdown`,
    {timeout: 20000},
    async () => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          'scripts/host.mjs',
          '--port',
          '0',
          '--game',
          'templates/shared-world/game',
          ...(supplied ? ['--join', supplied] : []),
        ],
        {cwd: ROOT, env: {...process.env, PORT: '5173'}, stdio: ['ignore', 'pipe', 'pipe', 'ipc']},
      );
      let output = '',
        closed = false,
        peer;
      const close = new Promise(resolve =>
        child.once('close', (code, signal) => {
          closed = true;
          resolve({code, signal});
        }),
      );
      try {
        const ready = await deadline(
          new Promise((resolve, reject) => {
            const capture = chunk => {
              output += chunk.toString();
            };
            child.stdout.on('data', capture);
            child.stderr.on('data', capture);
            child.once('error', reject);
            child.once('exit', (code, signal) =>
              reject(Error(`host CLI exited before readiness (${code}, ${signal}): ${output}`)),
            );
            child.once('message', resolve);
          }),
          'host CLI readiness timeout',
        );
        assert.equal(ready.type, 'ready');
        // IPC readiness and stdout travel independently; require the user-facing URL too.
        const printed = await deadline(
          (async () => {
            for (;;) {
              const match = /http:\/\/127\.0\.0\.1:5173\/\?host=(\d+)&join=([A-Za-z0-9_-]+)#scene\/world/.exec(output);
              if (match) return {port: Number(match[1]), joinCode: match[2]};
              if (closed) throw Error(`host CLI stopped before printing link: ${output}`);
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          })(),
          'host CLI printed-link timeout',
        );
        assert.ok(printed.port > 0 && printed.port <= 65535);
        assert.equal(printed.port, ready.port);
        assert.equal(printed.joinCode, ready.joinCode);
        assert.equal(checkJoinCode(printed.joinCode), null);
        if (supplied) assert.equal(printed.joinCode, supplied);
        peer = client(`ws://127.0.0.1:${printed.port}/session`);
        await deadline(peer.opened, 'socket open timeout');
        join_(peer, printed.joinCode, 'cli-page-key-0123456789');
        assert.equal((await peer.until(f => f.type === 'welcome')).player, 'p1');
        const reply = new Promise(resolve => child.once('message', resolve));
        child.send({id: 'close-test', method: 'close'});
        const [result, remote, processResult] = await deadline(
          Promise.all([reply, peer.closed, close]),
          'host CLI shutdown timeout',
        );
        assert.deepEqual(result, {type: 'reply', id: 'close-test', value: {closed: true}});
        assert.deepEqual(remote, {code: 1001, reason: 'host-closing'});
        assert.deepEqual(processResult, {code: 0, signal: null});
      } finally {
        peer?.socket.terminate();
        if (!closed) child.kill('SIGTERM');
        const force = setTimeout(() => {
          if (!closed) child.kill('SIGKILL');
        }, 1500);
        try {
          await deadline(close, 'child cleanup timeout', 5000);
        } finally {
          clearTimeout(force);
        }
      }
    },
  );
}

// Top-level tests in this file are serial (Node's default); do not make this test
// concurrent: it briefly intercepts the adapter's interval construction, not I/O.
test(
  'MP01 liveness: real loopback sockets detect a stalled pump and resume without uncertain resend',
  {concurrency: false, timeout: 15000},
  async t => {
    let pumping = true,
      skipped = 0,
      driverCalls = 0;
    const interval = globalThis.setInterval;
    const interception = t.mock.method(globalThis, 'setInterval', (callback, ms, ...args) => {
      driverCalls++;
      return interval(() => {
        if (pumping) callback(...args);
        else skipped++;
      }, ms);
    });
    let server, session;
    const sockets = [],
      sent = [],
      views = [];
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const until = async (predicate, label, drive = true) => {
      const end = performance.now() + 5000;
      for (;;) {
        if (drive) session.update(performance.now());
        if (predicate()) return;
        assert.ok(performance.now() < end, `timed out: ${label}; ${JSON.stringify(session.read())}`);
        await sleep(5);
      }
    };
    try {
      try {
        server = await startSessionServer({rules, port: 0, driverMs: 5, refreshOnPing: true});
      } finally {
        interception.mock.restore();
      }
      assert.equal(globalThis.setInterval, interval, 'global timer restored before driving the session');
      assert.equal(driverCalls, 1, 'only the existing host driver is intercepted');
      session = createSession({
        rules,
        endpoint: {url: server.url, joinCode: server.joinCode},
        random: () => 0.5,
        pingMs: 100,
        liveness: {connectTimeoutMs: 3000, hostTimeoutMs: 600},
        socketFactory(url) {
          const socket = new WebSocket(url);
          sockets.push(socket);
          const send = socket.send.bind(socket);
          socket.send = text => {
            sent.push(JSON.parse(text));
            return send(text);
          };
          socket.on('message', data => {
            const frame = JSON.parse(data.toString());
            if (frame.type === 'view') views.push(frame);
          });
          return socket;
        },
      });
      await until(() => session.read().status === 'joined' && session.read().confirmed !== null, 'initial baseline');
      const player = session.read().player,
        baseline = session.read().confirmed;
      const revision = session.read().revision,
        worldRevision = server.read().worldRevision,
        firstViews = views.length;
      const healthyUntil = performance.now() + 1300; // More than two host timeout windows.
      await until(() => performance.now() >= healthyUntil, 'healthy idle windows');
      assert.equal(session.read().status, 'joined');
      assert.equal(sockets.length, 1);
      assert.ok(views.length > firstViews + 2, 'real socket delivered advancing idle views');
      assert.equal(session.read().revision, revision, 'idle liveness does not redraw');
      assert.equal(server.read().worldRevision, worldRevision);
      assert.deepEqual(server.read().world, baseline);

      pumping = false;
      const before = server.read(),
        stoppedViews = views.length,
        pingCount = sent.filter(f => f.type === 'ping').length;
      const oldSocket = sockets[0];
      assert.equal(oldSocket.readyState, WebSocket.OPEN, 'transport is open when the pump stops');
      assert.equal(session.act({type: 'step', dx: 1, dz: 0}).status, 'predicted');
      assert.equal(session.read().world[player].x, baseline[player].x + 1);
      assert.equal(session.read().pending, 1);
      const stalledAt = performance.now();
      let sawOpenDuringStall = false;
      await until(() => {
        if (session.read().status === 'joined' && performance.now() - stalledAt > 300) {
          assert.equal(oldSocket.readyState, WebSocket.OPEN);
          sawOpenDuringStall = true;
        }
        return session.read().lastClose?.reason === 'host-timeout';
      }, 'host timeout with socket still open');
      assert.ok(sawOpenDuringStall, 'observed open socket well into the pump stall');
      assert.ok(skipped > 0, 'the injected fault skipped actual driver callbacks');
      assert.ok(sent.filter(f => f.type === 'ping').length > pingCount, 'client kept probing during the stall');
      assert.ok(views.length <= stoppedViews + 1, 'no new pumped views (at most one already in flight)');
      assert.equal(session.read().status, 'reconnecting');
      assert.equal(session.read().stale, true);
      assert.equal(session.read().pending, 0);
      assert.deepEqual(session.read().world, baseline, 'unconfirmed prediction is rolled back');
      // Deliver the real close handshake and host retirement before pumping again;
      // otherwise an uncertain queued action could legitimately be applied first.
      await until(() => oldSocket.readyState === WebSocket.CLOSED, 'old socket closed', false);
      await until(() => server.read().connections === 0, 'host retired old socket', false);
      const viewsBeforeReconnect = views.length;
      pumping = true;
      await until(
        () =>
          session.read().status === 'joined' &&
          !session.read().stale &&
          session.read().confirmed !== null &&
          views.length > viewsBeforeReconnect,
        'fresh baseline after reconnect',
      );
      assert.equal(session.read().player, player);
      assert.equal(session.read().reconnects, 1);
      assert.equal(session.read().pending, 0, 'fresh baseline has no uncertain pending action');
      assert.equal(sockets.length, 2);
      assert.equal(server.read().metrics.resumed, 1);
      assert.equal(server.read().metrics.applied, before.metrics.applied);
      assert.deepEqual(server.read().world, baseline, 'uncertain move was not applied after retirement');
      assert.deepEqual(session.read().world, baseline);
      assert.equal(sent.filter(f => f.type === 'action').length, 1, 'uncertain action was never resent');
    } finally {
      interception.mock.restore();
      session?.dispose();
      session?.dispose();
      if (server) {
        await server.close();
        await server.close();
      }
      for (const socket of sockets) socket.terminate();
    }
  },
);
