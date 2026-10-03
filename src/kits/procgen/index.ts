import { defineKit, type KitDefinition } from '../../author';
/** Optional seeded procedural generation: seed derivation, bounded grid generation jobs, a seed save section. No systems. */
export function procgen(): KitDefinition { return defineKit({ id: 'procgen', requires: [], defs: [], modules: [] }); }
export { deriveSeed, createRng, SEED_PATH_LIMITS, type SeedPart, type Rng } from '../../core/rng';
export { createGridGenerationJob, parseGridParameters, GRID_DEFAULT_LIMITS, GRID_MAX_CELLS, type GridRecipe, type GridGenerator, type GridCells, type GridContext, type GridLimits, type GridParameter, type GridDescriptor, type GeneratedGrid, type GridPrepareResult, type GridJobInput, type GridWire, type GridDimensions, type GridPrepareOptions, type GridJobStage, GridJobError } from './grid-job';
export { cellularGenerator, cellularGridJob, prepareCellularGrid, CELLULAR_CELLS_PER_SLICE } from './cellular';
export { defineGenerationSeedSection, parseGenerationSeed, type GenerationSeedRecord, type GenerationSeedSectionOptions } from './seed-section';
export { createCellEdits, decodeCellEdits, baselineChecksum, CELL_EDIT_DEFAULT_LIMITS, type CellEdits, type CellEditBaseline, type CellEditLimits, type CellEditDimensions } from './cell-edits';
export { deleteChunkDatabase, listChunkDatabases, chunkDatabaseDeleting } from '../../core/save/chunk-port';
export { openChunkStore, createChunkStore, ChunkStoreError, CHUNK_STORE_DEFAULT_LIMITS, type ChunkStore, type ChunkStoreOptions, type OpenChunkStoreOptions, type ChunkStoreLimits, type ChunkStoreStats, type ChunkReadResult, type ChunkWrite, type ChunkWriteResult, type ChunkRemoveResult, type ChunkQuarantineRow, type ChunkFailed, type ChunkStatus } from '../../core/save/chunk-store';
