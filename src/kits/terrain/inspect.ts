import type {createTerrainOwner} from './generation';
import type {SurfaceSample} from './surface';

type TerrainOwner = ReturnType<typeof createTerrainOwner>;
export interface TerrainInspectionRequest {
  expectedEpoch: number;
  offset?: number;
  /** At most the existing generation's 64 tiles; defaults to 16. */
  limit?: number;
  maxLabelLength?: number;
  sample?: {x: number; z: number};
  /** Optional consumer report, not GPU observation. Indices address this generation's chunk order. */
  displayed?: {epoch: number; tiles: readonly TerrainDisplayedTile[]};
}
export interface TerrainDisplayedTile {
  index: number;
  stride: 1 | 2 | 4;
  vertices: number;
  triangles: number;
}
export interface TerrainInspectionTile {
  index: number;
  key: string;
  keyTruncated: boolean;
  bounds: {min: {x: number; y: number; z: number}; max: {x: number; y: number; z: number}};
  prepared: {stride: 1 | 2 | 4; maxError: number; vertices: number; triangles: number};
  displayed: TerrainDisplayedTile | null;
}
interface TerrainInspectionState {
  epoch: number;
  desiredEpoch: number;
  requests: number;
  ready: number;
  /** Payload reservation estimate, not measured heap/GPU bytes. */
  bytes: number;
  listenerErrors: number;
  releaseErrors: number;
}
export type TerrainInspection =
  | {status: 'closed' | 'stale' | 'stale-display'; state: TerrainInspectionState}
  | {
    status: 'ready'; state: TerrainInspectionState;
    surface: {id: string; idTruncated: boolean; cellsX: number; cellsZ: number; spacing: number};
    total: number; nextOffset: number | null; tiles: TerrainInspectionTile[];
    contact: {x: number; z: number; sample: SurfaceSample | null} | null;
  };

/** On-demand detached scalar inspection. No retained owner, geometry copy, subscription or background work. */
export function inspectTerrain(owner: TerrainOwner, request: TerrainInspectionRequest): TerrainInspection {
  const {expectedEpoch, offset = 0, limit = 16, maxLabelLength = 120, sample, displayed} = request;
  const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (!integer(expectedEpoch) || !integer(offset) || !integer(limit) || limit < 1 || limit > 64 || !integer(maxLabelLength) || maxLabelLength < 1) {
    throw new RangeError('terrain inspection: invalid epoch/page/label bound');
  }
  if (sample && (!Number.isFinite(sample.x) || !Number.isFinite(sample.z))) throw new RangeError('terrain inspection: invalid sample point');
  const stats = owner.stats();
  const state: TerrainInspectionState = {
    epoch: stats.epoch, desiredEpoch: stats.desiredEpoch, requests: stats.requests, ready: stats.ready,
    bytes: stats.bytes, listenerErrors: stats.listenerErrors, releaseErrors: stats.releaseErrors + stats.ownerReleaseErrors,
  };
  if (stats.closed) return {status: 'closed', state};
  if (expectedEpoch !== stats.epoch) return {status: 'stale', state};
  const generation = owner.current;
  const total = generation.chunks.length;
  if (displayed && displayed.epoch !== generation.epoch) return {status: 'stale-display', state};
  if (offset > total) throw new RangeError('terrain inspection: page offset outside generation');
  // Bound both validation work and optional returned display metadata by the finite generation.
  const views = new Map<number, TerrainDisplayedTile>();
  if (displayed) {
    if (displayed.tiles.length > total) throw new RangeError('terrain inspection: too many displayed tiles');
    for (const tile of displayed.tiles) {
      if (!tile || !integer(tile.index) || tile.index >= total || views.has(tile.index) || ![1, 2, 4].includes(tile.stride) || !integer(tile.vertices) || !integer(tile.triangles)) {
        throw new RangeError('terrain inspection: invalid displayed tile');
      }
      views.set(tile.index, {index: tile.index, stride: tile.stride, vertices: tile.vertices, triangles: tile.triangles});
    }
  }
  const end = Math.min(total, offset + limit);
  const tiles: TerrainInspectionTile[] = [];
  for (let index = offset; index < end; index++) {
    const {key, chunk} = generation.chunks[index]!;
    tiles.push({
      index, key: key.slice(0, maxLabelLength), keyTruncated: key.length > maxLabelLength,
      bounds: {min: {...chunk.bounds.min}, max: {...chunk.bounds.max}},
      prepared: {stride: chunk.stride, maxError: chunk.maxError, vertices: chunk.mesh.positions.length / 3, triangles: chunk.mesh.indices.length / 3},
      displayed: views.get(index) ?? null,
    });
  }
  const surface = generation.surface;
  const hit = sample ? surface.sample(sample.x, sample.z) : null;
  return {
    status: 'ready', state,
    surface: {id: surface.id.slice(0, maxLabelLength), idTruncated: surface.id.length > maxLabelLength, cellsX: surface.cellsX, cellsZ: surface.cellsZ, spacing: surface.spacing},
    total, nextOffset: end < total ? end : null, tiles,
    contact: sample ? {x: sample.x, z: sample.z, sample: hit ? {...hit, normal: {...hit.normal}} : null} : null,
  };
}
