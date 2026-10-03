import { test } from 'node:test';
import assert from 'node:assert/strict';
import { must } from '../testing/must';
import * as T from 'three';
import { World } from '../core/ecs/world';
import { mulberry32 } from '../core/rng';
import { Transform } from './defs';
import { defineEmitter } from './particles';
import { normalizeSceneParticles } from './particle-contract';
import { createParticleField } from './particle-sim';
import { createSceneParticles } from './scene-particles';
import type { TextureOptions } from '../platform/assets/textures';
import { AbortError } from '../platform/assets/lease-cache';

const flush = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)); };

/** A texture library double: counted leases, optional gate and a failing id. */
function library() {
  const texture = new T.Texture(); texture.userData.shared = true;
  const requests: (TextureOptions & { id: string })[] = [];
  let live = 0, gate: Promise<void> | null = null;
  return {
    texture: async (id: string, o: TextureOptions) => {
      requests.push({ ...o, id });
      if (gate) await gate;
      if (id === 'missing') throw Error('[assets] unknown asset id missing');
      if (o.signal.aborted) throw new AbortError();
      live++;
      let released = false;
      return { value: texture, key: id, id, variant: { path: id, format: 'png' as const }, release: () => { if (!released) { released = true; live--; } } };
    },
    hold() { let open!: () => void; gate = new Promise(r => { open = r; }); return () => { gate = null; open(); }; },
    requests, shared: texture, get live() { return live; },
  };
}

function setup(lib: ReturnType<typeof library> | null = library()) {
  const scene = new T.Scene(), life = new AbortController(), errors: unknown[] = [], world = new World();
  let changed = 0;
  const view = createSceneParticles({ scene, library: lib, signal: life.signal, changed: () => { changed++; }, report: e => errors.push(e) });
  const field = createParticleField({ limits: normalizeSceneParticles(undefined), scale: 1, seed: mulberry32(1), report: e => errors.push(e), renderer: view });
  const meshes = () => scene.children.filter((c): c is T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial> => (c as T.Mesh).isMesh === true);
  return { scene, life, errors, world, view, field, meshes, lib, get changed() { return changed; } };
}

test('one hidden instanced mesh per emitter; drawn only while particles live; uploads only the live prefix', () => {
  const t = setup();
  t.world.spawn(Transform(), defineEmitter({ mode: 'burst', count: 5, bursts: 1, lifetime: [.1, .1] }));
  t.world.spawn(Transform(), defineEmitter({ mode: 'burst', count: 3, bursts: 0 }));
  t.field.step(t.world, 1 / 60);
  const meshes = t.meshes();
  assert.equal(meshes.length, 2);
  const a = must(meshes[0], 'first mesh'), b = must(meshes[1], 'second mesh');
  assert.equal(a.visible, false, 'hidden until written');
  t.field.interpolate(1);
  assert.equal(a.visible, true); assert.equal(b.visible, false, 'an emitter with nothing live costs no draw');
  assert.equal(t.view.stats.visible, 1);
  assert.equal(a.geometry.instanceCount, 5);
  assert.equal(a.geometry.index!.count, 6, 'two triangles per particle');
  const offset = a.geometry.getAttribute('offset') as T.InstancedBufferAttribute;
  assert.deepEqual(offset.updateRanges, [{ start: 0, count: 15 }]);
  assert.equal(offset.usage, T.DynamicDrawUsage);
  assert.equal(a.frustumCulled, false); assert.equal(a.material.depthWrite, false); assert.equal(a.material.blending, T.AdditiveBlending);
  for (let i = 0; i < 10; i++) t.field.step(t.world, 1 / 60);
  t.field.interpolate(1);
  assert.equal(a.visible, false); assert.equal(t.view.stats.visible, 0);
  t.field.dispose(); t.view.dispose();
  assert.equal(t.meshes().length, 0); assert.deepEqual(t.errors, []);
});

test('normal blending maps to three.js normal blending', () => {
  const t = setup();
  t.world.spawn(Transform(), defineEmitter({ blending: 'normal' }));
  t.field.step(t.world, 1 / 60);
  assert.equal(must(t.meshes()[0], 'mesh').material.blending, T.NormalBlending);
  t.field.dispose(); t.view.dispose();
});

