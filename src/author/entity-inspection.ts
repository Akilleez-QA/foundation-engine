import type {World} from '../core/ecs/world';
import type {SceneVisit} from '../core/router/handover';
import type {SceneEntitiesRequest, SceneEntitiesResult} from './play';

/** Existing scene visit owns this optional handle. Captures no independent epoch or inspection cache. */
export function createSceneEntityInspector(world: World, visit: SceneVisit, activitySignal: AbortSignal) {
  return (request: SceneEntitiesRequest): SceneEntitiesResult => {
    if (activitySignal.aborted || visit.signal.aborted || !visit.current()) return {status: 'unavailable'};
    if (!Number.isSafeInteger(request.expectedEpoch) || request.expectedEpoch < 0) throw new RangeError('entity inspection: invalid scene epoch');
    if (request.expectedEpoch !== visit.epoch) return {status: 'stale', epoch: visit.epoch};
    return {status: 'ready', epoch: visit.epoch, page: world.inspectMetadata(request)};
  };
}
