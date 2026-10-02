import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createSceneSurfaces } from './scene-materials';
import { createSceneResources } from './scene-resources';
import { MATERIAL_DEFAULTS, type MaterialData } from './material';
import type { TextureOptions } from '../platform/assets/textures';
import { AbortError } from '../platform/assets/lease-cache';

const flush = () => new Promise(resolve => setImmediate(resolve));
const data = (o: Partial<MaterialData> = {}): MaterialData => ({ ...MATERIAL_DEFAULTS, repeat: [1, 1], ...o });

/** A library double: one shared texture per id, counted leases, optional gating and failure. */
function library() {
  const shared = new Map<string, T.Texture>(), requests: TextureOptions[] = [];
  let live = 0, gate: Promise<void> | null = null;
  const lib = {
    requests, get live() { return live; },
    hold() { let open!: () => void; gate = new Promise(r => { open = r; }); return () => { gate = null; open(); }; },
    async texture(id: string, o: TextureOptions) {
      requests.push(o);
      if (gate) await gate;
      if (id === 'missing') throw Error('[assets] unknown asset id missing');
      if (o.signal.aborted) throw new AbortError();
      let texture = shared.get(id);
      if (!texture) { texture = new T.Texture({ width: 4, height: 4 } as HTMLImageElement); texture.userData.shared = true; shared.set(id, texture); }
      live++;
      let released = false;
      const release = () => { if (!released) { released = true; live--; } };
      o.signal.addEventListener('abort', release, { once: true });
      return { value: texture, key: id, id, variant: { path: id, format: 'png' as const }, release };
    },
    shared,
  };
  return lib;
}

test('a shape without Material keeps its original matte material', () => {
  const resources = createSceneResources();
  const surfaces = createSceneSurfaces({ library: library(), resources, signal: new AbortController().signal, anisotropy: 16, changed() {}, report() {} });
  const surface = surfaces.create(undefined, 0x123456);
  assert.ok(surface.material instanceof T.MeshLambertMaterial);
  assert.equal(surface.material.color.getHex(), 0x123456);
  assert.equal(surface.authored, false);
  surface.dispose(); resources.dispose();
});

test('Material maps to a standard material and a wrapped, repeated clone of the leased texture', async () => {
  const lib = library(), resources = createSceneResources();
  let changed = 0;
  const surfaces = createSceneSurfaces({ library: lib, resources, signal: new AbortController().signal, anisotropy: 4, changed: () => { changed++; }, report: e => assert.fail(String(e)) });
  const a = surfaces.create(data({ texture: 'tiles', repeat: [4, 2], wrap: 'mirror', roughness: .3, metalness: .6, emissive: 0x112233, emissiveIntensity: 2, opacity: .5, transparent: true }), 0xffffff);
  const b = surfaces.create(data({ texture: 'tiles', wrap: 'clamp' }), 0xff0000);
  const m = a.material as T.MeshStandardMaterial;
  assert.ok(m instanceof T.MeshStandardMaterial);
  assert.deepEqual([m.roughness, m.metalness, m.emissive.getHex(), m.emissiveIntensity, m.opacity, m.transparent], [.3, .6, 0x112233, 2, .5, true]);
  assert.equal(m.map, null, 'untextured until the lease arrives');
  await flush(); await flush();
  assert.equal(changed, 2);
  assert.deepEqual(lib.requests.map(r => [r.anisotropy, r.colorSpace]), [[4, 'srgb'], [4, 'srgb']]);
  const shared = lib.shared.get('tiles')!;
  const map = m.map!, other = (b.material as T.MeshStandardMaterial).map!;
  assert.notEqual(map, shared, 'the shared lease is never mutated');
  assert.equal(map.source, shared.source, 'the clone draws the same image');
  assert.deepEqual([map.wrapS, map.wrapT, map.repeat.x, map.repeat.y], [T.MirroredRepeatWrapping, T.MirroredRepeatWrapping, 4, 2]);
  assert.deepEqual([other.wrapS, other.repeat.x], [T.ClampToEdgeWrapping, 1]);
  assert.deepEqual([shared.wrapS, shared.repeat.x], [T.ClampToEdgeWrapping, 1]);
  assert.equal(lib.live, 2);
  let disposed = 0; map.addEventListener('dispose', () => { disposed++; });
  a.dispose(); a.dispose();
  assert.equal(disposed, 1); assert.equal(m.map, null); assert.equal(lib.live, 1);
  assert.deepEqual(surfaces.stats, { leased: 2, applied: 2, failed: 0, live: 1 });
  b.dispose(); resources.dispose();
  assert.equal(lib.live, 0);
});

test('leaving the visit before a texture arrives releases it and never applies it', async () => {
  const lib = library(), resources = createSceneResources(), visit = new AbortController();
  const open = lib.hold();
  let changed = 0;
  const surfaces = createSceneSurfaces({ library: lib, resources, signal: visit.signal, anisotropy: 1, changed: () => { changed++; }, report: e => assert.fail(String(e)) });
  const surface = surfaces.create(data({ texture: 'tiles' }), 0xffffff);
  visit.abort(); open(); await flush(); await flush();
  assert.equal((surface.material as T.MeshStandardMaterial).map, null);
  assert.equal(changed, 0); assert.equal(lib.live, 0);
  const late = surfaces.create(data({ texture: 'tiles' }), 0xffffff);
  await flush();
  assert.equal(lib.requests.length, 1, 'no load starts after the visit ended');
  late.dispose(); surface.dispose(); resources.dispose();
});

test('a failed texture is reported once and the surface stays untextured', async () => {
  const lib = library(), resources = createSceneResources(), errors: unknown[] = [];
  const surfaces = createSceneSurfaces({ library: lib, resources, signal: new AbortController().signal, anisotropy: 1, changed() {}, report: e => errors.push(e) });
  const surface = surfaces.create(data({ texture: 'missing' }), 0xffffff);
  await flush(); await flush();
  assert.equal(errors.length, 1); assert.match(String(errors[0]), /missing/);
  assert.equal((surface.material as T.MeshStandardMaterial).map, null);
  assert.equal(surfaces.stats.failed, 1);
  surface.dispose(); resources.dispose();
});

test('invalid runtime data is reported and drawn plain; anisotropy is clamped', () => {
  const lib = library(), resources = createSceneResources(), errors: unknown[] = [];
  const surfaces = createSceneSurfaces({ library: lib, resources, signal: new AbortController().signal, anisotropy: 99, changed() {}, report: e => errors.push(e) });
  const surface = surfaces.create(data({ roughness: 7 }), 0xffffff);
  assert.ok(surface.material instanceof T.MeshLambertMaterial); assert.equal(errors.length, 1);
  assert.notEqual(surface.key, '', 'keyed by the data, so the runtime does not rebuild it every frame');
  surfaces.create(data({ texture: 'tiles' }), 0xffffff);
  assert.equal(lib.requests[0]!.anisotropy, 16);
  resources.dispose();
});

test('without a texture library a textured material draws its colour and loads nothing', () => {
  const resources = createSceneResources();
  const surfaces = createSceneSurfaces({ library: null, resources, signal: new AbortController().signal, anisotropy: 1, changed() {}, report: e => assert.fail(String(e)) });
  const surface = surfaces.create(data({ texture: 'tiles' }), 0x00ff00);
  assert.ok(surface.material instanceof T.MeshStandardMaterial);
  assert.equal(surfaces.stats.leased, 0);
  surface.dispose(); resources.dispose();
});
