/**
 * kits/entity-pool: optional bounded entity pool with creator-declared eviction classes (pure helper plus a World
 * adapter; no system, clock, callback or registration). Cost: no draws; admit/release/pin/setScore O(log n) plus
 * O(k log n) for k evictions; tables allocated at construction.
 */
export {
  createEntityPool,
  createPoolResult,
  POOL_CEILING,
  type EntityPool,
  type EntityPoolLimits,
  type EvictionOrder,
  type PoolClass,
  type PoolClassStats,
  type PoolRefusal,
  type PoolResult,
  type PoolStats,
  type PoolStatus,
} from './pool';
export {POOL_EVICTED, despawnPooled, spawnPooled, type PoolEvictedEvent} from './world';
