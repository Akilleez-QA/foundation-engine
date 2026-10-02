import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus } from '../core/events';
import type { FrameRecord, FrameSamplerPort } from '../core/activity/ports';
import type { SceneId } from '../core/router/resolve';
import { createApp } from '../core/app';
import { sessionOptionsFromSearch, startSessionRecording } from './session-recording';
import { createTestApi } from './test-api';
import { appLoop } from '../platform/ui/runtime';

function fakeLoop() {
  let sampler: FrameSamplerPort | undefined;
  return {
    attachSampler(s: FrameSamplerPort) { if (sampler) throw Error('already has a frame sampler'); sampler = s; return () => { if (sampler === s) sampler = undefined; }; },
    get attached() { return sampler !== undefined; },
    frame(r: FrameRecord) { sampler?.frame(r); },
  };
}

test('PERF-01: dev wiring follows scene handover and quality changes, and releases everything on stop', () => {
  const loop = fakeLoop(), events = createEventBus();
  let preset = 'high'; const qualityListeners = new Set<() => void>();
  const rec = startSessionRecording({
    loop, events, preset: () => preset,
    scene: () => ({ scene: 'scene.a', state: 'active', epoch: 3 }),
    onQuality(fn, signal) { qualityListeners.add(fn); signal.addEventListener('abort', () => qualityListeners.delete(fn)); },
  }, { windowMs: 1000 });
  let t = 0;
  const frames = (n: number) => { for (let i = 0; i < n; i++) { t += 16; loop.frame({ timeMs: t, intervalMs: 16, workMs: 1, rendered: true, hidden: false, sinceEnterMs: 0 }); } };
  frames(5);
  events.emit('scene.entering', { to: 'scene.b' as SceneId, from: 'scene.a' as SceneId });
  frames(5);
  events.emit('scene.entered', { id: 'scene.b' as SceneId, epoch: 4 });
  frames(5);
  preset = 'low'; for (const fn of qualityListeners) fn();
  frames(5);
  rec.stop();
  assert.equal(loop.attached, false);
  assert.equal(qualityListeners.size, 0);
  events.emit('scene.entered', { id: 'scene.c' as SceneId, epoch: 5 });
  const e = rec.evidence();
  assert.deepEqual(e.segments.map(s => [s.scene, s.epoch, s.preset]), [['scene.a', 3, 'high'], ['scene.b', 4, 'high'], ['scene.b', 4, 'low']]);
  assert.equal(e.session.frames, 15, 'frames during the handover are not recorded');
  assert.equal(rec.download(), false, 'no document: nothing to save, nothing sent');
  assert.equal(JSON.parse(rec.json()).schema, 'foundation.session-perf');
});

test('PERF-01: address options are explicit and invalid values are rejected by the recorder, not replaced', () => {
  assert.equal(sessionOptionsFromSearch('?flags=dev.silent'), null);
  assert.deepEqual(sessionOptionsFromSearch('?session-record&session-profile=phone-min&session-evidence=physical&session-window-ms=5000&session-overflow=ring'),
    { meta: { profile: 'phone-min', evidence: 'physical', build: undefined }, windowMs: 5000, overflow: 'ring' });
  assert.ok(Number.isNaN(sessionOptionsFromSearch('?session-record&session-window-ms=abc')!.windowMs));
});

test('PERF-01: the test API recorder uses the one app loop; invalid options keep the running recorder', async () => {
  const app = createApp([], { mode: 'test', log() {} });
  const api = createTestApi(app, app.boot());
  await api.ready();
  const loop = appLoop();
  const first = api.sessionRecorder({ windowMs: 1000 });
  try {
    assert.equal(loop.hasSampler, true);
    assert.throws(() => api.sessionRecorder({ windowMs: -1 }), RangeError);
    assert.equal(first.state, 'recording', 'invalid replacement leaves the recorder running');
    const second = api.sessionRecorder();
    assert.equal(first.state, 'disposed');
    assert.equal(loop.hasSampler, true);
    second.stop();
    assert.equal(loop.hasSampler, false);
  } finally { first.dispose(); app.dispose(); }
});
