/**
 * platform/assets/textures.ts: `AssetLibrary.texture`, the shared texture cache (ADR 0023, ADR 0040;
 * STD-REN-31 to STD-REN-34).
 *
 * A texture is asked for by asset id and on-screen size, never by path. The library picks the variant
 * (`chooseVariant`: the smallest at least 2 texels per on-screen pixel at the reference resolution), decodes the file
 * once and hands every requester the same `THREE.Texture` through a reference-counted `Lease`. Each renderer that draws
 * it uploads it once to its own context, so N users of one variant cost one decode and one upload per context, not N.
 *
 * Ownership:
 * - A consumer never disposes a leased texture. It calls `release()` or aborts the signal it passed (its owner's
 *   lifetime). The library disposes the texture when the last lease goes and the warm budget has no room for it.
 * - Leased textures carry `userData.shared`, the repo's module-lifetime flag, so `disposeOwnedTree` and the other
 *   existing guards spare them, and `owns()` answers for the new code (D11: `owns` replaces the flag as the
 *   remaining guards migrate).
 * - The sampler is part of the key: an anisotropy other than three.js's default is a separate texture (one more
 *   upload), never a mutation of a shared one.
 *
 * Deliberate limits in this step (verbatim looks, STD-REN-27):
 * - The chosen variant is exactly the one asked for. The lease cache's "reuse a resident larger variant" would make a
 *   map's pixels depend on which scene was visited first, so it waits for the quality port.
 * - The tier is `reference` with no width cap, and the warm budget defaults to 0 (a released texture is disposed as
 *   today). Per-tier caps and the warm LRU arrive with the quality port and a bench that separates warm from live.
 *
 * Decode: the app passes `decode-image.ts`'s worker decoder as `loadImage`, so every library texture
 * arrives as an `ImageBitmap` decoded off the main thread and its upload decodes nothing. The bitmap already carries
 * three.js's `<img>` defaults (flipped, not premultiplied, no colour conversion), so its texture sets `flipY = false`
 * and draws the same pixels. The default loader stays three.js's ImageLoader for callers without a worker host.
 */
import * as T from 'three';
import { AbortError, LeaseCache, TEXELS_PER_PIXEL, chooseVariant, isAbortError, type AssetLease } from './lease-cache';
import type { AssetDef, AssetVariant, QualityTier } from './manifest';
import type { AssetResidencyPolicy } from './residency';

export interface TextureOptions {
  /** On-screen size in CSS pixels at the reference resolution (the widest the map is drawn). */
  screenPx: number;
  /** The owner's lifetime. Required: nothing loads without an owner (STD-REN-33). Aborting it releases the lease. */
  signal: AbortSignal;
  /** Sampler anisotropy. Default 1, three.js's default. */
  anisotropy?: number;
  /** Overrides the def's colour space, e.g. `linear` for a map used as an alpha mask. */
  colorSpace?: 'srgb' | 'linear';
}

/**
 * The `screenPx` that selects a variant exactly `width` texels wide (when the def has one): for a site that keeps
 * today's map verbatim (STD-REN-27) until the quality port sizes it by what it really covers on screen.
 */
export const keepWidth = (width: number): number => width / TEXELS_PER_PIXEL;

export interface TextureLibraryStats {
  readonly residentMiB: number;
  readonly warmMiB: number;
  readonly loads: number;
  readonly hits: number;
  readonly uploads: number;
  readonly lateDrops: number;
  readonly disposed: number;
  /** Released textures kept because they are pinned (RES-01). */
  readonly pinnedMiB: number;
  /** Retained textures disposed by a budget, and later loads of such a key. */
  readonly evictions: number;
  readonly reloads: number;
  /** Transitions into an over-ceiling state that eviction could not relieve. */
  readonly pressure: number;
  readonly cleanupFailures: number;
}

