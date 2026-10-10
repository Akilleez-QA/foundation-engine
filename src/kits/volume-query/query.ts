/**
 * kits/volume-query/query: bounded overlap and fixed-orientation sweep queries for a sphere or capsule body against an
 * immutable, creator-supplied snapshot of static spheres, capsules and oriented boxes. No physics world, broad-phase
 * owner, clock or callback: the creator builds the snapshot from its own collision data and applies any result.
 */
import {sqrt} from '../../core/dmath';
import {GAP, segmentBox, segmentSegment} from './geometry';

export type VolumeVec3 = readonly [number, number, number];
/** Unit quaternion [x, y, z, w]. */
export type VolumeQuat = readonly [number, number, number, number];

/** A static collider. `mask` (unsigned 32-bit, default all bits) must share a bit with the query mask. */
export type VolumeCollider =
  | {
      readonly id: string;
      readonly kind: 'sphere';
      readonly center: VolumeVec3;
      readonly radius: number;
      readonly mask?: number;
    }
  | {
      readonly id: string;
      readonly kind: 'capsule';
      readonly a: VolumeVec3;
      readonly b: VolumeVec3;
      readonly radius: number;
      readonly mask?: number;
    }
  | {
      readonly id: string;
      readonly kind: 'box';
      readonly center: VolumeVec3;
      readonly halfExtents: VolumeVec3;
      readonly rotation?: VolumeQuat;
      readonly mask?: number;
    };

/** The queried body. A capsule keeps its orientation for the whole sweep; a zero-length capsule is a sphere. */
export type VolumeBody =
  | {readonly kind: 'sphere'; readonly center: VolumeVec3; readonly radius: number}
  | {readonly kind: 'capsule'; readonly a: VolumeVec3; readonly b: VolumeVec3; readonly radius: number};

export interface VolumeSetInput {
  /** Creator revision of the collision data this snapshot was built from; echoed on every result. */
  readonly revision: number;
  /** Most colliders this snapshot admits, [1, VOLUME_MAX_COLLIDERS]. More throws before anything is stored. */
  readonly maxColliders: number;
  readonly colliders: readonly VolumeCollider[];
}

/** An immutable validated snapshot. Only sets returned by `defineVolumeSet` are accepted by the queries. */
export interface VolumeSet {
  readonly revision: number;
  readonly size: number;
  readonly maxColliders: number;
}

export interface VolumeQueryOptions {
  /** Query mask, unsigned 32-bit. Default all bits. */
  readonly mask?: number;
  /** Separation to keep from colliders, [0, 1000] m. Default 0. */
  readonly margin?: number;
  /** Contact band in metres, [1e-9, 0.01]. Default 1e-6. */
  readonly tolerance?: number;
  /** Most pair distance evaluations in this query, [1, 2^20]. Default 4096. */
  readonly maxEvaluations?: number;
  /** Most distance evaluations for one collider in a sweep, including fallback steps, [1, 256]. Default 32. */
  readonly maxIterations?: number;
  /** Most collider ids reported by an overlap or start overlap, [1, 1024]. Default 16. */
  readonly maxResults?: number;
}

export type VolumeSweepResult =
  | {readonly status: 'clear'; readonly revision: number; readonly fraction: 1; readonly evaluations: number}
  | {
      readonly status: 'hit';
      readonly revision: number;
      /**
       * Safe fraction of the displacement. Separation there is within tolerance of min(margin, starting separation)
       * and no earlier fraction falls below that floor minus tolerance.
       */
      readonly fraction: number;
      readonly id: string;
      /** Unit contact normal, from the collider towards the body. */
      readonly normal: VolumeVec3;
      readonly evaluations: number;
    }
  | {
      readonly status: 'start-overlap';
      readonly revision: number;
      readonly fraction: 0;
      /** Penetrated collider ids in id order, at most maxResults. */
      readonly ids: readonly string[];
      readonly truncated: boolean;
      readonly evaluations: number;
    }
  | {
      readonly status: 'unresolved';
      readonly revision: number;
      /** A proven safe prefix; contact beyond it was not resolved within maxIterations. Never a clear claim. */
      readonly fraction: number;
      readonly evaluations: number;
    }
  | {readonly status: 'over-budget'; readonly revision: number; readonly fraction: 0; readonly evaluations: number};

