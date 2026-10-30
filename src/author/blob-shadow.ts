/**
 * author/blob-shadow.ts: blob (contact) shadows (VIS-10), as plain data and a pure placement policy. A blob is a soft
 * dark ellipse on the ground under an entity: the cheap way to keep things from floating where no shadow map reaches.
 *
 *   defineScene({ blobShadows: sceneBlobShadows({ max: 64 }), entities: [
 *     [Transform({ x: 3 }), Shape({ kind: 'capsule' }), BlobShadow({ width: 0.7, depth: 0.5 })],
 *   ] })
 *
 * A scene opts in once (`sceneBlobShadows`); each entity opts in with `BlobShadow`. Every blob of a visit is ONE
 * instanced draw (author/scene-blob-shadows.ts, a lazy chunk loaded only by scenes that opt in). No three.js here.
 *
 * Policy (`blobWeight`): a blob stands in for a real shadow where there is none. It is drawn at full strength when the
 * entity casts no real sun shadow: the scene has no `sceneShadows()`, no live sun shadow (no environment
 * `directional.shadow`, or the player's `shadows.quality` is `off`), or the entity is not a casting `Shape` or `Mesh`
 * (a `Model`, a `Shadow({ cast: false })`, an entity with no drawn body). Where the entity does cast, the blob is
 * hidden inside the sun's shadow box and fades in across `crossfade` metres at its edge, so nothing gets two shadows
 * and nothing loses its shadow at the edge. Presets gate real shadows only through `shadows.quality` (the floor is
 * `low`, which still has a sun map), so the policy is the same on every preset; only a player's `off` turns blobs on
 * everywhere. Local (point and spot) light shadows do not hide blobs: a blob is the sun's contact cue.
 *
 * Bounds: at most the scene's `max` blobs are drawn (default 64, cap 1024). Over that, the `max` nearest the camera
 * are kept (ties by entity order) and the rest are dropped, counted and reported once per visit.
 */
import {component, type ComponentType, type Entity} from '../core/ecs/world';

export interface BlobShadowData {
  /** Size across the entity's own x axis, metres (before the Transform's scale). */
  width: number;
  /** Size along the entity's own z axis, metres (before the Transform's scale). */
  depth: number;
  /** Darkness at the centre, 0…1. */
  opacity: number;
  /** World height of the surface under this entity; null takes the scene's `ground`. */
  ground: number | null;
  /** Hide this blob without removing the component. */
  visible: boolean;
}

/** Validation bounds: data errors, not performance allowances. */
export const BLOB_SHADOW_LIMITS = {size: 100, extent: 10_000} as const;
export const BLOB_SHADOW_DEFAULTS: Readonly<BlobShadowData> = Object.freeze({
  width: 0.8,
  depth: 0.8,
  opacity: 0.5,
  ground: null,
  visible: true,
});

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Throws on data the renderer would not draw as written, naming the field. */
export function validateBlobShadow(d: BlobShadowData): void {
  const fail = (reason: string): never => {
    throw Error(`BlobShadow: ${reason}`);
  };
  const S = BLOB_SHADOW_LIMITS.size;
  if (!finite(d.width) || d.width <= 0 || d.width > S) fail(`width must be in (0, ${S}] metres`);
  if (!finite(d.depth) || d.depth <= 0 || d.depth > S) fail(`depth must be in (0, ${S}] metres`);
  if (!finite(d.opacity) || d.opacity < 0 || d.opacity > 1) fail('opacity must be in [0, 1]');
  if (d.ground !== null && (!finite(d.ground) || Math.abs(d.ground) > BLOB_SHADOW_LIMITS.extent))
    fail(`ground must be null or within ±${BLOB_SHADOW_LIMITS.extent}`);
  if (typeof d.visible !== 'boolean') fail('visible must be boolean');
}

export const BLOB_SHADOW_ID = 'blob-shadow';
const base = component<BlobShadowData>(BLOB_SHADOW_ID, {...BLOB_SHADOW_DEFAULTS});
/** A soft ground ellipse under this entity, in a scene with `sceneBlobShadows()`. Omitted fields take the defaults. */
export const BlobShadow: ComponentType<BlobShadowData> = Object.assign(
  (input: Partial<BlobShadowData> = {}) => {
    const value: BlobShadowData = {...BLOB_SHADOW_DEFAULTS, ...input};
    validateBlobShadow(value);
    return {type: BlobShadow, value};
  },
  {id: base.id, initial: base.initial},
);

export interface SceneBlobShadowLimits {
  /** Blobs drawn at once in a visit (the instance capacity, allocated once). */
  max: number;
  /** World height of the surface blobs lie on, unless an entity's `ground` says otherwise. */
  ground: number;
  /** Width in metres of the band inside the sun's shadow box where a casting entity's blob fades in. */
  crossfade: number;
  /** Camera distance in metres at which blobs have faded out (from 75 % of it), or null for no distance fade. */
  distance: number | null;
}
export interface SceneBlobShadows {
  readonly kind: 'scene-blob-shadows';
  readonly limits: Readonly<SceneBlobShadowLimits>;
}
export const SCENE_BLOB_SHADOW_LIMITS = {
  defaults: {max: 64, ground: 0, crossfade: 2, distance: null},
  caps: {max: 1024, crossfade: 200, distance: 10_000},
} as const;

