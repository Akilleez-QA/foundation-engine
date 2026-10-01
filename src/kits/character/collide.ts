/**
 * kits/character/collide: where a character may stand, and a step that slides along what blocks it. Pure (no
 * three.js, no DOM). The area is a rectangle of walls plus solids (circles, boxes, polygons); the body is a circle.
 */
import { insideSolid, type Solid } from './solids';

export interface Point { x: number; z: number }
export interface Area { minX: number; maxX: number; minZ: number; maxZ: number; solids?: readonly Solid[]; body?: number }

/** Inside the walls (less the body radius) and outside every solid. */
export function standable(a: Area, p: Point): boolean {
  const body = a.body ?? 0.35;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return false;
  if (p.x < a.minX + body || p.x > a.maxX - body || p.z < a.minZ + body || p.z > a.maxZ - body) return false;
  return !(a.solids ?? []).some(s => insideSolid(p, s, body));
}

/** Apply `step` from `from`: whole, else sliding along one axis, else stay. */
export function slide(a: Area, from: Point, step: Point): Point {
  const whole = { x: from.x + step.x, z: from.z + step.z };
  if (standable(a, whole)) return whole;
  const alongX = { x: from.x + step.x, z: from.z }, alongZ = { x: from.x, z: from.z + step.z };
  const canX = step.x !== 0 && standable(a, alongX), canZ = step.z !== 0 && standable(a, alongZ);
  if (canX && (!canZ || Math.abs(step.x) >= Math.abs(step.z))) return alongX;
  if (canZ) return alongZ;
  return { ...from };
}
