/**
 * platform/assets/model-ktx2.ts: KTX2 (Basis Universal, `KHR_texture_basisu`) textures for the model library.
 *
 * A lazy chunk: `models.ts` imports it only when a GLB has a KTX2 image, so a game without one never downloads it,
 * three's `KTX2Loader` or the Basis transcoder. The transcoder files (`basis_transcoder.js` and `.wasm`, Apache-2.0,
 * vendored in three at `examples/jsm/libs/basis/`) are referenced by `KTX2Loader` as `new URL(…, import.meta.url)`:
 * Vite serves them from `node_modules` in dev and emits them as hashed build assets under the build's base, so they
 * follow `--base /sub/` and `--base ./` and never touch a game's `public/` folder.
 *
 * - Inputs: the GLB bytes and the rows `validateEmbeddedGlb` found; a renderer for `KTX2Loader.detectSupport`.
 * - Bounds: `KHR_texture_basisu` images only (vkFormat UNDEFINED: ETC1S or UASTC; one 2D image, no layers, no faces),
 *   at most `MAX_KTX2_SIDE` texels a side; `ktx2WorstBytes` is the admission bound before any transcode.
 * - Failure: a header outside those bounds is refused before the transcoder is fetched. `retireKtx2Loader` ends a
 *   loader for good: its workers terminate, and work that reaches it later rejects instead of starting a new worker.
 */
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';
import {AbortError} from './lease-cache';

/**
 * What `KTX2Loader.detectSupport` reads from a renderer: a WebGL renderer's extensions, or a WebGPU renderer's
 * features (ADR 0078's WebGPU backend). The library keeps no renderer; the loader keeps only the format flags.
 */
export type TextureFormatRenderer =
  | {readonly isWebGPURenderer?: false; readonly extensions: {has(name: string): boolean; get(name: string): unknown}}
  | {readonly isWebGPURenderer: true; hasFeature(name: string): boolean};

export interface CompressedTextureOptions {
  /** The renderer whose formats the transcoder targets; read once, when the first KTX2 model is parsed. */
  renderer(): TextureFormatRenderer | undefined;
  /** Transcoder workers (1 to 8). Default 2. */
  workers?: number;
  /** Creates the loader. Default: three's `KTX2Loader`, imported on the first KTX2 model. Tests replace it. */
  createLoader?(): Promise<KTX2Loader>;
}

/** The GLB's JSON rows the KTX2 step reads, and where its BIN chunk starts (`validateEmbeddedGlb`, models.ts). */
export interface EmbeddedGlb {
  readonly json: GlbJson;
  readonly binAt: number;
  /** Images a texture reads through `KHR_texture_basisu`, or that declare `image/ktx2`; empty for most models. */
  readonly ktx2: readonly number[];
}

export interface GlbJson {
  images?: {bufferView?: unknown; mimeType?: unknown}[];
  textures?: {extensions?: Record<string, {source?: unknown} | undefined>}[];
  bufferViews?: {buffer?: unknown; byteOffset?: unknown; byteLength?: unknown}[];
}

/** One embedded KTX2 image, read from its header before anything is transcoded. */
export interface Ktx2Image {
  readonly width: number;
  readonly height: number;
  /** Mip levels stored (at least 1). */
  readonly levels: number;
}

const KTX2_ID = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
/** Largest KTX2 side the library will transcode. */
export const MAX_KTX2_SIDE = 16384;

/** The header of one embedded KTX2 image; refuses what `KHR_texture_basisu` does not allow. */
export function readKtx2Header(bytes: Uint8Array): Ktx2Image {
  // Identifier (12), nine header words (36), the index (32) and one level row (24).
  if (bytes.byteLength < 104 || KTX2_ID.some((b, i) => bytes[i] !== b)) throw Error('models: invalid KTX2 image');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    u32 = (at: number) => view.getUint32(at, true);
  const vkFormat = u32(12),
    width = u32(20),
    height = u32(24),
    levels = u32(40);
  if (vkFormat !== 0) throw Error('models: KTX2 image must be Basis Universal (ETC1S or UASTC)');
  if (u32(28) !== 0 || u32(32) !== 0 || u32(36) !== 1) throw Error('models: KTX2 image must be one 2D texture');
  if (!width || !height || width > MAX_KTX2_SIDE || height > MAX_KTX2_SIDE)
    throw Error('models: KTX2 image size out of bounds');
  if (levels > 32 - Math.clz32(Math.max(width, height))) throw Error('models: invalid KTX2 image');
  return {width, height, levels: Math.max(1, levels)};
}

/**
 * The most bytes one KTX2 image can occupy once transcoded: per level, the larger of RGBA8 (the uncompressed fallback)
 * and one byte per texel in whole 4×4 blocks (BC7, ASTC 4×4, ETC2 EAC).
 */
export function ktx2WorstBytes(image: Ktx2Image): number {
  let n = 0;
  for (let level = 0; level < image.levels; level++) {
    const w = Math.max(1, image.width >>> level),
      h = Math.max(1, image.height >>> level);
    n += Math.max(w * h * 4, Math.ceil(w / 4) * Math.ceil(h / 4) * 16);
  }
  return n;
}

