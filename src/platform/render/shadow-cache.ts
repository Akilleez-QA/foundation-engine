import * as T from 'three';
import {Observer, Signature, observeCaster, observeShadowLight} from './change-tracker';

/**
 * Static shadow depth as a versioned cache, never a full-pass copy (ADR 0037, superseding 0035;
 * STD-REN-17 "caches key on complete inputs and fall back at identical quality").
 *
 * This module holds the cache's *decisions*, not its GPU passes. For each (light, cascade) it answers, every frame
 * a shadow map is due, which of three paths the renderer takes:
 *
 * - `full`: the conventional shadow pass over every caster. Used whenever the path is unproved for this light
 *   (the default for every light until its combination passes the frame-sequence guard; always for point lights),
 *   there are no static casters, the context is lost, or a rebuild failed.
 * - `rebuild`: the generation key changed. Render **only** `staticCasters` into the static cache, then composite
 *   and draw `movingCasters` into the final map. Call `commit(plan)` once the static layer rendered successfully;
 *   only then is the key published. Never copy a combined map back into the cache.
 * - `hit`: the published key matches. Composite the cached static depth and draw `movingCasters` over it.
 *
 * Membership is explicit: a caster is static only if its art declared it (`declareStatic`) **and** it is eligible.
 * Skinned, morphed, batched, custom-depth, hooked or video/render-target-textured casters stay moving even when
 * declared; nothing is promoted after quiet frames. Promotion and demotion are membership changes.
 *
 * The generation key is the complete, exact signature (no hash) of: context generation, cascade, the viewing
 * camera's layer mask, shadow type, the light's pose/target/shadow camera/projection/depth range, map size, the
 * ordered static membership, and each static caster's world transform, layers, culling flag, geometry state,
 * depth-affecting material state and instance state. Anything the key cannot observe keeps a caster moving or the
 * light on `full`. Filtering, bias and caster coverage are untouched: the final map is the same depth a full pass
 * produces, so the fallback is identical quality.
 *
 * First-presented-frame guard: the frame on which the key changes is itself a `rebuild`, so its composite already
 * uses the new static depth; `pathForPresent` downgrades an uncommitted rebuild, or a hit whose generation was
 * invalidated after planning, to `full`. A stale static layer is never presented.
 *
 * GPU execution and renderer ownership live in `shadow-cache-gpu.ts`, installed by the shadow scheduler.
 */

export type ShadowPath = 'full' | 'rebuild' | 'hit';
export type ShadowLight = T.Light & {shadow: T.LightShadow; target?: T.Object3D};
export type ShadowPlan = {
  readonly light: ShadowLight;
  readonly cascade: number;
  readonly path: ShadowPath;
  /** Why this path (for counters and debugging). */
  readonly reason: string;
  /** Casters to draw into the static-only layer (non-empty only on `rebuild`). */
  readonly staticCasters: readonly T.Object3D[];
  /** Casters drawn every due frame: over the composite on `rebuild`/`hit`, and with the statics on `full`. */
  readonly movingCasters: readonly T.Object3D[];
  /** The key changed (or was invalidated) since the last presented cache generation. */
  readonly firstAfterInvalidation: boolean;
  readonly generation: number;
};
export type ShadowCacheStats = {
  hits: number;
  rebuilds: number;
  fulls: number;
  failures: number;
  /** ADR 0037 counters: `shadowDrawsActive` = staticRebuildDraws + dynamicDraws + compositeDraws + fullDraws. */
  staticRebuildDraws: number;
  dynamicDraws: number;
  compositeDraws: number;
  fullDraws: number;
};
export type ShadowCacheOptions = {
  /** Whether the cached path is proved for this light and cascade (technique, filter, material combination).
   *  Default: nothing is proved, so every light takes the conventional full pass. Point lights are never cached. */
  readonly supports?: (light: ShadowLight, cascade: number) => boolean;
  /** Bytes per cached texel, for the residency ledger (default 4: a 32-bit depth texel). */
  readonly bytesPerTexel?: number;
};
export type PlanOptions = {
  readonly cascade?: number;
  /** The viewing camera's layer mask; three's depth pass tests caster layers against it. Default all layers. */
  readonly cameraLayers?: number;
  /** The renderer's shadow map type (e.g. `T.PCFShadowMap`); VSM also draws receivers. */
  readonly shadowType?: number;
};

type Entry = {
  published: Signature | null;
  pending: Signature | null;
  pendingToken: number;
  committedToken: number;
  generation: number;
  texels: number;
  presentedGeneration: number;
};

const objectShadowHook = T.Object3D.prototype.onBeforeShadow;
const rendersDepth = (o: T.Object3D) =>
  (o as T.Mesh).isMesh === true || (o as T.Line).isLine === true || (o as T.Points).isPoints === true;
