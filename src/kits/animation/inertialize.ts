import type {ClipRotation, JointPose} from './pose-clip';
/** Longest accepted blend, seconds. */
export const MAX_INERTIAL_BLEND = 2;
const MAX_JOINTS = 128,
  LIMIT = 1e6;
/** One pose switch: the outgoing output at the switch instant, the incoming pose, and optional prior frames for velocity. */
export interface InertialSwitch {
  /** Outgoing (currently displayed) pose at the switch; a re-switch passes the last sampled output. */
  readonly from: readonly JointPose[];
  /** Outgoing pose `dt` seconds earlier; omitted means the outgoing pose was at rest. */
  readonly fromPrevious?: readonly JointPose[];
  /** Incoming pose at the switch. */
  readonly to: readonly JointPose[];
  /** Incoming pose `dt` seconds earlier; omitted means the incoming pose is at rest. */
  readonly toPrevious?: readonly JointPose[];
  /** Seconds between previous and current poses, in [1e-4, 1]; required when either previous pose is given. */
  readonly dt?: number;
  /** Seconds for the offset to decay to zero, in [0, MAX_INERTIAL_BLEND]; zero switches immediately. */
  readonly blendTime: number;
}
export interface Inertializer {
  readonly joints: readonly string[];
  /** Record a new offset; replaces any blend in progress. Refuses invalid input without changing state. */
  switchTo(input: InertialSwitch): void;
  /** Incoming pose plus the decayed offset at `elapsed` seconds since the switch. Returns a reused buffer. */
  sample(target: readonly JointPose[], elapsed: number): readonly JointPose[];
  /** True while an offset remains at `elapsed` seconds since the switch. */
  blending(elapsed: number): boolean;
  /** Drops the offset; later samples return the target pose. */
  reset(): void;
}
type Vec = number[] | Float64Array;
/** out[0..2] = log(a * conj(b)) as a scaled angle-axis vector, shortest hemisphere; quaternions normalized here. */
function relativeLog(a: ClipRotation, b: ClipRotation, out: Vec, o: number) {
  const na = Math.hypot(a[0], a[1], a[2], a[3]),
    nb = Math.hypot(b[0], b[1], b[2], b[3]);
  const ax = a[0] / na,
    ay = a[1] / na,
    az = a[2] / na,
    aw = a[3] / na,
    bx = -b[0] / nb,
    by = -b[1] / nb,
    bz = -b[2] / nb,
    bw = b[3] / nb;
  let x = aw * bx + ax * bw + ay * bz - az * by,
    y = aw * by - ax * bz + ay * bw + az * bx,
    z = aw * bz + ax * by - ay * bx + az * bw,
    w = aw * bw - ax * bx - ay * by - az * bz;
  if (w < 0) ((x = -x), (y = -y), (z = -z), (w = -w));
  const s = Math.hypot(x, y, z),
    k = s < 1e-12 ? 2 : (2 * Math.atan2(s, w)) / s;
  out[o] = x * k;
  out[o + 1] = y * k;
  out[o + 2] = z * k;
}
/**
 * Pose-level inertialization: on a switch the incoming pose shows at once and the difference from the outgoing pose
 * (position and shortest-arc rotation, with their velocity difference) decays to zero by a quintic, so position and
 * velocity are continuous at the switch and the offset has zero velocity and acceleration at the blend end.
 */
