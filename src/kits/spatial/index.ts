/**
 * kits/spatial: an optional bounded uniform-grid index for neighbour, range and interest queries.
 * Pure data structure: no system, renderer, worker, timer or save data. Cost: no draws; O(1) insert/move/remove,
 * queries O(cells scanned + entries in them), both bounded by the creator's limits.
 */
import { defineKit, type KitDefinition } from '../../author';
export {
  createSpatialGrid, GRID_CEILING,
  type SpatialGrid, type GridLimits, type GridStats, type IdBuffer, type QueryResult, type QueryStatus,
  type InsertStatus, type MoveStatus, type RemoveStatus,
} from './grid';

/** The kit registration; the grid itself works without it (`createSpatialGrid` is a pure helper). */
export function spatial(): KitDefinition { return defineKit({ id: 'spatial', requires: [], defs: [], modules: [] }); }
