import {isTerrainRegion, type TerrainRegion, type TerrainRegionExtent} from './region';
import type {SurfaceSample} from './surface';
export type TerrainCoverageEntry =
  | {readonly status: 'ready'; readonly region: TerrainRegion}
  | {readonly status: 'pending' | 'unavailable' | 'failed'; readonly id: string; readonly extent: TerrainRegionExtent};
export type TerrainCoverageQuery =
  | {readonly status: 'covered'; readonly region: TerrainRegion; readonly sample: SurfaceSample}
  | {readonly status: 'pending' | 'unavailable' | 'failed'; readonly id: string}
  | {readonly status: 'outside'}
  | {readonly status: 'ambiguous'; readonly ids: readonly string[]};
/** Optional finite lookup only. The creator owns residency, retries, fallback and collision policy. */
export function createTerrainCoverage(
  entries: readonly TerrainCoverageEntry[],
  maxEntries = 64,
): Readonly<{query(x: number, z: number): TerrainCoverageQuery}> {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 64 || !Array.isArray(entries))
    throw Error('terrain coverage: invalid bound');
  const length = entries.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > maxEntries)
    throw Error('terrain coverage: too many entries');
  const owned: {
    status: TerrainCoverageEntry['status'];
    id: string;
    extent: TerrainRegionExtent;
    region?: TerrainRegion;
  }[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < length; i++) {
    const entry = entries[i]!,
      status = entry.status;
    if (status === 'ready') {
      const region = entry.region;
      if (!isTerrainRegion(region)) throw Error('terrain coverage: canonical region required');
      owned.push({status, id: region.id, extent: region.extent, region});
    } else {
      if (status !== 'pending' && status !== 'unavailable' && status !== 'failed')
        throw Error('terrain coverage: invalid status');
      const {id, extent: raw} = entry,
        {minX, minZ, maxX, maxZ} = raw;
      if (
        typeof id !== 'string' ||
        !id.trim() ||
        id.length > 256 ||
        ![minX, minZ, maxX, maxZ].every(Number.isFinite) ||
        minX >= maxX ||
        minZ >= maxZ
      )
        throw Error('terrain coverage: invalid extent');
      owned.push({status, id, extent: Object.freeze({minX, minZ, maxX, maxZ})});
    }
    const id = owned[i]!.id;
    if (ids.has(id)) throw Error('terrain coverage: duplicate identity');
    ids.add(id);
  }
  return Object.freeze({
    query(x: number, z: number): TerrainCoverageQuery {
      if (!Number.isFinite(x) || !Number.isFinite(z)) throw Error('terrain coverage: finite coordinates required');
      const matches = owned.filter(({extent: e}) => x >= e.minX && x <= e.maxX && z >= e.minZ && z <= e.maxZ);
      if (!matches.length) return Object.freeze({status: 'outside'});
      // Shared boundaries can overlap intentionally. Report ambiguity rather than imposing creator precedence.
      if (matches.length > 1) return Object.freeze({status: 'ambiguous', ids: Object.freeze(matches.map(e => e.id))});
      const match = matches[0]!;
      if (match.region) {
        const result = match.region.query(x, z);
        if (result.status !== 'covered') throw Error('terrain coverage: inconsistent bounds');
        return Object.freeze({status: 'covered', region: match.region, sample: result.sample});
      }
      return Object.freeze({status: match.status as 'pending' | 'unavailable' | 'failed', id: match.id});
    },
  });
}
