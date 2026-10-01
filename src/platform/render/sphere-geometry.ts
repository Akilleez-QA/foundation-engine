/**
 * platform/render/sphere-geometry.ts: the shared sphere geometry cache ("the `sphereGeometry(segs)`
 * cache").
 *
 * One `SphereGeometry` per radius and segment count, for the whole session: every globe, mote and bead with the same
 * size and detail shares one upload. The geometries carry `userData.shared`, the repo's module-lifetime flag:
 * `disposeOwnedTree` and other disposers leave them alone.
 *
 * The radius is part of the key, not a mesh scale, where pixels must stay `identical`: a unit sphere scaled on the GPU
 * rounds differently in float32 (measured: up to 44 pixels at 7/255 on a close-up). Small art that may
 * move by a sub-pixel (comet motes) takes the unit sphere (radius 1) and scales its mesh.
 *
 * Never mutate a cached geometry. A caller that must own its vertices (to bake a colour or merge it) takes
 * `ownedSphere`, a copy it may change and dispose.
 */
import * as T from 'three';

const cache = new Map<string, T.SphereGeometry>();

/** The shared sphere of `radius` with `widthSegments` × `heightSegments`. */
export function sphereGeometry(widthSegments: number, heightSegments: number, radius = 1): T.SphereGeometry {
  const key = `${radius}:${widthSegments}x${heightSegments}`;
  let geometry = cache.get(key);
  if (!geometry) {
    geometry = new T.SphereGeometry(radius, widthSegments, heightSegments);
    geometry.userData.shared = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    cache.set(key, geometry);
  }
  return geometry;
}

/** A caller-owned copy of the cached sphere: free to tint, merge and dispose. */
export function ownedSphere(radius: number, widthSegments: number, heightSegments: number): T.BufferGeometry {
  const geometry = sphereGeometry(widthSegments, heightSegments, radius).clone();
  geometry.userData = {}; // copy() shares the source's userData object: give the copy its own, without the flag
  return geometry;
}

/** How many sphere geometries the cache holds (tests). */
export const cachedSphereCount = (): number => cache.size;
