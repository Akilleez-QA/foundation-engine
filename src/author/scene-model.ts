import {ModelPoseLink, type ModelPoseLinkState, type ModelPoseLinkLimits} from './model-pose-link';
import {captureModelRig, type ModelRigCapture} from './model-rig';
import {poseLinkHooks, restoreObsoletePoseLinks, type PoseLinkPresentation} from './scene-model-pose-links';
import type {ModelState} from './model-state';
import {ModelAttachment, type ModelAttachmentState} from './model-attachment';
import {reconcileModelAttachments, type AttachmentPresentation} from './scene-model-attachments';
import type {inspectModel, ModelInspectionRequest} from './model-inspection';
import * as T from 'three';
import {updateWorldMatrixFromRoot} from '../platform/render/world-matrix';
import type {World, Entity} from '../core/ecs/world';
import type {ModelLibrary, ModelTemplate} from '../platform/assets/models';
import type {AssetLease} from '../platform/assets/lease-cache';
import {isAbortError} from '../platform/assets/lease-cache';
import {Model, validateModel, type ModelData, type ModelSocketPose} from './model';
import {
  animatedNodes,
  createClipTransitions,
  MAX_TRANSITION_NODES,
  type ClipTransition,
  type ClipTransitions,
} from './scene-model-transition';
import {Transform} from './defs';
import type {ModelLooks} from './model-looks';
interface Slot {
  rig?: ModelRigCapture;
  poseLink?: PoseLinkPresentation;
  attachment?: AttachmentPresentation;
  ready?: boolean;
  asset: string;
  life: AbortController;
  root?: T.Object3D;
  instance?: T.Object3D;
  lease?: AssetLease<ModelTemplate> | undefined;
  mixer?: T.AnimationMixer;
  action?: T.AnimationAction | undefined;
  animationKey?: string;
  /** Built on the first requested transition; null when the rig exceeds the node budget (changes then cut). */
  transitions?: ClipTransitions | null;
  fade?: ClipTransition | undefined;
  nodes?: Map<string, T.Object3D | null>;
  failed?: boolean;
  mask?: number;
  poseKey?: string;
  overrides?: Set<T.Object3D>;
  rest?: Map<T.Object3D, {position: T.Vector3; quaternion: T.Quaternion}>;
}
/** One owner for async model instances, skeletal playback and named-node queries in a scene visit. */
export function createSceneModels(o: {
  world: World;
  scene: T.Scene;
  library: ModelLibrary;
  signal: AbortSignal;
  invalidate(): void;
  report(error: unknown): void;
  maxInstances?: number;
  /** Diagnostics builds pass `inspectModel`; production leaves it out so the inspector is not bundled. */ inspection?:
    typeof inspectModel | undefined;
  poseLinks?: ModelPoseLinkLimits | undefined;
  mask?(entity: Entity): number;
  /** Draws an entity's `Material` over its instance's own materials (model-looks.ts); absent, models keep theirs. */
  looks?: Pick<ModelLooks, 'sync' | 'release'> | undefined;
}) {
  const slots = new Map<Entity, Slot>();
  let closed = false,
    syncing = false;
  const limit = o.maxInstances ?? 64,
    inspection = o.inspection;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1024) throw Error('model: invalid scene instance budget');
  function report(error: unknown) {
    try {
      o.report(error);
    } catch {
      /* Reporting cannot strand scene-owned resources. */
    }
  }
  const live = (e: Entity, slot: Slot) => !closed && !slot.life.signal.aborted && slots.get(e) === slot;
  function retire(e: Entity, expected?: Slot) {
    const slot = slots.get(e);
    if (!slot || (expected && slot !== expected)) return;
    slots.delete(e);
    const errors: unknown[] = [],
      attempt = (fn: () => void) => {
        try {
          fn();
        } catch (error) {
          errors.push(error);
        }
      };
    const lease = slot.lease;
    slot.lease = undefined;
    attempt(() => {
      slot.mixer?.stopAllAction();
    });
    if (slot.instance)
      attempt(() => {
        slot.mixer?.uncacheRoot(slot.instance!);
      });
    attempt(() => o.looks?.release(e));
    if (slot.root)
      attempt(() => {
        slot.root!.removeFromParent();
      });
    if (slot.instance)
      attempt(() => {
        lease?.value.releaseInstance(slot.instance!);
      });
    attempt(() => slot.life.abort());
    attempt(() => {
      lease?.release();
    });
    if (errors.length) throw new AggregateError(errors, 'model: scene instance cleanup failed');
  }
  function load(e: Entity, data: ModelData) {
    // Cleanup callbacks may invalidate a slot already visited by sync's first
    // sweep. Recheck observed capacity before rejecting. Retirement only removes
    // slots while sync's reentry guard is held, so each productive pass consumes
    // at least one of this bounded initial set; genuine overload cannot spin.
    const maximumPasses = slots.size;
    for (let pass = 0; slots.size >= limit && pass < maximumPasses; pass++) {
      const before = slots.size;
      for (const [entity, slot] of [...slots]) {
        if (!o.world.has(entity, Transform) || !o.world.has(entity, Model)) retire(entity, slot);
        if (closed) return;
      }
      if (slots.size === before) break;
    }
    // Retirement callbacks can also cancel or replace this not-yet-admitted request.
    if (!o.world.has(e, Transform) || o.world.get(e, Model) !== data) return;
    validateModel(data);
    if (slots.size >= limit) throw Error('model: scene instance budget exceeded');
    const slot: Slot = {asset: data.asset, life: new AbortController()};
    slots.set(e, slot);
    void (async () => {
      const lease = await o.library.model(data.asset, {signal: slot.life.signal});
      if (!live(e, slot)) {
        lease.release();
        return;
      }
      slot.lease = lease;
      const {createModelPlayback} = await import('./model-playback');
      // Retirement already released an adopted lease while playback was loading.
      if (!live(e, slot)) return;
      const instance = lease.value.instantiate();
      // A template callback may end this visit before its returned instance can be adopted.
      if (!live(e, slot)) {
        lease.value.releaseInstance(instance);
        return;
      }
      slot.instance = instance;
      // Capture this owned instance before playback, publication or native added callbacks.
      if (o.poseLinks) slot.rig = captureModelRig(instance, o.poseLinks);
      if (!live(e, slot)) return;
      slot.root = new T.Group();
      slot.root.add(instance);
      if (!live(e, slot)) return; // Three's added event may synchronously retire the slot.
      slot.mixer = createModelPlayback(instance);
      slot.overrides = new Set();
      slot.rest = new Map();
      slot.root.traverse(node =>
        slot.rest!.set(node, {position: node.position.clone(), quaternion: node.quaternion.clone()}),
      );
      slot.nodes = new Map();
      slot.root.traverse(node => {
        if (node.name) slot.nodes!.set(node.name, slot.nodes!.has(node.name) ? null : node);
      });
      const current = o.world.get(e, Model),
        tr = o.world.get(e, Transform);
      if (!current || !tr || current.asset !== slot.asset) {
        retire(e, slot);
        return;
      }
      pose(e, slot, current, tr);
      if (o.world.has(e, ModelAttachment) || o.world.has(e, ModelPoseLink)) {
        slot.root.visible = false;
        slot.root.matrixAutoUpdate = false;
      }
      applyMask(slot, e);
      if (!live(e, slot)) return;
      o.looks?.sync(e, instance);
      if (!live(e, slot)) return;
      slot.ready = true;
      o.scene.add(slot.root);
      if (live(e, slot)) o.invalidate();
    })().catch(error => {
      const adopted = !!slot.lease,
        current = slots.get(e) === slot;
      if (adopted) {
        const wasSyncing = syncing;
        syncing = true;
        const cleanupErrors: unknown[] = [];
        try {
          try {
            retire(e, slot);
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError);
          }
          // Retain only terminal metadata, never released resources. Cleanup callbacks
          // may end the visit or change the request; never overwrite a newer slot.
          if (
            current &&
            !closed &&
            !slots.has(e) &&
            o.world.has(e, Transform) &&
            o.world.get(e, Model)?.asset === slot.asset
          ) {
            slots.set(e, {asset: slot.asset, life: slot.life, failed: true});
          }
        } finally {
          syncing = wasSyncing;
        }
        for (const cleanupError of cleanupErrors) report(cleanupError);
      } else if (current && !slot.life.signal.aborted) slot.failed = true;
      if (!isAbortError(error)) report(error);
    });
  }
  function pose(
    e: Entity,
    slot: Slot,
    data: ModelData,
    tr: {x: number; y: number; z: number; rx: number; ry: number; rz: number; scale: number},
  ): boolean {
    const root = slot.root!;
    // Attached presentation is published once, after every native pose is current.
    if (o.world.has(e, ModelAttachment) || o.world.has(e, ModelPoseLink)) return false;
    const detached = !root.matrixAutoUpdate;
    root.matrixAutoUpdate = true;
    const changed =
      detached ||
      root.position.x !== tr.x ||
      root.position.y !== tr.y ||
      root.position.z !== tr.z ||
      root.rotation.x !== tr.rx ||
      root.rotation.y !== tr.ry ||
      root.rotation.z !== tr.rz ||
      root.scale.x !== tr.scale ||
      root.visible !== data.visible;
    root.position.set(tr.x, tr.y, tr.z);
    root.rotation.set(tr.rx, tr.ry, tr.rz);
    root.scale.setScalar(tr.scale);
    root.visible = data.visible;
    return changed;
  }
  function applyMask(slot: Slot, e: Entity): boolean {
    const mask = o.mask?.(e) ?? 1;
    if (!live(e, slot)) return false;
    if (!Number.isInteger(mask) || mask < 0 || mask > 0xffffffff) throw Error('model: invalid render mask');
    if (slot.mask === mask) return false;
    slot.root!.traverse(node => {
      node.layers.mask = mask;
    });
    slot.mask = mask;
    return true;
  }
  const owner = {
    state(entity: Entity): ModelState {
      const requested = closed || !o.world.has(entity, Transform) ? undefined : o.world.get(entity, Model);
      if (!requested) return Object.freeze({status: 'absent', requestedAsset: null, adoptedAsset: null});
      const slot = slots.get(entity),
        matches = slot?.asset === requested.asset;
      return Object.freeze({
        status: matches && slot.failed ? 'failed' : matches && slot.ready ? 'ready' : 'loading',
        requestedAsset: requested.asset,
        adoptedAsset: slot?.ready ? slot.asset : null,
      });
    },
    attachmentState(entity: Entity): ModelAttachmentState {
      if (closed || !o.world.has(entity, Transform) || !o.world.has(entity, Model))
        return Object.freeze({status: 'absent', held: false});
      const input = o.world.get(entity, ModelAttachment);
      if (!input) return Object.freeze({status: 'unattached', held: false});
      const slot = slots.get(entity);
      if (slot?.asset !== o.world.get(entity, Model)?.asset || slot?.attachment?.input !== input)
        return Object.freeze({status: 'unresolved', held: false});
      return slot.attachment.state ?? Object.freeze({status: 'unresolved', held: false});
    },
    poseLinkState(entity: Entity): ModelPoseLinkState {
      if (closed || !o.world.has(entity, Transform) || !o.world.has(entity, Model))
        return Object.freeze({status: 'absent', reason: null});
      const input = o.world.get(entity, ModelPoseLink);
      if (!input) return Object.freeze({status: 'unlinked', reason: null});
      const slot = slots.get(entity);
      if (slot?.asset !== o.world.get(entity, Model)?.asset || slot?.poseLink?.input !== input)
        return Object.freeze({status: 'unresolved', reason: null});
      const meta = slot.poseLink;
      if (meta.state.status === 'ready') {
        // Read only captured dependency identities, bounded by admitted slots. Never reconcile,
        // load, scan native nodes or accept a changed ancestor merely because its asset id matches.
        let cursor = entity;
        for (let steps = 0; ; steps++) {
          const current = slots.get(cursor),
            model = o.world.get(cursor, Model);
          const unresolved = () => Object.freeze({status: 'unresolved' as const, reason: null});
          if (
            steps >= slots.size ||
            !current?.ready ||
            !o.world.has(cursor, Transform) ||
            model?.asset !== current.asset
          )
            return unresolved();
          const poseInput = o.world.get(cursor, ModelPoseLink),
            rigidInput = o.world.get(cursor, ModelAttachment);
          if (poseInput) {
            const link = current.poseLink;
            if (rigidInput || link?.input !== poseInput || link.state.status !== 'ready' || link.targetModel !== model)
              return unresolved();
            const parent = link.relation!.source;
            if (
              slots.get(parent) !== link.sourceSlot ||
              o.world.get(parent, Model) !== link.sourceModel ||
              o.world.get(parent, ModelPoseLink) !== link.sourcePoseInput ||
              o.world.get(parent, ModelAttachment) !== link.sourceAttachmentInput
            )
              return unresolved();
            cursor = parent;
          } else if (rigidInput) {
            const link = current.attachment;
            if (link?.input !== rigidInput || link.state?.status !== 'ready' || link.targetModel !== model)
              return unresolved();
            const parent = link.relation!.parent;
            if (
              slots.get(parent) !== link.parentSlot ||
              o.world.get(parent, Model) !== link.parentModel ||
              o.world.get(parent, ModelPoseLink) !== link.parentPose ||
              o.world.get(parent, ModelAttachment) !== link.parentAttachment
            )
              return unresolved();
            cursor = parent;
          } else break;
        }
      }
      return meta.state;
    },
    /** Opt-in diagnostics borrow this owner; no additional leases or asynchronous work. */
    inspect: inspection
      ? (request: ModelInspectionRequest) =>
          inspection(request, entity =>
            closed ? null : {requested: o.world.get(entity, Model), slot: slots.get(entity)},
          )
      : undefined,
    sync(dt = 0): boolean {
      // Cleanup and Three callbacks may synchronously request another sync; the active pass owns reconciliation.
      if (closed || syncing) return false;
      if (!Number.isFinite(dt) || dt < 0) throw Error('model: invalid playback delta');
      syncing = true;
      try {
        let changed = restoreObsoletePoseLinks(o.world, slots);
        const seen = new Set<Entity>();
        // Free retired entity capacity before admitting replacements. A full map
        // must not prevent the cleanup which makes the next request admissible.
        for (const [e, slot] of [...slots]) {
          if (!o.world.has(e, Transform) || !o.world.has(e, Model)) {
            retire(e, slot);
            changed = true;
            if (closed) return changed;
          }
        }
        for (const [e, tr, data] of o.world.query(Transform, Model)) {
          validateModel(data);
          seen.add(e);
          if (slots.get(e)?.asset !== data.asset) {
            retire(e);
            if (closed) break;
            load(e, data);
            changed = true;
          }
          const slot = slots.get(e);
          if (!slot?.ready) continue;
          changed = pose(e, slot, data, tr) || changed;
          changed = applyMask(slot, e) || changed;
          if (!live(e, slot)) continue;
          if (o.looks?.sync(e, slot.instance!)) changed = true;
          if (!live(e, slot)) continue;
          const hadOverrides = slot.overrides!.size > 0;
          for (const node of slot.overrides!) {
            const rest = slot.rest!.get(node)!;
            node.position.copy(rest.position);
            node.quaternion.copy(rest.quaternion);
          }
          slot.overrides!.clear();
          const key = `${data.clip}|${data.revision}|${data.loop}`,
            keyChanged = key !== slot.animationKey,
            transition = data.transition ?? 0;
          let from: ReturnType<ClipTransitions['captureFrom']> | undefined;
          // Never blend in a model's first clip: there is no displayed pose to leave yet.
          if (keyChanged && transition > 0 && slot.animationKey !== undefined) {
            if (slot.transitions === undefined) {
              const nodes = animatedNodes(slot.instance!, slot.lease!.value.animations);
              slot.transitions = nodes && createClipTransitions(nodes);
              if (!nodes) report(Error(`model: more than ${MAX_TRANSITION_NODES} animated nodes; clip changes cut`));
            }
            // The displayed pose, including a transition still in progress, is where the next one starts.
            from = slot.transitions?.captureFrom();
          }
          // Return nodes to the running transition's base so nothing is blended twice or left part-way.
          slot.fade?.restore();
          if (keyChanged) slot.fade = undefined;
          if (keyChanged) {
            slot.mixer!.stopAllAction();
            slot.action = undefined;
            if (data.clip) {
              const matches = slot.lease!.value.animations.filter(c => c.name === data.clip);
              if (matches.length !== 1) {
                slot.animationKey = key;
                report(Error(`model: unknown or ambiguous clip ${data.clip}`));
                continue;
              }
              slot.action = slot.mixer!.clipAction(matches[0]!);
              /* matches.length === 1 */ slot.action.setLoop(
                data.loop ? T.LoopRepeat : T.LoopOnce,
                data.loop ? Infinity : 1,
              );
              slot.action.clampWhenFinished = true;
              slot.action.reset().play();
            }
            slot.animationKey = key;
            slot.mixer!.update(0);
            if (from) slot.fade = slot.transitions!.start(from, transition);
            changed = true;
          }
          let advanced = false;
          if (slot.action) {
            slot.action.paused = !data.playing;
            slot.action.timeScale = data.speed;
            if (data.playing && data.speed > 0 && dt > 0 && slot.action.isRunning()) {
              slot.mixer!.update(dt);
              advanced = true;
              changed = true;
            }
          }
          if (hadOverrides || (slot.fade && !advanced)) slot.mixer!.update(0);
          if (slot.fade) {
            // Presentation time: the blend completes even while clip playback is paused, so a paused model that
            // switches to another clip or the bind pose still arrives there. Clip speed does not scale it.
            if (!slot.fade.blend(dt)) slot.fade = undefined;
            if (dt > 0) changed = true;
          }
          const poseKey = JSON.stringify(data.pose);
          changed = slot.poseKey !== poseKey || changed;
          slot.poseKey = poseKey;
          for (const p of data.pose) {
            const node = slot.nodes!.get(p.node);
            if (!node) throw Error(`model: missing or ambiguous pose node ${p.node}`);
            slot.rest!.set(node, {position: node.position.clone(), quaternion: node.quaternion.clone()});
            if (p.position) node.position.set(...p.position);
            if (p.rotation) node.quaternion.set(...p.rotation).normalize();
            slot.overrides!.add(node);
          }
          updateWorldMatrixFromRoot(slot.root!, true);
          if (o.poseLinks && live(e, slot)) slot.root!.updateMatrixWorld(true);
        }
        for (const e of slots.keys())
          if (!seen.has(e)) {
            retire(e);
            changed = true;
          }
        if (!closed) {
          let linked = false;
          for (const [entity, slot] of slots)
            if (slot.poseLink || o.world.has(entity, ModelPoseLink)) {
              linked = true;
              break;
            }
          changed =
            reconcileModelAttachments(
              o.world,
              slots,
              linked ? poseLinkHooks(o.world, slots, o.poseLinks) : undefined,
            ) || changed;
        }
        return changed;
      } finally {
        syncing = false;
      }
    },
    socket(entity: Entity, name: string): ModelSocketPose | null {
      const node = slots.get(entity)?.nodes?.get(name);
      if (!node) return null;
      updateWorldMatrixFromRoot(node);
      return Object.freeze({name, matrix: Object.freeze([...node.matrixWorld.elements])});
    },
    dispose() {
      if (closed) return;
      closed = true;
      o.signal.removeEventListener('abort', abort);
      const errors: unknown[] = [];
      for (const [e, slot] of [...slots])
        try {
          retire(e, slot);
        } catch (error) {
          errors.push(error);
        }
      if (errors.length) throw new AggregateError(errors, 'model: scene cleanup failed');
    },
  };
  const abort = () => {
    try {
      owner.dispose();
    } catch (error) {
      report(error);
    }
  };
  o.signal.addEventListener('abort', abort, {once: true});
  if (o.signal.aborted) abort();
  return owner;
}
