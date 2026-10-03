// domain/sim/host.ts: the one fixed-step physics host.
// Owns accumulation, the substep cap, tick-addressed input, events, determinism and the ForceTerm pipeline.
// Every simulation steps on it instead of a private accumulator (STD-SIM-11).
//
// Rules this file keeps:
//  - STD-SIM-10/11: the step and integrator belong to the Simulation, never to a quality preset.
//  - STD-SIM-12/17: input is fetched per tick INSIDE the step loop; the state after N ticks depends only on the
//    initial state and the tick inputs, never on how render frames grouped the time.
//  - STD-SIM-14/15 (ADR 0049): a world host's capacity is derived (maxPhysicsWarp × frameBudgetS / h), and a world
//    interval above it is refused before commitment (it throws) rather than silently dropped. Local hosts clamp
//    hitches at LOCAL_HITCH_S and report what they drop.
//  - STD-SIM-18: each Simulation declares `whenCovered`; `simTicker` maps it onto the FrameLoop's coverage rule.
//  - STD-SIM-24: a step allocates nothing unless an event fires (guarded by host.test.ts's allocation check).
import {FixedStepper, EventWorkspace, stepWithEvents, type EventHit, type OdeEvent, type Rhs} from '../math/ode';
import type {FrameInfo, TickerSpec} from '../../core/activity/loop';
import type {WhenCovered} from '../../core/activity/ports';
import type {Lazy, Registry} from '../../core/registry';

// ------------------------------------------------------------------ force terms

/** Everything a force term may read. `y` layout: [x,y,z, vx,vy,vz, mass, …extras]. SI, body-centred inertial. */
export interface ForceCtx<P = unknown> {
  t: number;
  y: Float64Array;
  /** Per-simulation parameters (a body, an entity view, a control command…), read-only during a step. */
  params: P;
}

/**
 * A pluggable force stage. Terms add ACCELERATION into `acc` (m/s²) and may add mass rate into `dm.value` (kg/s).
 * They must be pure functions of the context and must not allocate.
 */
export interface ForceTerm<P = unknown> {
  id: string;
  /** Lower runs first; ties by id. Gravity 0, thrust 100, drag 200, lift 210, packs ≥ 1000. */
  order: number;
  accumulate(ctx: ForceCtx<P>, acc: Float64Array, dm: {value: number}): void;
}

/** Order bands for force stages. */
export const FORCE_ORDER = {gravity: 0, thrust: 100, drag: 200, lift: 210, packs: 1000} as const;

/** What a force-term definition sees when it decides whether it applies to a loaded entity (a body, a vehicle). */
export interface ForceBindContext<R = unknown> {
  /** The entity's runtime state, as the game's entity system defines it. */
  runtime: R;
  /** The region or medium the entity is in (a game id, e.g. 'region.water'). */
  medium: string;
  /** How many behaviour modules of a kind the entity carries (0 when none). */
  hasModule(kind: string): number;
}

/** The lazy body of a force stage: `bind` returns a ForceTerm for an entity, or null when it does not apply. */
export interface ForceTermImpl {
  bind(entity: ForceBindContext): ForceTerm<unknown> | null;
}

/**
 * A registered force stage (registries.forceTerms; ADR 0043): data plus a lazy implementation, bound at an async
 * boundary (at a scene's load or a simulation's start). Packs add physics this way, with `order` ≥ FORCE_ORDER.packs.
 */
export interface ForceTermDef {
  id: string;
  order: number;
  impl: Lazy<ForceTermImpl>;
}
declare module '../../core/registry' {
  interface Registries {
    forceTerms: Registry<ForceTermDef>;
  }
}

/** State indices of a point mass. */
export const IDX = {x: 0, y: 1, z: 2, vx: 3, vy: 4, vz: 5, m: 6} as const;

