// AssetLibrary.texture: one decode and one Texture per (id, variant, sampler); variants by on-screen size;
// leases released by release() or the owner's signal; nothing uploads after an abort.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createTextureLibrary, dressTexture, keepWidth, type TextureImage } from './textures';
import { isAbortError } from './lease-cache';
import type { AssetDef } from './manifest';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const wall: AssetDef = {
  id: 'asset.texture.stone-wall',
  kind: 'texture',
  title: 'Stone wall',
  licence: 'CC-BY-4.0',
  provenance: { credit: 'x' },
  colorSpace: 'srgb',
  variants: [
    { path: 'textures/stone/wall-512.jpg', format: 'jpg', width: 512 },
    { path: 'textures/stone/wall-2048.jpg', format: 'jpg', width: 2048 },
    { path: 'textures/stone/wall-4096.jpg', format: 'jpg', width: 4096 },
  ],
};
const doc: AssetDef = { id: 'asset.document.notes', kind: 'document', title: 'n', licence: 'original', provenance: {}, variants: [{ path: 'n.md', format: 'md' }] };

function fixture() {
  const loads: string[] = [];
  const pending: { url: string; resolve: (image: TextureImage) => void; reject: (e: unknown) => void }[] = [];
  const library = createTextureLibrary({
    def: id => [wall, doc].find(d => d.id === id),
    loadImage: url => {
      loads.push(url);
      return new Promise((resolve, reject) => pending.push({ url, resolve, reject }));
    },
  });
  const arrive = async () => {
    await settle();
    for (const p of pending.splice(0)) p.resolve({ width: Number(/(\d{3,4})/.exec(p.url)?.[1] ?? 512), height: 1 });
    await settle();
  };
  return { library, loads, pending, arrive };
}

test('fourteen users of one variant share one load and one Texture; the last release disposes it', async () => {
  const { library, loads, arrive } = fixture();
  const owners = Array.from({ length: 14 }, () => new AbortController());
  const leases = owners.map(o => library.texture('asset.texture.stone-wall', { screenPx: keepWidth(2048), signal: o.signal }));
  await arrive();
  const got = await Promise.all(leases);
  assert.deepEqual(loads, ['/textures/stone/wall-2048.jpg']);
  assert.equal(new Set(got.map(l => l.value)).size, 1);
  const texture = got[0].value;
  assert.equal(texture.colorSpace, T.SRGBColorSpace);
  assert.equal(texture.userData.shared, true, 'disposeOwnedTree and the other module-lifetime guards spare it');
  assert.ok(library.owns(texture));
  assert.equal(got[0].variant.width, 2048);
  let disposed = 0;
  texture.addEventListener('dispose', () => disposed++);
  got.slice(0, 13).forEach(l => l.release());
  owners[13].abort(); // an owner's abort releases its lease too
  assert.equal(disposed, 1);
  assert.equal(library.owns(texture), false);
  assert.deepEqual({ ...library.stats(), residentMiB: 0 }, { residentMiB: 0, warmMiB: 0, loads: 1, hits: 13, uploads: 1, lateDrops: 0, disposed: 1, pinnedMiB: 0, evictions: 0, reloads: 0, pressure: 0, cleanupFailures: 0 });
});

