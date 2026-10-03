import {
  validatePatchValues,
  isSurfacePatch,
  adoptGeneratedSurface,
  cropSurface,
  normalSlices,
  patchSurface,
  projectSurfacePatch,
  surfaceParent,
  surfaceWire,
  type Surface,
  type SurfacePatch,
  type SurfaceMesh,
  type SurfaceSample,
  type SurfaceVertex,
  type SurfaceWire,
} from './surface';
/** Shared coordinate frame. Revision identifies the creator's accepted sample source. */
export interface TerrainLattice {
  readonly id: string;
  readonly revision: number;
  readonly baseX: number;
  readonly baseZ: number;
  readonly spacing: number;
}
export interface TerrainRegionOptions {
  readonly id: string;
  readonly lattice: TerrainLattice;
  readonly startX: number;
  readonly startZ: number;
  readonly cellsX: number;
  readonly cellsZ: number;
}
export interface TerrainRegionPoint {
  readonly gx: number;
  readonly gz: number;
  readonly x: number;
  readonly z: number;
}
export interface TerrainRegionValue {
  readonly height: number;
  readonly material?: number;
  readonly excluded?: boolean;
}
export interface TerrainRegionExtent {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}
export type TerrainRegionQuery =
  {readonly status: 'covered'; readonly sample: SurfaceSample} | {readonly status: 'outside'};
export interface TerrainRegion {
  readonly id: string;
  readonly lattice: TerrainLattice;
  /** Canonical core view; halo remains private backing for smooth normals and patches. */
  readonly surface: Surface;
  readonly startX: number;
  readonly startZ: number;
  readonly cellsX: number;
  readonly cellsZ: number;
  /** Global integer sample indices read by this region, inclusive of its halo. */
  readonly dependency: TerrainRegionExtent;
  /** World bounds of visible/queryable core; the halo is never exposed as coverage. */
  readonly extent: TerrainRegionExtent;
  vertex(x: number, z: number): SurfaceVertex;
  mesh(): SurfaceMesh;
  query(x: number, z: number): TerrainRegionQuery;
}
const regions = new WeakSet<TerrainRegion>();
export function isTerrainRegion(value: TerrainRegion): boolean {
  return regions.has(value);
}
const finite = (value: number) => {
  if (!Number.isFinite(value)) throw Error('terrain region: finite number required');
  return value;
};
const index = (value: number) => {
  if (!Number.isSafeInteger(value)) throw Error('terrain region: safe integer required');
  return value;
};
function axis(base: number, spacing: number, start: number, cells: number): Float32Array {
  const values = new Float32Array(cells + 1);
  for (let i = 0; i <= cells; i++) {
    values[i] = base + index(start + i) * spacing;
    if (!Number.isFinite(values[i]) || (i && values[i]! <= values[i - 1]!))
      throw Error('terrain region: collapsed or overflowing lattice');
  }
  return values;
}
/** @internal Bounded, detached identity capture; does not execute the source. */
export function captureTerrainRegion(options: TerrainRegionOptions): TerrainRegionOptions {
  const {id, startX, startZ, cellsX, cellsZ, lattice: raw} = options;
  const {id: latticeId, revision, baseX, baseZ, spacing} = raw;
  if (
    typeof id !== 'string' ||
    !id.trim() ||
    id.length > 256 ||
    typeof latticeId !== 'string' ||
    !latticeId.trim() ||
    latticeId.length > 256
  )
    throw Error('terrain region: invalid identity');
  index(revision);
  if (revision < 0) throw Error('terrain region: invalid revision');
  finite(baseX);
  finite(baseZ);
  finite(spacing);
  if (spacing <= 0) throw Error('terrain region: invalid spacing');
  index(startX);
  index(startZ);
  index(cellsX);
  index(cellsZ);
  if (cellsX < 1 || cellsX > 254 || cellsZ < 1 || cellsZ > 254) throw Error('terrain region: invalid core or source');
  const lattice = Object.freeze({id: latticeId, revision, baseX, baseZ, spacing});
  index(startX - 1);
  index(startZ - 1);
  index(startX + cellsX + 1);
  index(startZ + cellsZ + 1);
  return Object.freeze({id, lattice, startX, startZ, cellsX, cellsZ});
}
/** Captures metadata immediately. Each yield bounds work to one row (creator callbacks remain trusted). */
export function terrainRegionSlices(
  options: TerrainRegionOptions,
  source: (point: TerrainRegionPoint) => TerrainRegionValue,
): Generator<void, TerrainRegion, void> {
  const {id, lattice, startX, startZ, cellsX, cellsZ} = captureTerrainRegion(options);
  const {revision, baseX, baseZ, spacing} = lattice;
  if (typeof source !== 'function') throw Error('terrain region: source required');
  const dependency = Object.freeze({
    minX: index(startX - 1),
    minZ: index(startZ - 1),
    maxX: index(startX + cellsX + 1),
    maxZ: index(startZ + cellsZ + 1),
  });
  const nx = cellsX + 2,
    nz = cellsZ + 2,
    width = nx + 1,
    count = width * (nz + 1);
  const xs = axis(baseX, spacing, dependency.minX, nx),
    zs = axis(baseZ, spacing, dependency.minZ, nz);
  const extent = Object.freeze({minX: xs[1]!, minZ: zs[1]!, maxX: xs[nx - 1]!, maxZ: zs[nz - 1]!});
  return (function* () {
    const heights = new Float32Array(count),
      materials = new Uint16Array(count),
      exclusions = new Uint8Array(count);
    for (let z = 0; z <= nz; z++) {
      for (let x = 0; x <= nx; x++) {
        const value = source(Object.freeze({gx: dependency.minX + x, gz: dependency.minZ + z, x: xs[x]!, z: zs[z]!}));
        if (!value || typeof value !== 'object') throw Error('terrain region: sample record required');
        const {height, material = 0, excluded = false} = value,
          i = z * width + x;
        heights[i] = finite(height);
        if (!Number.isFinite(heights[i])) throw Error('terrain region: height overflow');
        if (!Number.isSafeInteger(material) || material < 0 || material > 65535 || typeof excluded !== 'boolean')
          throw Error('terrain region: invalid metadata');
        materials[i] = material;
        exclusions[i] = +excluded;
      }
      yield;
    }
    const data: SurfaceWire = {id, revision, spacing, cellsX: nx, cellsZ: nz, xs, zs, heights, materials, exclusions};
    data.normals = yield* normalSlices(data);
    const parent = adoptGeneratedSurface(
      {id, revision, spacing, cellsX: nx, cellsZ: nz, originX: xs[0]!, originZ: zs[0]!},
      data,
      {xs, zs},
    );
    return regionFromSurface({id, lattice, startX, startZ, cellsX, cellsZ}, cropSurface(parent), dependency, extent);
  })();
}
export function createTerrainRegion(
  options: TerrainRegionOptions,
  source: (point: TerrainRegionPoint) => TerrainRegionValue,
): TerrainRegion {
  const slices = terrainRegionSlices(options, source);
  let step = slices.next();
  while (!step.done) step = slices.next();
  return step.value;
}

