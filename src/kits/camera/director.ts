/**
 * Camera director: which camera setting applies (a priority ladder over creator overrides, authored trigger volumes
 * and a fallback), the rigs that turn a setting into a pose (string, rail, shot move, close-up), and how the view moves
 * between poses (a transition schedule sized by how far the pose changes, which arrives exactly on time while still
 * tracking a moving goal). Also: carrying the camera with a moving support, pushing and popping a gameplay view around
 * scripted shots, and a letterbox amount. Pure helpers plus one optional frame system; the camera kit's existing
 * `cameraSystem` is untouched.
 */
import {defineSystem, Transform, type SceneContext, type SystemDefinition, type Vec3} from '../../author';

function fail(message: string): never {
  throw new RangeError(`camera director: ${message}`);
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec = (v: unknown, what: string): Vec3 => {
  if (!Array.isArray(v) || v.length !== 3) fail(`${what} must be [x, y, z]`);
  const out: Vec3 = [v[0], v[1], v[2]];
  if (!out.every(finite)) fail(`${what} must be finite`);
  return out;
};
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));

export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
  /** Vertical field of view in degrees. */
  readonly fov: number;
}

// ---------------------------------------------------------------- volumes and the priority ladder

export type VolumeShape =
  | {readonly kind: 'box'; readonly center: Vec3; readonly half: Vec3; readonly yaw?: number}
  | {readonly kind: 'cylinder'; readonly center: Vec3; readonly radius: number; readonly height: number};
export interface CameraVolume {
  readonly id: string;
  readonly shape: VolumeShape;
  /** Lower wins when volumes overlap. */
  readonly priority: number;
  /** The camera setting this volume selects (a creator name). */
  readonly setting: string;
}
interface Shape {
  inside(p: Vec3, pad: number): boolean;
}
function compileShape(s: VolumeShape, id: string): Shape {
  if (!s || typeof s !== 'object') fail(`${id}: shape must be an object`);
  if (s.kind === 'box') {
    const c = vec(s.center, `${id} center`),
      h = vec(s.half, `${id} half`),
      yaw = s.yaw ?? 0;
    if (!h.every(v => v > 0) || !finite(yaw)) fail(`${id}: box half extents must be positive and yaw finite`);
    const cos = Math.cos(-yaw),
      sin = Math.sin(-yaw);
    return {
      inside(p, pad) {
        const dx = p[0] - c[0],
          dz = p[2] - c[2];
        const lx = dx * cos + dz * sin,
          lz = -dx * sin + dz * cos;
        return Math.abs(lx) <= h[0] + pad && Math.abs(p[1] - c[1]) <= h[1] + pad && Math.abs(lz) <= h[2] + pad;
      },
    };
  }
  if (s.kind === 'cylinder') {
    const c = vec(s.center, `${id} center`),
      r = s.radius,
      height = s.height;
    if (!finite(r) || r <= 0 || !finite(height) || height <= 0) fail(`${id}: radius and height must be positive`);
    return {
      inside(p, pad) {
        const d = Math.hypot(p[0] - c[0], p[2] - c[2]);
        return d <= r + pad && p[1] >= c[1] - pad && p[1] <= c[1] + height + pad;
      },
    };
  }
  fail(`${id}: shape kind is box or cylinder`);
}

export interface CameraSelection {
  readonly setting: string;
  /** What chose it: an override id, a volume id, or 'fallback'. */
  readonly source: string;
  readonly kind: 'override' | 'volume' | 'fallback';
}

/**
 * Resolve the active setting each frame: the first active creator override wins (in the order given), else the
 * containing volume with the lowest priority (ties: declaration order), else the fallback. The current volume keeps
 * winning while the subject stays inside its shape grown by `stickiness`, so a subject on a boundary does not
 * flicker between settings; another volume only takes over with a strictly lower priority.
 */
