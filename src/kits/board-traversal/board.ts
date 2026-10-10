/**
 * kits/board-traversal/board: one rider's fixed-step board controller. Pure: no world, clock, input service or
 * collision data. The caller supplies controls plus a ground query, and optionally authored rails and a wall slide,
 * every step, and reads the pose back.
 *
 * Modes: rolling (push, coast, brake, carve, follow the ground, charge an ollie), air (exact ballistic arc, board spin,
 * an optional creator trick timer), grind (travel along an authored rail with balance), manual (rolling on two wheels
 * with balance) and bail (slide to a stop, then recover). Landing compares the board's yaw with the travel direction.
 *
 * The whole state is one Float64Array. A step works on a copy and commits only when every sub-step finished and the
 * result is finite and inside the configured extent; any throw (from a port or a refusal) leaves the rider unchanged.
 */
import {scalarMath, type ScalarMath, type ScalarMathMode} from '../../author';
import {boardConfigFingerprint, validateBoardConfig, type BoardConfig} from './config';
import {railData, SEG, type Rails} from './rails';

/** A ground hit, written by the ground port. */
export interface BoardGroundHit {
  /** Surface height (m), at or below the query's `below`. */
  height: number;
  /** Upward surface normal; normalised by the kit, `ny` must be positive. */
  nx: number;
  ny: number;
  nz: number;
}
/**
 * The ground port: the highest walkable surface at (x, z) at or below `below`, written into `out`; false for none.
 * Passing the start-of-sub-step height makes surfaces above the board one-way. Deterministic and side-effect free.
 */
export type BoardGround = (x: number, z: number, below: number, out: BoardGroundHit) => boolean;
/**
 * The optional wall port: resolve a planar move of (dx, dz) from (x, z) against the creator's walls, writing where the
 * board ends into `out` (never further than the move). The character kit adapter is `characterSlide`.
 */
export type BoardSlide = (x: number, z: number, dx: number, dz: number, out: {x: number; z: number}) => void;

export interface BoardWorld {
  readonly ground: BoardGround;
  readonly rails?: Rails | undefined;
  readonly slide?: BoardSlide | undefined;
}

/** One step's controls. Missing fields are neutral; out-of-range values are refused. */
export interface BoardControls {
  /** Held: push (one kick per `push.interval`) while rolling below `push.maxSpeed`. */
  readonly push?: boolean;
  /** [0, 1]. */
  readonly brake?: number;
  /** [-1, 1], positive right: carves on the ground, spins in the air, corrects balance on rails and in manuals. */
  readonly steer?: number;
  /** Held: crouch and charge; the release pops (on the ground, in a manual or on a rail). */
  readonly ollie?: boolean;
  /** -1 nose manual, 0 none, 1 manual. Held. */
  readonly manual?: -1 | 0 | 1;
  /** Seconds of a creator-defined air trick to start this step (0 for none): [0, 10]. Ignored unless airborne and idle. */
  readonly trick?: number;
}

export type BoardMode = 'rolling' | 'air' | 'grind' | 'manual' | 'bail';
export type BoardEvent =
  | 'push'
  | 'pop'
  | 'launch'
  | 'land-clean'
  | 'land-sketchy'
  | 'switch'
  | 'grind-start'
  | 'grind-end'
  | 'manual-start'
  | 'manual-end'
  | 'trick-start'
  | 'bail'
  | 'recover';
export type BailReason = 'angle' | 'impact' | 'trick' | 'balance' | 'wall' | 'manual';

export interface BoardStepResult {
  readonly mode: BoardMode;
  /** What happened this step, in order. */
  readonly events: readonly BoardEvent[];
  readonly substeps: number;
  readonly groundQueries: number;
  /** Rail segments examined. */
  readonly railChecks: number;
}

export interface BoardState {
  readonly mode: BoardMode;
  readonly position: readonly [number, number, number];
  /** World velocity (m/s). */
  readonly velocity: readonly [number, number, number];
  /** Signed speed along the travel heading on the ground, or along the rail (m/s). */
  readonly speed: number;
  /** Travel heading on the ground (rad). */
  readonly heading: number;
  /** Board yaw (rad): equals the heading (or its reverse when switched) on the ground; spins in the air. */
  readonly yaw: number;
  /** 1 riding regular, -1 switched (fakie). */
  readonly stance: number;
  /** Ollie charge, 0 to 1. */
  readonly charge: number;
  /** Balance in a grind or manual, -1 to 1 (beyond is a fall). */
  readonly balance: number;
  /** Seconds left of the current trick (0 when none). */
  readonly trick: number;
  readonly airTime: number;
  /** Rail id while grinding, else null. */
  readonly rail: string | null;
  readonly bailReason: BailReason | null;
  readonly time: number;
}

export interface BoardPose {
  x: number;
  y: number;
  z: number;
  /** Board yaw for a Transform's `ry`. */
  ry: number;
}

export interface BoardSnapshot {
  readonly kind: 'board-traversal';
  readonly version: 1;
  readonly fingerprint: number;
  readonly values: readonly number[];
}

export interface Board {
  readonly config: BoardConfig;
  readonly fingerprint: number;
  /** The arithmetic this board was created with; pass it to `characterSlide` so walls follow it too. */
  readonly math: ScalarMathMode;
  /** Forget a held ollie and its charge without popping (for example when the rider loses its controller). */
  cancelInput(): void;
  /** Most ground queries and rail segment checks one step can make, for a rail set of `segments`. */
  maxWorkPerStep(segments: number): {groundQueries: number; railChecks: number};
  /** Put the rider at rest, rolling, at (x, y, z) facing `yaw`. */
  place(pose: {x: number; y: number; z: number; yaw?: number}): void;
  step(dt: number, controls: BoardControls, world: BoardWorld): BoardStepResult;
  read(): BoardState;
  pose(out?: BoardPose): BoardPose;
  readonly mode: BoardMode;
  readonly speed: number;
  snapshot(): BoardSnapshot;
  restore(snapshot: BoardSnapshot): void;
}