/** Stable order: by `order`, then by id. Throws on a duplicate id (two terms would be indistinguishable in replays). */
export function orderTerms<T extends {id: string; order: number}>(terms: readonly T[]): T[] {
  const ids = new Set<string>();
  for (const term of terms) {
    if (ids.has(term.id)) throw Error(`duplicate force term '${term.id}'`);
    ids.add(term.id);
  }
  return [...terms].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Build an Rhs from ordered force terms: dy = [v, Σa, ṁ, 0…]. The scratch buffers and the context are created
 * once (the context on the first evaluation) and reused by every evaluation.
 */
export function forcesRhs<P>(terms: readonly ForceTerm<P>[], params: () => P): Rhs {
  const sorted = orderTerms(terms);
  const acc = new Float64Array(3),
    dm = {value: 0};
  let ctx: ForceCtx<P> | undefined;
  return (t, y, dy) => {
    acc[0] = acc[1] = acc[2] = 0;
    dm.value = 0;
    if (ctx) {
      ctx.t = t;
      ctx.y = y;
      ctx.params = params();
    } else ctx = {t, y, params: params()};
    // i < sorted.length; y/dy have the ForceCtx layout (>= 7 entries) and acc is Float64Array(3): indices in range.
    for (let i = 0; i < sorted.length; i++) sorted[i]!.accumulate(ctx, acc, dm); // indexed: no iterator object
    dy[0] = y[3]!;
    dy[1] = y[4]!;
    dy[2] = y[5]!;
    dy[3] = acc[0]!;
    dy[4] = acc[1]!;
    dy[5] = acc[2]!;
    dy[6] = dm.value;
    for (let i = 7; i < dy.length; i++) dy[i] = 0;
  };
}

// ------------------------------------------------------------------ simulations and the host

export interface SimEvent {
  id: string;
  t: number;
  detail?: unknown;
}
const NO_EVENTS: readonly SimEvent[] = Object.freeze([]);

/** What a simulation does while its owner is covered (STD-SIM-18). */
export type SimWhenCovered = 'rails' | 'freeze' | {readonly hz: number};

/** A simulation the host can run. Arcade sims implement it too, with clock 'local'. */
export interface Simulation<S, I> {
  id: string;
  /** Seconds per step. Part of the simulation's definition, never a quality knob (STD-SIM-10). */
  fixedStep: number;
  /** 'world' sims advance with committed universal time; 'local' sims get unwarped, pause-aware time (STD-SIM-13). */
  clock: 'world' | 'local';
  /** What happens while the owning activity is covered: world entities go on rails, arcade sims freeze, ambient sims
   *  throttle. */
  whenCovered?: SimWhenCovered;
  state: S;
  /** One deterministic step. Must not read wall time, Math.random or the DOM. */
  step(state: S, input: I, dt: number, t: number): void;
  /** Events detected inside the last step. Return a shared empty array when there are none (no allocation). */
  drainEvents?(): readonly SimEvent[];
}

/** Local hosts clamp one frame's time to this (ADR 0049). */
export const LOCAL_HITCH_S = 0.25;
/** Rounding slack when a committed UT difference lands exactly on capacity (UT ~1e9 s carries ~1e-7 s of float error). */
const CAPACITY_TOLERANCE_S = 1e-6;
/** The reference preset's frame budget (ADR 0049). */
export const REFERENCE_FRAME_BUDGET_S = 1 / 60;

export interface HostOptions {
  /** The largest physics warp the coordinator may grant this host (1 for local sims). */
  maxPhysicsWarp: number;
  /** Seconds of wall time per frame the capacity is priced for. Default REFERENCE_FRAME_BUDGET_S. */
  frameBudgetS?: number;
}

/**
 * Steps a host may take in one frame. World hosts: maxPhysicsWarp × frameBudgetS / h, never hand-picked
 * (STD-SIM-15). Local hosts: enough to consume a clamped hitch, so a slow machine keeps real time up to it.
 */
export function deriveMaxSubsteps(
  sim: Pick<Simulation<unknown, unknown>, 'fixedStep' | 'clock'>,
  opts: HostOptions,
): number {
  const h = sim.fixedStep;
  if (!(h > 0) || !Number.isFinite(h)) throw Error(`sim host: fixedStep must be positive, got ${h}`);
  if (!Number.isFinite(opts.maxPhysicsWarp) || !(opts.maxPhysicsWarp >= 1)) {
    throw Error(`sim host: maxPhysicsWarp must be finite and at least 1, got ${opts.maxPhysicsWarp}`);
  }
  const budget = opts.frameBudgetS ?? REFERENCE_FRAME_BUDGET_S;
  if (!Number.isFinite(budget) || !(budget > 0))
    throw Error(`sim host: frameBudgetS must be finite and positive, got ${budget}`);
  const seconds = sim.clock === 'world' ? opts.maxPhysicsWarp * budget : LOCAL_HITCH_S;
  const substeps = Math.max(1, Math.ceil(seconds / h - 1e-9));
  if (!Number.isSafeInteger(substeps))
    throw Error(`sim host: derived substep capacity must be a safe integer, got ${substeps}`);
  if (!Number.isFinite(substeps * h)) throw Error('sim host: derived substep capacity duration must be finite');
  return substeps;
}

/** One advance. The object and its `events` array are reused by the next advance: copy what you keep. */
export interface AdvanceReport {
  steps: number;
  /** Integrated time after the last step (= stepsTaken × h). */
  simTime: number;
  /** Seconds refused and not integrated (local hitch clamp or substep cap). Always 0 for world hosts. */
  dropped: number;
  events: SimEvent[];
  /** Leftover fraction of a step, for render interpolation. */
  alpha: number;
}

/**
 * Accumulator host. `advance(acceptedDt, inputForTick)` runs whole fixed steps with tick-addressed input. The
 * state after N steps depends only on N and the inputs, never on how frames were grouped: the determinism
 * contract replays rely on (STD-SIM-17). World UT = epoch + simTime + accumulator.
 * This host is not the world coordinator: pause, event-boundary slicing and clock commitment live in the loop.
 */
export class FixedStepHost<S, I> {
  private acc = 0;
  /** Integrated seconds; always stepsTaken × fixedStep (multiplied, never accumulated: no drift). */
  simTime = 0;
  stepsTaken = 0;
  /** World hosts: the UT their tick 0 corresponds to. Moved by `rebase` when covered time went elsewhere. */
  epoch = 0;
  readonly maxSubsteps: number;
  private readonly report: AdvanceReport = {steps: 0, simTime: 0, dropped: 0, events: [], alpha: 0};

  constructor(
    readonly sim: Simulation<S, I>,
    readonly opts: HostOptions,
  ) {
    this.maxSubsteps = deriveMaxSubsteps(sim, opts);
  }

  /** Remaining capacity for the next committed interval (seconds in this sim's clock). */
  capacityS(): number {
    return Math.max(0, this.maxSubsteps * this.sim.fixedStep - this.acc);
  }

  /** Universal time the host has accounted for (world hosts). */
  accountedUt(): number {
    return this.epoch + this.simTime + this.acc;
  }

  /** Covered or paused time was not integrated here (rails, freeze): shift the epoch so UT accounting stays exact. */
  rebase(skippedS: number): void {
    if (!(skippedS >= 0) || !Number.isFinite(skippedS))
      throw Error('sim host: rebase needs a finite, non-negative interval');
    this.epoch += skippedS;
  }

  advance(acceptedDt: number, inputForTick: (tick: number) => I): AdvanceReport {
    if (!Number.isFinite(acceptedDt) || acceptedDt < 0)
      throw Error(`sim host ${this.sim.id}: invalid accepted interval ${acceptedDt}`);
    const sim = this.sim,
      h = sim.fixedStep,
      local = sim.clock === 'local',
      r = this.report;
    if (!local && acceptedDt > this.capacityS() + CAPACITY_TOLERANCE_S) {
      throw Error(
        `sim host ${sim.id}: world interval ${acceptedDt} s exceeds capacity ${this.capacityS()} s; negotiate before the clock commits`,
      );
    }
    let dropped = 0,
      accepted = acceptedDt;
    if (local && accepted > LOCAL_HITCH_S) {
      dropped = accepted - LOCAL_HITCH_S;
      accepted = LOCAL_HITCH_S;
    }
    this.acc += accepted;
    r.events.length = 0;
    let steps = 0;
    while (this.acc >= h - 1e-12 && steps < this.maxSubsteps) {
      sim.step(sim.state, inputForTick(this.stepsTaken), h, this.simTime);
      this.stepsTaken++;
      steps++;
      this.simTime = this.stepsTaken * h;
      this.acc -= h;
      const drained = sim.drainEvents ? sim.drainEvents() : NO_EVENTS;
      for (let i = 0; i < drained.length; i++) r.events.push(drained[i]!); // i < drained.length
    }
    if (this.acc < 0) this.acc = 0; // the 1e-12 tolerance may leave a tiny negative remainder
    if (local && steps === this.maxSubsteps && this.acc >= h) {
      const keep = this.acc % h;
      dropped += this.acc - keep;
      this.acc = keep;
    }
    r.steps = steps;
    r.simTime = this.simTime;
    r.dropped = dropped;
    r.alpha = this.acc / h;
    return r;
  }
}

/** A point-mass simulation built from force terms, with events located inside the step. */
export class PointMassSim<P> implements Simulation<Float64Array, P> {
  readonly clock = 'world' as const;
  readonly whenCovered = 'rails' as const;
  /** The id of the terminal event that stopped the sim, if one did. A stopped sim steps nothing. */
  stopped: string | null = null;
  private readonly stepper: FixedStepper;
  private readonly ws: EventWorkspace;
  private events: SimEvent[] = [];
  private spare: SimEvent[] = [];
  private current!: P;
  private readonly onHit = (hit: EventHit): void => {
    this.events.push({id: hit.id, t: hit.t, detail: hit.y});
  };

  constructor(
    readonly id: string,
    readonly fixedStep: number,
    public state: Float64Array,
    terms: readonly ForceTerm<P>[],
    readonly method: 'rk4' | 'symplectic-euler' = 'rk4',
    private readonly odeEvents: readonly OdeEvent[] = [],
    private readonly tolT = 1e-9,
  ) {
    if (state.length < 7) throw Error(`PointMassSim ${id}: state needs [x,y,z,vx,vy,vz,m], got ${state.length}`);
    this.stepper = new FixedStepper(
      state.length,
      forcesRhs(terms, () => this.current),
      method,
      3,
    );
    this.ws = new EventWorkspace(state.length, odeEvents.length);
  }

  /** Allocation-free unless an event fires. */
  step(y: Float64Array, input: P, dt: number, t: number): void {
    if (this.stopped) return;
    this.current = input;
    const stopped = stepWithEvents(this.stepper, this.ws, t, y, dt, this.odeEvents, this.tolT, this.onHit);
    if (stopped) this.stopped = stopped;
  }

  /** The state was changed outside the stepper (an impulse, a reset): forget the previous event values. */
  resetEvents(): void {
    this.ws.reset();
    this.stopped = null;
  }

  drainEvents(): readonly SimEvent[] {
    if (this.events.length === 0) return NO_EVENTS;
    const out = this.events;
    this.events = this.spare;
    this.spare = out;
    this.events.length = 0;
    return out; // valid until the next drain that returned events
  }
}

// ------------------------------------------------------------------ FrameLoop driver

/** The FrameLoop coverage rule for a simulation's `whenCovered` (STD-SIM-18, STD-RUN-3). */
export function tickerCoverage(w: SimWhenCovered | undefined): WhenCovered {
  if (w === undefined || w === 'rails' || w === 'freeze') return 'pause';
  if (!(w.hz > 0)) throw Error(`sim whenCovered: hz must be positive, got ${w.hz}`);
  return {hz: w.hz};
}

export interface SimTickerOptions<I> {
  owner: string;
  /** Tick-addressed input (STD-SIM-12). */
  input(tick: number): I;
  /** After each advance that ran, e.g. to hand events to presentation. The report is reused: copy what you keep. */
  onAdvance?(report: AdvanceReport, frame: FrameInfo): void;
  /** Lower runs first. Default -100: simulation before camera before render. */
  priority?: number;
  /**
   * World hosts: the interval the coordinator accepted this frame. Default: the committed UT since the last frame
   * this ticker ran. Frames the ticker missed (covered, idle, hidden) are rebased, never caught up.
   */
  worldInterval?(frame: FrameInfo): number;
}

/**
 * A FrameLoop ticker that drives a host. Local sims advance by the frame's unwarped `dt` (the loop resumes a
 * ticker with dt = 0 after coverage, so there is never a catch-up burst); world sims advance by committed UT.
 * The ticker is continuous: a running simulation needs every frame.
 */
export function simTicker<S, I>(host: FixedStepHost<S, I>, opts: SimTickerOptions<I>): TickerSpec {
  const sim = host.sim;
  let lastFrame = -1,
    lastUt = 0;
  return {
    owner: opts.owner,
    mode: 'continuous',
    priority: opts.priority ?? -100,
    whenCovered: tickerCoverage(sim.whenCovered),
    maxDt: sim.clock === 'local' ? LOCAL_HITCH_S : Infinity,
    update(f) {
      let dt: number;
      if (sim.clock === 'local') dt = f.dt;
      else if (opts.worldInterval) dt = opts.worldInterval(f);
      else {
        const contiguous = f.frame === lastFrame + 1 && f.dt > 0;
        if (lastFrame < 0)
          host.epoch = f.ut; // tick 0 is the UT at which the ticker first ran
        else if (!contiguous) host.rebase(Math.max(0, f.ut - lastUt));
        dt = contiguous ? Math.max(0, f.ut - lastUt) : 0;
        lastUt = f.ut;
      }
      lastFrame = f.frame;
      const report = host.advance(dt, opts.input);
      opts.onAdvance?.(report, f);
    },
  };
}
