/**
 * kits/locomotion/platforms: moving support surfaces (MV-02). Pure: no world, no renderer.
 *
 * The creator describes each platform as an axis-aligned footprint whose top-centre pose is a function of simulation
 * time, `path(t)`. `advance(dt)` moves every platform on the fixed lane; the displacement of each tick is the exact
 * difference of two path samples, so an actor carried by it follows the path exactly at any tick rate. Velocity for
 * inheritance is that displacement divided by the tick (the mean velocity over the tick).
 */

export interface PlatformPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export interface PlatformDef {
  /** Footprint half extents in metres, (0, 1000]. The actor's centre must be inside to stand on it. */
  halfX: number;
  halfZ: number;
  /** Top-centre pose at simulation time `t` (seconds since the registry was created or last `restart`). */
  path(t: number): PlatformPose;
}
export interface PlatformsOptions {
  /** Most platforms at once, [1, 1024]. Default 64. */
  maxPlatforms?: number;
  /** Fastest accepted platform motion in m/s, (0, 1000]. Default 100. A faster path throws; declare a jump with `cut`. */
  maxSpeed?: number;
}
export interface PlatformDelta {
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
}

interface Entry {
  readonly def: PlatformDef;
  readonly order: number;
  cut: boolean;
  px: number;
  py: number;
  pz: number;
  x: number;
  y: number;
  z: number;
}
const EPS = 1e-9;
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function finitePose(p: PlatformPose | null | undefined, id: string): PlatformPose {
  if (
    !p ||
    typeof p !== 'object' ||
    ![p.x, p.y, p.z].every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e7)
  ) {
    throw new RangeError(`platforms: ${id} path must return finite x, y, z within ±1e7`);
  }
  return p;
}

