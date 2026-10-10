/**
 * kits/physics/config: the validated, frozen configuration of one physics world. Every number has an explicit range;
 * an out-of-range value is refused with a RangeError naming the field (fail fast, at definition time).
 *
 * Time: the engine's fixed lane runs at 60 Hz. One engine tick advances the physics world by `substeps` library steps
 * of `timeScale / (60 × substeps)` seconds each, so with the default `timeScale` of 1 physics time equals game time.
 * A `timeScale` other than 1 is a deliberate creator decision (slow motion, fast-forward): physics then runs faster or
 * slower than every other fixed-lane system, and a replay or peer must use the identical value.
 */
import type {ScalarMathMode} from '../../author';

/** The engine fixed step (core/ecs/systems.ts default): the physics system expects exactly this `dt`. */
export const ENGINE_FIXED_STEP = 1 / 60;

export interface PhysicsLimits {
  /** Rigid bodies admitted, including one per physics character: [1, 65536]. */
  readonly maxBodies: number;
  /** Colliders admitted (attached, static and character colliders): [1, 131072]. */
  readonly maxColliders: number;
  /** Physics characters (each owns one library character controller): [0, 256]. */
  readonly maxCharacters: number;
  /** Collision events retained per engine tick; the rest are counted as dropped: [0, 65536]. */
  readonly maxEventsPerStep: number;
  /** Bytes of one snapshot text (ASCII): [1 KiB, 64 MiB]. Larger snapshots and restores are refused. */
  readonly maxSnapshotBytes: number;
  /** Hits one multi-hit query may return: [1, 4096]. */
  readonly maxQueryHits: number;
  /** Debug-line vertices copied per draw (two per segment): [2, 1048576]. */
  readonly maxDebugVertices: number;
  /** Largest accepted |coordinate| (m) and |Euler angle| (rad) entering the library: [1, 10000000]. Larger or
   *  non-finite Transform values refuse admission, skip a kinematic target and refuse a teleport. */
  readonly maxCoordinate: number;
}

export const PHYSICS_LIMIT_RANGES: Readonly<Record<keyof PhysicsLimits, readonly [number, number]>> = Object.freeze({
  maxBodies: [1, 65536],
  maxColliders: [1, 131072],
  maxCharacters: [0, 256],
  maxEventsPerStep: [0, 65536],
  maxSnapshotBytes: [1024, 64 * 1024 * 1024],
  maxQueryHits: [1, 4096],
  maxDebugVertices: [2, 1 << 20],
  maxCoordinate: [1, 10_000_000],
});

export const PHYSICS_DEFAULT_LIMITS: PhysicsLimits = Object.freeze({
  maxBodies: 1024,
  maxColliders: 2048,
  maxCharacters: 8,
  maxEventsPerStep: 256,
  maxSnapshotBytes: 4 * 1024 * 1024,
  maxQueryHits: 64,
  maxDebugVertices: 65536,
  maxCoordinate: 1_000_000,
});

export interface PhysicsVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PhysicsOptions {
  /** m/s², each component in [-100, 100]. Default (0, -9.81, 0). */
  gravity?: PhysicsVector;
  /** Library solver iterations per step: an integer in [1, 16]. Default 4 (the library default). */
  solverIterations?: number;
  /** Library steps per engine tick: an integer in [1, 8]. Default 1. This is the per-tick step bound. */
  substeps?: number;
  /** Physics seconds per game second: (0, 4]. Default 1. Anything else is a deliberate time-scale change. */
  timeScale?: number;
  /** Arithmetic for Transform Euler angle conversions: 'platform' (default) or 'deterministic' (dmath). */
  math?: ScalarMathMode;
  limits?: Partial<PhysicsLimits>;
}

export interface PhysicsConfig {
  readonly gravity: PhysicsVector;
  readonly solverIterations: number;
  readonly substeps: number;
  readonly timeScale: number;
  /** Seconds of one library step: timeScale / (60 × substeps). */
  readonly step: number;
  readonly math: ScalarMathMode;
  readonly limits: PhysicsLimits;
}

const inRange = (name: string, v: unknown, lo: number, hi: number, integer = false): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi || (integer && !Number.isInteger(v)))
    throw new RangeError(`physics: ${name} must be ${integer ? 'an integer' : 'a number'} in [${lo}, ${hi}]`);
  return v;
};

/** Validate options into a frozen configuration, or throw a RangeError naming the first bad field. */
export function physicsConfig(o: PhysicsOptions = {}): PhysicsConfig {
  if (typeof o !== 'object' || o === null) throw new RangeError('physics: options must be an object');
  const g = o.gravity ?? {x: 0, y: -9.81, z: 0};
  if (typeof g !== 'object' || g === null) throw new RangeError('physics: gravity must be {x, y, z}');
  const gravity = Object.freeze({
    x: inRange('gravity.x', g.x, -100, 100),
    y: inRange('gravity.y', g.y, -100, 100),
    z: inRange('gravity.z', g.z, -100, 100),
  });
  const solverIterations = inRange('solverIterations', o.solverIterations ?? 4, 1, 16, true);
  const substeps = inRange('substeps', o.substeps ?? 1, 1, 8, true);
  const timeScale = o.timeScale ?? 1;
  if (typeof timeScale !== 'number' || !Number.isFinite(timeScale) || !(timeScale > 0) || timeScale > 4)
    throw new RangeError('physics: timeScale must be a number in (0, 4]');
  const math = o.math ?? 'platform';
  if (math !== 'platform' && math !== 'deterministic')
    throw new RangeError("physics: math must be 'platform' or 'deterministic'");
  const given = o.limits ?? {};
  if (typeof given !== 'object' || given === null) throw new RangeError('physics: limits must be an object');
  for (const key of Object.keys(given))
    if (!(key in PHYSICS_LIMIT_RANGES)) throw new RangeError(`physics: unknown limit ${key}`);
  const limits = {} as Record<keyof PhysicsLimits, number>;
  for (const key of Object.keys(PHYSICS_LIMIT_RANGES) as (keyof PhysicsLimits)[]) {
    const [lo, hi] = PHYSICS_LIMIT_RANGES[key];
    limits[key] = inRange(`limits.${key}`, given[key] ?? PHYSICS_DEFAULT_LIMITS[key], lo, hi, true);
  }
  return Object.freeze({
    gravity,
    solverIterations,
    substeps,
    timeScale,
    step: (timeScale * ENGINE_FIXED_STEP) / substeps,
    math,
    limits: Object.freeze(limits),
  });
}
