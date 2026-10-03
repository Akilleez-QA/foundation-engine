import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createParticleView } from './particle-view';
import type { EmitterSlot } from './particle-contract';
import type { ParticleDrawing, SceneParticleOptions } from './scene-particles';

const flush = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)); };
const slots = new Map<number, EmitterSlot>();
const slot = (n: number) => { let s = slots.get(n); if (!s) slots.set(n, s = { entity: n } as unknown as EmitterSlot); return s; };
function drawing() {
  const calls: string[] = [];
  const d: ParticleDrawing = { stats: { bound: 1, visible: 0, requested: 0, leases: 0, applied: 0, failed: 0 },
    bind: s => { calls.push(`bind ${s.entity}`); }, draw: (s, n) => { calls.push(`draw ${s.entity} ${n}`); }, release: s => { calls.push(`release ${s.entity}`); }, dispose: () => { calls.push('dispose'); } };
  return { d, calls };
}
const setup = (load: () => Promise<{ createSceneParticles(o: SceneParticleOptions): ParticleDrawing }>) => {
  const life = new AbortController(), errors: unknown[] = [];
  let ready = 0, loads = 0;
  const view = createParticleView({ scene: new T.Scene(), library: null, signal: life.signal, changed: () => {}, report: e => errors.push(e),
    ready: () => { ready++; }, load: () => { loads++; return load(); } });
  return { view, life, errors, get ready() { return ready; }, get loads() { return loads; } };
};

test('the renderer loads on the first bound emitter, once; waiting emitters are bound when it arrives', async () => {
  const { d, calls } = drawing();
  const t = setup(async () => ({ createSceneParticles: () => d }));
  assert.equal(t.view.state, 'idle'); assert.equal(t.loads, 0, 'nothing loads until an emitter needs it');
  assert.deepEqual(t.view.stats, { bound: 0, visible: 0, requested: 0, leases: 0, applied: 0, failed: 0 });
  t.view.bind(slot(1)); t.view.bind(slot(2)); t.view.release(slot(2)); t.view.draw(slot(1), 4);
  assert.equal(t.view.state, 'loading'); assert.equal(t.loads, 1);
  await flush();
  assert.equal(t.view.state, 'ready'); assert.equal(t.ready, 1);
  assert.deepEqual(calls, ['bind 1'], 'draws before arrival are dropped; a released emitter is never bound');
  t.view.bind(slot(3)); t.view.draw(slot(3), 2); t.view.release(slot(3)); t.view.preload();
  assert.deepEqual(calls.slice(1), ['bind 3', 'draw 3 2', 'release 3']); assert.equal(t.loads, 1);
  t.view.dispose(); t.view.dispose();
  assert.equal(calls.at(-1), 'dispose');
});

test('a renderer that arrives after the visit ends is never created; a failed load is reported once and draws nothing', async () => {
  let created = 0;
  const late = setup(async () => ({ createSceneParticles: () => { created++; return drawing().d; } }));
  late.view.bind(slot(1)); late.life.abort(); late.view.dispose();
  await flush();
  assert.equal(created, 0); assert.equal(late.ready, 0);
  assert.throws(() => late.view.bind(slot(2)), /visit has ended/);
  const failed = setup(async () => { throw Error('chunk failed'); });
  failed.view.bind(slot(1)); await flush();
  assert.equal(failed.view.state, 'failed'); assert.equal(failed.errors.length, 1);
  failed.view.bind(slot(2)); failed.view.draw(slot(2), 3); await flush();
  assert.equal(failed.errors.length, 1, 'no retry within the visit');
  failed.view.dispose();
});

test('a renderer that throws while being created moves to failed, reports once and drops queued emitters', async () => {
  const t = setup(async () => ({ createSceneParticles: () => { throw Error('no context'); } }));
  t.view.bind(slot(1)); t.view.bind(slot(2));
  await flush();
  assert.equal(t.view.state, 'failed'); assert.equal(t.errors.length, 1); assert.equal(t.ready, 0);
  t.view.bind(slot(3)); t.view.preload(); await flush();
  assert.equal(t.errors.length, 1); assert.equal(t.loads, 1, 'no retry within the visit');
  t.view.dispose();
});

test('a waiting emitter that fails to bind when the renderer arrives is handed back to the field', async () => {
  const failed: number[] = [];
  const life = new AbortController(), errors: unknown[] = [];
  const view = createParticleView({ scene: new T.Scene(), library: null, signal: life.signal, changed: () => {}, report: e => errors.push(e), ready: () => {},
    bindFailed: s => { failed.push(s.entity); },
    load: async () => ({ createSceneParticles: () => ({ ...drawing().d, bind: (s: EmitterSlot) => { if (s.entity === 2) throw Error('bind'); } }) }) });
  view.bind(slot(1)); view.bind(slot(2)); await flush();
  assert.deepEqual(failed, [2]); assert.deepEqual(errors, [], 'the field reports it');
  view.dispose();
});
