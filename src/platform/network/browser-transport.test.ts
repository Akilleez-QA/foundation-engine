import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserTransport, parseRemoteClose, type BrowserSocket, type BrowserTransportOptions } from './browser-transport.ts';
class Socket implements BrowserSocket {
  readyState = 0; bufferedAmount = 0; sent: string[] = []; closes = 0;
  listeners = new Map<string, Set<EventListener>>();
  onSend: (() => void) | undefined;
  addEventListener(type: string, listener: EventListener) { let rows = this.listeners.get(type); if (!rows) this.listeners.set(type, rows = new Set()); rows.add(listener); }
  removeEventListener(type: string, listener: EventListener) { this.listeners.get(type)?.delete(listener); }
  send(text: string) { this.onSend?.(); this.sent.push(text); }
  close() { this.closes++; this.readyState = 3; this.emit('close'); }
  emit(type: string, data?: unknown) { const event = Object.assign(new Event(type), { data }); for (const callback of [...(this.listeners.get(type) ?? [])]) callback(event); }
  open() { this.readyState = 1; this.emit('open'); }
  get count() { return [...this.listeners.values()].reduce((n, rows) => n + rows.size, 0); }
}
const limits = { maxMessageBytes: 16, maxQueuedMessages: 3, maxQueuedBytes: 20, maxBufferedBytes: 24 };
function fixture(overrides: Partial<BrowserTransportOptions> = {}) {
  const socket = new Socket();
  const transport = createBrowserTransport({ url: 'ws://localhost:8080/native', limits, socketFactory: () => socket, ...overrides });
  return { socket, transport };
}

test('native lifecycle and explicit drain retain only bounded raw text; no automatic domain dispatch', () => {
  const { socket, transport } = fixture();
  assert.equal(transport.read().state, 'connecting');
  assert.equal(transport.send('a').status, 'refused');
  socket.open(); socket.emit('message', '{broken JSON'); socket.emit('message', 'é😀');
  assert.equal(transport.read().queuedBytes, 18);
  assert.deepEqual(transport.drain(1), ['{broken JSON']);
  assert.equal(transport.read().queuedBytes, 6);
  assert.deepEqual(transport.drain(3), ['é😀']);
  assert.equal(transport.read().queuedBytes, 0);
  assert.deepEqual(transport.capabilities, { ordered: true, reliable: true, text: true, binary: false, incomingBackpressure: false });
  assert.ok(Object.isFrozen(transport.read())); assert.ok(Object.isFrozen(transport.drain(0)));
  assert.throws(() => transport.drain(4)); assert.throws(() => transport.drain(1.1));
});

test('UTF8 incoming size counts astral, unpaired surrogate and exact boundaries without coercion', () => {
  for (const [data, size] of [['é', 2], ['😀', 4], ['\ud800', 3], ['\udfff', 3], ['a', 1]] as const) {
    const { socket, transport } = fixture({ limits: { ...limits, maxMessageBytes: size } });
    socket.open(); socket.emit('message', data); assert.equal(transport.read().queuedBytes, size);
    socket.emit('message', `${data}a`); assert.equal(transport.read().reason, 'message-too-large'); assert.equal(transport.read().queuedBytes, 0);
  }
});

test('incoming queue byte and count overload closes, reports loss and releases all retained frames', () => {
  const bytes = fixture(); bytes.socket.open(); bytes.socket.emit('message', 'a'.repeat(16)); bytes.socket.emit('message', '12345');
  assert.equal(bytes.transport.read().reason, 'queue-overflow'); assert.equal(bytes.socket.count, 0); assert.equal(bytes.socket.closes, 1); assert.deepEqual(bytes.transport.drain(3), []);
  const count = fixture(); count.socket.open(); for (let i = 0; i < 4; i++) count.socket.emit('message', '');
  assert.equal(count.transport.read().reason, 'queue-overflow'); assert.equal(count.transport.read().receivedMessages, 3);
});

test('binary and object frames close without attempting parser, conversion or asynchronous Blob retention', () => {
  let coercions = 0;
  for (const data of [new Uint8Array(2), new Blob(['x']), { toString() { coercions++; return 'hello'; } }]) {
    const { socket, transport } = fixture(); socket.open(); socket.emit('message', data);
    assert.equal(transport.read().reason, 'message-type'); assert.equal(socket.count, 0);
  }
  assert.equal(coercions, 0);
});