export interface TextureLibrary {
  /** Leases the texture for `id` at the variant its on-screen size needs. Rejects with `AbortError` on abort. */
  texture(id: string, o: TextureOptions): Promise<AssetLease<T.Texture>>;
  /** The variant `texture(id, {screenPx})` would load. */
  variant(id: string, screenPx: number): Promise<AssetVariant>;
  /** The URL of a variant file (for `<img>` and CSS). */
  url(variant: AssetVariant): string;
  /** True for any texture this library holds. Tree disposal must skip these. */
  owns(resource: unknown): boolean;
  stats(): TextureLibraryStats;
  /** Applies a residency policy (RES-01). Live leases are never evicted; see docs/guides/asset-residency.md. */
  setResidency(policy: AssetResidencyPolicy): void;
}

/** Decoded image data a `THREE.Texture` can take. */
export type TextureImage = HTMLImageElement | ImageBitmap | { width: number; height: number };

export interface TextureLibraryOptions {
  /** Resolves an asset id to its def. The composition root binds this to the content packs. */
  def(id: string): AssetDef | undefined | Promise<AssetDef | undefined>;
  /**
   * Fetches and decodes one file. Default: three.js's ImageLoader, as `TextureLoader` used. An `ImageBitmap` must be
   * decoded with `IMAGE_BITMAP_OPTIONS` (`decode-image.ts`): the texture then turns `flipY` off. `hint` is the variant's
   * declared size, for the decoder's memory admission.
   */
  loadImage?(url: string, signal: AbortSignal, hint: { width?: number; height?: number }): Promise<TextureImage>;
  /** Prefix for variant paths (relative to `public/`). Default `/`. */
  base?: string;
  /** Bytes of released textures kept for a quick return. Default 0: released textures are disposed at once. */
  warmBytes?: number;
  /** Default `reference`. */
  tier?: QualityTier;
  /** Optional residency policy (RES-01). Its `warmBytes` replaces `warmBytes`. */
  residency?: AssetResidencyPolicy;
}

interface Slot {
  readonly def: AssetDef;
  readonly variant: AssetVariant;
  readonly anisotropy: number;
  readonly colorSpace: 'srgb' | 'linear';
}

const MIB = 1024 * 1024;

const isImageBitmap = (image: unknown): image is ImageBitmap =>
  typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap;

const defaultLoadImage = (url: string): Promise<TextureImage> => new T.ImageLoader().loadAsync(url);

/** Mipmapped RGBA8: the four bytes per texel plus a third for the mip chain. */
export function textureBytes(texture: T.Texture): number {
  const image = texture.image as { width?: number; height?: number } | undefined;
  return Math.round((image?.width ?? 0) * (image?.height ?? 0) * 4 * (4 / 3));
}

/** The cache key: asset id and variant, plus the sampler and colour space when they are not the defaults. */
export function textureKey(id: string, variant: AssetVariant, anisotropy = 1, colorSpace?: 'srgb' | 'linear'): string {
  return `${id}|${variant.path}${anisotropy === 1 ? '' : `|a${anisotropy}`}${colorSpace ? `|${colorSpace}` : ''}`;
}

