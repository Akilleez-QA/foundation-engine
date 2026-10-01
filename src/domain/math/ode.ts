// domain/math/ode.ts: integrators with event location. Pure (imports nothing); allocation-free per step (scratch
// arrays are owned by the stepper or allocated once per run). The one place a simulation gets RK4, semi-implicit
// Euler, adaptive DP5 and "bisect the step until the surface is hit".
//
// Two families :
//  - Fixed step (`FixedStepper`): 'rk4' and 'symplectic-euler'. For live, deterministic physics
//    (same inputs -> bit-identical outputs, independent of frame timing).
//  - Adaptive (`integrateAdaptive`): Dormand–Prince 5(4), FSAL, PI step control. For predictors in workers.
//    Tableau and controller follow MechJebLib ODE/DP5.cs + AbstractRungeKutta.cs (SAFETY 0.9, MIN 0.2, MAX 10,
//    β = 0.2/(q+1) = 0.04, α = 1/(q+1) − 0.75β = 0.17, q = 4). One deliberate difference: our error estimate is
//    h·Σ E_i k_i (the scipy definition); MechJebLib DP5.cs:106-120 omits the factor h.
// `integrate()` is the one entry point that picks either family.
//
// Events (both families): g(t, y) is checked at the end of every step. A sign change matching `direction`
// (+1 rising, −1 falling, 0 both; the MechJebLib Event.cs convention) is located by the Illinois variant of regula
// falsi on φ(θ) = g(t+θ, step(y_t, θ)), i.e. by re-stepping from the start of the step with a shorter step.
// Terminal events stop the integration at the located time; non-terminal events are reported and integration goes on.
//
// Allocation rules: no Math.hypot with 3+ arguments, no closures inside per-step functions (V8
// allocates a context on entry to any function whose locals an inner closure captures), no spreads in steps.

export type Rhs = (t: number, y: Float64Array, dydt: Float64Array) => void;
export interface OdeEvent {
  id: string;
  g(t: number, y: Float64Array): number;
  /** +1: only rising crossings (g goes − → +), −1: only falling, 0: both. */
  direction: -1 | 0 | 1;
  terminal: boolean;
}
export interface EventHit { id: string; t: number; y: Float64Array }

export type FixedMethod = 'rk4' | 'symplectic-euler';

/**
 * A fixed-step stepper that owns its scratch buffers. For 'symplectic-euler' the state layout must be
 * [position(k), velocity(k), extra…] with dy[0..k) = velocity; extras are advanced by explicit Euler.
 * This is exactly the semi-implicit Euler a simple game loop uses (v += a·dt; x += v·dt).
 */
export class FixedStepper {
  private readonly k1: Float64Array; private readonly k2: Float64Array; private readonly k3: Float64Array;
  private readonly k4: Float64Array; private readonly tmp: Float64Array;
  constructor(readonly dim: number, readonly rhs: Rhs, readonly method: FixedMethod = 'rk4', readonly half = 0) {
    if (!(Number.isInteger(dim) && dim > 0)) throw Error('FixedStepper: dim must be a positive integer');
    if (method === 'symplectic-euler' && !(Number.isInteger(half) && half > 0 && 2 * half <= dim)) {
      throw Error('symplectic-euler needs half = number of position coordinates');
    }
    this.k1 = new Float64Array(dim); this.k2 = new Float64Array(dim); this.k3 = new Float64Array(dim);
    this.k4 = new Float64Array(dim); this.tmp = new Float64Array(dim);
  }
  /** y_out = step(t, y_in, h). y_out may alias y_in. */
  step(t: number, yIn: Float64Array, h: number, yOut: Float64Array): void {
    const n = this.dim, k1 = this.k1;
    if (this.method === 'symplectic-euler') {
      this.rhs(t, yIn, k1);
      const k = this.half;
      if (yOut !== yIn) for (let i = 0; i < n; i++) yOut[i] = yIn[i];
      for (let i = k; i < n; i++) yOut[i] = yIn[i] + h * k1[i];      // velocities (and extras) first
      for (let i = 0; i < k; i++) yOut[i] = yIn[i] + h * yOut[k + i]; // positions with the NEW velocity
      return;
    }
    const k2 = this.k2, k3 = this.k3, k4 = this.k4, tmp = this.tmp, hh = 0.5 * h;
    this.rhs(t, yIn, k1);
    for (let i = 0; i < n; i++) tmp[i] = yIn[i] + hh * k1[i];
    this.rhs(t + hh, tmp, k2);
    for (let i = 0; i < n; i++) tmp[i] = yIn[i] + hh * k2[i];
    this.rhs(t + hh, tmp, k3);
    for (let i = 0; i < n; i++) tmp[i] = yIn[i] + h * k3[i];
    this.rhs(t + h, tmp, k4);
    const h6 = h / 6;
    for (let i = 0; i < n; i++) yOut[i] = yIn[i] + h6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }
}

