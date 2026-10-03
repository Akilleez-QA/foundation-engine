// RES-01: the creator's residency policy, its per-preset resolution, and the texture/model libraries applying it.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { assetIdOfKey, bindResidency, residencyBudget, validateResidency, type AssetResidencyInput, type AssetResidencyPolicy } from './residency';
import { createTextureLibrary, keepWidth, textureBytes } from './textures';
import { createModelLibrary, modelBytes } from './models';
import { defineGame } from '../../author/defs';
import type { AssetDef } from './manifest';
import type { QualityPreset } from '../../core/tiers';
import {must} from '../../testing/must';

const MiB = 1024 * 1024;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('RES-01: policies validate in defineGame; invalid numbers, fields, presets and pins are refused', () => {
  const game = { id: 'g', title: 'G', version: '1.0.0', firstScene: 'a' };
  assert.doesNotThrow(() => defineGame({ ...game, residency: { textures: { residentBytes: 8 * MiB, warmBytes: 0, ports: { low: { residentBytes: MiB } } }, pinned: ['hero'] } }));
  assert.equal(defineGame(game).residency, undefined, 'off by default');
  for (const bad of [
    { textures: { residentBytes: -1 } },
    { textures: { warmBytes: 1.5 } },
    { models: { limit: 1 } },
    { textures: { ports: { reference: { warmBytes: 1 } } } },
    { textures: { ports: { low: { ports: {} } } } },
    { pinned: ['a', 'a'] },
    { pinned: ['a|b'] },
    { meshes: {} },
    { onPressure: 1 },
  ]) assert.throws(() => defineGame({ ...game, residency: bad as AssetResidencyInput }), /residency/, JSON.stringify(bad));
});

test('RES-01: the budget row is the reference values with the preset port applied', () => {
  const input = validateResidency({ textures: { residentBytes: 96, warmBytes: 32, ports: { low: { warmBytes: 0 }, medium: { residentBytes: 48 } } } });
  assert.deepEqual(residencyBudget(input, 'textures', 'reference'), { residentBytes: 96, warmBytes: 32 });
  assert.deepEqual(residencyBudget(input, 'textures', 'high'), { residentBytes: 96, warmBytes: 32 });
  assert.deepEqual(residencyBudget(input, 'textures', 'medium'), { residentBytes: 48, warmBytes: 32 });
  assert.deepEqual(residencyBudget(input, 'textures', 'low'), { residentBytes: 96, warmBytes: 0 });
  assert.deepEqual(residencyBudget(input, 'models', 'low'), {}, 'an omitted library keeps the default (dispose at once)');
  assert.equal(assetIdOfKey('hero|textures/hero.png|a4'), 'hero');
  assert.equal(assetIdOfKey('bare'), 'bare');
});

function quality(initial: QualityPreset) {
  const listeners = new Set<() => void>();
  return {
    preset: initial,
    subscribe(fn: () => void, signal?: AbortSignal) { listeners.add(fn); signal?.addEventListener('abort', () => listeners.delete(fn)); return () => listeners.delete(fn); },
    set(p: QualityPreset) { this.preset = p; for (const fn of [...listeners]) fn(); },
  };
}

test('RES-01: a binding applies the current preset now, on a preset change once, and stops with its owner', () => {
  const q = quality('reference');
  const applied: AssetResidencyPolicy[] = [];
  const life = new AbortController();
  const logs: string[] = [];
  bindResidency({
    kind: 'textures', quality: q, signal: life.signal, apply: p => applied.push(p),
    log: { warn: m => logs.push(m), error: m => logs.push(m) },
    input: { textures: { residentBytes: 100, warmBytes: 10, ports: { low: { residentBytes: 50 } } }, pinned: ['hero'], onPressure() { throw Error('creator bug'); } },
  });
  assert.equal(applied.length, 1);
  assert.equal(must(applied[0]).residentBytes, 100);
  assert.equal(must(applied[0]).pinned?.('hero|a.png'), true);
  assert.equal(must(applied[0]).pinned?.('heroic|a.png'), false, 'a pin matches the whole asset id');
  q.set('reference');
  assert.equal(applied.length, 1, 'an unchanged preset does not re-apply');
  q.set('low');
  assert.deepEqual([applied.length, must(applied[1]).residentBytes, must(applied[1]).warmBytes], [2, 50, 10]);
  must(applied[1]).onPressure!({ residentBytes: 60, limitBytes: 50, liveBytes: 60, pinnedBytes: 0, warmBytes: 0 });
  assert.deepEqual(logs, ['residency: textures over budget with every remaining asset in use or pinned', 'residency: onPressure failed'],
    'pressure is logged and a throwing creator hook is contained');
  life.abort();
  q.set('medium');
  assert.equal(applied.length, 2);
});

