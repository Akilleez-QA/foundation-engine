import {
  defineComponent,
  defineKit,
  defineSystem,
  Transform,
  type KitDefinition,
  type SystemDefinition,
} from '../../author';
import {authorPose} from './frame';
import type {FrameUpdates} from './updates';
export {createFrames, frameRef, poseMatrix, authorPose, type Frames, type FrameNode, type FrameRef} from './frame';
export {createFrameUpdates, type FrameUpdate, type FrameUpdates} from './updates';
export const FrameReplica = defineComponent('frames-replica', {owner: '', generation: 0, applied: -1, revision: -1});
/** Apply resolved snapshots in scene update order; this system is the sole pose owner for marked entities. */
export function frameReplicaSystem(updates: FrameUpdates, work = 32): SystemDefinition {
  const written = new WeakMap<object, {owner: string; generation: number; revision: number; transform: object}>();
  return defineSystem({
    id: 'frames-apply',
    run(ctx) {
      updates.pump(work);
      for (const [, replica, tr] of ctx.world.query(FrameReplica, Transform)) {
        const state = updates.state(replica.owner),
          prior = written.get(replica);
        if (!state?.world || state.generation !== replica.generation) continue;
        if (
          prior?.owner === replica.owner &&
          prior.generation === state.generation &&
          prior.revision === state.revision &&
          prior.transform === tr
        )
          continue;
        const pose = authorPose(state.world);
        Object.assign(tr, pose);
        replica.applied = state.applied;
        replica.revision = state.revision;
        written.set(replica, {
          owner: replica.owner,
          generation: state.generation,
          revision: state.revision,
          transform: tr,
        });
        ctx.world.touch();
      }
    },
  });
}
export function frames(): KitDefinition {
  return defineKit({id: 'frames', requires: [], defs: [], modules: []});
}
