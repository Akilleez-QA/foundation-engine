/**
 * kits/car-handling/config: the complete, validated tuning of one car, the two stock presets and the patch helper.
 *
 * Units are SI (kg, m, s, N, rad). Body coordinates: +z forward, +y up, +x to the car's left (the engine's right-handed,
 * y-up frame, in which yaw `ry` turns +z toward +x). Positive steering input turns right.
 */

export type Vec3Tuple = readonly [number, number, number];
/** A piecewise-linear curve: points sorted by strictly increasing x. Outside its range the end values hold. */
export type Curve = readonly (readonly [number, number])[];

export interface CarWheel {
  /** Top of the suspension travel, in body coordinates relative to the centre of mass (m), each within ±20. */
  readonly position: Vec3Tuple;
  /** Share of the steering angle: [-1, 1]. 1 for a front wheel, 0 for a fixed wheel, negative for rear steer. */
  readonly steer: number;
  /** Receives engine force. */
  readonly drive: boolean;
  /** Takes the handbrake (force and grip loss); usually the rear axle. */
  readonly handbrake: boolean;
  /** True for a front-axle wheel: it takes `brakes.bias` of the foot brake. */
  readonly front: boolean;
}

export interface CarConfig {
  /** kg: [50, 50000]. */
  readonly mass: number;
  /** Half extents of the body box (m), each (0, 20]. Used for inertia and the optional body contact points. */
  readonly halfExtents: Vec3Tuple;
  /** Multiplies the box inertia: [0.1, 10]. Higher turns and rolls more lazily. */
  readonly inertiaScale: number;
  /** m/s², [0, 100], straight down the world -y. */
  readonly gravity: number;
  /** 2 to 8 wheels. */
  readonly wheels: readonly CarWheel[];
  readonly suspension: Readonly<{
    /** Travel from fully extended to bump stop (m): (0, 5]. */
    restLength: number;
    /** Wheel radius (m): (0, 3]. */
    radius: number;
    /** Natural frequency of each corner with its share of the mass (Hz): [0.2, 20], and 2*pi*f*maxSubstep <= 0.35. */
    frequency: number;
    /** Damping ratio of each corner: [0, 5]. 1 is critical. */
    damping: number;
    /** The largest spring and damper force of one corner, as a multiple of its static load: [1, 100]. */
    maxForce: number;
    /** Spring rate beyond the bump stop, as a multiple of the spring rate: [1, 1000]. */
    bumpStop: number;
  }>;
  readonly tyre: Readonly<{
    /** Peak lateral friction coefficient: (0, 5]. */
    grip: number;
    /** Peak longitudinal friction coefficient (drive and brake): (0, 5]. Combined force stays inside the larger circle. */
    driveGrip: number;
    /** Slip angle of peak lateral grip (rad): [0.01, 1]. */
    peakSlip: number;
    /** Lateral grip at and beyond twice the peak slip, as a share of the peak: [0, 1]. Lower slides more freely. */
    slideGrip: number;
    /** Speed below which slip angles are softened (m/s): [0.05, 10]. */
    lowSpeed: number;
    /** Rolling resistance coefficient: [0, 1]. */
    rolling: number;
    /**
     * Where tyre forces act, from the contact patch (0) to the centre-of-mass height (1): [0, 1]. Higher means less
     * body roll and pitch from cornering and braking; 1 removes them entirely.
     */
    forceHeight: number;
  }>;
  readonly engine: Readonly<{
    /** Peak forward drive force at the wheels (N): [0, 1e6]. */
    force: number;
    /** Forward speed at which the curve's x reaches 1 (m/s): (0, 200]. */
    topSpeed: number;
    /** Reverse drive force (N): [0, 1e6]. */
    reverseForce: number;
    /** Reverse top speed (m/s): (0, 200]. */
    reverseTopSpeed: number;
    /** Drive force share by speed / top speed: 2 to 16 points, x in [0, 2], y in [0, 1]. */
    curve: Curve;
  }>;
  readonly brakes: Readonly<{
    /** Total foot-brake force (N): [0, 1e6]. */
    force: number;
    /** Share of the foot brake on front wheels: [0, 1]. */
    bias: number;
    /** Total handbrake force on handbrake wheels (N): [0, 1e6]. */
    handbrakeForce: number;
    /** Holding brake below `reverseSpeed` engages reverse drive. */
    brakeToReverse: boolean;
    /** Forward speed under which the brake becomes reverse (m/s): [0, 20]. */
    reverseSpeed: number;
  }>;
  readonly steering: Readonly<{
    /** Largest steering angle (rad, [0, 1.2]) by absolute forward speed (m/s): 1 to 16 points. */
    maxAngle: Curve;
    /** How fast the wheels turn toward the requested angle (rad/s): (0, 50]. */
    rate: number;
    /** How fast they return to centre with no input (rad/s): (0, 50]. */
    returnRate: number;
  }>;
  readonly drift: Readonly<{
    /** Lateral grip of handbrake wheels at full handbrake, as a share: [0, 1]. */
    handbrakeGrip: number;
    /** Seconds for that grip to come back after the handbrake is released: [0, 10]. 0 is instant. */
    recoveryTime: number;
  }>;
  readonly aero: Readonly<{
    /** Drag force per (m/s)² (N·s²/m²): [0, 100]. */
    drag: number;
    /** Downforce per (m/s)² along the body's -y (N·s²/m²): [0, 1000]. */
    downforce: number;
    /** Downforce ceiling (N): [0, 1e7]. */
    maxDownforce: number;
    /** Angular velocity damping (1/s): [0, 50]. */
    angularDamping: number;
  }>;
  readonly air: Readonly<{
    /** Angular acceleration from `pitch` input with no wheel on the ground (rad/s²): [0, 100]. */
    pitch: number;
    /** From `roll` input (rad/s²): [0, 100]. */
    roll: number;
    /** From `steer` input (rad/s²): [0, 100]. */
    yaw: number;
    /** Pull toward upright with no wheel down (rad/s² per unit sine of tilt): [0, 100]. */
    levelling: number;
    /** Extra angular damping while airborne (1/s): [0, 50]. */
    damping: number;
  }>;
  readonly reset: Readonly<{
    /** Reset the car upright by itself after it has been stuck upside down for `delay`. */
    auto: boolean;
    /** The car counts as upside down while its up axis · world up is below this: [-1, 0.9]. */
    upDot: number;
    /** ...and its speed is below this (m/s): [0, 100]. */
    maxSpeed: number;
    /** Seconds stuck before the flip is reported (and acted on with `auto`): [0, 60]. */
    delay: number;
    /** Height added on a reset (m): [0, 20]. */
    lift: number;
  }>;
  readonly body: Readonly<{
    /** Keep the 8 body-box corners out of the ground (8 extra ground queries per sub-step). */
    contacts: boolean;
    /** Friction coefficient of body contacts: [0, 2]. */
    friction: number;
  }>;
  readonly limits: Readonly<{
    /** Longest sub-step (s): [1/1000, 1/15]. A step is split into ceil(dt / maxSubstep) equal sub-steps. */
    maxSubstep: number;
    /** Most sub-steps one step may take: integer [1, 16]. A longer step is refused. */
    maxSubsteps: number;
    /** Linear speed clamp (m/s): (0, 1000]. */
    maxSpeed: number;
    /** Angular speed clamp (rad/s): (0, 200]. */
    maxAngularSpeed: number;
    /** A step that would leave |x|, |y| or |z| beyond this is refused (m): (0, 1e7]. */
    extent: number;
  }>;
}

