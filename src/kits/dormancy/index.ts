/**
 * kits/dormancy: optional entity dormancy from active zones and camera-relative view volumes, with wake/sleep margin
 * and dwell hysteresis, a bounded wake budget with a first-in-first-out queue, and woke/slept lists (pure helper; no
 * system, clock, renderer or registration). It feeds the population kit's update tiers through `dormantAsFar` and
 * takes zone ids from the creator (for example region-activation region indices). Cost: no draws; a step is
 * O(tracked × views + active zones).
 */
import {defineKit, type KitDefinition} from '../../author';
export {
  createDormancy,
  dormantAsFar,
  DORMANCY_CEILING,
  type Dormancy,
  type DormancyLimits,
  type DormancyPolicy,
  type DormancyPosition,
  type DormancyState,
  type DormancyStats,
  type DormancyStatus,
  type DormancyStep,
  type DormancyStepInput,
  type DormancyTrackOptions,
  type ViewVolume,
} from './dormancy';

/** The kit: nothing to register. */
export function dormancy(): KitDefinition {
  return defineKit({id: 'dormancy', requires: []});
}
