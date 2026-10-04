// KTX2 model textures: the transcoder is created and fetched only for a model with a KTX2 image, once per library;
// it targets the bound renderer's formats; transcoded textures count their GPU bytes; refusals happen before any
// transcoder exists; a late transcode is dropped; and the transcoder is retired with the library.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import * as T from 'three';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';
import {createModelLibrary, modelBytes, type ModelLibraryOptions, type TextureFormatRenderer} from './models';
import {ktx2WorstBytes, readKtx2Header} from './model-ktx2';
import {textureBytes} from './texture-bytes';
import {isAbortError} from './lease-cache';
import type {AssetDef} from './manifest';
import {editKtx2, levelSides, quadGlb, quadrantKtx2} from '../../testing/ktx2-fixture';

// GLTFLoader reads `self.URL` for embedded images, and three's FileLoader reports progress events; Node has neither.
(globalThis as {self?: unknown}).self ??= globalThis;
(globalThis as {ProgressEvent?: unknown}).ProgressEvent ??= class extends Event {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
  constructor(type: string, init: {lengthComputable?: boolean; loaded?: number; total?: number} = {}) {
    super(type);
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
};
const MIB = 1024 * 1024;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const def = (id: string): AssetDef => ({
  id,
  kind: 'model',
  title: id,
  licence: 'original',
  provenance: {},
  variants: [{path: `models/${id}.glb`, format: 'glb'}],
});
const beacon = readFileSync(
  join(import.meta.dirname, '../../../templates/mechanics/game/public/models/mechanics/beacon.glb'),
);
const files: Record<string, ArrayBuffer> = {
  beacon: beacon.buffer.slice(beacon.byteOffset, beacon.byteOffset + beacon.byteLength),
  quad: quadGlb(quadrantKtx2(64)),
};
// A WebGL renderer with no compressed format: KTX2Loader must choose its uncompressed fallback.
const plainRenderer: TextureFormatRenderer = {extensions: {has: () => false, get: () => null}};
/** BC7-sized levels of the 64² fixture: 343 blocks of 16 bytes. */
const bc7Levels = () =>
  levelSides(64).map(side => ({data: new Uint8Array(Math.ceil(side / 4) ** 2 * 16), width: side, height: side}));
const BC7_BYTES = 343 * 16;
/** Quad geometry: 4 positions, 4 UVs, 6 16-bit indices. */
const QUAD_GEOMETRY_BYTES = 48 + 32 + 12;

/** A KTX2Loader that transcodes nothing: `init` and each texture can be held, and calls are counted. */
class FakeKtx2 extends KTX2Loader {
  detected: unknown[] = [];
  inits = 0;
  loads = 0;
  disposals = 0;
  holdInit: Promise<void> | undefined;
  holdLoad: Promise<void> | undefined;
  made: T.CompressedTexture[] = [];
  disposedTextures: T.Texture[] = [];
  constructor(
    private readonly make: () => T.CompressedTexture = () =>
      new T.CompressedTexture(bc7Levels(), 64, 64, T.RGBA_BPTC_Format),
  ) {
    super();
  }
  override detectSupport(renderer: Parameters<KTX2Loader['detectSupport']>[0]): this {
    this.detected.push(renderer);
    return super.detectSupport(renderer);
  }
  override init(): Promise<void> {
    this.inits++;
    return (this.transcoderPending ??= this.holdInit ?? Promise.resolve());
  }
  override load(_url: string, onLoad: (texture: T.CompressedTexture) => void): void {
    this.loads++;
    void Promise.resolve(this.holdLoad).then(() => {
      const texture = this.make();
      texture.addEventListener('dispose', () => this.disposedTextures.push(texture));
      this.made.push(texture);
      onLoad(texture);
    });
  }
  override dispose(): void {
    this.disposals++;
    super.dispose();
  }
}

function library(o: Partial<ModelLibraryOptions> & {loader?: FakeKtx2; renderer?: TextureFormatRenderer | null} = {}) {
  const created: FakeKtx2[] = [];
  const lib = createModelLibrary({
    def: id => def(id),
    fetchBytes: async url => files[url.replace(/^.*\/|\.glb$/g, '')]!,
    compressedTextures: {
      renderer: () => (o.renderer === null ? undefined : (o.renderer ?? plainRenderer)),
      createLoader: async () => {
        const loader = o.loader ?? new FakeKtx2();
        created.push(loader);
        return loader;
      },
    },
    ...o,
  });
  return {lib, created};
}

test('a model without KTX2 images never creates or fetches the transcoder; a KTX2 model fetches it once', async () => {
  const realFetch = globalThis.fetch,
    requested: string[] = [];
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!/basis_transcoder/.test(url)) return realFetch(input, init);
    requested.push(url.replace(/^.*\//, ''));
    return Promise.resolve(new Response(/\.wasm$/.test(url) ? new ArrayBuffer(8) : '/* transcoder */'));
  };
  // The default loader: three's KTX2Loader with its own transcoder location. Node has no Worker, so each transcode
  // fails after the files arrive, and GLTFLoader (as for any texture that fails to decode) logs it and keeps the model
  // untextured. What this test measures is whether and how often the transcoder files are requested.
  const lib = createModelLibrary({
    def: id => def(id),
    fetchBytes: async url => files[url.replace(/^.*\/|\.glb$/g, '')]!,
    compressedTextures: {renderer: () => plainRenderer},
  });
  try {
    for (let i = 0; i < 2; i++) {
      const lease = await lib.model('beacon', {signal: new AbortController().signal});
      lease.release();
    }
    assert.deepEqual(requested, []);
    assert.equal(lib.stats().transcoderLoads, 0);
    assert.equal(lib.stats().compressedTextures, 0);
    const untextured = async () => {
      const lease = await lib.model('quad', {signal: new AbortController().signal});
      const mesh = lease.value.scene.getObjectByName('quad') as T.Mesh;
      assert.equal((mesh.material as T.MeshBasicMaterial).map, null);
      lease.release();
    };
    const error = console.error;
    console.error = () => {};
    try {
      await untextured();
      assert.deepEqual(requested.sort(), ['basis_transcoder.js', 'basis_transcoder.wasm']);
      await untextured();
    } finally {
      console.error = error;
    }
    assert.equal(requested.length, 2, 'the transcoder files are fetched once per library');
    assert.equal(lib.stats().transcoderLoads, 1);
  } finally {
    globalThis.fetch = realFetch;
    lib.dispose();
  }
});

test('KTX2 textures are transcoded for the bound renderer and counted at their transcoded bytes', async () => {
  const {lib, created} = library();
  const lease = await lib.model('quad', {signal: new AbortController().signal});
  const loader = created[0]!;
  assert.equal(created.length, 1);
  assert.deepEqual(loader.detected, [plainRenderer]);
  // No compressed format on this renderer: KTX2Loader's worker would choose its RGBA8 fallback.
  assert.equal(loader.workerConfig.astcSupported || loader.workerConfig.bptcSupported, false);
  const mesh = lease.value.scene.getObjectByName('quad') as T.Mesh;
  const map = (mesh.material as T.MeshBasicMaterial).map!;
  assert.ok((map as T.CompressedTexture).isCompressedTexture);
  assert.equal(textureBytes(map), BC7_BYTES);
  assert.equal(modelBytes(lease.value.scene), BC7_BYTES + QUAD_GEOMETRY_BYTES);
  const stats = lib.stats();
  assert.equal(stats.compressedTextures, 1);
  assert.equal(stats.compressedTextureMiB! * MIB, BC7_BYTES);
  assert.equal(stats.residentMiB * MIB, BC7_BYTES + QUAD_GEOMETRY_BYTES);
  assert.equal(stats.transcoderLoads, 1);
  lease.release();
  assert.equal(lib.stats().compressedTextures, 0);
  assert.equal(lib.stats().residentMiB, 0);
  const again = await lib.model('quad', {signal: new AbortController().signal});
  assert.equal(created.length, 1, 'one transcoder per library');
  assert.equal(loader.inits, 1);
  again.release();
  lib.dispose();
});

test('texture bytes: RGBA8 images, compressed levels, the uncompressed fallback and compressed cube faces', () => {
  assert.equal(textureBytes({image: {width: 64, height: 64}} as T.Texture), 21845);
  assert.equal(textureBytes(new T.CompressedTexture(bc7Levels(), 64, 64, T.RGBA_BPTC_Format)), BC7_BYTES);
  // The uncompressed fallback: RGBA8 levels in a CompressedTexture, as KTX2Loader's transcoder returns them.
  const rgba = levelSides(64).map(side => ({data: new Uint8Array(side * side * 4), width: side, height: side}));
  assert.equal(textureBytes(new T.CompressedTexture(rgba, 64, 64)), 21844);
  const cube = new T.CompressedCubeTexture(
    Array.from({length: 6}, () => new T.CompressedTexture(bc7Levels(), 64, 64, T.RGBA_BPTC_Format)),
    T.RGBA_BPTC_Format,
  );
  assert.equal(textureBytes(cube), 6 * BC7_BYTES);
});

test('KTX2 refusals happen before any transcoder exists', async () => {
  const image = quadrantKtx2(64);
  assert.deepEqual(readKtx2Header(image), {width: 64, height: 64, levels: 7});
  assert.equal(ktx2WorstBytes(readKtx2Header(image)), 21856);
  const refused: [string, ArrayBuffer, RegExp, Partial<ModelLibraryOptions> & {renderer?: null}][] = [
    ['not Basis', quadGlb(editKtx2(image, {12: 37})), /Basis Universal/, {}],
    ['layered', quadGlb(editKtx2(image, {32: 2})), /one 2D texture/, {}],
    ['cube', quadGlb(editKtx2(image, {36: 6})), /one 2D texture/, {}],
    ['too wide', quadGlb(editKtx2(image, {20: 32768})), /size out of bounds/, {}],
    ['too many levels', quadGlb(editKtx2(image, {40: 9})), /invalid KTX2/, {}],
    ['not KTX2', quadGlb(image.slice(1)), /invalid KTX2/, {}],
    ['one byte over admission', files.quad!, /resident budget exceeded/, {maxResidentBytes: 21855}],
    ['no renderer bound', files.quad!, /bound renderer/, {renderer: null}],
  ];
  for (const [name, glb, reason, o] of refused) {
    files.refused = glb;
    const {lib, created} = library(o);
    await assert.rejects(lib.model('refused', {signal: new AbortController().signal}), reason, name);
    assert.equal(created.length, 0, name);
    assert.equal(lib.stats().transcoderLoads, 0, name);
    lib.dispose();
  }
  const unset = createModelLibrary({def: id => def(id), fetchBytes: async () => files.quad!});
  await assert.rejects(unset.model('quad', {signal: new AbortController().signal}), /not enabled/);
  unset.dispose();
  // Exactly at the admission bound, the model loads.
  const {lib} = library({maxResidentBytes: 21856});
  (await lib.model('quad', {signal: new AbortController().signal})).release();
  lib.dispose();
});

test('an owner that leaves while the transcoder arrives costs no transcode', async () => {
  const loader = new FakeKtx2();
  let arrive!: () => void;
  loader.holdInit = new Promise(resolve => (arrive = resolve));
  const {lib} = library({loader});
  const owner = new AbortController(),
    pending = lib.model('quad', {signal: owner.signal});
  await settle();
  assert.equal(loader.inits, 1);
  owner.abort();
  await assert.rejects(pending, isAbortError);
  arrive();
  await settle();
  await settle();
  assert.equal(loader.loads, 0, 'no texture was transcoded for the departed owner');
  assert.equal(lib.stats().residentMiB, 0);
  // The transcoder is ready for the next owner.
  (await lib.model('quad', {signal: new AbortController().signal})).release();
  assert.equal(loader.loads, 1);
  lib.dispose();
});

test('a transcode that completes after its owner left is dropped and its texture disposed', async () => {
  const loader = new FakeKtx2();
  let finish!: () => void;
  loader.holdLoad = new Promise(resolve => (finish = resolve));
  const {lib} = library({loader});
  const owner = new AbortController(),
    pending = lib.model('quad', {signal: owner.signal});
  for (let i = 0; i < 5 && loader.loads === 0; i++) await settle();
  assert.equal(loader.loads, 1);
  owner.abort();
  await assert.rejects(pending, isAbortError);
  finish();
  for (let i = 0; i < 10 && lib.stats().lateDrops === 0; i++) await settle();
  assert.equal(lib.stats().lateDrops, 1);
  assert.equal(loader.made.length, 1);
  // The transcoded texture the late scene held is released (disposed once), never published.
  assert.deepEqual(loader.disposedTextures, loader.made);
  assert.equal(lib.stats().compressedTextures, 0);
  assert.equal(lib.stats().residentMiB, 0);
  lib.dispose();
});

test('library disposal retires the transcoder: workers end and later work rejects without a new worker', async () => {
  const loader = new FakeKtx2();
  const {lib} = library({loader});
  (await lib.model('quad', {signal: new AbortController().signal})).release();
  lib.dispose();
  lib.dispose();
  assert.equal(loader.disposals, 1);
  await assert.rejects(loader.init(), /transcoder disposed/);
  await assert.rejects(loader.workerPool.postMessage({type: 'transcode'}, []), /transcoder disposed/);
  assert.equal(loader.workerPool.workers.length, 0);
  await assert.rejects(lib.model('quad', {signal: new AbortController().signal}), isAbortError);
});

test('disposal during transcoder set-up retires the loader once its files arrive', async () => {
  const loader = new FakeKtx2();
  let arrive!: () => void;
  loader.holdInit = new Promise(resolve => (arrive = resolve));
  const {lib} = library({loader});
  const pending = lib.model('quad', {signal: new AbortController().signal});
  await settle();
  lib.dispose();
  await assert.rejects(pending, isAbortError);
  arrive();
  await settle();
  await settle();
  assert.equal(loader.disposals, 1);
  assert.equal(loader.loads, 0);
  await assert.rejects(loader.workerPool.postMessage({type: 'transcode'}, []), /transcoder disposed/);
});

test('transcoder workers are bounded', () => {
  for (const workers of [0, 9, 1.5])
    assert.throws(
      () => createModelLibrary({def: () => undefined, compressedTextures: {renderer: () => undefined, workers}}),
      /invalid transcoder workers/,
    );
});
