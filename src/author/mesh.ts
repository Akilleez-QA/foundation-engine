/** Indexed, cloneable geometry for the author renderer. No renderer dependency in authored data. */
import {defineComponent, type ComponentInit} from './defs';

/** Allocation guard, not a scene performance allowance: scenes retain their own stricter budgets. */
export const MESH_LIMITS = {vertices: 262_144, triangles: 524_288} as const;
export interface MeshData {
  positions: number[];
  indices: number[];
  /** Linear RGB vertex colors, three values per vertex; empty uses the uniform color. */
  colors: number[];
  /** Optional canonical unit normals; empty derives normals from this mesh. */
  normals: number[];
  color: number;
  visible: boolean;
  /** Increment after editing existing arrays. Replacing any geometry array also requests a rebuild. */
  revision: number;
}
export const Mesh = defineComponent<MeshData>('mesh', {
  positions: [],
  indices: [],
  colors: [],
  normals: [],
  color: 0xffffff,
  visible: true,
  revision: 0,
});
export type MeshInput = Pick<MeshData, 'positions' | 'indices'> & Partial<Omit<MeshData, 'positions' | 'indices'>>;

/** Validate before allocating GPU buffers. Empty or malformed geometry is an authoring error. */
export function validateMesh(data: MeshData): void {
  const fail = (reason: string): never => {
    throw new Error(`mesh: ${reason}`);
  };
  if (
    !Array.isArray(data.positions) ||
    data.positions.length < 9 ||
    data.positions.length % 3 ||
    data.positions.length > MESH_LIMITS.vertices * 3
  )
    fail('positions must contain 3..262144 complete vertices');
  if (
    !Array.isArray(data.indices) ||
    data.indices.length < 3 ||
    data.indices.length % 3 ||
    data.indices.length > MESH_LIMITS.triangles * 3
  )
    fail('indices must contain 1..524288 complete triangles');
  if (!Array.isArray(data.colors) || (data.colors.length !== 0 && data.colors.length !== data.positions.length))
    fail('colors must be empty or match positions');
  if (!Array.isArray(data.normals) || (data.normals.length !== 0 && data.normals.length !== data.positions.length))
    fail('normals must be empty or match positions');
  for (let i = 0; i < data.normals.length; i += 3)
    if (
      Math.abs(Math.hypot(data.normals[i]!, data.normals[i + 1]!, data.normals[i + 2]!) - 1) > 1e-5 ||
      !Number.isFinite(data.normals[i]! + data.normals[i + 1]! + data.normals[i + 2]!)
    )
      fail('normals must be finite unit vectors');
  for (const p of data.positions)
    if (!Number.isFinite(p) || !Number.isFinite(Math.fround(p))) fail('positions must fit finite float32 values');
  for (const i of data.indices)
    if (!Number.isSafeInteger(i) || i < 0 || i >= data.positions.length / 3) fail('index outside vertex range');
  for (const c of data.colors)
    if (!Number.isFinite(c) || c < 0 || c > 1) fail('colors must be finite linear RGB values in [0, 1]');
  if (!Number.isInteger(data.color) || data.color < 0 || data.color > 0xffffff)
    fail('color must be a 24-bit RGB integer');
  if (typeof data.visible !== 'boolean') fail('visible must be boolean');
  if (!Number.isSafeInteger(data.revision) || data.revision < 0) fail('revision must be a nonnegative safe integer');
}

/** Validated owned arrays. Mesh takes precedence if an entity also has Shape. */
export function defineMesh(input: MeshInput): ComponentInit<MeshData> {
  const data: MeshData = {color: 0xffffff, visible: true, revision: 0, colors: [], normals: [], ...input};
  validateMesh(data);
  return Mesh({
    ...data,
    positions: [...data.positions],
    indices: [...data.indices],
    colors: [...data.colors],
    normals: [...data.normals],
  });
}
