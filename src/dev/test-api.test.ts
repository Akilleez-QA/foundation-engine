import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../core/app';
import {createTestApi} from './test-api';

test('public test API trace replacement and disposal preserve the live capture on invalid options', async () => {
  const app = createApp([], {mode: 'test', log() {}});
  const booted = app.boot();
  const api = createTestApi(app, booted);
  await api.ready();
  const first = api.eventTrace();
  try {
    app.events.emit('app.started', {ms: 1});
    assert.equal(first.snapshot().records.length, 2);
    assert.throws(() => api.eventTrace({capacity: 0}), RangeError);
    assert.equal(first.snapshot().disposed, false);
    app.events.emit('app.started', {ms: 2});
    assert.equal(first.snapshot().records.length, 4, 'invalid replacement leaves previous capture installed');

    const next = api.eventTrace({capacity: 3});
    try {
      assert.equal(first.snapshot().disposed, true);
      first.dispose();
      app.events.emit('app.started', {ms: 3});
      assert.equal(first.snapshot().records.length, 4);
      assert.equal(next.snapshot().records.length, 2, 'stale disposal cannot detach replacement');
      const exported = next.snapshot();
      exported.records.length = 0;
      assert.equal(next.snapshot().records.length, 2, 'public export is detached');
      next.dispose();
      app.events.emit('app.started', {ms: 4});
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
  assert.equal(api.particles(), null, 'no game: no particle counters');
  await booted;
  assert.deepEqual(api.entities({expectedEpoch: 0}), {status: 'unavailable'});
  assert.equal(api.systemTrace(), null);
  assert.equal(api.particles(), null);
  app.dispose();
  assert.deepEqual(api.entities({expectedEpoch: 0}), {status: 'unavailable'});
  assert.equal(api.systemTrace(), null);
  assert.equal(api.particles(), null);
});

test('SIM-01: engine.replay.start disarms when navigation fails or the scene never arrives', async () => {
  const {openSceneTickTap} = await import('../author/scene-tick-tap');
  const {World} = await import('../core/ecs/world');
  let fail = true;
  const app = {
    services: {
      router: {
        go: async () => {
          if (fail) throw Error('navigation refused');
        },
      },
    },
    probes: {
      read: (name: string) =>
        name === 'scene' ? {scene: 'scene.demo', state: 'active', epoch: 1, hash: ''} : undefined,
    },
  } as unknown as Parameters<typeof createTestApi>[0];
  const api = createTestApi(app, Promise.resolve({} as never));
  const tapFor = () =>
    openSceneTickTap({
      scene: 'demo',
      game: {id: 'demo', version: '1'},
      inputs: [],
      seed: 1,
      step: 1 / 60,
      world: new World(),
      live: {
        describe: () => null,
        pressed: () => false,
        held: () => false,
        axis: () => 0,
        pointer: {x: 0, y: 0, down: false, pressed: false},
      },
      invalidate() {},
    });
  assert.deepEqual(await api.replay.start({mode: 'record'}), {status: 'refused', reason: 'navigation-failed'});
  assert.deepEqual([api.replay.read().status, api.replay.read().reason], ['stopped', 'navigation-failed']);
  assert.equal(tapFor(), null, 'a later visit does not consume the failed request');
  fail = false;
  assert.deepEqual(await api.replay.start({mode: 'record'}, 50), {status: 'refused', reason: 'arrival-timeout'});
  assert.deepEqual([api.replay.read().status, api.replay.read().reason], ['stopped', 'arrival-timeout']);
  assert.equal(tapFor(), null);
});

test('engine.dispose retires the app through App.dispose once, reports what is left and refuses later clock steps', async () => {
  const app = createApp([], {mode: 'test', log() {}, probes: true});
  const booted = app.boot();
  const api = createTestApi(app, booted);
  await api.ready();
  let disposals = 0;
  const dispose = app.dispose.bind(app);
  (app as {dispose(): void}).dispose = () => {
    disposals++;
    dispose();
  };
  const first = api.dispose();
  assert.equal(disposals, 1, 'the existing kernel teardown path is used');
  assert.equal(first.disposed, true);
  assert.equal(first.running, false);
  assert.deepEqual(first.probes, []);
  assert.equal(first.poolReleased, false, 'nothing rendered, so no lease was returned');
  const again = api.dispose();
  assert.equal(again.disposed, false, 'idempotent');
  assert.equal(disposals, 1);
  assert.throws(() => api.clock.step(16), /disposed/);
  assert.deepEqual(api.entities({expectedEpoch: 0}), {status: 'unavailable'});
});

test('counter trace API: holds the loop sampler slot until disposed; invalid bounds keep the live capture', async () => {
  const {appLoop} = await import('../platform/ui/runtime');
  const app = createApp([], {mode: 'test', log() {}});
  const booted = app.boot();
  const api = createTestApi(app, booted);
  await api.ready();
  assert.equal(api.gpuTiming(), null, 'no running scene: nothing to measure');
  const first = api.counterTrace({gpu: true});
  try {
    assert.equal(first.gpu, null, 'GPU time asked without a scene: no timer, reported null');
    assert.equal(appLoop().hasSampler, true);
    assert.throws(() => api.counterTrace({capacity: 0}), RangeError);
    assert.equal(first.snapshot().disposed, false, 'invalid replacement leaves the capture installed');
    const next = api.counterTrace({capacity: 8});
    assert.equal(first.snapshot().disposed, true, 'a replacement disposes the previous capture');
    assert.equal(appLoop().hasSampler, true);
    first.dispose(); // stale disposal cannot detach the replacement
    assert.equal(appLoop().hasSampler, true);
    next.dispose();
    assert.equal(appLoop().hasSampler, false, 'disposal frees the one sampler slot');
  } finally {
    first.dispose();
    app.dispose();
  }
});
