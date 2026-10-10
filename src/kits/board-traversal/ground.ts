/**
 * kits/board-traversal/ground: a ground port over a height field, for example the terrain kit's `Surface.sample`.
 */
import type {BoardGround} from './board';

/** One height-field sample, shaped like the terrain kit's `Surface.sample` result. */
export interface BoardGroundSample {
  readonly height: number;
  readonly normal: Readonly<{x: number; y: number; z: number}>;
}

/**
 * The board ground port over `sample(x, z)`: one sample per query. A height field has one surface per (x, z), so the
 * surface counts only when it is at or below the query height; null samples are no ground.
 */
export function sampledBoardGround(sample: (x: number, z: number) => BoardGroundSample | null): BoardGround {
  if (typeof sample !== 'function') throw new RangeError('board-traversal: sample must be a function');
  return (x, z, below, out) => {
    const s = sample(x, z);
    if (s === null || s.height > below) return false;
    out.height = s.height;
    out.nx = s.normal.x;
    out.ny = s.normal.y;
    out.nz = s.normal.z;
    return true;
  };
}
