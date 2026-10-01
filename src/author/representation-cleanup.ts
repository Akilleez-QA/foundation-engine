import type { Object3D, Scene } from 'three';

/** Identities must be detached from their maps before invoking Three/user callbacks. */
export function retireRepresentations(scene: Scene, meshes: readonly Object3D[], releases: readonly (() => void)[]): void {
  const errors: unknown[] = [];
  for (const mesh of meshes) {
    try { scene.remove(mesh); } catch (error) { errors.push(error); }
  }
  for (const release of releases) {
    try { release(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'representation cleanup failed');
}
