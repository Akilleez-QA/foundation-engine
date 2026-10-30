import {defineKit, type KitDefinition} from '../../author';

/** Optional deterministic behaviour trees: bounded ticks, blackboard, decorators, resumable and saveable state. */
export function behavior(): KitDefinition {
  return defineKit({id: 'behavior', requires: [], defs: [], modules: []});
}
export {
  defineBehaviorTree,
  isBehaviorName,
  isBlackboardValue,
  BehaviorError,
  type BehaviorTree,
  type NodeInput,
  type FlatNode,
  type BlackboardValue,
  type CompareOp,
} from './tree';
export {
  createBehavior,
  type Behavior,
  type BehaviorStatus,
  type BehaviorHandlers,
  type ActionHandler,
  type LeafContext,
  type TraceRow,
  type BehaviorSnapshot,
} from './runtime';
