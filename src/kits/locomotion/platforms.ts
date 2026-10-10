/**
 * kits/locomotion/platforms: moving support surfaces (MV-02). Pure: no world, no renderer.
 *
 * The creator describes each platform as an axis-aligned footprint whose top-centre pose is a function of simulation
 * time, `path(t)`. `advance(dt)` moves every platform on the fixed lane; the displacement of each tick is the exact
 * difference of two path samples, so an actor carried by it follows the path exactly at any tick rate. Velocity for
 * inheritance is that displacement divided by the tick (the mean velocity over the tick).
 *
 * A platform whose path also returns `yaw` turns about the vertical axis through its top-centre pose (the pivot). Its
 * footprint is then an oriented rectangle, and a point riding it is carried rigidly: rotated about the previous pivot
 * by the tick's yaw change and moved with the pivot (`carry`). Paths that return no yaw behave exactly as before.
 */

export interface PlatformPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /**
   * Optional turn about the vertical axis in radians, within ±1e6, with the same sense as `Transform.ry`. A path either
   * always returns it (a turning platform) or never does (absent means 0 and every result keeps its unturned shape).
   * It may be wrapped (for example into (−π, π]): each tick uses the shortest turn between consecutive samples.
   */
  readonly yaw?: number;
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
  maxSpeed?: number | undefined;
  /**
   * Fastest accepted turn in rad/s, (0, 1000]. Default 2π (one turn a second). A faster turn throws, and so does an
   * `advance(dt)` with `maxTurnRate · dt ≥ π` while a turning platform exists, because a half turn or more per tick is
   * ambiguous between samples.
   */
  maxTurnRate?: number | undefined;
}
export interface PlatformDelta {
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  /**
   * Turning platforms only: from `delta`, the tick's shortest turn in rad (within [−π, π)); from `velocity`, that turn
   * divided by the tick, in rad/s (bounded by `maxTurnRate`).
   */
  readonly dyaw?: number;
}
/** How a point rigidly attached to a platform moved during the last `advance`. */
export interface PlatformCarry {
  /** Displacement (m) and yaw change (rad, 0 for an unturned platform). */
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly dyaw: number;
  /** Mean velocity over the tick (m/s): the displacement divided by the tick, zero before the first `advance`. */
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
}

interface Entry {
  readonly def: PlatformDef;
  readonly order: number;
  /** Whether the path returns yaw (fixed when added). */
  readonly turning: boolean;
  cut: boolean;
  px: number;
  py: number;
  pz: number;
  pyaw: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}
interface Sample {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Whether the sample carried a yaw (read once). */
  turning: boolean;
}
const EPS = 1e-9;
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const TAU = 2 * Math.PI;

/**
 * The shortest turn equivalent to `a` radians, in [−π, π) up to rounding (π maps to −π). Exact (returns `a`) when
 * |a| < π. Domain: finite |a| ≤ 1e9 (beyond it a turn is below the input's own precision); anything else throws.
 */
export function wrapYaw(a: number): number {
  if (typeof a !== 'number' || !Number.isFinite(a) || Math.abs(a) > 1e9)
    throw new RangeError('platforms: wrapYaw needs a finite angle within ±1e9');
  return a - TAU * Math.round(a / TAU);
}

/**
 * Read one path sample: every field is read exactly once into locals, so a getter-backed pose cannot change between
 * validation and use. `turning` (when known) requires yaw to be present or absent consistently.
 */
function sample(p: PlatformPose | null | undefined, id: string, turning?: boolean): Sample {
  if (!p || typeof p !== 'object') throw new RangeError(`platforms: ${id} path must return finite x, y, z within ±1e7`);
  const x = p.x,
    y = p.y,
    z = p.z,
    yaw = p.yaw;
  if (![x, y, z].every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e7))
    throw new RangeError(`platforms: ${id} path must return finite x, y, z within ±1e7`);
  if (yaw !== undefined && (typeof yaw !== 'number' || !Number.isFinite(yaw) || Math.abs(yaw) > 1e6))
    throw new RangeError(`platforms: ${id} path yaw must be finite within ±1e6`);
  if (turning !== undefined && turning !== (yaw !== undefined))
    throw new RangeError(`platforms: ${id} path must return yaw on every sample or on none`);
  return {x, y, z, yaw: yaw ?? 0, turning: yaw !== undefined};
}

