/**
 * author/model-pending.ts: what the scene answers about models before its model chunk (`scene-model-chunk.ts`) has
 * arrived. The answers are the ones the model owner gives an entity it has not admitted yet, so a game cannot tell a
 * chunk still loading from an asset still loading: a requested model is `loading` (or `failed` when the chunk could
 * not load), an attachment or pose link is `unresolved`, and a socket is not there yet.
 */
import type {ComponentInit, Entity, World} from '../core/ecs/world';
import {Transform, type EntityDefinition} from './defs';
import {Model} from './model';
import {ModelAttachment, type ModelAttachmentState} from './model-attachment';
import {ModelPoseLink, type ModelPoseLinkState} from './model-pose-link';
import type {ModelState} from './model-state';

export function pendingModelState(world: World, entity: Entity, closed: boolean, failed: boolean): ModelState {
  const requested = closed || !world.has(entity, Transform) ? undefined : world.get(entity, Model);
  if (!requested) return Object.freeze({status: 'absent', requestedAsset: null, adoptedAsset: null});
  return Object.freeze({status: failed ? 'failed' : 'loading', requestedAsset: requested.asset, adoptedAsset: null});
}

export function pendingAttachmentState(world: World, entity: Entity, closed: boolean): ModelAttachmentState {
  if (closed || !world.has(entity, Transform) || !world.has(entity, Model))
    return Object.freeze({status: 'absent', held: false});
  return Object.freeze({status: world.has(entity, ModelAttachment) ? 'unresolved' : 'unattached', held: false});
}

export function pendingPoseLinkState(world: World, entity: Entity, closed: boolean): ModelPoseLinkState {
  if (closed || !world.has(entity, Transform) || !world.has(entity, Model))
    return Object.freeze({status: 'absent', reason: null});
  return Object.freeze({status: world.has(entity, ModelPoseLink) ? 'unresolved' : 'unlinked', reason: null});
}

/** True when a scene body starts with a `Model` entity, so its chunk loads before the first frame. */
export function bodyHasModel(entities: readonly (EntityDefinition | readonly ComponentInit<object>[])[]): boolean {
  return entities.some(e => ('kind' in e ? e.components : e).some(i => i.type === Model));
}