export function createTextureLibrary(options: TextureLibraryOptions): TextureLibrary {
  const base = options.base ?? '/';
  const tier = options.tier ?? 'reference';
  const load = options.loadImage ?? defaultLoadImage;
  const slots = new Map<string, Slot>();
  const url = (variant: AssetVariant) => base + variant.path;

  const cache = new LeaseCache<{ slot: Slot; image: TextureImage }, T.Texture>(
    {
      fetch: async (key, signal) => {
        const slot = slots.get(key)!;
        const { width, height } = slot.variant;
        return { slot, image: await load(url(slot.variant), signal, { width, height }) };
      },
      upload: ({ slot, image }, key) => {
        // What TextureLoader did, plus the def's colour space and the requested sampler.
        const texture = new T.Texture(image as HTMLImageElement);
        texture.name = key;
        texture.colorSpace = slot.colorSpace === 'srgb' ? T.SRGBColorSpace : T.NoColorSpace;
        texture.anisotropy = slot.anisotropy;
        // A bitmap is decoded already flipped (IMAGE_BITMAP_OPTIONS); WebGL ignores flipY for one and WebGPU would
        // flip it a second time.
        if (isImageBitmap(image)) texture.flipY = false;
        texture.userData.shared = true;
        texture.needsUpdate = true;
        return texture;
      },
      discard: ({ image }) => {
        if (isImageBitmap(image)) image.close();
      },
      dispose: texture => {
        const image = texture.image;
        const errors: unknown[] = [];
        try { texture.dispose(); } catch (error) { errors.push(error); }
        // The decoded pixels go with the last lease; nothing else holds the bitmap.
        // Disposal listeners may throw or replace texture.image; retire the original pixels regardless.
        if (isImageBitmap(image)) try { image.close(); } catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, 'textures: cleanup failed');
      },
      // Retained after release: every renderer drops its GPU copy and its listener; the decoded image stays for a
      // later upload (three's public dispose event, as releaseSharedRendererTextures uses).
      park: texture => texture.dispose(),
      bytes: textureBytes,
    },
    { warmBytes: options.residency?.warmBytes ?? options.warmBytes ?? 0, residency: options.residency },
  );

  async function resolve(id: string): Promise<AssetDef> {
    const def = await options.def(id);
    if (!def) throw new Error(`[assets] unknown asset id ${id}`);
    if (def.kind !== 'texture') throw new Error(`[assets] ${id} is a ${def.kind}, not a texture`);
    return def;
  }

  const pick = (def: AssetDef, screenPx: number) => chooseVariant(def, { screenPx, tier });

  return {
    async texture(id, o) {
      if (o.signal.aborted) throw new AbortError();
      const def = await resolve(id);
      if (o.signal.aborted) throw new AbortError();
      const variant = pick(def, o.screenPx);
      const anisotropy = o.anisotropy ?? 1;
      const colorSpace = o.colorSpace ?? def.colorSpace ?? 'linear';
      const key = textureKey(id, variant, anisotropy, colorSpace === (def.colorSpace ?? 'linear') ? undefined : colorSpace);
      if (!slots.has(key)) slots.set(key, { def, variant, anisotropy, colorSpace });
      const lease = await cache.acquire(key, o.signal);
      return { value: lease.value, key: lease.key, id, variant, release: lease.release };
    },
    async variant(id, screenPx) {
      return pick(await resolve(id), screenPx);
    },
    url,
    owns: resource => cache.owns(resource),
    stats: () => ({
      residentMiB: cache.residentBytes() / MIB,
      warmMiB: cache.warmBytes() / MIB,
      loads: cache.stats.loads,
      hits: cache.stats.hits,
      uploads: cache.stats.uploads,
      lateDrops: cache.stats.lateDrops,
      disposed: cache.stats.disposed,
      pinnedMiB: cache.pinnedBytes() / MIB,
      evictions: cache.stats.evictions,
      reloads: cache.stats.reloads,
      pressure: cache.stats.pressure,
      cleanupFailures: cache.stats.cleanupFailures,
    }),
    setResidency: ({ warmBytes, ...residency }) => cache.setResidency(warmBytes, residency),
  };
}

/**
 * Leases a texture and hands it to `apply` once it arrives, for scene code that dresses a material later (the old
 * `TextureLoader().load(url, onLoad, _, onError)` shape). An abort is silent, and `apply` never runs after the signal
 * aborts. A failed load calls `onError` if given; otherwise the material stays as it was (the untextured fallback
 * every converted site already draws), as `TextureLoader` without an error handler did.
 */
export function dressTexture(
  library: TextureLibrary,
  id: string,
  o: TextureOptions,
  apply: (texture: T.Texture) => void,
  onError?: (error: unknown) => void,
): void {
  library.texture(id, o).then(
    lease => {
      if (!o.signal.aborted) apply(lease.value);
    },
    (error: unknown) => {
      if (isAbortError(error) || o.signal.aborted) return;
      if (onError) onError(error);
      else console.warn(`[assets] ${id}:`, error);
    },
  );
}
