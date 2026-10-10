/**
 * kits/car-handling/car: one car's fixed-step handling controller. Pure: no world, clock, input service or collision
 * data. The caller supplies controls and a ground query per step and reads the pose back.
 *
 * Model: one rigid body (box inertia, semi-implicit Euler, world-frame angular velocity, unit quaternion) on 2 to 8
 * ray-cast suspension corners. Each corner's spring and damper push along the body's up axis; each grounded tyre makes
 * a longitudinal force (drive split over grounded driven wheels, foot brake by axle bias, handbrake, rolling
 * resistance) and a lateral force from its slip angle through a peak-then-slide grip curve, and both stay inside a
 * friction ellipse. Handbrake wheels lose lateral grip while the handbrake is held and regain it over
 * `drift.recoveryTime`. Quadratic drag and speed-squared downforce act on the body; with no wheel down, air control
 * and levelling act on the angular velocity. Optional body-corner contacts keep a rolled car out of the ground, and a
 * car stuck upside down is reported (and with `reset.auto`, set upright).
 *
 * Whole state is one Float64Array. A step works on a copy and commits it only when every sub-step succeeded and the
 * result is finite and inside the configured extent, so a throwing ground query or a refused step changes nothing.
 */
import {scalarMath, type ScalarMath, type ScalarMathMode} from '../../author';
import {carConfigFingerprint, evalCurve, validateCarConfig, type CarConfig} from './config';
import {createGroundHit, type GroundHit, type GroundQuery} from './ground';

/** One step's driver controls. Missing fields are 0. Values outside their ranges are refused. */
export interface CarControls {
  /** [0, 1]. */
  readonly throttle?: number;
  /** [0, 1]. With `brakes.brakeToReverse`, held near standstill it drives backwards. */
  readonly brake?: number;
  /** [-1, 1], positive turns right. Also yaws the car in the air (`air.yaw`). */
  readonly steer?: number;
  /** [0, 1]. */
  readonly handbrake?: number;
  /** Air pitch, [-1, 1], positive lifts the nose. Only acts with no wheel on the ground. */
  readonly pitch?: number;
  /** Air roll, [-1, 1], positive rolls right. Only acts with no wheel on the ground. */
  readonly roll?: number;
}

export interface CarStepResult {
  /** Sub-steps taken. */
  readonly substeps: number;
  /** Ground queries made (wheels plus body corners, per sub-step). */
  readonly queries: number;
  /** Wheels on the ground at the end of the step. */
  readonly grounded: number;
  /** No wheel touched the ground on the last sub-step. */
  readonly airborne: boolean;
  /** At least one wheel is down after a step that began with none down. */
  readonly landed: boolean;
  /** Upside down and slow for at least `reset.delay`. */
  readonly flipped: boolean;
  /** `reset.auto` set the car upright at the end of this step. */
  readonly reset: boolean;
  /** A speed clamp (`limits.maxSpeed` or `maxAngularSpeed`) acted. */
  readonly clamped: boolean;
}

export interface CarWheelState {
  readonly grounded: boolean;
  /** Suspension compression, 0 (extended) to `restLength`. */
  readonly compression: number;
  /** Normal load on the tyre (N). */
  readonly load: number;
  /** Signed slip angle (rad); 0 when airborne. */
  readonly slip: number;
  /** Rolling angle for wheel visuals (rad), wrapped to [-pi, pi]. */
  readonly spin: number;
  /** Current steering angle of this wheel (rad), positive right. */
  readonly steer: number;
}

export interface CarState {
  readonly position: readonly [number, number, number];
  readonly velocity: readonly [number, number, number];
  /** Unit quaternion [x, y, z, w]. */
  readonly orientation: readonly [number, number, number, number];
  readonly angularVelocity: readonly [number, number, number];
  /** Signed speed along the body's forward axis (m/s). */
  readonly forwardSpeed: number;
  readonly speed: number;
  /** Front-wheel steering angle (rad), positive right. */
  readonly steer: number;
  /** Handbrake grip loss in effect, 0 to 1. */
  readonly drift: number;
  readonly airTime: number;
  readonly flipTime: number;
  readonly time: number;
  readonly grounded: number;
  readonly wheels: readonly CarWheelState[];
}

/** A Transform-shaped pose: position and three.js 'XYZ' Euler angles. */
export interface CarPose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

/** A complete, JSON-safe copy of the dynamic state. Restorable only into a car with the same configuration. */
export interface CarSnapshot {
  readonly kind: 'car-handling';
  readonly version: 1;
  readonly fingerprint: number;
  readonly wheels: number;
  readonly values: readonly number[];
}

export interface CarHandling {
  readonly config: CarConfig;
  /** FNV-1a fingerprint of the configuration; snapshots carry it. */
  readonly fingerprint: number;
  /** Most ground queries one step can make. */
  readonly maxQueriesPerStep: number;
  /** Put the car at rest at a pose (yaw about world up, radians), wheels extended. */
  place(pose: {x: number; y: number; z: number; yaw?: number}): void;
  /** Set the car upright at rest: at its current position raised by `reset.lift`, keeping its heading, or at `pose`. */
  reset(pose?: {x: number; y: number; z: number; yaw?: number}): void;
  /** Advance `dt` seconds (0, 0.25]. Throws `RangeError` (state unchanged) on bad input or overload. */
  step(dt: number, controls: CarControls, ground: GroundQuery): CarStepResult;
  /** A frozen readout of the whole state (allocates; prefer the getters per tick). */
  read(): CarState;
  /** Write the pose into `out` (or a new record) for a Transform. */
  pose(out?: CarPose): CarPose;
  readonly forwardSpeed: number;
  readonly speed: number;
  readonly grounded: number;
  snapshot(): CarSnapshot;
  /** Replace the whole state from a snapshot. Validates first; a refused snapshot changes nothing. */
  restore(snapshot: CarSnapshot): void;
}

