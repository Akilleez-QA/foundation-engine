import {Vector3} from 'three';
import type * as T from 'three';
import type {Entity} from '../core/ecs/world';
import type {SceneVisit} from '../core/router/handover';
import type {AssetLease} from '../platform/assets/lease-cache';
import type {ModelTemplate} from '../platform/assets/models';
import type {ModelData} from './model';

/** Optional pull diagnostics. Limits: 64 clips/page, 32 sockets, 4096 nodes and 256 characters/label.
 * Socket matrices and geometry boxes are cached values; inspection never advances animation or recomputes them.
 * Playback revisions restart clips; they are not authored document revisions or entity incarnations.
 */
export interface ModelInspectionRequest {
  entity: Entity;
  clipOffset?: number;
  clipLimit?: number;
  sockets?: readonly string[];
  maxNodes?: number;
  maxLabelLength?: number;
  /** At most 32 explicit weighted vertices; world positions from the last runtime matrices, no pose updates. */
  skinVertices?: readonly {mesh: string; vertex: number}[];
}
export interface ModelInspectionSource {
  requested?: ModelData | undefined;
  slot?:
    | {
        asset: string;
        ready?: boolean;
        failed?: boolean;
        root?: T.Object3D;
        lease?: AssetLease<ModelTemplate> | undefined;
        action?: T.AnimationAction | undefined;
        animationKey?: string;
        poseKey?: string;
        overrides?: Set<T.Object3D>;
        nodes?: Map<string, T.Object3D | null>;
      }
    | undefined;
}
export interface CachedModelBounds {
  basis: 'cached-geometry-and-world-matrices';
  status: 'available' | 'partial' | 'unavailable';
  min: number[] | null;
  max: number[] | null;
  visited: number;
  included: number;
  skipped: {skinned: number; instanced: number; morphed: number; uncomputed: number; nonfinite: number};
  truncated: boolean;
}
/** Bounded node traversal. Never computes geometry boxes, updates matrices, skins vertices or traverses recursively. */
function cachedBounds(root: T.Object3D, maxNodes: number): CachedModelBounds {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  const skipped = {skinned: 0, instanced: 0, morphed: 0, uncomputed: 0, nonfinite: 0};
  let visited = 0,
    included = 0;
  const stack: {node: T.Object3D; child: number}[] = [{node: root, child: -1}];
  // stack.length > 0 wherever its top is read; axis < 3 indexes the 3-element bounds and the 16-element matrix.
  while (stack.length && visited < maxNodes) {
    const frame = stack[stack.length - 1]!;
    if (frame.child < 0) {
      visited++;
      frame.child = 0;
      const mesh = frame.node as T.Mesh;
      if (mesh.isMesh) {
        // Instance transforms are already represented by the optional object-level cache.
        // Never substitute the base geometry box or enumerate/recompute instance matrices.
        const instanced = mesh as T.InstancedMesh;
        const box = instanced.isInstancedMesh ? instanced.boundingBox : mesh.geometry?.boundingBox;
        if ((mesh as T.SkinnedMesh).isSkinnedMesh) skipped.skinned++;
        else if (mesh.geometry?.morphAttributes.position?.length) skipped.morphed++;
        else if (!box && instanced.isInstancedMesh) skipped.instanced++;
        else if (!box) skipped.uncomputed++;
        else {
          const low = [Infinity, Infinity, Infinity],
            high = [-Infinity, -Infinity, -Infinity],
            m = mesh.matrixWorld.elements;
          for (let bits = 0; bits < 8; bits++) {
            const x = bits & 1 ? box.max.x : box.min.x,
              y = bits & 2 ? box.max.y : box.min.y,
              z = bits & 4 ? box.max.z : box.min.z;
            for (let axis = 0; axis < 3; axis++) {
              const value = m[axis]! * x + m[axis + 4]! * y + m[axis + 8]! * z + m[axis + 12]!;
              low[axis] = Math.min(low[axis]!, value);
              high[axis] = Math.max(high[axis]!, value);
            }
          }
          if (![...low, ...high].every(Number.isFinite)) skipped.nonfinite++;
          else {
            included++;
            for (let axis = 0; axis < 3; axis++) {
              min[axis] = Math.min(min[axis]!, low[axis]!);
              max[axis] = Math.max(max[axis]!, high[axis]!);
            }
          }
        }
      }
    }
    // Pop completed ancestors without visiting another node; exactly reaching the budget may be complete.
    while (stack.length && stack[stack.length - 1]!.child >= stack[stack.length - 1]!.node.children.length) stack.pop();
    // The top's child < children.length after the pops above.
    if (stack.length && visited < maxNodes) {
      const parent = stack[stack.length - 1]!;
      stack.push({node: parent.node.children[parent.child++]!, child: -1});
    }
  }
  const truncated = stack.length > 0,
    incomplete = truncated || Object.values(skipped).some(n => n > 0);
  return {
    basis: 'cached-geometry-and-world-matrices',
    status: !included ? 'unavailable' : incomplete ? 'partial' : 'available',
    min: included ? min : null,
    max: included ? max : null,
    visited,
    included,
    skipped,
    truncated,
  };
}

