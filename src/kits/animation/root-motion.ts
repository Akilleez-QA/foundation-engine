import {scalarMath, type ScalarMath, type ScalarMathMode} from '../../core/dmath';
export interface RootKey {
  readonly at: number;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}
export interface RootClip {
  readonly duration: number;
  readonly keys: readonly RootKey[];
}
export interface RootDelta {
  x: number;
  z: number;
  yaw: number;
}
const identity = (): RootDelta => ({x: 0, z: 0, yaw: 0});
const composeWith =
  (m: ScalarMath) =>
  (a: RootDelta, b: RootDelta): RootDelta => {
    const c = m.cos(a.yaw),
      s = m.sin(a.yaw);
    return {x: a.x + c * b.x + s * b.z, z: a.z - s * b.x + c * b.z, yaw: a.yaw + b.yaw};
  };
const inverseWith =
  (m: ScalarMath) =>
  (a: RootDelta): RootDelta => {
    const c = m.cos(a.yaw),
      s = m.sin(a.yaw);
    return {x: -c * a.x + s * a.z, z: -s * a.x - c * a.z, yaw: -a.yaw};
  };
/**
 * Authored planar root motion, independent of skeletal playback. Yaw is unwrapped radians. `math`: 'platform'
 * (default, Math.*) or 'deterministic' (dmath: the same bits in every JavaScript engine).
 */
export function createRootMotion(input: RootClip, loop = false, options: {math?: ScalarMathMode | undefined} = {}) {
  const m = scalarMath(options.math),
    compose = composeWith(m),
    inverse = inverseWith(m);
  const clip = structuredClone(input);
  // keys[0] and the last key are read only after the non-empty check.
  if (
    !Number.isFinite(clip.duration) ||
    clip.duration <= 0 ||
    !clip.keys.length ||
    clip.keys.length > 4096 ||
    clip.keys[0]!.at !== 0 ||
    clip.keys[clip.keys.length - 1]!.at !== clip.duration
  )
    throw Error('root motion: invalid clip');
  const first = clip.keys[0]!;
  let previous = -1;
  for (const key of clip.keys) {
    if (
      ![key.at, key.x, key.z, key.yaw].every(Number.isFinite) ||
      key.at <= previous ||
      key.at > clip.duration ||
      [key.x, key.z, key.yaw].some(v => Math.abs(v) > 1e6)
    )
      throw Error('root motion: invalid key');
    previous = key.at;
  }
  const origin = inverse(first);
  const at = (time: number): RootDelta => {
    // lo <= mid <= hi stay in 0..keys.length-1 (keys is non-empty).
    let lo = 0,
      hi = clip.keys.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (clip.keys[mid]!.at <= time) lo = mid;
      else hi = mid;
    }
    const a = clip.keys[lo]!,
      b = clip.keys[hi]!,
      u = (time - a.at) / (b.at - a.at);
    return compose(origin, {x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, yaw: a.yaw + (b.yaw - a.yaw) * u});
  };
  const end = at(clip.duration);
  const sample = (time: number) => {
    if (!Number.isFinite(time) || time < 0 || (loop && time / clip.duration > 1e6))
      throw Error('root motion: time outside budget');
    if (!loop) return at(Math.min(time, clip.duration));
    let n = Math.floor(time / clip.duration),
      cycle = end,
      total = identity();
    while (n > 0) {
      if (n % 2) total = compose(total, cycle);
      cycle = compose(cycle, cycle);
      n = Math.floor(n / 2);
    }
    return compose(total, at(time % clip.duration));
  };
  let cursor = 0,
    pose = sample(0);
  return {
    advance(time: number): RootDelta {
      if (time < cursor) throw Error('root motion: seek required');
      const next = sample(time),
        delta = compose(inverse(pose), next);
      pose = next;
      cursor = time;
      return delta;
    },
    /** Teleports/restarts suppress all intervening displacement. */
    seek(time: number) {
      pose = sample(time);
      cursor = time;
    },
    get time() {
      return cursor;
    },
  };
}
