import {buildSurfaceChunk, type SurfaceChunk, type SurfaceChunkOptions} from './chunk';
import {createResidency} from './residency';
import {surfaceBytes, isSurfacePatch, type Surface, type SurfacePatch} from './surface';
export interface TerrainTile extends SurfaceChunkOptions {
  readonly key: string;
}
export interface TerrainGeneration {
  readonly epoch: number;
  readonly surface: Surface;
  readonly chunks: readonly Readonly<{key: string; chunk: SurfaceChunk}>[];
  /** Conservative payload reservation estimate; not an exact JavaScript heap measurement. */
  readonly bytes: number;
}
const prepared = new WeakSet<TerrainGeneration>();
/** Prepare topology once; step() builds a bounded number of finite tiles per call. */
export function createTerrainGenerationBuilder(
  surface: Surface,
  tiles: readonly TerrainTile[],
  reuse?: {previous: TerrainGeneration; patch: SurfacePatch},
) {
  const layout = tiles.map(tile => ({...tile}));
  if (
    reuse &&
    (!isSurfacePatch(reuse.patch) || reuse.patch.surface !== surface || reuse.patch.previous !== reuse.previous.surface)
  )
    throw Error('terrain generation: invalid patch ancestry');
  if (!layout.length || layout.length > 64) throw Error('terrain generation: expected 1..64 tiles');
  const occupied = new Uint8Array(surface.cellsX * surface.cellsZ),
    keys = new Set<string>();
  for (const tile of layout) {
    if (!tile.key || keys.has(tile.key)) throw Error('terrain generation: duplicate or empty tile key');
    keys.add(tile.key);
    for (const n of [tile.startX, tile.startZ, tile.cellsX, tile.cellsZ])
      if (!Number.isSafeInteger(n) || n < 0) throw Error('terrain generation: invalid tile range');
    if (
      !tile.cellsX ||
      !tile.cellsZ ||
      tile.startX + tile.cellsX > surface.cellsX ||
      tile.startZ + tile.cellsZ > surface.cellsZ
    )
      throw Error('terrain generation: tile outside surface');
    for (let z = tile.startZ; z < tile.startZ + tile.cellsZ; z++)
      for (let x = tile.startX; x < tile.startX + tile.cellsX; x++) {
        const i = z * surface.cellsX + x;
        if (occupied[i]) throw Error('terrain generation: overlapping tiles');
        occupied[i] = 1;
      }
  }
  if (occupied.some(value => value === 0)) throw Error('terrain generation: incomplete coverage');
  const chunks: {key: string; chunk: SurfaceChunk}[] = [];
  let result: TerrainGeneration | undefined,
    cancelled = false;
  return {
    get result() {
      return result;
    },
    cancel() {
      if (!result) {
        cancelled = true;
        chunks.length = 0;
      }
    },
    step(maxChunks: number): number {
      if (!Number.isSafeInteger(maxChunks) || maxChunks < 0 || maxChunks > 64)
        throw Error('terrain generation: invalid build budget');
      if (cancelled || result) return 0;
      let built = 0;
      while (built < maxChunks && chunks.length < layout.length) {
        const tile = layout[chunks.length]!;
        const old = reuse?.previous.chunks.find(c => c.key === tile.key);
        const b = reuse?.patch.dirty === undefined ? reuse?.patch.bounds : reuse.patch.dirty;
        const margin = reuse?.patch.dirty === undefined ? 1 : 0;
        const unaffected =
          b === null ||
          (b &&
            (tile.startX + tile.cellsX < b.minX - margin ||
              tile.startX > b.maxX + margin ||
              tile.startZ + tile.cellsZ < b.minZ - margin ||
              tile.startZ > b.maxZ + margin));
        const sameLayout =
          old &&
          old.chunk.bounds.min.x === surface.vertex(tile.startX, tile.startZ).x &&
          old.chunk.bounds.max.x === surface.vertex(tile.startX + tile.cellsX, tile.startZ).x &&
          old.chunk.bounds.min.z === surface.vertex(tile.startX, tile.startZ).z &&
          old.chunk.bounds.max.z === surface.vertex(tile.startX, tile.startZ + tile.cellsZ).z &&
          old.chunk.stride === tile.stride &&
          (tile.maxError === undefined || old.chunk.maxError <= tile.maxError);
        const chunk = unaffected && sameLayout ? old.chunk : buildSurfaceChunk(surface, tile);
        if (chunk.mesh.normals) Object.freeze(chunk.mesh.normals);
        Object.freeze(chunk.mesh.positions);
        Object.freeze(chunk.mesh.indices);
        Object.freeze(chunk.mesh);
        chunks.push(Object.freeze({key: tile.key, chunk}));
        built++;
      }
      if (chunks.length === layout.length) {
        const bytes =
          surfaceBytes(surface) +
          chunks.reduce(
            (n, c) =>
              n +
              4096 +
              (c.chunk.mesh.positions.length + c.chunk.mesh.indices.length + (c.chunk.mesh.normals?.length ?? 0)) * 16,
            0,
          );
        result = Object.freeze({epoch: surface.revision, surface, chunks: Object.freeze(chunks), bytes});
        prepared.add(result);
      }
      return built;
    },
  };
}
export function prepareTerrainGeneration(surface: Surface, tiles: readonly TerrainTile[]): TerrainGeneration {
  const builder = createTerrainGenerationBuilder(surface, tiles);
  builder.step(tiles.length);
  return builder.result!;
}
/**
 * One canonical/contact + render + navigation epoch, published at a frame boundary.
 * Builds use the existing bounded residency contract and may delegate to WorkerHost.
 */
