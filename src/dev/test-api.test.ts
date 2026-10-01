import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../core/app';
import { createTestApi } from './test-api';

test('public test API trace replacement and disposal preserve the live capture on invalid options', async () => {
  const app = createApp([], { mode: 'test', log() {} });
  const booted = app.boot();
  const api = createTestApi(app, booted);
  await api.ready();
  const first = api.eventTrace();
  try {
    app.events.emit('app.started', { ms: 1 });
    assert.equal(first.snapshot().records.length, 2);
    assert.throws(() => api.eventTrace({ capacity: 0 }), RangeError);
    assert.equal(first.snapshot().disposed, false);
    app.events.emit('app.started', { ms: 2 });
    assert.equal(first.snapshot().records.length, 4, 'invalid replacement leaves previous capture installed');

    const next = api.eventTrace({ capacity: 3 });
    try {
      assert.equal(first.snapshot().disposed, true);
      first.dispose();
      app.events.emit('app.started', { ms: 3 });
      assert.equal(first.snapshot().records.length, 4);
      assert.equal(next.snapshot().records.length, 2, 'stale disposal cannot detach replacement');
      const exported = next.snapshot();
      exported.records.length = 0;
      assert.equal(next.snapshot().records.length, 2, 'public export is detached');
      next.dispose();
      app.events.emit('app.started', { ms: 4 });
      assert.equal(next.snapshot().records.length, 2);
      assert.equal(next.snapshot().disposed, true);
    } finally {
      next.dispose();
    }
  } finally {
    first.dispose();
    app.dispose();
  }
});

test('entity metadata API remains optional before boot, without a game, and after disposal', async () => {
  const app = createApp([], {mode: 'test', log() {}});
  const booted = app.boot();
  const api = createTestApi(app, booted);
  assert.deepEqual(api.entities({expectedEpoch: 0}), {status: 'unavailable'});
  assert.equal(api.systemTrace(), null);
  await booted;
  assert.deepEqual(api.entities({expectedEpoch: 0}), {status: 'unavailable'});
  assert.equal(api.systemTrace(), null);
  app.dispose();
  assert.deepEqual(api.entities({expectedEpoch: 0}), {status: 'unavailable'});
  assert.equal(api.systemTrace(), null);
});