// ── texture library ──

const def = (id: string, width: number): AssetDef => ({
  id, kind: 'texture', title: id, licence: 'original', provenance: {}, colorSpace: 'srgb',
  variants: [{ path: `${id}.png`, format: 'png', width }],
});

/** A decoded image that records close(), like an ImageBitmap. */
class FakeBitmap { closed = 0; constructor(readonly width: number, readonly height: number) {} close() { this.closed++; } }

function textures(policy?: AssetResidencyPolicy) {
  const defs = [def('hero', 256), def('rock', 256), def('tree', 256)];
  const images: FakeBitmap[] = [];
  const library = createTextureLibrary({
    def: id => defs.find(d => d.id === id),
    loadImage: async (_url, _signal, hint) => { const image = new FakeBitmap(hint.width!, hint.width!); images.push(image); return image as never; },
    residency: policy,
  });
  return { library, images };
}

/** Stands in for a WebGLRenderer: holds a GPU copy and a dispose listener until the texture's dispose event. */
function renderer() {
  const copies = new Set<T.Texture>();
  const onDispose = (event: { target: T.Texture }) => { event.target.removeEventListener('dispose', onDispose as never); copies.delete(event.target); };
  return { copies, draw(texture: T.Texture) { if (!copies.has(texture)) { copies.add(texture); texture.addEventListener('dispose', onDispose as never); } },
    holds: (texture: T.Texture) => texture.hasEventListener('dispose', onDispose as never) };
}

test('RES-01: a retained texture drops every renderer copy and listener, keeps its pixels, and re-uploads on the next draw', async () => {
  const { library, images } = textures({ warmBytes: 0, pinned: key => assetIdOfKey(key) === 'hero' });
  const visit = new AbortController();
  const lease = await library.texture('hero', { screenPx: keepWidth(256), signal: visit.signal });
  const first = renderer();
  first.draw(lease.value);
  assert.ok(first.holds(lease.value));
  visit.abort(); // scene exit
  assert.equal(first.holds(lease.value), false, 'the released renderer is no longer reachable from the retained texture');
  assert.equal(first.copies.size, 0);
  assert.equal(lease.value.image, images[0], 'decoded pixels stay for the next upload');
  assert.ok(library.owns(lease.value));
  // Context loss and restore, or the next visit's fresh renderer: the same object is uploaded again from its source.
  const next = await library.texture('hero', { screenPx: keepWidth(256), signal: new AbortController().signal });
  assert.equal(next.value, lease.value);
  assert.ok(next.value.version > 0, 'three uploads a texture whose version is above zero');
  const restored = renderer();
  restored.draw(next.value);
  assert.ok(restored.holds(next.value));
  const s = library.stats();
  assert.deepEqual([s.loads, s.hits, s.uploads, s.evictions, s.reloads], [1, 1, 1, 0, 0]);
  next.release();
  library.setResidency({ warmBytes: 0 }); // teardown: unpinned now, so retired
  assert.equal(library.owns(lease.value), false, 'retired through the library dispose path');
  assert.equal(library.stats().residentMiB, 0);
});

test('RES-01: a texture ceiling evicts released unpinned textures LRU and reports when pins alone exceed it', async () => {
  const bytes = textureBytes({ image: { width: 256, height: 256 } } as T.Texture);
  assert.equal(bytes, Math.round(256 * 256 * 4 * 4 / 3), 'mipmapped RGBA8 descriptor estimate');
  const pressure: number[] = [];
  const { library } = textures({ warmBytes: 4 * bytes, residentBytes: 2 * bytes, onPressure: r => pressure.push(r.residentBytes) });
  const made: T.Texture[] = [];
  for (const id of ['hero', 'rock', 'tree']) {
    const lease = await library.texture(id, { screenPx: keepWidth(256), signal: new AbortController().signal });
    made.push(lease.value);
    lease.release();
  }
  const owned = () => made.map(t => library.owns(t));
  assert.deepEqual(owned(), [false, true, true], 'the least recently used texture went first');
  assert.equal(library.stats().evictions, 1);
  library.setResidency({ warmBytes: 0, residentBytes: bytes, pinned: () => true, onPressure: r => pressure.push(r.residentBytes) });
  assert.deepEqual(pressure, [2 * bytes], 'both remaining textures are pinned: kept and reported once');
  assert.equal(library.stats().pressure, 1);
  assert.deepEqual(owned(), [false, true, true], 'nothing pinned is evicted');
});

