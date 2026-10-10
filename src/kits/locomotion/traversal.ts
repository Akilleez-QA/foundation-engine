/**
 * Traversal helpers: ledge detection, ladders and pushable blocks. Pure functions and small state over creator
 * geometry queries, so any collision owner can answer them; the optional volume-query kit's sphere `sweepVolume` can
 * back `cast` through a small adapter (see the README). No entity, clock or physics owner is installed: the
 * caller decides when to grab, climb, push or let go, and applies the returned positions through its own movement.
 */
export type TraversalVec3 = readonly [number, number, number];
/** Sweep a sphere of `radius` from `from` to `to`; `fraction` in [0, 1] of the way, `normal` from the surface. */
export type SphereCast = (
  from: TraversalVec3,
  to: TraversalVec3,
  radius: number,
) => {readonly hit: false} | {readonly hit: true; readonly fraction: number; readonly normal: TraversalVec3};
/** Height of the walkable surface under (x, z) searching down from `fromY` by at most `maxDrop`, or null. */
export type GroundProbe = (x: number, z: number, fromY: number, maxDrop: number) => number | null;

function fail(message: string): never {
  throw new RangeError(`traversal: ${message}`);
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec = (v: unknown, what: string): TraversalVec3 => {
  if (!Array.isArray(v) || v.length !== 3) fail(`${what} must be [x, y, z]`);
  const out: TraversalVec3 = [v[0], v[1], v[2]];
  if (!out.every(finite)) fail(`${what} must be finite`);
  return out;
};
const frozen = (v: readonly number[]): TraversalVec3 => Object.freeze<TraversalVec3>([v[0]!, v[1]!, v[2]!]);
const positive = (v: unknown, max: number, what: string): number => {
  if (!finite(v) || v <= 0 || v > max) fail(`${what} must be within (0, ${max}]`);
  return v;
};
const castOnce = (cast: SphereCast, from: TraversalVec3, to: TraversalVec3, r: number) => {
  const res = cast(from, to, r);
  if (!res || typeof res !== 'object') fail('cast must return a result');
  if (!res.hit) return null;
  const fraction: unknown = res.fraction;
  if (!finite(fraction) || fraction < 0 || fraction > 1) fail('cast fraction must be within [0, 1]');
  const n = vec(res.normal, 'cast normal');
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len < 1e-9) fail('cast normal must be nonzero');
  return {fraction, normal: frozen([n[0] / len, n[1] / len, n[2] / len])};
};

// ------------------------------------------------------------------ ledges

export interface LedgeQuery {
  /** Feet position of the body. */
  readonly position: TraversalVec3;
  /** Horizontal facing (x, z); normalised internally. */
  readonly facing: readonly [number, number];
  /** Body height and radius. */
  readonly height: number;
  readonly radius: number;
  /** How far ahead a wall may be, (0, 100]. */
  readonly reach: number;
  /** Ledge top relative to the feet must be within [minClimb, maxClimb]. */
  readonly minClimb?: number;
  readonly maxClimb: number;
  /** Largest |normal.y| accepted for the wall (default 0.3: near vertical). */
  readonly wallSlope?: number;
  /** Smallest cosine between the facing and the wall's inward normal, [0, 1] (default 0.5: within 60°). */
  readonly minFacing?: number;
}
export type LedgeResult =
  | {
      readonly status: 'ledge';
      /** The point on the ledge edge at the top height, the standing point on top, and the wall's outward normal. */
      readonly edge: TraversalVec3;
      readonly top: TraversalVec3;
      readonly normal: TraversalVec3;
      /** Top height minus feet height. */
      readonly climb: number;
    }
  | {readonly status: 'no-wall' | 'not-a-wall' | 'oblique' | 'no-top' | 'too-low' | 'too-high' | 'no-headroom'};