test('a particle texture is leased under the visit, applied when it arrives, released (never disposed) with its emitter', async () => {
  const t = setup();
  let disposed = 0; t.lib!.shared.addEventListener('dispose', () => { disposed++; });
  const e = t.world.spawn(Transform(), defineEmitter({ texture: 'spark' }));
  t.field.step(t.world, 1 / 60);
  const m = must(t.meshes()[0], 'mesh');
  assert.equal(must(m.material.uniforms.useMap, 'useMap').value, 0, 'a soft dot until the texture arrives');
  assert.equal(must(t.lib!.requests[0], 'texture request').colorSpace, 'srgb');
  await flush();
  assert.equal(must(m.material.uniforms.map, 'map').value, t.lib!.shared); assert.equal(must(m.material.uniforms.useMap, 'useMap').value, 1);
  assert.equal(t.changed, 0, 'a hidden emitter (nothing alive) needs no redraw when its texture arrives'); assert.equal(t.lib!.live, 1);
  assert.equal(t.view.stats.leases, 1); assert.equal(t.view.stats.requested, 1);
  t.world.despawn(e); t.field.step(t.world, 1 / 60);
  assert.equal(t.lib!.live, 0); assert.equal(disposed, 0, 'the shared texture belongs to the library');
  assert.equal(t.view.stats.leases, 0, 'leases counts what is held now'); assert.equal(t.view.stats.requested, 1);
  t.field.dispose(); t.view.dispose();
});

test('a failed texture is reported once and the emitter keeps drawing its dot; a late texture after release is released', async () => {
  const t = setup();
  t.world.spawn(Transform(), defineEmitter({ texture: 'missing' }));
  t.field.step(t.world, 1 / 60);
  await flush();
  assert.equal(t.errors.length, 1); assert.equal(t.view.stats.failed, 1);
  assert.equal(must(must(t.meshes()[0], 'mesh').material.uniforms.useMap, 'useMap').value, 0);
  const open = t.lib!.hold();
  const e = t.world.spawn(Transform(), defineEmitter({ texture: 'spark' }));
  t.field.step(t.world, 1 / 60);
  t.world.despawn(e); t.field.step(t.world, 1 / 60);
  open(); await flush();
  assert.equal(t.lib!.live, 0, 'an aborted load never holds a lease');
  t.field.dispose(); t.view.dispose();
});

test('leaving the visit disposes every emitter mesh, geometry and material and releases every texture', async () => {
  const t = setup();
  for (let i = 0; i < 3; i++) t.world.spawn(Transform(), defineEmitter({ texture: 'spark', mode: 'continuous' }));
  t.field.step(t.world, 1 / 60); await flush();
  const disposed: string[] = [];
  for (const m of t.meshes()) { m.geometry.addEventListener('dispose', () => disposed.push('g')); m.material.addEventListener('dispose', () => disposed.push('m')); }
  t.life.abort(); t.field.dispose(); t.view.dispose(); t.view.dispose();
  assert.equal(t.meshes().length, 0);
  assert.equal(disposed.length, 6); assert.equal(t.lib!.live, 0);
  assert.throws(() => t.view.bind({} as never), /visit has ended/);
});

test('no texture library: textures never load and emitters still draw', () => {
  const t = setup(null);
  t.world.spawn(Transform(), defineEmitter({ texture: 'spark', bursts: 1 }));
  t.field.step(t.world, 1 / 60); t.field.interpolate(0);
  assert.equal(must(t.meshes()[0], 'mesh').visible, true);
  t.field.dispose(); t.view.dispose();
});

test('a texture arriving for an emitter with live particles redraws once', async () => {
  const t = setup();
  t.world.spawn(Transform(), defineEmitter({ texture: 'spark', bursts: 1, lifetime: [5, 5] }));
  t.field.step(t.world, 1 / 60); t.field.interpolate(1);
  assert.equal(must(t.meshes()[0], 'mesh').visible, true);
  await flush();
  assert.equal(t.changed, 1);
  t.field.dispose(); t.view.dispose();
});

test('a mesh the scene refuses to add is disposed at once and never tracked', () => {
  const t = setup();
  const disposed: string[] = [];
  t.scene.add = () => { throw Error('scene closed'); };
  const slot = { entity: 1, pool: { offset: new Float32Array(3), size: new Float32Array(1), tint: new Float32Array(4) }, blending: 'additive', texture: 'spark', view: undefined } as never;
  const geometryDispose = T.InstancedBufferGeometry.prototype.dispose, materialDispose = T.ShaderMaterial.prototype.dispose;
  T.InstancedBufferGeometry.prototype.dispose = function () { disposed.push('g'); return geometryDispose.call(this); };
  T.ShaderMaterial.prototype.dispose = function () { disposed.push('m'); return materialDispose.call(this); };
  try { assert.throws(() => t.view.bind(slot), /scene closed/); }
  finally { T.InstancedBufferGeometry.prototype.dispose = geometryDispose; T.ShaderMaterial.prototype.dispose = materialDispose; }
  assert.deepEqual(disposed.sort(), ['g', 'm']);
  assert.equal(t.view.stats.bound, 0); assert.equal(t.lib!.requests.length, 0, 'no texture requested for a failed bind');
  t.view.dispose();
});