/** Something that can evaluate φ(θ) for a root search without a closure (keeps callers allocation-free). */
interface Phi { at(theta: number): number }

/**
 * Locate a root of φ on [0, h] given φ(0) = g0, φ(h) = g1 with a sign change. Illinois regula falsi: stops when the
 * iterate moves less than tolT (or the bracket is narrower than tolT) and returns the post-crossing bracket end
 * when the bracket has collapsed, else the converged iterate.
 */
export function illinois(phi: ((theta: number) => number) | Phi, h: number, g0: number, g1: number, tolT: number, maxIter = 80): number {
  const f = typeof phi === 'function' ? null : phi, fn = typeof phi === 'function' ? phi : null;
  let a = 0, b = h, fa = g0, fb = g1, side = 0, c = b, prev = Infinity;
  for (let i = 0; i < maxIter; i++) {
    c = (a * fb - b * fa) / (fb - fa);
    if (!(c > a && c < b)) c = 0.5 * (a + b);
    const fc = f ? f.at(c) : fn!(c);
    if (fc === 0) return c;
    if ((fc > 0) === (fb > 0)) { b = c; fb = fc; if (side === -1) fa /= 2; side = -1; }
    else { a = c; fa = fc; if (side === 1) fb /= 2; side = 1; }
    if (b - a < tolT) return b;
    if (Math.abs(c - prev) < tolT) return c;
    prev = c;
  }
  return b;
}

function crosses(e: OdeEvent, g0: number, g1: number): boolean {
  return (e.direction >= 0 && g0 < 0 && g1 >= 0) || (e.direction <= 0 && g0 > 0 && g1 <= 0);
}

export interface FixedRunResult { t: number; y: Float64Array; hits: EventHit[]; steps: number; stoppedBy?: string }

/** Re-steps a fixed stepper from the start of a step; the φ of the event search (a class, so no closure). */
class FixedPhi implements Phi {
  stepper!: FixedStepper; t = 0; yStart!: Float64Array; yTry!: Float64Array; event!: OdeEvent;
  at(theta: number): number { this.stepper.step(this.t, this.yStart, theta, this.yTry); return this.event.g(this.t + theta, this.yTry); }
}

/** Reusable per-stepper workspace so a step with events allocates nothing unless an event fires. */
export class EventWorkspace {
  readonly yStart: Float64Array; readonly yTry: Float64Array; readonly gPrev: Float64Array;
  primed = false; hitT = NaN;
  /** @internal */ readonly phi = new FixedPhi();
  constructor(readonly dim: number, readonly nEvents: number) {
    this.yStart = new Float64Array(dim); this.yTry = new Float64Array(dim); this.gPrev = new Float64Array(nEvents);
  }
  /** Forget the previous g values, e.g. after the state was changed outside the stepper (an impulse, a reset). */
  reset(): void { this.primed = false; this.hitT = NaN; }
}

/**
 * One fixed step from t to t+h with event detection. Returns the id of a terminal event that stopped the step
 * (y then holds the state AT the event and ws.hitT its time) or null. Allocates nothing unless an event fires.
 * Non-terminal hits are passed to onHit.
 */
