// `npm run host` reference host over real loopback WebSockets (MP-01). Node `ws` clients stand in for browsers here;
// the browser workflow is scripts/play/session-check.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { checkJoinCode, loadSessionRules, startSessionServer } from './host.mjs';
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

test('MP01 host: a wrong join code closes 1008 auth-rejected; browser origins are limited by mode', async () => {
  const server = await startSessionServer({ rules, port: 0, driverMs: 5 });
  const lan = await startSessionServer({ rules, port: 0, driverMs: 5, lan: true });
  try {
    const wrong = client(server.url);
    await wrong.opened;
    join_(wrong, 'not-the-code-000000000000', 'page-key-c-0123456789');
    assert.deepEqual(await wrong.closed, { code: 1008, reason: 'auth-rejected' });
    // Loopback mode: only pages served from loopback names.
    for (const origin of ['https://example.com', 'http://192.168.1.20:5173', 'http://box.local:5173', 'http://app.localhost:5173', 'http://169.254.1.1:5173'])
      await assert.rejects(client(server.url, { Origin: origin }).opened, /40[13]/, origin);
    for (const origin of ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://[::1]:5173']) {
      const ok = client(server.url, { Origin: origin });
      await ok.opened; ok.socket.close();
    }
    // LAN mode: private LAN pages too, still no public sites.
    const local = client(lan.url, { Origin: 'http://192.168.1.20:5173' });
    await local.opened; local.socket.close();
    await assert.rejects(client(lan.url, { Origin: 'https://example.com' }).opened, /40[13]/);
    assert.equal(server.read().players.length, 0);
  } finally { await server.close(); await lan.close(); }
});

test('MP01 host: --join keeps a code across restarts and refuses weak codes', async () => {
  assert.equal(checkJoinCode('aaaaaaaaaaaaaaaaaaaa'), 'the join code needs at least 10 different characters; reuse a code the host generated');
  assert.match(checkJoinCode('short'), /16-128/);
  assert.match(checkJoinCode('has spaces in it ok?'), /16-128/);
  assert.equal(checkJoinCode('Zx8_k2Lp-q9Rv3Tn'), null);
  await assert.rejects(startSessionServer({ rules, port: 0, joinCode: 'password-password' }), /different characters/);
  const first = await startSessionServer({ rules, port: 0, driverMs: 5 });
  const { port, joinCode } = first;
  await first.close();
  const again = await startSessionServer({ rules, port, joinCode, driverMs: 5 });
  try {
    const a = client(again.url);
    await a.opened;
    join_(a, joinCode, 'page-key-e-0123456789');
    assert.equal((await a.until(f => f.type === 'welcome')).player, 'p1');
    a.socket.close();
  } finally { await again.close(); }
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
