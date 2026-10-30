/**
 * More director rigs (mostly planar framing, hence the file name): a look-ahead focus with speed-matched catch-up,
 * area-locked framing with pan transitions between areas, and camera bounds that ease toward new limits instead of snapping. Pure, stateful helpers that produce focus
 * points, poses or clamps for a creator's rig function (see `cameraDirectorSystem`); they own no clock or entity.
 */
import type {Vec3} from '../../author';
import type {CameraPose} from './director';

function fail(message: string): never {
  throw new RangeError(`camera rigs: ${message}`);
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const positive = (v: unknown, max: number): v is number => finite(v) && v > 0 && v <= max;
const vec = (v: unknown, what: string): Vec3 => {
  if (!Array.isArray(v) || v.length !== 3) fail(`${what} must be [x, y, z]`);
  const out: Vec3 = [v[0], v[1], v[2]];
  if (!out.every(finite)) fail(`${what} must be finite`);
  return out;
};
const frozen = (v: Vec3): Vec3 => Object.freeze<Vec3>([v[0], v[1], v[2]]) as Vec3;

/**
 * Look-ahead focus: the camera looks at the subject plus a lead in its direction of travel (horizontal velocity, x/z),
 * up to `maxLead`, growing with speed (`lead` seconds of travel). The focus is a world point that moves toward that goal
 * at no more than the subject's speed plus `catchUp` (units per second): leading builds up at `catchUp`, a stop does
 * not snap the view back, and a turn swings the focus across at that bounded world speed. The focus never trails the
 * subject by more than `maxLead`.
 */
export function createLookAhead(
  options: {
    /** Seconds of travel to lead by, (0, 10]. Default 0.5. */
    readonly lead?: number;
    /** Largest lead distance, (0, 1e4]. Default 3. */
    readonly maxLead?: number;
    /** Extra focus speed above the subject's, (0, 1e4] units per second. Default 4. */
    readonly catchUp?: number;
  } = {},
) {
  if (!options || typeof options !== 'object') fail('options must be an object');
  const lead = options.lead ?? 0.5,
    maxLead = options.maxLead ?? 3,
    catchUp = options.catchUp ?? 4;
  if (!positive(lead, 10)) fail('lead must be within (0, 10] seconds');
  if (!positive(maxLead, 1e4)) fail('maxLead must be within (0, 1e4]');
  if (!positive(catchUp, 1e4)) fail('catchUp must be within (0, 1e4]');
  // The focus is a world point chasing subject + lead, at most (subject speed + catchUp) per second, so leading
  // gains on the subject at catchUp and a stop or turn swings the view at a bounded world speed.
  let focus: [number, number] | null = null,
    offset: [number, number] = [0, 0];
  return {
    /** Advance by `dt` seconds for a subject at `position` moving at `velocity`; returns the focus point. */
    step(dt: number, position: Vec3, velocity: Vec3): Vec3 {
      if (!finite(dt) || dt < 0 || dt > 10) fail('dt must be within [0, 10] seconds');
      const p = vec(position, 'position'),
        v = vec(velocity, 'velocity');
      const speed = Math.hypot(v[0], v[2]);
      if (!Number.isFinite(speed)) fail('velocity is too large');
      const scale = speed > 0 ? Math.min(maxLead, speed * lead) / speed : 0;
      const goal: [number, number] = [p[0] + v[0] * scale, p[2] + v[2] * scale];
      if (!focus) focus = [p[0], p[2]];
      const dx = goal[0] - focus[0],
        dz = goal[1] - focus[1],
        gap = Math.hypot(dx, dz),
        reach = (speed + catchUp) * dt;
      focus =
        gap <= reach || !Number.isFinite(gap) ? goal : [focus[0] + (dx / gap) * reach, focus[1] + (dz / gap) * reach];
      // Never trail the subject by more than maxLead (for example after a teleport the chase starts from the subject).
      const ox = focus[0] - p[0],
        oz = focus[1] - p[2],
        o = Math.hypot(ox, oz);
      if (o > maxLead) focus = [p[0] + (ox / o) * maxLead, p[2] + (oz / o) * maxLead];
      offset = [focus[0] - p[0], focus[1] - p[2]];
      return frozen([focus[0], p[1], focus[1]]);
    },
    /** Current lead offset (x, z). */
    get offset(): readonly [number, number] {
      return Object.freeze([offset[0], offset[1]] as [number, number]);
    },
    /** Drop the lead (for example after a teleport). */
    reset(): void {
      focus = null;
      offset = [0, 0];
    },
  };
}

export interface CameraArea {
  readonly id: string;
  /** Horizontal rectangle [minX, minZ, maxX, maxZ] the subject must be inside. */
  readonly area: readonly [number, number, number, number];
  /** The framing for this area (often fixed, looking at its centre). */
  readonly pose: CameraPose;
}

/**
 * Area-locked framing: the camera holds the pose of the area (a horizontal rectangle) containing the subject. Entering
 * another area starts a pan from the pose on screen to the new one with smoothstep; it reaches the new pose on the
 * `panTicks`-th step, so `panning` is true for `panTicks − 1` steps (0 and 1 both cut). Areas are checked in order and
 * overlaps keep the current one. Before any step, and when the first step is outside every area, the first area is
 * used; later, outside every area the last one is kept.
 */
export function createAreaCamera(input: {readonly areas: readonly CameraArea[]; readonly panTicks?: number}) {
  if (!input || typeof input !== 'object') fail('input must be an object');
  const list = input.areas,
    panTicks = input.panTicks ?? 30;
  if (!Array.isArray(list) || list.length < 1 || list.length > 1024) fail('1-1,024 areas');
  if (!Number.isSafeInteger(panTicks) || panTicks < 0 || panTicks > 10_000)
    fail('panTicks must be an integer in [0, 10,000]');
  const ids = new Set<string>();
  const areas: {id: string; area: [number, number, number, number]; pose: CameraPose}[] = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r || typeof r !== 'object') fail(`area ${i} must be an object`);
    const id: unknown = r.id,
      areaIn: unknown = r.area,
      poseIn = r.pose;
    if (typeof id !== 'string' || !id || ids.has(id)) fail('area ids must be unique names');
    ids.add(id);
    if (!Array.isArray(areaIn) || areaIn.length !== 4) fail(`${id}: area is [minX, minZ, maxX, maxZ]`);
    const area = [areaIn[0], areaIn[1], areaIn[2], areaIn[3]] as [number, number, number, number];
    if (!area.every(finite) || area[0] > area[2] || area[1] > area[3]) fail(`${id}: area must be finite and ordered`);
    if (!poseIn || typeof poseIn !== 'object') fail(`${id}: pose is required`);
    const fov: unknown = poseIn.fov;
    if (!finite(fov) || fov <= 1 || fov >= 170) fail(`${id}: fov must be within (1, 170)`);
    const pose: CameraPose = Object.freeze({
      position: frozen(vec(poseIn.position, `${id} position`)),
      target: frozen(vec(poseIn.target, `${id} target`)),
      fov,
    });
    areas.push({id, area, pose});
  }
  type Area = (typeof areas)[number];
  const contains = (r: Area, x: number, z: number) =>
    x >= r.area[0] && x <= r.area[2] && z >= r.area[1] && z <= r.area[3];
  let current: Area | null = null,
    from: CameraPose | null = null,
    elapsed = 0;
  const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  const poseNow = (): CameraPose => {
    const area = current ?? areas[0]!;
    if (!from || panTicks === 0) return area.pose;
    const t0 = Math.min(1, elapsed / panTicks),
      t = t0 * t0 * (3 - 2 * t0);
    return Object.freeze({
      position: frozen(mix(from.position, area.pose.position, t)),
      target: frozen(mix(from.target, area.pose.target, t)),
      fov: from.fov + (area.pose.fov - from.fov) * t,
    });
  };
  return {
    /** Advance one tick for a subject at `position`; returns the pose, the area and whether a pan is running. */
    step(position: Vec3): {readonly pose: CameraPose; readonly area: string; readonly panning: boolean} {
      const p = vec(position, 'position');
      if (!current || !contains(current, p[0], p[2])) {
        const next = areas.find(r => contains(r, p[0], p[2])) ?? current ?? areas[0]!;
        if (current && next !== current) {
          // Start from what is on screen, even mid-pan.
          from = poseNow();
          elapsed = 0;
        }
        current = next;
      }
      if (from) elapsed++;
      if (from && elapsed >= panTicks) from = null;
      const pose = poseNow();
      return Object.freeze({pose, area: current.id, panning: from !== null});
    },
    /** The pose for the current tick (without advancing). */
    get pose(): CameraPose {
      return poseNow();
    },
  };
}