export function createTerrainOwner(
  initial: TerrainGeneration,
  options: {maxBytes: number; release?(generation: TerrainGeneration): void},
) {
  if (!prepared.has(initial) || !Number.isSafeInteger(options.maxBytes) || options.maxBytes < initial.bytes)
    throw Error('terrain owner: invalid initial generation/budget');
  const maxBytes = options.maxBytes;
  let current = initial,
    wanted = initial.epoch,
    closed = false,
    publishing = false,
    listenerErrors = 0,
    releaseErrors = 0;
  const listeners = new Set<(epoch: number) => void>(),
    retired = new WeakSet<TerrainGeneration>();
  const release = (generation: TerrainGeneration): void => {
    if (retired.has(generation)) return;
    retired.add(generation);
    try {
      options.release?.(generation);
    } catch {
      releaseErrors++;
    }
  };
  // Published values immediately leave admission accounting: current is budgeted
  // separately, and its lifetime is owned here until the next successful swap.
  const residency = createResidency<TerrainGeneration>({requests: 1, resident: 1, bytes: maxBytes}, value => {
    if (value !== current || closed) release(value);
  });
  const ensureIdle = () => {
    if (publishing) throw Error('terrain owner: reentrant publication');
  };
  return {
    get current() {
      return current;
    },
    request(
      epoch: number,
      bytes: number,
      build: (signal: AbortSignal) => Promise<TerrainGeneration>,
    ): 'accepted' | 'stale' | 'saturated' | 'closed' {
      ensureIdle();
      if (closed) return 'closed';
      if (!Number.isSafeInteger(epoch) || epoch < 0 || !Number.isSafeInteger(bytes) || bytes < 1)
        throw Error('terrain owner: invalid request');
      if (epoch <= current.epoch || epoch < wanted) return 'stale';
      if (epoch > wanted) {
        wanted = epoch;
        residency.cancel('generation');
      }
      if (bytes > maxBytes - current.bytes) return 'saturated';
      return residency.request('generation', epoch, bytes, async signal => {
        const value = await build(signal);
        if (
          !prepared.has(value) ||
          value.epoch !== epoch ||
          value.surface.id !== current.surface.id ||
          value.bytes > bytes
        ) {
          // A rejected adapter result can alias the generation still serving contact and render views.
          if (value !== current) release(value);
          throw Error('terrain owner: invalid prepared generation');
        }
        return value;
      });
    },
    /** Adapter must synchronously replace all views, or leave them unchanged and return false. */
    publish(apply: (next: TerrainGeneration, previous: TerrainGeneration) => boolean): boolean {
      ensureIdle();
      if (closed) return false;
      let previous: TerrainGeneration | undefined;
      publishing = true;
      try {
        residency.publish(1, maxBytes, (_key, next) => {
          if (next.epoch !== wanted) return false;
          if (!apply(next, current)) return false;
          previous = current;
          current = next;
          return true;
        });
        if (!previous) return false;
        residency.evict('generation');
      } finally {
        publishing = false;
      }
      // Contact and all render views are installed before invalidating cached routes.
      for (const listener of [...listeners]) {
        try {
          listener(current.epoch);
        } catch {
          listenerErrors++;
        }
      }
      release(previous);
      return true;
    },
    subscribe(listener: (epoch: number) => void): () => void {
      ensureIdle();
      if (closed) throw Error('terrain owner: closed');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel() {
      ensureIdle();
      residency.cancel('generation');
    },
    stats() {
      return {
        ...residency.stats(),
        epoch: current.epoch,
        desiredEpoch: wanted,
        bytes: (closed ? 0 : current.bytes) + residency.stats().bytes,
        listenerErrors,
        ownerReleaseErrors: releaseErrors,
      };
    },
    close() {
      ensureIdle();
      if (closed) return;
      closed = true;
      residency.close();
      listeners.clear();
      release(current);
    },
  };
}
