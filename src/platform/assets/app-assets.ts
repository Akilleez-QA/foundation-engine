/**
 * The app's texture library: the `assets` service. The composition root binds it to the
 * content packs and installs it (app/shell-modules.ts, `platform.assets`); `platform/` never imports
 * content. One library for the session: a texture is decoded once and uploaded once per context that draws it.
 *
 * The boot carries only the facade below (ADR 0025, first-load JS): the library itself loads with the first texture
 * asked for, which is always in a scene's own chunk. Code that has no `Services` yet (the root-level scenes, until
 * step 6) reads the same instance through `appAssets()`, as it reads `appQuality()` and `appRenderers()`;
 * `dress-asset.ts` holds its helpers.
 */
import type { TextureLibrary, TextureLibraryStats } from './textures';
import type { AssetResidencyPolicy } from './residency';
import { paintedSurfaces, type PaintedSurfaces } from './painted-surfaces';

export type AppAssetLibrary = TextureLibrary & { readonly painted: PaintedSurfaces };

declare module '../../core/services' {
  interface Services { assets: AppAssetLibrary }
}

const NOTHING_YET: TextureLibraryStats = Object.freeze({ residentMiB: 0, warmMiB: 0, loads: 0, hits: 0, uploads: 0, lateDrops: 0, disposed: 0, pinnedMiB: 0, evictions: 0, reloads: 0, pressure: 0, cleanupFailures: 0 });

/**
 * A library whose implementation is fetched on first use. Until then it owns nothing and has loaded nothing; a failed
 * fetch is forgotten, so the next request fetches again.
 */
export function lazyTextureLibrary(load: () => Promise<TextureLibrary>): AppAssetLibrary {
  let library: TextureLibrary | undefined, pending: Promise<TextureLibrary> | undefined, policy: AssetResidencyPolicy | undefined;
  // The latest residency policy reaches the library when it loads (RES-01).
  const get = () => (pending ??= load().then(l => { if (policy) l.setResidency(policy); return library = l; }, error => { pending = undefined; throw error; }));
  return {
    painted: paintedSurfaces,
    texture: (id, o) => get().then(l => l.texture(id, o)),
    variant: (id, screenPx) => get().then(l => l.variant(id, screenPx)),
    url(variant) {
      if (!library) throw new Error('the texture library has not loaded yet: ask for a variant first');
      return library.url(variant);
    },
    owns: resource => !!library?.owns(resource),
    stats: () => library?.stats() ?? NOTHING_YET,
    setResidency(next) { policy = next; library?.setResidency(next); },
  };
}

let installed: AppAssetLibrary | null = null;

/** The composition root's binding: the library over the content packs. Returns it. */
export function installAppAssets(next: TextureLibrary): AppAssetLibrary {
  installed = Object.assign(next, { painted: paintedSurfaces });
  return installed;
}

/** The installed library. Throws before the composition root has installed it. */
export function appAssets(): AppAssetLibrary {
  if (!installed) throw new Error('the assets service is not installed (app/shell-modules.ts, platform.assets)');
  return installed;
}
