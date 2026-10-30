/**
 * kits/region-activation: optional bounded activation of world regions from observer positions (pure helper; no
 * system, clock, loader, save data or registration). Cost: no draws; an update scans each observer's release square
 * plus the active list, both bounded by the creator's limits.
 */
export {
  createRegionActivation,
  createRegionUpdateResult,
  REGION_CEILING,
  type RegionActivation,
  type RegionActivationLimits,
  type RegionActivationStats,
  type RegionPin,
  type RegionState,
  type RegionUpdateResult,
  type RegionUpdateStatus,
} from './activation';
