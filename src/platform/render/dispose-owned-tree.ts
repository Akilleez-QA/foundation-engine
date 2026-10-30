import * as T from 'three';
import {assetOwners} from '../assets/app-ownership';
// three's own type flags (`isSprite`, `type`) rather than `instanceof`, so the Sprite and ArrowHelper classes stay out
// of the scene runtime chunk when no scene creates one.
const isSprite = (o: T.Object3D): o is T.Sprite => (o as Partial<T.Sprite>).isSprite === true;
const isArrowHelper = (o: T.Object3D | null): o is T.ArrowHelper => o?.type === 'ArrowHelper';
/** Release standard-material resources owned solely by this activity.
 * Shared references within the tree are disposed once. Anything the asset library owns (assets.owns: leased
 * textures, shared finishes with their textures, geometry caches, glow sprites, and
 * resources still flagged userData.shared) is always spared, as are three.js singletons (the sprite quad,
 * ArrowHelper line/cone).
 * preserveMaterial protects further borrowed finishes and their textures, including maps also
 * referenced by owned clones. Instanced meshes stay with their owner (instance buffers).
 * Not a TSL graph traversal. Use this instead of a hand-rolled traverse.
 * Disposal attempts every collected owned resource even if a listener throws, then reports all failures.
 * This cannot force a throwing resource's own internal cleanup to finish or retry it safely.
 */
export function disposeOwnedTree(
  root: T.Object3D | undefined,
  options: {preserveMaterial?: (material: T.Material) => boolean} = {},
) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>(),
    borrowedTextures = new Set<T.Texture>();
  root?.traverse(object => {
    if (object instanceof T.Mesh || object instanceof T.Line || object instanceof T.Points || isSprite(object)) {
      // Sprite and ArrowHelper geometries are Three.js-wide singletons, not activity-owned.
      if (
        !isSprite(object) &&
        !(isArrowHelper(object.parent) && (object === object.parent.line || object === object.parent.cone))
      )
        geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        const borrowed = assetOwners.owns(material) || (options.preserveMaterial?.(material) ?? false);
        if (!borrowed) materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof T.Texture) (borrowed ? borrowedTextures : textures).add(value);
      }
    }
  });
  for (const set of [geometries, textures] as Set<object>[])
    for (const value of set) if (assetOwners.owns(value)) set.delete(value);
  borrowedTextures.forEach(value => textures.delete(value));
  const errors: unknown[] = [];
  for (const resources of [geometries, materials, textures])
    for (const resource of resources) {
      try {
        resource.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
  if (errors.length) throw new AggregateError(errors, 'Owned tree resource disposal failed');
  return {geometries: geometries.size, materials: materials.size, textures: textures.size};
}
