import { defineKit, type KitDefinition } from '../../author';
export { createSampledSurface, type SampledSurfaceOptions, patchSurface, type SurfacePatch, type SurfacePatchVertex, type SurfaceVertex, createSurface, type Surface, type SurfaceLayer, type SurfaceMesh, type SurfaceOptions, type SurfaceRayHit, type SurfacePad, type SurfaceSample } from './surface';
/** Optional fixed-grid terrain generation and surface queries; no frame system. */
export function terrain(): KitDefinition { return defineKit({ id: 'terrain', requires: [], defs: [], modules: [] }); }
export { buildSurfaceChunk, type SurfaceChunk, type SurfaceChunkOptions } from './chunk';
export { createTerrainGenerationBuilder, prepareTerrainGeneration, createTerrainOwner, type TerrainGeneration, type TerrainTile } from './generation';
export { createSurfaceScatter, type ScatterPoint } from './scatter';
export { projectedSurfaceError, selectSurfaceLod, type TerrainProjection } from './lod';

export { prepareSurfacePatch, prepareTerrainRegionPatch } from './patch-job';
export { inspectTerrain, type TerrainInspectionRequest, type TerrainInspection, type TerrainInspectionTile, type TerrainDisplayedTile } from './inspect';

export { terrainRecipeSlices, evaluateTerrainRecipe, type TerrainRecipe, type TerrainRecipeStep, type TerrainOperator, type TerrainPoint, type TerrainField, type TerrainParameter, type TerrainRecipeLimits } from './recipe';

export { createTerrainRecipeJob, basicTerrainRecipeJob, prepareTerrainRecipe, type TerrainRecipeJobInput } from './recipe-job';
export { basicTerrainOperators } from './recipe-operators';
export { patchTerrainRegion, type TerrainRegionEdit, createTerrainRegion, terrainRegionSlices, type TerrainLattice, type TerrainRegion, type TerrainRegionOptions, type TerrainRegionPoint, type TerrainRegionValue, type TerrainRegionExtent, type TerrainRegionQuery } from './region';
export { createTerrainCoverage, type TerrainCoverageEntry, type TerrainCoverageQuery } from './region-coverage';
export { createTerrainRegionJob, basicTerrainRegionJob, prepareTerrainRegion, type TerrainRegionRecipe, type TerrainRegionEvaluator, type TerrainRegionJobInput } from './region-job';
