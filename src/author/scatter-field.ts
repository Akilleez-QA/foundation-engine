/**
 * author/scatter-field.ts: the pure half of `Scatter` (author/scatter.ts): where each copy goes, which copies a quality
 * preset keeps, and which scatters a scene admits. No GPU objects; the visit's drawing (author/scene-scatter.ts) and
 * `testScene` both use it.
 *
 * Placement: each scatter draws from its own stream, `deriveSeed(root, 'scatter', seed)`, where `root` comes from the
 * scene id and the run's `?seed=` (0 without one). Each copy takes the same fixed number of values from it whatever the
 * data asks for, so copy i lands in the same place at every density, and the copies a lighter preset keeps are a
 * subset of those a heavier one keeps (copy i is kept when its own value is below the density). Essential scatters are
 * never thinned. Nothing here reads `ctx.random()`.
 *
 * Admission (per visit): a scatter is admitted while the scene has fewer than `max` scatters and room for its kept
 * copies within `instances`; otherwise it is refused, counted by cause and reported once per cause. Essential scatters
 * are offered first. A refused scatter is offered again when its data changes or another scatter lets go.
 */
import * as T from 'three';
import {createRng, deriveSeed} from '../core/rng';
import {scatterCount, type ScatterData, type SceneScatterLimits} from './scatter';

/** Values each copy takes from the stream: 3 position, 2 tilt, yaw, scale, 3 colour, keep. */
const DRAWS_PER_COPY = 10;

export interface ScatterPlacement {
  /** Copies kept at this density. */
  readonly count: number;
  /** Copies the data asks for. */
  readonly requested: number;
  /** Column-major 4x4 matrices, 16 floats per kept copy, in the scatter's own space. */
  readonly matrices: Float32Array;
  /** Linear RGB per kept copy (3 floats each), or null when there is no colour jitter. */
  readonly colors: Float32Array | null;
}

/** Where the copies of `d` go at `density` (0…1, the `effects.scatter-density` knob). Pure and deterministic. */
export function placeScatter(d: ScatterData, root: number, density: number): ScatterPlacement {
  const requested = scatterCount(d),
    rng = createRng(deriveSeed(root >>> 0, 'scatter', d.seed)),
    keepAll = d.essential || density >= 1;
  const matrices = new Float32Array(requested * 16),
    jitter = d.colorJitter.some(j => j > 0),
    colors = jitter ? new Float32Array(requested * 3) : null;
  const m = new T.Matrix4(),
    q = new T.Quaternion(),
    yaw = new T.Quaternion(),
    lean = new T.Quaternion(),
    axis = new T.Vector3(),
    up = new T.Vector3(0, 1, 0),
    p = new T.Vector3(),
    s = new T.Vector3(),
    base = new T.Color().setHex(d.color),
    c = new T.Color();
  let kept = 0;
  for (let i = 0; i < requested; i++) {
    const u: number[] = [];
    for (let k = 0; k < DRAWS_PER_COPY; k++) u.push(rng.next());
    const [a = 0, b = 0, e = 0, tiltSize = 0, tiltDir = 0, turn = 0, size = 0, hue = 0, sat = 0, light = 0] = u;
    if (!keepAll && (u[DRAWS_PER_COPY - 1] ?? 0) >= density) continue;
    let x: number, z: number;
    const point = d.points[i];
    if (point) [x, z] = point;
    else {
      const area = d.area!;
      if (area.kind === 'rect') {
        const [x0, z0, x1, z1] = area.rect;
        x = x0 + (x1 - x0) * a;
        z = z0 + (z1 - z0) * b;
      } else if (area.kind === 'ring') {
        const [r0, r1] = area.radius,
          r = Math.sqrt(r0 * r0 + (r1 * r1 - r0 * r0) * a),
          angle = 2 * Math.PI * b;
        x = r * Math.cos(angle);
        z = r * Math.sin(angle);
      } else {
        // Four strips: the full-width bands along minZ and maxZ, and the side bands between them, by area.
        const [x0, z0, x1, z1] = area.rect,
          w = area.width,
          long = (x1 - x0) * w,
          side = (z1 - z0 - 2 * w) * w,
          pick = e * 2 * (long + side);
        if (pick < 2 * long) {
          x = x0 + (x1 - x0) * a;
          z = pick < long ? z0 + w * b : z1 - w * b;
        } else {
          x = pick < 2 * long + side ? x0 + w * a : x1 - w * a;
          z = z0 + w + (z1 - z0 - 2 * w) * b;
        }
      }
    }
    yaw.setFromAxisAngle(up, d.ry === 'random' ? 2 * Math.PI * turn : d.ry);
    axis.set(Math.cos(2 * Math.PI * tiltDir), 0, Math.sin(2 * Math.PI * tiltDir));
    lean.setFromAxisAngle(axis, d.tilt * tiltSize);
    q.multiplyQuaternions(lean, yaw);
    const k = d.scale[0] + (d.scale[1] - d.scale[0]) * size;
    m.compose(p.set(x, d.y, z), q, s.set(k, k, k));
    m.toArray(matrices, kept * 16);
    if (colors) {
      const [jh, js, jl] = d.colorJitter;
      c.copy(base).offsetHSL((hue - 0.5) * 2 * jh, (sat - 0.5) * 2 * js, (light - 0.5) * 2 * jl);
      colors[kept * 3] = c.r;
      colors[kept * 3 + 1] = c.g;
      colors[kept * 3 + 2] = c.b;
    }
    kept++;
  }
  return {
    count: kept,
    requested,
    matrices: kept === requested ? matrices : matrices.slice(0, kept * 16),
    colors: colors && kept !== requested ? colors.slice(0, kept * 3) : colors,
  };
}

