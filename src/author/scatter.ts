/**
 * author/scatter.ts: many copies of one primitive `Shape` or one `Mesh` in a single instanced draw (grass, rocks,
 * flowers, a row of lantern posts). Plain data; a scene opts in with `defineScene({ scatter: sceneScatter() })`, and the
 * drawing code (author/scene-scatter.ts) is a lazy chunk loaded only by scenes that do.
 *
 *   [Transform(), defineScatter({ shape: { kind: 'cone', size: [.12, .45, .12] }, color: 0x2f5a2c,
 *     area: { kind: 'edge', rect: [-11, -11, 11, 11], width: 2.2 }, count: 1400, seed: 3, scale: [.6, 1.5], ry: 'random' })]
 *   [Transform(), defineScatter({ mesh: rock, points: [[-9, -9], [9, -9]], essential: true }), defineMaterial({ shading: 'flat' })]
 *
 * Placement is deterministic: it depends only on the scatter's data, the scene id and the run's `?seed=` (when there
 * is one), through a stream derived for scatter alone. It never draws from `ctx.random()`, so adding a scatter cannot
 * change gameplay or an existing replay. The entity's `Transform` is the scatter's origin; an optional `Material` on the
 * same entity shades every copy. A scatter is presentation only: it has no collision.
 */
import {defineComponent, type ComponentInit} from './defs';
import {validateMesh, type MeshData} from './mesh';
import {deriveSeed} from '../core/rng';
import type {SceneScatter, SceneScatterLimits} from './scatter-contract';

export type ScatterShapeKind = 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'capsule';
export type ScatterArea =
  /** Uniformly inside `rect` = [minX, minZ, maxX, maxZ] (scatter-local metres). */
  | {kind: 'rect'; rect: [number, number, number, number]}
  /** Uniformly between two radii around the origin. */
  | {kind: 'ring'; radius: [inner: number, outer: number]}
  /** Uniformly in a band `width` wide along the inside of `rect`'s border ("along the walls"). */
  | {kind: 'edge'; rect: [number, number, number, number]; width: number};

export interface ScatterData {
  /** The copied primitive, or null for `mesh`. Exactly one of `shape` and `mesh`. */
  shape: {kind: ScatterShapeKind; size: [number, number, number]} | null;
  /** The copied indexed geometry (`defineMesh(...).value`), or null for `shape`. */
  mesh: MeshData | null;
  /** Base colour (24-bit RGB); a `Material` on the entity shades it. */
  color: number;
  /** Per-copy colour variation, [hue, saturation, lightness] amplitudes (0…1 each); [0, 0, 0] is none. */
  colorJitter: [number, number, number];
  /** Explicit positions [x, z]; when non-empty, `area` and `count` are ignored. */
  points: [number, number][];
  /** Where `count` copies are placed when `points` is empty. */
  area: ScatterArea | null;
  count: number;
  /** Placement seed (any 32-bit integer): another seed, another layout. */
  seed: number;
  /** Height of every copy above the origin. */
  y: number;
  /** Uniform scale range [min, max]. */
  scale: [number, number];
  /** Yaw: a fixed angle in radians, or 'random' for any direction. */
  ry: number | 'random';
  /** Largest random lean from upright, radians (0…π/2). */
  tilt: number;
  /** Never thinned by the `effects.scatter-density` quality knob, and admitted before non-essential scatters. */
  essential: boolean;
  visible: boolean;
}

/** Validation bounds: data errors, not performance allowances (the scene's budgets still apply). */
export const SCATTER_LIMITS = {count: 65_536, extent: 10_000, size: 1_000} as const;
/** Per-scene defaults and caps for `sceneScatter`. */
export const SCENE_SCATTER_LIMITS = {
  defaults: {max: 32, instances: 65_536},
  caps: {max: 256, instances: 262_144},
} as const;

const SHAPE_KINDS: readonly ScatterShapeKind[] = ['box', 'sphere', 'cylinder', 'cone', 'plane', 'capsule'];

export const SCATTER_DEFAULTS: Readonly<ScatterData> = Object.freeze({
  shape: null,
  mesh: null,
  color: 0xffffff,
  colorJitter: [0, 0, 0],
  points: [],
  area: null,
  count: 0,
  seed: 1,
  y: 0,
  scale: [1, 1],
  ry: 0,
  tilt: 0,
  essential: false,
  visible: true,
} as ScatterData);

export const SCATTER_ID = 'scatter';
export const Scatter = defineComponent<ScatterData>(SCATTER_ID, {
  ...SCATTER_DEFAULTS,
  colorJitter: [0, 0, 0],
  points: [],
  scale: [1, 1],
});

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const within = (n: unknown, lo: number, hi: number) => finite(n) && n >= lo && n <= hi;