/**
 * Look for a ledge ahead: a near-vertical wall (or the upper edge of a low one) within `reach` facing the body, a
 * walkable top just past the contact within [minClimb, maxClimb] above the feet, open space from the body over the
 * edge at the top height, and headroom for the whole body on top. Uses five creator queries at most (wall cast, ground
 * probe, a second probe in front of an edge contact, then clearance and headroom casts, or one cast that tells a
 * too-tall wall from a missing top).
 *
 * The wall cast runs at `minClimb + radius + skin` above the feet (at most `height − radius`); walls whose top is at
 * or below `minClimb` read as `no-wall`, and the sphere meeting a lower wall's upper edge counts as the edge when the
 * top is level with the contact and the surface drops in front of it (a ramp reads as `not-a-wall`). Steps past
 * the contact follow the wall normal, not the facing, so oblique approaches find the same edge. Tops must be at least
 * `radius + skin` deep and near flat: a narrower top reads as `no-top`, and a top rising away from the edge can read as
 * `no-headroom`.
 */
export function findLedge(q: LedgeQuery, cast: SphereCast, ground: GroundProbe): LedgeResult {
  if (!q || typeof q !== 'object') fail('query must be an object');
  const p = vec(q.position, 'position');
  const facing: unknown = q.facing;
  if (!Array.isArray(facing) || facing.length !== 2) fail('facing must be [x, z]');
  const fx0: unknown = facing[0],
    fz0: unknown = facing[1];
  if (!finite(fx0) || !finite(fz0) || Math.hypot(fx0, fz0) < 1e-9) fail('facing must be a nonzero direction');
  const fl = Math.hypot(fx0, fz0),
    fx = fx0 / fl,
    fz = fz0 / fl;
  const height = positive(q.height, 100, 'height'),
    radius = positive(q.radius, 10, 'radius'),
    reach = positive(q.reach, 100, 'reach'),
    maxClimb = positive(q.maxClimb, 100, 'maxClimb'),
    minClimb: unknown = q.minClimb ?? 0,
    wallSlope: unknown = q.wallSlope ?? 0.3,
    minFacing: unknown = q.minFacing ?? 0.5;
  if (radius * 2 > height) fail('radius must be at most height / 2');
  if (!finite(minClimb) || minClimb < 0 || minClimb > maxClimb) fail('minClimb must be within [0, maxClimb]');
  if (!finite(wallSlope) || wallSlope < 0 || wallSlope > 1) fail('wallSlope must be within [0, 1]');
  if (!finite(minFacing) || minFacing < 0 || minFacing > 1) fail('minFacing must be within [0, 1]');
  const skin = Math.max(1e-4, radius * 0.05);
  // 1. A wall at the lowest climbable height.
  const castY = p[1] + Math.min(height - radius, minClimb + radius + skin);
  const wall = castOnce(cast, [p[0], castY, p[2]], [p[0] + fx * reach, castY, p[2] + fz * reach], radius);
  if (!wall) return Object.freeze({status: 'no-wall'});
  // The hit's horizontal part. A near-vertical normal is a wall face; an upward normal with a horizontal part is the
  // sphere meeting the upper edge of a wall lower than the cast, which is still a ledge edge. Downward (an overhang),
  // straight-up (a floor) and other steep normals are not walls.
  const [wnx, wny, wnz] = wall.normal;
  const nl = Math.hypot(wnx, wnz);
  const edgeContact = wny > wallSlope;
  if (nl < 1e-6 || (Math.abs(wny) > wallSlope && !edgeContact)) return Object.freeze({status: 'not-a-wall'});
  const nx = wnx / nl,
    nz = wnz / nl;
  // The body must face into the wall (this also rejects back faces).
  if (-(fx * nx + fz * nz) < minFacing) return Object.freeze({status: 'oblique'});
  // Contact point: the sphere centre at the hit minus the normal times the radius (on the face or the edge).
  const dist = wall.fraction * reach;
  const cx = p[0] + fx * dist - wnx * radius,
    cz = p[2] + fz * dist - wnz * radius,
    contactY = castY - wny * radius;
  // 2. The top surface just past the face (radius + skin, along the wall normal), searched down from the highest
  // climbable height.
  const past = radius + skin;
  const tx = cx - nx * past,
    tz = cz - nz * past;
  const topY: unknown = ground(tx, tz, p[1] + maxClimb + radius, maxClimb + radius);
  if (topY === null) return Object.freeze({status: 'no-top'});
  if (!finite(topY)) fail('ground must return a finite height or null');
  if (edgeContact) {
    // An upward contact is a wall's upper edge only when the top is level with it and the surface drops in front of
    // it; otherwise it is a slope (a ramp is walked, not climbed).
    if (Math.abs(topY - contactY) > skin) return Object.freeze({status: 'not-a-wall'});
    const front: unknown = ground(cx + nx * skin, cz + nz * skin, contactY, contactY - p[1] + radius);
    if (front !== null && (!finite(front) || front > contactY - skin)) {
      if (!finite(front)) fail('ground must return a finite height or null');
      return Object.freeze({status: 'not-a-wall'});
    }
  }
  const climb = topY - p[1];
  if (topY < contactY - skin || climb > maxClimb) {
    // The probe missed the wall's top: it found a surface below the contact, or one above maxClimb (which can also be
    // a ceiling the probe started in). Either the wall reaches above the probe start (too high), or the top is
    // narrower than the probe offset or slopes away (no top). A hit ahead at the probe start height that is not
    // ceiling-like (moving into it, normal not pointing down) means the wall continues up there.
    const startY = p[1] + maxClimb + radius;
    // Start backed off from the wall a little, so a body pressed flush against it still sees the wall ahead.
    const bx = p[0] + nx * skin * 2,
      bz = p[2] + nz * skin * 2;
    const above = castOnce(cast, [bx, startY, bz], [tx, startY, tz], radius);
    const wallAbove = above !== null && above.fraction > 0 && above.normal[1] >= -wallSlope;
    return Object.freeze({status: wallAbove ? 'too-high' : 'no-top'});
  }
  if (climb < minClimb) return Object.freeze({status: 'too-low'});
  // 3. Open space from the body over the edge at the top height: if the wall continues above the found top, the probe
  // found something other than the ledge top.
  const overY = topY + radius + skin;
  if (castOnce(cast, [p[0], overY, p[2]], [tx, overY, tz], radius)) return Object.freeze({status: 'too-high'});
  // 4. Headroom: the body stands on top.
  if (castOnce(cast, [tx, overY, tz], [tx, topY + Math.max(height - radius, radius + skin * 2), tz], radius))
    return Object.freeze({status: 'no-headroom'});
  return Object.freeze({
    status: 'ledge',
    edge: frozen([cx, topY, cz]),
    top: frozen([tx, topY, tz]),
    normal: edgeContact ? frozen([nx, 0, nz]) : wall.normal,
    climb,
  });
}

