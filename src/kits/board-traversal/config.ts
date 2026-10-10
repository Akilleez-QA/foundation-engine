/**
 * kits/board-traversal/config: the complete, validated tuning of one rider, the two stock presets and the patch helper.
 * Units are SI (m, s, rad). Yaw follows the engine frame: +z at yaw 0, positive yaw turns +z toward +x (left).
 */

export interface BoardConfig {
  /** m/s², [0, 100]. */
  readonly gravity: number;
  readonly push: Readonly<{
    /** Speed added by one push (m/s): [0, 20]. */
    impulse: number;
    /** Seconds between pushes while push is held: [0.05, 5]. */
    interval: number;
    /** Pushing adds nothing at or above this speed (m/s): [0, 50]. */
    maxSpeed: number;
  }>;
  readonly rolling: Readonly<{
    /** Constant rolling deceleration (m/s²): [0, 20]. */
    resistance: number;
    /** Quadratic drag (1/m): [0, 1]. */
    drag: number;
    /** Deceleration at full brake (m/s²): [0, 50]. */
    brake: number;
    /** Speed clamp on the ground and on rails (m/s): (0, 100]. */
    maxSpeed: number;
  }>;
  readonly carve: Readonly<{
    /** Turn rate at full steer and at or above `fullSpeed` (rad/s): [0, 20]. */
    rate: number;
    /** Speed at which the full turn rate is reached; slower carves scale down (m/s): (0, 50]. */
    fullSpeed: number;
  }>;
  readonly ollie: Readonly<{
    /** Upward speed of an uncharged pop (m/s): [0, 30]. */
    minPop: number;
    /** Upward speed of a fully charged pop (m/s): [minPop, 30]. */
    maxPop: number;
    /** Seconds of holding to reach a full charge: [0, 5]. 0 always gives `maxPop`. */
    chargeTime: number;
  }>;
  readonly air: Readonly<{
    /** Board spin rate in the air at full steer (rad/s): [0, 40]. */
    spinRate: number;
    /** Terminal fall speed (m/s): (0, 200]. */
    maxFall: number;
  }>;
  readonly landing: Readonly<{
    /** Board-to-travel angle for a clean landing (rad): [0, pi/2]. */
    clean: number;
    /** Largest angle that still lands, sketchy (rad): [clean, pi/2]. Beyond it the rider bails. */
    sketchy: number;
    /** Share of speed kept after a sketchy landing: [0, 1]. */
    sketchyKeep: number;
    /** Landing faster than this downward bails (m/s): (0, 200]. */
    maxImpact: number;
    /** A landing nearer backwards than forwards rides away switched (fakie) instead of judging the angle from forward. */
    allowFakie: boolean;
    /** On the ground, a surface up to this much higher is stepped onto and a lower one within it is followed (m): [0, 1]. */
    snap: number;
    /** Extra vertical speed change a ground contact absorbs before the board leaves the surface (m/s): [0, 20]. */
    stick: number;
  }>;
  readonly grind: Readonly<{
    /** Horizontal catch distance from a rail (m): [0, 2]. */
    snapRadius: number;
    /** The board may end the tick this far above the rail and still catch it (m): [0, 2]. */
    snapAbove: number;
    /** ...and may have started the tick this far below it (m): [0, 2]. */
    snapBelow: number;
    /** Largest angle between travel and rail that catches (rad): [0, pi/2]. */
    maxEntryAngle: number;
    /** Below this speed along the rail the board drops off (m/s): [0, 20]. */
    minSpeed: number;
    /** Deceleration while grinding (m/s²): [0, 50]. */
    friction: number;
    /** Upward speed added when leaving the end of a rail (m/s): [0, 20]. */
    exitHop: number;
    /** Seconds after leaving a rail before the same rail can be caught again: [0, 5]. */
    recatchTime: number;
    /** Balance instability (1/s²): [0, 100]. Positive makes balance run away from centre. */
    instability: number;
    /** Balance push toward the entry side, per second squared: [0, 100]. 0 with instability 0 never falls. */
    disturbance: number;
    /** Balance correction at full steer (1/s²): [0, 100]. */
    control: number;
  }>;
  readonly manual: Readonly<{
    /** Extra deceleration in a manual (m/s²): [0, 50]. */
    friction: number;
    /** Slowest speed that starts or keeps a manual (m/s): [0, 20]. */
    minSpeed: number;
    readonly instability: number;
    readonly disturbance: number;
    readonly control: number;
    /** What losing a manual's balance does: drop back to rolling, or bail. */
    fail: 'roll' | 'bail';
  }>;
  readonly bail: Readonly<{
    /** Seconds before the rider is back on the board: [0, 30]. */
    time: number;
    /** Deceleration while bailed (m/s²): [0, 100]. */
    decel: number;
    /** Being stopped by a wall faster than this bails (m/s): (0, 200]. */
    wallSpeed: number;
  }>;
  readonly limits: Readonly<{
    /** Longest sub-step (s): [1/1000, 1/15]. */
    maxSubstep: number;
    /** Most sub-steps a step may take: integer [1, 16]. */
    maxSubsteps: number;
    /** A step leaving |x|, |y| or |z| beyond this is refused (m): (0, 1e7]. */
    extent: number;
  }>;
}