export type ScatterRefusal = 'scatters' | 'instances' | 'invalid';

export interface ScatterStats {
  /** Scatters admitted (drawn) now. */
  scatters: number;
  /** Copies drawn now across admitted scatters. */
  instances: number;
  /** Copies the admitted scatters asked for before thinning. */
  requested: number;
  /** Refusals since the visit began, by cause: too many scatters, too many copies, invalid data. */
  refused: Record<ScatterRefusal, number>;
}

/** Visit admission against `sceneScatter` limits. Holds ids, never data. */
export function createScatterAdmission<K>(limits: Readonly<SceneScatterLimits>, report: (error: Error) => void) {
  const held = new Map<K, {instances: number; requested: number}>();
  const reported = new Set<ScatterRefusal>();
  const stats: ScatterStats = {
    scatters: 0,
    instances: 0,
    requested: 0,
    refused: {scatters: 0, instances: 0, invalid: 0},
  };
  const total = () => {
    let instances = 0,
      requested = 0;
    for (const h of held.values()) {
      instances += h.instances;
      requested += h.requested;
    }
    stats.scatters = held.size;
    stats.instances = instances;
    stats.requested = requested;
    return instances;
  };
  const refuse = (cause: ScatterRefusal, message: string) => {
    stats.refused[cause]++;
    if (reported.has(cause)) return false;
    reported.add(cause);
    report(Error(`scatter: ${message}`));
    return false;
  };
  return {
    stats,
    /** Admit (or re-admit with new numbers) `key`; false, counted and reported once per cause, when it does not fit. */
    admit(key: K, instances: number, requested: number): boolean {
      const previous = held.get(key);
      const others = total() - (previous?.instances ?? 0);
      if (!previous && held.size >= limits.max)
        return refuse('scatters', `refused: the scene draws at most ${limits.max} scatters (sceneScatter({ max }))`);
      if (others + instances > limits.instances) {
        if (previous) {
          held.delete(key);
          total();
        }
        return refuse(
          'instances',
          `refused: ${instances} copies do not fit the scene's ${limits.instances} (sceneScatter({ instances }))`,
        );
      }
      held.set(key, {instances, requested});
      total();
      return true;
    },
    invalid(error: unknown) {
      return refuse('invalid', error instanceof Error ? error.message.replace(/^scatter: /, '') : String(error));
    },
    release(key: K): boolean {
      const had = held.delete(key);
      total();
      return had;
    },
    has: (key: K) => held.has(key),
  };
}
