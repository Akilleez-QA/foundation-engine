/**
 * kits/board-traversal/rails: authored grind rails as an immutable, validated snapshot.
 *
 * A rail is a polyline of 2 to 64 points (ledges, handrails, coping, a bench edge). The board catches a rail from above
 * near any of its segments and travels along it. Rails are creator data: the kit never derives them from geometry.
 */

export const RAIL_MAX_RAILS = 1024;
export const RAIL_MAX_POINTS = 64;
export const RAIL_MAX_SEGMENTS = 8192;

export interface RailInput {
  /** Unique, nonempty, at most 256 UTF-16 code units. */
  readonly id: string;
  /** World points [x, y, z], each within ±1e7; consecutive points at least 1 cm apart. */
  readonly points: readonly (readonly [number, number, number])[];
}

export interface Rails {
  /** The creator's own revision of this rail data. */
  readonly revision: number;
  /** Rails in id order (indices are stable for this snapshot). */
  readonly ids: readonly string[];
  readonly segmentCount: number;
}

/** Packed segments (per segment ax, ay, az, bx, by, bz, length, rail, index in rail) and each rail's first segment. */
interface RailData {
  readonly segments: Float64Array;
  readonly starts: Int32Array;
}
const data = new WeakMap<object, RailData>();
export const SEG = 9;
const length3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);

/**
 * Validate and freeze rail data. `maxSegments` (integer [1, 8192], required) bounds the total segments, and so the
 * worst-case rail search per airborne sub-step. Rails are stored in id order, so results never depend on input order.
 */
export function defineRails(o: {revision: number; maxSegments: number; rails: readonly RailInput[]}): Rails {
  if (!o || typeof o !== 'object') throw new RangeError('board-traversal: rails options required');
  const {revision, maxSegments, rails} = o;
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new RangeError('board-traversal: rails revision must be a nonnegative safe integer');
  if (!Number.isSafeInteger(maxSegments) || maxSegments < 1 || maxSegments > RAIL_MAX_SEGMENTS)
    throw new RangeError(`board-traversal: maxSegments must be an integer within [1, ${RAIL_MAX_SEGMENTS}]`);
  if (!Array.isArray(rails) || rails.length > RAIL_MAX_RAILS)
    throw new RangeError(`board-traversal: at most ${RAIL_MAX_RAILS} rails`);
  const seen = new Set<string>();
  const copies: {id: string; points: [number, number, number][]}[] = [];
  let total = 0;
  for (const r of rails) {
    if (!r || typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 256)
      throw new RangeError('board-traversal: rail ids must be nonempty strings of at most 256 characters');
    if (seen.has(r.id)) throw new RangeError(`board-traversal: duplicate rail id ${r.id}`);
    seen.add(r.id);
    const pts = r.points;
    if (!Array.isArray(pts) || pts.length < 2 || pts.length > RAIL_MAX_POINTS)
      throw new RangeError(`board-traversal: rail ${r.id} needs 2 to ${RAIL_MAX_POINTS} points`);
    const copy: [number, number, number][] = [];
    for (const p of pts) {
      if (
        !Array.isArray(p) ||
        p.length !== 3 ||
        !p.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e7)
      )
        throw new RangeError(`board-traversal: rail ${r.id} points must be finite [x, y, z] within ±1e7`);
      const prev = copy[copy.length - 1];
      if (prev && length3(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) < 0.01)
        throw new RangeError(`board-traversal: rail ${r.id} has points closer than 1 cm`);
      copy.push([p[0], p[1], p[2]]);
    }
    total += copy.length - 1;
    if (total > maxSegments) throw new RangeError(`board-traversal: rails exceed maxSegments ${maxSegments}`);
    copies.push({id: r.id, points: copy});
  }
  copies.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const segments = new Float64Array(total * SEG),
    starts = new Int32Array(copies.length + 1);
  let k = 0;
  copies.forEach((r, ri) => {
    starts[ri] = k;
    for (let i = 0; i + 1 < r.points.length; i++, k++) {
      const a = r.points[i]!,
        b = r.points[i + 1]!,
        o2 = k * SEG;
      segments[o2] = a[0];
      segments[o2 + 1] = a[1];
      segments[o2 + 2] = a[2];
      segments[o2 + 3] = b[0];
      segments[o2 + 4] = b[1];
      segments[o2 + 5] = b[2];
      segments[o2 + 6] = length3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      segments[o2 + 7] = ri;
      segments[o2 + 8] = i;
    }
  });
  starts[copies.length] = k;
  const handle: Rails = Object.freeze({
    revision,
    ids: Object.freeze(copies.map(r => r.id)),
    segmentCount: total,
  });
  data.set(handle, {segments, starts});
  return handle;
}

/** @internal The packed data of a handle returned by `defineRails`; a lookalike object throws. */
export function railData(value: unknown): RailData {
  const d = typeof value === 'object' && value !== null ? data.get(value) : undefined;
  if (!d) throw new RangeError('board-traversal: rails must come from defineRails');
  return d;
}