test('variants: the site size picks the file; each variant and each sampler is its own texture', async () => {
  const { library, loads, arrive } = fixture();
  const signal = new AbortController().signal;
  assert.equal((await library.variant('asset.texture.stone-wall', 100)).width, 512);
  assert.equal((await library.variant('asset.texture.stone-wall', keepWidth(2048))).width, 2048);
  assert.equal((await library.variant('asset.texture.stone-wall', keepWidth(4096))).width, 4096);
  assert.equal((await library.variant('asset.texture.stone-wall', 5000)).width, 4096, 'none wide enough: the largest');
  const a = library.texture('asset.texture.stone-wall', { screenPx: keepWidth(2048), signal });
  const b = library.texture('asset.texture.stone-wall', { screenPx: keepWidth(4096), signal });
  const c = library.texture('asset.texture.stone-wall', { screenPx: keepWidth(2048), signal, anisotropy: 8 });
  const d = library.texture('asset.texture.stone-wall', { screenPx: keepWidth(2048), signal, colorSpace: 'linear' });
  await arrive();
  const [ta, tb, tc, td] = (await Promise.all([a, b, c, d])).map(l => l.value);
  assert.equal(new Set([ta, tb, tc, td]).size, 4);
  assert.deepEqual(loads, ['/textures/stone/wall-2048.jpg', '/textures/stone/wall-4096.jpg', '/textures/stone/wall-2048.jpg', '/textures/stone/wall-2048.jpg']);
  assert.equal(tc.anisotropy, 8);
  assert.equal(td.colorSpace, T.NoColorSpace);
  // A resident 4096 is not borrowed for a 2048 request: pixels never depend on which scene came first.
  const again = library.texture('asset.texture.stone-wall', { screenPx: keepWidth(2048), signal });
  assert.equal((await again).value, ta);
});

test('an abort before arrival never uploads; unknown ids and non-textures fail; dressTexture stays silent after abort', async () => {
  const { library, arrive } = fixture();
  const owner = new AbortController();
  const lease = library.texture('asset.texture.stone-wall', { screenPx: 10, signal: owner.signal }).catch((e: unknown) => e);
  await settle();
  owner.abort();
  await arrive();
  assert.ok(isAbortError(await lease));
  assert.equal(library.stats().uploads, 0);
  assert.equal(library.stats().lateDrops, 1);
  await assert.rejects(library.texture('asset.texture.nowhere', { screenPx: 1, signal: new AbortController().signal }), /unknown asset id/);
  await assert.rejects(library.texture('asset.document.notes', { screenPx: 1, signal: new AbortController().signal }), /not a texture/);

  const later = new AbortController();
  let applied = 0;
  dressTexture(library, 'asset.texture.stone-wall', { screenPx: 10, signal: later.signal }, () => applied++);
  later.abort();
  await arrive();
  assert.equal(applied, 0);
  const errors: unknown[] = [];
  dressTexture(library, 'asset.texture.nowhere', { screenPx: 1, signal: new AbortController().signal }, () => applied++, e => errors.push(e));
  await settle();
  assert.equal(errors.length, 1);
});

test('each on-screen size resolves to the smallest variant that covers it, capped by the largest', async () => {
  const library = createTextureLibrary({ def: id => [wall, doc].find(d => d.id === id), loadImage: () => new Promise(() => {}) });
  const want: [number, string][] = [
    [keepWidth(100), 'textures/stone/wall-512.jpg'], [keepWidth(512), 'textures/stone/wall-512.jpg'], [keepWidth(2048), 'textures/stone/wall-2048.jpg'],
    [keepWidth(4096), 'textures/stone/wall-4096.jpg'], [20000, 'textures/stone/wall-4096.jpg'],
  ];
  for (const [px, path] of want) assert.equal((await library.variant('asset.texture.stone-wall', px)).path, path, String(px));
});

test('a bitmap-decoded texture turns flipY off (the flip is in the bitmap) and closes it with the last lease', async () => {
  const g = globalThis as { ImageBitmap?: unknown };
  const saved = g.ImageBitmap;
  class FakeImageBitmap {
    closed = false;
    constructor(readonly width: number, readonly height: number) {}
    close() { this.closed = true; }
  }
  g.ImageBitmap = FakeImageBitmap;
  try {
    const hints: unknown[] = [];
    const bitmap = new FakeImageBitmap(2048, 1024);
    const library = createTextureLibrary({
      def: id => (id === wall.id ? wall : undefined),
      loadImage: async (_url, _signal, hint) => {
        hints.push(hint);
        return bitmap as unknown as ImageBitmap;
      },
    });
    const lease = await library.texture(wall.id, { screenPx: keepWidth(2048), signal: new AbortController().signal });
    assert.equal(lease.value.image, bitmap);
    assert.equal(lease.value.flipY, false);
    assert.equal(lease.value.premultiplyAlpha, false);
    assert.deepEqual(hints, [{ width: 2048, height: undefined }]);
    lease.release();
    assert.equal(bitmap.closed, true);
  } finally {
    g.ImageBitmap = saved;
  }
});

