import * as T from 'three';

export interface StaticInstances {
  /** Column-major 4x4 matrices, 16 floats per copy. */
  matrices: Float32Array;
  /** Linear RGB per copy (3 floats each), or null to draw the material's colour. */
  colors: Float32Array | null;
}

/**
 * One draw for many copies of one geometry and material (ADR 0055: features never merge or instance geometry
 * themselves; they ask the batching layer). The instance buffers are written once with static usage and uploaded once;
 * `bounds` covers every copy so frustum culling stays correct. The caller owns the result: `dispose()` frees its
 * instance buffers (never the shared geometry or material).
 *
 * No shader hooks: the material keeps whatever batching eligibility it had, and a WebGPU backend draws the same
 * `InstancedMesh` (ADR 0078).
 */
export function instanceStatic(
  geometry: T.BufferGeometry,
  material: T.Material,
  {matrices, colors}: StaticInstances,
): T.InstancedMesh {
  const count = matrices.length / 16;
  if (!Number.isInteger(count) || count < 1) throw Error('instanceStatic: give at least one 4x4 matrix');
  if (colors && colors.length !== count * 3) throw Error('instanceStatic: give one RGB colour per copy');
  const mesh = new T.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix = new T.InstancedBufferAttribute(matrices, 16).setUsage(T.StaticDrawUsage);
  if (colors) mesh.instanceColor = new T.InstancedBufferAttribute(colors, 3).setUsage(T.StaticDrawUsage);
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.name = 'Instanced static copies';
  return mesh;
}
