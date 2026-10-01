/**
 * platform/assets/models.ts: `AssetLibrary.model`, the shared glTF cache (
 * `model(id, {signal}): Promise<Lease<ModelTemplate>>`; ADR 0023, ADR 0040; STD-REN-31 to STD-REN-34).
 *
 * A model is asked for by asset id, never by path. Two layers:
 *
 * - **File bytes, once per session.** The GLB is fetched once and its bytes kept in a small LRU bounded in bytes, so a
 *   scene that comes back (the same models on every visit) parses again without a new request.
 *   Bytes are CPU memory only; nothing on the GPU survives a scene.
 * - **Parsed templates, leased.** One parsed scene per (id, variant), shared by every live requester through a
 *   reference-counted `Lease` (the `LeaseCache`). `template.instantiate()` skeleton-clones the node tree and shares geometry,
 *   materials and textures. The library disposes them when the last lease goes and the warm budget has no room.
 *
 * Ownership:
 * - A consumer never disposes template resources. It releases the lease or aborts the signal it passed (its owner's
 *   lifetime). A load that arrives after every requester left is disposed on arrival and never drawn (the late-GLB
 *   leak class), by construction rather than by a `disposed` flag at each site.
 * - Template geometry, materials and textures carry `userData.shared`, the repo's module-lifetime flag, so
 *   `disposeOwnedTree` spares them; `owns()` answers for them through `assetOwners`.
 *
 * Deliberate limits in this step (verbatim looks, STD-REN-27):
 * - Parsing uses three.js's `GLTFLoader` as the sites did, with the meshopt decoder (the only mesh compression, D11).
 *   Draco is not registered: no non-staged model needs it.
 * - The warm template budget defaults to 0 (a released model is disposed as today); the GPU warm LRU arrives with the
 *   quality port, like the texture library's.
 * - The three.js loader modules are imported on the first model request, so this module costs nothing at boot.
 */
import type * as T from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { AbortError, LeaseCache, chooseVariant, type AssetLease } from './lease-cache';
import type { AssetDef, AssetVariant, QualityTier } from './manifest';

/** A parsed model shared by its leases. Treat `scene` as read-only; draw `instantiate()` copies. */
export interface ModelTemplate {
  readonly scene: T.Object3D;
  /** A new node tree that shares this template's geometry, materials and textures. */
  readonly animations: readonly T.AnimationClip[];
  instantiate(): T.Object3D;
  releaseInstance(instance: T.Object3D): void;
}

export interface ModelOptions {
  /** The owner's lifetime. Required: nothing loads without an owner (STD-REN-33). Aborting it releases the lease. */
  signal: AbortSignal;
}

export interface ModelLibraryStats {
  /** Network fetches of model files, by variant path. */
  readonly fetches: Readonly<Record<string, number>>;
  readonly parses: number;
  readonly hits: number;
  readonly lateDrops: number;
  readonly disposed: number;
  readonly bytesKeptMiB: number;
  readonly residentMiB: number;
  readonly instances: number;
}

export interface ModelLibrary {
  /** Leases the parsed model for `id`. Rejects with `AbortError` on abort. */
  model(id: string, o: ModelOptions): Promise<AssetLease<ModelTemplate>>;
  /** True for a template this library holds, or any geometry, material or texture it ever parsed. */
  owns(resource: unknown): boolean;
  stats(): ModelLibraryStats;
  dispose(): void;
}

