import {Quaternion, Vector3} from 'three';
import type {ClipRotation, JointPose} from './pose-clip';

/**
 * A bounded look-at (aim) constraint over a short joint chain, for heads, necks, spines, turrets and eyes.
 *
 * The caller gives the target as a direction in the chain's root frame (+Z forward, +Y up, +X the root's left in
 * three.js convention), for example `inverse(rootWorld) × (targetWorld − eyeWorld)`, or null for "no target". The
 * helper turns it into yaw/pitch, ignores targets outside a front cone (they relax the chain back to rest), clamps to
 * the chain's combined limits, eases with a time constant and an angular-speed cap, and distributes the result over
 * the joints in order: each joint takes its share up to its own limits and passes any remainder to the next joint;
 * per-joint deltas are steps between cumulative aims, so the composed chain points exactly at the clamped aim.
 * It returns per-joint delta rotations to multiply onto an underlying pose (clip, layers, transition output); it owns
 * no clock, entity, renderer or skeleton.
 */
export interface LookAtJoint {
  readonly joint: string;
  /** Share of the total turn this joint tries to take first, (0, 1]. Remaining turn flows to later joints. */
  readonly share: number;
  /** Radians, each within [−π/2, π/2] with min ≤ 0 ≤ max. */
  readonly yaw: readonly [number, number];
  readonly pitch: readonly [number, number];
  /**
   * Rest orientation of this joint's parent relative to the chain root, as a unit quaternion [x, y, z, w]. Deltas are
   * computed in the root frame and conjugated into the parent frame. Default identity (parent aligned with root).
   */
  readonly parentFrame?: ClipRotation;
}
export interface LookAtOptions {
  /** 1–8 joints, root-most first (for example spine, neck, head). */
  readonly joints: readonly LookAtJoint[];
  /** Targets farther than this from straight ahead (radians, (0, π]) are ignored and the chain relaxes. Default 2. */
  readonly ignoreBeyond?: number;
  /** Exponential smoothing time constant in seconds, [0, 10]; 0 snaps. Default 0.15. */
  readonly smoothing?: number;
  /** Largest angular speed in radians per second, (0, 100]. Default 6. */
  readonly maxSpeed?: number;
}
export interface LookAtJointOutput {
  readonly joint: string;
  readonly yaw: number;
  readonly pitch: number;
  /** Delta rotation in the joint's parent frame, [x, y, z, w]. */
  readonly rotation: ClipRotation;
}
export interface LookAtState {
  /** Current total yaw and pitch (after limits and smoothing). */
  readonly yaw: number;
  readonly pitch: number;
  /** True when the target was accepted this update (inside the front cone and finite). */
  readonly engaged: boolean;
  readonly joints: readonly LookAtJointOutput[];
}