/** Throws on data the renderer would not draw as written, naming the field. */
export function validateScatter(d: ScatterData): void {
  const fail = (reason: string): never => {
    throw new Error(`scatter: ${reason}`);
  };
  const E = SCATTER_LIMITS.extent;
  if ((d.shape === null) === (d.mesh === null)) fail('give exactly one of shape and mesh');
  if (d.shape) {
    if (!SHAPE_KINDS.includes(d.shape.kind)) fail(`shape.kind must be one of ${SHAPE_KINDS.join(', ')}`);
    if (
      !Array.isArray(d.shape.size) ||
      d.shape.size.length !== 3 ||
      !d.shape.size.every(s => within(s, 0, SCATTER_LIMITS.size))
    )
      fail(`shape.size must be [w, h, d], each in [0, ${SCATTER_LIMITS.size}]`);
  }
  if (d.mesh) validateMesh(d.mesh);
  if (!Number.isInteger(d.color) || d.color < 0 || d.color > 0xffffff) fail('color must be a 24-bit RGB integer');
  if (!Array.isArray(d.colorJitter) || d.colorJitter.length !== 3 || !d.colorJitter.every(j => within(j, 0, 1)))
    fail('colorJitter must be [hue, saturation, lightness], each in [0, 1]');
  if (!Array.isArray(d.points) || d.points.length > SCATTER_LIMITS.count)
    fail(`points must be a list of at most ${SCATTER_LIMITS.count} [x, z] pairs`);
  for (const p of d.points)
    if (!Array.isArray(p) || p.length !== 2 || !p.every(v => within(v, -E, E)))
      fail(`points must be [x, z] pairs within ±${E}`);
  if (!d.points.length) {
    if (!d.area) fail('give points, or an area with a count');
    const a = d.area!;
    const rect = (r: unknown) =>
      Array.isArray(r) && r.length === 4 && r.every(v => within(v, -E, E)) && r[0] < r[2] && r[1] < r[3];
    if (a.kind === 'rect') {
      if (!rect(a.rect)) fail(`area.rect must be [minX, minZ, maxX, maxZ] within ±${E}, min below max`);
    } else if (a.kind === 'ring') {
      if (
        !Array.isArray(a.radius) ||
        a.radius.length !== 2 ||
        !within(a.radius[0], 0, E) ||
        !within(a.radius[1], 0, E) ||
        a.radius[0] >= a.radius[1]
      )
        fail(`area.radius must be [inner, outer] within [0, ${E}], inner below outer`);
    } else if (a.kind === 'edge') {
      if (!rect(a.rect)) fail(`area.rect must be [minX, minZ, maxX, maxZ] within ±${E}, min below max`);
      const [x0, z0, x1, z1] = a.rect;
      if (!finite(a.width) || a.width <= 0 || 2 * a.width > Math.min(x1 - x0, z1 - z0))
        fail('area.width must be above 0 and at most half the rect');
    } else fail('area.kind must be rect, ring or edge');
    if (!Number.isInteger(d.count) || d.count < 1 || d.count > SCATTER_LIMITS.count)
      fail(`count must be an integer in [1, ${SCATTER_LIMITS.count}]`);
  }
  if (!Number.isInteger(d.seed) || d.seed < -0x80000000 || d.seed > 0xffffffff) fail('seed must be a 32-bit integer');
  if (!within(d.y, -E, E)) fail(`y must be within ±${E}`);
  if (
    !Array.isArray(d.scale) ||
    d.scale.length !== 2 ||
    !within(d.scale[0], 0, SCATTER_LIMITS.size) ||
    !within(d.scale[1], 0, SCATTER_LIMITS.size) ||
    d.scale[0] <= 0 ||
    d.scale[0] > d.scale[1]
  )
    fail(`scale must be [min, max] with 0 < min <= max <= ${SCATTER_LIMITS.size}`);
  if (d.ry !== 'random' && !finite(d.ry)) fail("ry must be an angle in radians or 'random'");
  if (!within(d.tilt, 0, Math.PI / 2)) fail('tilt must be in [0, π/2]');
  if (typeof d.essential !== 'boolean') fail('essential must be boolean');
  if (typeof d.visible !== 'boolean') fail('visible must be boolean');
}

export type ScatterInput = Partial<ScatterData>;

/** A checked `Scatter` initialiser; omitted fields take {@link SCATTER_DEFAULTS}. Arrays are copied. */
export function defineScatter(input: ScatterInput): ComponentInit<ScatterData> {
  const data: ScatterData = {
    ...SCATTER_DEFAULTS,
    ...input,
    colorJitter: [...(input.colorJitter ?? SCATTER_DEFAULTS.colorJitter)] as [number, number, number],
    points: (input.points ?? []).map(p => [...p] as [number, number]),
    scale: [...(input.scale ?? SCATTER_DEFAULTS.scale)] as [number, number],
    shape: input.shape ? {kind: input.shape.kind, size: [...input.shape.size] as [number, number, number]} : null,
  };
  validateScatter(data);
  return Scatter(data);
}

/** The root every scatter of a visit derives its placement stream from: the scene id and the run's `?seed=` (or 0). */
export const scatterRoot = (sceneId: string, runSeed: number | null): number =>
  deriveSeed(runSeed === null ? 0 : runSeed >>> 0, 'scatter', sceneId);

/** How many copies the data asks for, before quality thinning. */
export const scatterCount = (d: ScatterData): number => (d.points.length ? d.points.length : d.count);

export type {SceneScatter, SceneScatterLimits} from './scatter-contract';

/** Opt a scene in to `Scatter` drawing: at most `max` scatters and `instances` copies at once; excess is refused. */
export function sceneScatter(limits: Partial<SceneScatterLimits> = {}): SceneScatter {
  const {defaults, caps} = SCENE_SCATTER_LIMITS;
  const max = limits.max ?? defaults.max,
    instances = limits.instances ?? defaults.instances;
  if (!Number.isInteger(max) || max < 1 || max > caps.max)
    throw Error(`sceneScatter: max must be an integer in [1, ${caps.max}]`);
  if (!Number.isInteger(instances) || instances < 1 || instances > caps.instances)
    throw Error(`sceneScatter: instances must be an integer in [1, ${caps.instances}]`);
  return Object.freeze({kind: 'scene-scatter' as const, limits: Object.freeze({max, instances})});
}