// ── model library ──

test('RES-01: a retained model parks its geometry, materials and textures without closing images', async () => {
  const image = new FakeBitmap(4, 4);
  const geometry = new T.BoxGeometry();
  const map = new T.Texture(image as never);
  const material = new T.MeshBasicMaterial({ map });
  const scene = new T.Group().add(new T.Mesh(geometry, material));
  const events: string[] = [];
  geometry.addEventListener('dispose', () => events.push('geometry'));
  material.addEventListener('dispose', () => events.push('material'));
  map.addEventListener('dispose', () => events.push('texture'));
  const library = createModelLibrary({
    def: id => ({ id, kind: 'model', title: id, licence: 'original', provenance: {}, variants: [{ path: `${id}.glb`, format: 'glb' }] }),
    fetchBytes: async () => new ArrayBuffer(8),
    parse: async () => scene,
    residency: { warmBytes: 0, pinned: key => assetIdOfKey(key) === 'hero' },
  });
  const lease = await library.model('hero', { signal: new AbortController().signal });
  const expected = modelBytes(scene);
  assert.ok(expected > 0);
  lease.release();
  assert.deepEqual(events.sort(), ['geometry', 'material', 'texture'], 'renderer copies dropped through public dispose events');
  assert.equal(image.closed, 0);
  assert.equal(library.stats().pinnedMiB, expected / MiB);
  const again = await library.model('hero', { signal: new AbortController().signal });
  assert.equal(again.value.scene, scene, 'no parse: the pinned template is reused');
  again.release();
  library.dispose();
  assert.equal(image.closed, 1, 'teardown retires the pinned model once');
  await settle();
});

function sizedModels(residency?: AssetResidencyPolicy) {
  const scenes = new Map<string, T.Object3D>();
  const library = createModelLibrary({
    def: id => ({ id, kind: 'model', title: id, licence: 'original', provenance: {}, variants: [{ path: `${id}.glb`, format: 'glb' }] }),
    fetchBytes: async () => new ArrayBuffer(8),
    // 150 float32 positions: 600 resident bytes per model.
    parse: async (_bytes, url) => {
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(150), 3));
      const scene = new T.Group().add(new T.Mesh(geometry, new T.MeshBasicMaterial()));
      scenes.set(url, scene);
      return scene;
    },
    maxResidentBytes: 1000,
    residency,
  });
  return { library, scenes };
}

test('RES-01: a retained model yields to a new live one before the model admission limit', async () => {
  const off = sizedModels();
  (await off.library.model('a', { signal: new AbortController().signal })).release();
  const b0 = await off.library.model('b', { signal: new AbortController().signal });
  b0.release();

  const { library } = sizedModels({ warmBytes: 100_000, residentBytes: 1000 });
  (await library.model('a', { signal: new AbortController().signal })).release();
  assert.equal(library.stats().residentMiB * MiB, 600, 'a is retained');
  const b = await library.model('b', { signal: new AbortController().signal });
  assert.equal(library.stats().residentMiB * MiB, 600, 'a was evicted to admit b (A + B > maxResidentBytes)');
  assert.equal(library.stats().evictions, 1);
  b.release();
  library.dispose();
});

test('RES-01: pinned models reduce model admission headroom; the refusal is explicit and unpinning restores it', async () => {
  const { library } = sizedModels({ warmBytes: 0, pinned: key => assetIdOfKey(key) === 'a' });
  (await library.model('a', { signal: new AbortController().signal })).release();
  await assert.rejects(library.model('b', { signal: new AbortController().signal }), /resident budget exceeded/);
  const again = await library.model('a', { signal: new AbortController().signal });
  assert.ok(again.value.scene, 'the pinned model stays usable after the refusal');
  again.release();
  library.setResidency!({ warmBytes: 0 });
  const b = await library.model('b', { signal: new AbortController().signal });
  assert.ok(b.value.scene);
  b.release();
  library.dispose();
});