export interface VolumeOverlapResult {
  readonly status: 'clear' | 'overlap' | 'over-budget';
  readonly revision: number;
  /** Overlapped collider ids in id order, at most maxResults. Empty unless status is 'overlap'. */
  readonly ids: readonly string[];
  readonly truncated: boolean;
  readonly evaluations: number;
}

export const VOLUME_MAX_COLLIDERS = 16384;
export const VOLUME_MAX_ID_LENGTH = 256;
/** Largest accepted coordinate magnitude and size, in metres. */
export const VOLUME_MAX_EXTENT = 1e6;

const SPHERE = 0,
  CAPSULE = 1,
  BOX = 2;
// Per collider: kind, mask, AABB (6), then sphere/capsule a(3) b(3) r, or box centre(3) half(3) axes(9).
const STRIDE = 24,
  PARAMS = 8;

interface Store {
  readonly ids: readonly string[];
  readonly data: Float64Array;
  readonly revision: number;
}
const STORES = new WeakMap<VolumeSet, Store>();

const fail = (what: string): never => {
  throw new RangeError(`volume-query: ${what}`);
};
const coord = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= VOLUME_MAX_EXTENT;
const size = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= VOLUME_MAX_EXTENT;
/** Copy then validate, so an accessor cannot change a value between the check and its use. */
function tuple(v: unknown, n: number, what: string): number[] {
  if (!Array.isArray(v) || v.length !== n) fail(`invalid ${what}`);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((v as unknown[])[i] as number);
  return out;
}
function vec(v: unknown, what: string): VolumeVec3 {
  const [x, y, z] = tuple(v, 3, what);
  if (!(coord(x) && coord(y) && coord(z))) return fail(`invalid ${what}`);
  return [x, y, z];
}
function intIn(v: unknown, lo: number, hi: number, what: string, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < lo || v > hi) fail(`invalid ${what}`);
  return v as number;
}
function numIn(v: unknown, lo: number, hi: number, what: string, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) fail(`invalid ${what}`);
  return v as number;
}
const mask = (v: unknown, what: string) => intIn(v, 0, 0xffffffff, what, 0xffffffff);