export function stepWithEvents(stepper: FixedStepper, ws: EventWorkspace, t: number, y: Float64Array, h: number,
  events: readonly OdeEvent[], tolT: number, onHit?: (hit: EventHit) => void): string | null {
  if (ws.dim !== stepper.dim || ws.nEvents < events.length) throw Error('stepWithEvents: workspace does not fit');
  if (!ws.primed) { for (let k = 0; k < events.length; k++) ws.gPrev[k] = events[k].g(t, y); ws.primed = true; }
  const yStart = ws.yStart, yTry = ws.yTry, gPrev = ws.gPrev;
  yStart.set(y);
  stepper.step(t, yStart, h, y);
  let first = -1, firstTheta = Infinity;
  for (let k = 0; k < events.length; k++) {
    const e = events[k], g1 = e.g(t + h, y);
    if (crosses(e, gPrev[k], g1)) {
      const phi = ws.phi;
      phi.stepper = stepper; phi.t = t; phi.yStart = yStart; phi.yTry = yTry; phi.event = e;
      const theta = illinois(phi, h, gPrev[k], g1, tolT);
      if (theta < firstTheta) { firstTheta = theta; first = k; }
    }
    gPrev[k] = g1;
  }
  if (first < 0) return null;
  const e = events[first];
  stepper.step(t, yStart, firstTheta, yTry);
  if (onHit) onHit({ id: e.id, t: t + firstTheta, y: yTry.slice() });
  if (e.terminal) {
    y.set(yTry); ws.hitT = t + firstTheta;
    // Re-prime from the event state so a resumed run does not re-detect the same crossing.
    for (let k = 0; k < events.length; k++) gPrev[k] = events[k].g(ws.hitT, y);
    return e.id;
  }
  return null;
}

export interface FixedOpts { events?: readonly OdeEvent[]; tolT?: number; maxSteps?: number; workspace?: EventWorkspace }

/**
 * Integrate with a fixed step h from t0 to t1 (the last step is shortened to land on t1), with events.
 * `y` is advanced in place and also returned. Forward time only.
 */
export function integrateFixed(stepper: FixedStepper, t0: number, y: Float64Array, t1: number, h: number, opts: FixedOpts = {}): FixedRunResult {
  if (!(h > 0) || !Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) throw Error('integrateFixed: needs h > 0 and t0 <= t1');
  const events = opts.events ?? [], tolT = opts.tolT ?? 1e-9 * Math.max(1, h), hits: EventHit[] = [];
  const ws = opts.workspace ?? new EventWorkspace(stepper.dim, events.length);
  const onHit = (hit: EventHit) => { hits.push(hit); };
  const maxSteps = opts.maxSteps ?? 10_000_000, endTol = 1e-12 * Math.max(1, Math.abs(t1));
  let t = t0, steps = 0;
  while (t < t1 - endTol) {
    if (++steps > maxSteps) throw Error('integrateFixed: step budget exceeded');
    const last = t1 - t <= h, hs = last ? t1 - t : h;
    const stopped = stepWithEvents(stepper, ws, t, y, hs, events, tolT, onHit);
    if (stopped) return { t: ws.hitT, y, hits, steps, stoppedBy: stopped };
    t = last ? t1 : t + hs;
  }
  return { t, y, hits, steps };
}

// ---------------------------------------------------------------- Dormand–Prince 5(4)
const C2 = 1 / 5, C3 = 3 / 10, C4 = 4 / 5, C5 = 8 / 9;
const A21 = 1 / 5, A31 = 3 / 40, A32 = 9 / 40, A41 = 44 / 45, A42 = -56 / 15, A43 = 32 / 9;
const A51 = 19372 / 6561, A52 = -25360 / 2187, A53 = 64448 / 6561, A54 = -212 / 729;
const A61 = 9017 / 3168, A62 = -355 / 33, A63 = 46732 / 5247, A64 = 49 / 176, A65 = -5103 / 18656;
const A71 = 35 / 384, A73 = 500 / 1113, A74 = 125 / 192, A75 = -2187 / 6784, A76 = 11 / 84;
const E1 = 71 / 57600, E3 = -71 / 16695, E4 = 71 / 1920, E5 = -17253 / 339200, E6 = 22 / 525, E7 = -1 / 40;

export interface AdaptiveOpts {
  rtol?: number; atol?: number; hMax?: number; hInit?: number;
  events?: readonly OdeEvent[]; maxSteps?: number;
  /** Called after every accepted step with the new (t, y); y is the live buffer, copy it to keep it. */
  onStep?: (t: number, y: Float64Array) => void;
}
export interface AdaptiveRunResult extends FixedRunResult { rejected: number }