// State layout.
const P = 0,
  V = 3,
  Q = 6,
  W = 10,
  STEER = 13,
  DRIFT = 14,
  AIR = 15,
  FLIP = 16,
  TIME = 17,
  GROUNDED = 18,
  WHEEL0 = 19,
  WS = 5;
// Per-wheel fields.
const COMP = 0,
  CONTACT = 1,
  SPIN = 2,
  SLIP = 3,
  LOAD = 4;
const TAU = 6.283185307179586;
const CONTROL_KEYS = ['throttle', 'brake', 'steer', 'handbrake', 'pitch', 'roll'] as const;

/** Create a car from a validated or raw configuration (validated here). `math: 'deterministic'` uses dmath. */
export function createCarHandling(config: CarConfig, options: {math?: ScalarMathMode} = {}): CarHandling {
  const c = validateCarConfig(config);
  const m: ScalarMath = scalarMath(options.math);
  const fingerprint = carConfigFingerprint(c);
  const n = c.wheels.length,
    size = WHEEL0 + WS * n;
  const S = new Float64Array(size),
    Wk = new Float64Array(size);
  const hit: GroundHit = createGroundHit();
  // Derived constants.
  const mass = c.mass,
    g = c.gravity,
    [hx, hy, hz] = c.halfExtents;
  const ix = (mass / 3) * (hy * hy + hz * hz) * c.inertiaScale,
    iy = (mass / 3) * (hx * hx + hz * hz) * c.inertiaScale,
    iz = (mass / 3) * (hx * hx + hy * hy) * c.inertiaScale;
  const mw = mass / n,
    omega = TAU * c.suspension.frequency,
    k = mw * omega * omega,
    damp = 2 * c.suspension.damping * mw * omega,
    maxSpring = c.suspension.maxForce * mw * (g > 0 ? g : 9.81);
  const rest = c.suspension.restLength,
    radius = c.suspension.radius;
  const nFront = c.wheels.filter(w => w.front).length,
    nRear = n - nFront,
    nHand = c.wheels.filter(w => w.handbrake).length;
  const corners = c.body.contacts ? 8 : 0;
  const maxQueriesPerStep = (n + corners) * c.limits.maxSubsteps;
  // Per-wheel scratch for the second pass.
  const tmp = new Float64Array(n * 10); // cx,cy,cz (centre), nx,ny,nz, grip, rolling, load, contact

  const finiteVec = (...v: number[]) => v.every(Number.isFinite);
  // Body axes of the sub-step in progress (rotation matrix columns: L = +x left, U = +y, F = +z) and the output of
  // invI, kept in the closure so a sub-step allocates nothing.
  let Lx = 1,
    Ly = 0,
    Lz = 0,
    Ux = 0,
    Uy = 1,
    Uz = 0,
    Fx = 0,
    Fy = 0,
    Fz = 1,
    ox = 0,
    oy = 0,
    oz = 0;
  /** World inverse inertia applied to a vector, into (ox, oy, oz): sum over body axes of axis (axis . t) / I. */
  const invI = (tx: number, ty: number, tz: number) => {
    const a = (Lx * tx + Ly * ty + Lz * tz) / ix,
      b = (Ux * tx + Uy * ty + Uz * tz) / iy,
      d = (Fx * tx + Fy * ty + Fz * tz) / iz;
    ox = Lx * a + Ux * b + Fx * d;
    oy = Ly * a + Uy * b + Fy * d;
    oz = Lz * a + Uz * b + Fz * d;
  };
  /** Ask the ground port, with the hit record reset first so nothing from an earlier answer can leak into this one. */
  const cast = (
    ground: GroundQuery,
    ox2: number,
    oy2: number,
    oz2: number,
    dx: number,
    dy: number,
    dz: number,
    max: number,
  ) => {
    hit.distance = 0;
    hit.nx = 0;
    hit.ny = 1;
    hit.nz = 0;
    hit.grip = 1;
    hit.rolling = 0;
    if (!ground(ox2, oy2, oz2, dx, dy, dz, max, hit)) return false;
    checkHit(hit, max);
    // Normalise without overflow: scale by the largest component first.
    const big = Math.max(Math.abs(hit.nx), Math.abs(hit.ny), Math.abs(hit.nz));
    const sx = hit.nx / big,
      sy = hit.ny / big,
      sz = hit.nz / big,
      nl = Math.sqrt(sx * sx + sy * sy + sz * sz);
    hit.nx = sx / nl;
    hit.ny = sy / nl;
    hit.nz = sz / nl;
    return true;
  };
  const placeInto = (A: Float64Array, x: number, y: number, z: number, yaw: number) => {
    A.fill(0);
    A[P] = x + 0;
    A[P + 1] = y + 0;
    A[P + 2] = z + 0;
    A[Q + 1] = m.sin(yaw / 2) + 0;
    A[Q + 3] = m.cos(yaw / 2) + 0;
  };
  const checkPose = (pose: {x: number; y: number; z: number; yaw?: number}) => {
    if (!pose || typeof pose !== 'object') throw new RangeError('car-handling: pose required');
    const yaw = pose.yaw ?? 0;
    if (!finiteVec(pose.x, pose.y, pose.z, yaw) || Math.abs(yaw) > 1e6)
      throw new RangeError('car-handling: pose must be finite');
    const e = c.limits.extent;
    if (Math.abs(pose.x) > e || Math.abs(pose.y) > e || Math.abs(pose.z) > e)
      throw new RangeError('car-handling: pose is outside limits.extent');
    return yaw;
  };
  /** Heading of the body's forward axis about world up; 0 when it points straight up or down. */
  const headingOf = (A: Float64Array) => {
    const qx = A[Q]!,
      qy = A[Q + 1]!,
      qz = A[Q + 2]!,
      qw = A[Q + 3]!;
    const fx = 2 * (qx * qz + qw * qy),
      fz = 1 - 2 * (qx * qx + qy * qy);
    return fx * fx + fz * fz > 1e-12 ? m.atan2(fx, fz) : 0;
  };

  /** One sub-step on Wk. Returns queries made and whether a clamp acted (bit 1 << 20). */
  const substep = (h: number, ct: Required<{[K in (typeof CONTROL_KEYS)[number]]: number}>, ground: GroundQuery) => {
    const A = Wk;
    let queries = 0,
      clamped = false;
    const px = A[P]!,
      py = A[P + 1]!,
      pz = A[P + 2]!;
    let vx = A[V]!,
      vy = A[V + 1]!,
      vz = A[V + 2]!,
      wx = A[W]!,
      wy = A[W + 1]!,
      wz = A[W + 2]!;
    const qx = A[Q]!,
      qy = A[Q + 1]!,
      qz = A[Q + 2]!,
      qw = A[Q + 3]!;
    Lx = 1 - 2 * (qy * qy + qz * qz);
    Ly = 2 * (qx * qy + qw * qz);
    Lz = 2 * (qx * qz - qw * qy);
    Ux = 2 * (qx * qy - qw * qz);
    Uy = 1 - 2 * (qx * qx + qz * qz);
    Uz = 2 * (qy * qz + qw * qx);
    Fx = 2 * (qx * qz + qw * qy);
    Fy = 2 * (qy * qz - qw * qx);
    Fz = 1 - 2 * (qx * qx + qy * qy);
    // Rays reach back by this sub-step's travel as well, so a fast body cannot pass a surface between two casts.
    const reachBack = Math.sqrt(vx * vx + vy * vy + vz * vz) * h,
      lift = radius + reachBack;
    let fx = 0,
      fy = -mass * g,
      fz = 0,
      tx = 0,
      ty = 0,
      tz = 0;
    const vF = vx * Fx + vy * Fy + vz * Fz;

    // Steering toward the speed-limited target.
    const target = ct.steer * evalCurve(c.steering.maxAngle, Math.abs(vF));
    let steer = A[STEER]!;
    const returning = Math.abs(target) < Math.abs(steer) || target * steer < 0;
    const rate = (returning ? c.steering.returnRate : c.steering.rate) * h;
    steer = target > steer ? Math.min(target, steer + rate) : Math.max(target, steer - rate);
    A[STEER] = steer;
    // Handbrake grip loss: follows the lever up at once, recovers over recoveryTime.
    const hb = ct.handbrake;
    let drift = A[DRIFT]!;
    drift = hb >= drift ? hb : c.drift.recoveryTime > 0 ? Math.max(hb, drift - h / c.drift.recoveryTime) : hb;
    A[DRIFT] = drift;

    // Drive and foot brake from throttle and brake.
    let drive = 0,
      foot = 0;
    const t = ct.throttle,
      b = ct.brake;
    if (t > 0) {
      if (vF < -c.brakes.reverseSpeed) foot += t;
      else drive += t * c.engine.force * evalCurve(c.engine.curve, Math.max(0, vF) / c.engine.topSpeed);
    }
    if (b > 0) {
      if (c.brakes.brakeToReverse && t === 0 && vF < c.brakes.reverseSpeed)
        drive -= b * c.engine.reverseForce * evalCurve(c.engine.curve, Math.max(0, -vF) / c.engine.reverseTopSpeed);
      else foot += b;
    }
    if (foot > 1) foot = 1;

    // Pass 1: suspension rays and spring forces.
    let grounded = 0,
      drivenGrounded = 0;
    for (let i = 0; i < n; i++) {
      const wcfg = c.wheels[i]!,
        base = WHEEL0 + WS * i,
        s = i * 10;
      const [mx, my, mz] = wcfg.position;
      const ax = px + Lx * mx + Ux * my + Fx * mz,
        ay = py + Ly * mx + Uy * my + Fy * mz,
        az = pz + Lz * mx + Uz * my + Fz * mz;
      const length = lift + rest + radius;
      queries++;
      let contact = false,
        comp = 0,
        over = 0;
      if (cast(ground, ax + Ux * lift, ay + Uy * lift, az + Uz * lift, -Ux, -Uy, -Uz, length)) {
        const nx = hit.nx,
          ny = hit.ny,
          nz = hit.nz;
        // The surface must face the ray (n . -U < 0).
        if (nx * Ux + ny * Uy + nz * Uz > 0) {
          const reach = rest + radius - (hit.distance - lift);
          if (reach > 0) {
            contact = true;
            comp = Math.min(reach, rest);
            over = reach - comp;
            tmp[s + 3] = nx;
            tmp[s + 4] = ny;
            tmp[s + 5] = nz;
            tmp[s + 6] = hit.grip;
            tmp[s + 7] = hit.rolling;
          }
        }
      }
      // Wheel centre: down the suspension from the mount by the extended length.
      const ext = rest - comp;
      const cx = ax - Ux * ext,
        cy = ay - Uy * ext,
        cz = az - Uz * ext;
      tmp[s] = cx;
      tmp[s + 1] = cy;
      tmp[s + 2] = cz;
      tmp[s + 9] = contact ? 1 : 0;
      A[base + COMP] = comp;
      A[base + CONTACT] = contact ? 1 : 0;
      A[base + SLIP] = 0;
      if (!contact) {
        A[base + LOAD] = 0;
        tmp[s + 8] = 0;
        continue;
      }
      grounded++;
      if (wcfg.drive) drivenGrounded++;
      const rx = cx - px,
        ry = cy - py,
        rz = cz - pz;
      const pvx = vx + (wy * rz - wz * ry),
        pvy = vy + (wz * rx - wx * rz),
        pvz = vz + (wx * ry - wy * rx);
      const compVel = -(pvx * Ux + pvy * Uy + pvz * Uz);
      let spring = k * comp + k * c.suspension.bumpStop * over + damp * compVel;
      if (spring < 0) spring = 0;
      else if (spring > maxSpring) spring = maxSpring;
      A[base + LOAD] = spring;
      tmp[s + 8] = spring;
      fx += Ux * spring;
      fy += Uy * spring;
      fz += Uz * spring;
      tx += ry * (Uz * spring) - rz * (Uy * spring);
      ty += rz * (Ux * spring) - rx * (Uz * spring);
      tz += rx * (Uy * spring) - ry * (Ux * spring);
    }

    // Aerodynamics.
    const v2 = vx * vx + vy * vy + vz * vz,
      vlen = Math.sqrt(v2);
    fx -= c.aero.drag * vx * vlen;
    fy -= c.aero.drag * vy * vlen;
    fz -= c.aero.drag * vz * vlen;
    if (grounded > 0) {
      const down = Math.min(c.aero.downforce * v2, c.aero.maxDownforce);
      fx -= Ux * down;
      fy -= Uy * down;
      fz -= Uz * down;
    }

    // Everything but the tyres, for predicting where each patch is heading this sub-step.
    const ax0 = fx / mass,
      ay0 = fy / mass,
      az0 = fz / mass;

    // Pass 2: tyre forces.
    for (let i = 0; i < n; i++) {
      const s = i * 10;
      if (tmp[s + 9] !== 1) continue;
      const wcfg = c.wheels[i]!,
        base = WHEEL0 + WS * i;
      const nx = tmp[s + 3]!,
        ny = tmp[s + 4]!,
        nz = tmp[s + 5]!,
        surfaceGrip = tmp[s + 6]!,
        surfaceRolling = tmp[s + 7]!,
        load = tmp[s + 8]!;
      const delta = steer * wcfg.steer,
        cd = m.cos(delta),
        sd = m.sin(delta);
      // Wheel heading turned right by delta (toward -L), projected onto the contact plane.
      let hx2 = Fx * cd - Lx * sd,
        hy2 = Fy * cd - Ly * sd,
        hz2 = Fz * cd - Lz * sd;
      const along = hx2 * nx + hy2 * ny + hz2 * nz;
      hx2 -= nx * along;
      hy2 -= ny * along;
      hz2 -= nz * along;
      const hl = Math.sqrt(hx2 * hx2 + hy2 * hy2 + hz2 * hz2);
      if (hl < 1e-6) continue; // wheel plane parallel to the surface: no rolling direction
      hx2 /= hl;
      hy2 /= hl;
      hz2 /= hl;
      const sx = ny * hz2 - nz * hy2,
        sy = nz * hx2 - nx * hz2,
        sz = nx * hy2 - ny * hx2;
      // Contact patch and its velocity.
      const cpx = tmp[s]! - nx * radius,
        cpy = tmp[s + 1]! - ny * radius,
        cpz = tmp[s + 2]! - nz * radius;
      const rx = cpx - px,
        ry = cpy - py,
        rz = cpz - pz;
      const pvx = vx + (wy * rz - wz * ry),
        pvy = vy + (wz * rx - wx * rz),
        pvz = vz + (wx * ry - wy * rx);
      const vl = pvx * hx2 + pvy * hy2 + pvz * hz2,
        vs = pvx * sx + pvy * sy + pvz * sz;
      // Velocities predicted after this sub-step's non-tyre forces (gravity, springs, aerodynamics), so brakes, rolling
      // resistance and side grip can hold a car still, on a slope too.
      const vlp = vl + (ax0 * hx2 + ay0 * hy2 + az0 * hz2) * h,
        vsp = vs + (ax0 * sx + ay0 * sy + az0 * sz) * h;
      // Caps that stop, but never reverse, the motion: each grounded wheel may remove at most its share of the body's
      // momentum along the direction in one sub-step.
      const share = mass / (h * grounded);
      const stopCapL = Math.abs(vlp) * share,
        stopCapS = Math.abs(vsp) * share;
      // Longitudinal.
      let fl = wcfg.drive && drivenGrounded > 0 ? drive / drivenGrounded : 0;
      let resist = (c.tyre.rolling + surfaceRolling) * load;
      // An axle with no wheels hands its share of the foot brake to the other.
      const frontShare = nRear === 0 ? 1 : nFront === 0 ? 0 : c.brakes.bias;
      if (wcfg.front) resist += (foot * c.brakes.force * frontShare) / nFront;
      else resist += (foot * c.brakes.force * (1 - frontShare)) / nRear;
      if (wcfg.handbrake && nHand > 0) resist += (hb * c.brakes.handbrakeForce) / nHand;
      const applied = Math.min(resist, stopCapL);
      fl += vlp > 0 ? -applied : vlp < 0 ? applied : 0;
      // Lateral, from the slip angle through the grip curve.
      const alpha = m.atan2(Math.abs(vs), Math.max(Math.abs(vl), c.tyre.lowSpeed));
      const peak = c.tyre.peakSlip,
        slide = c.tyre.slideGrip;
      const shape =
        alpha <= peak ? alpha / peak : alpha >= 2 * peak ? slide : 1 + ((slide - 1) * (alpha - peak)) / peak;
      const handGrip = wcfg.handbrake ? 1 + (c.drift.handbrakeGrip - 1) * drift : 1;
      const maxS = c.tyre.grip * surfaceGrip * handGrip * load,
        maxL = c.tyre.driveGrip * surfaceGrip * load;
      let fs = Math.min(maxS * shape, stopCapS);
      fs = vsp > 0 ? -fs : vsp < 0 ? fs : 0;
      // Friction ellipse.
      const el = maxL > 0 ? fl / maxL : fl !== 0 ? Infinity : 0,
        es = maxS > 0 ? fs / maxS : 0;
      const e2 = el * el + es * es;
      if (e2 > 1) {
        if (!Number.isFinite(e2)) fl = 0;
        else {
          const scale = 1 / Math.sqrt(e2);
          fl *= scale;
          fs *= scale;
        }
      }
      A[base + SLIP] = vs >= 0 ? alpha : -alpha;
      let spin = A[base + SPIN]! + (vl / radius) * h;
      spin -= TAU * Math.round(spin / TAU);
      A[base + SPIN] = spin;
      const tfx = hx2 * fl + sx * fs,
        tfy = hy2 * fl + sy * fs,
        tfz = hz2 * fl + sz * fs;
      // Raise the point of application toward the centre-of-mass height.
      const up = c.tyre.forceHeight * -(rx * Ux + ry * Uy + rz * Uz);
      const ax = rx + Ux * up,
        ay = ry + Uy * up,
        az = rz + Uz * up;
      fx += tfx;
      fy += tfy;
      fz += tfz;
      tx += ay * tfz - az * tfy;
      ty += az * tfx - ax * tfz;
      tz += ax * tfy - ay * tfx;
    }

    // Velocity update.
    vx += (fx / mass) * h;
    vy += (fy / mass) * h;
    vz += (fz / mass) * h;
    invI(tx, ty, tz);
    wx += ox * h;
    wy += oy * h;
    wz += oz * h;
    if (grounded === 0) {
      // Air control as angular acceleration: pitch about L (nose up is negative), roll about F, yaw about U.
      const ap = -ct.pitch * c.air.pitch * h,
        ar = ct.roll * c.air.roll * h,
        ayaw = -ct.steer * c.air.yaw * h;
      wx += Lx * ap + Fx * ar + Ux * ayaw;
      wy += Ly * ap + Fy * ar + Uy * ayaw;
      wz += Lz * ap + Fz * ar + Uz * ayaw;
      // Levelling: rotate U toward world up (axis U x Y, magnitude sin of the tilt).
      const lv = c.air.levelling * h;
      wx += -Uz * lv;
      wz += Ux * lv;
      const ad = 1 / (1 + c.air.damping * h);
      wx *= ad;
      wy *= ad;
      wz *= ad;
    }
    const damping = 1 / (1 + c.aero.angularDamping * h);
    wx *= damping;
    wy *= damping;
    wz *= damping;

    // Body corner contacts: one velocity impulse pass, then a positional correction along the deepest normal.
    if (corners > 0) {
      let deepest = 0,
        dnx = 0,
        dny = 0,
        dnz = 0;
      const probe = hy + reachBack;
      for (let cI = 0; cI < 8; cI++) {
        const sxc = cI & 1 ? hx : -hx,
          syc = cI & 2 ? hy : -hy,
          szc = cI & 4 ? hz : -hz;
        const rx = Lx * sxc + Ux * syc + Fx * szc,
          ry = Ly * sxc + Uy * syc + Fy * szc,
          rz = Lz * sxc + Uz * syc + Fz * szc;
        queries++;
        if (!cast(ground, px + rx, py + ry + probe, pz + rz, 0, -1, 0, probe)) continue;
        const pen = probe - hit.distance;
        if (pen <= 0) continue;
        const nx = hit.nx,
          ny = hit.ny,
          nz = hit.nz;
        if (ny <= 0) continue;
        if (pen > deepest) {
          deepest = pen;
          dnx = nx;
          dny = ny;
          dnz = nz;
        }
        const pvx = vx + (wy * rz - wz * ry),
          pvy = vy + (wz * rx - wx * rz),
          pvz = vz + (wx * ry - wy * rx);
        const vn = pvx * nx + pvy * ny + pvz * nz;
        if (vn >= 0) continue;
        // Effective mass along n at r.
        const cx1 = ry * nz - rz * ny,
          cy1 = rz * nx - rx * nz,
          cz1 = rx * ny - ry * nx;
        invI(cx1, cy1, cz1);
        const kn = 1 / mass + (nx * (oy * rz - oz * ry) + ny * (oz * rx - ox * rz) + nz * (ox * ry - oy * rx));
        const j = -vn / kn;
        vx += (nx * j) / mass;
        vy += (ny * j) / mass;
        vz += (nz * j) / mass;
        wx += ox * j;
        wy += oy * j;
        wz += oz * j;
        // Coulomb friction against the remaining tangential velocity.
        const qvx = vx + (wy * rz - wz * ry),
          qvy = vy + (wz * rx - wx * rz),
          qvz = vz + (wx * ry - wy * rx);
        const qn = qvx * nx + qvy * ny + qvz * nz;
        let tvx = qvx - nx * qn,
          tvy = qvy - ny * qn,
          tvz = qvz - nz * qn;
        const tl = Math.sqrt(tvx * tvx + tvy * tvy + tvz * tvz);
        if (tl > 1e-9 && c.body.friction > 0) {
          tvx /= tl;
          tvy /= tl;
          tvz /= tl;
          const ct2x = ry * tvz - rz * tvy,
            ct2y = rz * tvx - rx * tvz,
            ct2z = rx * tvy - ry * tvx;
          invI(ct2x, ct2y, ct2z);
          const kt = 1 / mass + (tvx * (oy * rz - oz * ry) + tvy * (oz * rx - ox * rz) + tvz * (ox * ry - oy * rx));
          const jt = -Math.min(tl / kt, c.body.friction * j);
          vx += (tvx * jt) / mass;
          vy += (tvy * jt) / mass;
          vz += (tvz * jt) / mass;
          invI(ct2x * jt, ct2y * jt, ct2z * jt);
          wx += ox;
          wy += oy;
          wz += oz;
        }
      }
      if (deepest > 0.002) {
        const push = (deepest - 0.002) * 0.8;
        A[P] = px + dnx * push;
        A[P + 1] = py + dny * push;
        A[P + 2] = pz + dnz * push;
      }
    }

    // Clamps.
    const vmax = c.limits.maxSpeed,
      sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (sp > vmax) {
      const f = vmax / sp;
      vx *= f;
      vy *= f;
      vz *= f;
      clamped = true;
    }
    const amax = c.limits.maxAngularSpeed,
      as = Math.sqrt(wx * wx + wy * wy + wz * wz);
    if (as > amax) {
      const f = amax / as;
      wx *= f;
      wy *= f;
      wz *= f;
      clamped = true;
    }

    // Position and orientation.
    A[P] = A[P]! + vx * h;
    A[P + 1] = A[P + 1]! + vy * h;
    A[P + 2] = A[P + 2]! + vz * h;
    A[V] = vx;
    A[V + 1] = vy;
    A[V + 2] = vz;
    A[W] = wx;
    A[W + 1] = wy;
    A[W + 2] = wz;
    let nqx = qx + 0.5 * h * (wx * qw + wy * qz - wz * qy),
      nqy = qy + 0.5 * h * (-wx * qz + wy * qw + wz * qx),
      nqz = qz + 0.5 * h * (wx * qy - wy * qx + wz * qw),
      nqw = qw + 0.5 * h * (-wx * qx - wy * qy - wz * qz);
    const ql = Math.sqrt(nqx * nqx + nqy * nqy + nqz * nqz + nqw * nqw);
    nqx /= ql;
    nqy /= ql;
    nqz /= ql;
    nqw /= ql;
    A[Q] = nqx;
    A[Q + 1] = nqy;
    A[Q + 2] = nqz;
    A[Q + 3] = nqw;
    A[GROUNDED] = grounded;
    A[AIR] = grounded === 0 ? A[AIR]! + h : 0;
    A[TIME] = A[TIME]! + h;
    return clamped ? queries | (1 << 20) : queries;
  };

  const out = {throttle: 0, brake: 0, steer: 0, handbrake: 0, pitch: 0, roll: 0};
  /** Validate controls into one reused record (a refused value leaves the car untouched; the record is scratch). */
  const controlsOf = (ct: CarControls) => {
    if (!ct || typeof ct !== 'object') throw new RangeError('car-handling: controls required');
    for (const key of CONTROL_KEYS) {
      const v = ct[key] ?? 0;
      const lo = key === 'steer' || key === 'pitch' || key === 'roll' ? -1 : 0;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > 1)
        throw new RangeError(`car-handling: controls.${key} must be within [${lo}, 1]`);
      out[key] = v;
    }
    return out;
  };

  const commit = () => {
    for (let i = 0; i < size; i++) {
      const v = Wk[i]!;
      if (!Number.isFinite(v)) throw new RangeError('car-handling: the step produced a non-finite state');
    }
    const e = c.limits.extent;
    if (Math.abs(Wk[P]!) > e || Math.abs(Wk[P + 1]!) > e || Math.abs(Wk[P + 2]!) > e)
      throw new RangeError('car-handling: the step would leave limits.extent');
    // + 0 turns -0 into 0, so the state survives a JSON round trip bit for bit.
    for (let i = 0; i < size; i++) S[i] = Wk[i]! + 0;
  };

  const resetInto = (A: Float64Array, pose?: {x: number; y: number; z: number; yaw?: number}) => {
    if (pose) placeInto(A, pose.x, pose.y, pose.z, pose.yaw ?? 0);
    else {
      const yaw = headingOf(A),
        x = A[P]!,
        y = A[P + 1]! + c.reset.lift,
        z = A[P + 2]!,
        time = A[TIME]!;
      placeInto(A, x, y, z, yaw);
      A[TIME] = time;
    }
  };

  const wheelState = (i: number): CarWheelState => {
    const base = WHEEL0 + WS * i;
    return Object.freeze({
      grounded: S[base + CONTACT] === 1,
      compression: S[base + COMP]!,
      load: S[base + LOAD]!,
      slip: S[base + SLIP]!,
      spin: S[base + SPIN]!,
      steer: S[STEER]! * c.wheels[i]!.steer,
    });
  };
  const forward = () => {
    const qx = S[Q]!,
      qy = S[Q + 1]!,
      qz = S[Q + 2]!,
      qw = S[Q + 3]!;
    return (
      S[V]! * (2 * (qx * qz + qw * qy)) +
      S[V + 1]! * (2 * (qy * qz - qw * qx)) +
      S[V + 2]! * (1 - 2 * (qx * qx + qy * qy))
    );
  };

  const stepNow = (dt: number, controls: CarControls, ground: GroundQuery): CarStepResult => {
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0 || dt > 0.25)
      throw new RangeError('car-handling: dt must be within (0, 0.25]');
    if (typeof ground !== 'function') throw new RangeError('car-handling: ground query required');
    const ct = controlsOf(controls);
    const substeps = Math.max(1, Math.ceil(dt / c.limits.maxSubstep - 1e-9));
    if (substeps > c.limits.maxSubsteps)
      throw new RangeError(
        `car-handling: dt ${dt} needs ${substeps} sub-steps, more than limits.maxSubsteps ${c.limits.maxSubsteps}`,
      );
    const h = dt / substeps;
    const wasGrounded = S[GROUNDED]! > 0;
    Wk.set(S);
    let queries = 0,
      clamped = false;
    for (let i = 0; i < substeps; i++) {
      const r = substep(h, ct, ground);
      if (r & (1 << 20)) clamped = true;
      queries += r & ((1 << 20) - 1);
    }
    // Upside-down watch, once per step.
    const qx = Wk[Q]!,
      qz = Wk[Q + 2]!;
    const upDot = 1 - 2 * (qx * qx + qz * qz);
    const speed = Math.sqrt(Wk[V]! * Wk[V]! + Wk[V + 1]! * Wk[V + 1]! + Wk[V + 2]! * Wk[V + 2]!);
    Wk[FLIP] = upDot < c.reset.upDot && speed < c.reset.maxSpeed ? Wk[FLIP]! + dt : 0;
    const flipped = Wk[FLIP]! >= c.reset.delay && upDot < c.reset.upDot && speed < c.reset.maxSpeed;
    const reset = flipped && c.reset.auto;
    if (reset) resetInto(Wk);
    commit();
    const grounded = S[GROUNDED]!;
    return Object.freeze({
      substeps,
      queries,
      grounded,
      airborne: grounded === 0,
      landed: !wasGrounded && grounded > 0,
      flipped,
      reset,
      clamped,
    });
  };
  let busy = false;

  placeInto(S, 0, 0, 0, 0);
  return Object.freeze({
    config: c,
    fingerprint,
    maxQueriesPerStep,
    place(pose: {x: number; y: number; z: number; yaw?: number}) {
      if (busy) throw new RangeError('car-handling: place called from inside a step');
      const yaw = checkPose(pose);
      placeInto(S, pose.x, pose.y, pose.z, yaw);
    },
    reset(pose?: {x: number; y: number; z: number; yaw?: number}) {
      if (busy) throw new RangeError('car-handling: reset called from inside a step');
      if (pose !== undefined) checkPose(pose);
      Wk.set(S);
      resetInto(Wk, pose);
      commit();
    },
    step(dt: number, controls: CarControls, ground: GroundQuery): CarStepResult {
      if (busy) throw new RangeError('car-handling: step called from inside a step (a port re-entered the car)');
      busy = true;
      try {
        return stepNow(dt, controls, ground);
      } finally {
        busy = false;
      }
    },
    read(): CarState {
      const wheels: CarWheelState[] = [];
      for (let i = 0; i < n; i++) wheels.push(wheelState(i));
      const vx = S[V]!,
        vy = S[V + 1]!,
        vz = S[V + 2]!;
      return Object.freeze({
        position: Object.freeze([S[P]!, S[P + 1]!, S[P + 2]!] as const),
        velocity: Object.freeze([vx, vy, vz] as const),
        orientation: Object.freeze([S[Q]!, S[Q + 1]!, S[Q + 2]!, S[Q + 3]!] as const),
        angularVelocity: Object.freeze([S[W]!, S[W + 1]!, S[W + 2]!] as const),
        forwardSpeed: forward(),
        speed: Math.sqrt(vx * vx + vy * vy + vz * vz),
        steer: S[STEER]!,
        drift: S[DRIFT]!,
        airTime: S[AIR]!,
        flipTime: S[FLIP]!,
        time: S[TIME]!,
        grounded: S[GROUNDED]!,
        wheels: Object.freeze(wheels),
      });
    },
    pose(out?: CarPose): CarPose {
      const o = out ?? {x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0};
      const qx = S[Q]!,
        qy = S[Q + 1]!,
        qz = S[Q + 2]!,
        qw = S[Q + 3]!;
      const m11 = 1 - 2 * (qy * qy + qz * qz),
        m12 = 2 * (qx * qy - qw * qz),
        m13 = 2 * (qx * qz + qw * qy),
        m22 = 1 - 2 * (qx * qx + qz * qz),
        m23 = 2 * (qy * qz - qw * qx),
        m32 = 2 * (qy * qz + qw * qx),
        m33 = 1 - 2 * (qx * qx + qy * qy);
      const s = Math.max(-1, Math.min(1, m13));
      o.x = S[P]!;
      o.y = S[P + 1]!;
      o.z = S[P + 2]!;
      o.ry = m.atan2(s, Math.sqrt(1 - s * s));
      if (Math.abs(s) < 0.9999999) {
        o.rx = m.atan2(-m23, m33);
        o.rz = m.atan2(-m12, m11);
      } else {
        o.rx = m.atan2(m32, m22);
        o.rz = 0;
      }
      return o;
    },
    get forwardSpeed() {
      return forward();
    },
    get speed() {
      return Math.sqrt(S[V]! * S[V]! + S[V + 1]! * S[V + 1]! + S[V + 2]! * S[V + 2]!);
    },
    get grounded() {
      return S[GROUNDED]!;
    },
    snapshot(): CarSnapshot {
      return Object.freeze({
        kind: 'car-handling' as const,
        version: 1 as const,
        fingerprint,
        wheels: n,
        values: Object.freeze(Array.from(S)),
      });
    },
    restore(snapshot: CarSnapshot) {
      if (busy) throw new RangeError('car-handling: restore called from inside a step');
      if (!snapshot || typeof snapshot !== 'object') throw new RangeError('car-handling: snapshot required');
      if (snapshot.kind !== 'car-handling' || snapshot.version !== 1)
        throw new RangeError('car-handling: not a version 1 car snapshot');
      if (snapshot.fingerprint !== fingerprint || snapshot.wheels !== n)
        throw new RangeError('car-handling: the snapshot was taken with a different configuration');
      const values = snapshot.values;
      if (!Array.isArray(values) || values.length !== size)
        throw new RangeError('car-handling: snapshot values have the wrong length');
      for (const v of values)
        if (typeof v !== 'number' || !Number.isFinite(v))
          throw new RangeError('car-handling: snapshot values must be finite');
      const ql = Math.sqrt(values[Q]! ** 2 + values[Q + 1]! ** 2 + values[Q + 2]! ** 2 + values[Q + 3]! ** 2);
      if (Math.abs(ql - 1) > 1e-6) throw new RangeError('car-handling: snapshot orientation is not a unit quaternion');
      let contacts = 0;
      for (let i = 0; i < n; i++) {
        const base = WHEEL0 + WS * i,
          contact = values[base + CONTACT];
        if (contact !== 0 && contact !== 1) throw new RangeError('car-handling: snapshot wheel contact must be 0 or 1');
        contacts += contact;
        if (!(values[base + COMP]! >= 0 && values[base + COMP]! <= rest) || !(values[base + LOAD]! >= 0))
          throw new RangeError('car-handling: snapshot wheel compression or load is out of range');
        if (
          !(Math.abs(values[base + SPIN]!) <= Math.PI + 1e-9) ||
          !(Math.abs(values[base + SLIP]!) <= Math.PI / 2 + 1e-9)
        )
          throw new RangeError('car-handling: snapshot wheel spin or slip is out of range');
      }
      const e = c.limits.extent;
      if (Math.abs(values[P]!) > e || Math.abs(values[P + 1]!) > e || Math.abs(values[P + 2]!) > e)
        throw new RangeError('car-handling: snapshot position is outside limits.extent');
      if (
        values[GROUNDED] !== contacts ||
        !(Math.abs(values[STEER]!) <= 1.2) ||
        !(values[DRIFT]! >= 0 && values[DRIFT]! <= 1) ||
        !(values[AIR]! >= 0) ||
        !(values[FLIP]! >= 0) ||
        !(values[TIME]! >= 0)
      )
        throw new RangeError('car-handling: snapshot fields are out of range');
      for (let i = 0; i < size; i++) S[i] = values[i]! + 0;
    },
  });
}

function checkHit(hit: GroundHit, maxDistance: number) {
  const distance = hit.distance,
    nx = hit.nx,
    ny = hit.ny,
    nz = hit.nz,
    grip = hit.grip,
    rolling = hit.rolling;
  if (typeof distance !== 'number' || !(distance >= 0 && distance <= maxDistance * (1 + 1e-9)))
    throw new RangeError('car-handling: ground hit distance must be within [0, maxDistance]');
  if (
    typeof nx !== 'number' ||
    typeof ny !== 'number' ||
    typeof nz !== 'number' ||
    !Number.isFinite(nx) ||
    !Number.isFinite(ny) ||
    !Number.isFinite(nz) ||
    (nx === 0 && ny === 0 && nz === 0)
  )
    throw new RangeError('car-handling: ground hit normal must be finite and nonzero');
  if (typeof grip !== 'number' || !(grip >= 0 && grip <= 4))
    throw new RangeError('car-handling: ground hit grip must be within [0, 4]');
  if (typeof rolling !== 'number' || !(rolling >= 0 && rolling <= 1))
    throw new RangeError('car-handling: ground hit rolling must be within [0, 1]');
}