function regionFromSurface(
  options: TerrainRegionOptions,
  surface: Surface,
  dependency: TerrainRegionExtent,
  extent: TerrainRegionExtent,
): TerrainRegion {
  const region: TerrainRegion = Object.freeze({
    ...options,
    surface,
    dependency,
    extent,
    vertex: surface.vertex,
    mesh(): SurfaceMesh {
      const mesh = surface.mesh(),
        normals: number[] = [];
      for (let z = 0; z <= surface.cellsZ; z++)
        for (let x = 0; x <= surface.cellsX; x++) {
          const n = surface.vertex(x, z).normal;
          normals.push(n.x, n.y, n.z);
        }
      return {...mesh, normals};
    },
    query(x: number, z: number): TerrainRegionQuery {
      const sample = surface.sample(x, z);
      return sample ? Object.freeze({status: 'covered', sample}) : Object.freeze({status: 'outside'});
    },
  });
  regions.add(region);
  return region;
}
export interface TerrainRegionEdit {
  readonly gx: number;
  readonly gz: number;
  readonly height?: number;
  readonly material?: number;
  readonly excluded?: boolean;
}
/** @internal Capture global edits against a fixed dependency domain before any work. */
export function regionEdits(previous: TerrainRegion, edits: readonly TerrainRegionEdit[]) {
  if (!regions.has(previous) || !Array.isArray(edits)) throw Error('terrain region: invalid patch');
  const count = edits.length;
  if (!Number.isSafeInteger(count) || count < 1 || count > 4096) throw Error('terrain region: invalid patch');
  const owned = [];
  for (let i = 0; i < count; i++) {
    const {gx, gz, height, material, excluded} = edits[i]!;
    index(gx);
    index(gz);
    if (
      gx < previous.dependency.minX ||
      gx > previous.dependency.maxX ||
      gz < previous.dependency.minZ ||
      gz > previous.dependency.maxZ
    )
      throw Error('terrain region: edit outside dependency');
    validatePatchValues(height, material, excluded);
    owned.push({x: gx - previous.dependency.minX, z: gz - previous.dependency.minZ, height, material, excluded});
  }
  return owned;
}
/** @internal Build the matching region identity only from its projected canonical patch. */
export function regionPatch(
  previous: TerrainRegion,
  patch: SurfacePatch,
): Readonly<{region: TerrainRegion; patch: SurfacePatch}> {
  if (
    !regions.has(previous) ||
    !isSurfacePatch(patch) ||
    patch.previous !== previous.surface ||
    !surfaceParent(patch.surface)
  )
    throw Error('terrain region: invalid ancestry');
  const lattice = Object.freeze({...previous.lattice, revision: patch.surface.revision});
  const region = regionFromSurface(
    {
      id: previous.id,
      lattice,
      startX: previous.startX,
      startZ: previous.startZ,
      cellsX: previous.cellsX,
      cellsZ: previous.cellsZ,
    },
    patch.surface,
    previous.dependency,
    previous.extent,
  );
  return Object.freeze({region, patch});
}
/** Global edits affect exactly this region's core/halo; caller routes edits to dependent neighbors. */
export function patchTerrainRegion(previous: TerrainRegion, revision: number, edits: readonly TerrainRegionEdit[]) {
  const owned = regionEdits(previous, edits),
    parent = surfaceParent(previous.surface)!;
  return regionPatch(previous, projectSurfacePatch(previous.surface, patchSurface(parent, revision, owned)));
}
/** @internal Detached worker output retains the entire padded sample domain. */
export interface TerrainRegionWire {
  readonly descriptor: TerrainRegionOptions;
  readonly data: SurfaceWire;
}
export function terrainRegionWire(region: TerrainRegion): TerrainRegionWire {
  if (!regions.has(region)) throw Error('terrain region: unknown region');
  return {descriptor: captureTerrainRegion(region), data: surfaceWire(surfaceParent(region.surface)!, true)};
}
/** @internal Registered generator result intake; metadata and global axes are pinned independently. */
export function adoptTerrainRegion(options: TerrainRegionOptions, wire: TerrainRegionWire): TerrainRegion {
  const {id, startX, startZ, cellsX, cellsZ, lattice} = captureTerrainRegion(options);
  const received = captureTerrainRegion(wire.descriptor),
    data = wire.data;
  if (
    received.id !== id ||
    received.startX !== startX ||
    received.startZ !== startZ ||
    received.cellsX !== cellsX ||
    received.cellsZ !== cellsZ ||
    (['id', 'revision', 'baseX', 'baseZ', 'spacing'] as const).some(key => received.lattice[key] !== lattice[key])
  )
    throw Error('terrain region: worker descriptor mismatch');
  const dependency = Object.freeze({
    minX: startX - 1,
    minZ: startZ - 1,
    maxX: startX + cellsX + 1,
    maxZ: startZ + cellsZ + 1,
  });
  const xs = axis(lattice.baseX, lattice.spacing, dependency.minX, cellsX + 2),
    zs = axis(lattice.baseZ, lattice.spacing, dependency.minZ, cellsZ + 2);
  const parent = adoptGeneratedSurface(
    {
      id,
      revision: lattice.revision,
      spacing: lattice.spacing,
      cellsX: cellsX + 2,
      cellsZ: cellsZ + 2,
      originX: xs[0]!,
      originZ: zs[0]!,
    },
    data,
    {xs, zs},
  );
  return regionFromSurface(
    {id, startX, startZ, cellsX, cellsZ, lattice},
    cropSurface(parent),
    dependency,
    Object.freeze({minX: xs[1]!, minZ: zs[1]!, maxX: xs[cellsX + 1]!, maxZ: zs[cellsZ + 1]!}),
  );
}
