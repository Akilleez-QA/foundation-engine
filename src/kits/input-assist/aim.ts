/**
 * kits/input-assist/aim.ts: aim assistance over a frame's aim action values (pure, stateless, bounded).
 *
 * The caller reads its aim actions (`ctx.input.axis(...)`, pointer movement) and turns them into a raw angular delta
 * for this frame, then asks `evaluate` for the assisted delta. Three independent effects, each with a strength in
 * [0, 1] where 0 is an exact identity:
 *
 * - selection: the candidate inside the aim cone (half angle and range, measured to the target's bounding sphere)
 *   with the highest priority, then the lowest score (angle and distance, divided by weight), then the smallest id;
 *   an optional stickiness favours the previous frame's target;
 * - friction: the raw delta is scaled down while the reticle is over or near any candidate in range;
 * - magnetism: the aim (after the scaled raw delta) is pulled toward the selected target's centre at a rate per
 *   second, scaled by how much aim input the user is giving this frame; it never passes the target.
 *
 * Angles follow the camera kit: yaw about +Y with yaw 0 looking along +Z, pitch up, direction
 * `(sin yaw cos pitch, sin pitch, cos yaw cos pitch)`. Time is an input (`dt`); nothing reads a clock, a device or
 * global state. Planar mode ignores pitch and height (a top-down or twin-stick aim).
 */
import {scalarMath, type ScalarMath, type ScalarMathMode, type Vec3} from '../../author';

/** Hard ceilings of this implementation. */
export const AIM_ASSIST_LIMITS = Object.freeze({
  /** Most candidates one evaluation accepts (`maxCandidates` may be lower). */
  candidates: 256,
  /** Largest cone half angle, radians (a hemisphere). */
  coneHalfAngle: Math.PI / 2,
  /** Largest range, world units. */
  range: 1e6,
  /** Largest pull rate, radians per second. */
  pullRate: 4 * Math.PI,
  /** Largest dt one evaluation integrates, seconds; a longer frame is clamped to it (a hitch never snaps aim). */
  maxDt: 0.25,
  /** Candidate weight range (exclusive 0, inclusive 100) and priority range (integers). */
  weight: 100,
  priority: 1000,
  /** Candidate id length. */
  idLength: 64,
});

export interface AimAssistOptions {
  /** Cone half angle in radians, (0, π/2]. A candidate qualifies when its bounding sphere reaches into the cone. */
  readonly coneHalfAngle: number;
  /** Largest distance to a candidate's centre, (0, 1e6]. */
  readonly range: number;
  /** Most candidates per evaluation, 1..256 (default 32). More throws RangeError: pre-filter with a spatial query. */
  readonly maxCandidates?: number;
  /** Score weights: the angle term is `angle / coneHalfAngle`, the distance term `distance / range`. Defaults 1 and 0.25. */
  readonly angleWeight?: number;
  readonly distanceWeight?: number;
  /** [0, 1]: the previous target's score is multiplied by `1 - stickiness` (default 0, no preference). */
  readonly stickiness?: number;
  /** [0, 1] magnetism strength (default 0). */
  readonly magnetism?: number;
  /** Pull rate at full strength and full input, radians per second, (0, 4π] (default 0.6). */
  readonly pullRate?: number;
  /** Aim input speed, radians per second, at which input counts as full (activity 1). (0, 100] (default 1). */
  readonly fullInputSpeed?: number;
  /** [0, 1] activity assumed with no aim input (default 0: no input, no pull). */
  readonly idlePull?: number;
  /** [0, 1] friction strength (default 0). */
  readonly friction?: number;
  /** Angular margin around a candidate's bounding sphere where friction fades out, radians, (0, π/4] (default 0.05). */
  readonly frictionMargin?: number;
  /** Delta scale at full friction strength over a target, (0, 1] (default 0.25). Above 0 so aim can always leave. */
  readonly frictionFloor?: number;
  /** Ignore pitch and height (default false). */
  readonly planar?: boolean;
  /** `'deterministic'` uses `dmath` for replays across JavaScript engines (default `'platform'`). */
  readonly math?: ScalarMathMode;
}