/**
 * Whether (x, z) is on a footprint centred at (cx, cz) and turned by `yaw`. An unturned footprint uses the
 * axis-aligned test directly; a turned one maps the point into the footprint's own axes first.
 */
function onFootprint(def: PlatformDef, cx: number, cz: number, yaw: number, x: number, z: number): boolean {
  let ox = x - cx,
    oz = z - cz;
  if (yaw !== 0) {
    const c = Math.cos(yaw),
      s = Math.sin(yaw),
      lx = c * ox - s * oz;
    oz = s * ox + c * oz;
    ox = lx;
  }
  return Math.abs(ox) <= def.halfX + EPS && Math.abs(oz) <= def.halfZ + EPS;
}

/**
 * Displacement of a point at offset (ox, oz) from a pivot that moved by (dx, dz) and turned by `dyaw`: the pivot's
 * motion plus (R(dyaw) − I)·offset, with R the `Transform.ry` rotation. cos − 1 is formed as −2·sin²(dyaw/2) so small
 * turns keep full precision. Exactly (dx, dz) when dyaw is 0.
 */
function carried(dx: number, dz: number, dyaw: number, ox: number, oz: number): [number, number] {
  if (dyaw === 0) return [dx, dz];
  const h = Math.sin(dyaw / 2),
    k = -2 * h * h,
    s = Math.sin(dyaw);
  return [dx + (k * ox + s * oz), dz + (k * oz - s * ox)];
}

