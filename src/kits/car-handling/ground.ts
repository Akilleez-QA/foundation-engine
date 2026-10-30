/**
 * kits/car-handling/ground: the creator-supplied ground query port and two adapters for it.
 *
 * The car never owns collision data. Each wheel and each body contact point asks the port one ray question per
 * sub-step; the port writes the nearest hit into a caller-owned record and returns true, or returns false for no hit.
 * Writing into `out` keeps the per-step path free of allocation.
 */

/** A hit written by a ground query. Every field is overwritten on a hit; nothing is read on a miss. */
export interface GroundHit {
  /** Distance along the ray to the hit, in metres: [0, maxDistance]. */
  distance: number;
  /** Surface normal (world). Normalised by the car; it must be finite, nonzero and face the ray (n · dir < 0). */
  nx: number;
  ny: number;
  nz: number;
  /** Surface grip multiplier applied to the tyre's friction: [0, 4]. 1 is the configured tyre on its design surface. */
  grip: number;
  /** Extra rolling resistance coefficient of the surface: [0, 1]. 0 adds nothing (gravel or sand might add 0.05). */
  rolling: number;
}

/**
 * The ground port. Cast a ray from (ox, oy, oz) along the unit direction (dx, dy, dz) for at most `maxDistance` metres
 * and write the nearest surface hit into `out`. Return true on a hit, false when nothing is in range.
 *
 * It must be deterministic and side-effect free: it runs inside a step that may be repeated (rollback, replay) and is
 * discarded when the step fails. A throw aborts the step; the car is left exactly as before it.
 */
export type GroundQuery = (
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
  out: GroundHit,
) => boolean;

/** A new, zeroed hit record (for creators calling a ground query directly). */
export function createGroundHit(): GroundHit {
  return {distance: 0, nx: 0, ny: 1, nz: 0, grip: 1, rolling: 0};
}

/**
 * An infinite plane `y = height` (optionally sloped by `slopeX`/`slopeZ`: y = height + slopeX·x + slopeZ·z). Exact. Useful
 * for tests, tutorials and flat arenas.
 */
export function planeGround(
  o: {height?: number; slopeX?: number; slopeZ?: number; grip?: number; rolling?: number} = {},
): GroundQuery {
  const h = o.height ?? 0,
    sx = o.slopeX ?? 0,
    sz = o.slopeZ ?? 0,
    grip = o.grip ?? 1,
    rolling = o.rolling ?? 0;
  if (![h, sx, sz, grip, rolling].every(Number.isFinite) || Math.abs(sx) > 100 || Math.abs(sz) > 100)
    throw new RangeError('car-handling: plane values must be finite, slopes within [-100, 100]');
  checkSurface(grip, rolling);
  // Plane: sx·x - y + sz·z + h = 0, upward normal (-sx, 1, -sz) / |.|.
  const len = Math.sqrt(sx * sx + 1 + sz * sz),
    nx = -sx / len,
    ny = 1 / len,
    nz = -sz / len;
  return (ox, oy, oz, dx, dy, dz, maxDistance, out) => {
    const above = (oy - (h + sx * ox + sz * oz)) / len; // signed distance from the plane, + above
    const rate = dx * nx + dy * ny + dz * nz; // change of signed distance per metre along the ray
    if (above < 0) return false; // origin below the surface: the surface faces away from this ray
    if (rate >= 0) return false;
    const t = above / -rate;
    if (t > maxDistance) return false;
    out.distance = t;
    out.nx = nx;
    out.ny = ny;
    out.nz = nz;
    out.grip = grip;
    out.rolling = rolling;
    return true;
  };
}

/** One height sample of a height field, shaped like the terrain kit's `Surface.sample` result. */
export interface GroundSample {
  readonly height: number;
  readonly normal: Readonly<{x: number; y: number; z: number}>;
  readonly material?: number;
}

export interface SampledGroundOptions {
  /** Equal march samples along the ray before refinement: integer [1, 64]. Default 8. */
  march?: number;
  /** Bisection refinements after the first crossing: integer [0, 40]. Default 12. */
  refine?: number;
  /** Surface grip and rolling resistance by material id. Default grip 1, rolling 0. */
  surface?: (material: number) => {grip: number; rolling: number};
}

/**
 * A ground query over a height field `sample(x, z)` (for example `surface.sample.bind(surface)` from the terrain kit).
 * A vertical ray is answered exactly from one sample. Any other ray is marched in `march` equal steps from its origin,
 * and the first step that crosses below the surface is bisected `refine` times, so one query costs at most
 * `march + refine + 2` samples. A crossing narrower than one march step can be missed; that is the bound's price.
 * Points where `sample` returns null are treated as having no ground.
 */
export function sampledGround(
  sample: (x: number, z: number) => GroundSample | null,
  o: SampledGroundOptions = {},
): GroundQuery {
  const march = o.march ?? 8,
    refine = o.refine ?? 12;
  if (!Number.isSafeInteger(march) || march < 1 || march > 64)
    throw new RangeError('car-handling: march must be an integer within [1, 64]');
  if (!Number.isSafeInteger(refine) || refine < 0 || refine > 40)
    throw new RangeError('car-handling: refine must be an integer within [0, 40]');
  const surfaceOf = o.surface;
  /** Height of the ray point above the surface, or NaN where there is no ground. */
  const gap = (x: number, y: number, z: number) => {
    const s = sample(x, z);
    return s === null ? NaN : y - s.height;
  };
  const write = (s: GroundSample, t: number, out: GroundHit) => {
    out.distance = t;
    out.nx = s.normal.x;
    out.ny = s.normal.y;
    out.nz = s.normal.z;
    if (surfaceOf) {
      const f = surfaceOf(s.material ?? 0);
      checkSurface(f.grip, f.rolling);
      out.grip = f.grip;
      out.rolling = f.rolling;
    } else {
      out.grip = 1;
      out.rolling = 0;
    }
    return true;
  };
  return (ox, oy, oz, dx, dy, dz, maxDistance, out) => {
    if (dx === 0 && dz === 0) {
      if (dy >= 0) return false;
      const s = sample(ox, oz);
      if (s === null) return false;
      const t = (oy - s.height) / -dy;
      if (t < 0 || t > maxDistance) return false;
      return write(s, t, out);
    }
    let t0 = 0;
    if (gap(ox, oy, oz) <= 0) return false; // origin at or below the surface (no ground there also returns false below)
    const step = maxDistance / march;
    for (let i = 1; i <= march; i++) {
      const t1 = step * i,
        g1 = gap(ox + dx * t1, oy + dy * t1, oz + dz * t1);
      if (g1 <= 0) {
        let lo = t0,
          hi = t1;
        for (let k = 0; k < refine; k++) {
          const mid = (lo + hi) / 2,
            gm = gap(ox + dx * mid, oy + dy * mid, oz + dz * mid);
          if (gm <= 0) hi = mid;
          else lo = mid; // includes NaN (no ground): keep searching the far half
        }
        const s = sample(ox + dx * hi, oz + dz * hi);
        return s === null ? false : write(s, hi, out);
      }
      t0 = t1; // above the surface, or no ground at this sample (NaN)
    }
    return false;
  };
}

function checkSurface(grip: number, rolling: number) {
  if (!Number.isFinite(grip) || grip < 0 || grip > 4) throw new RangeError('car-handling: grip must be within [0, 4]');
  if (!Number.isFinite(rolling) || rolling < 0 || rolling > 1)
    throw new RangeError('car-handling: rolling must be within [0, 1]');
}