export interface ModelLibraryOptions {
  /** Resolves an asset id to its def. The composition root binds this to the content packs. */
  def(id: string): AssetDef | undefined | Promise<AssetDef | undefined>;
  /** Fetches one file. Default: `fetch` (what three.js's FileLoader used). */
  fetchBytes?(url: string, signal: AbortSignal): Promise<ArrayBuffer>;
  /** Parses GLB bytes into a scene. Default: three.js's GLTFLoader with the meshopt decoder, loaded on first use. */
  parse?(bytes: ArrayBuffer, url: string): Promise<T.Object3D | ParsedModel>;
  /** Prefix for variant paths (relative to `public/`). Default `/`. */
  base?: string;
  /** CPU bytes of fetched files kept for the session. Default 64 MiB. */
  keepBytes?: number;
  /** GPU bytes of released templates kept for a quick return. Default 0: released models are disposed at once. */
  warmBytes?: number;
  /** Default `reference`. */
  tier?: QualityTier;
  /** Hard admission limits; warm bytes do not substitute for live limits. */
  maxFileBytes?: number;
  maxResidentBytes?: number;
  maxInstances?: number;
  /** Estimated admission bytes, not measured physical memory: node allowance plus per-mesh skeleton buffers. */
  maxInstanceBytes?: number;
  maxPending?: number;
}

export interface ParsedModel { scene: T.Object3D; animations: readonly T.AnimationClip[] }
const MIB = 1024 * 1024;

type Disposable = { dispose(): void; userData: Record<string, unknown> };

/** Every geometry, material and texture a tree draws with, each once. */
export function modelResources(root: T.Object3D): Set<Disposable> {
  const found = new Set<Disposable>();
  root.traverse(object => {
    const mesh = object as Partial<T.Mesh>;
    if (mesh.geometry) found.add(mesh.geometry);
    if (!mesh.material) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      found.add(material);
      for (const value of Object.values(material))
        if (value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture) found.add(value as T.Texture);
    }
  });
  return found;
}

/** Resident bytes: vertex and index buffers, plus mipmapped RGBA8 for each texture. */
export function modelBytes(root: T.Object3D): number {
  let n = 0;
  for (const r of modelResources(root)) {
    const geometry = r as Partial<T.BufferGeometry>;
    if (geometry.attributes) {
      for (const a of Object.values(geometry.attributes)) n += (a as T.BufferAttribute).array?.byteLength ?? 0;
      n += geometry.index?.array.byteLength ?? 0;
      for (const attrs of Object.values(geometry.morphAttributes ?? {})) for (const a of attrs) n += a.array.byteLength;
    }
    const image = (r as Partial<T.Texture>).isTexture ? ((r as T.Texture).image as { width?: number; height?: number } | null) : null;
    if (image) n += Math.round((image.width ?? 0) * (image.height ?? 0) * 4 * (4 / 3));
  }
  return n;
}

