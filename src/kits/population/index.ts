/**
 * kits/population: authored placements that spawn near observers and remember destroyed ones (persisted through a
 * save section), and update tiers that freeze or round-robin far entities. Pure helpers over the spatial kit's grid:
 * no system, renderer, timer or owner. Cost: placements O(cells near observers + live × observers) per update;
 * tiers O(tracked × observers) per step.
 */
import {defineKit, type KitDefinition} from '../../author';
export {
  createPlacementField,
  definePlacements,
  parsePlacementState,
  PLACEMENT_LIMITS,
  type Placement,
  type PlacementField,
  type PlacementFieldLimits,
  type PlacementInput,
  type PlacementSet,
  type PlacementState,
  type PlacementStatus,
  type PlacementUpdate,
  type RespawnPolicy,
} from './placements';
export {createUpdateTiers, type TierStats, type UpdatePolicy, type UpdateTierLimits, type UpdateTiers} from './tiers';
export {definePlacementSection, type PlacementRecord} from './section';

/** The kit: nothing to register. It builds on the spatial kit. */
export function population(): KitDefinition {
  return defineKit({id: 'population', requires: ['spatial']});
}