/** Owns every buffer a DP5 run needs, so a run allocates once and each step allocates nothing. */
class Dp5Workspace implements Phi {
  readonly k: Float64Array[] = []; readonly kTry: Float64Array[] = [];
  readonly tmp: Float64Array; readonly yNew: Float64Array; readonly yTry: Float64Array;
  // φ state for event location
  rhs!: Rhs; t = 0; y!: Float64Array; event!: OdeEvent; rtol = 0; atol = 0;
  constructor(n: number) {
    for (let i = 0; i < 7; i++) { this.k.push(new Float64Array(n)); this.kTry.push(new Float64Array(n)); }
    this.tmp = new Float64Array(n); this.yNew = new Float64Array(n); this.yTry = new Float64Array(n);
  }
  at(theta: number): number {
    this.kTry[0].set(this.k[0]);
    dpStep(this.rhs, this.t, this.y, theta, this.kTry, this.tmp, this.yTry, this.rtol, this.atol);
    return this.event.g(this.t + theta, this.yTry);
  }
}

/** One DP5 step from (t, y) of size h into yOut; returns the scaled error norm. k[0] must hold f(t, y). */
function dpStep(rhs: Rhs, t: number, y: Float64Array, h: number, k: Float64Array[], tmp: Float64Array, yOut: Float64Array, rtol: number, atol: number): number {
  const n = y.length, k1 = k[0], k2 = k[1], k3 = k[2], k4 = k[3], k5 = k[4], k6 = k[5], k7 = k[6];
  for (let i = 0; i < n; i++) tmp[i] = y[i] + h * A21 * k1[i];
  rhs(t + C2 * h, tmp, k2);
  for (let i = 0; i < n; i++) tmp[i] = y[i] + h * (A31 * k1[i] + A32 * k2[i]);
  rhs(t + C3 * h, tmp, k3);
  for (let i = 0; i < n; i++) tmp[i] = y[i] + h * (A41 * k1[i] + A42 * k2[i] + A43 * k3[i]);
  rhs(t + C4 * h, tmp, k4);
  for (let i = 0; i < n; i++) tmp[i] = y[i] + h * (A51 * k1[i] + A52 * k2[i] + A53 * k3[i] + A54 * k4[i]);
  rhs(t + C5 * h, tmp, k5);
  for (let i = 0; i < n; i++) tmp[i] = y[i] + h * (A61 * k1[i] + A62 * k2[i] + A63 * k3[i] + A64 * k4[i] + A65 * k5[i]);
  rhs(t + h, tmp, k6);
  for (let i = 0; i < n; i++) yOut[i] = y[i] + h * (A71 * k1[i] + A73 * k3[i] + A74 * k4[i] + A75 * k5[i] + A76 * k6[i]);
  rhs(t + h, yOut, k7);
  let err = 0;
  for (let i = 0; i < n; i++) {
    const e = h * (E1 * k1[i] + E3 * k3[i] + E4 * k4[i] + E5 * k5[i] + E6 * k6[i] + E7 * k7[i]);
    const sc = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(yOut[i]));
    err += (e / sc) * (e / sc);
  }
  return Math.sqrt(err / n);
}

/**
 * Dormand–Prince 5(4) from t0 to t1 with PI step control and events. `y` is advanced in place and returned.
 * Forward time only. Allocates its workspace once per run; accepted and rejected steps allocate nothing
 * unless an event fires or onStep keeps copies.
 */