type Section<T> = T extends Readonly<Record<string, unknown>> ? Partial<T> : T;
/** A partial configuration merged one level deep. */
export type BoardConfigPatch = {readonly [K in keyof BoardConfig]?: Section<BoardConfig[K]>};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/**
 * Generic starting points, not any particular game's values.
 * - `arcade`: quick pushes, big forgiving pops, wide landing and rail windows, mild balance.
 * - `sim-lite`: slower pushes, lower pops, strict landings, narrow rail windows and real balance work.
 */
export const BOARD_PRESETS: Readonly<Record<'arcade' | 'sim-lite', BoardConfig>> = deepFreeze({
  arcade: {
    gravity: 18,
    push: {impulse: 2, interval: 0.45, maxSpeed: 9},
    rolling: {resistance: 0.25, drag: 0.002, brake: 6, maxSpeed: 25},
    carve: {rate: 2.6, fullSpeed: 3},
    ollie: {minPop: 5, maxPop: 7.5, chargeTime: 0.3},
    air: {spinRate: 7, maxFall: 40},
    landing: {
      clean: 0.5,
      sketchy: 1.1,
      sketchyKeep: 0.7,
      maxImpact: 25,
      allowFakie: true,
      snap: 0.08,
      stick: 1.5,
    },
    grind: {
      snapRadius: 0.5,
      snapAbove: 0.35,
      snapBelow: 0.15,
      maxEntryAngle: 0.9,
      minSpeed: 1,
      friction: 0.6,
      exitHop: 1,
      recatchTime: 0.3,
      instability: 1.5,
      disturbance: 0.4,
      control: 6,
    },
    manual: {friction: 0.4, minSpeed: 1, instability: 1.5, disturbance: 0.5, control: 6, fail: 'roll'},
    bail: {time: 1.2, decel: 8, wallSpeed: 8},
    limits: {maxSubstep: 1 / 120, maxSubsteps: 8, extent: 1e6},
  },
  'sim-lite': {
    gravity: 9.81,
    push: {impulse: 1.5, interval: 0.65, maxSpeed: 7},
    rolling: {resistance: 0.35, drag: 0.004, brake: 4.5, maxSpeed: 20},
    carve: {rate: 1.8, fullSpeed: 4},
    ollie: {minPop: 2.8, maxPop: 4.2, chargeTime: 0.35},
    air: {spinRate: 5, maxFall: 50},
    landing: {
      clean: 0.3,
      sketchy: 0.75,
      sketchyKeep: 0.55,
      maxImpact: 9,
      allowFakie: true,
      snap: 0.05,
      stick: 1,
    },
    grind: {
      snapRadius: 0.3,
      snapAbove: 0.2,
      snapBelow: 0.08,
      maxEntryAngle: 0.6,
      minSpeed: 1.5,
      friction: 1.2,
      exitHop: 0.3,
      recatchTime: 0.4,
      instability: 4,
      disturbance: 1,
      control: 7,
    },
    manual: {friction: 0.8, minSpeed: 1.5, instability: 4, disturbance: 1.2, control: 7, fail: 'bail'},
    bail: {time: 2, decel: 10, wallSpeed: 5},
    limits: {maxSubstep: 1 / 120, maxSubsteps: 8, extent: 1e6},
  },
});

const num = (path: string, v: unknown, min: number, max: number, openMin = false): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v > max || (openMin ? v <= min : v < min))
    throw new RangeError(`board-traversal: ${path} must be within ${openMin ? '(' : '['}${min}, ${max}]`);
  return v;
};
const section = (path: string, v: unknown): Readonly<Record<string, unknown>> => {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new RangeError(`board-traversal: ${path} must be an object`);
  return {...v};
};
const HALF_PI = Math.PI / 2;

