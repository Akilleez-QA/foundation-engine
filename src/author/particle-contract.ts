/**
 * author/particle-contract.ts: the particle contract shared by `defineScene`, the scene runtime, `testScene` and the
 * particle modules (FX-01): bounds, data and slot types. Types and a few numbers only, so the runtime and a game that
 * never uses particles carry no particle simulation code: a scene opts in with `defineScene({ particles:
 * sceneParticles() })`, and that value brings the simulation (particle-sim.ts) with it.
 */
import type {Entity, World} from '../core/ecs/world';

/** The `Emitter` component's id. */
export const EMITTER_ID = 'emitter';
/** [x, y, z], as `Vec3` in defs.ts (kept local: defs.ts imports this module). */
type Vec3 = [x: number, y: number, z: number];

/**
 * Validation bounds and scene defaults. Data errors, not performance allowances: the scene's budgets still apply.
 * `perScene`/`emitters` are the defaults a scene can lower or raise up to the hard caps with `defineScene({ particles })`.
 */
export const PARTICLE_LIMITS = Object.freeze({
  perEmitter: 4096,
  rate: 10_000,
  lifetime: 30,
  speed: 1000,
  keys: 8,
  size: 100,
  drag: 10,
  gravity: 1000,
  textureId: 64,
  /** Default and hard cap of particles reserved per scene (the sum of admitted emitters' `max`). */
  perScene: 4096,
  perSceneCap: 65_536,
  /** Default and hard cap of emitters drawn per scene: each is one draw. */
  emitters: 16,
  emittersCap: 256,
  /** Bursts handled per emitter per fixed step; requests beyond it are dropped and counted. */
  burstsPerStep: 4,
});

/** Scene-level particle bounds: `defineScene({ particles: { max, emitters } })`. */
export interface SceneParticleLimits {
  /** Particles reserved by all admitted emitters together (the sum of their `max`). */
  max: number;
  /** Emitters admitted at once; each is one draw. */
  emitters: number;
}
export function normalizeSceneParticles(input: Partial<SceneParticleLimits> | undefined): SceneParticleLimits {
  const max = input?.max ?? PARTICLE_LIMITS.perScene,
    emitters = input?.emitters ?? PARTICLE_LIMITS.emitters;
  if (!Number.isInteger(max) || max < 0 || max > PARTICLE_LIMITS.perSceneCap)
    throw Error(`particles: max must be an integer in [0, ${PARTICLE_LIMITS.perSceneCap}]`);
  if (!Number.isInteger(emitters) || emitters < 0 || emitters > PARTICLE_LIMITS.emittersCap)
    throw Error(`particles: emitters must be an integer in [0, ${PARTICLE_LIMITS.emittersCap}]`);
  return Object.freeze({max, emitters});
}

export type EmitterMode = 'burst' | 'continuous';
export type EmitterBlending = 'additive' | 'normal';

export interface EmitterData {
  /** 'burst': `count` particles per requested burst. 'continuous': `rate` per second while `playing`. */
  mode: EmitterMode;
  /** The most particles alive at once (1…{@link PARTICLE_LIMITS.perEmitter}); this is the pool, allocated once. */
  max: number;
  /** Continuous: particles per second (0…{@link PARTICLE_LIMITS.rate}). */
  rate: number;
  /** Burst: particles per burst (0…max). */
  count: number;
  /** Burst: how many bursts have been requested. Raise it (`burst()`) to fire another; 1 in a prefab fires on spawn. */
  bursts: number;
  /** Continuous: emitting while true. Existing particles always finish their lives. */
  playing: boolean;
  /** Seconds a particle lives, [min, max] (0 < min ≤ max ≤ {@link PARTICLE_LIMITS.lifetime}). */
  lifetime: [min: number, max: number];
  /** Launch speed in metres per second, [min, max]. */
  speed: [min: number, max: number];
  /** Launch direction (any non-zero vector), rotated by the entity's `Transform` rotation. */
  direction: Vec3;
  /** Cone half-angle around `direction` in radians: 0 is a jet, π/2 a hemisphere, π every direction. */
  spread: number;
  /** Acceleration in metres per second², world space. */
  gravity: Vec3;
  /** Linear drag per second (0 is none): velocity is multiplied by (1 − drag·dt) each step. */
  drag: number;
  /** Quad size in metres over the particle's life (1…8 keys). */
  size: number[];
  /** Colour (24-bit sRGB) over the particle's life (1…8 keys). */
  color: number[];
  /** Opacity 0…1 over the particle's life (1…8 keys). */
  opacity: number[];
  /** A `defineAsset({ type: 'texture' })` id; '' draws a soft round dot. Tinted by `color`. */
  texture: string;
  /** 'additive' glows and needs no sorting; 'normal' blends over (unsorted within the emitter). */
  blending: EmitterBlending;
  /** True: never thinned by the `effects.particles` quality knob (for particles that carry meaning). */
  essential: boolean;
  /** True: the entity is removed once the emitter has emitted and is finished (burst fired, or stopped, and the
   *  longest lifetime has passed). */
  despawn: boolean;
}