/** A bounded registry of moving platforms. All rejected calls throw (or return false) without changing state. */
export function createPlatforms(o: PlatformsOptions = {}) {
  const max = o.maxPlatforms ?? 64,
    maxSpeed = o.maxSpeed ?? 100;
  if (!Number.isSafeInteger(max) || max < 1 || max > 1024)
    throw new RangeError('platforms: maxPlatforms must be an integer within [1, 1024]');
  if (typeof maxSpeed !== 'number' || !Number.isFinite(maxSpeed) || maxSpeed <= 0 || maxSpeed > 1000)
    throw new RangeError('platforms: maxSpeed must be within (0, 1000]');
  const entries = new Map<string, Entry>();
  let t = 0,
    lastDt = 0,
    order = 0;

  const inside = (e: Entry, x: number, z: number) =>
    Math.abs(x - e.x) <= e.def.halfX + EPS && Math.abs(z - e.z) <= e.def.halfZ + EPS;

  return {
    /** Simulation time of the current poses (s). */
    get time() {
      return t;
    },
    get size() {
      return entries.size;
    },
    add(id: string, def: PlatformDef): void {
      if (typeof id !== 'string' || !ID.test(id))
        throw new RangeError('platforms: id must be 1–64 lower-case characters [a-z0-9._-]');
      if (entries.has(id)) throw new RangeError(`platforms: ${id} already exists`);
      if (entries.size >= max) throw new RangeError(`platforms: at most ${max} platforms`);
      if (
        !def ||
        typeof def.path !== 'function' ||
        ![def.halfX, def.halfZ].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1000)
      ) {
        throw new RangeError('platforms: a platform needs halfX and halfZ within (0, 1000] and a path function');
      }
      const p = finitePose(def.path(t), id);
      entries.set(id, {
        def: {halfX: def.halfX, halfZ: def.halfZ, path: def.path},
        order: order++,
        cut: false,
        px: p.x,
        py: p.y,
        pz: p.z,
        x: p.x,
        y: p.y,
        z: p.z,
      });
    },
    /** Remove a platform. Riders lose support on their next tick and keep no velocity from it (a re-added platform
     *  with the same id is a new platform: riders detach rather than jump to it). */
    remove(id: string): boolean {
      return entries.delete(id);
    },
    /**
     * Declare a discontinuity: the next `advance` places this platform at its path pose without motion (no speed
     * check, zero delta). Riders detach with no velocity: they are neither flung nor teleported with it.
     */
    cut(id: string): boolean {
      const e = entries.get(id);
      if (!e) return false;
      e.cut = true;
      return true;
    },
    /**
     * Advance every platform by `dt` seconds, (0, 0.25]. All paths are sampled and checked before any pose changes;
     * a non-finite pose or a speed above `maxSpeed` throws and leaves every platform where it was.
     */
    advance(dt: number): void {
      if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0 || dt > 0.25)
        throw new RangeError('platforms: dt must be within (0, 0.25]');
      const to = t + dt,
        next: [Entry, PlatformPose][] = [];
      for (const [id, e] of entries) {
        const p = finitePose(e.def.path(to), id);
        if (!e.cut && Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z) > maxSpeed * dt + EPS)
          throw new RangeError(`platforms: ${id} moved faster than ${maxSpeed} m/s`);
        next.push([e, p]);
      }
      for (const [e, p] of next) {
        if (e.cut) {
          e.px = p.x;
          e.py = p.y;
          e.pz = p.z;
          e.cut = false;
        } else {
          e.px = e.x;
          e.py = e.y;
          e.pz = e.z;
        }
        e.x = p.x;
        e.y = p.y;
        e.z = p.z;
      }
      t = to;
      lastDt = dt;
    },
    /** Current top-centre pose, or null. */
    pose(id: string): PlatformPose | null {
      const e = entries.get(id);
      return e ? {x: e.x, y: e.y, z: e.z} : null;
    },
    /** Displacement during the last `advance`, or null for an unknown platform. */
    delta(id: string): PlatformDelta | null {
      const e = entries.get(id);
      return e ? {dx: e.x - e.px, dy: e.y - e.py, dz: e.z - e.pz} : null;
    },
    /** Mean velocity over the last `advance` (m/s), zero before the first; null for an unknown platform. */
    velocity(id: string): PlatformDelta | null {
      const e = entries.get(id);
      if (!e) return null;
      return lastDt > 0
        ? {dx: (e.x - e.px) / lastDt, dy: (e.y - e.py) / lastDt, dz: (e.z - e.pz) / lastDt}
        : {dx: 0, dy: 0, dz: 0};
    },
    /**
     * The platform an actor was standing on at the start of the last tick: its previous footprint covered (x, z) and
     * its previous top equals `feet` (within 1e-9 m). Every match has that same top, so the earliest-added one is
     * returned. Null if none.
     */
    standing(x: number, z: number, feet: number): string | null {
      let best: Entry | null = null,
        id: string | null = null;
      for (const [key, e] of entries) {
        if (
          Math.abs(x - e.px) > e.def.halfX + EPS ||
          Math.abs(z - e.pz) > e.def.halfZ + EPS ||
          Math.abs(e.py - feet) > EPS
        )
          continue;
        if (!best || e.order < best.order) {
          best = e;
          id = key;
        }
      }
      return id;
    },
    /** The platform's current top height if (x, z) is on its footprint, else null. */
    supportOn(id: string, x: number, z: number): number | null {
      const e = entries.get(id);
      return e && inside(e, x, z) ? e.y : null;
    },
    /**
     * One-way catch, in each platform's own frame: the highest platform under (x, z) whose top was at or below the
     * actor's highest foot point of the tick at its start (`fromFeet` vs the previous top) and is at or above the
     * actor's feet at its end (`toFeet` vs the current top). A rising platform therefore picks up an actor it
     * overtakes, and an actor rising from below passes through. Ties go to the earlier-added platform.
     */
    catch(x: number, z: number, fromFeet: number, toFeet: number): {id: string; height: number} | null {
      if (![x, z, fromFeet, toFeet].every(Number.isFinite))
        throw new RangeError('platforms: catch needs finite coordinates');
      let best: {id: string; height: number; order: number} | null = null;
      for (const [id, e] of entries) {
        if (!inside(e, x, z) || e.py > fromFeet + EPS || e.y < toFeet - EPS) continue;
        if (!best || e.y > best.height || (e.y === best.height && e.order < best.order))
          best = {id, height: e.y, order: e.order};
      }
      return best && {id: best.id, height: best.height};
    },
    /** Start the timeline again at t = 0 and place every platform there without motion; riders of a platform that
     *  moved detach. Call it when a scene is entered so a `?seed=` replay starts from the same poses. */
    restart(): void {
      const placed: [Entry, PlatformPose][] = [];
      for (const [id, e] of entries) placed.push([e, finitePose(e.def.path(0), id)]);
      for (const [e, p] of placed) {
        e.px = e.x = p.x;
        e.py = e.y = p.y;
        e.pz = e.z = p.z;
        e.cut = false;
      }
      t = 0;
      lastDt = 0;
    },
  };
}
export type Platforms = ReturnType<typeof createPlatforms>;