/** Validate a complete configuration and return a frozen copy. Throws `RangeError` naming the first bad value. */
export function validateBoardConfig(input: unknown): BoardConfig {
  const c = section('config', input);
  const pu = section('push', c.push),
    ro = section('rolling', c.rolling),
    ca = section('carve', c.carve),
    ol = section('ollie', c.ollie),
    ai = section('air', c.air),
    la = section('landing', c.landing),
    gr = section('grind', c.grind),
    ma = section('manual', c.manual),
    ba = section('bail', c.bail),
    li = section('limits', c.limits);
  const minPop = num('ollie.minPop', ol.minPop, 0, 30),
    clean = num('landing.clean', la.clean, 0, HALF_PI);
  if (typeof la.allowFakie !== 'boolean') throw new RangeError('board-traversal: landing.allowFakie must be a boolean');
  if (ma.fail !== 'roll' && ma.fail !== 'bail')
    throw new RangeError("board-traversal: manual.fail must be 'roll' or 'bail'");
  const steps = li.maxSubsteps;
  if (!Number.isSafeInteger(steps)) throw new RangeError('board-traversal: limits.maxSubsteps must be an integer');
  return deepFreeze({
    gravity: num('gravity', c.gravity, 0, 100),
    push: {
      impulse: num('push.impulse', pu.impulse, 0, 20),
      interval: num('push.interval', pu.interval, 0.05, 5),
      maxSpeed: num('push.maxSpeed', pu.maxSpeed, 0, 50),
    },
    rolling: {
      resistance: num('rolling.resistance', ro.resistance, 0, 20),
      drag: num('rolling.drag', ro.drag, 0, 1),
      brake: num('rolling.brake', ro.brake, 0, 50),
      maxSpeed: num('rolling.maxSpeed', ro.maxSpeed, 0, 100, true),
    },
    carve: {rate: num('carve.rate', ca.rate, 0, 20), fullSpeed: num('carve.fullSpeed', ca.fullSpeed, 0, 50, true)},
    ollie: {
      minPop,
      maxPop: num('ollie.maxPop', ol.maxPop, minPop, 30),
      chargeTime: num('ollie.chargeTime', ol.chargeTime, 0, 5),
    },
    air: {spinRate: num('air.spinRate', ai.spinRate, 0, 40), maxFall: num('air.maxFall', ai.maxFall, 0, 200, true)},
    landing: {
      clean,
      sketchy: num('landing.sketchy', la.sketchy, clean, HALF_PI),
      sketchyKeep: num('landing.sketchyKeep', la.sketchyKeep, 0, 1),
      maxImpact: num('landing.maxImpact', la.maxImpact, 0, 200, true),
      allowFakie: la.allowFakie,
      snap: num('landing.snap', la.snap, 0, 1),
      stick: num('landing.stick', la.stick, 0, 20),
    },
    grind: {
      snapRadius: num('grind.snapRadius', gr.snapRadius, 0, 2),
      snapAbove: num('grind.snapAbove', gr.snapAbove, 0, 2),
      snapBelow: num('grind.snapBelow', gr.snapBelow, 0, 2),
      maxEntryAngle: num('grind.maxEntryAngle', gr.maxEntryAngle, 0, HALF_PI),
      minSpeed: num('grind.minSpeed', gr.minSpeed, 0, 20),
      friction: num('grind.friction', gr.friction, 0, 50),
      exitHop: num('grind.exitHop', gr.exitHop, 0, 20),
      recatchTime: num('grind.recatchTime', gr.recatchTime, 0, 5),
      instability: num('grind.instability', gr.instability, 0, 100),
      disturbance: num('grind.disturbance', gr.disturbance, 0, 100),
      control: num('grind.control', gr.control, 0, 100),
    },
    manual: {
      friction: num('manual.friction', ma.friction, 0, 50),
      minSpeed: num('manual.minSpeed', ma.minSpeed, 0, 20),
      instability: num('manual.instability', ma.instability, 0, 100),
      disturbance: num('manual.disturbance', ma.disturbance, 0, 100),
      control: num('manual.control', ma.control, 0, 100),
      fail: ma.fail,
    },
    bail: {
      time: num('bail.time', ba.time, 0, 30),
      decel: num('bail.decel', ba.decel, 0, 100),
      wallSpeed: num('bail.wallSpeed', ba.wallSpeed, 0, 200, true),
    },
    limits: {
      maxSubstep: num('limits.maxSubstep', li.maxSubstep, 1 / 1000, 1 / 15),
      maxSubsteps: num('limits.maxSubsteps', steps, 1, 16),
      extent: num('limits.extent', li.extent, 0, 1e7, true),
    },
  });
}

/** A validated, frozen configuration from a preset name or a full configuration, with a patch merged one level deep. */
export function boardConfig(base: 'arcade' | 'sim-lite' | BoardConfig, patch: BoardConfigPatch = {}): BoardConfig {
  const from = typeof base === 'string' ? BOARD_PRESETS[base] : base;
  if (!from || typeof from !== 'object') throw new RangeError(`board-traversal: unknown preset ${String(base)}`);
  if (!patch || typeof patch !== 'object') throw new RangeError('board-traversal: patch must be an object');
  const source: Readonly<Record<string, unknown>> = {...from},
    changes: Readonly<Record<string, unknown>> = {...patch};
  for (const key of Object.keys(changes))
    if (!(key in source)) throw new RangeError(`board-traversal: unknown configuration section ${key}`);
  const merged: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    const a = source[key],
      b = changes[key];
    merged[key] = b === undefined ? a : a && typeof a === 'object' && b && typeof b === 'object' ? {...a, ...b} : b;
  }
  return validateBoardConfig(merged);
}

/** FNV-1a 32-bit fingerprint of a validated configuration (canonical JSON). */
export function boardConfigFingerprint(c: BoardConfig): number {
  const text = JSON.stringify(c);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