/** One emitter's particles. Simulation state is float64; the drawn instance data is float32, ready to upload. */
export interface ParticlePool {
  readonly capacity: number;
  /** Live particles: indices [0, live) are packed. */
  live: number;
  readonly pos: Float64Array;
  readonly prev: Float64Array;
  readonly vel: Float64Array;
  readonly age: Float64Array;
  readonly prevAge: Float64Array;
  readonly life: Float64Array;
  /** Interpolated centre (xyz), size and linear colour with opacity (rgba) per drawn particle. */
  readonly offset: Float32Array;
  readonly size: Float32Array;
  readonly tint: Float32Array;
}

export interface EmitterSlot {
  readonly entity: Entity;
  /** The live component data this slot was admitted for. */
  readonly data: EmitterData;
  readonly pool: ParticlePool;
  /** Unscaled `max`, as reserved against the scene's limit. */
  readonly reserved: number;
  /** 1, or the quality scale for non-essential emitters. */
  readonly scale: number;
  readonly texture: string;
  readonly blending: EmitterBlending;
  /** The renderer's own handle (scene-particles.ts); undefined headless. */
  view: unknown;
}

export interface ParticleRenderer {
  bind(slot: EmitterSlot): void;
  /** The interpolated instance data of `count` particles was written: upload it. */
  draw(slot: EmitterSlot, count: number): void;
  release(slot: EmitterSlot): void;
}

export interface ParticleStats {
  readonly emitters: number;
  readonly live: number;
  readonly reserved: number;
  /** Spawn attempts, those thinned by the quality scale, those dropped (full pool or per-step cap). */
  readonly spawned: number;
  readonly thinned: number;
  readonly dropped: number;
  /** Admission refusals and invalid-data reports so far. */
  readonly refused: number;
  readonly invalid: number;
  /** Refusals by cause: the emitter count limit, or the reserved-particle limit. */
  readonly refusals: {readonly emitters: number; readonly particles: number};
}

/** One admitted emitter's particles, for tests and diagnostics (allocates; not for the frame loop). */
export interface EmitterSample {
  /** Particles alive now. */
  readonly live: number;
  /** Spawn attempts since this emitter was admitted (a rebuild or re-admission starts again at 0). */
  readonly spawned: number;
  /** The axis-aligned bounds of the live particles' centres at the latest step; null when none is alive. */
  readonly bounds: {readonly min: Vec3; readonly max: Vec3} | null;
}

export interface ParticleField {
  /** One fixed step: admit, simulate, spawn, retire and despawn finished emitters. */
  step(world: World, dt: number): void;
  /** Write instance data between the last two steps (alpha 0…1; the stock runtime passes 1: the latest step, as Shape
   *  meshes are drawn). True when the picture changed. */
  interpolate(alpha: number): boolean;
  /** Something will change without outside input: live particles, a playing emitter, a pending burst or despawn. */
  busy(world: World): boolean;
  /** The renderer could not bind `slot` after all (a lazily loaded renderer): report once, release the slot and do not
   *  admit that entity's emitter again this visit. */
  bindFailed(slot: EmitterSlot, error: unknown): void;
  readonly stats: ParticleStats;
  /** `entity`'s admitted emitter now, or null when it has none admitted (none, refused, invalid or removed). */
  sample(entity: Entity): EmitterSample | null;
  dispose(): void;
}

export interface ParticleFieldOptions {
  limits: SceneParticleLimits;
  /** Quality scale (0, 1] for non-essential emitters: the `effects.particles` knob, read once per visit. */
  scale: number;
  /** One uniform draw in [0, 1) per admitted emitter, from the particles' own stream (never the gameplay `ctx.random`). */
  seed(): number;
  report(error: Error): void;
  renderer?: ParticleRenderer;
}

/** A scene's particle support: its bounds and the simulation that steps its emitters (`sceneParticles()`). */
export interface SceneParticles {
  readonly kind: 'scene-particles';
  readonly limits: SceneParticleLimits;
  /** Creates the visit's field; called once per visit (and per `testScene`). */
  createField(options: Omit<ParticleFieldOptions, 'limits'>): ParticleField;
}
