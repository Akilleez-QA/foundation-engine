/**
 * kits/volume-query/geometry: exact distances between the cores of rounded convex primitives. A sphere is a point and
 * a capsule a segment, each grown by a radius; a box is an oriented box with no rounding. Pure and allocation-free:
 * each kernel returns the core distance and writes the difference (body point minus collider point) into `GAP`.
 * Only +, -, *, / and sqrt are used, so results are IEEE-754 reproducible across conforming engines.
 */
import {sqrt} from '../../core/dmath';

/** The latest kernel's difference vector, body side minus collider side. Read it before the next call. */
export const GAP = new Float64Array(3);
const TINY = 1e-24;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Distance between segment P0-P1 and segment Q0-Q1 (either may have zero length). */
export function segmentSegment(
  p0x: number,
  p0y: number,
  p0z: number,
  p1x: number,
  p1y: number,
  p1z: number,
  q0x: number,
  q0y: number,
  q0z: number,
  q1x: number,
  q1y: number,
  q1z: number,
): number {
  const ux = p1x - p0x,
    uy = p1y - p0y,
    uz = p1z - p0z,
    vx = q1x - q0x,
    vy = q1y - q0y,
    vz = q1z - q0z,
    wx = p0x - q0x,
    wy = p0y - q0y,
    wz = p0z - q0z;
  // Minimise |w + s u - t v|^2 over s, t in [0, 1].
  const a = ux * ux + uy * uy + uz * uz,
    b = ux * vx + uy * vy + uz * vz,
    c = vx * vx + vy * vy + vz * vz,
    d = ux * wx + uy * wy + uz * wz,
    e = vx * wx + vy * wy + vz * wz;
  let s = 0,
    t = 0;
  if (a <= TINY && c <= TINY) {
    s = 0;
    t = 0;
  } else if (a <= TINY) {
    t = clamp01(e / c);
  } else if (c <= TINY) {
    s = clamp01(-d / a);
  } else {
    const det = a * c - b * b;
    if (det > 1e-12 * a * c) {
      s = clamp01((b * e - c * d) / det);
      t = (b * s + e) / c;
      if (t < 0) {
        t = 0;
        s = clamp01(-d / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - d) / a);
      }
    } else {
      // Near-parallel: the minimum lies on the boundary of the parameter square. Each edge is a 1D convex quadratic
      // solved exactly by clamping; take the best of the four, so the result does not depend on endpoint order.
      let best = Infinity;
      for (let k = 0; k < 4; k++) {
        let cs: number, ct: number;
        if (k === 0) {
          cs = 0;
          ct = clamp01(e / c);
        } else if (k === 1) {
          cs = 1;
          ct = clamp01((b + e) / c);
        } else if (k === 2) {
          ct = 0;
          cs = clamp01(-d / a);
        } else {
          ct = 1;
          cs = clamp01((b - d) / a);
        }
        const hx = wx + cs * ux - ct * vx,
          hy = wy + cs * uy - ct * vy,
          hz = wz + cs * uz - ct * vz,
          q = hx * hx + hy * hy + hz * hz;
        if (q < best) {
          best = q;
          s = cs;
          t = ct;
        }
      }
    }
  }
  const gx = wx + s * ux - t * vx,
    gy = wy + s * uy - t * vy,
    gz = wz + s * uz - t * vz;
  GAP[0] = gx;
  GAP[1] = gy;
  GAP[2] = gz;
  return sqrt(gx * gx + gy * gy + gz * gz);
}

/** Box in local coordinates: half extents hx, hy, hz centred at the origin. Distance from a local point. */
function pointBoxLocal(x: number, y: number, z: number, hx: number, hy: number, hz: number): number {
  const gx = x > hx ? x - hx : x < -hx ? x + hx : 0,
    gy = y > hy ? y - hy : y < -hy ? y + hy : 0,
    gz = z > hz ? z - hz : z < -hz ? z + hz : 0;
  GAP[0] = gx;
  GAP[1] = gy;
  GAP[2] = gz;
  return sqrt(gx * gx + gy * gy + gz * gz);
}

