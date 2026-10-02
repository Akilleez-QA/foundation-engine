import { defineKit, type KitDefinition } from '../../author';
/** Optional seeded procedural generation: seed derivation, bounded grid generation jobs, a seed save section. No systems. */
export function procgen(): KitDefinition { return defineKit({ id: 'procgen', requires: [], defs: [], modules: [] }); }
export { deriveSeed, createRng, SEED_PATH_LIMITS, type SeedPart, type Rng } from '../../core/rng';
export { createGridGenerationJob, parseGridParameters, GRID_DEFAULT_LIMITS, GRID_MAX_CELLS, type GridRecipe, type GridGenerator, type GridCells, type GridContext, type GridLimits, type GridParameter, type GridDescriptor, type GeneratedGrid, type GridPrepareResult, type GridJobInput, type GridWire } from './grid-job';
export { cellularGenerator, cellularGridJob, prepareCellularGrid } from './cellular';
export { defineGenerationSeedSection, parseGenerationSeed, type GenerationSeedRecord } from './seed-section';