const HALF_PI = Math.PI / 2;
function fail(message: string): never {
  throw new RangeError(`look-at: ${message}`);
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function createLookAt(options: LookAtOptions) {
  const ignore = options.ignoreBeyond ?? 2,
    tau = options.smoothing ?? 0.15,
    maxSpeed = options.maxSpeed ?? 6;
  if (!finite(ignore) || ignore <= 0 || ignore > Math.PI) fail('ignoreBeyond must be within (0, π]');
  if (!finite(tau) || tau < 0 || tau > 10) fail('smoothing must be within [0, 10] seconds');
  if (!finite(maxSpeed) || maxSpeed <= 0 || maxSpeed > 100) fail('maxSpeed must be within (0, 100]');
  const list = options.joints;
  if (!Array.isArray(list)) fail('joints must be an array');
  const n = list.length;
  if (n < 1 || n > 8) fail('a chain has 1-8 joints');
  const seen = new Set<string>();
  const joints = [] as {
    joint: string;
    share: number;
    yaw: [number, number];
    pitch: [number, number];
    frame: Quaternion;
    frameInverse: Quaternion;
  }[];
  for (let i = 0; i < n; i++) {
    const j = list[i];
    if (!j || typeof j !== 'object') fail('a joint must be an object');
    const id = j.joint,
      share = j.share,
      yaw = j.yaw,
      pitch = j.pitch,
      frame = j.parentFrame;
    if (typeof id !== 'string' || !id || id.length > 256 || seen.has(id)) fail('joint ids must be unique, 1-256 chars');
    seen.add(id);
    if (!finite(share) || share <= 0 || share > 1) fail(`${id}: share must be within (0, 1]`);
    for (const [name, range] of [
      ['yaw', yaw],
      ['pitch', pitch],
    ] as const) {
      if (!Array.isArray(range) || range.length !== 2) fail(`${id}: ${name} limits are [min, max]`);
      const lo = range[0],
        hi = range[1];
      if (!finite(lo) || !finite(hi) || lo > 0 || hi < 0 || lo < -HALF_PI || hi > HALF_PI)
        fail(`${id}: ${name} limits must satisfy -π/2 ≤ min ≤ 0 ≤ max ≤ π/2`);
    }
    let q = new Quaternion();
    if (frame !== undefined) {
      if (!Array.isArray(frame) || frame.length !== 4 || !frame.every(finite))
        fail(`${id}: parentFrame is [x, y, z, w]`);
      q = new Quaternion(frame[0], frame[1], frame[2], frame[3]);
      if (q.length() < 1e-9) fail(`${id}: parentFrame must be a nonzero quaternion`);
      q.normalize();
    }
    joints.push({
      joint: id,
      share,
      yaw: [yaw[0], yaw[1]],
      pitch: [pitch[0], pitch[1]],
      frame: q,
      frameInverse: q.clone().invert(),
    });
  }
  const total = (axis: 'yaw' | 'pitch', k: 0 | 1) => joints.reduce((s, j) => s + j[axis][k], 0);
  const yawRange: [number, number] = [total('yaw', 0), total('yaw', 1)],
    pitchRange: [number, number] = [total('pitch', 0), total('pitch', 1)];
  const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
  let yaw = 0,
    pitch = 0,
    engaged = false;
  const yawAxis = new Vector3(0, 1, 0),
    pitchAxis = new Vector3(1, 0, 0),
    qa = new Quaternion(),
    qb = new Quaternion();

  /** Split a total angle over the joints: each takes min(share × remaining, its limit), the rest flows on. */
  function distribute(value: number, axis: 'yaw' | 'pitch'): number[] {
    let remaining = value;
    return joints.map((j, i) => {
      const want = i === joints.length - 1 ? remaining : remaining * j.share;
      const took = clamp(want, j[axis]);
      remaining -= took;
      return took;
    });
  }
  function output(): LookAtState {
    const yaws = distribute(yaw, 'yaw'),
      pitches = distribute(pitch, 'pitch');
    // Cumulative aim after joint i is yaw(sum of yaws) then pitch(sum of pitches). Each joint's delta is the step
    // between consecutive cumulative aims, so the chain composes to exactly the clamped aim.
    let sumYaw = 0,
      sumPitch = 0;
    const previous = new Quaternion();
    return Object.freeze({
      yaw,
      pitch,
      engaged,
      joints: Object.freeze(
        joints.map((j, i) => {
          sumYaw += yaws[i]!;
          sumPitch += pitches[i]!;
          qa.setFromAxisAngle(yawAxis, sumYaw);
          qb.setFromAxisAngle(pitchAxis, -sumPitch);
          const cumulative = qa.clone().multiply(qb);
          const delta = previous.clone().invert().multiply(cumulative);
          previous.copy(cumulative);
          const local = j.frameInverse.clone().multiply(delta).multiply(j.frame);
          return Object.freeze({
            joint: j.joint,
            yaw: yaws[i]!,
            pitch: pitches[i]!,
            rotation: Object.freeze(local.toArray() as [number, number, number, number]),
          });
        }),
      ),
    });
  }

  return {
    /**
     * Advance by `dt` seconds toward `target` (a root-frame direction; its length is irrelevant) or toward rest when
     * the target is null, zero-length or outside the front cone.
     */
    update(dt: number, target: {readonly x: number; readonly y: number; readonly z: number} | null): LookAtState {
      if (!finite(dt) || dt < 0 || dt > 10) fail('dt must be within [0, 10] seconds');
      let wantYaw = 0,
        wantPitch = 0;
      engaged = false;
      if (target !== null) {
        if (typeof target !== 'object') fail('target must be a direction or null');
        const x = target.x,
          y = target.y,
          z = target.z;
        if (!finite(x) || !finite(y) || !finite(z)) fail('target components must be finite');
        const horizontal = Math.hypot(x, z),
          length = Math.hypot(horizontal, y);
        if (length > 1e-9) {
          const off = Math.acos(Math.min(1, Math.max(-1, z / length)));
          if (off <= ignore) {
            engaged = true;
            wantYaw = clamp(Math.atan2(x, z), yawRange);
            wantPitch = clamp(Math.atan2(y, horizontal), pitchRange);
          }
        }
      }
      // Exponential approach, then cap the step's angular length so a large jump turns at a bounded speed.
      const k = tau === 0 ? 1 : 1 - Math.exp(-dt / tau);
      let dy = (wantYaw - yaw) * k,
        dp = (wantPitch - pitch) * k;
      const step = Math.hypot(dy, dp),
        cap = maxSpeed * dt;
      if (step > cap && step > 0) {
        dy *= cap / step;
        dp *= cap / step;
      }
      yaw += dy;
      pitch += dp;
      if (Math.abs(wantYaw - yaw) < 1e-9) yaw = wantYaw;
      if (Math.abs(wantPitch - pitch) < 1e-9) pitch = wantPitch;
      return output();
    },
    /** Jump to rest (for example after a teleport or a cut). */
    reset(): LookAtState {
      yaw = 0;
      pitch = 0;
      engaged = false;
      return output();
    },
    /**
     * Multiply each chain joint's delta onto `base` (delta in the parent frame, so `delta × base`). Joints not in the
     * chain pass through unchanged; a chain joint missing from `base` is refused.
     */
    apply(base: readonly JointPose[], state: LookAtState): JointPose[] {
      const byJoint = new Map(state.joints.map(j => [j.joint, j.rotation]));
      const out = base.map(p => {
        const d = byJoint.get(p.joint);
        if (!d) return {joint: p.joint, position: p.position, rotation: p.rotation};
        byJoint.delete(p.joint);
        const r = new Quaternion(...d).multiply(new Quaternion(...p.rotation).normalize());
        return {joint: p.joint, position: p.position, rotation: r.toArray() as [number, number, number, number]};
      });
      if (byJoint.size) fail(`base pose lacks chain joint ${[...byJoint.keys()][0]}`);
      return out;
    },
    get limits() {
      return Object.freeze({yaw: Object.freeze([...yawRange]), pitch: Object.freeze([...pitchRange])});
    },
  };
}
export type LookAt = ReturnType<typeof createLookAt>;