export function createCameraVolumes(input: {
  readonly volumes: readonly CameraVolume[];
  readonly fallback: string;
  /** Extra distance a subject may move outside the current volume before it is left (default 0.25). */
  readonly stickiness?: number;
}) {
  const fallback = input.fallback,
    pad = input.stickiness ?? 0.25;
  if (typeof fallback !== 'string' || !fallback) fail('fallback setting must be a name');
  if (!finite(pad) || pad < 0 || pad > 1e4) fail('stickiness must be within [0, 1e4]');
  const list = input.volumes;
  if (!Array.isArray(list) || list.length > 1024) fail('at most 1,024 volumes');
  const n = list.length,
    ids = new Set<string>();
  const volumes: {id: string; priority: number; setting: string; shape: Shape}[] = [];
  for (let i = 0; i < n; i++) {
    const v = list[i];
    if (!v || typeof v !== 'object') fail('a volume must be an object');
    const id = v.id,
      priority = v.priority,
      setting = v.setting,
      shape = v.shape;
    if (typeof id !== 'string' || !id || ids.has(id)) fail('volume ids must be unique names');
    ids.add(id);
    if (!finite(priority)) fail(`${id}: priority must be finite`);
    if (typeof setting !== 'string' || !setting) fail(`${id}: setting must be a name`);
    volumes.push({id, priority, setting, shape: compileShape(shape, id)});
  }
  let current: (typeof volumes)[number] | null = null;
  return {
    resolve(
      subject: Vec3,
      overrides: readonly {readonly id: string; readonly setting: string}[] = [],
    ): CameraSelection {
      const p = vec(subject, 'subject');
      for (const o of overrides)
        if (o && typeof o.setting === 'string' && o.setting)
          return Object.freeze({setting: o.setting, source: String(o.id), kind: 'override'});
      let best: (typeof volumes)[number] | null = null;
      for (const v of volumes) if (v.shape.inside(p, 0) && (!best || v.priority < best.priority)) best = v;
      if (current && current.shape.inside(p, pad) && (!best || best.priority >= current.priority)) best = current;
      current = best;
      return best
        ? Object.freeze({setting: best.setting, source: best.id, kind: 'volume'})
        : Object.freeze({setting: fallback, source: 'fallback', kind: 'fallback'});
    },
    reset(): void {
      current = null;
    },
  };
}

// ---------------------------------------------------------------- rigs

/**
 * String rig: the eye stays where it is in the world and is dragged by the subject, kept within [min, max] horizontal
 * distance; its height and the look offset blend between near and far values by where the distance sits in the band.
 */
export interface StringRig {
  readonly min: number;
  readonly max: number;
  /** Eye height above the subject at min and at max distance. */
  readonly height: readonly [number, number];
  /** Look-at height above the subject at min and at max distance. */
  readonly look?: readonly [number, number];
  readonly fov?: readonly [number, number];
}
export function stringPose(rig: StringRig, subject: Vec3, previousEye: Vec3 | null, heading = 0): CameraPose {
  if (!finite(rig.min) || !finite(rig.max) || rig.min <= 0 || rig.max < rig.min) fail('string rig needs 0 < min ≤ max');
  const s = vec(subject, 'subject');
  let dx: number, dz: number;
  if (previousEye) {
    const e = vec(previousEye, 'previous eye');
    dx = e[0] - s[0];
    dz = e[2] - s[2];
  } else {
    dx = -Math.sin(heading) * rig.max;
    dz = -Math.cos(heading) * rig.max;
  }
  let d = Math.hypot(dx, dz);
  if (d < 1e-9) {
    dx = -Math.sin(heading);
    dz = -Math.cos(heading);
    d = 1;
  }
  const clamped = Math.min(rig.max, Math.max(rig.min, d)),
    t = rig.max === rig.min ? 1 : (clamped - rig.min) / (rig.max - rig.min);
  const mix = (r: readonly [number, number] | undefined, dflt: number) => (r ? r[0] + (r[1] - r[0]) * t : dflt);
  const h = mix(rig.height, 0),
    look = mix(rig.look, 0),
    fov = mix(rig.fov, 50);
  if (![h, look, fov].every(finite)) fail('string rig values must be finite');
  return Object.freeze({
    position: [s[0] + (dx / d) * clamped, s[1] + h, s[2] + (dz / d) * clamped] as Vec3,
    target: [s[0], s[1] + look, s[2]] as Vec3,
    fov,
  });
}

/**
 * Rail rig: the eye rides an authored polyline (open or closed, 2-256 points) at the point closest to the subject,
 * raised by `height`, looking at the subject plus `look`.
 */
