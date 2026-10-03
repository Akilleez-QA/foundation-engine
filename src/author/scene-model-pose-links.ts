import * as T from 'three';
import type {World, Entity} from '../core/ecs/world';
import {Transform} from './defs';
import {Model, type ModelData} from './model';
import {ModelAttachment, type ModelAttachmentState} from './model-attachment';
import {
  ModelPoseLink,
  captureModelPoseLink,
  type ModelPoseLinkData,
  type ModelPoseLinkState,
  type ModelPoseLinkLimits,
} from './model-pose-link';
import {resolveModelRig, restoreModelRigNodes, type ModelRigCapture, type ModelRigResolution} from './model-rig';
import type {AttachmentSlot, PoseRelationHooks} from './scene-model-attachments';
export interface PoseLinkPresentation {
  input: ModelPoseLinkData;
  relation?: ModelPoseLinkData | undefined;
  state: ModelPoseLinkState;
  sourcePoseInput?: ModelPoseLinkData | undefined;
  sourceAttachmentInput?: unknown;
  sourceModel?: ModelData | undefined;
  targetModel?: ModelData | undefined;
  resolution?: {source: PoseLinkSlot; result: ModelRigResolution} | undefined;
  sourceSlot?: PoseLinkSlot | undefined;
  pairs?: readonly {source: T.Object3D; target: T.Object3D}[] | undefined;
  touched?: readonly T.Object3D[] | undefined;
}
export interface PoseLinkSlot extends AttachmentSlot {
  instance?: T.Object3D;
  rig?: ModelRigCapture;
  poseLink?: PoseLinkPresentation | undefined;
}
/** A node's local position (3), quaternion (4) and scale (3). */
type Pose = [number, number, number, number, number, number, number, number, number, number];
const state = (status: ModelPoseLinkState['status'], reason: ModelPoseLinkState['reason'] = null): ModelPoseLinkState =>
  Object.freeze({status, reason});
const same = (a: ModelPoseLinkData | undefined, b: ModelPoseLinkData) =>
  !!a &&
  a.source === b.source &&
  a.inheritVisibility === b.inheritVisibility &&
  a.nodes.length === b.nodes.length &&
  a.nodes.every((v, i) => {
    const w = b.nodes[i]!;
    return v.source === w.source && v.target === w.target;
  }); // i < a.nodes.length = b.nodes.length
const usable = (world: World, entity: Entity, slot: PoseLinkSlot | undefined) =>
  !!slot?.ready && world.has(entity, Transform) && world.get(entity, Model)?.asset === slot.asset;