/** Validate and freeze a snapshot. Throws RangeError before storing anything; never retains the caller's arrays. */
export function defineVolumeSet(input: VolumeSetInput): VolumeSet {
  if (!input || typeof input !== 'object') fail('invalid set');
  const revision = input.revision,
    maxColliders = input.maxColliders,
    colliders = input.colliders;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) fail('invalid revision');
  if (maxColliders === undefined) fail('maxColliders is required');
  intIn(maxColliders, 1, VOLUME_MAX_COLLIDERS, 'maxColliders', 0);
  if (!Array.isArray(colliders)) fail('invalid colliders');
  const count = colliders.length;
  if (count > maxColliders) fail('too many colliders');
  // Capture every collider before validating so a getter cannot change what was checked.
  const captured: VolumeCollider[] = [];
  for (let i = 0; i < count; i++) {
    const c = colliders[i];
    if (!c || typeof c !== 'object') fail('invalid collider');
    captured.push({...c} as VolumeCollider);
  }
  const order = captured.map((c, i) => {
    if (typeof c.id !== 'string' || !c.id || c.id.length > VOLUME_MAX_ID_LENGTH) fail('invalid collider id');
    return i;
  });
  order.sort((x, y) => (captured[x]!.id < captured[y]!.id ? -1 : captured[x]!.id > captured[y]!.id ? 1 : 0));
  const data = new Float64Array(count * STRIDE),
    ids: string[] = [];
  for (let slot = 0; slot < count; slot++) {
    const c = captured[order[slot]!]!;
    if (slot > 0 && ids[slot - 1] === c.id) fail('duplicate collider id');
    ids.push(c.id);
    const at = slot * STRIDE,
      p = at + PARAMS;
    data[at + 1] = mask(c.mask, 'collider mask');
    let minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number;
    if (c.kind === 'sphere' || c.kind === 'capsule') {
      if (!size(c.radius)) fail('invalid collider radius');
      const a = vec(c.kind === 'sphere' ? c.center : c.a, 'collider point'),
        b = c.kind === 'sphere' ? a : vec(c.b, 'collider point'),
        r = c.radius;
      data[at] = c.kind === 'sphere' ? SPHERE : CAPSULE;
      data.set(a, p);
      data.set(b, p + 3);
      data[p + 6] = r;
      minX = Math.min(a[0], b[0]) - r;
      minY = Math.min(a[1], b[1]) - r;
      minZ = Math.min(a[2], b[2]) - r;
      maxX = Math.max(a[0], b[0]) + r;
      maxY = Math.max(a[1], b[1]) + r;
      maxZ = Math.max(a[2], b[2]) + r;
    } else if (c.kind === 'box') {
      const centre = vec(c.center, 'box centre'),
        half = tuple(c.halfExtents, 3, 'box half extents') as [number, number, number];
      if (!half.every(v => size(v))) fail('invalid box half extents');
      let x = 0,
        y = 0,
        z = 0,
        w = 1;
      if (c.rotation !== undefined) {
        const q = tuple(c.rotation, 4, 'box rotation') as [number, number, number, number];
        if (!q.every(v => typeof v === 'number' && Number.isFinite(v))) fail('invalid box rotation');
        const n = sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
        if (!(Math.abs(n - 1) <= 1e-6)) fail('box rotation is not a unit quaternion');
        x = q[0] / n;
        y = q[1] / n;
        z = q[2] / n;
        w = q[3] / n;
      }
      data[at] = BOX;
      data.set(centre, p);
      data.set(half, p + 3);
      // Columns of the rotation matrix: the box's local axes in world space.
      const axes = [
        1 - 2 * (y * y + z * z),
        2 * (x * y + z * w),
        2 * (x * z - y * w),
        2 * (x * y - z * w),
        1 - 2 * (x * x + z * z),
        2 * (y * z + x * w),
        2 * (x * z + y * w),
        2 * (y * z - x * w),
        1 - 2 * (x * x + y * y),
      ];
      data.set(axes, p + 6);
      const ex = Math.abs(axes[0]!) * half[0] + Math.abs(axes[3]!) * half[1] + Math.abs(axes[6]!) * half[2],
        ey = Math.abs(axes[1]!) * half[0] + Math.abs(axes[4]!) * half[1] + Math.abs(axes[7]!) * half[2],
        ez = Math.abs(axes[2]!) * half[0] + Math.abs(axes[5]!) * half[1] + Math.abs(axes[8]!) * half[2];
      minX = centre[0] - ex;
      minY = centre[1] - ey;
      minZ = centre[2] - ez;
      maxX = centre[0] + ex;
      maxY = centre[1] + ey;
      maxZ = centre[2] + ez;
    } else {
      return fail('invalid collider kind');
    }
    data[at + 2] = minX;
    data[at + 3] = minY;
    data[at + 4] = minZ;
    data[at + 5] = maxX;
    data[at + 6] = maxY;
    data[at + 7] = maxZ;
  }
  const set: VolumeSet = Object.freeze({revision, size: count, maxColliders});
  STORES.set(set, Object.freeze({ids: Object.freeze(ids), data, revision}));
  return set;
}

function store(set: VolumeSet): Store {
  const s = set && typeof set === 'object' ? STORES.get(set) : undefined;
  if (!s) fail('unknown set');
  return s as Store;
}