test('texture retirement closes the original bitmap after a failing listener and reports both cleanup failures', async () => {
  const g = globalThis as { ImageBitmap?: unknown };
  const saved = g.ImageBitmap;
  const gpuError = new Error('GPU listener failed');
  const bitmapError = new Error('bitmap close failed');
  class FakeImageBitmap {
    readonly width = 512;
    readonly height = 512;
    closes = 0;
    constructor(readonly failure?: Error) {}
    close() { this.closes++; if (this.failure) throw this.failure; }
  }
  g.ImageBitmap = FakeImageBitmap;
  try {
    for (const failure of [undefined, bitmapError]) {
      const original = new FakeImageBitmap(failure);
      const replacement = new FakeImageBitmap();
      const library = createTextureLibrary({
        def: id => id === wall.id ? wall : undefined,
        loadImage: async () => original as unknown as ImageBitmap,
      });
      const lease = await library.texture(wall.id, { screenPx: 10, signal: new AbortController().signal });
      let disposed = 0;
      lease.value.addEventListener('dispose', () => {
        disposed++;
        lease.value.image = replacement;
        throw gpuError;
      });
      const failures = (error: unknown): unknown[] => error instanceof AggregateError
        ? error.errors.flatMap(failures) : [error];
      assert.throws(() => lease.release(), error => {
        assert.deepEqual(failures(error), failure ? [gpuError, bitmapError] : [gpuError]);
        return true;
      });
      assert.equal(original.closes, 1);
      assert.equal(replacement.closes, 0, 'a listener cannot transfer ownership to unrelated pixels');
      assert.equal(library.owns(lease.value), false);
      assert.equal(library.stats().residentMiB, 0);
      assert.equal(library.stats().warmMiB, 0);
      lease.release();
      assert.equal(disposed, 1);
      assert.equal(original.closes, 1, 'failed retirement is not retried');
    }
  } finally {
    g.ImageBitmap = saved;
  }
});

test('wrap is part of the sampler key: a repeating texture is its own counted texture; clamp keeps the old key', async () => {
  const { library, loads, arrive } = fixture();
  const signal = new AbortController().signal;
  const plain = library.texture('asset.texture.stone-wall', { screenPx: keepWidth(2048), signal });
  const clamp = library.texture('asset.texture.stone-wall', { screenPx: keepWidth(2048), signal, wrap: 'clamp' });
  const tiled = library.texture('asset.texture.stone-wall', { screenPx: keepWidth(2048), signal, wrap: 'repeat' });
  const mirrored = library.texture('asset.texture.stone-wall', { screenPx: keepWidth(2048), signal, wrap: 'mirror' });
  await arrive();
  const [p, c, t, m] = await Promise.all([plain, clamp, tiled, mirrored]);
  assert.equal(p.value, c.value); assert.equal(p.key, c.key);
  assert.deepEqual([t.value.wrapS, t.value.wrapT, m.value.wrapS], [T.RepeatWrapping, T.RepeatWrapping, T.MirroredRepeatWrapping]);
  assert.equal(new Set([p.value, t.value, m.value]).size, 3);
  assert.equal(loads.length, 3);
  assert.ok(library.stats().residentMiB > 0);
  await assert.rejects(library.texture('asset.texture.stone-wall', { screenPx: 10, signal, wrap: 'spiral' as never }), /unknown wrap/);
});