export interface AimCandidate {
  /** 1..64 characters, unique within one evaluation; the final tie-break (ascending code units). */
  readonly id: string;
  readonly position: Vec3;
  /** Bounding sphere radius, finite and >= 0. */
  readonly radius: number;
  /** (0, 100], default 1: a larger weight divides the score (preferred). */
  readonly weight?: number;
  /** Integer in [-1000, 1000], default 0: a higher priority always wins over a lower one in the cone. */
  readonly priority?: number;
}

export interface AimFrame {
  readonly origin: Vec3;
  /** Current aim, radians. */
  readonly yaw: number;
  readonly pitch: number;
  /** Raw aim change this frame from the aim actions, radians. */
  readonly delta: Readonly<{yaw: number; pitch: number}>;
  /** Seconds since the last evaluation, >= 0; clamped to `AIM_ASSIST_LIMITS.maxDt`. */
  readonly dt: number;
  readonly candidates: readonly AimCandidate[];
  /** Last frame's `target`, for stickiness. */
  readonly previous?: string | null;
}

export interface AimResult {
  /** The assisted delta to add to the aim. Equal to the raw delta when every strength is 0. */
  readonly delta: Readonly<{yaw: number; pitch: number}>;
  /** The selected candidate id, or null. */
  readonly target: string | null;
  /** Scale applied to the raw delta (1 = none). */
  readonly friction: number;
  /** The magnetism part of `delta`, radians. */
  readonly pull: Readonly<{yaw: number; pitch: number}>;
  /** Input activity in [0, 1] that scaled the pull. */
  readonly activity: number;
}