/** Opt a scene in to `BlobShadow` drawing: one instanced draw of at most `max` blobs. */
export function sceneBlobShadows(limits: Partial<SceneBlobShadowLimits> = {}): SceneBlobShadows {
  const {defaults, caps} = SCENE_BLOB_SHADOW_LIMITS;
  const max = limits.max ?? defaults.max,
    ground = limits.ground ?? defaults.ground,
    crossfade = limits.crossfade ?? defaults.crossfade,
    distance = limits.distance ?? defaults.distance;
  if (!Number.isInteger(max) || max < 1 || max > caps.max)
    throw Error(`sceneBlobShadows: max must be an integer in [1, ${caps.max}]`);
  if (!finite(ground) || Math.abs(ground) > BLOB_SHADOW_LIMITS.extent)
    throw Error(`sceneBlobShadows: ground must be within ±${BLOB_SHADOW_LIMITS.extent}`);
  if (!finite(crossfade) || crossfade < 0 || crossfade > caps.crossfade)
    throw Error(`sceneBlobShadows: crossfade must be in [0, ${caps.crossfade}] metres`);
  if (distance !== null && (!finite(distance) || distance <= 0 || distance > caps.distance))
    throw Error(`sceneBlobShadows: distance must be null or in (0, ${caps.distance}] metres`);
  return Object.freeze({
    kind: 'scene-blob-shadows' as const,
    limits: Object.freeze({max, ground, crossfade, distance}),
  });
}

/** One entity that asks for a blob this frame, already resolved to world terms. */
export interface BlobCandidate {
  entity: Entity;
  x: number;
  /** The surface height the blob lies on. */
  ground: number;
  z: number;
  /** Yaw (the Transform's `ry`). */
  yaw: number;
  /** Ellipse size in world metres (data size × Transform scale). */
  width: number;
  depth: number;
  opacity: number;
  /** The entity draws a body that casts a real shadow in this scene (`sceneShadows` flags). */
  casts: boolean;
}
/** The live sun shadow: the half-size of its box around the world origin, or null when there is none. */
export type SunCoverage = {extent: number} | null;

/**
 * How strongly a candidate's blob is drawn (0…1, times its opacity). A caster's real sun shadow is guaranteed for
 * ground points within `extent` of the origin (the shadow box is ±extent across the light and 4 × extent deep around
 * it), so the blob is 0 there, rises across the last `crossfade` metres, and is 1 outside.
 */
export function blobWeight(c: Readonly<BlobCandidate>, sun: SunCoverage, crossfade: number): number {
  if (!sun || !c.casts) return 1;
  const d = Math.hypot(c.x, c.ground, c.z);
  if (d >= sun.extent) return 1;
  const band = Math.min(crossfade, sun.extent);
  if (band <= 0) return 0;
  const t = (d - (sun.extent - band)) / band;
  return t <= 0 ? 0 : t * t * (3 - 2 * t);
}

export interface BlobPlan {
  /** Blobs to draw, in candidate (query) order, each with its final alpha. */
  kept: (BlobCandidate & {alpha: number})[];
  /** Candidates with a visible blob that did not fit `max`. */
  dropped: number;
}
/**
 * The blobs to draw: candidates whose weighted opacity is above zero, at most `max`. Over capacity, the nearest to
 * `camera` (horizontal distance, ties by entity) are kept. Pure and deterministic; never draws randomness.
 */
export function planBlobs(
  candidates: readonly BlobCandidate[],
  o: {max: number; sun: SunCoverage; crossfade: number; camera: readonly [number, number, number]},
): BlobPlan {
  const live: (BlobCandidate & {alpha: number})[] = [];
  for (const c of candidates) {
    const alpha = c.opacity * blobWeight(c, o.sun, o.crossfade);
    if (alpha > 0) live.push({...c, alpha});
  }
  if (live.length <= o.max) return {kept: live, dropped: 0};
  const [cx, , cz] = o.camera;
  const near = new Set(
    live
      .map((c, i) => ({i, d: (c.x - cx) ** 2 + (c.z - cz) ** 2, e: c.entity}))
      .sort((a, b) => a.d - b.d || a.e - b.e)
      .slice(0, o.max)
      .map(n => n.i),
  );
  return {kept: live.filter((_, i) => near.has(i)), dropped: live.length - o.max};
}

/**
 * The live sun shadow that hides casters' blobs, or null. It is live only in a scene with `sceneShadows()`, whose
 * environment's sun has a `shadow`, while the `shadows.quality` knob is not `off`. No preset sets `off` (the knob's
 * floor is `low`, which keeps a 1024 sun map), so only a player's choice turns blobs on for every caster.
 */
export function sunCoverage(o: {
  sceneShadows: boolean;
  extent: number | undefined;
  quality: 'off' | 'low' | 'medium' | 'high' | 'ultra';
}): SunCoverage {
  return o.sceneShadows && o.extent !== undefined && o.extent > 0 && o.quality !== 'off' ? {extent: o.extent} : null;
}
