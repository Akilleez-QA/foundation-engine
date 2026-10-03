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
  return defineSystem({
    id: 'frames-apply',
    run(ctx) {
      updates.pump(work);
      for (const [, replica, tr] of ctx.world.query(FrameReplica, Transform)) {
        const state = updates.state(replica.owner);
        if (!state?.world || state.generation !== replica.generation || state.revision === replica.revision) continue;
        const pose = authorPose(state.world);
        Object.assign(tr, pose);
        replica.applied = state.applied;
        replica.revision = state.revision;
        ctx.world.touch();
      }
    },
  });
}
export function frames(): KitDefinition {
  return defineKit({id: 'frames', requires: [], defs: [], modules: []});
}
