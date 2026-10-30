import test from 'node:test';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {startReplicationWorkbench} from './server.mjs';
const pause = () => new Promise(r => setTimeout(r, 5));
async function until(fn) {
  const end = Date.now() + 2500;
  while (!fn()) {
    if (Date.now() > end) throw Error('socket condition timed out');
    await pause();
  }
}
async function client(host, principal = 'alpha') {
  const socket = new WebSocket(host.url),
    raw = [],
    frames = [];
  socket.on('error', () => {});
  socket.on('message', data => {
    raw.push(data.toString());
    frames.push(JSON.parse(data.toString()));
  });
  await until(() => socket.readyState === WebSocket.OPEN);
  socket.send(JSON.stringify({v: 1, type: 'auth', token: host.credentials[principal]}));
  await until(() => frames.some(f => f.type === 'authenticated'));
  const session = frames.find(f => f.type === 'authenticated').session;
  return {
    socket,
    raw,
    frames,
    session,
    send: f => socket.send(JSON.stringify(f)),
    ack(f) {
      socket.send(JSON.stringify({v: 1, type: 'view-ack', session, sequence: f.sequence}));
    },
  };
}
async function drain(host) {
  await pause();
  host.pump();
  await pause();
}
async function initial(host, c) {
  await drain(host);
  return c.frames.find(f => f.type === 'view');
}
async function setup(t, options = {}) {
  const host = await startReplicationWorkbench({autoDriver: false, ...options});
  t.after(() => host.close());
  return host;
}
test('separate principals receive complete shared identities with only their own private fields', async t => {
  const h = await setup(t),
    a = await client(h),
    b = await client(h, 'beta');
  const av = await initial(h, a),
    bv = await initial(h, b);
  assert.equal(av.entities.length, 8);
  assert.deepEqual(
    av.entities.map(e => e.id),
    bv.entities.map(e => e.id),
  );
  assert.equal(av.entities[0].fields.private, 'alpha:entity-0');
  assert.equal(bv.entities[0].fields.private, 'beta:entity-0');
  assert.ok(a.raw.every(s => !s.includes('beta:')));
  assert.ok(b.raw.every(s => !s.includes('alpha:')));
  assert.notEqual(a.session, b.session);
  assert.equal(a.socket.extensions, '');
  assert.equal(h.read().peers.length, 2);
});
test('field and scope changes advance view sequence without changing world revision', async t => {
  const h = await setup(t),
    a = await client(h);
  const first = await initial(h, a);
  a.ack(first);
  await drain(h);
  h.removeField({principal: 'alpha', field: 'private'});
  await drain(h);
  const second = a.frames.at(-1);
  assert.equal(second.worldRevision, first.worldRevision);
  assert.ok(second.sequence > first.sequence);
  assert.equal(Object.hasOwn(second.entities[0].fields, 'private'), false);
  a.ack(second);
  await drain(h);
  h.setScope({principal: 'alpha', ids: ['entity-1']});
  await drain(h);
  assert.deepEqual(
    a.frames.at(-1).entities.map(e => e.id),
    ['entity-1'],
  );
  assert.equal(a.frames.at(-1).worldRevision, 0);
});
test('withheld credit coalesces ordinary changes and never blocks a healthy peer; privacy retires immediately', async t => {
  const h = await setup(t),
    a = await client(h),
    b = await client(h, 'beta');
  await initial(h, a);
  const first = await initial(h, b);
  b.ack(first);
  await drain(h);
  for (let i = 1; i <= 5; i++) {
    h.changeWorld({id: 'entity-0', value: i});
    await drain(h);
    const f = b.frames.at(-1);
    assert.equal(f.entities[0].fields.value, i);
    b.ack(f);
    await drain(h);
  }
  assert.equal(a.frames.filter(f => f.type === 'view').length, 1);
  assert.equal(h.read().peers.find(p => p.principal === 'alpha').publisher.dirty, true);
  h.removeField({principal: 'alpha', field: 'private'});
  await until(() => a.socket.readyState === WebSocket.CLOSED);
  assert.equal(h.read().peers.length, 1);
  assert.equal(h.read().peers[0].principal, 'beta');
});
test('wrong and duplicate credits do not admit another outstanding view', async t => {
  const h = await setup(t),
    a = await client(h);
  const first = await initial(h, a);
  h.changeWorld({id: 'entity-0', value: 9});
  a.send({v: 1, type: 'view-ack', session: 'wrong', sequence: first.sequence});
  a.send({v: 1, type: 'view-ack', session: a.session, sequence: 999});
  await drain(h);
  assert.equal(a.frames.filter(f => f.type === 'view').length, 1);
  a.ack(first);
  await drain(h);
  assert.equal(a.frames.filter(f => f.type === 'view').length, 2);
  a.ack(first);
  h.changeWorld({id: 'entity-0', value: 10});
  await drain(h);
  assert.equal(a.frames.filter(f => f.type === 'view').length, 2);
});
test('oversize projection emits bounded unavailable and higher sequence recovers after acknowledgment', async t => {
  const h = await setup(t),
    a = await client(h);
  const first = await initial(h, a);
  a.ack(first);
  await drain(h);
  h.oversize({principal: 'alpha'});
  await drain(h);
  const failure = a.frames.at(-1);
  assert.equal(failure.type, 'view-unavailable');
  assert.ok(Buffer.byteLength(a.raw.at(-1)) < 1024);
  a.ack(failure);
  await drain(h);
  h.oversize({principal: 'alpha', enabled: false});
  await drain(h);
  assert.equal(a.frames.at(-1).type, 'view');
  assert.ok(a.frames.at(-1).sequence > failure.sequence);
});
test('replacement and omission are full frames; reconnect creates fresh session and old acknowledgment has no power', async t => {
  const h = await setup(t),
    a = await client(h);
  a.ack(await initial(h, a));
  await drain(h);
  h.replaceEntity({id: 'entity-0'});
  await drain(h);
  assert.equal(a.frames.at(-1).entities[0].incarnation, 1);
  a.ack(a.frames.at(-1));
  await drain(h);
  h.omitEntity({id: 'entity-0'});
  await drain(h);
  assert.ok(a.frames.at(-1).entities.every(e => e.id !== 'entity-0'));
  const old = a.session;
  a.socket.close();
  await until(() => h.read().peers.length === 0);
  const next = await client(h);
  await initial(h, next);
  assert.notEqual(next.session, old);
  next.send({v: 1, type: 'view-ack', session: old, sequence: 1});
  h.changeWorld({id: 'entity-1', value: 20});
  await drain(h);
  assert.equal(next.frames.filter(f => f.type === 'view').length, 1);
});
test('unauthorized, malformed and oversized clients cannot obtain a view or strand another principal', async t => {
  const h = await setup(t),
    b = await client(h, 'beta');
  await initial(h, b);
  for (const payload of [JSON.stringify({v: 1, type: 'auth', token: 'invalid'}), 'not json', 'x'.repeat(1025)]) {
    const s = new WebSocket(h.url),
      received = [];
    s.on('error', () => {});
    s.on('message', x => received.push(x.toString()));
    await until(() => s.readyState === WebSocket.OPEN);
    s.send(payload);
    await until(() => s.readyState === WebSocket.CLOSED);
    assert.ok(received.every(x => !x.includes('"type":"view"')));
  }
  assert.equal(h.read().peers.length, 1);
  h.revoke('beta');
  await until(() => b.socket.readyState === WebSocket.CLOSED);
  assert.equal(h.read().intake.connections, 0);
});
test('ninth connection is refused; closing peers releases bounded owners', async t => {
  const h = await setup(t),
    clients = [];
  for (let i = 0; i < 8; i++) clients.push(await client(h, i % 2 ? 'beta' : 'alpha'));
  await drain(h);
  const ninth = new WebSocket(h.url);
  ninth.on('error', () => {});
  await until(() => ninth.readyState === WebSocket.CLOSED);
  assert.equal(h.read().peers.length, 8);
  assert.equal(h.read().metrics.maxOutstanding, 8);
  for (const c of clients) c.socket.close();
  await until(() => h.read().intake.connections === 0);
  assert.equal(h.read().intake.queuedBytes, 0);
});