// ------------------------------------------------------------------ ladders

export interface Ladder {
  readonly id: string;
  readonly bottom: TraversalVec3;
  readonly top: TraversalVec3;
  /** Horizontal outward direction (x, z): the side a climber stands on. */
  readonly outward: readonly [number, number];
  /** Distance from the ladder line to the climber's centre, (0, 10]. Default 0.4. */
  readonly offset?: number;
}
export interface LadderGrip {
  readonly ladder: string;
  /** Position along the ladder, [0, 1] bottom to top. */
  readonly t: number;
}

export interface LadderAttachOptions {
  /** Largest horizontal distance from the grip pose, (0, 100]. Default 0.8. */
  readonly maxDistance?: number;
  /** Largest vertical distance between the body and the grip pose, [0, 100]. Default 1. */
  readonly maxVertical?: number;
}

const readPair = (v: unknown, what: string): [number, number] => {
  if (!Array.isArray(v) || v.length !== 2) fail(`${what} must be [x, z]`);
  const a: unknown = v[0],
    b: unknown = v[1];
  if (!finite(a) || !finite(b)) fail(`${what} must be finite`);
  return [a, b];
};

/**
 * Ladders as authored segments. `attach` finds the nearest ladder whose grip pose is within `maxDistance`
 * horizontally and `maxVertical` vertically and whose climbing side the body faces (ties go to list order), `climb`
 * moves along it at `speed` (units per second) by input in [−1, 1] and reports exits at either end, and `pose` gives
 * the body position for a grip. Pure: the caller switches its own movement owner while attached.
 */