/** A bounded registry of moving platforms. All rejected calls throw (or return false) without changing state. */
export function createPlatforms(o: PlatformsOptions = {}) {
  const max = o.maxPlatforms ?? 64,
    maxSpeed = o.maxSpeed ?? 100,
    maxTurnRate = o.maxTurnRate ?? TAU;
  if (!Number.isSafeInteger(max) || max < 1 || max > 1024)
    throw new RangeError('platforms: maxPlatforms must be an integer within [1, 1024]');
  if (typeof maxSpeed !== 'number' || !Number.isFinite(maxSpeed) || maxSpeed <= 0 || maxSpeed > 1000)
    throw new RangeError('platforms: maxSpeed must be within (0, 1000]');
  if (typeof maxTurnRate !== 'number' || !Number.isFinite(maxTurnRate) || maxTurnRate <= 0 || maxTurnRate > 1000)
    throw new RangeError('platforms: maxTurnRate must be within (0, 1000]');
  const entries = new Map<string, Entry>();
  let t = 0,
    lastDt = 0,
    order = 0;

  const inside = (e: Entry, x: number, z: number) => onFootprint(e.def, e.x, e.z, e.yaw, x, z);
  /** The tick's yaw change of an entry: the shortest turn between its two samples. */
  const turn = (e: Entry) => (e.turning ? wrapYaw(e.yaw - e.pyaw) : 0);

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
      const p = sample(def.path(t), id);
      entries.set(id, {
        def: {halfX: def.halfX, halfZ: def.halfZ, path: def.path},
        order: order++,
        turning: p.turning,
        cut: false,
        px: p.x,
        py: p.y,
        pz: p.z,
        pyaw: p.yaw,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
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
     * a non-finite pose, a speed above `maxSpeed` or a turn above `maxTurnRate` throws and leaves every platform
     * where it was. For a turning platform the speed checked is that of its fastest footprint corner (pivot motion
     * plus the corner's chord), which bounds the carry of every point on it.
     */
    advance(dt: number): void {
      if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0 || dt > 0.25)
        throw new RangeError('platforms: dt must be within (0, 0.25]');
      const to = t + dt,
        next: [Entry, Sample][] = [];
      for (const [id, e] of entries) {
        const p = sample(e.def.path(to), id, e.turning);
        if (!e.cut && e.turning) {
          if (maxTurnRate * dt >= Math.PI)
            throw new RangeError(
              `platforms: dt ${dt} is too long for maxTurnRate ${maxTurnRate}: a half turn per tick is ambiguous; ` +
                `lower maxTurnRate below ${(Math.PI / dt).toFixed(3)} rad/s or use a shorter fixed step`,
            );
          const dyaw = wrapYaw(p.yaw - e.yaw);
          if (Math.abs(dyaw) > maxTurnRate * dt + EPS)
            throw new RangeError(`platforms: ${id} turned faster than ${maxTurnRate} rad/s`);
          const c = Math.cos(e.yaw),
            s = Math.sin(e.yaw);
          for (const [hx, hz] of [
            [e.def.halfX, e.def.halfZ],
            [e.def.halfX, -e.def.halfZ],
          ] as const)
            for (const sign of [1, -1]) {
              // The corner's offset from the previous pivot, turned by the previous yaw.
              const ox = sign * (c * hx + s * hz),
                oz = sign * (-s * hx + c * hz),
                [dx, dz] = carried(p.x - e.x, p.z - e.z, dyaw, ox, oz);
              if (Math.hypot(dx, p.y - e.y, dz) > maxSpeed * dt + EPS)
                throw new RangeError(`platforms: ${id} moved faster than ${maxSpeed} m/s at a footprint corner`);
            }
        } else if (!e.cut && Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z) > maxSpeed * dt + EPS)
          throw new RangeError(`platforms: ${id} moved faster than ${maxSpeed} m/s`);
        next.push([e, p]);
      }
      for (const [e, p] of next) {
        if (e.cut) {
          e.px = p.x;
          e.py = p.y;
          e.pz = p.z;
          e.pyaw = p.yaw;
          e.cut = false;
        } else {
          e.px = e.x;
          e.py = e.y;
          e.pz = e.z;
          e.pyaw = e.yaw;
        }
        e.x = p.x;
        e.y = p.y;
        e.z = p.z;
        e.yaw = p.yaw;
      }
      t = to;
      lastDt = dt;
    },
    /** Current top-centre pose (the pivot), with `yaw` for a turning platform, or null. */
    pose(id: string): PlatformPose | null {
      const e = entries.get(id);
      if (!e) return null;
      return e.turning ? {x: e.x, y: e.y, z: e.z, yaw: e.yaw} : {x: e.x, y: e.y, z: e.z};
    },
    /** Pivot displacement during the last `advance` (with `dyaw` for a turning platform), or null if unknown. */
    delta(id: string): PlatformDelta | null {
      const e = entries.get(id);
      if (!e) return null;
      const d = {dx: e.x - e.px, dy: e.y - e.py, dz: e.z - e.pz};
      return e.turning ? {...d, dyaw: turn(e)} : d;
    },
    /** Mean pivot velocity over the last `advance` (m/s; `dyaw` in rad/s), zero before the first; null if unknown. */
    velocity(id: string): PlatformDelta | null {
      const e = entries.get(id);
      if (!e) return null;
      const v =
        lastDt > 0
          ? {dx: (e.x - e.px) / lastDt, dy: (e.y - e.py) / lastDt, dz: (e.z - e.pz) / lastDt}
          : {dx: 0, dy: 0, dz: 0};
      return e.turning ? {...v, dyaw: lastDt > 0 ? turn(e) / lastDt : 0} : v;
    },
    /**
     * How a point rigidly attached to the platform, at (x, z) at the start of the last `advance`, moved during it:
     * rotated about the previous pivot by the tick's yaw change and moved with the pivot. Computed from the two path
     * samples only (no accumulated state), so it is exact for each tick. Its mean velocity includes the tangential
     * part (ω × r as a chord over the tick, consistent with the pivot's mean velocity). For an unturned platform it
     * equals `delta` and `velocity` exactly. Null for an unknown platform.
     */
    carry(id: string, x: number, z: number): PlatformCarry | null {
      if (!Number.isFinite(x) || !Number.isFinite(z)) throw new RangeError('platforms: carry needs finite coordinates');
      const e = entries.get(id);
      if (!e) return null;
      const dyaw = turn(e),
        dy = e.y - e.py,
        [dx, dz] = carried(e.x - e.px, e.z - e.pz, dyaw, x - e.px, z - e.pz);
      return lastDt > 0
        ? {dx, dy, dz, dyaw, vx: dx / lastDt, vy: dy / lastDt, vz: dz / lastDt}
        : {dx, dy, dz, dyaw, vx: 0, vy: 0, vz: 0};
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
        if (!onFootprint(e.def, e.px, e.pz, e.pyaw, x, z) || Math.abs(e.py - feet) > EPS) continue;
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
      const placed: [Entry, Sample][] = [];
      for (const [id, e] of entries) placed.push([e, sample(e.def.path(0), id, e.turning)]);
      for (const [e, p] of placed) {
        e.px = e.x = p.x;
        e.py = e.y = p.y;
        e.pz = e.z = p.z;
        e.pyaw = e.yaw = p.yaw;
        e.cut = false;
      }
      t = 0;
      lastDt = 0;
    },
  };
}
export type Platforms = ReturnType<typeof createPlatforms>;