const defaultFetch = async (url: string, signal: AbortSignal, limit: number): Promise<ArrayBuffer> => {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`[assets] ${url}: HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw Error('models: file exceeds budget'); }
  if (!response.body) { const bytes = await response.arrayBuffer(); if (bytes.byteLength > limit) throw Error('models: file exceeds budget'); return bytes; }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; length += next.value.byteLength; if (length > limit) throw Error('models: file exceeds budget'); chunks.push(next.value); }
  } catch (error) { await reader.cancel(); throw error; }
  finally { reader.releaseLock(); }
  const data = new Uint8Array(length); let at = 0; for (const chunk of chunks) { data.set(chunk, at); at += chunk.length; } return data.buffer;
};
/** Reject side-loaded dependencies before GLTFLoader can initiate requests outside this lease. */
export function validateEmbeddedGlb(bytes: ArrayBuffer): void {
  if (bytes.byteLength < 20) throw Error('models: invalid GLB');
  const view = new DataView(bytes), length = view.getUint32(12, true);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength || view.getUint32(16, true) !== 0x4e4f534a || length > bytes.byteLength - 20) throw Error('models: invalid GLB');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
  if ([...(json.buffers ?? []), ...(json.images ?? [])].some((row: {uri?: unknown}) => row.uri !== undefined)) throw Error('models: GLB dependencies must be embedded');
  const components: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  let scalars = 0;
  if ((json.accessors?.length ?? 0) > 4096) throw Error('models: accessor budget exceeded');
  for (const accessor of json.accessors ?? []) {
    const width = components[accessor.type];
    if (!width || !Number.isSafeInteger(accessor.count) || accessor.count < 0 || accessor.count > 1048576 || (scalars += accessor.count * width) > 16777216) throw Error('models: decoded accessor budget exceeded');
  }
  if ((json.nodes?.length ?? 0) > 4096 || (json.skins?.length ?? 0) > 128 || (json.animations?.length ?? 0) > 128) throw Error('models: graph budget exceeded');
}

let gltfParser: Promise<(bytes: ArrayBuffer, url: string) => Promise<ParsedModel>> | undefined;
function defaultParse(bytes: ArrayBuffer, url: string): Promise<ParsedModel> {
  validateEmbeddedGlb(bytes);
  gltfParser ??= Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ]).then(([{ GLTFLoader }, { MeshoptDecoder }]) => {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    return async (data: ArrayBuffer, from: string) => {
      const result = await loader.parseAsync(data, from.slice(0, from.lastIndexOf('/') + 1));
      return { scene: result.scene, animations: result.animations };
    };
  });
  gltfParser.catch(() => (gltfParser = undefined));
  return gltfParser.then(parse => parse(bytes, url));
}

export function createModelLibrary(options: ModelLibraryOptions): ModelLibrary {
  const base = options.base ?? '/';
  const tier = options.tier ?? 'reference';
  const fetchBytes = options.fetchBytes ?? ((url: string, signal: AbortSignal) => defaultFetch(url, signal, maxFile));
  const parse = options.parse ?? defaultParse;
  const keepLimit = options.keepBytes ?? 64 * MIB;
  const maxFile = options.maxFileBytes ?? 32 * MIB, maxResident = options.maxResidentBytes ?? 128 * MIB;
  const maxInstanceBytes = options.maxInstanceBytes ?? 32 * MIB;
  const maxInstances = options.maxInstances ?? 128, maxPending = options.maxPending ?? 16;
  for (const n of [keepLimit, maxFile, maxResident, maxInstanceBytes, maxInstances, maxPending, options.warmBytes ?? 0]) if (!Number.isSafeInteger(n) || n < 0) throw Error('models: invalid budget');
  if (!maxFile || !maxResident || !maxInstanceBytes || !maxInstances || !maxPending) throw Error('models: zero admission budget');
  let resident = 0, instanceCount = 0, instanceBytes = 0, pendingCount = 0, activeLoads = 0, closed = false;
  const lifetimes = new Set<AbortController>();
  const slots = new Map<string, AssetVariant>();
  const inside = new WeakSet<object>();
  const fetches: Record<string, number> = {};
  let parses = 0;

  // ── File bytes: shared in flight, then kept (LRU by bytes) for the session.
  const kept = new Map<string, ArrayBuffer>();
  const inFlight = new Map<string, { promise: Promise<ArrayBuffer>; signal: AbortSignal }>();
  let keptBytes = 0;
  function keep(url: string, bytes: ArrayBuffer) {
    if (bytes.byteLength > keepLimit) return;
    const previous = kept.get(url);
    if (previous) keptBytes -= previous.byteLength;
    kept.delete(url);
    kept.set(url, bytes);
    keptBytes += bytes.byteLength;
    for (const [old, b] of kept) {
      if (keptBytes <= keepLimit || old === url) break;
      kept.delete(old);
      keptBytes -= b.byteLength;
    }
  }
  function bytesOf(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
    const have = kept.get(url);
    if (have) {
      kept.delete(url);
      kept.set(url, have); // most recently used last
      return Promise.resolve(have);
    }
    let pending = inFlight.get(url);
    if (!pending || pending.signal.aborted) {
      fetches[url] = (fetches[url] ?? 0) + 1;
      const entry = { signal, promise: Promise.resolve(new ArrayBuffer(0)) };
      entry.promise = fetchBytes(url, signal).then(
        bytes => {
          const current = inFlight.get(url) === entry;
          if (current) inFlight.delete(url);
          if (bytes.byteLength > maxFile) throw Error('models: file exceeds budget');
          if (!closed && current) keep(url, bytes);
          return bytes;
        },
        (error: unknown) => {
          if (inFlight.get(url) === entry) inFlight.delete(url);
          throw error;
        },
      );
      inFlight.set(url, entry); pending = entry;
    }
    return pending.promise;
  }

  // Disposed resources stay marked (flag and `owns`): a consumer tree that still points at one must not dispose it again.
  const release = (scene: T.Object3D) => {
    const errors: unknown[] = [], images = new Set<{close():void}>();
    const attempt = (fn:()=>void) => { try { fn(); } catch (error) { errors.push(error); } };
    for (const resource of modelResources(scene)) {
      const texture = resource as Partial<T.Texture>;
      if (texture.isTexture) for (const image of [texture.image].flat()) {
        if (image && typeof image === 'object' && 'close' in image && typeof image.close === 'function') images.add(image as {close():void});
      }
      attempt(() => resource.dispose());
    }
    for (const image of images) attempt(() => image.close());
    const skeletons = new Set<T.Skeleton>();
    scene.traverse(node => { const skeleton = (node as T.SkinnedMesh).skeleton; if (skeleton) skeletons.add(skeleton); });
    for (const skeleton of skeletons) attempt(() => skeleton.dispose());
    if (errors.length) throw new AggregateError(errors, 'models: cleanup failed');
  };

  const cleanups = new Map<ModelTemplate, () => void>();
  const templateBytes = new WeakMap<ModelTemplate, number>();
  const cache = new LeaseCache<ParsedModel, ModelTemplate>(
    {
      fetch: async (key, signal) => {
        // A requester can leave before a non-cancellable decoder settles. Keep
        // its work slot until the underlying operation actually completes.
        if (activeLoads >= maxPending) throw Error('models: pending budget exceeded');
        activeLoads++;
        try {
          const url = base + slots.get(key)!.path;
          const bytes = await bytesOf(url, signal);
          if (signal.aborted) throw new AbortError();
          parses++;
          const parsed = await parse(bytes, url);
          return 'scene' in parsed ? parsed as ParsedModel : { scene: parsed, animations: [] };
        } finally { activeLoads--; }
      },
      upload: parsed => {
        const { scene } = parsed;
        // Upload owns the decoded scene even when preparation fails before publication.
        let reserved = 0;
        try {
          let bytes = modelBytes(scene);
          for (const clip of parsed.animations) for (const track of clip.tracks) bytes += track.times.byteLength + track.values.byteLength;
          if (!Number.isSafeInteger(bytes) || bytes + resident > maxResident) throw Error('models: resident budget exceeded');
          resident += bytes;
          reserved = bytes;
          const clips = Object.freeze(parsed.animations.map(clip => clip.clone()));
          for (const r of modelResources(scene)) { r.userData.shared = true; inside.add(r); }
          // SkeletonUtils.clone creates a skeleton per SkinnedMesh, even when source meshes share one.
          // Keep the existing node allowance; reserve initial matrices plus padded CPU/GPU bone texture
          // storage (including allocation overlap). This is an estimate, not a physical heap measurement.
          let perInstance = 0;
          const addInstanceBytes = (bytes: number) => {
            if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > Number.MAX_SAFE_INTEGER - perInstance) throw Error('models: instance estimate overflow');
            perInstance += bytes;
          };
          scene.traverse(node => {
            addInstanceBytes(512);
            const mesh = node as T.SkinnedMesh;
            if (!mesh.isSkinnedMesh) return;
            const count = mesh.skeleton.bones.length;
            if (!Number.isSafeInteger(count) || count < 0) throw Error('models: invalid skeleton size');
            const side = Math.max(4, Math.ceil(Math.sqrt(count * 4) / 4) * 4);
            addInstanceBytes(count * 64);
            addInstanceBytes(side * side * 32); // RGBA float CPU array and GPU texture, 16 bytes each per texel
          });
          const instances = new Set<T.Object3D>(); let retired = false;
          const releaseInstance = (root: T.Object3D) => {
            if (!instances.delete(root)) return;
            instanceCount--; instanceBytes -= perInstance;
            const errors: unknown[] = [];
            try { root.removeFromParent(); } catch (error) { errors.push(error); }
            const skeletons = new Set<T.Skeleton>();
            root.traverse(object => { const sk = (object as T.SkinnedMesh).skeleton; if (sk) skeletons.add(sk); });
            for (const skeleton of skeletons) try { skeleton.dispose(); } catch (error) { errors.push(error); }
            if (errors.length) throw new AggregateError(errors, 'models: instance cleanup failed');
          };
          const template: ModelTemplate = { scene, animations: clips,
            instantiate() {
              if (closed || retired) throw Error('models: template retired');
              if (instanceCount >= maxInstances || perInstance > maxInstanceBytes - instanceBytes) throw Error('models: instance budget exceeded');
              const root = cloneSkeleton(scene); instances.add(root); instanceCount++; instanceBytes += perInstance; return root;
            }, releaseInstance,
          };
          templateBytes.set(template, bytes);
          cleanups.set(template, () => {
            if (retired) return; retired = true;
            const errors: unknown[] = [];
            for (const root of instances) try { releaseInstance(root); } catch (error) { errors.push(error); }
            resident -= bytes;
            try { release(scene); } catch (error) { errors.push(error); }
            if (errors.length) throw new AggregateError(errors, 'models: template cleanup failed');
          });
          return template;
        } catch (error) {
          resident -= reserved;
          try { release(scene); }
          catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'models: preparation cleanup failed', { cause: error });
          }
          throw error;
        }
      },
      discard: parsed => release(parsed.scene),
      dispose: template => { const cleanup = cleanups.get(template); cleanups.delete(template); cleanup?.(); },
      bytes: template => templateBytes.get(template) ?? 0,
    },
    { warmBytes: options.warmBytes ?? 0 },
  );

  async function resolve(id: string): Promise<AssetDef> {
    const def = await options.def(id);
    if (!def) throw new Error(`[assets] unknown asset id ${id}`);
    if (def.kind !== 'model') throw new Error(`[assets] ${id} is a ${def.kind}, not a model`);
    return def;
  }

  return {
    async model(id, o) {
      if (closed || o.signal.aborted) throw new AbortError();
      if (pendingCount >= maxPending || activeLoads >= maxPending) throw Error('models: pending budget exceeded');
      pendingCount++;
      const life = new AbortController(); lifetimes.add(life);
      const abort = () => life.abort(); o.signal.addEventListener('abort', abort, { once: true });
      const detach = () => { lifetimes.delete(life); o.signal.removeEventListener('abort', abort); };
      life.signal.addEventListener('abort', detach, { once: true });
      try {
        const def = await resolve(id);
        if (life.signal.aborted) throw new AbortError();
        const variant = chooseVariant(def, { tier }), key = `${id}|${variant.path}`;
        if (!slots.has(key)) slots.set(key, variant);
        const lease = await cache.acquire(key, life.signal);
        return { value: lease.value, key: lease.key, id, variant, release() { life.abort(); lease.release(); detach(); } };
      } catch (error) { life.abort(); throw error; }
      finally { pendingCount--; }
    },
    dispose() { if (closed) return; closed = true; for (const life of lifetimes) life.abort(); try { cache.evictWarm(); } finally { kept.clear(); keptBytes = 0; slots.clear(); } },
    owns: resource => typeof resource === 'object' && resource !== null && (inside.has(resource) || cache.owns(resource)),
    stats: () => ({
      fetches: { ...fetches },
      parses,
      hits: cache.stats.hits,
      lateDrops: cache.stats.lateDrops,
      disposed: cache.stats.disposed,
      bytesKeptMiB: keptBytes / MIB, residentMiB: resident / MIB, instances: instanceCount,
    }),
  };
}
