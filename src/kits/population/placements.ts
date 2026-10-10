/**
 * Authored placements that become live entities near observers and remember the ones that were destroyed.
 *
 * Pure bookkeeping over the spatial kit's grid. `update(observers)` returns spawn and despawn intents in definition
 * order (bounded per call); the caller creates or removes its own entities. `destroyed(id)` applies the placement's
 * respawn policy; `never` depletion is the only state `snapshot()` persists, for the creator's save section.
 */
import {createQueryResult, createSpatialGrid, type SpatialGrid} from '../spatial/index';

export type RespawnPolicy = 'never' | 'visit' | 'leave';
export interface PlacementInput {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** Creator category that tells its spawner what to create (1-64 characters). */
  readonly kind: string;
  /**
   * After `destroyed`: `never` stays gone across saves; `visit` stays gone for this field's lifetime; `leave`
   * (default) may return once every observer has moved beyond the exit radius and back.
   */
  readonly respawn?: RespawnPolicy;
}
export interface Placement {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly kind: string;
  readonly respawn: RespawnPolicy;
}
export interface PlacementSet {
  readonly id: string;
  readonly placements: readonly Placement[];
  readonly fingerprint: string;
}
export const PLACEMENT_LIMITS = Object.freeze({
  placements: 65536,
  idLength: 256,
  kindLength: 64,
  coordinate: 1e7,
  observers: 8,
  live: 4096,
  spawnsPerUpdate: 1024,
  despawnsPerUpdate: 4096,
});

function fail(message: string): never {
  throw new RangeError(`placements: ${message}`);
}
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length >= 1 && v.length <= max;
const isCoord = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= PLACEMENT_LIMITS.coordinate;
const isCount = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;

function fingerprintOf(text: string): string {
  let a = 0x9e3779b9,
    b = 0x85ebca6b;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** Validate, snapshot and freeze authored placements. Throws `RangeError` before returning anything. */
export function definePlacements(input: {
  readonly id: string;
  readonly placements: readonly PlacementInput[];
}): PlacementSet {
  if (!input || typeof input !== 'object') fail('definition must be an object');
  const id = input.id,
    list = input.placements;
  if (!isText(id, PLACEMENT_LIMITS.idLength)) fail('definition id must be 1-256 characters');
  if (!Array.isArray(list) || list.length < 1 || list.length > PLACEMENT_LIMITS.placements)
    fail(`a definition has 1-${PLACEMENT_LIMITS.placements} placements`);
  const seen = new Set<string>();
  const placements = (list as readonly PlacementInput[]).map(p => {
    if (!p || typeof p !== 'object') fail('a placement must be an object');
    const pid = p.id,
      x = p.x,
      z = p.z,
      kind = p.kind,
      respawn = p.respawn ?? 'leave';
    if (!isText(pid, PLACEMENT_LIMITS.idLength) || seen.has(pid))
      fail('placement ids must be unique, 1-256 characters');
    seen.add(pid);
    if (!isCoord(x) || !isCoord(z)) fail(`placement ${pid}: coordinates must be finite within ±1e7`);
    if (!isText(kind, PLACEMENT_LIMITS.kindLength)) fail(`placement ${pid}: kind must be 1-64 characters`);
    if (respawn !== 'never' && respawn !== 'visit' && respawn !== 'leave')
      fail(`placement ${pid}: respawn is never, visit or leave`);
    return Object.freeze({id: pid, x: x === 0 ? 0 : x, z: z === 0 ? 0 : z, kind, respawn});
  });
  return Object.freeze({
    id,
    placements: Object.freeze(placements),
    fingerprint: fingerprintOf(JSON.stringify({id, placements})),
  });
}

/** Persisted depletion: placement ids with `respawn: 'never'` that were destroyed. */
export interface PlacementState {
  readonly version: 1;
  readonly definition: string;
  readonly fingerprint: string;
  readonly depleted: readonly string[];
}

/** Validate an untrusted snapshot (for a save section's `parse`). Each field is read once. */
export function parsePlacementState(set: PlacementSet, raw: unknown): PlacementState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype)
    fail('state must be a plain object');
  const r = raw as Record<string, unknown>;
  const keys = Object.keys(r).sort();
  if (keys.join() !== 'definition,depleted,fingerprint,version') fail('state has unexpected fields');
  const version = r.version,
    definition = r.definition,
    fingerprint = r.fingerprint,
    depletedIn = r.depleted;
  if (version !== 1) fail('unknown state version');
  if (definition !== set.id || fingerprint !== set.fingerprint) fail('state belongs to another placement set or edit');
  if (!Array.isArray(depletedIn) || depletedIn.length > set.placements.length) fail('state depleted must be an array');
  const ids = [...(depletedIn as unknown[])];
  const index = new Map(set.placements.map((p, i) => [p.id, i]));
  if (new Set(ids).size !== ids.length) fail('state depleted ids must be unique');
  for (const v of ids) {
    const i = typeof v === 'string' ? index.get(v) : undefined;
    if (i === undefined || set.placements[i]!.respawn !== 'never')
      fail(`state depletes ${String(v)}, which is not a never-respawning placement`);
  }
  const depleted = (ids as string[]).sort((a, b) => index.get(a)! - index.get(b)!);
  return Object.freeze({
    version: 1,
    definition: set.id,
    fingerprint: set.fingerprint,
    depleted: Object.freeze(depleted),
  });
}