/** A partial configuration: sections are merged one level deep; `wheels` and curves replace whole. */
export type CarConfigPatch = {
  readonly [K in keyof CarConfig]?: CarConfig[K] extends readonly unknown[]
    ? CarConfig[K]
    : CarConfig[K] extends Readonly<Record<string, unknown>>
      ? Partial<CarConfig[K]>
      : CarConfig[K];
};

const corner = (x: number, z: number, front: boolean, rearDrive: boolean, frontDrive: boolean): CarWheel => ({
  position: [x, -0.1, z],
  steer: front ? 1 : 0,
  drive: front ? frontDrive : rearDrive,
  handbrake: !front,
  front,
});
const fourWheels = (track: number, front: number, rear: number, drive: 'front' | 'rear' | 'all') => {
  const r = drive !== 'front',
    f = drive !== 'rear';
  return [
    corner(track, front, true, r, f),
    corner(-track, front, true, r, f),
    corner(track, -rear, false, r, f),
    corner(-track, -rear, false, r, f),
  ];
};

/**
 * Generic starting points, not any particular game's tables. Every value is documented on `CarConfig` and in the
 * README's tuning table; copy one and change what the game needs.
 *
 * - `arcade`: forgiving and quick. Sticky tyres, strong brakes, steering that narrows with speed, easy handbrake
 *   slides that recover fast, downforce, generous air control with levelling, and a quick automatic reset.
 * - `sim-lite`: the same body with physically plainer choices. Lower grip with a sharper fall-off past the peak, more
 *   weight transfer, no air control or levelling, light downforce and a slower reset.
 */