const unobservableTexture = (t: T.Texture | null | undefined) =>
  !!t &&
  ((t as T.VideoTexture).isVideoTexture === true ||
    (t as T.Texture & {isRenderTargetTexture?: boolean}).isRenderTargetTexture === true);

/** Why a declared caster cannot be cached, or `null` if it can. */
export function staticIneligibility(o: T.Object3D): string | null {
  const m = o as T.Mesh & T.SkinnedMesh & T.InstancedMesh;
  if (!rendersDepth(o)) return 'not a mesh, line or points';
  if (m.isSkinnedMesh) return 'skinned';
  if ((o as T.BatchedMesh).isBatchedMesh) return 'batched';
  if ((m.morphTargetInfluences && m.morphTargetInfluences.length > 0) || (m.isInstancedMesh && m.morphTexture))
    return 'morphed';
  if (m.customDepthMaterial || m.customDistanceMaterial) return 'custom depth material';
  if (o.onBeforeShadow !== objectShadowHook || o.onAfterShadow !== T.Object3D.prototype.onAfterShadow)
    return 'shadow hook';
  for (const x of Array.isArray(m.material) ? m.material : [m.material]) {
    const mat = x as T.MeshStandardMaterial;
    if (unobservableTexture(mat.alphaMap) || unobservableTexture(mat.map) || unobservableTexture(mat.displacementMap))
      return 'animated depth texture';
  }
  return null;
}