test('outgoing uses raw UTF8 plus actual native bufferedAmount; refusal is not a retained retry queue', () => {
  const { socket, transport } = fixture(); socket.open(); socket.bufferedAmount = 20;
  assert.deepEqual(transport.send('😀'), { status: 'sent' });
  socket.bufferedAmount = 21;
  assert.deepEqual(transport.send('😀'), { status: 'refused', reason: 'backpressure' });
  assert.deepEqual(transport.send('x'.repeat(17)), { status: 'refused', reason: 'message-too-large' });
  assert.deepEqual(transport.send({} as string), { status: 'refused', reason: 'message-type' });
  assert.deepEqual(socket.sent, ['😀']); assert.equal(transport.read().sentBytes, 4); assert.equal(transport.read().queuedMessages, 0);
  socket.bufferedAmount = 0; assert.equal(transport.send('retry').status, 'sent');
});

test('disposal revokes captured late event callbacks and removes listeners before native close', () => {
  const { socket, transport } = fixture(); socket.open(); socket.emit('message', 'retained');
  const callbacks = [...socket.listeners.values()].flatMap(rows => [...rows]);
  transport.dispose(); const ended = transport.read();
  for (const callback of callbacks) callback(Object.assign(new Event('message'), { data: 'late' }));
  assert.deepEqual(transport.read(), ended); assert.equal(ended.state, 'disposed'); assert.equal(ended.queuedBytes, 0); assert.equal(socket.count, 0); assert.equal(socket.closes, 1);
  transport.dispose(); assert.equal(socket.closes, 1);
});

test('close and socket error are terminal, including queued messages and retained open events', () => {
  for (const type of ['close', 'error']) {
    const { socket, transport } = fixture(), reopen = [...socket.listeners.get('open')!][0]!;
    socket.open(); socket.emit('message', 'x'); socket.emit(type); socket.readyState = 1; reopen(new Event('open'));
    assert.equal(transport.read().state, 'closed'); assert.equal(transport.read().reason, type === 'close' ? 'remote-close' : 'socket-error');
    assert.equal(socket.count, 0); assert.equal(transport.read().queuedBytes, 0); assert.equal(transport.send('x').status, 'refused');
  }
});

test('configuration capture validates finite literal limits and bounded protocols before construction', () => {
  let calls = 0; const factory = () => { calls++; return new Socket(); };
  for (const value of [0, -1, 1.5, Infinity, '4', NaN]) assert.throws(() => fixture({ limits: { ...limits, maxQueuedBytes: value as number }, socketFactory: factory }));
  for (const protocols of [['same', 'same'], ['spaces forbidden'], Array(9).fill('x')]) assert.throws(() => fixture({ protocols, socketFactory: factory }));
  for (const url of ['https://localhost/', 'ws://localhost/#private', 'ws://user:password@localhost/']) assert.throws(() => fixture({ url, socketFactory: factory }));
  assert.equal(calls, 0);
  const original = { ...limits }, { transport } = fixture({ limits: original }); original.maxMessageBytes = 999;
  assert.equal(transport.read().limits.maxMessageBytes, 16); assert.ok(Object.isFrozen(transport.read().limits));
});

test('factory and partial listener-install failures clean up without disclosing endpoint credentials or exception text', () => {
  const thrown = fixture({ socketFactory() { throw Error('private-value'); } });
  assert.equal(thrown.transport.read().reason, 'construction-error'); assert.equal(JSON.stringify(thrown.transport.read()).includes('private-value'), false);
  const socket = new Socket(), add = socket.addEventListener.bind(socket);
  socket.addEventListener = (type, listener) => { add(type, listener); if (type === 'message') throw Error('installation'); };
  const { transport } = fixture({ socketFactory: () => socket });
  assert.equal(transport.read().state, 'closed'); assert.equal(socket.count, 0); assert.equal(socket.closes, 1);
});

test('synchronous cleanup reentry and exceptions cannot reinstall authority or skip later cleanup', () => {
  const { socket, transport } = fixture(); socket.open(); const remove = socket.removeEventListener.bind(socket); let removes = 0;
  socket.removeEventListener = (type, listener) => { removes++; remove(type, listener); socket.emit('message', 'late'); if (type === 'open') throw Error('cleanup'); };
  socket.close = () => { socket.closes++; socket.emit('open'); throw Error('native-close'); };
  transport.dispose(); assert.equal(removes, 4); assert.equal(socket.count, 0); assert.equal(transport.read().state, 'disposed'); assert.equal(transport.read().receivedMessages, 0);
});

