import * as T from 'three';
import { updateWorldMatrixFromRoot } from '../platform/render/world-matrix';
import type { Entity, World } from '../core/ecs/world';
import { Transform } from './defs';
import { Model, type ModelData } from './model';
import { ModelPoseLink } from './model-pose-link';
import { ModelAttachment, captureModelAttachment, type ModelAttachmentData, type ModelAttachmentState } from './model-attachment';

export interface AttachmentPresentation {
  input?: ModelAttachmentData;
  relation?: ModelAttachmentData;
  state?: ModelAttachmentState;
  /** Held only for this slot and this relation's transform identity. */
  last?: T.Matrix4;
  heldVisible?: boolean;
  parentSlot?: AttachmentSlot; parentModel?: ModelData; targetModel?: ModelData;
  parentAttachment?: ModelAttachmentData; parentPose?: unknown;
}
export interface AttachmentSlot {
  asset: string; ready?: boolean; root?: T.Object3D; nodes?: Map<string, T.Object3D | null>;
  attachment?: AttachmentPresentation;
}
/** Optional second relation kind, reconciled in this same parent-first traversal. */
export interface PoseRelationHooks {
  has(entity: Entity): boolean;
  capture(): readonly Entity[];
  parent(entity: Entity): Entity | undefined;
  current(entity: Entity): boolean;
  ready(entity: Entity): boolean;
  publish(entity: Entity, parent: Entity): boolean;
  unavailable(entity: Entity, status: ModelAttachmentState['status']): boolean;
  finish(): boolean;
}
const equalRelation = (a: ModelAttachmentData | undefined, b: ModelAttachmentData) => !!a && a.parent === b.parent
  && a.socket === b.socket && a.unavailable === b.unavailable && a.inheritVisibility === b.inheritVisibility
  && a.offset.every((value, index) => value === b.offset[index]);
const state = (status: ModelAttachmentState['status'], held = false): ModelAttachmentState => Object.freeze({ status, held });