// State layout.
const X = 0,
  Y = 1,
  Z = 2,
  VX = 3,
  VY = 4,
  VZ = 5,
  SPEED = 6,
  HEAD = 7,
  YAW = 8,
  MODE = 9,
  CHARGE = 10,
  PUSHCD = 11,
  BAL = 12,
  BALRATE = 13,
  BALSIGN = 14,
  RAIL = 15,
  SEGI = 16,
  ALONG = 17,
  RDIR = 18,
  TRICK = 19,
  BAILT = 20,
  STANCE = 21,
  AIRT = 22,
  NX = 23,
  NY = 24,
  NZ = 25,
  PREVOLLIE = 26,
  MANDIR = 27,
  RAILREV = 28,
  REASON = 29,
  TIME = 30,
  BAILAIR = 31,
  LASTRAIL = 32,
  RAILSEGS = 33,
  SIZE = 34;
const ROLL = 0,
  AIR = 1,
  GRIND = 2,
  MANUAL = 3,
  BAIL = 4;
const MODES: readonly BoardMode[] = ['rolling', 'air', 'grind', 'manual', 'bail'];
const REASONS: readonly BailReason[] = ['angle', 'impact', 'trick', 'balance', 'wall', 'manual'];
const PI = Math.PI;

export function createBoard(config: BoardConfig, options: {math?: ScalarMathMode} = {}): Board {
  const c = validateBoardConfig(config);
  const m: ScalarMath = scalarMath(options.math);
  const fingerprint = boardConfigFingerprint(c);
  const S = new Float64Array(SIZE),
    A = new Float64Array(SIZE);
  const hit: BoardGroundHit = {height: 0, nx: 0, ny: 1, nz: 0};
  const slid = {x: 0, z: 0};
  const g = c.gravity;
  const wrap = (a: number) => a - 2 * PI * Math.round(a / (2 * PI));

  let events: BoardEvent[] = [];
  /** The rail snapshot of the last step, to name the rail being ground in `read()`. */
  let lastRails: Rails | undefined;
  let groundQueries = 0,
    railChecks = 0,
    /** A trick starts at most once per step, whatever the sub-step count. */
    trickUsed = false,
    busy = false,
    /** A port tried to re-enter the board during this step; the step is refused even if the port caught that. */
    reentered = false;

  const queryGround = (world: BoardWorld, x: number, z: number, below: number) => {
    groundQueries++;
    if (!world.ground(x, z, below, hit)) return false;
    const height = hit.height,
      nx = hit.nx,
      ny = hit.ny,
      nz = hit.nz;
    if (typeof height !== 'number' || !Number.isFinite(height) || height > below + 1e-9)
      throw new RangeError('board-traversal: ground height must be finite and at or below the query');
    if (
      typeof nx !== 'number' ||
      typeof ny !== 'number' ||
      typeof nz !== 'number' ||
      !Number.isFinite(nx) ||
      !Number.isFinite(nz) ||
      !Number.isFinite(ny) ||
      !(ny > 0)
    )
      throw new RangeError('board-traversal: ground normal must be finite with a positive y');
    // Normalise without overflow: scale by the largest component first.
    const big = Math.max(Math.abs(nx), ny, Math.abs(nz)),
      sx = nx / big,
      sy = ny / big,
      sz = nz / big,
      l = Math.sqrt(sx * sx + sy * sy + sz * sz);
    hit.nx = sx / l;
    hit.ny = sy / l;
    hit.nz = sz / l;
    if (!(hit.ny > 0)) throw new RangeError('board-traversal: ground normal is too close to horizontal');
    return true;
  };
  /** The planar displacement the last `moveXZ` achieved, and the share of the requested speed it kept. */
  let movedX = 0,
    movedZ = 0,
    kept = 1;
  /**
   * Planar move through the optional wall port. Returns the share of the move lost against a wall, measured
   * perpendicular to what was achieved (0 to 1); `kept` is the achieved length over the requested length.
   */
  const moveXZ = (world: BoardWorld, dx: number, dz: number) => {
    const x = A[X]!,
      z = A[Z]!;
    movedX = dx;
    movedZ = dz;
    kept = 1;
    if (!world.slide || (dx === 0 && dz === 0)) {
      A[X] = x + dx;
      A[Z] = z + dz;
      return 0;
    }
    slid.x = x + dx;
    slid.z = z + dz;
    world.slide(x, z, dx, dz, slid);
    const rx = slid.x - x,
      rz = slid.z - z;
    if (!Number.isFinite(rx) || !Number.isFinite(rz) || rx * rx + rz * rz > (dx * dx + dz * dz) * (1 + 1e-9) + 1e-18)
      throw new RangeError('board-traversal: slide must end finite and no further than the move');
    A[X] = slid.x;
    A[Z] = slid.z;
    movedX = rx;
    movedZ = rz;
    const want = Math.sqrt(dx * dx + dz * dz);
    kept = Math.min(1, Math.sqrt(rx * rx + rz * rz) / want);
    const lx = dx - rx,
      lz = dz - rz;
    return Math.min(1, Math.sqrt(lx * lx + lz * lz) / want);
  };
  /** After a wall slide on the ground, travel along what was achieved: the speed keeps only that share. */
  const followWall = (s: number) => {
    if (kept < 1 && movedX * movedX + movedZ * movedZ > 1e-18) {
      A[HEAD] = s >= 0 ? m.atan2(movedX, movedZ) : m.atan2(-movedX, -movedZ);
      A[YAW] = A[STANCE]! > 0 ? A[HEAD]! : wrap(A[HEAD]! + PI);
    }
    return s * kept;
  };
  const bail = (reason: BailReason, airborne: boolean) => {
    A[MODE] = BAIL;
    A[BAILT] = c.bail.time;
    A[REASON] = REASONS.indexOf(reason);
    A[BAILAIR] = airborne ? 1 : 0;
    A[CHARGE] = 0;
    A[TRICK] = 0;
    A[BAL] = 0;
    A[BALRATE] = 0;
    events.push('bail');
  };
  const popSpeed = () =>
    c.ollie.chargeTime > 0 ? c.ollie.minPop + (c.ollie.maxPop - c.ollie.minPop) * A[CHARGE]! : c.ollie.maxPop;
  /** Go airborne with velocity v. */
  const launch = (vx: number, vy: number, vz: number, event: BoardEvent) => {
    A[MODE] = AIR;
    A[VX] = vx;
    A[VY] = vy;
    A[VZ] = vz;
    A[AIRT] = 0;
    A[CHARGE] = 0;
    events.push(event);
  };
  /** Unit tangent of the travel heading on the stored ground normal, into t. */
  const t = {x: 0, y: 0, z: 1};
  const tangent = (heading: number, nx: number, ny: number, nz: number) => {
    let hx = m.sin(heading),
      hz = m.cos(heading),
      hy = 0;
    const d = hx * nx + hz * nz;
    hx -= nx * d;
    hy -= ny * d;
    hz -= nz * d;
    const l = Math.sqrt(hx * hx + hy * hy + hz * hz);
    t.x = hx / l;
    t.y = hy / l;
    t.z = hz / l;
  };
  /** Speed lost to friction-like deceleration `decel` over h, never crossing zero. */
  const slow = (s: number, decel: number, h: number) => {
    const d = decel * h;
    return s > d ? s - d : s < -d ? s + d : 0;
  };
  const balanceStep = (h: number, steer: number, inst: number, dist: number, ctl: number) => {
    const rate = A[BALRATE]! + (inst * A[BAL]! + dist * A[BALSIGN]! - ctl * steer) * h;
    A[BALRATE] = rate;
    A[BAL] = A[BAL]! + rate * h;
  };

  /** One sub-step in rolling or manual mode. */
  const ground = (h: number, ct: Ctl, world: BoardWorld) => {
    const manual = A[MODE] === MANUAL;
    tangent(A[HEAD]!, A[NX]!, A[NY]!, A[NZ]!);
    const tx = t.x,
      ty = t.y,
      tz = t.z;
    let s = A[SPEED]!;
    // Push.
    A[PUSHCD] = Math.max(0, A[PUSHCD]! - h);
    if (!manual && ct.push && A[PUSHCD] === 0 && s < c.push.maxSpeed && c.push.impulse > 0) {
      s = Math.min(c.push.maxSpeed, Math.max(s, 0) + c.push.impulse);
      A[PUSHCD] = c.push.interval;
      events.push('push');
    }
    // Slope, resistance, brake, drag, clamp.
    s += -g * ty * h;
    s = slow(s, c.rolling.resistance + ct.brake * c.rolling.brake + (manual ? c.manual.friction : 0), h);
    s -= c.rolling.drag * s * Math.abs(s) * h;
    if (s > c.rolling.maxSpeed) s = c.rolling.maxSpeed;
    else if (s < -c.rolling.maxSpeed) s = -c.rolling.maxSpeed;
    // Carve (or balance in a manual).
    if (manual) balanceStep(h, ct.steer, c.manual.instability, c.manual.disturbance, c.manual.control);
    else A[HEAD] = wrap(A[HEAD]! - ct.steer * c.carve.rate * Math.min(1, Math.abs(s) / c.carve.fullSpeed) * h);
    A[YAW] = A[STANCE]! > 0 ? A[HEAD]! : wrap(A[HEAD]! + PI);
    // Ollie charge and pop.
    if (ct.ollie) A[CHARGE] = c.ollie.chargeTime > 0 ? Math.min(1, A[CHARGE]! + h / c.ollie.chargeTime) : 1;
    const pop = !ct.ollie && A[PREVOLLIE] === 1;
    // Move along the tangent, through walls.
    const blocked = moveXZ(world, s * h * tx, s * h * tz);
    if (blocked > 0) {
      const impact = Math.abs(s) * blocked;
      s = followWall(s);
      if (impact > c.bail.wallSpeed) {
        A[SPEED] = s;
        if (manual) {
          events.push('manual-end');
          A[MANDIR] = 2;
        }
        bail('wall', false);
        return;
      }
    }
    A[SPEED] = s;
    const yPred = A[Y]! + s * h * ty;
    if (pop) {
      A[Y] = yPred;
      if (manual) events.push('manual-end');
      launch(s * tx, s * ty + popSpeed(), s * tz, 'pop');
      return;
    }
    // Follow the ground: step up within snap, follow down while gravity and `stick` can hold the board on.
    const found = queryGround(world, A[X]!, A[Z]!, Math.max(A[Y]!, yPred) + c.landing.snap);
    let leave = !found || hit.height < yPred - c.landing.snap;
    if (!leave) {
      // Vertical speed the new surface allows, against what the board carries.
      tangent(A[HEAD]!, hit.nx, hit.ny, hit.nz);
      if (s * ty - s * t.y > g * h + c.landing.stick) leave = true;
    }
    if (leave) {
      A[Y] = yPred;
      if (manual) events.push('manual-end');
      launch(s * tx, s * ty, s * tz, 'launch');
      return;
    }
    A[Y] = hit.height;
    A[NX] = hit.nx;
    A[NY] = hit.ny;
    A[NZ] = hit.nz;
    // Manuals start, end and fail. After a fall the manual input must be released before another starts (MANDIR 2).
    if (!manual && A[MANDIR] === 2 && ct.manual === 0) A[MANDIR] = 0;
    if (!manual && A[MANDIR] !== 2 && ct.manual !== 0 && Math.abs(s) >= c.manual.minSpeed) {
      A[MODE] = MANUAL;
      A[MANDIR] = ct.manual;
      A[BAL] = 0;
      A[BALRATE] = 0;
      A[BALSIGN] = ct.manual;
      events.push('manual-start');
    } else if (manual) {
      if (ct.manual !== A[MANDIR] || Math.abs(s) < c.manual.minSpeed) {
        A[MODE] = ROLL;
        events.push('manual-end');
      } else if (Math.abs(A[BAL]!) >= 1) {
        events.push('manual-end');
        A[MANDIR] = 2;
        if (c.manual.fail === 'bail') bail('manual', false);
        else A[MODE] = ROLL;
      }
    }
  };

  /** Closest catchable rail point for an airborne board that moved from (x0, y0, z0) to (x1, y1, z1). */
  const findRail = (world: BoardWorld, y0: number, x1: number, y1: number, z1: number) => {
    if (!world.rails) return -1;
    const {segments} = railData(world.rails);
    const vx = A[VX]!,
      vz = A[VZ]!,
      hv = Math.sqrt(vx * vx + vz * vz);
    if (A[VY]! > 0 || hv < c.grind.minSpeed) return -1;
    const r = c.grind.snapRadius,
      cosMax = m.cos(c.grind.maxEntryAngle);
    let best = -1,
      bestD = Infinity,
      bestU = 0;
    const n = world.rails.segmentCount;
    const skip = A[AIRT]! < c.grind.recatchTime ? A[LASTRAIL]! : -1;
    for (let k = 0; k < n; k++) {
      railChecks++;
      if (segments[k * SEG + 7] === skip) continue;
      const o = k * SEG;
      const ax = segments[o]!,
        ay = segments[o + 1]!,
        az = segments[o + 2]!,
        bx = segments[o + 3]!,
        by = segments[o + 4]!,
        bz = segments[o + 5]!;
      if (
        x1 < Math.min(ax, bx) - r ||
        x1 > Math.max(ax, bx) + r ||
        z1 < Math.min(az, bz) - r ||
        z1 > Math.max(az, bz) + r
      )
        continue;
      const dx = bx - ax,
        dz = bz - az,
        len2 = dx * dx + dz * dz;
      if (len2 < 1e-8) continue; // vertical segment: not grindable from above
      let u = ((x1 - ax) * dx + (z1 - az) * dz) / len2;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const px = ax + dx * u,
        pz = az + dz * u,
        py = ay + (by - ay) * u;
      const d2 = (x1 - px) * (x1 - px) + (z1 - pz) * (z1 - pz);
      if (d2 > r * r) continue;
      if (!(y1 <= py + c.grind.snapAbove && y0 >= py - c.grind.snapBelow)) continue;
      const cos = Math.abs(vx * dx + vz * dz) / (hv * Math.sqrt(len2));
      if (cos < cosMax) continue;
      if (d2 < bestD) {
        bestD = d2;
        best = k;
        bestU = u;
      }
    }
    if (best >= 0) A[ALONG] = bestU * segments[best * SEG + 6]!; // stashed for the caller
    return best;
  };
  const railY = (world: BoardWorld, k: number, along: number) => {
    const {segments} = railData(world.rails);
    const o = k * SEG,
      l = segments[o + 6]!;
    return segments[o + 1]! + ((segments[o + 4]! - segments[o + 1]!) * along) / l;
  };
  const startGrind = (world: BoardWorld, k: number) => {
    const {segments} = railData(world.rails);
    const o = k * SEG,
      l = segments[o + 6]!;
    const dx = (segments[o + 3]! - segments[o]!) / l,
      dy = (segments[o + 4]! - segments[o + 1]!) / l,
      dz = (segments[o + 5]! - segments[o + 2]!) / l;
    const along = A[ALONG]!;
    const vAlong = A[VX]! * dx + A[VY]! * dy + A[VZ]! * dz;
    const dir = vAlong >= 0 ? 1 : -1;
    // Entry side for the balance disturbance: which side of the rail the board points.
    const travel = m.atan2(dx * dir, dz * dir);
    const off = wrap(A[YAW]! - travel);
    A[MODE] = GRIND;
    A[RAIL] = segments[o + 7]!;
    A[SEGI] = k;
    A[RDIR] = dir;
    A[SPEED] = Math.abs(vAlong);
    A[RAILREV] = world.rails!.revision;
    A[RAILSEGS] = world.rails!.segmentCount;
    A[BAL] = 0;
    A[BALRATE] = 0;
    A[BALSIGN] = off >= 0 ? 1 : -1;
    A[X] = segments[o]! + dx * along;
    A[Y] = segments[o + 1]! + dy * along;
    A[Z] = segments[o + 2]! + dz * along;
    A[VX] = dx * dir * A[SPEED]!;
    A[VY] = dy * dir * A[SPEED]!;
    A[VZ] = dz * dir * A[SPEED]!;
    events.push('grind-start');
  };

  const air = (h: number, ct: Ctl, world: BoardWorld) => {
    A[AIRT] = A[AIRT]! + h;
    if (ct.trick > 0 && !trickUsed && A[TRICK] === 0 && A[MODE] === AIR) {
      A[TRICK] = ct.trick;
      trickUsed = true;
      events.push('trick-start');
    }
    A[TRICK] = Math.max(0, A[TRICK]! - h);
    if (A[MODE] === AIR) A[YAW] = wrap(A[YAW]! - ct.steer * c.air.spinRate * h);
    // Exact ballistic arc, with terminal speed.
    const y0 = A[Y]!;
    let vy = A[VY]!;
    const floor = -c.air.maxFall;
    let dy: number;
    if (vy <= floor) dy = vy * h;
    else {
      const tHit = (vy - floor) / g;
      if (g === 0 || tHit >= h) {
        dy = vy * h - 0.5 * g * h * h;
        vy -= g * h;
      } else {
        dy = vy * tHit - 0.5 * g * tHit * tHit + floor * (h - tHit);
        vy = floor;
      }
    }
    A[VY] = vy;
    const blocked = moveXZ(world, A[VX]! * h, A[VZ]! * h);
    if (blocked > 0) {
      const hv = Math.sqrt(A[VX]! * A[VX]! + A[VZ]! * A[VZ]!);
      // Keep only the motion along the wall.
      A[VX] = movedX / h;
      A[VZ] = movedZ / h;
      if (hv * blocked > c.bail.wallSpeed && A[MODE] === AIR) bail('wall', true);
    }
    const x1 = A[X]!,
      z1 = A[Z]!,
      y1 = y0 + dy;
    A[Y] = y1;
    // Rails first (a rail above the ground wins), then the ground swept from the start height.
    const k = A[MODE] === AIR ? findRail(world, y0, x1, y1, z1) : -1;
    const landed = queryGround(world, x1, z1, y0 + 1e-9) && hit.height >= y1;
    if (k >= 0 && (!landed || railY(world, k, A[ALONG]!) >= hit.height)) {
      if (A[TRICK]! > 0) {
        A[Y] = railY(world, k, A[ALONG]!);
        bail('trick', true);
        return;
      }
      startGrind(world, k);
      return;
    }
    if (!landed) return;
    A[Y] = hit.height;
    A[NX] = hit.nx;
    A[NY] = hit.ny;
    A[NZ] = hit.nz;
    const vx = A[VX]!,
      vz = A[VZ]!,
      down = -A[VY]!;
    if (A[MODE] === BAIL) {
      // A bail that was airborne slides out on the ground; landing clears the re-catch delay.
      A[BAILAIR] = 0;
      A[LASTRAIL] = -1;
      A[HEAD] = vx * vx + vz * vz > 1e-12 ? m.atan2(vx, vz) : A[HEAD]!;
      A[SPEED] = Math.sqrt(vx * vx + vz * vz);
      A[VX] = 0;
      A[VY] = 0;
      A[VZ] = 0;
      return;
    }
    const hv = Math.sqrt(vx * vx + vz * vz);
    A[LASTRAIL] = -1;
    const stance = A[STANCE]!;
    // Forward of the board in the stance it is ridden: the nose, or the tail when riding switched.
    const forward = stance > 0 ? A[YAW]! : wrap(A[YAW]! + PI);
    const travel = hv > 1e-6 ? m.atan2(vx, vz) : forward;
    let off = Math.abs(wrap(forward - travel)),
      next = stance;
    if (c.landing.allowFakie && off > PI / 2) {
      // Landing nearer backwards than forwards: ride away in the other stance.
      off = PI - off;
      next = -stance;
    }
    const switched = next !== stance;
    // Any landing, judged or not, now travels the way the board was moving.
    A[HEAD] = hv > 1e-6 ? travel : A[HEAD]!;
    A[SPEED] = hv;
    if (A[TRICK]! > 0 || down > c.landing.maxImpact || off > c.landing.sketchy) {
      A[VX] = 0;
      A[VY] = 0;
      A[VZ] = 0;
      return bail(A[TRICK]! > 0 ? 'trick' : down > c.landing.maxImpact ? 'impact' : 'angle', false);
    }
    // Ride away along the board, with the speed the surface keeps.
    A[MODE] = ROLL;
    A[STANCE] = next;
    A[HEAD] = next > 0 ? A[YAW]! : wrap(A[YAW]! + PI);
    tangent(A[HEAD]!, hit.nx, hit.ny, hit.nz);
    let s = Math.max(0, vx * t.x + A[VY]! * t.y + vz * t.z);
    if (off > c.landing.clean) {
      s *= c.landing.sketchyKeep;
      events.push('land-sketchy');
    } else events.push('land-clean');
    if (switched) events.push('switch');
    A[SPEED] = s;
    A[VX] = 0;
    A[VY] = 0;
    A[VZ] = 0;
    A[AIRT] = 0;
  };

  const grind = (h: number, ct: Ctl, world: BoardWorld) => {
    const rail = A[RAIL]!;
    const data = world.rails && world.rails.revision === A[RAILREV] ? railData(world.rails) : undefined;
    const starts = data?.starts;
    if (
      !data ||
      !starts ||
      world.rails!.segmentCount !== A[RAILSEGS] ||
      rail < 0 ||
      rail + 1 >= starts.length ||
      A[SEGI]! < starts[rail]! ||
      A[SEGI]! >= starts[rail + 1]!
    ) {
      // The rail data changed under the board (or never matched it): leave with the velocity it had along the rail.
      events.push('grind-end');
      A[LASTRAIL] = -1;
      launch(A[VX]!, A[VY]!, A[VZ]!, 'launch');
      return;
    }
    const segments = data.segments;
    const first = starts[rail]!,
      last = starts[rail + 1]! - 1;
    let k = A[SEGI]!,
      along = A[ALONG]!;
    const dir = A[RDIR]!;
    // The current segment: offset, length and unit direction (closure scalars, no allocation).
    let dO = 0,
      dL = 1,
      ddx = 0,
      ddy = 0,
      ddz = 1;
    const useSeg = (i: number) => {
      dO = i * SEG;
      dL = segments[dO + 6]!;
      ddx = (segments[dO + 3]! - segments[dO]!) / dL;
      ddy = (segments[dO + 4]! - segments[dO + 1]!) / dL;
      ddz = (segments[dO + 5]! - segments[dO + 2]!) / dL;
    };
    useSeg(k);
    let s = A[SPEED]! - g * ddy * dir * h;
    s = slow(s, c.grind.friction + ct.brake * c.rolling.brake, h);
    if (s > c.rolling.maxSpeed) s = c.rolling.maxSpeed;
    else if (s < 0) s = 0;
    balanceStep(h, ct.steer, c.grind.instability, c.grind.disturbance, c.grind.control);
    if (ct.ollie) A[CHARGE] = c.ollie.chargeTime > 0 ? Math.min(1, A[CHARGE]! + h / c.ollie.chargeTime) : 1;
    const pop = !ct.ollie && A[PREVOLLIE] === 1;
    A[LASTRAIL] = rail;
    const exit = (vy: number, event: BoardEvent) => {
      events.push('grind-end');
      launch(ddx * dir * s, ddy * dir * s + vy, ddz * dir * s, event);
    };
    if (Math.abs(A[BAL]!) >= 1) {
      events.push('grind-end');
      A[VX] = ddx * dir * s;
      A[VY] = ddy * dir * s;
      A[VZ] = ddz * dir * s;
      return bail('balance', true);
    }
    if (pop) return exit(popSpeed(), 'pop');
    if (s <= 0 || s < c.grind.minSpeed) {
      A[SPEED] = s;
      return exit(0, 'launch');
    }
    // Walk along the polyline (at most every segment of this rail).
    along += s * h * dir;
    for (let guard = 0; guard <= last - first + 1; guard++) {
      if (along > dL) {
        if (k === last) break;
        along -= dL;
        k++;
        useSeg(k);
      } else if (along < 0) {
        if (k === first) break;
        k--;
        useSeg(k);
        along += dL;
      } else break;
    }
    A[SPEED] = s;
    if (along > dL || along < 0) {
      // Off the end: carry on through the air from the rail's end point.
      const endAlong = along > dL ? dL : 0;
      A[X] = segments[dO]! + ddx * endAlong;
      A[Y] = segments[dO + 1]! + ddy * endAlong;
      A[Z] = segments[dO + 2]! + ddz * endAlong;
      return exit(c.grind.exitHop, 'launch');
    }
    A[SEGI] = k;
    A[ALONG] = along;
    A[X] = segments[dO]! + ddx * along;
    A[Y] = segments[dO + 1]! + ddy * along;
    A[Z] = segments[dO + 2]! + ddz * along;
    // The velocity along the rail, kept so any exit (including changed rail data) leaves with it.
    A[VX] = ddx * dir * s;
    A[VY] = ddy * dir * s;
    A[VZ] = ddz * dir * s;
  };

  const bailed = (h: number, world: BoardWorld) => {
    if (A[BAILAIR] === 1) return air(h, NEUTRAL, world);
    A[BAILT] = Math.max(0, A[BAILT]! - h);
    let s = slow(A[SPEED]!, c.bail.decel, h);
    tangent(A[HEAD]!, A[NX]!, A[NY]!, A[NZ]!);
    if (moveXZ(world, s * h * t.x, s * h * t.z) > 0) s = followWall(s);
    const yPred = A[Y]! + s * h * t.y;
    if (
      queryGround(world, A[X]!, A[Z]!, Math.max(A[Y]!, yPred) + c.landing.snap) &&
      hit.height >= yPred - c.landing.snap
    ) {
      A[Y] = hit.height;
      A[NX] = hit.nx;
      A[NY] = hit.ny;
      A[NZ] = hit.nz;
    } else {
      A[Y] = yPred;
      A[BAILAIR] = 1;
      A[VX] = s * t.x;
      A[VY] = s * t.y;
      A[VZ] = s * t.z;
    }
    A[SPEED] = s;
    if (A[BAILT] === 0 && A[BAILAIR] === 0) {
      A[MODE] = ROLL;
      A[REASON] = -1;
      A[BAL] = 0;
      A[BALRATE] = 0;
      A[YAW] = A[STANCE]! > 0 ? A[HEAD]! : wrap(A[HEAD]! + PI);
      events.push('recover');
    }
  };

  const controlsOf = (ct: BoardControls): Ctl => {
    if (!ct || typeof ct !== 'object') throw new RangeError('board-traversal: controls required');
    const push = ct.push ?? false,
      ollie = ct.ollie ?? false,
      brake = ct.brake ?? 0,
      steer = ct.steer ?? 0,
      manual = ct.manual ?? 0,
      trick = ct.trick ?? 0;
    if (typeof push !== 'boolean' || typeof ollie !== 'boolean')
      throw new RangeError('board-traversal: push and ollie must be booleans');
    if (typeof brake !== 'number' || !(brake >= 0 && brake <= 1))
      throw new RangeError('board-traversal: brake must be within [0, 1]');
    if (typeof steer !== 'number' || !(steer >= -1 && steer <= 1))
      throw new RangeError('board-traversal: steer must be within [-1, 1]');
    if (manual !== -1 && manual !== 0 && manual !== 1)
      throw new RangeError('board-traversal: manual must be -1, 0 or 1');
    if (typeof trick !== 'number' || !(trick >= 0 && trick <= 10))
      throw new RangeError('board-traversal: trick must be within [0, 10] seconds');
    return {push, ollie, brake, steer, manual, trick};
  };

  const placeInto = (x: number, y: number, z: number, yaw: number) => {
    S.fill(0);
    S[X] = x + 0;
    S[Y] = y + 0;
    S[Z] = z + 0;
    S[HEAD] = wrap(yaw) + 0;
    S[YAW] = S[HEAD]!;
    S[STANCE] = 1;
    S[NY] = 1;
    S[RAIL] = -1;
    S[SEGI] = -1;
    S[REASON] = -1;
    S[LASTRAIL] = -1;
  };
  placeInto(0, 0, 0, 0);

  const commit = () => {
    if (reentered) throw new RangeError('board-traversal: a port re-entered the board during this step');
    for (let i = 0; i < SIZE; i++)
      if (!Number.isFinite(A[i]!)) throw new RangeError('board-traversal: the step produced a non-finite state');
    const e = c.limits.extent;
    if (Math.abs(A[X]!) > e || Math.abs(A[Y]!) > e || Math.abs(A[Z]!) > e)
      throw new RangeError('board-traversal: the step would leave limits.extent');
    for (let i = 0; i < SIZE; i++) S[i] = A[i]! + 0;
  };

  const stepNow = (dt: number, controls: BoardControls, world: BoardWorld): BoardStepResult => {
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0 || dt > 0.25)
      throw new RangeError('board-traversal: dt must be within (0, 0.25]');
    if (!world || typeof world.ground !== 'function') throw new RangeError('board-traversal: world.ground required');
    if (world.slide !== undefined && typeof world.slide !== 'function')
      throw new RangeError('board-traversal: world.slide must be a function');
    if (world.rails !== undefined) railData(world.rails);
    const ct = controlsOf(controls);
    const substeps = Math.max(1, Math.ceil(dt / c.limits.maxSubstep - 1e-9));
    if (substeps > c.limits.maxSubsteps)
      throw new RangeError(
        `board-traversal: dt ${dt} needs ${substeps} sub-steps, more than limits.maxSubsteps ${c.limits.maxSubsteps}`,
      );
    const h = dt / substeps;
    events = [];
    trickUsed = false;
    groundQueries = 0;
    railChecks = 0;
    A.set(S);
    for (let i = 0; i < substeps; i++) {
      // The ollie release is an edge against the previous sub-step, so it is seen once.
      const mode = A[MODE]!;
      if (mode === ROLL || mode === MANUAL) ground(h, ct, world);
      else if (mode === AIR) air(h, ct, world);
      else if (mode === GRIND) grind(h, ct, world);
      else bailed(h, world);
      A[PREVOLLIE] = ct.ollie ? 1 : 0;
      A[TIME] = A[TIME]! + h;
    }
    commit();
    lastRails = world.rails;
    return Object.freeze({
      mode: MODES[S[MODE]!]!,
      events: Object.freeze(events),
      substeps,
      groundQueries,
      railChecks,
    });
  };

  return Object.freeze({
    config: c,
    fingerprint,
    math: options.math ?? 'platform',
    maxWorkPerStep(segments: number) {
      if (!Number.isSafeInteger(segments) || segments < 0)
        throw new RangeError('board-traversal: segments must be >= 0');
      return {groundQueries: c.limits.maxSubsteps, railChecks: c.limits.maxSubsteps * segments};
    },
    place(pose: {x: number; y: number; z: number; yaw?: number}) {
      if (busy) {
        reentered = true;
        throw new RangeError('board-traversal: place called from inside a step');
      }
      const yaw = pose?.yaw ?? 0;
      if (!pose || ![pose.x, pose.y, pose.z, yaw].every(Number.isFinite) || Math.abs(yaw) > 1e6)
        throw new RangeError('board-traversal: pose must be finite');
      const e = c.limits.extent;
      if (Math.abs(pose.x) > e || Math.abs(pose.y) > e || Math.abs(pose.z) > e)
        throw new RangeError('board-traversal: pose is outside limits.extent');
      placeInto(pose.x, pose.y, pose.z, yaw);
    },
    step(dt: number, controls: BoardControls, world: BoardWorld): BoardStepResult {
      if (busy) {
        reentered = true;
        throw new RangeError('board-traversal: step called from inside a step (a port re-entered the board)');
      }
      busy = true;
      reentered = false;
      try {
        return stepNow(dt, controls, world);
      } finally {
        busy = false;
      }
    },
    cancelInput() {
      if (busy) {
        reentered = true;
        throw new RangeError('board-traversal: cancelInput called from inside a step');
      }
      // Forget a held ollie (no pop on its release) and its charge, e.g. when the rider loses its controller.
      S[PREVOLLIE] = 0;
      S[CHARGE] = 0;
    },
    read(): BoardState {
      const mode = S[MODE]!;
      const speed = S[SPEED]!;
      let vx = S[VX]!,
        vy = S[VY]!,
        vz = S[VZ]!;
      if (mode === ROLL || mode === MANUAL || (mode === BAIL && S[BAILAIR] === 0)) {
        const nx = S[NX]!,
          ny = S[NY]!,
          nz = S[NZ]!;
        let hx = m.sin(S[HEAD]!),
          hz = m.cos(S[HEAD]!),
          hy = 0;
        const d = hx * nx + hz * nz;
        hx -= nx * d;
        hy -= ny * d;
        hz -= nz * d;
        const l = Math.sqrt(hx * hx + hy * hy + hz * hz);
        vx = (speed * hx) / l;
        vy = (speed * hy) / l;
        vz = (speed * hz) / l;
      }
      const rail = mode === GRIND ? S[RAIL]! : -1;
      return Object.freeze({
        mode: MODES[mode]!,
        position: Object.freeze([S[X]!, S[Y]!, S[Z]!] as const),
        velocity: Object.freeze([vx, vy, vz] as const),
        speed,
        heading: S[HEAD]!,
        yaw: S[YAW]!,
        stance: S[STANCE]!,
        charge: S[CHARGE]!,
        balance: S[BAL]!,
        trick: S[TRICK]!,
        airTime: S[AIRT]!,
        rail: rail >= 0 && lastRails ? (lastRails.ids[rail] ?? null) : null,
        bailReason: S[REASON]! >= 0 ? REASONS[S[REASON]!]! : null,
        time: S[TIME]!,
      });
    },
    pose(out?: BoardPose): BoardPose {
      const o = out ?? {x: 0, y: 0, z: 0, ry: 0};
      o.x = S[X]!;
      o.y = S[Y]!;
      o.z = S[Z]!;
      o.ry = S[YAW]!;
      return o;
    },
    get mode() {
      return MODES[S[MODE]!]!;
    },
    get speed() {
      return S[SPEED]!;
    },
    snapshot(): BoardSnapshot {
      return Object.freeze({
        kind: 'board-traversal' as const,
        version: 1 as const,
        fingerprint,
        values: Object.freeze(Array.from(S)),
      });
    },
    restore(snapshot: BoardSnapshot) {
      if (busy) {
        reentered = true;
        throw new RangeError('board-traversal: restore called from inside a step');
      }
      if (!snapshot || typeof snapshot !== 'object' || snapshot.kind !== 'board-traversal' || snapshot.version !== 1)
        throw new RangeError('board-traversal: not a version 1 board snapshot');
      if (snapshot.fingerprint !== fingerprint)
        throw new RangeError('board-traversal: the snapshot was taken with a different configuration');
      const v = snapshot.values;
      if (!Array.isArray(v) || v.length !== SIZE)
        throw new RangeError('board-traversal: snapshot values have the wrong length');
      for (const x of v)
        if (typeof x !== 'number' || !Number.isFinite(x))
          throw new RangeError('board-traversal: snapshot values must be finite');
      const int = (i: number, lo: number, hi: number) => Number.isInteger(v[i]) && v[i]! >= lo && v[i]! <= hi;
      if (
        !int(MODE, 0, 4) ||
        !int(RAIL, -1, 1 << 20) ||
        !int(SEGI, -1, 1 << 20) ||
        !int(REASON, -1, REASONS.length - 1) ||
        !(v[STANCE] === 1 || v[STANCE] === -1) ||
        !(v[RDIR] === 1 || v[RDIR] === -1 || v[RDIR] === 0) ||
        !int(PREVOLLIE, 0, 1) ||
        !int(BAILAIR, 0, 1) ||
        !int(LASTRAIL, -1, 1 << 20) ||
        !int(MANDIR, -1, 2) ||
        !int(BALSIGN, -1, 1) ||
        !int(RAILSEGS, 0, 1 << 20) ||
        !(v[NY]! > 0) ||
        !(Math.abs(v[NX]! * v[NX]! + v[NY]! * v[NY]! + v[NZ]! * v[NZ]! - 1) <= 1e-6) ||
        !(Math.abs(v[HEAD]!) <= PI + 1e-9 && Math.abs(v[YAW]!) <= PI + 1e-9) ||
        !(v[CHARGE]! >= 0 && v[CHARGE]! <= 1) ||
        !(v[TRICK]! >= 0 && v[BAILT]! >= 0 && v[AIRT]! >= 0 && v[PUSHCD]! >= 0 && v[TIME]! >= 0) ||
        Math.abs(v[X]!) > c.limits.extent ||
        Math.abs(v[Y]!) > c.limits.extent ||
        Math.abs(v[Z]!) > c.limits.extent
      )
        throw new RangeError('board-traversal: snapshot fields are out of range');
      if (v[MODE] === GRIND && (v[RAIL]! < 0 || v[SEGI]! < 0))
        throw new RangeError('board-traversal: a grinding snapshot must name a rail');
      for (let i = 0; i < SIZE; i++) S[i] = v[i]! + 0;
      lastRails = undefined; // `read().rail` names a rail again after the next step
    },
  });
}

interface Ctl {
  push: boolean;
  ollie: boolean;
  brake: number;
  steer: number;
  manual: -1 | 0 | 1;
  trick: number;
}
const NEUTRAL: Ctl = Object.freeze({push: false, ollie: false, brake: 0, steer: 0, manual: 0, trick: 0});