export function createShadowCache(options: ShadowCacheOptions = {}) {
  const supports = options.supports ?? (() => false),
    bytesPerTexel = options.bytesPerTexel ?? 4;
  const declared = new WeakSet<T.Object3D>(),
    entries = new Map<string, Entry>(),
    obs = new Observer();
  const stats: ShadowCacheStats = {
    hits: 0,
    rebuilds: 0,
    fulls: 0,
    failures: 0,
    staticRebuildDraws: 0,
    dynamicDraws: 0,
    compositeDraws: 0,
    fullDraws: 0,
  };
  let context = 0,
    lost = false,
    token = 0;
  const entryOf = (light: ShadowLight, cascade: number) => {
    const key = light.id + ':' + cascade;
    let e = entries.get(key);
    if (!e)
      entries.set(
        key,
        (e = {
          published: null,
          pending: null,
          pendingToken: -1,
          committedToken: -1,
          generation: 0,
          texels: 0,
          presentedGeneration: -1,
        }),
      );
    return e;
  };
  const drop = (e: Entry) => {
    if (e.published || e.pending) e.generation++;
    e.published = null;
    e.pending = null;
    e.pendingToken = -1;
  };
  /** Casters the depth pass renders for this light, split by membership, in traversal order. */
  const collect = (o: T.Object3D, mask: number, vsm: boolean, statics: T.Object3D[], movers: T.Object3D[]) => {
    if (!o.visible) return;
    const m = o as T.Mesh;
    if (rendersDepth(o) && (m.castShadow || (vsm && m.receiveShadow)) && (o.layers.mask & mask) !== 0)
      (declared.has(o) && m.castShadow && staticIneligibility(o) === null ? statics : movers).push(o);
    for (const child of o.children) collect(child, mask, vsm, statics, movers);
  };
  const full = (
    light: ShadowLight,
    cascade: number,
    reason: string,
    statics: T.Object3D[],
    movers: T.Object3D[],
    e: Entry | null,
  ): ShadowPlan => {
    stats.fulls++;
    stats.fullDraws += statics.length + movers.length;
    return {
      light,
      cascade,
      path: 'full',
      reason,
      staticCasters: [],
      movingCasters: statics.concat(movers),
      firstAfterInvalidation: e ? e.generation !== e.presentedGeneration : true,
      generation: e ? e.generation : -1,
    };
  };
  const api = {
    stats,
    /** Declare art-owned static casters (the object itself, not its subtree). Membership changes rebuild. */
    declareStatic(...objects: T.Object3D[]) {
      for (const o of objects) declared.add(o);
    },
    /** Demote a caster before it moves (rarely moved art); it is drawn as moving until declared again. */
    demote(...objects: T.Object3D[]) {
      for (const o of objects) declared.delete(o);
    },
    /** Static only when declared and eligible; everything else, including unclassified casters, is moving. */
    classify(o: T.Object3D): {readonly moving: boolean; readonly reason: string} {
      if (!declared.has(o)) return {moving: true, reason: 'undeclared'};
      const why = staticIneligibility(o);
      return why ? {moving: true, reason: why} : {moving: false, reason: 'declared static'};
    },
    /** Decide this frame's path for one light and cascade. Call when the map is due, after world matrices update. */
    plan(scene: T.Object3D, light: ShadowLight, planOptions: PlanOptions = {}): ShadowPlan {
      const cascade = planOptions.cascade ?? 0,
        mask = planOptions.cameraLayers ?? 0xffffffff,
        type = planOptions.shadowType ?? T.PCFShadowMap,
        vsm = type === T.VSMShadowMap;
      const statics: T.Object3D[] = [],
        movers: T.Object3D[] = [];
      collect(scene, mask, vsm, statics, movers);
      if (lost) return full(light, cascade, 'context lost', statics, movers, null);
      if ((light as T.PointLight).isPointLight) return full(light, cascade, 'point light', statics, movers, null);
      if (!supports(light, cascade)) {
        const old = entries.get(light.id + ':' + cascade);
        if (old) drop(old);
        return full(light, cascade, 'unproved path', statics, movers, old ?? null);
      }
      const e = entryOf(light, cascade);
      if (statics.length === 0) {
        drop(e);
        return full(light, cascade, 'no static casters', statics, movers, e);
      }
      obs.begin();
      obs.push(context);
      obs.push(cascade);
      obs.push(mask);
      obs.push(type);
      observeShadowLight(obs, light);
      obs.sig.matrix(light.shadow.camera.projectionMatrix);
      obs.sig.matrix(light.shadow.camera.matrixWorldInverse);
      obs.push(statics.length);
      for (const o of statics) observeCaster(obs, o as T.Mesh, scene);
      if (obs.forcedBy) {
        drop(e);
        return full(light, cascade, 'unobservable static input: ' + obs.forcedBy, statics, movers, e);
      }
      e.texels = light.shadow.mapSize.x * light.shadow.mapSize.y;
      if (e.published && obs.sig.equals(e.published)) {
        stats.hits++;
        stats.compositeDraws++;
        stats.dynamicDraws += movers.length;
        return {
          light,
          cascade,
          path: 'hit',
          reason: 'key unchanged',
          staticCasters: [],
          movingCasters: movers,
          firstAfterInvalidation: e.generation !== e.presentedGeneration,
          generation: e.generation,
        };
      }
      // New generation: the old static layer is invalid from this frame on, whether or not the rebuild succeeds.
      if (e.published) {
        e.published = null;
      }
      e.generation++;
      e.pending ??= new Signature();
      e.pending.copyFrom(obs.sig);
      e.pendingToken = ++token;
      stats.rebuilds++;
      stats.staticRebuildDraws += statics.length;
      stats.compositeDraws++;
      stats.dynamicDraws += movers.length;
      return {
        light,
        cascade,
        path: 'rebuild',
        reason: e.generation === 1 ? 'first build' : 'key changed',
        staticCasters: statics,
        movingCasters: movers,
        firstAfterInvalidation: true,
        generation: e.generation,
      };
    },
    /** The static-only layer of a `rebuild` plan rendered successfully: publish its key. False if the plan is stale. */
    commit(plan: ShadowPlan): boolean {
      if (plan.path !== 'rebuild' || lost) return false;
      const e = entryOf(plan.light, plan.cascade);
      if (e.pending === null || e.generation !== plan.generation || e.committedToken === e.pendingToken) return false;
      const published = e.published ?? new Signature();
      published.copyFrom(e.pending);
      e.published = published;
      e.committedToken = e.pendingToken;
      return true;
    },
    /** The static rebuild failed or is unsupported this frame: keep nothing, render the conventional full pass. */
    fail(plan: ShadowPlan) {
      if (plan.path === 'full') return;
      const e = entryOf(plan.light, plan.cascade);
      drop(e);
      stats.failures++;
    },
    /** The path the presented frame must use: a composite only over a static layer committed for this generation. */
    pathForPresent(plan: ShadowPlan): 'composite' | 'full' {
      if (plan.path === 'full' || lost) return 'full';
      const e = entryOf(plan.light, plan.cascade);
      const ok =
        e.published !== null &&
        e.generation === plan.generation &&
        (plan.path === 'hit' || e.committedToken === e.pendingToken);
      if (ok) e.presentedGeneration = e.generation;
      return ok ? 'composite' : 'full';
    },
    /** Drop every cache (an owner reports a change the key cannot see, or the adopter disposes the targets). */
    invalidate() {
      for (const e of entries.values()) drop(e);
    },
    /** GPU caches are gone with the context: every light takes the full path until restored and rebuilt. */
    contextLost() {
      lost = true;
      context++;
      for (const e of entries.values()) drop(e);
    },
    contextRestored() {
      lost = false;
      context++;
      for (const e of entries.values()) drop(e);
    },
    /** Bytes held by published static layers, for the residency ledger (scratch attachments are the adopter's). */
    residentBytes() {
      let bytes = 0;
      for (const e of entries.values()) if (e.published) bytes += e.texels * bytesPerTexel;
      return bytes;
    },
  };
  return api;
}
export type ShadowCache = ReturnType<typeof createShadowCache>;