export const CAR_PRESETS: Readonly<Record<'arcade' | 'sim-lite', CarConfig>> = deepFreeze({
  arcade: {
    mass: 1200,
    halfExtents: [0.9, 0.55, 2.1],
    inertiaScale: 1,
    gravity: 9.81,
    wheels: fourWheels(0.8, 1.3, 1.25, 'rear'),
    suspension: {restLength: 0.3, radius: 0.34, frequency: 2.2, damping: 0.7, maxForce: 6, bumpStop: 10},
    tyre: {grip: 1.5, driveGrip: 1.4, peakSlip: 0.14, slideGrip: 0.85, lowSpeed: 1, rolling: 0.015, forceHeight: 0.7},
    engine: {
      force: 9000,
      topSpeed: 45,
      reverseForce: 5000,
      reverseTopSpeed: 12,
      curve: [
        [0, 1],
        [0.6, 0.85],
        [1, 0],
      ],
    },
    brakes: {force: 15000, bias: 0.6, handbrakeForce: 4000, brakeToReverse: true, reverseSpeed: 1},
    steering: {
      maxAngle: [
        [0, 0.6],
        [15, 0.3],
        [45, 0.12],
      ],
      rate: 4,
      returnRate: 6,
    },
    drift: {handbrakeGrip: 0.3, recoveryTime: 0.6},
    aero: {drag: 0.35, downforce: 3, maxDownforce: 8000, angularDamping: 0.5},
    air: {pitch: 6, roll: 6, yaw: 4, levelling: 3, damping: 1},
    reset: {auto: true, upDot: 0.2, maxSpeed: 2, delay: 1.5, lift: 1},
    body: {contacts: true, friction: 0.6},
    limits: {maxSubstep: 1 / 120, maxSubsteps: 8, maxSpeed: 200, maxAngularSpeed: 50, extent: 1e6},
  },
  'sim-lite': {
    mass: 1350,
    halfExtents: [0.9, 0.45, 2.2],
    inertiaScale: 1.2,
    gravity: 9.81,
    wheels: fourWheels(0.78, 1.35, 1.3, 'rear'),
    suspension: {restLength: 0.25, radius: 0.33, frequency: 1.6, damping: 0.45, maxForce: 6, bumpStop: 12},
    tyre: {grip: 1.05, driveGrip: 1.0, peakSlip: 0.1, slideGrip: 0.7, lowSpeed: 1, rolling: 0.013, forceHeight: 0.3},
    engine: {
      force: 6500,
      topSpeed: 55,
      reverseForce: 4000,
      reverseTopSpeed: 10,
      curve: [
        [0, 0.8],
        [0.3, 1],
        [0.8, 0.7],
        [1, 0],
      ],
    },
    brakes: {force: 11000, bias: 0.65, handbrakeForce: 3000, brakeToReverse: true, reverseSpeed: 0.5},
    steering: {
      maxAngle: [
        [0, 0.55],
        [20, 0.2],
        [55, 0.07],
      ],
      rate: 2.5,
      returnRate: 3.5,
    },
    drift: {handbrakeGrip: 0.5, recoveryTime: 1.2},
    aero: {drag: 0.42, downforce: 1.2, maxDownforce: 4000, angularDamping: 0.1},
    air: {pitch: 0, roll: 0, yaw: 0, levelling: 0, damping: 0},
    reset: {auto: true, upDot: 0.2, maxSpeed: 1, delay: 3, lift: 1},
    body: {contacts: true, friction: 0.5},
    limits: {maxSubstep: 1 / 120, maxSubsteps: 8, maxSpeed: 200, maxAngularSpeed: 50, extent: 1e6},
  },
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/**
 * A validated, frozen configuration: a preset name or a full configuration, with an optional patch merged one level
 * deep. Throws `RangeError` naming the first value outside its bounds.
 */
export function carConfig(base: 'arcade' | 'sim-lite' | CarConfig, patch: CarConfigPatch = {}): CarConfig {
  const from = typeof base === 'string' ? CAR_PRESETS[base] : base;
  if (!from || typeof from !== 'object') throw new RangeError(`car-handling: unknown preset ${String(base)}`);
  if (!patch || typeof patch !== 'object') throw new RangeError('car-handling: patch must be an object');
  const merged: Record<string, unknown> = {};
  const source: Readonly<Record<string, unknown>> = {...from},
    changes: Readonly<Record<string, unknown>> = {...patch};
  for (const key of Object.keys(source)) {
    const a = source[key],
      b = changes[key];
    merged[key] =
      b === undefined
        ? a
        : a && typeof a === 'object' && !Array.isArray(a) && b && typeof b === 'object' && !Array.isArray(b)
          ? {...a, ...b}
          : b;
  }
  for (const key of Object.keys(changes))
    if (!(key in source)) throw new RangeError(`car-handling: unknown configuration section ${key}`);
  return validateCarConfig(merged);
}

const num = (path: string, v: unknown, min: number, max: number, openMin = false): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v > max || (openMin ? v <= min : v < min))
    throw new RangeError(`car-handling: ${path} must be within ${openMin ? '(' : '['}${min}, ${max}]`);
  return v;
};
const int = (path: string, v: unknown, min: number, max: number): number => {
  if (!Number.isSafeInteger(v)) throw new RangeError(`car-handling: ${path} must be an integer`);
  return num(path, v, min, max);
};
const bool = (path: string, v: unknown): boolean => {
  if (typeof v !== 'boolean') throw new RangeError(`car-handling: ${path} must be a boolean`);
  return v;
};
const section = (path: string, v: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new RangeError(`car-handling: ${path} must be an object`);
  const copy: Readonly<Record<string, unknown>> = {...v};
  for (const key of Object.keys(copy))
    if (!keys.includes(key)) throw new RangeError(`car-handling: unknown field ${path}.${key}`);
  return copy;
};
const vec = (path: string, v: unknown, min: number, max: number, openMin = false): Vec3Tuple => {
  if (!Array.isArray(v) || v.length !== 3) throw new RangeError(`car-handling: ${path} must be [x, y, z]`);
  return [
    num(`${path}[0]`, v[0], min, max, openMin),
    num(`${path}[1]`, v[1], min, max, openMin),
    num(`${path}[2]`, v[2], min, max, openMin),
  ];
};
const curve = (
  path: string,
  v: unknown,
  minPoints: number,
  x: readonly [number, number],
  y: readonly [number, number],
): Curve => {
  if (!Array.isArray(v) || v.length < minPoints || v.length > 16)
    throw new RangeError(`car-handling: ${path} must have ${minPoints} to 16 points`);
  const out: (readonly [number, number])[] = [];
  for (let i = 0; i < v.length; i++) {
    const p: unknown = v[i];
    if (!Array.isArray(p) || p.length !== 2) throw new RangeError(`car-handling: ${path}[${i}] must be [x, y]`);
    const px = num(`${path}[${i}][0]`, p[0], x[0], x[1]),
      py = num(`${path}[${i}][1]`, p[1], y[0], y[1]);
    if (i > 0 && px <= out[i - 1]![0]) throw new RangeError(`car-handling: ${path} x must strictly increase`);
    out.push(Object.freeze([px, py] as const));
  }
  return Object.freeze(out);
};