export interface RailRig {
  readonly points: readonly Vec3[];
  readonly closed?: boolean;
  readonly height?: number;
  readonly look?: number;
  readonly fov?: number;
}
export function railPose(rig: RailRig, subject: Vec3): CameraPose {
  const pts = rig.points;
  if (!Array.isArray(pts) || pts.length < 2 || pts.length > 256) fail('a rail has 2-256 points');
  const ps = pts.map((p, i) => vec(p, `rail point ${i}`));
  const s = vec(subject, 'subject');
  const segments = rig.closed ? ps.length : ps.length - 1;
  let best: Vec3 = ps[0]!,
    bestD = Infinity;
  for (let i = 0; i < segments; i++) {
    const a = ps[i]!,
      b = ps[(i + 1) % ps.length]!,
      ab = sub(b, a),
      len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    const t =
      len2 === 0
        ? 0
        : Math.max(0, Math.min(1, ((s[0] - a[0]) * ab[0] + (s[1] - a[1]) * ab[1] + (s[2] - a[2]) * ab[2]) / len2));
    const q = add(a, scale(ab, t)),
      d = length(sub(s, q));
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  const height = rig.height ?? 0,
    look = rig.look ?? 0,
    fov = rig.fov ?? 50;
  if (![height, look, fov].every(finite)) fail('rail values must be finite');
  return Object.freeze({
    position: [best[0], best[1] + height, best[2]] as Vec3,
    target: [s[0], s[1] + look, s[2]] as Vec3,
    fov,
  });
}

/**
 * Close-up (inspection) pose: orbit `subject` (a center and bounding radius) at `yaw`/`pitch` (radians; pitch clamped
 * to ±1.5) at the distance that fits the sphere in the vertical field of view with `margin` (≥ 1).
 */
export function closeUpPose(
  subject: {readonly center: Vec3; readonly radius: number},
  yaw: number,
  pitch: number,
  fov = 40,
  margin = 1.2,
): CameraPose {
  const c = vec(subject.center, 'subject center'),
    r = subject.radius;
  if (!finite(r) || r <= 0) fail('subject radius must be positive');
  if (!finite(yaw) || !finite(pitch)) fail('yaw and pitch must be finite');
  if (!finite(fov) || fov <= 1 || fov >= 170) fail('fov must be within (1, 170) degrees');
  if (!finite(margin) || margin < 1 || margin > 10) fail('margin must be within [1, 10]');
  const p = Math.max(-1.5, Math.min(1.5, pitch)),
    d = (r * margin) / Math.sin(((fov / 2) * Math.PI) / 180);
  return Object.freeze({
    position: [
      c[0] + Math.sin(yaw) * Math.cos(p) * d,
      c[1] + Math.sin(p) * d,
      c[2] + Math.cos(yaw) * Math.cos(p) * d,
    ] as Vec3,
    target: c,
    fov,
  });
}

/**
 * Shot move: from pose `from` to pose `to` over `ticks`, either straight (`linear`) or around the destination's look
 * target (`orbit`: distance, yaw and pitch interpolated so the camera swings rather than cutting through the subject),
 * with smoothstep easing. Evaluate with the elapsed tick (for example a sequence cue's `elapsed`).
 */
export function shotPose(
  from: CameraPose,
  to: CameraPose,
  elapsed: number,
  ticks: number,
  path: 'linear' | 'orbit' = 'linear',
): CameraPose {
  if (!Number.isSafeInteger(ticks) || ticks < 0) fail('ticks must be a nonnegative integer');
  if (!finite(elapsed) || elapsed < 0) fail('elapsed must be nonnegative');
  const t0 = ticks === 0 ? 1 : Math.min(1, elapsed / ticks),
    t = t0 * t0 * (3 - 2 * t0);
  const a = {position: vec(from.position, 'from position'), target: vec(from.target, 'from target'), fov: from.fov},
    b = {position: vec(to.position, 'to position'), target: vec(to.target, 'to target'), fov: to.fov};
  if (!finite(a.fov) || !finite(b.fov)) fail('fov must be finite');
  const target = lerp(a.target, b.target, t),
    fov = a.fov + (b.fov - a.fov) * t;
  if (path === 'linear') return Object.freeze({position: lerp(a.position, b.position, t), target, fov});
  const sph = (eye: Vec3, at: Vec3) => {
    const o = sub(eye, at),
      r = length(o);
    return {r, yaw: Math.atan2(o[0], o[2]), pitch: r === 0 ? 0 : Math.asin(Math.max(-1, Math.min(1, o[1] / r)))};
  };
  const sa = sph(a.position, a.target),
    sb = sph(b.position, b.target);
  let dyaw = sb.yaw - sa.yaw;
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  const r = sa.r + (sb.r - sa.r) * t,
    yaw = sa.yaw + dyaw * t,
    pitch = sa.pitch + (sb.pitch - sa.pitch) * t;
  return Object.freeze({
    position: add(target, [
      Math.sin(yaw) * Math.cos(pitch) * r,
      Math.sin(pitch) * r,
      Math.cos(yaw) * Math.cos(pitch) * r,
    ]),
    target,
    fov,
  });
}

// ---------------------------------------------------------------- transitions, carry, view stack, letterbox

/**
 * Transition schedule between camera goals. `begin(from, to)` sizes the transition from how far the pose changes:
 * ticks = clamp(ceil(k × sqrt(|Δeye| + |Δtarget| + fovWeight × |Δfov|)), minTicks, maxTicks); a change below `skipBelow`
 * cuts instead. `step(goal)` then moves the current pose toward the live goal by remaining / (1 + 2 + … + remaining),
 * a triangular schedule that decelerates and lands exactly on the goal after the computed ticks, even if the goal moves.
 */
export function createCameraTransition(
  options: {
    readonly k?: number;
    readonly minTicks?: number;
    readonly maxTicks?: number;
    readonly skipBelow?: number;
    readonly fovWeight?: number;
  } = {},
) {
  const k = options.k ?? 6,
    minTicks = options.minTicks ?? 5,
    maxTicks = options.maxTicks ?? 120,
    skip = options.skipBelow ?? 0.01,
    fovWeight = options.fovWeight ?? 0.05;
  if (!finite(k) || k <= 0) fail('k must be positive');
  if (
    !Number.isSafeInteger(minTicks) ||
    !Number.isSafeInteger(maxTicks) ||
    minTicks < 1 ||
    maxTicks < minTicks ||
    maxTicks > 10_000
  )
    fail('ticks bounds must satisfy 1 ≤ minTicks ≤ maxTicks ≤ 10,000');
  if (!finite(skip) || skip < 0 || !finite(fovWeight) || fovWeight < 0) fail('skipBelow and fovWeight must be ≥ 0');
  let current: CameraPose | null = null,
    remaining = 0;
  const copy = (p: CameraPose, what: string): CameraPose => {
    const f = p.fov;
    if (!finite(f)) fail(`${what} fov must be finite`);
    return Object.freeze({
      position: vec(p.position, `${what} position`),
      target: vec(p.target, `${what} target`),
      fov: f,
    });
  };
  return {
    /** Start moving from `from` (usually the pose on screen) toward goals like `to`; returns the tick count (0 = cut). */
    begin(from: CameraPose, to: CameraPose): number {
      const a = copy(from, 'from'),
        b = copy(to, 'to');
      const change =
        length(sub(a.position, b.position)) + length(sub(a.target, b.target)) + fovWeight * Math.abs(a.fov - b.fov);
      current = a;
      remaining = change < skip ? 0 : Math.min(maxTicks, Math.max(minTicks, Math.ceil(k * Math.sqrt(change))));
      return remaining;
    },
    /** Advance one tick toward the live `goal`; returns the pose to show. Without a transition it returns the goal. */
    step(goal: CameraPose): CameraPose {
      const g = copy(goal, 'goal');
      if (!current || remaining <= 0) {
        current = g;
        return g;
      }
      const w = remaining / ((remaining * (remaining + 1)) / 2);
      remaining--;
      current =
        remaining === 0
          ? g
          : Object.freeze({
              position: lerp(current.position, g.position, w),
              target: lerp(current.target, g.target, w),
              fov: current.fov + (g.fov - current.fov) * w,
            });
      return current;
    },
    /**
     * Carry the in-progress pose with a moving support: translate by `delta` and rotate about `pivot` by `yaw` radians,
     * so riding a moving or turning platform does not make the camera lag or swing.
     */
    carry(delta: Vec3, yaw = 0, pivot: Vec3 = [0, 0, 0]): void {
      if (!current) return;
      const d = vec(delta, 'delta'),
        pv = vec(pivot, 'pivot');
      if (!finite(yaw)) fail('yaw must be finite');
      const turn = (p: Vec3): Vec3 => {
        const x = p[0] - pv[0],
          z = p[2] - pv[2],
          c = Math.cos(yaw),
          s = Math.sin(yaw);
        return [pv[0] + x * c + z * s + d[0], p[1] + d[1], pv[2] - x * s + z * c + d[2]];
      };
      current = Object.freeze({position: turn(current.position), target: turn(current.target), fov: current.fov});
    },
    get remaining() {
      return remaining;
    },
    get pose(): CameraPose | null {
      return current;
    },
  };
}
export type CameraTransition = ReturnType<typeof createCameraTransition>;

/**
 * Letterbox amount in [0, 1] eased toward a target at `rate` per second (default 2). Draw bars of
 * `amount × maxFraction` of the view height at top and bottom in your UI or post layer.
 */
export function createLetterbox(rate = 2) {
  if (!finite(rate) || rate <= 0 || rate > 100) fail('letterbox rate must be within (0, 100]');
  let amount = 0,
    target = 0;
  return {
    set(next: number): void {
      if (!finite(next) || next < 0 || next > 1) fail('letterbox target must be within [0, 1]');
      target = next;
    },
    /** Advance by dt seconds; returns the amount and whether it changed (redraw only then). */
    step(dt: number): {readonly amount: number; readonly changed: boolean} {
      if (!finite(dt) || dt < 0) fail('dt must be nonnegative');
      const before = amount,
        delta = target - amount,
        stepBy = rate * dt;
      amount = Math.abs(delta) <= stepBy ? target : amount + Math.sign(delta) * stepBy;
      return Object.freeze({amount, changed: amount !== before});
    },
    get amount() {
      return amount;
    },
  };
}

// ---------------------------------------------------------------- optional frame system

export type CameraSettingPose = (ctx: SceneContext, subject: Vec3, shown: CameraPose | null) => CameraPose;

/**
 * A frame system composing the above: resolve the setting for the named subject, ask the creator's rig for that
 * setting's goal pose, run a sized transition when the setting changes, and write `ctx.view.camera` only when it moves.
 * `overrides(ctx)` supplies the top of the priority ladder (for example a scripted shot or a player state); `carry(ctx)`
 * may return the subject's support motion this frame.
 */
export function cameraDirectorSystem(o: {
  readonly volumes: ReturnType<typeof createCameraVolumes>;
  readonly settings: Readonly<Record<string, CameraSettingPose>>;
  readonly target?: string;
  readonly overrides?: (ctx: SceneContext) => readonly {readonly id: string; readonly setting: string}[];
  readonly carry?: (ctx: SceneContext) => {readonly delta: Vec3; readonly yaw?: number; readonly pivot?: Vec3} | null;
  readonly transition?: Parameters<typeof createCameraTransition>[0];
}): SystemDefinition {
  const transitions = new WeakMap<object, {t: CameraTransition; setting: string | null}>();
  return defineSystem({
    id: 'camera-director',
    phase: 'frame',
    run(ctx) {
      const e = ctx.named(o.target ?? 'player'),
        tr = e === undefined ? undefined : ctx.world.get(e, Transform);
      if (!tr) return;
      const subject: Vec3 = [tr.x, tr.y, tr.z];
      const sel = o.volumes.resolve(subject, o.overrides?.(ctx) ?? []);
      const rig = Object.hasOwn(o.settings, sel.setting) ? o.settings[sel.setting] : undefined;
      if (!rig) fail(`no rig for setting ${sel.setting}`);
      let state = transitions.get(ctx.world);
      if (!state) {
        state = {t: createCameraTransition(o.transition), setting: null};
        transitions.set(ctx.world, state);
      }
      const cam = ctx.view.camera;
      const shown: CameraPose = {position: cam.position, target: cam.target, fov: cam.fov};
      const support = o.carry?.(ctx);
      if (support) state.t.carry(support.delta, support.yaw ?? 0, support.pivot ?? subject);
      const goal = rig(ctx, subject, state.t.pose ?? shown);
      if (state.setting !== sel.setting) {
        if (state.setting !== null) state.t.begin(state.t.pose ?? shown, goal);
        state.setting = sel.setting;
      }
      const next = state.t.step(goal);
      if (
        next.position.some((v, i) => v !== cam.position[i]) ||
        next.target.some((v, i) => v !== cam.target[i]) ||
        next.fov !== cam.fov
      ) {
        cam.position = [...next.position];
        cam.target = [...next.target];
        cam.fov = next.fov;
      }
    },
  });
}
