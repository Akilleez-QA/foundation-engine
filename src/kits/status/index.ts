import {defineKit, type KitDefinition} from '../../author';

/** Optional status effects: stacks, fixed-clock durations, thresholds that transform, immunities, save/restore. */
export function status(): KitDefinition {
  return defineKit({id: 'status', requires: [], defs: [], modules: []});
}
export {
  defineStatusRules,
  isStatusId,
  StatusError,
  type StatusRules,
  type StatusDefinition,
  type StatusDefinitionInput,
  type StatusThreshold,
  type StatusContribution,
  type DurationPolicy,
} from './rules';
export {
  createStatusEffects,
  type StatusEffects,
  type StatusInstance,
  type StatusEvent,
  type StatusOptions,
  type StatusSnapshot,
  type ApplyResult,
  type Immunity,
} from './effects';
export {statusPresets} from './presets';