export interface AimAssist {
  readonly options: Readonly<Required<Omit<AimAssistOptions, 'math'>>> & {readonly math: ScalarMathMode};
  /** One frame. Throws RangeError for a malformed frame or too many candidates; never answers from part of a list. */
  evaluate(frame: AimFrame): AimResult;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
function fail(message: string): never {
  throw new RangeError(`aim assist: ${message}`);
}
function inRange(value: unknown, name: string, lo: number, hi: number, loOpen = false): number {
  if (!finite(value) || value > hi || (loOpen ? value <= lo : value < lo))
    fail(`${name} must be in ${loOpen ? '(' : '['}${lo}, ${hi}] (got ${String(value)})`);
  return value;
}
const isVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(finite);
function vec(v: unknown, name: string): Vec3 {
  if (!isVec(v)) fail(`${name} must be three finite numbers`);
  return v;
}

/** Unit direction of a yaw and pitch (the camera kit's convention). */
export function aimDirection(yaw: number, pitch: number, math: ScalarMath = scalarMath(undefined)): Vec3 {
  const c = math.cos(pitch);
  return [math.sin(yaw) * c, math.sin(pitch), math.cos(yaw) * c];
}

/** Yaw and pitch of a non-zero direction (it need not be unit length). */
export function aimAngles(direction: Vec3, math: ScalarMath = scalarMath(undefined)): {yaw: number; pitch: number} {
  const [x, y, z] = vec(direction, 'direction');
  const flat = math.hypot(x, z);
  if (flat === 0 && y === 0) fail('direction must be non-zero');
  return {yaw: flat === 0 ? 0 : math.atan2(x, z), pitch: math.atan2(y, flat)};
}

/** Validate the options once and return the stateless evaluator. */
export function createAimAssist(options: AimAssistOptions): AimAssist {
  if (options === null || typeof options !== 'object') fail('options must be an object');
  const o = {
    coneHalfAngle: inRange(options.coneHalfAngle, 'coneHalfAngle', 0, AIM_ASSIST_LIMITS.coneHalfAngle, true),
    range: inRange(options.range, 'range', 0, AIM_ASSIST_LIMITS.range, true),
    maxCandidates: inRange(options.maxCandidates ?? 32, 'maxCandidates', 1, AIM_ASSIST_LIMITS.candidates),
    angleWeight: inRange(options.angleWeight ?? 1, 'angleWeight', 0, 100),
    distanceWeight: inRange(options.distanceWeight ?? 0.25, 'distanceWeight', 0, 100),
    stickiness: inRange(options.stickiness ?? 0, 'stickiness', 0, 1),
    magnetism: inRange(options.magnetism ?? 0, 'magnetism', 0, 1),
    pullRate: inRange(options.pullRate ?? 0.6, 'pullRate', 0, AIM_ASSIST_LIMITS.pullRate, true),
    fullInputSpeed: inRange(options.fullInputSpeed ?? 1, 'fullInputSpeed', 0, 100, true),
    idlePull: inRange(options.idlePull ?? 0, 'idlePull', 0, 1),
    friction: inRange(options.friction ?? 0, 'friction', 0, 1),
    frictionMargin: inRange(options.frictionMargin ?? 0.05, 'frictionMargin', 0, Math.PI / 4, true),
    frictionFloor: inRange(options.frictionFloor ?? 0.25, 'frictionFloor', 0, 1, true),
    planar: options.planar ?? false,
    math: options.math ?? 'platform',
  };
  if (!Number.isInteger(o.maxCandidates)) fail('maxCandidates must be an integer');
  if (typeof o.planar !== 'boolean') fail('planar must be a boolean');
  const m = scalarMath(o.math);
  const frozen = Object.freeze({...o});
  const {coneHalfAngle: cone, range, maxCandidates, angleWeight, distanceWeight, stickiness} = o;
  const {magnetism, pullRate, fullInputSpeed, idlePull, friction, frictionMargin, frictionFloor, planar} = o;
  const wrap = (a: number) => m.atan2(m.sin(a), m.cos(a));

  function evaluate(frame: AimFrame): AimResult {
    if (frame === null || typeof frame !== 'object') fail('frame must be an object');
    const [ox, oy, oz] = vec(frame.origin, 'origin');
    const yaw = frame.yaw,
      pitch = planar ? 0 : frame.pitch;
    if (!finite(yaw) || !finite(frame.pitch)) fail('yaw and pitch must be finite');
    const d = frame.delta;
    if (d === null || typeof d !== 'object' || !finite(d.yaw) || !finite(d.pitch)) fail('delta must be finite');
    const rawYaw = d.yaw,
      rawPitch = d.pitch;
    if (!finite(frame.dt) || frame.dt < 0) fail('dt must be finite and >= 0');
    const dt = Math.min(frame.dt, AIM_ASSIST_LIMITS.maxDt);
    const list = frame.candidates;
    if (!Array.isArray(list)) fail('candidates must be an array');
    if (list.length > maxCandidates) fail(`${list.length} candidates exceed maxCandidates ${maxCandidates}`);
    const previous = frame.previous ?? null;

    // Forward and per-candidate geometry. Angles to a candidate are measured to its bounding sphere's edge.
    const cp = m.cos(pitch);
    const fx = m.sin(yaw) * cp,
      fy = planar ? 0 : m.sin(pitch),
      fz = m.cos(yaw) * cp;
    const seen = new Set<string>();
    let best: {id: string; priority: number; score: number; x: number; y: number; z: number} | null = null;
    let nearestEdge = Infinity;
    for (const c of list) {
      if (c === null || typeof c !== 'object') fail('candidate must be an object');
      const id = c.id;
      if (typeof id !== 'string' || id.length < 1 || id.length > AIM_ASSIST_LIMITS.idLength)
        fail('candidate id must be 1..64 characters');
      if (seen.has(id)) fail(`duplicate candidate id '${id}'`);
      seen.add(id);
      const [px, py, pz] = vec(c.position, `candidate '${id}' position`);
      const radius = c.radius;
      if (!finite(radius) || radius < 0) fail(`candidate '${id}' radius must be finite and >= 0`);
      const weight = c.weight ?? 1;
      if (!finite(weight) || weight <= 0 || weight > AIM_ASSIST_LIMITS.weight)
        fail(`candidate '${id}' weight must be in (0, 100]`);
      const priority = c.priority ?? 0;
      if (!Number.isInteger(priority) || Math.abs(priority) > AIM_ASSIST_LIMITS.priority)
        fail(`candidate '${id}' priority must be an integer in [-1000, 1000]`);
      const dx = px - ox,
        dy = planar ? 0 : py - oy,
        dz = pz - oz;
      const dist = m.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > range) continue;
      let edge = 0;
      if (dist > radius) {
        // Angle between forward and the centre, minus the sphere's angular radius asin(radius / dist).
        const cx = fy * dz - fz * dy,
          cy = fz * dx - fx * dz,
          cz = fx * dy - fy * dx;
        const centre = m.atan2(m.sqrt(cx * cx + cy * cy + cz * cz), fx * dx + fy * dy + fz * dz);
        const s = radius / dist;
        edge = Math.max(0, centre - m.atan2(s, m.sqrt(1 - s * s)));
      }
      if (edge < nearestEdge) nearestEdge = edge;
      if (edge > cone || dist === 0) continue;
      let score = ((angleWeight * edge) / cone + (distanceWeight * dist) / range) / weight;
      if (id === previous) score *= 1 - stickiness;
      if (
        !best ||
        priority > best.priority ||
        (priority === best.priority && (score < best.score || (score === best.score && id < best.id)))
      )
        best = {id, priority, score, x: dx, y: dy, z: dz};
    }

    // Friction: scale the raw delta while over (edge 0) or near any candidate in range.
    let scale = 1;
    if (friction > 0 && nearestEdge < frictionMargin) {
      const near = 1 - nearestEdge / frictionMargin;
      scale = 1 - friction * (1 - frictionFloor) * near;
    }
    const outYaw = rawYaw * scale,
      outPitch = planar ? rawPitch : rawPitch * scale;
    if (scale === 1 && (magnetism === 0 || !best)) {
      return Object.freeze({
        delta: Object.freeze({yaw: rawYaw, pitch: rawPitch}),
        target: best?.id ?? null,
        friction: 1,
        pull: Object.freeze({yaw: 0, pitch: 0}),
        activity: 0,
      });
    }

    // Magnetism: move toward the target centre along the offset from the post-input aim, by at most the rate
    // budget, and never past it (the result stays on the segment between that aim and the target).
    let pullYaw = 0,
      pullPitch = 0,
      activity = 0;
    if (magnetism > 0 && best && dt > 0) {
      const aimYaw = yaw + outYaw,
        aimPitch = planar ? 0 : pitch + outPitch;
      const inputSpeed = m.hypot(rawYaw * m.cos(pitch), planar ? 0 : rawPitch) / dt;
      activity = Math.max(idlePull, Math.min(1, inputSpeed / fullInputSpeed));
      const offYaw = wrap(m.atan2(best.x, best.z) - aimYaw),
        offPitch = planar ? 0 : m.atan2(best.y, m.hypot(best.x, best.z)) - aimPitch;
      const size = m.hypot(offYaw * m.cos(aimPitch), offPitch);
      const budget = magnetism * pullRate * activity * dt;
      if (size > 0 && budget > 0) {
        const k = Math.min(1, budget / size);
        pullYaw = offYaw * k;
        pullPitch = offPitch * k;
      }
    }
    return Object.freeze({
      delta: Object.freeze({yaw: outYaw + pullYaw, pitch: outPitch + pullPitch}),
      target: best?.id ?? null,
      friction: scale,
      pull: Object.freeze({yaw: pullYaw, pitch: pullPitch}),
      activity,
    });
  }
  return Object.freeze({options: frozen, evaluate});
}