/** Whether the local segment touches the local box (slab clipping, closed). */
function segmentHitsBox(
  ax: number,
  ay: number,
  az: number,
  dx: number,
  dy: number,
  dz: number,
  hx: number,
  hy: number,
  hz: number,
): boolean {
  let lo = 0,
    hi = 1;
  for (let k = 0; k < 3; k++) {
    const o = k === 0 ? ax : k === 1 ? ay : az,
      d = k === 0 ? dx : k === 1 ? dy : dz,
      h = k === 0 ? hx : k === 1 ? hy : hz;
    if (d === 0) {
      if (o < -h || o > h) return false;
      continue;
    }
    let t0 = (-h - o) / d,
      t1 = (h - o) / d;
    if (t0 > t1) {
      const swap = t0;
      t0 = t1;
      t1 = swap;
    }
    if (t0 > lo) lo = t0;
    if (t1 < hi) hi = t1;
    if (lo > hi) return false;
  }
  return true;
}

// The 12 box edges, as sign patterns of their two fixed coordinates, for each running axis.
const EDGE_SIGNS = [-1, -1, -1, 1, 1, -1, 1, 1];
const LOCAL = new Float64Array(3);

/**
 * Distance from segment A-B (world) to an oriented box with centre c, unit axes e0, e1, e2 (world) and half extents
 * h. `axes` holds e0, e1, e2 consecutively from `at`. Disjoint convex shapes meet at a segment endpoint against the
 * box, or at the segment against a box edge, so these 14 candidates are exhaustive.
 */
export function segmentBox(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  data: Float64Array,
  at: number,
): number {
  const cx = data[at]!,
    cy = data[at + 1]!,
    cz = data[at + 2]!,
    hx = data[at + 3]!,
    hy = data[at + 4]!,
    hz = data[at + 5]!,
    e0x = data[at + 6]!,
    e0y = data[at + 7]!,
    e0z = data[at + 8]!,
    e1x = data[at + 9]!,
    e1y = data[at + 10]!,
    e1z = data[at + 11]!,
    e2x = data[at + 12]!,
    e2y = data[at + 13]!,
    e2z = data[at + 14]!;
  const rax = ax - cx,
    ray = ay - cy,
    raz = az - cz,
    rbx = bx - cx,
    rby = by - cy,
    rbz = bz - cz;
  const l0x = rax * e0x + ray * e0y + raz * e0z,
    l0y = rax * e1x + ray * e1y + raz * e1z,
    l0z = rax * e2x + ray * e2y + raz * e2z,
    l1x = rbx * e0x + rby * e0y + rbz * e0z,
    l1y = rbx * e1x + rby * e1y + rbz * e1z,
    l1z = rbx * e2x + rby * e2y + rbz * e2z;
  let best: number;
  if (segmentHitsBox(l0x, l0y, l0z, l1x - l0x, l1y - l0y, l1z - l0z, hx, hy, hz)) {
    LOCAL[0] = 0;
    LOCAL[1] = 0;
    LOCAL[2] = 0;
    best = 0;
  } else {
    best = pointBoxLocal(l0x, l0y, l0z, hx, hy, hz);
    LOCAL.set(GAP);
    const end = pointBoxLocal(l1x, l1y, l1z, hx, hy, hz);
    if (end < best) {
      best = end;
      LOCAL.set(GAP);
    }
    for (let axis = 0; axis < 3; axis++) {
      for (let k = 0; k < 8; k += 2) {
        const u = EDGE_SIGNS[k]!,
          v = EDGE_SIGNS[k + 1]!;
        // Running coordinate spans [-h, h] on `axis`; the other two sit at their signed half extents.
        let q0x: number, q0y: number, q0z: number, q1x: number, q1y: number, q1z: number;
        if (axis === 0) {
          q0x = -hx;
          q1x = hx;
          q0y = q1y = u * hy;
          q0z = q1z = v * hz;
        } else if (axis === 1) {
          q0y = -hy;
          q1y = hy;
          q0x = q1x = u * hx;
          q0z = q1z = v * hz;
        } else {
          q0z = -hz;
          q1z = hz;
          q0x = q1x = u * hx;
          q0y = q1y = v * hy;
        }
        const dist = segmentSegment(l0x, l0y, l0z, l1x, l1y, l1z, q0x, q0y, q0z, q1x, q1y, q1z);
        if (dist < best) {
          best = dist;
          LOCAL.set(GAP);
        }
      }
    }
  }
  const gx = LOCAL[0]!,
    gy = LOCAL[1]!,
    gz = LOCAL[2]!;
  GAP[0] = gx * e0x + gy * e1x + gz * e2x;
  GAP[1] = gx * e0y + gy * e1y + gz * e2y;
  GAP[2] = gx * e0z + gy * e1z + gz * e2z;
  return best;
}
