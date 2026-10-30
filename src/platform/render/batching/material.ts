import type {Material} from 'three';

const compatible = new WeakMap<
  Material,
  {compile: Material['onBeforeCompile']; key: Material['customProgramCacheKey']}
>();
/** Certify a shader patch that depends only on world position/normal or preserved vertex attributes, not the
 * original object's local coordinates or identity. Records exact hooks: replacing either
 * hook withdraws eligibility. This does not certify deformation or a BatchedMesh path.
 */
export function staticBakeMaterial<M extends Material>(material: M): M {
  compatible.set(material, {compile: material.onBeforeCompile, key: material.customProgramCacheKey});
  return material;
}
export function hasStaticBakeMaterial(material: Material): boolean {
  const hooks = compatible.get(material);
  return !!hooks && hooks.compile === material.onBeforeCompile && hooks.key === material.customProgramCacheKey;
}