export function createLadders(list: readonly Ladder[]) {
  if (!Array.isArray(list) || list.length < 1 || list.length > 1024) fail('1-1,024 ladders');
  const ids = new Set<string>();
  const ladders: {
    id: string;
    bottom: TraversalVec3;
    top: TraversalVec3;
    ox: number;
    oz: number;
    offset: number;
    length: number;
  }[] = [];
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!entry || typeof entry !== 'object') fail(`ladder ${i} must be an object`);
    const id: unknown = entry.id;
    if (typeof id !== 'string' || !id || ids.has(id)) fail('ladder ids must be unique names');
    ids.add(id);
    const bottom = vec(entry.bottom, `${id} bottom`),
      top = vec(entry.top, `${id} top`);
    const length = Math.hypot(top[0] - bottom[0], top[1] - bottom[1], top[2] - bottom[2]);
    if (length < 1e-6 || top[1] <= bottom[1]) fail(`${id}: top must be above bottom`);
    const [ox0, oz0] = readPair(entry.outward, `${id} outward`);
    const ol = Math.hypot(ox0, oz0);
    if (ol < 1e-9) fail(`${id}: outward must be nonzero`);
    const offsetIn: unknown = entry.offset;
    const offset = offsetIn === undefined ? 0.4 : positive(offsetIn, 10, `${id} offset`);
    ladders.push({id, bottom, top, ox: ox0 / ol, oz: oz0 / ol, offset, length});
  }
  const byId = new Map(ladders.map(l => [l.id, l]));
  const at = (l: (typeof ladders)[number], t: number): TraversalVec3 =>
    frozen([
      l.bottom[0] + (l.top[0] - l.bottom[0]) * t + l.ox * l.offset,
      l.bottom[1] + (l.top[1] - l.bottom[1]) * t,
      l.bottom[2] + (l.top[2] - l.bottom[2]) * t + l.oz * l.offset,
    ]);
  const read = (grip: LadderGrip) => {
    if (!grip || typeof grip !== 'object') fail('grip must be an object');
    const name: unknown = grip.ladder,
      t: unknown = grip.t;
    const l = typeof name === 'string' ? byId.get(name) : undefined;
    if (!l) fail(`unknown ladder ${String(name)}`);
    if (!finite(t) || t < 0 || t > 1) fail('grip t must be within [0, 1]');
    return {l, t};
  };
  return {
    /** The nearest ladder the body can grip from here while facing into it, or null. */
    attach(position: TraversalVec3, facing: readonly [number, number], options: LadderAttachOptions = {}) {
      const p = vec(position, 'position');
      const [fx0, fz0] = readPair(facing, 'facing');
      const fl = Math.hypot(fx0, fz0);
      if (fl < 1e-9) fail('facing must be a nonzero direction');
      if (!options || typeof options !== 'object') fail('options must be an object');
      const maxDistance: unknown = options.maxDistance ?? 0.8,
        maxVertical: unknown = options.maxVertical ?? 1;
      if (!finite(maxDistance) || maxDistance <= 0 || maxDistance > 100) fail('maxDistance must be within (0, 100]');
      if (!finite(maxVertical) || maxVertical < 0 || maxVertical > 100) fail('maxVertical must be within [0, 100]');
      const fx = fx0 / fl,
        fz = fz0 / fl;
      let best: LadderGrip | null = null,
        bestD = Infinity;
      for (const l of ladders) {
        // Facing into the ladder means opposite to its outward direction (within 60°).
        if (fx * l.ox + fz * l.oz > -0.5) continue;
        const dx = l.top[0] - l.bottom[0],
          dy = l.top[1] - l.bottom[1],
          dz = l.top[2] - l.bottom[2];
        const t = Math.max(
          0,
          Math.min(
            1,
            ((p[0] - l.bottom[0]) * dx + (p[1] - l.bottom[1]) * dy + (p[2] - l.bottom[2]) * dz) / (l.length * l.length),
          ),
        );
        const g = at(l, t);
        const d = Math.hypot(g[0] - p[0], g[2] - p[2]);
        if (d <= maxDistance && Math.abs(g[1] - p[1]) <= maxVertical && d < bestD) {
          bestD = d;
          best = Object.freeze({ladder: l.id, t});
        }
      }
      return best;
    },
    /** Move along the ladder; `exit` reports leaving at an end (the grip is then clamped at that end). */
    climb(
      grip: LadderGrip,
      input: number,
      speed: number,
      dt: number,
    ): {readonly grip: LadderGrip; readonly exit: 'top' | 'bottom' | null} {
      const {l, t: t0} = read(grip);
      if (!finite(input) || input < -1 || input > 1) fail('input must be within [-1, 1]');
      if (!finite(speed) || speed < 0 || !finite(dt) || dt < 0) fail('speed and dt must be ≥ 0');
      const t = t0 + (input * speed * dt) / l.length;
      const exit = t > 1 ? 'top' : t < 0 ? 'bottom' : null;
      return Object.freeze({grip: Object.freeze({ladder: l.id, t: Math.max(0, Math.min(1, t))}), exit});
    },
    /** Body position for a grip (on the outward side). */
    pose(grip: LadderGrip): TraversalVec3 {
      const {l, t} = read(grip);
      return at(l, t);
    },
    /** Where to stand after leaving at the top: past the top, away from the outward side by `step`, (0, 10]. */
    topExit(grip: LadderGrip, step = 0.5): TraversalVec3 {
      const {l} = read(grip);
      const s = positive(step, 10, 'step');
      return frozen([l.top[0] - l.ox * s, l.top[1], l.top[2] - l.oz * s]);
    },
  };
}

