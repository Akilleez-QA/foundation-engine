import {platformMath, type ScalarMath} from '../../core/dmath';
export type Solid =
  | {id: string; kind: 'circle'; x: number; z: number; r: number}
  | {id: string; kind: 'box'; x: number; z: number; halfX: number; halfZ: number; rotation?: number}
  | {id: string; kind: 'polygon'; x: number; z: number; inradius: number; sides: number; rotation?: number};
/** Whether p lies inside s grown by `inflate`. `math` evaluates a rotation (platformMath unless a creator opts in). */
export function insideSolid(p: {x: number; z: number}, s: Solid, inflate = 0, math: ScalarMath = platformMath) {
  const dx = p.x - s.x,
    dz = p.z - s.z;
  if (s.kind === 'circle') return math.hypot(dx, dz) < s.r + inflate;
  const c = math.cos(-(s.rotation ?? 0)),
    n = math.sin(-(s.rotation ?? 0)),
    lx = dx * c - dz * n,
    lz = dx * n + dz * c;
  if (s.kind === 'box') return Math.abs(lx) < s.halfX + inflate && Math.abs(lz) < s.halfZ + inflate;
  for (let i = 0; i < s.sides; i++) {
    const a = ((i + 0.5) * Math.PI * 2) / s.sides;
    if (lx * math.cos(a) + lz * math.sin(a) > s.inradius + inflate) return false;
  }
  return true;
}
