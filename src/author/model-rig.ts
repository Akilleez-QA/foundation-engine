import * as T from 'three';
import type {ModelPoseLinkData, ModelPoseLinkLimits} from './model-pose-link';

export interface ModelRigNode {
  readonly node: T.Object3D;
  readonly name: string;
  readonly parent: number | null;
  readonly position: readonly number[];
  readonly quaternion: readonly number[];
  readonly scale: readonly number[];
  readonly matrix: readonly number[];
}
export interface ModelRigSkin {
  readonly node: number;
  readonly joints: readonly number[];
  readonly inverses: readonly (readonly number[])[];
  readonly bind: readonly number[];
}
export interface ModelRig {
  readonly root: T.Object3D;
  readonly nodes: readonly ModelRigNode[];
  readonly skins: readonly ModelRigSkin[];
}
export type ModelRigFailure = 'capacity' | 'skin' | 'rest' | 'bind' | 'hierarchy' | 'mapping';
export type ModelRigCapture =
  {readonly ok: true; readonly rig: ModelRig} | {readonly ok: false; readonly reason: ModelRigFailure};
export interface ModelRigPair {
  readonly source: T.Object3D;
  readonly target: T.Object3D;
}
export type ModelRigResolution =
  {readonly ok: true; readonly pairs: readonly ModelRigPair[]} | {readonly ok: false; readonly reason: ModelRigFailure};
const fail = (reason: ModelRigFailure) => Object.freeze({ok: false as const, reason});
const array = (values: number[]) => Object.freeze(values);
const equal = (a: readonly number[], b: readonly number[], tolerance: number) =>
  a.length === b.length && a.every((n, i) => Math.abs(n - b[i]!) <= tolerance); // i < a.length = b.length
