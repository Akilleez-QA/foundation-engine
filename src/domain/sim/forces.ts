// domain/sim/forces.ts: the standard force terms the sim host composes (ADR 0039).
// Each term is pure and allocation-free: it adds acceleration (m/s²) into `acc` and mass rate (kg/s) into `dm`.
// Allocation rules: no Math.hypot (V8 allocates its argument list), no closures
// created per call, no spreads.
/** Standard gravity, m/s² (the Isp definition's g0; a unit constant, not a body fact). */
export const G0_STANDARD = 9.80665;
import type {ForceTerm} from './host';
// Index invariant for every term below: `y` has the ForceCtx layout (>= 7 entries: position, velocity, mass),
// `acc` is the host's Float64Array(3) and a thrust `dir` is a 3-vector, so the `[0..6]!` accesses are in range.

/** A central body as a force term reads it: SI, already resolved (STD-SIM-22). */
export interface CentralBodyParams {
  /** Gravitational parameter, m³/s². */
  mu: number;
  /** Mean radius, m (drag altitude). */
  radius: number;
}
/** A body with an atmosphere that co-rotates about +z. */
export interface AtmosphereBodyParams extends CentralBodyParams {
  /** Air density (kg/m³) at an altitude (m) above `radius`. Must not allocate. */
  density(altitudeM: number): number;
  /** Spin rate, rad/s, about +z. */
  omega: number;
}

/** Point-mass gravity of the central body (stage 0): a = −μ r / |r|³. */
export const gravityTerm: ForceTerm<{body: CentralBodyParams}> = {
  id: 'gravity',
  order: 0,
  accumulate({y, params}, acc) {
    const r2 = y[0]! * y[0]! + y[1]! * y[1]! + y[2]! * y[2]!,
      k = -params.body.mu / (r2 * Math.sqrt(r2));
    acc[0]! += k * y[0]!;
    acc[1]! += k * y[1]!;
    acc[2]! += k * y[2]!;
  },
};

/**
 * Drag in the body's atmosphere (stage 200): a = −½ρ|v_air|·cdA/m · v_air, with the air co-rotating
 * (v_air = v − ω×r, ω on +z). A term per call site, so packs can hold several with different ids.
 */
export function dragTerm<P extends {body: AtmosphereBodyParams; cdA: number}>(): ForceTerm<P> {
  return {
    id: 'drag',
    order: 200,
    accumulate({y, params}, acc) {
      const body = params.body,
        cdA = params.cdA;
      if (!(cdA > 0)) return;
      const r = Math.sqrt(y[0]! * y[0]! + y[1]! * y[1]! + y[2]! * y[2]!),
        rho = body.density(r - body.radius);
      if (!(rho > 0)) return;
      const vx = y[3]! + body.omega * y[1]!,
        vy = y[4]! - body.omega * y[0]!,
        vz = y[5]!;
      const v = Math.sqrt(vx * vx + vy * vy + vz * vz),
        k = (-0.5 * rho * v * cdA) / y[6]!;
      acc[0]! += k * vx;
      acc[1]! += k * vy;
      acc[2]! += k * vz;
    },
  };
}

/**
 * Constant thrust along a fixed inertial unit direction (stage 100), burning mass at thrust / (Isp·g0).
 * `thrustN` 0 or an empty body (mass at or below `dryMassKg`) adds nothing.
 */
export function thrustTerm<
  P extends {thrust: {thrustN: number; ispS: number; dir: ArrayLike<number>; dryMassKg: number}},
>(): ForceTerm<P> {
  return {
    id: 'thrust',
    order: 100,
    accumulate({y, params}, acc, dm) {
      const th = params.thrust,
        m = y[6]!;
      if (!(th.thrustN > 0) || !(m > th.dryMassKg)) return;
      const a = th.thrustN / m;
      acc[0]! += a * th.dir[0]!;
      acc[1]! += a * th.dir[1]!;
      acc[2]! += a * th.dir[2]!;
      dm.value -= th.thrustN / (th.ispS * G0_STANDARD);
    },
  };
}