function restore(slot: PoseLinkSlot): boolean {
  const meta = slot.poseLink;
  let changed = false;
  if (meta?.touched && slot.rig?.ok) changed = restoreModelRigNodes(slot.rig.rig, meta.touched);
  if (meta) {
    meta.touched = undefined;
    meta.pairs = undefined;
    meta.sourceSlot = undefined;
    meta.sourceModel = undefined;
    meta.sourcePoseInput = undefined;
    meta.sourceAttachmentInput = undefined;
    meta.targetModel = undefined;
    meta.resolution = undefined;
  }
  return changed;
}
/** Restore obsolete mapped locals before native playback. No graph scratch for ordinary slots. */
export function restoreObsoletePoseLinks(world: World, slots: ReadonlyMap<Entity, PoseLinkSlot>): boolean {
  let changed = false;
  for (const [entity, slot] of slots) {
    const meta = slot.poseLink;
    if (!meta) continue;
    const input = world.get(entity, ModelPoseLink),
      model = world.get(entity, Model);
    if (
      input !== meta.input ||
      !input ||
      !model ||
      model.clip ||
      model.pose.length ||
      world.has(entity, ModelAttachment)
    ) {
      changed = restore(slot) || changed;
      slot.poseLink = undefined;
    }
  }
  return changed;
}
/** Borrowed reconciliation hooks; all retained metadata remains on the scene owner's existing slots. */
export function poseLinkHooks(
  world: World,
  slots: ReadonlyMap<Entity, PoseLinkSlot>,
  limits: ModelPoseLinkLimits | undefined,
): PoseRelationHooks {
  const observed = new Map<Entity, {slot: PoseLinkSlot; input: ModelPoseLinkData}>();
  let changed = false;
  const has = (entity: Entity) => world.has(entity, ModelPoseLink);
  const current = (entity: Entity) => {
    const seen = observed.get(entity);
    return (
      !!seen &&
      slots.get(entity) === seen.slot &&
      world.get(entity, ModelPoseLink) === seen.input &&
      world.has(entity, Transform) &&
      world.get(entity, Model)?.asset === seen.slot.asset
    );
  };
  const hide = (slot: PoseLinkSlot) => {
    if (slot.root?.visible) {
      slot.root.visible = false;
      changed = true;
    }
  };
  const refuse = (
    entity: Entity,
    status: ModelPoseLinkState['status'],
    reason: ModelPoseLinkState['reason'] = null,
  ) => {
    if (!current(entity)) return;
    const slot = slots.get(entity)!;
    changed = restore(slot) || changed;
    slot.poseLink!.state = state(status, reason);
    hide(slot);
  };
  const restoreRoot = (entity: Entity, slot: PoseLinkSlot) => {
    const root = slot.root,
      model = world.get(entity, Model),
      tr = world.get(entity, Transform);
    if (!root || !model || !tr || has(entity) || world.has(entity, ModelAttachment)) return;
    if (!root.matrixAutoUpdate) {
      root.matrixAutoUpdate = true;
      root.position.set(tr.x, tr.y, tr.z);
      root.rotation.set(tr.rx, tr.ry, tr.rz);
      root.scale.setScalar(tr.scale);
      root.visible = model.visible;
      root.updateMatrixWorld(true);
      changed = true;
    }
  };
  return {
    has,
    capture() {
      let links = 0,
        total = 0;
      for (const [entity, slot] of slots) {
        const input = world.get(entity, ModelPoseLink);
        if (!input) continue;
        observed.set(entity, {slot, input});
        let relation: ModelPoseLinkData;
        try {
          relation = captureModelPoseLink(input, limits?.maxMappedNodesPerLink ?? 0);
        } catch (error) {
          const capacity = !limits || String(error).includes('capacity');
          if (current(entity)) {
            changed = restore(slot) || changed;
            slot.poseLink = {
              input,
              state: state(capacity ? 'over-budget' : 'invalid', capacity ? 'capacity' : 'mapping'),
            };
            hide(slot);
          }
          continue;
        }
        if (!current(entity)) continue;
        if (!same(slot.poseLink?.relation, relation)) {
          changed = restore(slot) || changed;
          slot.poseLink = {input, relation, state: state('unresolved')};
        } else slot.poseLink!.input = input;
        if (!limits || ++links > limits.maxLinks || relation.nodes.length + 1 > limits.maxMappedNodesTotal - total) {
          refuse(entity, 'over-budget', 'capacity');
          continue;
        }
        total += relation.nodes.length + 1;
        if (relation.source === entity) {
          refuse(entity, 'cycle');
          continue;
        }
        if (world.has(entity, ModelAttachment)) {
          refuse(entity, 'conflict', 'root-authority');
          continue;
        }
        const model = world.get(entity, Model)!;
        if (model.clip || model.pose.length) {
          refuse(entity, 'conflict', 'animation-authority');
          continue;
        }
        slot.poseLink!.state = state('unresolved');
      }
      return [...observed.keys()];
    },
    parent: entity => slots.get(entity)?.poseLink?.relation?.source,
    current,
    ready: entity => slots.get(entity)?.poseLink?.state.status === 'ready',
    unavailable(entity, status: ModelAttachmentState['status']) {
      const previous = slots.get(entity)?.poseLink?.state.status;
      if (previous && !['invalid', 'conflict', 'over-budget', 'cycle'].includes(previous))
        refuse(entity, status === 'cycle' ? 'cycle' : status === 'blocked' ? 'blocked' : 'waiting');
      return changed;
    },
    publish(entity, parent) {
      const slot = slots.get(entity)!,
        source = slots.get(parent),
        meta = slot.poseLink;
      if (!meta || ['invalid', 'conflict', 'over-budget', 'cycle'].includes(meta.state.status)) return changed;
      const sourceModel = world.get(parent, Model),
        targetModel = world.get(entity, Model),
        sourcePoseInput = world.get(parent, ModelPoseLink),
        sourceAttachmentInput = world.get(parent, ModelAttachment);
      const sourceReady = () =>
        observed.has(parent) && !current(parent)
          ? false
          : has(parent)
            ? current(parent) && source?.poseLink?.state.status === 'ready'
            : !world.has(parent, ModelAttachment) ||
              (source?.attachment?.input === world.get(parent, ModelAttachment) &&
                source?.attachment?.state?.status === 'ready');
      const valid = () =>
        current(entity) &&
        slots.get(parent) === source &&
        usable(world, parent, source) &&
        sourceReady() &&
        world.get(parent, ModelPoseLink) === sourcePoseInput &&
        world.get(parent, ModelAttachment) === sourceAttachmentInput &&
        world.get(parent, Model) === sourceModel &&
        world.get(entity, Model) === targetModel &&
        !world.has(entity, ModelAttachment) &&
        !world.get(entity, Model)!.clip &&
        !world.get(entity, Model)!.pose.length;
      if (!valid()) {
        refuse(entity, 'unresolved');
        return changed;
      }
      if (!slot.rig?.ok || !source!.rig?.ok) {
        const reason = (!slot.rig?.ok && slot.rig?.reason) || (!source!.rig?.ok && source!.rig?.reason) || 'capacity';
        refuse(entity, reason === 'capacity' ? 'over-budget' : 'incompatible', reason);
        return changed;
      }
      if (meta.sourceSlot !== source || !meta.pairs) {
        const resolved =
          meta.resolution && meta.resolution.source === source
            ? meta.resolution.result
            : resolveModelRig(source!.rig.rig, slot.rig.rig, meta.relation!, limits!);
        if (!valid()) return changed;
        if (!resolved.ok) {
          refuse(entity, 'incompatible', resolved.reason);
          meta.resolution = {source: source!, result: resolved};
          return changed;
        }
        meta.resolution = {source: source!, result: resolved};
        meta.pairs = resolved.pairs;
        meta.sourceSlot = source;
        meta.touched = resolved.pairs.map(pair => pair.target);
      }
      // Stage every scalar before touching a target. Finite local values alone do not imply finite matrices.
      const poses = meta.pairs.map(({source: node}): Pose => [
        node.position.x,
        node.position.y,
        node.position.z,
        node.quaternion.x,
        node.quaternion.y,
        node.quaternion.z,
        node.quaternion.w,
        node.scale.x,
        node.scale.y,
        node.scale.z,
      ]);
      const matrix = source!.root!.matrixWorld.clone(),
        container = slot.root!.parent;
      if (container) {
        const determinant = container.matrixWorld.determinant();
        if (!Number.isFinite(determinant) || determinant === 0) {
          refuse(entity, 'incompatible', 'nonfinite');
          return changed;
        }
        matrix.premultiply(container.matrixWorld.clone().invert());
      }
      if (!matrix.elements.every(Number.isFinite) || poses.some(p => !p.every(Number.isFinite))) {
        refuse(entity, 'incompatible', 'nonfinite');
        return changed;
      }
      if (!valid()) return changed;
      let poseChanged = false;
      for (let i = 0; i < meta.pairs.length; i++) {
        const node = meta.pairs[i]!.target,
          p = poses[i]!; // i < meta.pairs.length = poses.length
        if (
          node.position.x !== p[0] ||
          node.position.y !== p[1] ||
          node.position.z !== p[2] ||
          node.quaternion.x !== p[3] ||
          node.quaternion.y !== p[4] ||
          node.quaternion.z !== p[5] ||
          node.quaternion.w !== p[6] ||
          node.scale.x !== p[7] ||
          node.scale.y !== p[8] ||
          node.scale.z !== p[9]
        ) {
          node.position.set(p[0], p[1], p[2]);
          node.quaternion.set(p[3], p[4], p[5], p[6]);
          node.scale.set(p[7], p[8], p[9]);
          poseChanged = true;
        }
      }
      const root = slot.root!;
      root.matrixAutoUpdate = false;
      if (!root.matrix.equals(matrix)) {
        root.matrix.copy(matrix);
        root.matrixWorldNeedsUpdate = true;
        poseChanged = true;
      }
      root.updateMatrixWorld(true);
      if (!valid()) {
        refuse(entity, 'unresolved');
        return changed;
      }
      if (meta.pairs.some(pair => !pair.target.matrixWorld.elements.every(Number.isFinite))) {
        refuse(entity, 'incompatible', 'nonfinite');
        return changed;
      }
      const visible =
        world.get(entity, Model)!.visible && (!meta.relation!.inheritVisibility || !!source!.root!.visible);
      if (root.visible !== visible) {
        root.visible = visible;
        poseChanged = true;
      }
      meta.sourcePoseInput = sourcePoseInput;
      meta.sourceAttachmentInput = sourceAttachmentInput;
      meta.sourceModel = sourceModel;
      meta.targetModel = targetModel;
      meta.state = state('ready');
      changed = poseChanged || changed;
      return changed;
    },
    finish() {
      for (const [entity, slot] of slots) {
        if (!has(entity)) {
          changed = restore(slot) || changed;
          slot.poseLink = undefined;
          restoreRoot(entity, slot);
          continue;
        }
        if (!current(entity)) {
          changed = restore(slot) || changed;
          slot.poseLink = undefined;
          hide(slot);
        }
      }
      // Revoke descendants in linear dependency order when a later callback superseded
      // an already-finalized ancestor, independent of slot insertion order.
      const dependents = new Map<Entity, Entity[]>(),
        revoked: Entity[] = [],
        queued = new Set<Entity>();
      const enqueue = (entity: Entity) => {
        if (!queued.has(entity)) {
          queued.add(entity);
          revoked.push(entity);
        }
      };
      for (const [entity, slot] of slots) {
        const meta = slot.poseLink;
        if (meta?.state.status !== 'ready' || !current(entity)) continue;
        const parent = meta.relation!.source,
          source = slots.get(parent),
          children = dependents.get(parent) ?? [];
        children.push(entity);
        dependents.set(parent, children);
        if (
          source !== meta.sourceSlot ||
          world.get(parent, ModelPoseLink) !== meta.sourcePoseInput ||
          world.get(parent, ModelAttachment) !== meta.sourceAttachmentInput ||
          world.get(parent, Model) !== meta.sourceModel ||
          world.get(entity, Model) !== meta.targetModel ||
          !usable(world, parent, source) ||
          (observed.has(parent) && !current(parent)) ||
          (has(parent) && source?.poseLink?.state.status !== 'ready') ||
          (world.has(parent, ModelAttachment) &&
            (source?.attachment?.input !== world.get(parent, ModelAttachment) ||
              source?.attachment?.state?.status !== 'ready'))
        )
          enqueue(entity);
      }
      for (const entity of revoked) {
        refuse(entity, 'blocked');
        for (const child of dependents.get(entity) ?? []) enqueue(child);
      } // also visits entities enqueued meanwhile
      return changed;
    },
  };
}