interface Options {
  mask: number;
  margin: number;
  tolerance: number;
  maxEvaluations: number;
  maxIterations: number;
  maxResults: number;
}
function options(o: VolumeQueryOptions | undefined): Options {
  if (o !== undefined && (o === null || typeof o !== 'object')) fail('invalid options');
  const v = o ?? {};
  return {
    mask: mask(v.mask, 'mask'),
    margin: numIn(v.margin, 0, 1000, 'margin', 0),
    tolerance: numIn(v.tolerance, 1e-9, 0.01, 'tolerance', 1e-6),
    maxEvaluations: intIn(v.maxEvaluations, 1, 1 << 20, 'maxEvaluations', 4096),
    maxIterations: intIn(v.maxIterations, 1, 256, 'maxIterations', 32),
    maxResults: intIn(v.maxResults, 1, 1024, 'maxResults', 16),
  };
}

// The captured body core segment and radius. Queries are synchronous and never reenter, so one buffer suffices.
const BODY = new Float64Array(7);
function captureBody(body: VolumeBody): void {
  if (!body || typeof body !== 'object') fail('invalid body');
  const kind = body.kind;
  if (kind !== 'sphere' && kind !== 'capsule') fail('invalid body kind');
  const radius = body.radius;
  if (!size(radius)) fail('invalid body radius');
  const a = vec(kind === 'sphere' ? (body as {center: unknown}).center : (body as {a: unknown}).a, 'body point'),
    b = kind === 'sphere' ? a : vec((body as {b: unknown}).b, 'body point');
  BODY[0] = a[0];
  BODY[1] = a[1];
  BODY[2] = a[2];
  BODY[3] = b[0];
  BODY[4] = b[1];
  BODY[5] = b[2];
  BODY[6] = radius;
}

/** Core distance between the body translated by (ox, oy, oz) and collider `slot`; the difference lands in GAP. */
function core(data: Float64Array, slot: number, ox: number, oy: number, oz: number): number {
  const at = slot * STRIDE,
    p = at + PARAMS;
  const ax = BODY[0]! + ox,
    ay = BODY[1]! + oy,
    az = BODY[2]! + oz,
    bx = BODY[3]! + ox,
    by = BODY[4]! + oy,
    bz = BODY[5]! + oz;
  if (data[at] === BOX) return segmentBox(ax, ay, az, bx, by, bz, data, p);
  return segmentSegment(
    ax,
    ay,
    az,
    bx,
    by,
    bz,
    data[p]!,
    data[p + 1]!,
    data[p + 2]!,
    data[p + 3]!,
    data[p + 4]!,
    data[p + 5]!,
  );
}
const rounding = (data: Float64Array, slot: number) =>
  data[slot * STRIDE] === BOX ? 0 : data[slot * STRIDE + PARAMS + 6]!;

/** Whether collider `slot` can come within `reach` of the body swept by (dx, dy, dz). */
function nearSwept(data: Float64Array, slot: number, dx: number, dy: number, dz: number, reach: number): boolean {
  const at = slot * STRIDE;
  for (let k = 0; k < 3; k++) {
    const a = BODY[k]!,
      b = BODY[k + 3]!,
      d = k === 0 ? dx : k === 1 ? dy : dz;
    const lo = Math.min(a, b) + Math.min(0, d) - reach,
      hi = Math.max(a, b) + Math.max(0, d) + reach;
    if (data[at + 5 + k]! < lo || data[at + 2 + k]! > hi) return false;
  }
  return true;
}

/** Colliders sharing a mask bit whose separation from the body at its current pose is below the margin. */
export function overlapVolume(set: VolumeSet, body: VolumeBody, o?: VolumeQueryOptions): VolumeOverlapResult {
  const s = store(set),
    opt = options(o);
  captureBody(body);
  const ids: string[] = [];
  let evaluations = 0,
    found = 0;
  // Pad by the largest tolerance so rounding at the bound edge never skips a candidate.
  const reach = BODY[6]! + opt.margin + 0.01;
  for (let slot = 0; slot < s.ids.length; slot++) {
    if ((s.data[slot * STRIDE + 1]! & opt.mask) >>> 0 === 0 || !nearSwept(s.data, slot, 0, 0, 0, reach)) continue;
    if (evaluations >= opt.maxEvaluations)
      return Object.freeze({
        status: 'over-budget',
        revision: s.revision,
        ids: Object.freeze([]),
        truncated: false,
        evaluations,
      });
    evaluations++;
    const separation = core(s.data, slot, 0, 0, 0) - BODY[6]! - rounding(s.data, slot);
    if (separation < opt.margin) {
      found++;
      if (ids.length < opt.maxResults) ids.push(s.ids[slot]!);
    }
  }
  return Object.freeze({
    status: found ? 'overlap' : 'clear',
    revision: s.revision,
    ids: Object.freeze(ids),
    truncated: found > ids.length,
    evaluations,
  });
}

