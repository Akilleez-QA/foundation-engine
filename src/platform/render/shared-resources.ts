/**
 * kits/common/shared-resources.ts: module-lifetime geometries, materials and finishes shared by many models (ADR 0040,
 * STD-REN-33). They are page residents (`assets.owns`), so batching and `disposeOwnedTree` leave them alone, and they
 * carry `userData.shared = true` for guards that read the flag. Never mutate a shared geometry: scale the mesh or clone.
 */
import * as T from 'three';
import { pageResidents } from '../../platform/assets/app-ownership';

export const isSharedResource = (resource: { userData?: Record<string, unknown> } | null | undefined) => resource?.userData?.shared === true;

const geometries = new Map<string, T.BufferGeometry>(), materials = new Map<string, T.Material>(), finishes = new Map<string, T.Material>();

/** One geometry per key for the page's lifetime (bounds precomputed, so fitting never recomputes them). */
export function sharedGeometry<G extends T.BufferGeometry>(key: string, make: () => G): G {
  let geometry = geometries.get(key) as G | undefined;
  if (!geometry) { geometry = make(); geometry.userData.shared = true; geometry.computeBoundingBox(); geometry.computeBoundingSphere(); geometries.set(key, pageResidents.adopt(geometry)); }
  return geometry;
}

/** Fixed-look materials that no per-instance colour touches (glass, glints). Per-instance colours are not shared. */
export function sharedMaterial<M extends T.Material>(key: string, make: () => M): M {
  let material = materials.get(key) as M | undefined;
  if (!material) { material = make(); material.userData.shared = true; materials.set(key, pageResidents.adopt(material)); }
  return material;
}

/** A named finish (painted metal, lacquer, rubber) shared by a kit's models until it is released. */
export function finishMaterial<M extends T.Material>(key: string, make: () => M): M {
  let m = finishes.get(key) as M | undefined;
  if (!m) { m = make(); m.name = 'finish ' + key; finishes.set(key, pageResidents.adopt(m)); }
  return m;
}
/** Drop a finish from the shared set; its new single owner disposes it. Returns it if it was there. */
export function releaseFinish(key: string): T.Material | undefined {
  const m = finishes.get(key); finishes.delete(key);
  if (m) pageResidents.release(m);
  return m;
}

/** Sphere levels of detail: 'q*' levels keep a vertex at both poles and at ±x/±z, so their bounds are the unit cube. */
export const sphereSegments = { hi: [24, 16], mid: [14, 10], lo: [10, 6], tiny: [6, 4], q16: [16, 12], q12: [12, 8], q8: [8, 6] } as const;
export type SphereLod = keyof typeof sphereSegments;
/** The unit sphere at a level of detail, shared. */
export function unitSphere(lod: SphereLod = 'hi') { const [w, h] = sphereSegments[lod]; return sharedGeometry('unit-sphere:' + lod, () => new T.SphereGeometry(1, w, h)); }
