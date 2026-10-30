import * as T from 'three';
import {stillSafe} from './still-safe';
const slots = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'bumpMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
] as const;
/** Apply filtering without reinterpreting scientific colors or numeric texture data. */
export function finishMaterialTextures(material: T.Material, anisotropy: number) {
  const maps = material as T.MeshStandardMaterial;
  for (const slot of slots) {
    const texture = maps[slot];
    if (texture && !(texture instanceof T.VideoTexture) && texture.anisotropy !== anisotropy) {
      texture.anisotropy = anisotropy;
      texture.needsUpdate = true;
    }
  }
}
/** Async loaders may attach maps after initial construction. Check at first actual use. */
export function installMaterialQuality(root: T.Object3D, maximum: number) {
  const anisotropy = Math.max(1, Math.min(8, Number.isFinite(maximum) ? maximum : 1));
  const originals = new Map<T.Mesh, T.Mesh['onBeforeRender']>();
  const wrappers = new Map<T.Mesh, T.Mesh['onBeforeRender']>();
  // A scene may rebuild part of itself (a model rebuilt after an edit) and refresh again: meshes that have left the
  // tree are forgotten (and unwrapped), so the maps never hold on to discarded meshes.
  const refresh = () => {
    const seen = new Set<T.Mesh>();
    root.traverse(object => {
      if (!(object instanceof T.Mesh)) return;
      seen.add(object);
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        finishMaterialTextures(material, anisotropy);
      if (originals.has(object)) return;
      const original = object.onBeforeRender;
      const wrapper: T.Mesh['onBeforeRender'] = function (
        this: T.Mesh,
        renderer,
        scene,
        camera,
        geometry,
        material,
        group,
      ) {
        finishMaterialTextures(material, anisotropy);
        original.call(this, renderer, scene, camera, geometry, material, group);
      };
      // Filtering changes no pixels of a still frame, so it does not keep an idle scene redrawing.
      if (original === T.Object3D.prototype.onBeforeRender) stillSafe(wrapper);
      originals.set(object, original);
      wrappers.set(object, wrapper);
      object.onBeforeRender = wrapper;
    });
    for (const [mesh, original] of originals)
      if (!seen.has(mesh)) {
        if (mesh.onBeforeRender === wrappers.get(mesh)) mesh.onBeforeRender = original;
        originals.delete(mesh);
        wrappers.delete(mesh);
      }
  };
  return {
    refresh,
    dispose() {
      for (const [mesh, original] of originals)
        if (mesh.onBeforeRender === wrappers.get(mesh)) mesh.onBeforeRender = original;
      originals.clear();
      wrappers.clear();
    },
  };
}
