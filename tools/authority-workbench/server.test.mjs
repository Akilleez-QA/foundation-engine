import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { WebSocket } from 'ws';
import {
  initializeAuthorityWorkbench,
  startAuthorityWorkbench,
} from './server.mjs';
const pause = () => new Promise((r) => setTimeout(r, 5));
async function until(fn) {
  const end = Date.now() + 4000;
  while (!fn()) {
    if (Date.now() > end) throw Error('condition timeout');
    await pause();
  }
}
async function directory(t) {
  const d = await mkdtemp(join(tmpdir(), 'authority-host-'));
  t.after(() => rm(d, { recursive: true, force: true }));
  return d;
}
async function connect(t, h, p = 'a') {
  const socket = new WebSocket(h.url),
    frames = [];
  socket.on('error', () => {});
  socket.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  t.after(() => socket.terminate());
  await until(() => socket.readyState === WebSocket.OPEN);
  socket.send(JSON.stringify({ v: 1, type: 'auth', token: h.credentials[p] }));
  await until(() => frames.some((x) => x.type === 'baseline'));
  const auth = frames.find((x) => x.type === 'authenticated');
  return {
    socket,
    frames,
    auth,
    send(sequence, add) {
      socket.send(
        JSON.stringify({
          v: 1,
          type: 'command',
          session: auth.session,
          epoch: auth.epoch,
          sequence,
          inputJson: JSON.stringify({ add }),
        }),
      );
    },
  };
}
async function result(c, seq) {
  await until(() =>
    c.frames.some((f) => f.type === 'result' && f.sequence === seq),
  );
  return c.frames
    .filter((f) => f.type === 'result' && f.sequence === seq)
    .at(-1);
}
test('explicit initialization, paired baselines, permanent streams and bounded replay survive restart', async (t) => {
  const d = await directory(t);
  await assert.rejects(startAuthorityWorkbench({ directory: d }));
  await initializeAuthorityWorkbench({ directory: d });
  await assert.rejects(initializeAuthorityWorkbench({ directory: d }));
  let h = await startAuthorityWorkbench({ directory: d });
  t.after(() => h.close());
  let a = await connect(t, h);
  for (let n = 1; n <= 6; n++) {
    a.send(n, 1);
    assert.equal((await result(a, n)).status, 'committed');
  }
  assert.equal(h.read().checkpoint.state, 6);
  await h.close();
  h = await startAuthorityWorkbench({ directory: d });
  a = await connect(t, h);
  assert.deepEqual(a.frames.at(-1), {
    v: 1,
    type: 'baseline',
    session: a.auth.session,
    epoch: a.auth.epoch,
    revision: 6,
    processedThrough: 6,
    stateJson: '6',
  });
  a.send(6, 1);
  assert.equal((await result(a, 6)).status, 'duplicate');
  a.frames.length = 0;
  a.send(6, 2);
  assert.equal((await result(a, 6)).status, 'conflict');
  a.send(1, 9);
  assert.equal((await result(a, 1)).status, 'result-unavailable');
  a.send(8, 1);
  assert.equal((await result(a, 8)).status, 'gap');
  assert.equal(h.read().checkpoint.revision, 6);
  const op = await h.operatorAdd({ add: 2 });
  assert.equal(op.status, 'committed');
  assert.equal(h.read().checkpoint.state, 8);
  assert.equal(
    h.read().checkpoint.streams.find((x) => x.id === 'operator').through,
    1,
  );
});
test('committed request survives requester loss and replacement grants cannot receive old private reply', async (t) => {
  const d = await directory(t);
  await initializeAuthorityWorkbench({ directory: d });
  const h = await startAuthorityWorkbench({ directory: d });
  t.after(() => h.close());
  const a = await connect(t, h);
  h.holdCommitResponse();
  a.send(1, 4);
  await until(() => h.read().commitResponseHeld);
  assert.equal(h.read().metrics.commits, 1);
  a.socket.terminate();
  await until(() => h.read().peers.length === 0);
  h.releaseCommitResponse();
  await until(() => h.read().status === 'ready');
  const b = await connect(t, h);
  assert.equal(b.frames.at(-1).stateJson, '4');
  assert.equal(b.frames.at(-1).processedThrough, 1);
  assert.notEqual(a.auth.epoch, b.auth.epoch);
  b.send(1, 4);
  assert.equal((await result(b, 1)).status, 'duplicate');
  const replacement = await connect(t, h);
  await until(() => b.socket.readyState === WebSocket.CLOSED);
  assert.equal(
    h.deliverBaseline({
      principal: 'a',
      baseline: { ...replacement.frames.at(-1), session: b.auth.session },
    }),
    false,
  );
  h.revoke('a');
  await until(() => replacement.socket.readyState === WebSocket.CLOSED);
});
test('disclosure coalesces while healthy peer advances, captured baseline replay cannot cross session', async (t) => {
  const d = await directory(t);
  await initializeAuthorityWorkbench({ directory: d });
  const h = await startAuthorityWorkbench({ directory: d });
  t.after(() => h.close());
  const a = await connect(t, h),
    b = await connect(t, h, 'b');
  const old = h.captureBaseline('a');
  h.holdDisclosure({ principal: 'a' });
  const count = a.frames.length;
  await h.operatorAdd({ add: 3 });
  await until(() =>
    b.frames.some((x) => x.type === 'baseline' && x.revision === 1),
  );
  assert.equal(a.frames.length, count);
  h.releaseDisclosure('a');
  await until(() =>
    a.frames.some((x) => x.type === 'baseline' && x.revision === 1),
  );
  assert.equal(h.deliverBaseline({ principal: 'a', baseline: old }), true);
  await until(() => a.frames.at(-1).revision === 0);
  assert.equal(h.read().checkpoint.state, 3);
});
async function child(t, d) {
  const p = fork(new URL('./server.mjs', import.meta.url), [], {
    execArgv: ['--import', 'tsx'],
    env: { ...process.env, AUTHORITY_WORKBENCH_DIRECTORY: d },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  t.after(() => {
    if (p.exitCode === null) p.kill('SIGKILL');
  });
  const messages = [];
  p.on('message', (m) => messages.push(m));
  await until(() => messages.some((x) => x.type === 'ready'));
  let seq = 0;
  return {
    p,
    ...messages.find((x) => x.type === 'ready'),
    async request(method, fields = {}) {
      const id = ++seq;
      p.send({ id, method, ...fields });
      await until(() =>
        messages.some((x) => x.type === 'reply' && x.id === id),
      );
      const r = messages.find((x) => x.type === 'reply' && x.id === id);
      if (r.error) throw Error(r.error);
      return r.value;
    },
  };
}
test('actual process death after database commit before response preserves result and fixed credentials', async (t) => {
  const d = await directory(t);
  await initializeAuthorityWorkbench({ directory: d });
  const h = await child(t, d),
    a = await connect(t, h);
  await h.request('holdCommitResponse', { enabled: true });
  a.send(1, 7);
  let read;
  for (let n = 0; n < 200; n++) {
    read = await h.request('read');
    if (read.commitResponseHeld) break;
    await pause();
  }
  assert.equal(read.commitResponseHeld, true);
  assert.equal(read.metrics.commits, 1);
  assert.equal(
    a.frames.some((x) => x.type === 'result'),
    false,
  );
  h.p.kill('SIGKILL');
  await until(() => h.p.signalCode === 'SIGKILL');
  const next = await child(t, d);
  assert.deepEqual(next.credentials, h.credentials);
  const restored = await connect(t, next);
  assert.equal(restored.frames.at(-1).stateJson, '7');
  assert.equal(restored.frames.at(-1).processedThrough, 1);
  restored.send(1, 7);
  assert.equal((await result(restored, 1)).status, 'duplicate');
  assert.equal((await next.request('read')).checkpoint.revision, 1);
  await next.request('close');
});

test('one pending durable operation refuses new work without queuing it and stale control epochs cannot mutate', async (t) => {
  const d = await directory(t);
  await initializeAuthorityWorkbench({ directory: d });
  const h = await startAuthorityWorkbench({ directory: d });
  t.after(() => h.close());
  const a = await connect(t, h),
    b = await connect(t, h, 'b');
  h.holdCommitResponse();
  a.send(1, 2);
  await until(() => h.read().commitResponseHeld);
  b.send(1, 3);
  assert.equal((await result(b, 1)).status, 'busy');
  assert.equal((await h.operatorAdd({ add: 1 })).status, 'busy');
  assert.equal(h.read().metrics.commands, 1);
  h.releaseCommitResponse();
  await until(() => h.read().status === 'ready');
  assert.equal(h.read().checkpoint.state, 2);
  assert.equal(
    h.read().checkpoint.streams.some((x) => x.id === 'b'),
    false,
  );
  b.frames.length = 0;
  b.socket.send(
    JSON.stringify({
      v: 1,
      type: 'command',
      session: b.auth.session,
      epoch: a.auth.epoch,
      sequence: 1,
      inputJson: '{"add":3}',
    }),
  );
  await pause();
  h.pump();
  await pause();
  assert.equal(h.read().checkpoint.state, 2);
  b.send(1, 3);
  assert.equal((await result(b, 1)).status, 'committed');
  assert.equal(h.read().checkpoint.state, 5);
});