/**
 * Sweep the body by `displacement` at fixed orientation. Each collider's separation along a straight translation is
 * convex in the fraction, so tangent-line steps never pass the first contact and a nonnegative bound proves the rest
 * clear. Returns the earliest contact (ties by collider id), or refuses to claim clear when work runs out.
 */
export function sweepVolume(
  set: VolumeSet,
  body: VolumeBody,
  displacement: VolumeVec3,
  o?: VolumeQueryOptions,
): VolumeSweepResult {
  const s = store(set),
    opt = options(o);
  captureBody(body);
  const d = vec(displacement, 'displacement'),
    dx = d[0],
    dy = d[1],
    dz = d[2];
  const length = sqrt(dx * dx + dy * dy + dz * dz),
    radius = BODY[6]!,
    tol = opt.tolerance,
    reach = radius + opt.margin + tol;
  const data = s.data,
    revision = s.revision;
  let evaluations = 0,
    hitFraction = 2,
    hitSlot = -1,
    nx = 0,
    ny = 0,
    nz = 0,
    safe = 1,
    unresolved = false;
  const penetrated: string[] = [];
  let penetrations = 0;
  for (let slot = 0; slot < s.ids.length; slot++) {
    if ((data[slot * STRIDE + 1]! & opt.mask) >>> 0 === 0 || !nearSwept(data, slot, dx, dy, dz, reach)) continue;
    const rr = radius + rounding(data, slot);
    if (evaluations >= opt.maxEvaluations)
      return Object.freeze({status: 'over-budget', revision, fraction: 0, evaluations});
    evaluations++;
    let dist = core(data, slot, 0, 0, 0),
      gap = dist - rr;
    if (gap < 0) {
      penetrations++;
      if (penetrated.length < opt.maxResults) penetrated.push(s.ids[slot]!);
      continue;
    }
    if (penetrations || length === 0) continue;
    // Never demand more separation than the body already has; a close start may still move away.
    const floor = Math.min(opt.margin, gap);
    let t = 0,
      iterations = 1;
    for (;;) {
      // dist > 0 here because gap >= 0 and the body radius is positive.
      const gx = GAP[0]! / dist,
        gy = GAP[1]! / dist,
        gz = GAP[2]! / dist;
      const slope = gx * dx + gy * dy + gz * dz;
      // Convexity: separation stays above its tangent line, so this bound covers every later fraction.
      if (slope >= 0 || gap + slope * (1 - t) >= floor - tol) break;
      if (gap - floor <= tol) {
        if (t < hitFraction) {
          hitFraction = t;
          hitSlot = slot;
          nx = gx;
          ny = gy;
          nz = gz;
        }
        break;
      }
      if (t >= hitFraction) break; // An earlier contact is already known.
      if (iterations >= opt.maxIterations) {
        unresolved = true;
        if (t < safe) safe = t;
        break;
      }
      if (evaluations >= opt.maxEvaluations)
        return Object.freeze({status: 'over-budget', revision, fraction: 0, evaluations});
      // Newton from below: the tangent root is at or before the true root. Fall back to the Lipschitz step
      // (separation falls at most `length` per unit fraction) if rounding ever lands below the floor.
      let next = t + (gap - floor) / -slope;
      evaluations++;
      iterations++;
      dist = core(data, slot, dx * next, dy * next, dz * next);
      let nextGap = dist - rr;
      if (nextGap < floor - tol) {
        next = t + (gap - floor) / length;
        if (iterations >= opt.maxIterations) {
          unresolved = true;
          if (t < safe) safe = t;
          break;
        }
        if (evaluations >= opt.maxEvaluations)
          return Object.freeze({status: 'over-budget', revision, fraction: 0, evaluations});
        evaluations++;
        iterations++;
        dist = core(data, slot, dx * next, dy * next, dz * next);
        nextGap = dist - rr;
      }
      t = next;
      gap = nextGap;
    }
  }
  if (penetrations)
    return Object.freeze({
      status: 'start-overlap',
      revision,
      fraction: 0,
      ids: Object.freeze(penetrated),
      truncated: penetrations > penetrated.length,
      evaluations,
    });
  if (unresolved && safe < hitFraction)
    return Object.freeze({status: 'unresolved', revision, fraction: safe, evaluations});
  if (hitSlot >= 0)
    return Object.freeze({
      status: 'hit',
      revision,
      fraction: hitFraction,
      id: s.ids[hitSlot]!,
      normal: Object.freeze([nx, ny, nz]) as VolumeVec3,
      evaluations,
    });
  return Object.freeze({status: 'clear', revision, fraction: 1, evaluations});
}