// ------------------------------------------------------------------ pushables

/** Fraction in [0, 1] of `displacement` the box (centre, half extents) can move before touching anything. */
export type BoxSweep = (center: TraversalVec3, half: TraversalVec3, displacement: TraversalVec3) => number;

export interface PushableState {
  readonly position: TraversalVec3;
  /** Horizontal velocity (x, z). */
  readonly velocity: readonly [number, number];
}
/**
 * One step of a pushable block. A horizontal push force (x, z, newtons-like units) accelerates it by force / mass;
 * kinetic friction (`friction`, units per second²) always opposes the motion, so a push weaker than friction × mass
 * never starts it (a static threshold) and a released block slows to rest. Speed is capped by `maxSpeed`, and the move
 * is limited by the creator's `sweep`: each axis is resolved separately, larger displacement first, and a hit stops
 * that axis so the block slides along walls. At dt 0 nothing changes and nothing is swept.
 *
 * With `snap`, each call is one grid push: the block moves to the next grid line strictly ahead (`origin + k × snap`)
 * along the dominant push axis, or stays and reports `blocked`; put `origin` at half a cell to keep blocks centred in
 * cells. The caller edge-triggers grid pushes
 * (one per press or per its own cooldown); `mass`, `friction`, `maxSpeed` and `dt` are unused in that mode.
 */
