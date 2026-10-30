import * as T from 'three';
import type {Entity} from '../core/ecs/world';
import {validateMesh, type MeshData} from './mesh';
import type {createSceneResources} from './scene-resources';
import {retireRepresentations} from './representation-cleanup';
import type {Surface, SurfaceMaterial} from './scene-materials';

type Resources = ReturnType<typeof createSceneResources>;
export interface IndexedSlot {
  mesh: T.Mesh<T.BufferGeometry, SurfaceMaterial>;
  /** The visit surface drawing this mesh (plain matte, or its `Material`); absent, the slot owns `mesh.material`. */
  surface?: Surface;
  positions: number[];
  indices: number[];
  colors: number[];
  normals: number[];
  revision: number;
  sig: string;
}

export function indexedGeometry(data: MeshData, resources: Resources): T.BufferGeometry {
  validateMesh(data);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(data.positions, 3));
  geometry.setIndex(data.indices);
  if (data.colors.length) geometry.setAttribute('color', new T.Float32BufferAttribute(data.colors, 3));
  if (data.normals.length) geometry.setAttribute('normal', new T.Float32BufferAttribute(data.normals, 3));
  else geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return resources.own(geometry);
}

/** Publish the whole replacement before disposal events can reenter or end the visit. */
export function replaceIndexedGeometry(
  slot: IndexedSlot,
  data: MeshData,
  resources: Resources,
  current: () => boolean,
  changed: () => void,
): boolean {
  const replacement = indexedGeometry(data, resources);
  const previous = slot.mesh.geometry;
  slot.mesh.geometry = replacement;
  const vertexColors = data.colors.length > 0;
  if (slot.surface) slot.surface.colors(vertexColors);
  else if (slot.mesh.material.vertexColors !== vertexColors) {
    slot.mesh.material.vertexColors = vertexColors;
    slot.mesh.material.needsUpdate = true;
  }
  slot.positions = data.positions;
  slot.indices = data.indices;
  slot.colors = data.colors;
  slot.normals = data.normals;
  slot.revision = data.revision;
  changed();
  resources.release(previous);
  return current() && slot.mesh.geometry === replacement;
}

/** Remove the identity first; removed/dispose callbacks cannot retire a replacement slot. */
export function releaseIndexed(e: Entity, slots: Map<Entity, IndexedSlot>, scene: T.Scene, resources: Resources): void {
  const slot = slots.get(e);
  if (!slot) return;
  slots.delete(e);
  const geometry = slot.mesh.geometry,
    material = slot.mesh.material,
    surface = slot.surface;
  retireRepresentations(
    scene,
    [slot.mesh],
    [() => resources.release(geometry), () => (surface ? surface.dispose() : resources.release(material))],
  );
}