function validMatrix(matrix: T.Matrix4): boolean {
  const e = matrix.elements;
  return (
    e.every(Number.isFinite) &&
    e[3] === 0 &&
    e[7] === 0 &&
    e[11] === 0 &&
    e[15] === 1 &&
    Number.isFinite(matrix.determinant()) &&
    matrix.determinant() !== 0
  );
}
/** Capture only before playback, under the existing instance owner. Never mutate asset data. */
export function captureModelRig(root: T.Object3D, limits: ModelPoseLinkLimits): ModelRigCapture {
  try {
    const nodes: ModelRigNode[] = [],
      indices = new Map<T.Object3D, number>();
    const pending: {node: T.Object3D; parent: number | null}[] = [{node: root, parent: null}];
    while (pending.length) {
      if (nodes.length + pending.length > limits.maxRigNodesPerModel) return fail('capacity');
      const {node, parent} = pending.pop()!;
      // A pending parent is the index of a node already pushed.
      if (indices.has(node) || (parent !== null && node.parent !== nodes[parent]!.node)) return fail('hierarchy');
      const position = array(node.position.toArray()),
        quaternion = array(node.quaternion.toArray()),
        scale = array(node.scale.toArray());
      if (
        ![...position, ...quaternion, ...scale].every(Number.isFinite) ||
        Math.abs(Math.hypot(...quaternion) - 1) > 1e-6
      )
        return fail('rest');
      const matrix = new T.Matrix4().compose(node.position, node.quaternion, node.scale);
      if (!node.matrixAutoUpdate || !node.matrixWorldAutoUpdate || !validMatrix(matrix)) return fail('rest');
      const index = nodes.length;
      indices.set(node, index);
      nodes.push(
        Object.freeze({
          node,
          name: node.name,
          parent,
          position,
          quaternion,
          scale,
          matrix: array([...matrix.elements]),
        }),
      );
      const children = node.children,
        childCount = children.length;
      if (!Number.isSafeInteger(childCount) || childCount < 0) return fail('hierarchy');
      if (childCount > limits.maxRigNodesPerModel - nodes.length - pending.length) return fail('capacity');
      for (let i = childCount - 1; i >= 0; i--) pending.push({node: children[i]!, parent: index}); // i < childCount = children.length
      if (node.children !== children || children.length !== childCount) return fail('hierarchy');
    }
    const skins: ModelRigSkin[] = [];
    let jointCount = 0,
      vertexCount = 0;
    // Admit every skin's scan first, so a rejected aggregate never starts scanning vertices.
    type Attribute = T.BufferAttribute | T.InterleavedBufferAttribute;
    const meshes: {
      mesh: T.SkinnedMesh;
      index: number;
      geometry: T.BufferGeometry;
      skeleton: T.Skeleton;
      bones: T.Bone[];
      inverseMatrices: T.Matrix4[];
      count: number;
      vertices: number;
      positions: Attribute;
      indicesAttribute: Attribute;
      weights: Attribute;
    }[] = [];
    for (const [index, {node}] of nodes.entries()) {
      const mesh = node as T.SkinnedMesh;
      if (!mesh.isSkinnedMesh) continue;
      if (
        mesh.bindMode !== T.AttachedBindMode ||
        mesh.geometry.morphAttributes.position?.length ||
        mesh.geometry.morphAttributes.normal?.length ||
        mesh.geometry.morphAttributes.color?.length
      )
        return fail('skin');
      const geometry = mesh.geometry,
        skeleton = mesh.skeleton,
        bones = skeleton.bones,
        inverseMatrices = skeleton.boneInverses;
      const positions = geometry.getAttribute('position'),
        indicesAttribute = geometry.getAttribute('skinIndex'),
        weights = geometry.getAttribute('skinWeight');
      const count = bones.length,
        vertices = positions?.count;
      if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(vertices) || vertices < 1)
        return fail('skin');
      if (count > limits.maxSkinJointsPerModel - jointCount || vertices > limits.maxSkinVerticesPerModel - vertexCount)
        return fail('capacity');
      jointCount += count;
      vertexCount += vertices;
      meshes.push({
        mesh,
        index,
        geometry,
        skeleton,
        bones,
        inverseMatrices,
        count,
        vertices,
        positions,
        indicesAttribute,
        weights,
      });
    }
    for (const {
      mesh,
      index,
      geometry,
      skeleton,
      bones,
      inverseMatrices,
      count,
      vertices,
      positions,
      indicesAttribute,
      weights,
    } of meshes) {
      const joints: number[] = [],
        inverses: (readonly number[])[] = [];
      if (!validMatrix(mesh.bindMatrix) || inverseMatrices.length !== count) return fail('bind');
      if (skeleton.bones !== bones || bones.length !== count || skeleton.boneInverses !== inverseMatrices)
        return fail('hierarchy');
      const seen = new Set<number>();
      for (let j = 0; j < count; j++) {
        // j < count = bones.length = inverseMatrices.length (checked above).
        const id = indices.get(bones[j]!),
          inverse = inverseMatrices[j]!;
        if (id === undefined || seen.has(id)) return fail('hierarchy');
        if (!validMatrix(inverse)) return fail('bind');
        seen.add(id);
        joints.push(id);
        inverses.push(array([...inverse.elements]));
      }
      let attributeCount = 0;
      for (const name in geometry.attributes) {
        if (++attributeCount > 32 || /^(?:joints|weights)_?[1-9]|^skin(?:Index|Weight)[1-9]/i.test(name))
          return fail('skin');
      }
      if (
        !indicesAttribute ||
        !weights ||
        typeof indicesAttribute.getComponent !== 'function' ||
        typeof weights.getComponent !== 'function' ||
        typeof positions.getX !== 'function' ||
        indicesAttribute.itemSize !== 4 ||
        weights.itemSize !== 4 ||
        indicesAttribute.normalized ||
        positions.itemSize !== 3 ||
        indicesAttribute.count !== vertices ||
        weights.count !== vertices ||
        positions.count !== vertices
      )
        return fail('skin');
      for (let v = 0; v < vertices; v++) {
        if (![positions.getX(v), positions.getY(v), positions.getZ(v)].every(Number.isFinite)) return fail('skin');
        let sum = 0;
        const influenced = new Set<number>();
        for (let c = 0; c < 4; c++) {
          const id = indicesAttribute.getComponent(v, c),
            weight = weights.getComponent(v, c);
          if (
            !Number.isSafeInteger(id) ||
            id < 0 ||
            id >= joints.length ||
            !Number.isFinite(weight) ||
            weight < 0 ||
            weight > 1 ||
            (weight > 0 && influenced.has(id))
          )
            return fail('skin');
          if (weight > 0) influenced.add(id);
          sum += weight;
        }
        if (Math.abs(sum - 1) > 1e-6) return fail('skin');
      }
      if (
        mesh.geometry !== geometry ||
        mesh.skeleton !== skeleton ||
        skeleton.bones !== bones ||
        bones.length !== count ||
        skeleton.boneInverses !== inverseMatrices ||
        inverseMatrices.length !== count ||
        geometry.getAttribute('position') !== positions ||
        geometry.getAttribute('skinIndex') !== indicesAttribute ||
        geometry.getAttribute('skinWeight') !== weights ||
        positions.count !== vertices ||
        weights.count !== vertices ||
        indicesAttribute.count !== vertices
      )
        return fail('skin');
      skins.push(
        Object.freeze({
          node: index,
          joints: Object.freeze(joints),
          inverses: Object.freeze(inverses),
          bind: array([...mesh.bindMatrix.elements]),
        }),
      );
    }
    return Object.freeze({
      ok: true,
      rig: Object.freeze({root, nodes: Object.freeze(nodes), skins: Object.freeze(skins)}),
    });
  } catch {
    return fail('skin');
  }
}
/** Resolve immutable loaded facts. Returned live pairs borrow their existing slot lifetimes. */
export function resolveModelRig(
  source: ModelRig,
  target: ModelRig,
  relation: ModelPoseLinkData,
  limits: ModelPoseLinkLimits,
): ModelRigResolution {
  if (!source.skins.length || !target.skins.length) return fail('skin');
  if (relation.nodes.length > limits.maxMappedNodesPerLink) return fail('capacity');
  const lookup = (rig: ModelRig) => {
    const map = new Map<string, number | null>();
    for (let i = 1; i < rig.nodes.length; i++) {
      const name = rig.nodes[i]!.name;
      if (name) map.set(name, map.has(name) ? null : i);
    } // i < rig.nodes.length
    return map;
  };
  const fromNames = lookup(source),
    toNames = lookup(target),
    mapping = new Map<number, number>([[0, 0]]),
    used = new Set<number>([0]);
  for (const pair of relation.nodes) {
    const from = fromNames.get(pair.source),
      to = toNames.get(pair.target);
    if (from == null || to == null || mapping.has(to) || used.has(from)) return fail('mapping');
    mapping.set(to, from);
    used.add(from);
  }
  // Mapped, joint and parent indices all come from the rigs' own node lists (0 is the root), so they are in range.
  for (const [to, from] of mapping) {
    const a = source.nodes[from]!,
      b = target.nodes[to]!;
    if ((b.parent === null ? null : mapping.get(b.parent)) !== a.parent) return fail('hierarchy');
    if (!equal(a.matrix, b.matrix, limits.restTolerance)) return fail('rest');
  }
  const required = new Set<number>();
  for (const skin of target.skins)
    for (const joint of skin.joints) {
      let cursor: number | null = joint;
      while (cursor !== null && !required.has(cursor)) {
        required.add(cursor);
        cursor = target.nodes[cursor]!.parent;
      }
    }
  for (const node of required) if (!mapping.has(node)) return fail('mapping');
  // Fold all source occurrences once. Repeated skins must agree without quadratic searches.
  const sourceBinds = new Map<number, {inverse: readonly number[]; bind: readonly number[]; conflict: boolean}>();
  // A skin's inverses are captured one per joint, so inverses[j] exists for each joint j.
  for (const skin of source.skins)
    for (const [j, joint] of skin.joints.entries()) {
      const previous = sourceBinds.get(joint),
        inverse = skin.inverses[j]!;
      if (previous)
        previous.conflict ||=
          !equal(previous.inverse, inverse, limits.restTolerance) ||
          !equal(previous.bind, skin.bind, limits.restTolerance);
      else sourceBinds.set(joint, {inverse, bind: skin.bind, conflict: false});
    }
  for (const skin of target.skins)
    for (const [j, joint] of skin.joints.entries()) {
      const occurrence = sourceBinds.get(mapping.get(joint)!);
      if (!occurrence) return fail('mapping');
      if (
        occurrence.conflict ||
        !equal(skin.bind, occurrence.bind, limits.restTolerance) ||
        !equal(skin.inverses[j]!, occurrence.inverse, limits.restTolerance)
      )
        return fail('bind');
    }
  const pairs = [...mapping].map(([to, from]) =>
    Object.freeze({source: source.nodes[from]!.node, target: target.nodes[to]!.node}),
  );
  return Object.freeze({ok: true, pairs: Object.freeze(pairs)});
}
/** Restore only a projection's touched nodes. Never update a retired source or shared bind arrays. */
export function restoreModelRigNodes(rig: ModelRig, touched: readonly T.Object3D[]): boolean {
  const selected = new Set(touched);
  let changed = false;
  for (const rest of rig.nodes) {
    if (!selected.has(rest.node)) continue;
    const node = rest.node;
    if (
      !equal(node.position.toArray(), rest.position, 0) ||
      !equal(node.quaternion.toArray(), rest.quaternion, 0) ||
      !equal(node.scale.toArray(), rest.scale, 0)
    ) {
      node.position.fromArray(rest.position);
      node.quaternion.fromArray(rest.quaternion);
      node.scale.fromArray(rest.scale);
      node.updateMatrix();
      changed = true;
    }
  }
  return changed;
}