/**
 * Bounds that ease: camera limits [minX, minY, minZ, maxX, maxY, maxZ] move toward newly set limits at `rate` units per
 * second per edge (`fastRate` while `fast` is passed, for example when the subject is airborne or falling), so a new
 * arena or area never snaps the view. `clamp(point)` keeps a camera position or focus inside the current limits.
 */
export function createEasedBounds(
  initial: readonly number[],
  options: {readonly rate?: number; readonly fastRate?: number} = {},
) {
  const rate = options.rate ?? 4,
    fastRate = options.fastRate ?? 16;
  if (!positive(rate, 1e6) || !positive(fastRate, 1e6)) fail('rates must be within (0, 1e6]');
  const check = (b: unknown, what: string): number[] => {
    if (!Array.isArray(b) || b.length !== 6) fail(`${what} is [minX, minY, minZ, maxX, maxY, maxZ]`);
    const out = [b[0], b[1], b[2], b[3], b[4], b[5]] as number[];
    if (!out.every(finite) || out[0]! > out[3]! || out[1]! > out[4]! || out[2]! > out[5]!)
      fail(`${what} must be finite with min ≤ max`);
    return out;
  };
  let current = check(initial, 'initial bounds'),
    target = current.slice();
  return {
    /** Set new limits to ease toward; `snap` jumps at once (for example at a cut). */
    set(bounds: readonly number[], snap = false): void {
      target = check(bounds, 'bounds');
      if (snap) current = target.slice();
    },
    /** Move each edge toward its target by at most rate × dt; returns whether anything moved. */
    step(dt: number, fast = false): boolean {
      if (!finite(dt) || dt < 0 || dt > 10) fail('dt must be within [0, 10] seconds');
      const reach = (fast ? fastRate : rate) * dt;
      let moved = false;
      current = current.map((v, i) => {
        const d = target[i]! - v;
        const next = Math.abs(d) <= reach ? target[i]! : v + Math.sign(d) * reach;
        if (next !== v) moved = true;
        return next;
      });
      // Every edge moves toward its own ordered target by the same reach, so min ≤ max always holds.
      return moved;
    },
    clamp(point: Vec3): Vec3 {
      const p = vec(point, 'point');
      return frozen([
        Math.min(current[3]!, Math.max(current[0]!, p[0])),
        Math.min(current[4]!, Math.max(current[1]!, p[1])),
        Math.min(current[5]!, Math.max(current[2]!, p[2])),
      ]);
    },
    get bounds(): readonly number[] {
      return Object.freeze(current.slice());
    },
  };
}