export function integrateAdaptive(rhs: Rhs, t0: number, y: Float64Array, t1: number, opts: AdaptiveOpts = {}): AdaptiveRunResult {
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) throw Error('integrateAdaptive: needs t0 <= t1');
  const rtol = opts.rtol ?? 1e-10, atol = opts.atol ?? 1e-10, hMax = opts.hMax ?? Infinity, events = opts.events ?? [];
  if (!(rtol > 0) || !(atol > 0) || !(hMax > 0)) throw Error('integrateAdaptive: tolerances and hMax must be > 0');
  const n = y.length, ws = new Dp5Workspace(n), k = ws.k, tmp = ws.tmp, yNew = ws.yNew, yTry = ws.yTry;
  ws.rhs = rhs; ws.y = y; ws.rtol = rtol; ws.atol = atol;
  const SAFETY = 0.9, MINF = 0.2, MAXF = 10, BETA = 0.2 / 5, ALPHA = 1 / 5 - 0.75 * BETA;
  let t = t0, h = Math.min(hMax, opts.hInit ?? Math.max(1e-6, Math.abs(t1 - t0) * 1e-3));
  let lastNorm = 1e-4, steps = 0, rejected = 0, justRejected = false;
  const hits: EventHit[] = [], gPrev = new Float64Array(events.length);
  for (let j = 0; j < events.length; j++) gPrev[j] = events[j].g(t0, y);
  rhs(t, y, k[0]);
  const maxSteps = opts.maxSteps ?? 1_000_000;
  while (t < t1) {
    if (++steps > maxSteps) throw Error('integrateAdaptive: step budget exceeded');
    const last = t1 - t <= h && t1 - t <= hMax;
    h = last ? t1 - t : Math.min(h, hMax);
    const err = dpStep(rhs, t, y, h, k, tmp, yNew, rtol, atol);
    if (!(err <= 1)) { // also rejects NaN
      rejected++; justRejected = true;
      h *= Number.isFinite(err) ? Math.max(MINF, SAFETY * Math.pow(err, -ALPHA)) : MINF;
      if (!(h > 0)) throw Error('integrateAdaptive: step size underflow');
      continue;
    }
    let first = -1, firstTheta = Infinity;
    for (let j = 0; j < events.length; j++) {
      const e = events[j], g1 = e.g(t + h, yNew);
      if (crosses(e, gPrev[j], g1)) {
        ws.t = t; ws.event = e;
        const theta = illinois(ws, h, gPrev[j], g1, 1e-9 * Math.max(1, h));
        if (theta < firstTheta) { firstTheta = theta; first = j; }
      }
      gPrev[j] = g1;
    }
    if (first >= 0) {
      const e = events[first];
      ws.kTry[0].set(k[0]);
      dpStep(rhs, t, y, firstTheta, ws.kTry, tmp, yTry, rtol, atol);
      hits.push({ id: e.id, t: t + firstTheta, y: yTry.slice() });
      if (e.terminal) { y.set(yTry); return { t: t + firstTheta, y, hits, steps, rejected, stoppedBy: e.id }; }
    }
    t = last ? t1 : t + h;
    y.set(yNew); k[0].set(k[6]); // FSAL
    if (opts.onStep) opts.onStep(t, y);
    let factor = err === 0 ? MAXF : Math.min(MAXF, SAFETY * Math.pow(err, -ALPHA) * Math.pow(lastNorm, BETA));
    if (justRejected) factor = Math.min(1, factor);
    justRejected = false; lastNorm = Math.max(err, 1e-4); h *= factor;
  }
  return { t, y, hits, steps, rejected };
}

// ---------------------------------------------------------------- one entry point

export type IntegrateOpts =
  | ({ method: FixedMethod; h: number; half?: number } & Omit<FixedOpts, 'workspace'>)
  | ({ method?: 'dp5' } & AdaptiveOpts);

/**
 * Integrate dy/dt = rhs(t, y) from t0 to t1 in place, with event detection.
 *  - `{ method: 'rk4' | 'symplectic-euler', h }`: fixed step (symplectic Euler also needs `half`, the position count);
 *  - `{ method: 'dp5' }` or no method: adaptive Dormand–Prince 5(4) with rtol/atol.
 * Terminal events stop the run at the located time (result.stoppedBy, result.t); others are listed in result.hits.
 */
export function integrate(rhs: Rhs, t0: number, y: Float64Array, t1: number, opts: IntegrateOpts = {}): FixedRunResult {
  if (opts.method === 'rk4' || opts.method === 'symplectic-euler') {
    const stepper = new FixedStepper(y.length, rhs, opts.method, opts.half ?? 0);
    return integrateFixed(stepper, t0, y, t1, opts.h, opts);
  }
  return integrateAdaptive(rhs, t0, y, t1, opts);
}