test('send reentry is refused and retirement during socket callback cannot report successful admission', () => {
  const { socket, transport } = fixture(); socket.open(); const nested: unknown[] = [];
  socket.onSend = () => { nested.push(transport.send('inner')); transport.dispose(); };
  assert.deepEqual(transport.send('outer'), { status: 'refused', reason: 'not-open' });
  assert.deepEqual(nested, [{ status: 'refused', reason: 'busy' }]); assert.equal(transport.read().sentMessages, 0); assert.equal(socket.count, 0);
});

test('native send failures and invalid buffer accounting retire rather than claim delivery', () => {
  for (const variant of ['throw', 'buffer', 'state']) {
    const { socket, transport } = fixture(); socket.open();
    if (variant === 'throw') socket.onSend = () => { throw Error('send'); };
    if (variant === 'buffer') socket.bufferedAmount = NaN;
    if (variant === 'state') socket.readyState = 2;
    assert.equal(transport.send('x').status, 'refused'); assert.equal(transport.read().state, 'closed'); assert.equal(socket.count, 0);
  }
});

test('hidden or undrained consumer has bounded admitted retention and must replace lost connection', () => {
  const { socket, transport } = fixture(); socket.open();
  for (let i = 0; i < 100; i++) socket.emit('message', 'full-view');
  assert.equal(transport.read().reason, 'queue-overflow'); assert.equal(transport.read().queuedMessages, 0); assert.equal(transport.read().receivedMessages, 2);
  assert.deepEqual(transport.drain(3), []); assert.equal(socket.count, 0);
});

test('remote close code and reason are bounded tokens or null, never raw remote text', () => {
  const close = (code: unknown, reason: unknown) => parseRemoteClose({ code, reason });
  assert.deepEqual(close(1008, 'auth-rejected'), { code: 1008, reason: 'auth-rejected' });
  assert.deepEqual(close(4000, 'a'), { code: 4000, reason: 'a' });
  assert.deepEqual(close(1000, 'x'.repeat(64)), { code: 1000, reason: 'x'.repeat(64) });
  assert.equal(close(1000, 'x'.repeat(65)).reason, null);
  assert.equal(close(1000, 'x'.repeat(1 << 20)).reason, null);
  for (const reason of ['', ' auth', 'auth rejected', '<b>auth</b>', '-lead', 'é', 'a\nb', 'a"b', 7, null, undefined, {}])
    assert.equal(close(1008, reason).reason, null, String(reason));
  for (const code of [999, 5000, 1008.5, NaN, Infinity, '1008', null, undefined])
    assert.equal(close(code, 'ok').code, null, String(code));
  assert.ok(Object.isFrozen(close(1000, 'ok')));
  const hostile = { get code(): number { throw Error('code'); }, get reason(): string { throw Error('reason'); } };
  assert.deepEqual(parseRemoteClose(hostile), { code: null, reason: null });
  assert.deepEqual(parseRemoteClose(null), { code: null, reason: null });
});

test('remote close is reported only for a peer close; local retirement and existing reasons are unchanged', () => {
  const { socket, transport } = fixture();
  assert.equal(transport.read().remoteClose, null);
  socket.open();
  const event = Object.assign(new Event('close'), { code: 1008, reason: 'auth-rejected' });
  for (const listener of [...socket.listeners.get('close')!]) listener(event);
  assert.equal(transport.read().reason, 'remote-close');
  assert.deepEqual(transport.read().remoteClose, { code: 1008, reason: 'auth-rejected' });
  // A late second close cannot replace the recorded cause, and disposal preserves it.
  for (const listener of [...(socket.listeners.get('close') ?? [])]) listener(Object.assign(new Event('close'), { code: 1000, reason: 'other' }));
  transport.dispose();
  assert.deepEqual(transport.read().remoteClose, { code: 1008, reason: 'auth-rejected' });
  const local = fixture(); local.socket.open(); local.transport.dispose();
  assert.equal(local.transport.read().reason, 'disposed'); assert.equal(local.transport.read().remoteClose, null);
  const error = fixture(); error.socket.open(); error.socket.emit('error');
  assert.equal(error.transport.read().remoteClose, null);
  const bare = fixture(); bare.socket.open(); bare.socket.emit('close');
  assert.deepEqual(bare.transport.read().remoteClose, { code: null, reason: null });
});