/** Compare only supported scalar pose fields. Oversized applied signatures are conservatively incomplete. */
function sameAppliedPose(poses: ModelData['pose'], key: string | undefined): boolean {
  if (poses.length > 128 || key === undefined || key.length > 131072) return false;
  let applied: unknown;
  try {
    applied = JSON.parse(key);
  } catch {
    return false;
  }
  if (!Array.isArray(applied) || applied.length !== poses.length) return false;
  for (const [i, wanted] of poses.entries()) {
    const actual = applied[i];
    if (!actual || typeof actual !== 'object' || actual.node !== wanted.node) return false;
    for (const field of ['position', 'rotation'] as const) {
      const a = actual[field],
        b = wanted[field],
        size = field === 'position' ? 3 : 4;
      if (a === undefined && b === undefined) continue;
      if (!Array.isArray(a) || !b || a.length !== size || b.length !== size) return false;
      for (let j = 0; j < size; j++) if (a[j] !== b[j]) return false;
    }
  }
  return true;
}

/** Detached on-demand scalars; source is read only after all request accessors have run. */
export function inspectModel(request: ModelInspectionRequest, read: (entity: Entity) => ModelInspectionSource | null) {
  const {
    entity,
    clipOffset = 0,
    clipLimit = 16,
    sockets = [],
    skinVertices = [],
    maxNodes = 256,
    maxLabelLength = 120,
  } = request;
  const socketCount = Array.isArray(sockets) ? sockets.length : -1;
  if (
    !Number.isSafeInteger(entity) ||
    entity < 0 ||
    !Number.isSafeInteger(clipOffset) ||
    clipOffset < 0 ||
    !Number.isSafeInteger(clipLimit) ||
    clipLimit < 1 ||
    clipLimit > 64 ||
    !Number.isSafeInteger(maxNodes) ||
    maxNodes < 1 ||
    maxNodes > 4096 ||
    !Number.isSafeInteger(maxLabelLength) ||
    maxLabelLength < 1 ||
    maxLabelLength > 256 ||
    !Number.isSafeInteger(socketCount) ||
    socketCount < 0 ||
    socketCount > 32
  )
    throw RangeError('model inspection: invalid bounds');
  const names: string[] = [],
    count = socketCount;
  for (let i = 0; i < count; i++) {
    const name = sockets[i];
    if (typeof name !== 'string' || !name || name.length > 256) throw RangeError('model inspection: invalid socket');
    names.push(name);
  }
  const vertexCount = Array.isArray(skinVertices) ? skinVertices.length : -1;
  if (!Number.isSafeInteger(vertexCount) || vertexCount < 0 || vertexCount > 32)
    throw RangeError('model inspection: invalid vertex request');
  const vertices: {mesh: string; vertex: number}[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const row = skinVertices[i];
    if (!row || typeof row !== 'object') throw RangeError('model inspection: invalid vertex request');
    const {mesh, vertex} = row;
    if (typeof mesh !== 'string' || !mesh || mesh.length > 256 || !Number.isSafeInteger(vertex) || vertex < 0)
      throw RangeError('model inspection: invalid vertex request');
    vertices.push({mesh, vertex});
  }
  const source = read(entity);
  if (!source) return {status: 'unavailable' as const};
  const {requested, slot} = source;
  const label = (value: string) => ({value: value.slice(0, maxLabelLength), truncated: value.length > maxLabelLength});
  const state = !slot
    ? requested
      ? 'unrequested'
      : 'absent'
    : slot.failed
      ? 'failed'
      : slot.ready
        ? 'ready'
        : 'loading';
  const animations = slot?.lease?.value.animations;
  const total = animations?.length ?? 0;
  if (clipOffset > total) throw RangeError('model inspection: clip offset outside list');
  const clips = [];
  for (let i = clipOffset; i < Math.min(total, clipOffset + clipLimit); i++) {
    const clip = animations![i]!;
    /* i < total = animations.length */ clips.push({
      index: i,
      name: label(clip.name),
      duration: Number.isFinite(clip.duration) ? clip.duration : null,
    });
  }
  const key = slot?.animationKey,
    last = key?.lastIndexOf('|') ?? -1,
    previous = key?.lastIndexOf('|', last - 1) ?? -1;
  const action = slot?.action;
  const requestedPoses = requested?.pose ?? [];
  const poseNames = [];
  for (let i = 0; i < Math.min(requestedPoses.length, 128); i++) {
    // i < requestedPoses.length
    const p = requestedPoses[i]!,
      node = slot?.nodes?.get(p.node);
    poseNames.push({
      name: label(p.node),
      status: !slot?.ready
        ? 'not-ready'
        : node === null
          ? 'ambiguous'
          : node === undefined
            ? 'absent'
            : slot.overrides?.has(node)
              ? 'applied'
              : 'not-applied',
    });
  }
  return {
    status: 'observed' as const,
    entity,
    state,
    requested: requested
      ? {
          asset: label(requested.asset),
          clip: label(requested.clip),
          playbackRevision: requested.revision,
          playing: requested.playing,
          speed: requested.speed,
          loop: requested.loop,
        }
      : null,
    adopted:
      slot?.ready && slot.lease
        ? {
            asset: label(slot.lease.id),
            path: label(slot.lease.variant.path),
            format: label(slot.lease.variant.format),
            sha256: slot.lease.variant.sha256 ? label(slot.lease.variant.sha256) : null,
            visible: slot.root?.visible ?? false,
          }
        : null,
    replacementPending: !!requested && !!slot && requested.asset !== slot.asset,
    playback: {
      appliedRestartRevision: action && previous >= 0 ? Number(key!.slice(previous + 1, last)) : null,
      clip: action ? label(action.getClip().name) : null,
      time: action?.time ?? null,
      paused: action?.paused ?? null,
      running: action?.isRunning() ?? false,
      speed: action?.timeScale ?? null,
    },
    clips: {total, nextOffset: clipOffset + clips.length < total ? clipOffset + clips.length : null, items: clips},
    pose: {
      requested: requestedPoses.length,
      applied: slot?.overrides?.size ?? 0,
      complete:
        !!slot?.ready && sameAppliedPose(requestedPoses, slot.poseKey) && poseNames.every(p => p.status === 'applied'),
      items: poseNames,
    },
    sockets: names.map(name => {
      const node = slot?.nodes?.get(name);
      return {
        name: label(name),
        status: !slot?.ready ? 'not-ready' : node === null ? 'ambiguous' : node === undefined ? 'absent' : 'ready',
        matrix: slot?.ready && node ? [...node.matrixWorld.elements] : null,
      };
    }),
    skinVertices: vertices.map(({mesh, vertex}) => {
      const result = (
        status: 'ready' | 'not-ready' | 'missing' | 'ambiguous' | 'unsupported' | 'out-of-range' | 'nonfinite',
        position: number[] | null = null,
      ) => ({mesh: label(mesh), vertex, status, position});
      if (!slot?.ready) return result('not-ready');
      const node = slot.nodes?.get(mesh);
      if (node === null) return result('ambiguous');
      if (!node) return result('missing');
      const skin = node as T.SkinnedMesh;
      if (
        !skin.isSkinnedMesh ||
        !skin.skeleton ||
        skin.geometry.morphAttributes.position?.length ||
        skin.geometry.morphAttributes.normal?.length ||
        skin.geometry.morphAttributes.color?.length
      )
        return result('unsupported');
      const position = skin.geometry.getAttribute('position'),
        indices = skin.geometry.getAttribute('skinIndex'),
        weights = skin.geometry.getAttribute('skinWeight');
      if (
        !position ||
        position.itemSize !== 3 ||
        typeof position.getX !== 'function' ||
        typeof position.getY !== 'function' ||
        typeof position.getZ !== 'function' ||
        !indices ||
        indices.itemSize !== 4 ||
        typeof indices.getComponent !== 'function' ||
        !weights ||
        weights.itemSize !== 4 ||
        typeof weights.getComponent !== 'function'
      )
        return result('unsupported');
      if (vertex >= position.count || vertex >= indices.count || vertex >= weights.count) return result('out-of-range');
      for (let j = 0; j < 4; j++) {
        const joint = indices.getComponent(vertex, j),
          weight = weights.getComponent(vertex, j);
        if (
          !Number.isSafeInteger(joint) ||
          joint < 0 ||
          joint >= skin.skeleton.bones.length ||
          !skin.skeleton.bones[joint] ||
          !skin.skeleton.boneInverses[joint] ||
          !Number.isFinite(weight)
        )
          return result('unsupported');
      }
      const point = skin
        .applyBoneTransform(vertex, new Vector3().fromBufferAttribute(position, vertex))
        .applyMatrix4(skin.matrixWorld);
      const xyz = point.toArray();
      return xyz.every(Number.isFinite) ? result('ready', xyz) : result('nonfinite');
    }),
    bounds: slot?.ready && slot.root ? cachedBounds(slot.root, maxNodes) : null,
  };
}
export type ModelInspection = ReturnType<typeof inspectModel>;
export interface SceneModelRequest extends ModelInspectionRequest {
  expectedEpoch: number;
}
export type SceneModelResult =
  {status: 'unavailable'} | {status: 'stale'; epoch: number} | {status: 'ready'; epoch: number; model: ModelInspection};
export function createSceneModelInspector(
  inspect: (request: ModelInspectionRequest) => ModelInspection,
  visit: SceneVisit,
  signal: AbortSignal,
) {
  const live = () => !signal.aborted && !visit.signal.aborted && visit.current();
  return (request: SceneModelRequest): SceneModelResult => {
    if (!live()) return {status: 'unavailable'};
    const expectedEpoch = request.expectedEpoch;
    if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch < 0)
      throw RangeError('model inspection: invalid scene epoch');
    if (!live()) return {status: 'unavailable'};
    if (expectedEpoch !== visit.epoch) return {status: 'stale', epoch: visit.epoch};
    const model = inspect(request);
    return live() ? {status: 'ready', epoch: visit.epoch, model} : {status: 'unavailable'};
  };
}