test('real forked IPC separates correlation IDs from entity mutation payloads', async t => {
  const child = fork(new URL('./server.mjs', import.meta.url), [], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  const [ready] = await once(child, 'message');
  assert.equal(ready.type, 'ready');
  assert.ok(ready.url.startsWith('ws://127.0.0.1:'));
  let sequence = 0;
  async function request(method, payload) {
    const id = `operator-${++sequence}`;
    const reply = once(child, 'message');
    child.send({id, method, payload});
    const [result] = await reply;
    assert.equal(result.id, id);
    assert.equal(result.type, 'reply');
    return result;
  }
  const changed = await request('changeWorld', {id: 'entity-0', value: 73});
  assert.equal(changed.error, undefined);
  assert.equal(changed.value.entities[0].value, 73);
  assert.equal(changed.value.worldRevision, 1);
  const replaced = await request('replaceEntity', {id: 'entity-0'});
  assert.equal(replaced.value.entities[0].incarnation, 1);
  const omitted = await request('omitEntity', {id: 'entity-0', omitted: true});
  assert.equal(omitted.value.entities[0].omitted, true);
  const scoped = await request('setScope', {principal: 'alpha', ids: ['entity-1']});
  assert.deepEqual(scoped.value.scopes.alpha.ids, ['entity-1']);
  const refused = await request('setScope', {principal: 'unknown', ids: []});
  assert.equal(refused.error, 'principal');
  const read = await request('read');
  assert.deepEqual(read.value.scopes.alpha.ids, ['entity-1']);
  assert.equal(JSON.stringify(read).includes(ready.credentials.alpha), false);
  const stopped = await request('close');
  assert.equal(stopped.value.closed, true);
});
test('NW05: per-peer token bucket closes a sustained flood after its burst while a healthy peer stays connected', async t => {
  const h = await setup(t),
    a = await client(h),
    b = await client(h, 'beta');
  await initial(h, a);
  await initial(h, b);
  await new Promise(r => setTimeout(r, 100)); // refill the token spent on authentication
  const refused = h.read().metrics.refused,
    closed = h.read().metrics.closed;
  let sent = 0,
    openAfterBurst = false;
  // Batches of eight stay within the per-peer queue, so only the rate bound can close this peer.
  while (a.socket.readyState === WebSocket.OPEN && sent < 4096) {
    const received = h.read().metrics.received;
    for (let i = 0; i < 8; i++) a.send({v: 1, type: 'view-refresh', session: a.session});
    sent += 8;
    await until(() => h.read().metrics.received >= received + 8 || a.socket.readyState !== WebSocket.OPEN);
    h.pump();
    if (sent === 256) openAfterBurst = a.socket.readyState === WebSocket.OPEN;
  }
  await until(() => a.socket.readyState === WebSocket.CLOSED);
  assert.equal(openAfterBurst, true, 'a burst of the capacity is admitted');
  assert.ok(sent > 256, `closed after ${sent} frames`);
  assert.equal(h.read().metrics.refused, refused, 'closure came from the rate bound, not schema or queue refusal');
  assert.equal(h.read().metrics.closed, closed + 1);
  assert.equal(h.read().peers.length, 1);
  h.changeWorld({id: 'entity-0', value: 9});
  await drain(h);
  assert.equal(b.socket.readyState, WebSocket.OPEN);
});