/** Validate a complete configuration and return a frozen copy. Throws `RangeError` on the first bad value. */
export function validateCarConfig(input: unknown): CarConfig {
  const c = section('config', input, [
    'mass',
    'halfExtents',
    'inertiaScale',
    'gravity',
    'wheels',
    'suspension',
    'tyre',
    'engine',
    'brakes',
    'steering',
    'drift',
    'aero',
    'air',
    'reset',
    'body',
    'limits',
  ]);
  const wheelsIn = c.wheels;
  if (!Array.isArray(wheelsIn) || wheelsIn.length < 2 || wheelsIn.length > 8)
    throw new RangeError('car-handling: wheels must list 2 to 8 wheels');
  const wheels = wheelsIn.map((w: unknown, i) => {
    const s = section(`wheels[${i}]`, w, ['position', 'steer', 'drive', 'handbrake', 'front']);
    return Object.freeze({
      position: Object.freeze(vec(`wheels[${i}].position`, s.position, -20, 20)),
      steer: num(`wheels[${i}].steer`, s.steer, -1, 1),
      drive: bool(`wheels[${i}].drive`, s.drive),
      handbrake: bool(`wheels[${i}].handbrake`, s.handbrake),
      front: bool(`wheels[${i}].front`, s.front),
    });
  });
  const su = section('suspension', c.suspension, [
      'restLength',
      'radius',
      'frequency',
      'damping',
      'maxForce',
      'bumpStop',
    ]),
    ty = section('tyre', c.tyre, ['grip', 'driveGrip', 'peakSlip', 'slideGrip', 'lowSpeed', 'rolling', 'forceHeight']),
    en = section('engine', c.engine, ['force', 'topSpeed', 'reverseForce', 'reverseTopSpeed', 'curve']),
    br = section('brakes', c.brakes, ['force', 'bias', 'handbrakeForce', 'brakeToReverse', 'reverseSpeed']),
    st = section('steering', c.steering, ['maxAngle', 'rate', 'returnRate']),
    dr = section('drift', c.drift, ['handbrakeGrip', 'recoveryTime']),
    ae = section('aero', c.aero, ['drag', 'downforce', 'maxDownforce', 'angularDamping']),
    ai = section('air', c.air, ['pitch', 'roll', 'yaw', 'levelling', 'damping']),
    re = section('reset', c.reset, ['auto', 'upDot', 'maxSpeed', 'delay', 'lift']),
    bo = section('body', c.body, ['contacts', 'friction']),
    li = section('limits', c.limits, ['maxSubstep', 'maxSubsteps', 'maxSpeed', 'maxAngularSpeed', 'extent']);
  // Explicit integration of a stiff spring is stable only while the spring's angular frequency times the sub-step stays
  // small. These bounds keep the suspension and the bump stop well inside it (see the README's stability note).
  const h = num('limits.maxSubstep', li.maxSubstep, 1 / 1000, 1 / 15),
    omega = 2 * Math.PI * num('suspension.frequency', su.frequency, 0.2, 20),
    zeta = num('suspension.damping', su.damping, 0, 5),
    bump = num('suspension.bumpStop', su.bumpStop, 1, 1000);
  if (omega * h > 0.35)
    throw new RangeError(
      `car-handling: suspension.frequency ${su.frequency} Hz is too stiff for limits.maxSubstep ${h} s (need 2*pi*f*maxSubstep <= 0.35)`,
    );
  if (omega * Math.sqrt(bump) * h > 1)
    throw new RangeError(
      'car-handling: suspension.bumpStop is too stiff for limits.maxSubstep (need 2*pi*f*sqrt(bumpStop)*maxSubstep <= 1)',
    );
  if (2 * zeta * omega * h > 1)
    throw new RangeError(
      'car-handling: suspension.damping is too high for limits.maxSubstep (need 2*damping*2*pi*f*maxSubstep <= 1)',
    );
  return deepFreeze({
    mass: num('mass', c.mass, 50, 50000),
    halfExtents: vec('halfExtents', c.halfExtents, 0, 20, true),
    inertiaScale: num('inertiaScale', c.inertiaScale, 0.1, 10),
    gravity: num('gravity', c.gravity, 0, 100),
    wheels,
    suspension: {
      restLength: num('suspension.restLength', su.restLength, 0, 5, true),
      radius: num('suspension.radius', su.radius, 0, 3, true),
      frequency: num('suspension.frequency', su.frequency, 0.2, 20),
      damping: num('suspension.damping', su.damping, 0, 5),
      maxForce: num('suspension.maxForce', su.maxForce, 1, 100),
      bumpStop: num('suspension.bumpStop', su.bumpStop, 1, 1000),
    },
    tyre: {
      grip: num('tyre.grip', ty.grip, 0, 5, true),
      driveGrip: num('tyre.driveGrip', ty.driveGrip, 0, 5, true),
      peakSlip: num('tyre.peakSlip', ty.peakSlip, 0.01, 1),
      slideGrip: num('tyre.slideGrip', ty.slideGrip, 0, 1),
      lowSpeed: num('tyre.lowSpeed', ty.lowSpeed, 0.05, 10),
      rolling: num('tyre.rolling', ty.rolling, 0, 1),
      forceHeight: num('tyre.forceHeight', ty.forceHeight, 0, 1),
    },
    engine: {
      force: num('engine.force', en.force, 0, 1e6),
      topSpeed: num('engine.topSpeed', en.topSpeed, 0, 200, true),
      reverseForce: num('engine.reverseForce', en.reverseForce, 0, 1e6),
      reverseTopSpeed: num('engine.reverseTopSpeed', en.reverseTopSpeed, 0, 200, true),
      curve: curve('engine.curve', en.curve, 2, [0, 2], [0, 1]),
    },
    brakes: {
      force: num('brakes.force', br.force, 0, 1e6),
      bias: num('brakes.bias', br.bias, 0, 1),
      handbrakeForce: num('brakes.handbrakeForce', br.handbrakeForce, 0, 1e6),
      brakeToReverse: bool('brakes.brakeToReverse', br.brakeToReverse),
      reverseSpeed: num('brakes.reverseSpeed', br.reverseSpeed, 0, 20),
    },
    steering: {
      maxAngle: curve('steering.maxAngle', st.maxAngle, 1, [0, 1000], [0, 1.2]),
      rate: num('steering.rate', st.rate, 0, 50, true),
      returnRate: num('steering.returnRate', st.returnRate, 0, 50, true),
    },
    drift: {
      handbrakeGrip: num('drift.handbrakeGrip', dr.handbrakeGrip, 0, 1),
      recoveryTime: num('drift.recoveryTime', dr.recoveryTime, 0, 10),
    },
    aero: {
      drag: num('aero.drag', ae.drag, 0, 100),
      downforce: num('aero.downforce', ae.downforce, 0, 1000),
      maxDownforce: num('aero.maxDownforce', ae.maxDownforce, 0, 1e7),
      angularDamping: num('aero.angularDamping', ae.angularDamping, 0, 50),
    },
    air: {
      pitch: num('air.pitch', ai.pitch, 0, 100),
      roll: num('air.roll', ai.roll, 0, 100),
      yaw: num('air.yaw', ai.yaw, 0, 100),
      levelling: num('air.levelling', ai.levelling, 0, 100),
      damping: num('air.damping', ai.damping, 0, 50),
    },
    reset: {
      auto: bool('reset.auto', re.auto),
      upDot: num('reset.upDot', re.upDot, -1, 0.9),
      maxSpeed: num('reset.maxSpeed', re.maxSpeed, 0, 100),
      delay: num('reset.delay', re.delay, 0, 60),
      lift: num('reset.lift', re.lift, 0, 20),
    },
    body: {contacts: bool('body.contacts', bo.contacts), friction: num('body.friction', bo.friction, 0, 2)},
    limits: {
      maxSubstep: num('limits.maxSubstep', li.maxSubstep, 1 / 1000, 1 / 15),
      maxSubsteps: int('limits.maxSubsteps', li.maxSubsteps, 1, 16),
      maxSpeed: num('limits.maxSpeed', li.maxSpeed, 0, 1000, true),
      maxAngularSpeed: num('limits.maxAngularSpeed', li.maxAngularSpeed, 0, 200, true),
      extent: num('limits.extent', li.extent, 0, 1e7, true),
    },
  });
}

/** Evaluate a piecewise-linear curve at x (end values hold outside the range). */
export function evalCurve(c: Curve, x: number): number {
  const first = c[0]!;
  if (x <= first[0]) return first[1];
  for (let i = 1; i < c.length; i++) {
    const b = c[i]!;
    if (x <= b[0]) {
      const a = c[i - 1]!;
      return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
    }
  }
  return c[c.length - 1]![1];
}

/** FNV-1a 32-bit fingerprint of a configuration (canonical JSON), used to refuse a snapshot from another tuning. */
export function carConfigFingerprint(c: CarConfig): number {
  const text = JSON.stringify(c);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