export interface PlacementFieldLimits {
  /** A dormant placement spawns when an observer is within this distance. */
  readonly enterRadius: number;
  /** A live placement despawns when every observer is beyond this distance (default 1.25 × enter). */
  readonly exitRadius?: number;
  /** Most live placements (default 256, max 4,096). Over the cap, spawns wait and are counted as deferred. */
  readonly maxLive?: number;
  readonly maxSpawnsPerUpdate?: number;
  readonly maxDespawnsPerUpdate?: number;
}
export interface PlacementUpdate {
  /** Create these now (or call `returned(id)` if you cannot), in definition order. */
  readonly spawn: readonly Placement[];
  /** Remove these entities now; they become dormant and may spawn again. */
  readonly despawn: readonly string[];
  /** Spawns or despawns that were due but held back by a cap; they are reconsidered on the next update. */
  readonly deferred: number;
}
export type PlacementStatus = 'dormant' | 'live' | 'depleted' | 'gone-for-visit' | 'waiting-to-leave';

const DORMANT = 0,
  LIVE = 1,
  DEPLETED = 2,
  GONE = 3,
  WAITING = 4;
const NAMES: readonly PlacementStatus[] = ['dormant', 'live', 'depleted', 'gone-for-visit', 'waiting-to-leave'];

/** One visit's live/dormant bookkeeping for a placement set. `restored` brings back persisted depletion. */
export function createPlacementField(
  set: PlacementSet,
  limits: PlacementFieldLimits,
  restored?: PlacementState | null,
) {
  if (!set || typeof set.fingerprint !== 'string') fail('use definePlacements for the set');
  const enter = limits.enterRadius,
    exit = limits.exitRadius ?? enter * 1.25,
    maxLive = limits.maxLive ?? 256,
    maxSpawns = limits.maxSpawnsPerUpdate ?? 16,
    maxDespawns = limits.maxDespawnsPerUpdate ?? 64;
  if (!(typeof enter === 'number' && Number.isFinite(enter) && enter > 0 && enter <= 1e6))
    fail('enterRadius must be within (0, 1e6]');
  if (!(typeof exit === 'number' && Number.isFinite(exit) && exit >= enter && exit <= 1e6))
    fail('exitRadius must be within [enterRadius, 1e6]');
  if (!isCount(maxLive, 1, PLACEMENT_LIMITS.live)) fail(`maxLive must be an integer in [1, ${PLACEMENT_LIMITS.live}]`);
  if (!isCount(maxSpawns, 1, PLACEMENT_LIMITS.spawnsPerUpdate))
    fail(`maxSpawnsPerUpdate must be an integer in [1, ${PLACEMENT_LIMITS.spawnsPerUpdate}]`);
  if (!isCount(maxDespawns, 1, PLACEMENT_LIMITS.despawnsPerUpdate))
    fail(`maxDespawnsPerUpdate must be an integer in [1, ${PLACEMENT_LIMITS.despawnsPerUpdate}]`);
  const n = set.placements.length;
  const index = new Map(set.placements.map((p, i) => [p.id, i]));
  const status = new Uint8Array(n);
  if (restored) for (const id of parsePlacementState(set, restored).depleted) status[index.get(id)!] = DEPLETED;
  // The grid covers the placements; observers anywhere are accepted (queries simply find nothing).
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  for (const p of set.placements) {
    minX = Math.min(minX, p.x);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxZ = Math.max(maxZ, p.z);
  }
  // Pad so a single row or column of placements still forms a valid rectangle.
  const pad = Math.max(1, enter);
  minX -= pad;
  minZ -= pad;
  maxX += pad;
  maxZ += pad;
  const span = Math.max(maxX - minX, maxZ - minZ);
  // Cell size: at least the enter radius, and coarse enough to stay within the grid's cell ceiling.
  const cellSize = Math.max(enter, span / 2000);
  const columns = Math.floor((maxX - minX) / cellSize) + 1,
    rows = Math.floor((maxZ - minZ) / cellSize) + 1;
  const grid: SpatialGrid = createSpatialGrid({
    cellSize,
    minX,
    minY: minZ,
    maxX,
    maxY: maxZ,
    maxEntries: n,
    maxCells: columns * rows,
    maxCellsPerQuery: (Math.ceil((2 * enter) / cellSize) + 2) ** 2,
  });
  set.placements.forEach((p, i) => {
    if (grid.insert(i, p.x, p.z) !== 'inserted') fail('internal grid admission failed');
  });
  const found = new Float64Array(n),
    result = createQueryResult(),
    live = new Set<number>(),
    waiting = new Set<number>();
  let closed = false;
  const near = (i: number, observers: readonly {x: number; z: number}[], r: number) => {
    const p = set.placements[i]!;
    return observers.some(o => (o.x - p.x) ** 2 + (o.z - p.z) ** 2 <= r * r);
  };
  const at = (id: string) => {
    const i = index.get(id);
    if (i === undefined) fail(`unknown placement ${String(id)}`);
    return i;
  };
  return {
    set,
    /**
     * Despawn live placements no observer is within the exit radius of, release `leave` placements once every
     * observer is beyond it, then spawn dormant placements within the enter radius of an observer. Bounded per call.
     */
    update(observersIn: readonly {readonly x: number; readonly z: number}[]): PlacementUpdate {
      if (closed) fail('field is disposed');
      if (!Array.isArray(observersIn) || observersIn.length > PLACEMENT_LIMITS.observers)
        fail(`at most ${PLACEMENT_LIMITS.observers} observers`);
      const observers = observersIn.map(o => {
        const x = o?.x,
          z = o?.z;
        if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z))
          fail('observer coordinates must be finite');
        return {x, z};
      });
      let deferred = 0;
      const despawn: string[] = [];
      for (const i of [...live].sort((a, b) => a - b)) {
        if (near(i, observers, exit)) continue;
        if (despawn.length >= maxDespawns) {
          deferred++;
          continue;
        }
        live.delete(i);
        status[i] = DORMANT;
        despawn.push(set.placements[i]!.id);
      }
      for (const i of [...waiting]) {
        if (near(i, observers, exit)) continue;
        waiting.delete(i);
        status[i] = DORMANT;
      }
      const candidates = new Set<number>();
      for (const o of observers) {
        const r = grid.queryCircle(o.x, o.z, enter, found, result);
        if (r.status !== 'complete') fail(`internal grid query ${r.status}`);
        for (let k = 0; k < r.count; k++) {
          const i = found[k]!;
          if (status[i] === DORMANT) candidates.add(i);
        }
      }
      const spawn: Placement[] = [];
      for (const i of [...candidates].sort((a, b) => a - b)) {
        if (spawn.length >= maxSpawns || live.size >= maxLive) {
          deferred++;
          continue;
        }
        live.add(i);
        status[i] = LIVE;
        spawn.push(set.placements[i]!);
      }
      return Object.freeze({spawn: Object.freeze(spawn), despawn: Object.freeze(despawn), deferred});
    },
    /** The caller's entity for a live placement was destroyed by play. Applies the placement's respawn policy. */
    destroyed(id: string): 'depleted' | 'gone-for-visit' | 'waiting-to-leave' | 'not-live' {
      const i = at(id);
      if (closed || status[i] !== LIVE) return 'not-live';
      live.delete(i);
      const policy = set.placements[i]!.respawn;
      if (policy === 'never') status[i] = DEPLETED;
      else if (policy === 'visit') status[i] = GONE;
      else {
        status[i] = WAITING;
        waiting.add(i);
      }
      return NAMES[status[i]!] as 'depleted' | 'gone-for-visit' | 'waiting-to-leave';
    },
    /** The caller could not (or no longer wants to) keep this live placement; it becomes dormant again. */
    returned(id: string): 'dormant' | 'not-live' {
      const i = at(id);
      if (closed || status[i] !== LIVE) return 'not-live';
      live.delete(i);
      status[i] = DORMANT;
      return 'dormant';
    },
    /** Creator reset of a depleted or gone placement (a new game, a reset scope); it becomes dormant. */
    revive(id: string): 'dormant' | 'not-gone' {
      const i = at(id);
      const s = status[i]!;
      if (closed || (s !== DEPLETED && s !== GONE && s !== WAITING)) return 'not-gone';
      waiting.delete(i);
      status[i] = DORMANT;
      return 'dormant';
    },
    status(id: string): PlacementStatus {
      return NAMES[status[at(id)]!]!;
    },
    /** Live placement ids in definition order. */
    live(): readonly string[] {
      return Object.freeze([...live].sort((a, b) => a - b).map(i => set.placements[i]!.id));
    },
    snapshot(): PlacementState {
      const depleted: string[] = [];
      for (let i = 0; i < n; i++) if (status[i] === DEPLETED) depleted.push(set.placements[i]!.id);
      return parsePlacementState(set, {version: 1, definition: set.id, fingerprint: set.fingerprint, depleted});
    },
    /** Terminal; later updates throw and other calls report nothing live. */
    dispose(): void {
      if (closed) return;
      closed = true;
      live.clear();
      waiting.clear();
      grid.dispose();
    },
  };
}
export type PlacementField = ReturnType<typeof createPlacementField>;