/** The header of every KTX2 image `glb` names, read from its bufferView in the BIN chunk. */
export function ktx2Images(bytes: ArrayBuffer, glb: EmbeddedGlb): Ktx2Image[] {
  const view = new DataView(bytes),
    {binAt} = glb;
  if (binAt % 4 !== 0 || binAt + 8 > bytes.byteLength || view.getUint32(binAt + 4, true) !== 0x004e4942)
    throw Error('models: invalid GLB');
  const binLength = view.getUint32(binAt, true);
  if (binLength > bytes.byteLength - binAt - 8) throw Error('models: invalid GLB');
  return glb.ktx2.map(i => {
    const row = glb.json.bufferViews?.[glb.json.images?.[i]?.bufferView as number];
    const offset: unknown = row?.byteOffset ?? 0,
      length: unknown = row?.byteLength;
    if (
      !row ||
      (row.buffer ?? 0) !== 0 ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      (offset as number) < 0 ||
      (length as number) < 0 ||
      (offset as number) + (length as number) > binLength
    )
      throw Error('models: invalid KTX2 image');
    return readKtx2Header(new Uint8Array(bytes, binAt + 8 + (offset as number), length as number));
  });
}

/** three's loader, with the transcoder files at three's own (bundled) location. */
export const createKtx2Loader = async (): Promise<KTX2Loader> => new KTX2Loader();

/** Chooses the transcode targets from `renderer`'s formats, bounds the workers, and fetches the transcoder once. */
export async function startKtx2Loader(
  loader: KTX2Loader,
  renderer: TextureFormatRenderer,
  workers: number,
): Promise<void> {
  // Reads extensions only (WebGL) or features (WebGPU); the loader keeps no reference to the renderer.
  loader.setWorkerLimit(workers).detectSupport(renderer as Parameters<KTX2Loader['detectSupport']>[0]);
  await loader.init();
}

const retired = new WeakSet<KTX2Loader>();
/**
 * Ends `loader` for good (see the module comment). Idempotent. Callers retire a loader only after its `init()` settled,
 * so no later step of `init()` can recreate the worker script or the worker creator.
 */
export function retireKtx2Loader(loader: KTX2Loader): void {
  if (retired.has(loader)) return;
  retired.add(loader);
  // dispose() before init() would unbalance three's count of active loaders.
  if (loader.transcoderPending) loader.dispose();
  // A transcode that reaches the loader later waits on this and rejects before it can post to a worker.
  loader.transcoderPending = Promise.reject(Error('models: transcoder disposed'));
  loader.transcoderPending.catch(() => {});
  loader.workerPool.setWorkerCreator(() => {
    throw Error('models: transcoder disposed');
  });
}

export interface Ktx2HostOptions extends CompressedTextureOptions {
  readonly workers: number;
  /** Admission bound: the summed worst case of one GLB's KTX2 images (the library's `maxResidentBytes`). */
  readonly maxBytes: number;
  /** True once the library is disposed. */
  closed(): boolean;
}

/**
 * One library's transcoder: `loader(bytes, glb)` checks the GLB's KTX2 headers and worst-case bytes, then returns the
 * shared `KTX2Loader`, set up on first use (detectSupport against `renderer()`, the transcoder files fetched once). A
 * failed set-up is not kept: the next KTX2 model tries again. `dispose()` retires the loader (the library's disposal).
 */
export function createKtx2Host(o: Ktx2HostOptions) {
  let pending: Promise<KTX2Loader> | undefined,
    active: KTX2Loader | undefined,
    loads = 0;
  const setUp = async (renderer: TextureFormatRenderer): Promise<KTX2Loader> => {
    const loader = await (o.createLoader ?? createKtx2Loader)();
    try {
      if (o.closed()) throw new AbortError();
      await startKtx2Loader(loader, renderer, o.workers);
      if (o.closed()) throw new AbortError();
    } catch (error) {
      retireKtx2Loader(loader);
      throw error;
    }
    return (active = loader);
  };
  return {
    loader(bytes: ArrayBuffer, glb: EmbeddedGlb): Promise<KTX2Loader> {
      let worst = 0;
      for (const image of ktx2Images(bytes, glb)) worst += ktx2WorstBytes(image);
      if (worst > o.maxBytes) return Promise.reject(Error('models: resident budget exceeded'));
      if (pending) return pending;
      if (o.closed()) return Promise.reject(new AbortError());
      const renderer = o.renderer();
      if (!renderer) return Promise.reject(Error('models: KTX2 textures need a bound renderer to choose a GPU format'));
      loads++;
      const next = setUp(renderer);
      pending = next;
      next.catch(() => {
        if (pending === next) pending = undefined;
      });
      return next;
    },
    /** Set-ups started (0 while no model had a KTX2 image). */
    loads: () => loads,
    dispose() {
      // A set-up still in flight sees `closed()` once its transcoder files arrive and retires its own loader.
      if (active) retireKtx2Loader(active);
      active = pending = undefined;
    },
  };
}