/**
 * Room to extend a capsule's `b` end by `rise` while `a` stays put. `rise` must be parallel to `b - a` (or the capsule
 * have zero length): then the extended capsule is the current capsule plus the sphere at `b` swept by `rise`, so this
 * checks the current capsule for penetration and sweeps that sphere. A sideways rise would sweep a triangle, which this
 * does not cover, and throws. `fraction` is the share of `rise` available; the creator decides what to do with it.
 */
export function headroom(
  set: VolumeSet,
  body: Extract<VolumeBody, {kind: 'capsule'}>,
  rise: VolumeVec3,
  o?: VolumeQueryOptions,
): VolumeSweepResult {
  // Capture everything once; the inner queries see only these copies.
  const opt = Object.freeze(options(o));
  if (!body || typeof body !== 'object' || body.kind !== 'capsule') fail('headroom needs a capsule body');
  const radius = body.radius;
  if (!size(radius)) return fail('invalid body radius');
  const a = vec(body.a, 'body point'),
    b = vec(body.b, 'body point'),
    up = vec(rise, 'rise');
  const ax = b[0] - a[0],
    ay = b[1] - a[1],
    az = b[2] - a[2];
  const cx = ay * up[2] - az * up[1],
    cy = az * up[0] - ax * up[2],
    cz = ax * up[1] - ay * up[0];
  const cross = sqrt(cx * cx + cy * cy + cz * cz),
    lengths = sqrt(ax * ax + ay * ay + az * az) * sqrt(up[0] * up[0] + up[1] * up[1] + up[2] * up[2]);
  if (cross > 1e-9 * lengths) fail('headroom rise must be parallel to the capsule axis');
  const capsule = Object.freeze({kind: 'capsule' as const, a, b, radius});
  const now = overlapVolume(set, capsule, {...opt, margin: 0});
  if (now.status === 'over-budget')
    return Object.freeze({status: 'over-budget', revision: now.revision, fraction: 0, evaluations: now.evaluations});
  if (now.status === 'overlap')
    return Object.freeze({
      status: 'start-overlap',
      revision: now.revision,
      fraction: 0,
      ids: now.ids,
      truncated: now.truncated,
      evaluations: now.evaluations,
    });
  const remaining = opt.maxEvaluations - now.evaluations;
  if (remaining < 1)
    return Object.freeze({status: 'over-budget', revision: now.revision, fraction: 0, evaluations: now.evaluations});
  const swept = sweepVolume(set, {kind: 'sphere', center: b, radius}, up, {...opt, maxEvaluations: remaining});
  return Object.freeze({...swept, evaluations: swept.evaluations + now.evaluations}) as VolumeSweepResult;
}
