/**
 * kits/cadence: optional bounded per-member update cadence on the caller's tick (pure helper; no system, clock,
 * callback or registration). Cost: no draws; add/remove/setPeriod O(log n), take O(k log n) for k returned members.
 */
export {
  createCadence,
  createCadenceResult,
  CADENCE_CEILING,
  type Cadence,
  type CadenceLimits,
  type CadenceSnapshot,
  type CadenceStats,
  type CadenceStatus,
  type CadenceTakeResult,
} from './cadence';
