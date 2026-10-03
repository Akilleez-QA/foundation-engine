import type * as T from 'three';

/** Art-owned membership for a private run's scene. The two supported depth/filter
 * paths are covered by a pixel guard (docs/STANDARD.md STD-TST-1). Unknown
 * renderer/light/caster configurations are still rejected by the GPU adapter.
 * This does not select or downgrade the scene's lighting technique.
 */
export interface StaticShadowPolicy {
  readonly casters: readonly T.Object3D[];
  onDispose(fn: () => void): () => void;
}
const policies = new WeakMap<T.Scene, StaticShadowPolicy>();
export const staticShadowPolicyOf = (scene: T.Scene) => policies.get(scene);
/** Declare only immutable art roots, after batching. Do not include actors, screens,
 * doors or other animated assemblies. Moving an ancestor is safe: its complete
 * world transform invalidates the generation before the next presentation.
 * Declaration belongs to this scene instance, never to shared geometry/materials. */
export function adoptStaticShadowCache(scene: T.Scene, roots: readonly T.Object3D[]) {
  const casters: T.Object3D[] = [];
  for (const root of roots)
    root.traverse(o => {
      if (o.castShadow) casters.push(o);
    });
  const listeners = new Set<() => void>();
  const policy = Object.freeze({
    casters: Object.freeze(casters),
    onDispose(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  });
  policies.set(scene, policy);
  return {
    dispose() {
      if (policies.get(scene) === policy) policies.delete(scene);
      for (const fn of [...listeners]) fn();
      listeners.clear();
    },
  };
}