/** One bounded reconciliation of the scene owner's admitted slots. No retained independent owner or scheduled work. */
export function reconcileModelAttachments(world: World, slots: ReadonlyMap<Entity, AttachmentSlot>, pose?: PoseRelationHooks): boolean {
  let changed = false;
  const restore = (entity: Entity, slot: AttachmentSlot) => {
    if (slots.get(entity) !== slot) return;
    slot.attachment = undefined;
    if (pose?.has(entity)) return;
    const root = slot.root;
    if (!root || root.matrixAutoUpdate) return;
    const data = world.get(entity, Model), tr = world.get(entity, Transform);
    if (!data || data.asset !== slot.asset || !tr) return;
    // A native callback may remove this relation after ordinary pose() skipped it.
    // Automatic roots need neither repeated publication nor scratch matrices.
    root.matrixAutoUpdate = true;
    root.position.set(tr.x, tr.y, tr.z); root.rotation.set(tr.rx, tr.ry, tr.rz); root.scale.setScalar(tr.scale);
    root.visible = data.visible; updateWorldMatrixFromRoot(root, true); if (pose) root.updateMatrixWorld(true); changed = true;
  };
  // Ordinary scenes allocate no graph scratch storage. Retired relation roots are
  // restored even when a native callback removed the last relation during this pass.
  let hasRelations = false;
  for (const [entity, slot] of slots) {
    if (world.has(entity, ModelAttachment) || pose?.has(entity)) hasRelations = true;
    else restore(entity, slot);
  }
  if (!hasRelations) return (pose?.finish() ?? false) || changed;
  const poseEntities = new Set(pose?.capture() ?? []);
  const relations = new Map<Entity, ModelAttachmentData>(), invalid = new Set<Entity>();
  const inputs = new Map<Entity, ModelAttachmentData>(), capturedSlots = new Map<Entity, AttachmentSlot>();
  // Capture before publication. Accessors can run creator code: recheck slot/component identities afterward.
  for (const [entity, slot] of slots) {
    const input = world.get(entity, ModelAttachment);
    if (poseEntities.has(entity)) { slot.attachment = undefined; continue; }
    if (!input) { restore(entity, slot); continue; }
    // Track the attempt before user accessors can supersede this very input.
    // Final cleanup must restore/hide it even when no capture was accepted.
    inputs.set(entity, input); capturedSlots.set(entity, slot);
    let relation: ModelAttachmentData;
    try { relation = captureModelAttachment(input); }
    catch {
      if (slots.get(entity) === slot && world.get(entity, ModelAttachment) === input) {
        invalid.add(entity); inputs.set(entity, input); capturedSlots.set(entity, slot);
        slot.attachment = { input, state: state('invalid') };
      }
      continue;
    }
    if (slots.get(entity) !== slot || world.get(entity, ModelAttachment) !== input || !world.has(entity, Transform)) continue;
    if (!equalRelation(slot.attachment?.relation, relation)) slot.attachment = { relation };
    slot.attachment!.input = input;
    relations.set(entity, relation); inputs.set(entity, input); capturedSlots.set(entity, slot);
  }
  const parents = new Map<Entity, Entity | undefined>();
  for (const [entity, relation] of relations) parents.set(entity, relation.parent);
  for (const entity of poseEntities) parents.set(entity, pose!.parent(entity));
  const relationReady = (entity: Entity, slot: AttachmentSlot) => poseEntities.has(entity)
    ? pose!.current(entity) && pose!.ready(entity)
    : current(entity, slot) && slot.attachment?.state?.status === 'ready'
      && slot.attachment.parentSlot === slots.get(slot.attachment.relation!.parent)
      && slot.attachment.parentModel === world.get(slot.attachment.relation!.parent, Model)
      && slot.attachment.targetModel === world.get(entity, Model)
      && slot.attachment.parentAttachment === world.get(slot.attachment.relation!.parent, ModelAttachment)
      && slot.attachment.parentPose === world.get(slot.attachment.relation!.parent, ModelPoseLink);
  const related = (entity: Entity) => inputs.has(entity) || poseEntities.has(entity) || world.has(entity, ModelAttachment) || !!pose?.has(entity);
  const done = new Set<Entity>(), active = new Set<Entity>();
  const usable = (entity: Entity, slot: AttachmentSlot | undefined) => !!slot?.ready && world.has(entity, Transform)
    && world.get(entity, Model)?.asset === slot.asset;
  const current = (entity: Entity, slot: AttachmentSlot) => slots.get(entity) === slot && capturedSlots.get(entity) === slot
    && world.get(entity, ModelAttachment) === inputs.get(entity) && world.has(entity, Transform) && world.get(entity, Model)?.asset === slot.asset;
  const publish = (slot: AttachmentSlot, matrix: T.Matrix4 | undefined, visible: boolean) => {
    const root = slot.root; if (!root) return;
    root.matrixAutoUpdate = false;
    if (matrix && !root.matrix.equals(matrix)) { root.matrix.copy(matrix); root.matrixWorldNeedsUpdate = true; changed = true; }
    if (root.visible !== visible) { root.visible = visible; changed = true; }
    updateWorldMatrixFromRoot(root, true); if (pose) root.updateMatrixWorld(true);
  };
  const unavailable = (entity: Entity, status: ModelAttachmentState['status']) => {
    if (poseEntities.has(entity)) { changed = pose!.unavailable(entity, status) || changed; return; }
    const slot = slots.get(entity); if (!slot || !current(entity, slot)) return;
    const meta = slot.attachment ??= {};
    const held = usable(entity, slot) && meta.relation?.unavailable === 'hold' && !!meta.last;
    meta.parentSlot = undefined; meta.parentModel = undefined; meta.targetModel = undefined;
    meta.parentAttachment = undefined; meta.parentPose = undefined;
    meta.state = state(status, held);
    publish(slot, held ? meta.last : undefined, !!held && !!world.get(entity, Model)?.visible && !!meta.heldVisible);
  };
  for (const entity of invalid) { unavailable(entity, 'invalid'); done.add(entity); }
  // Each child has at most one parent. Iterative path traversal visits each relation once.
  for (const start of parents.keys()) {
    if (done.has(start)) continue;
    const path: Entity[] = []; let cursor: Entity | undefined = start;
    while (cursor !== undefined && parents.has(cursor) && !done.has(cursor) && !active.has(cursor)) {
      active.add(cursor); path.push(cursor); cursor = parents.get(cursor);
    }
    if (cursor !== undefined && active.has(cursor)) {
      const cycleStart = path.indexOf(cursor);
      for (let i = cycleStart; i < path.length; i++) { unavailable(path[i], 'cycle'); done.add(path[i]); }
    }
    while (path.length) {
      const entity = path.pop()!; active.delete(entity);
      if (done.has(entity)) continue;
      const parentEntity = parents.get(entity), slot = slots.get(entity), parent = parentEntity === undefined ? undefined : slots.get(parentEntity);
      if (poseEntities.has(entity)) {
        if (!pose!.current(entity)) { done.add(entity); continue; }
        if (!slot || !usable(entity, slot) || parentEntity === undefined || !usable(parentEntity, parent)) unavailable(entity, 'waiting');
        else if (related(parentEntity) && !relationReady(parentEntity, parent!)) unavailable(entity, 'blocked');
        else changed = pose!.publish(entity, parentEntity) || changed;
        done.add(entity); continue;
      }
      const relation = relations.get(entity)!;
      if (!slot || !current(entity, slot)) { done.add(entity); continue; }
      if (!usable(entity, slot) || !usable(relation.parent, parent)) unavailable(entity, 'waiting');
      else if (related(relation.parent) && !relationReady(relation.parent, parent!)) unavailable(entity, 'blocked');
      else {
        const node = parent!.nodes?.get(relation.socket);
        if (!node) unavailable(entity, node === null ? 'ambiguous-socket' : 'missing-socket');
        else {
          const parentModel = world.get(relation.parent, Model), targetModel = world.get(entity, Model);
          const parentAttachment = world.get(relation.parent, ModelAttachment), parentPose = world.get(relation.parent, ModelPoseLink);
          updateWorldMatrixFromRoot(node);
          // Object3D overrides may synchronously end the owner or replace requests.
          if (!current(entity, slot) || slots.get(relation.parent) !== parent || !usable(relation.parent, parent)
            || world.get(relation.parent, Model) !== parentModel || world.get(entity, Model) !== targetModel
            || world.get(relation.parent, ModelAttachment) !== parentAttachment || world.get(relation.parent, ModelPoseLink) !== parentPose
            || (related(relation.parent) && !relationReady(relation.parent, parent!))) {
            unavailable(entity, 'unresolved'); done.add(entity); continue;
          }
          const matrix = new T.Matrix4().multiplyMatrices(node.matrixWorld, new T.Matrix4().fromArray(relation.offset));
          // Roots stay scene children; convert world presentation to that root's local frame.
          const container = slot.root!.parent;
          const singular = !!container && container.matrixWorld.determinant() === 0;
          if (container && !singular) matrix.premultiply(new T.Matrix4().copy(container.matrixWorld).invert());
          if (singular || !matrix.elements.every(Number.isFinite)) unavailable(entity, 'invalid');
          else {
            const meta = slot.attachment!;
            meta.last = matrix; meta.heldVisible = !relation.inheritVisibility || !!parent!.root?.visible;
            meta.parentSlot = parent; meta.parentModel = parentModel; meta.targetModel = targetModel;
            meta.parentAttachment = parentAttachment; meta.parentPose = parentPose;
            meta.state = state('ready');
            publish(slot, matrix, !!world.get(entity, Model)?.visible && meta.heldVisible);
          }
        }
      }
      done.add(entity);
    }
  }
  // A later capture can replace/remove an earlier relation. Never leave old observed
  // readiness attached to that replacement; a fresh reconciliation captures it.
  for (const [entity, input] of inputs) {
    const slot = slots.get(entity);
    if (!slot || slot !== capturedSlots.get(entity) || world.get(entity, ModelAttachment) === input) continue;
    slot.attachment = undefined;
    const data = world.get(entity, Model), tr = world.get(entity, Transform), root = slot.root;
    if (!root || !data || !tr) continue;
    if (world.has(entity, ModelAttachment)) {
      if (root.visible) { root.visible = false; changed = true; }
    } else {
      restore(entity, slot);
    }
  }
  changed = (pose?.finish() ?? false) || changed;
  if (pose) {
    // A later callback may invalidate an already-published source. Revoke the whole
    // mixed dependency suffix, including rigid followers of mapped parts.
    const children = new Map<Entity, Entity[]>(), queue: Entity[] = [], queued = new Set<Entity>();
    const enqueue = (entity: Entity) => { if (!queued.has(entity)) { queued.add(entity); queue.push(entity); } };
    for (const [entity, parent] of parents) {
      if (parent !== undefined) { const list = children.get(parent) ?? []; list.push(entity); children.set(parent, list); }
      const slot = slots.get(entity), source = parent === undefined ? undefined : slots.get(parent);
      if (!slot || !relationReady(entity, slot) || parent === undefined || !usable(parent, source)
        || (related(parent) && !relationReady(parent, source!))) enqueue(entity);
    }
    for (let i = 0; i < queue.length; i++) {
      const entity = queue[i], slot = slots.get(entity);
      if (slot && (poseEntities.has(entity) ? pose.ready(entity) : slot.attachment?.state?.status === 'ready')) unavailable(entity, 'blocked');
      for (const child of children.get(entity) ?? []) enqueue(child);
    }
  }
  return changed;
}