export function pushStep(
  state: PushableState,
  options: {
    readonly half: TraversalVec3;
    readonly mass: number;
    readonly force: readonly [number, number];
    readonly dt: number;
    readonly sweep: BoxSweep;
    readonly friction?: number;
    readonly maxSpeed?: number;
    /** Cell size for grid pushing, (0, 1e3]. */
    readonly snap?: number;
    /** Grid offset for snap: grid lines sit at `origin + k × snap` on each axis, finite. Default 0. */
    readonly origin?: number;
  },
): {readonly state: PushableState; readonly blocked: boolean} {
  if (!state || typeof state !== 'object') fail('state must be an object');
  if (!options || typeof options !== 'object') fail('options must be an object');
  const pos = vec(state.position, 'position');
  let [vx, vz] = readPair(state.velocity, 'velocity');
  const half = vec(options.half, 'half');
  if (!half.every(h => h > 0)) fail('half extents must be positive');
  const mass = positive(options.mass, 1e6, 'mass'),
    dtIn: unknown = options.dt,
    friction: unknown = options.friction ?? 8,
    maxSpeed: unknown = options.maxSpeed ?? 2,
    snapIn: unknown = options.snap,
    sweepFn = options.sweep,
    originIn: unknown = options.origin ?? 0;
  if (!finite(originIn) || Math.abs(originIn) > 1e9) fail('origin must be finite, |origin| ≤ 1e9');
  if (!finite(dtIn) || dtIn < 0 || dtIn > 1) fail('dt must be within [0, 1]');
  const dt: number = dtIn;
  if (!finite(friction) || friction < 0 || !finite(maxSpeed) || maxSpeed <= 0) fail('friction ≥ 0 and maxSpeed > 0');
  if (typeof sweepFn !== 'function') fail('sweep must be a function');
  const [fx, fz] = readPair(options.force, 'force');
  const frozenHalf = frozen(half);
  const sweep = (center: TraversalVec3, d: TraversalVec3): number => {
    const f: unknown = sweepFn(frozen(center), frozenHalf, frozen(d));
    if (!finite(f) || f < 0 || f > 1) fail('sweep must return a fraction within [0, 1]');
    return f;
  };
  const result = (position: readonly number[], velocity: [number, number], blocked: boolean) =>
    Object.freeze({
      state: Object.freeze({position: frozen(position), velocity: Object.freeze(velocity)}),
      blocked,
    });
  if (snapIn !== undefined) {
    const cell = positive(snapIn, 1e3, 'snap');
    if (fx === 0 && fz === 0) return result(pos, [0, 0], false);
    const axis = Math.abs(fx) >= Math.abs(fz) ? 0 : 2;
    const dir = Math.sign(axis === 0 ? fx : fz);
    // The next grid line strictly ahead in the push direction; a position within rounding of a line counts as on it.
    const u = (pos[axis] - originIn) / cell;
    const k = dir > 0 ? Math.floor(u + 1e-9) + 1 : Math.ceil(u - 1e-9) - 1;
    const target = originIn + k * cell;
    const move = target - pos[axis];
    const d: TraversalVec3 = axis === 0 ? [move, 0, 0] : [0, 0, move];
    if (sweep(pos, d) < 1) return result(pos, [0, 0], true);
    return result([pos[0] + d[0], pos[1], pos[2] + d[2]], [0, 0], false);
  }
  if (dt === 0) return result(pos, [vx, vz], false);
  // Accelerate by the push, then apply kinetic friction against the resulting motion, then cap speed.
  vx += (fx / mass) * dt;
  vz += (fz / mass) * dt;
  const speed = Math.hypot(vx, vz);
  if (speed > 0) {
    const slowed = Math.max(0, speed - friction * dt);
    vx = (vx / speed) * slowed;
    vz = (vz / speed) * slowed;
  }
  const capped = Math.hypot(vx, vz);
  if (capped > maxSpeed) {
    vx = (vx / capped) * maxSpeed;
    vz = (vz / capped) * maxSpeed;
  }
  // Resolve each axis separately, larger displacement first, so a block slides along a wall instead of sticking.
  let blocked = false,
    x = pos[0],
    z = pos[2];
  const order: readonly (0 | 2)[] = Math.abs(vx) >= Math.abs(vz) ? [0, 2] : [2, 0];
  for (const axis of order) {
    const step = (axis === 0 ? vx : vz) * dt;
    if (step === 0) continue;
    const d: TraversalVec3 = axis === 0 ? [step, 0, 0] : [0, 0, step];
    const f = sweep([x, pos[1], z], d);
    if (axis === 0) x += step * f;
    else z += step * f;
    if (f < 1) {
      blocked = true;
      if (axis === 0) vx = 0;
      else vz = 0;
    }
  }
  return result([x, pos[1], z], [vx, vz], blocked);
}