export function createInertializer(joints: readonly string[]): Inertializer {
  if (
    !Array.isArray(joints) ||
    joints.length === 0 ||
    joints.length > MAX_JOINTS ||
    !joints.every(j => typeof j === 'string' && j.length > 0 && j.length <= 256) ||
    new Set(joints).size !== joints.length
  )
    throw Error('inertialize: invalid joint list');
  const names = Object.freeze([...joints]),
    n = names.length;
  // Offset state, three per joint: position offset/velocity and rotation log offset/angular velocity.
  const x0 = new Float64Array(3 * n),
    v0 = new Float64Array(3 * n),
    r0 = new Float64Array(3 * n),
    w0 = new Float64Array(3 * n),
    tmp = new Float64Array(3);
  let duration = 0;
  const positions = names.map((): [number, number, number] => [0, 0, 0]),
    rotations = names.map((): [number, number, number, number] => [0, 0, 0, 1]);
  const output: readonly JointPose[] = names.map((joint, i) => ({
    joint,
    position: positions[i]!,
    rotation: rotations[i]!,
  }));
  const check = (pose: readonly JointPose[] | undefined, what: string) => {
    if (!Array.isArray(pose) || pose.length !== n) throw Error(`inertialize: ${what} must list every joint in order`);
    for (let i = 0; i < n; i++) {
      const p = pose[i]!;
      if (!p || p.joint !== names[i] || p.position?.length !== 3 || p.rotation?.length !== 4)
        throw Error(`inertialize: ${what} must list every joint in order`);
      for (let k = 0; k < 3; k++)
        if (!Number.isFinite(p.position[k]) || Math.abs(p.position[k]!) > LIMIT)
          throw Error(`inertialize: invalid ${what} position`);
      let norm = 0;
      for (let k = 0; k < 4; k++) {
        const v = p.rotation[k]!;
        if (!Number.isFinite(v) || Math.abs(v) > LIMIT) throw Error(`inertialize: invalid ${what} rotation`);
        norm += v * v;
      }
      if (norm < 1e-12) throw Error(`inertialize: invalid ${what} rotation`);
    }
  };
  return {
    joints: names,
    switchTo(input) {
      const {from, fromPrevious, to, toPrevious, dt, blendTime} = input;
      if (!Number.isFinite(blendTime) || blendTime < 0 || blendTime > MAX_INERTIAL_BLEND)
        throw Error('inertialize: blend time out of range');
      check(from, 'from');
      check(to, 'to');
      const moving = fromPrevious !== undefined || toPrevious !== undefined;
      if (moving && (dt === undefined || !Number.isFinite(dt) || dt < 1e-4 || dt > 1))
        throw Error('inertialize: dt out of range');
      if (fromPrevious) check(fromPrevious, 'fromPrevious');
      if (toPrevious) check(toPrevious, 'toPrevious');
      // Everything validated: commit. Only offset state is written, so `from` may be this inertializer's output.
      const inv = moving ? 1 / dt! : 0;
      for (let i = 0; i < n; i++) {
        const a = from[i]!,
          b = to[i]!,
          o = 3 * i;
        for (let k = 0; k < 3; k++) {
          const outVel = fromPrevious ? (a.position[k]! - fromPrevious[i]!.position[k]!) * inv : 0,
            inVel = toPrevious ? (b.position[k]! - toPrevious[i]!.position[k]!) * inv : 0;
          x0[o + k] = a.position[k]! - b.position[k]!;
          v0[o + k] = outVel - inVel;
        }
        relativeLog(a.rotation, b.rotation, r0, o);
        if (fromPrevious) relativeLog(a.rotation, fromPrevious[i]!.rotation, w0, o);
        else w0[o] = w0[o + 1] = w0[o + 2] = 0;
        if (toPrevious) relativeLog(b.rotation, toPrevious[i]!.rotation, tmp, 0);
        else tmp[0] = tmp[1] = tmp[2] = 0;
        for (let k = 0; k < 3; k++) w0[o + k] = (w0[o + k]! - tmp[k]!) * inv;
      }
      duration = blendTime;
    },
    sample(target, elapsed) {
      if (!Number.isFinite(elapsed) || elapsed < 0) throw Error('inertialize: invalid elapsed time');
      check(target, 'target');
      let a = 0,
        b = 0;
      if (elapsed < duration) {
        // x(t) = x0·(1 - 10u³ + 15u⁴ - 6u⁵) + v0·T·(u - 6u³ + 8u⁴ - 3u⁵), u = t / T.
        const u = elapsed / duration,
          u3 = u * u * u;
        a = 1 - u3 * (10 - 15 * u + 6 * u * u);
        b = duration * (u - u3 * (6 - 8 * u + 3 * u * u));
      }
      for (let i = 0; i < n; i++) {
        const t = target[i]!,
          o = 3 * i,
          position = positions[i]!,
          rotation = rotations[i]!;
        for (let k = 0; k < 3; k++) position[k] = t.position[k]! + a * x0[o + k]! + b * v0[o + k]!;
        // rotation = exp(offset) * normalize(target)
        const rx = a * r0[o]! + b * w0[o]!,
          ry = a * r0[o + 1]! + b * w0[o + 1]!,
          rz = a * r0[o + 2]! + b * w0[o + 2]!,
          angle = Math.hypot(rx, ry, rz),
          s = angle < 1e-12 ? 0.5 : Math.sin(angle / 2) / angle,
          qx = rx * s,
          qy = ry * s,
          qz = rz * s,
          qw = angle < 1e-12 ? 1 : Math.cos(angle / 2);
        const q = t.rotation,
          norm = Math.hypot(q[0], q[1], q[2], q[3]),
          bx = q[0] / norm,
          by = q[1] / norm,
          bz = q[2] / norm,
          bw = q[3] / norm;
        rotation[0] = qw * bx + qx * bw + qy * bz - qz * by;
        rotation[1] = qw * by - qx * bz + qy * bw + qz * bx;
        rotation[2] = qw * bz + qx * by - qy * bx + qz * bw;
        rotation[3] = qw * bw - qx * bx - qy * by - qz * bz;
      }
      return output;
    },
    blending(elapsed) {
      if (!Number.isFinite(elapsed) || elapsed < 0) throw Error('inertialize: invalid elapsed time');
      return elapsed < duration;
    },
    reset() {
      duration = 0;
    },
  };
}
