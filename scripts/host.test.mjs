// `npm run host` reference host over real loopback WebSockets (MP-01). Node `ws` clients stand in for browsers here;
// the browser workflow is scripts/play/session-check.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { loadSessionRules, startSessionServer } from './host.mjs';
import { ROOT } from './lib/game-dir.mjs';
import { join } from 'node:path';

const rules = await loadSessionRules(join(ROOT, 'templates/shared-world/game'));

function client(url, headers = {}) {
  const socket = new WebSocket(url, { headers });
  const frames = [], waiters = [];
  socket.on('message', data => { frames.push(JSON.parse(data.toString())); for (const w of waiters.splice(0)) w(); });
  const closed = new Promise(resolve => socket.on('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  const opened = new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  return {
    socket, frames, closed, opened,
    send: frame => socket.send(JSON.stringify(frame)),
    async until(predicate, ms = 3000) {
      const deadline = Date.now() + ms;
      for (;;) {
        const hit = frames.find(predicate);
        if (hit) return hit;
        if (Date.now() > deadline) throw Error('timed out waiting for a frame');
        await new Promise(resolve => { waiters.push(resolve); setTimeout(resolve, 50); });
      }
    },
  };
}
const join_ = (c, code, key) => c.send({ v: 1, type: 'join', rules: rules.id, version: rules.version, token: code, player: key });
const ack = (c, view) => c.send({ v: 1, type: 'ack', session: view.session, sequence: view.sequence });

test('MP01 host: two loopback clients share one world; actions apply once and reach the other player', async () => {
  const server = await startSessionServer({ rules, port: 0, driverMs: 5 });
  try {
    assert.match(server.url, /^ws:\/\/127\.0\.0\.1:\d+\/session$/);
    const a = client(server.url), b = client(server.url);
    await Promise.all([a.opened, b.opened]);
    join_(a, server.joinCode, 'page-key-a-0123456789'); join_(b, server.joinCode, 'page-key-b-0123456789');
    const wa = await a.until(f => f.type === 'welcome'), wb = await b.until(f => f.type === 'welcome');
    assert.deepEqual([wa.player, wb.player].sort(), ['p1', 'p2']);
    ack(a, await a.until(f => f.type === 'view'));
    a.send({ v: 1, type: 'action', seq: 1, action: { type: 'paint' } });
    // B sees A's paint in a later view (B acknowledges every view it adopts, which releases the next one).
    let seen = null;
    for (let i = 0; i < 40 && !seen; i++) {
      const view = await b.until(f => f.type === 'view' && !f.acked);
      view.acked = true; ack(b, view);
      const board = view.entities.find(e => e.id === 'board');
      if (board.fields.cells.some(Boolean)) seen = view;
    }
    assert.ok(seen, 'the other client saw the painted cell');
    const self = seen.entities.find(e => e.id === '@you');
    assert.deepEqual(self.fields, { player: wb.player, processed: 0 });
    const state = server.read();
    assert.equal(state.metrics.applied, 1);
    assert.equal(state.players.length, 2);
    a.socket.close(); b.socket.close();
  } finally { await server.close(); }
});

test('MP01 host: a wrong join code closes 1008 auth-rejected; a remote page origin is refused at the handshake', async () => {
  const server = await startSessionServer({ rules, port: 0, driverMs: 5 });
  try {
    const wrong = client(server.url);
    await wrong.opened;
    join_(wrong, 'not-the-code-000000000000', 'page-key-c-0123456789');
    assert.deepEqual(await wrong.closed, { code: 1008, reason: 'auth-rejected' });
    const remote = client(server.url, { Origin: 'https://example.com' });
    await assert.rejects(remote.opened, /40[13]/);
    const local = client(server.url, { Origin: 'http://192.168.1.20:5173' });
    await local.opened;
    local.socket.close();
    assert.equal(server.read().players.length, 0);
  } finally { await server.close(); }
});

test('MP01 host: close stops the driver and closes clients with host-closing', async () => {
  const server = await startSessionServer({ rules, port: 0, driverMs: 5 });
  const a = client(server.url);
  await a.opened;
  join_(a, server.joinCode, 'page-key-d-0123456789');
  await a.until(f => f.type === 'welcome');
  await server.close();
  assert.deepEqual(await a.closed, { code: 1001, reason: 'host-closing' });
  await server.close();
});
