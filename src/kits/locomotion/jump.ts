/**
 * kits/locomotion/jump: a tunable vertical controller for jumping actors (MV-01). Pure: no world, no input service.
 *
 * The caller owns collision and support. Each fixed tick it reports whether the actor is supported and the press /
 * hold state of its jump action; the controller returns the vertical displacement for the tick. Gravity is
 * integrated exactly (piecewise constant acceleration, split where the gravity regime changes), so the arc does not
 * depend on the tick length; only input and contact timing are quantised to ticks.
 *
 * Parameterisation by apex height and time to apex follows the published "better jump" derivation (launch speed
 * 2h/t, gravity 2h/t^2), extended so `height` and `timeToApex` remain exact when apex gravity modulation is on.
 */

export interface JumpFeelConfig {
  /** Apex height above take-off with the action held for the whole rise, in metres: (0, 1000]. */
  height: number;
  /** Seconds from take-off to apex with the action held: [0.02, 10]. */
  timeToApex: number;
  /** Gravity multiplier while descending outside the apex band: [1, 10]. Default 1.5. */
  fallGravityScale?: number;
  /** Gravity multiplier while still rising after the action was released (variable height): [1, 20]. Default 2; 1 disables. */
  releaseGravityScale?: number;
  /** Half-width of the apex band as a fraction of the launch speed: [0, 0.9]. Default 0 (no band). */
  apexBand?: number;
  /** Gravity multiplier inside the apex band while the action is held: [0.1, 1]. Default 1 (no modulation). */
  apexGravityScale?: number;
  /** Terminal descent speed in m/s: (0, 1000]. Default 1000. */
  maxFallSpeed?: number;
  /** Seconds after losing support during which a press still jumps: [0, 1]. Default 0.1; 0 disables. */
  coyoteTime?: number;
  /** Seconds a press stays pending while a jump is not possible: [0, 1]. Default 0.1; 0 keeps it for its own tick only. */
  bufferTime?: number;
  /** The longest accepted step in seconds: (0, 0.25]. Default 0.25. */
  maxDt?: number;
}

export interface JumpFeelDerived {
  readonly launchSpeed: number; readonly gravity: number; readonly fallGravity: number;
  readonly releaseGravity: number; readonly apexGravity: number; readonly apexSpeed: number; readonly maxFallSpeed: number;
}

/** One tick of caller-observed facts. `pressed` must be true on exactly one tick per physical press. */
export interface JumpFeelInput {
  pressed: boolean; held: boolean; grounded: boolean;
  /** Vertical velocity (m/s) added to the launch speed if this tick jumps, e.g. a rising platform's: [-1000, 1000]. Default 0. */
  boost?: number;
}
export interface JumpFeelStep {
  /** Vertical displacement this tick (m, +up). */
  readonly dy: number;
  /** Vertical velocity at the end of the tick (m/s). */
  readonly vy: number;
  /** Highest displacement reached within the tick, relative to its start (>= max(0, dy)). For ceiling tests. */
  readonly peak: number;
  /** True on the tick a jump started. */
  readonly jumped: boolean;
}
export interface JumpFeelState {
  readonly vy: number; readonly grounded: boolean; readonly fromJump: boolean; readonly released: boolean;
  /** Seconds since the last supported tick (0 on it), or null outside the coyote window or after a jump. */
  readonly sinceSupport: number | null;
  /** Age of the pending press in seconds, or null. */
  readonly pressAge: number | null;
}

function bounded(name: string, value: number | undefined, fallback: number, min: number, max: number, open = false): number {
  const v = value ?? fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v > max || (open ? v <= min : v < min)) throw new RangeError(`jump: ${name} must be within ${open ? '(' : '['}${min}, ${max}]`);
  return v;
}

/** Validate a configuration and derive launch speed and gravities. Throws RangeError for anything out of bounds. */
export function deriveJump(config: JumpFeelConfig): JumpFeelDerived {
  if (!config || typeof config !== 'object') throw new RangeError('jump: config required');
  const h = bounded('height', config.height, NaN, 0, 1000, true), t = bounded('timeToApex', config.timeToApex, NaN, 0.02, 10);
  const fall = bounded('fallGravityScale', config.fallGravityScale, 1.5, 1, 10), release = bounded('releaseGravityScale', config.releaseGravityScale, 2, 1, 20);
  const f = bounded('apexBand', config.apexBand, 0, 0, 0.9), s = bounded('apexGravityScale', config.apexGravityScale, 1, 0.1, 1);
  const maxFall = bounded('maxFallSpeed', config.maxFallSpeed, 1000, 0, 1000, true);
  // With band b = f·v0 and gravity g·s inside it: h = v0²(1 + f·k)/(2g), t = v0(1 + k)/g, where k = f(1/s − 1).
  const k = f * (1 / s - 1), v0 = 2 * h * (1 + k) / (t * (1 + f * k)), g = v0 * (1 + k) / t;
  return Object.freeze({ launchSpeed: v0, gravity: g, fallGravity: g * fall, releaseGravity: g * release, apexGravity: g * s, apexSpeed: f * v0, maxFallSpeed: maxFall });
}

/** Tolerance for comparing accumulated seconds with a window, so window edges do not depend on rounding. */
const WINDOW_EPS = 1e-9;

/**
 * Create one actor's vertical controller. Bounded constant state; no timers or callbacks; per step it allocates only
 * the returned record. Invalid steps throw before any state changes.
 *
 * Grace windows share one convention: an event (losing support, a press) is honoured on a later tick while the time
 * elapsed since the event's tick is at most the window. Losing support counts from the last supported tick, so the
 * first unsupported tick is already `dt` after it (a zero coyote window admits none); a press is honoured on its own
 * tick (elapsed 0) whatever the buffer. At a fixed rate this admits exactly floor(window × rate) ticks after the event.
 */
export function createJumpFeel(config: JumpFeelConfig) {
  const d = deriveJump(config);
  const coyote = bounded('coyoteTime', config.coyoteTime, 0.1, 0, 1), buffer = bounded('bufferTime', config.bufferTime, 0.1, 0, 1);
  const maxDt = bounded('maxDt', config.maxDt, 0.25, 0, 0.25, true);
  const band = d.apexSpeed, floor = -d.maxFallSpeed;
  let vy = 0, grounded = false, fromJump = false, released = false;
  /** Seconds since the last supported tick, or null. */
  let sinceSupport: number | null = null;
  /** Seconds since the pending press's tick, or null; `fresh` marks a press recorded by a zero-length step. */
  let pressAge: number | null = null, fresh = false;
  // Integration results, written by integrate() to avoid a per-step tuple.
  let outDy = 0, outPeak = 0;

  const gravityAt = (v: number, held: boolean) => {
    // Evaluated for the open interval just below v: velocity only decreases under gravity.
    if (v > 0 && fromJump && released) return d.releaseGravity;
    if (held && band > 0 && v <= band && v > -band) return d.apexGravity;
    return v > 0 ? d.gravity : d.fallGravity;
  };
  /** The next velocity below v where the regime can change: band, 0, -band, then terminal speed. */
  const nextBreak = (v: number) => {
    if (band > 0 && v > band) return band;
    if (v > 0) return 0;
    if (band > 0 && v > -band && -band > floor) return -band;
    return floor;
  };

  /** Integrate `dt` seconds exactly into outDy/outPeak. Bounded: at most five pieces per step. */
  const integrate = (dt: number, held: boolean) => {
    let left = dt, y = 0, peak = 0;
    if (vy < floor) vy = floor;
    for (let guard = 0; left > 0 && guard < 6; guard++) {
      if (vy <= floor) { y += vy * left; left = 0; break; }
      const g = gravityAt(vy, held), stop = nextBreak(vy), span = (vy - stop) / g;
      const used = Math.min(left, span);
      y += vy * used - 0.5 * g * used * used;
      vy = used === span ? stop : vy - g * used;
      if (vy <= 0 && fromJump) released = false;
      left -= used; if (y > peak) peak = y;
    }
    outDy = y; outPeak = peak;
  };

  return {
    derived: d,
    /** Current vertical velocity (m/s), without building a state snapshot. */
    get vy() { return vy; },
    /** A frozen snapshot for diagnostics and tests; allocates, so prefer `vy` in a per-tick loop. */
    get state(): JumpFeelState { return Object.freeze({ vy, grounded, fromJump, released, sinceSupport, pressAge }); },
    /**
     * Advance one tick. `dt === 0` only records a press (a frame that ran no simulation); timers do not age, and the
     * press counts as made on the next positive step.
     * Throws RangeError for a negative, non-finite or over-long step, or non-boolean facts, without changing state.
     */
    step(dt: number, input: JumpFeelInput): JumpFeelStep {
      if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0 || dt > maxDt) throw new RangeError(`jump: step must be within [0, ${maxDt}] seconds`);
      if (!input || typeof input.pressed !== 'boolean' || typeof input.held !== 'boolean' || typeof input.grounded !== 'boolean') throw new RangeError('jump: pressed, held and grounded must be booleans');
      const boost = input.boost ?? 0;
      if (typeof boost !== 'number' || !Number.isFinite(boost) || Math.abs(boost) > 1000) throw new RangeError('jump: boost must be finite and within ±1000 m/s');
      if (dt === 0) { if (input.pressed) { pressAge = 0; fresh = true; } return { dy: 0, vy, peak: 0, jumped: false }; }
      // Age the pending press and the support window to this tick, then apply this tick's facts.
      if (input.pressed) pressAge = 0;
      else if (pressAge !== null && !fresh) pressAge += dt;
      fresh = false;
      if (pressAge !== null && pressAge > buffer + WINDOW_EPS) pressAge = null;
      // Support reported while still rising is ignored: the caller resolved last tick's motion before this jump left it.
      grounded = input.grounded && vy <= 0;
      if (grounded) { vy = 0; fromJump = false; released = false; sinceSupport = 0; }
      else if (sinceSupport !== null) { sinceSupport += dt; if (sinceSupport > coyote + WINDOW_EPS) sinceSupport = null; }
      const canJump = grounded || sinceSupport !== null;
      let jumped = false;
      if (pressAge !== null && canJump) {
        vy = d.launchSpeed + boost; jumped = true; grounded = false; fromJump = true; released = false; pressAge = null; sinceSupport = null;
      }
      if (fromJump && vy > 0 && !input.held) released = true;
      integrate(dt, input.held);
      return { dy: outDy, vy, peak: outPeak, jumped };
    },
    /** Caller hit a ceiling: drop upward velocity. */
    ceiling() { if (vy > 0) vy = 0; },
    /** External vertical velocity (a spring, a knockback). Not a jump: release gravity does not apply. */
    setVelocity(v: number) {
      if (!Number.isFinite(v) || Math.abs(v) > 1000) throw new RangeError('jump: velocity must be finite and within ±1000 m/s');
      vy = v; fromJump = false; released = false; if (v > 0) { grounded = false; sinceSupport = null; }
    },
    /** Drop a pending press (a menu opened, control moved elsewhere). */
    cancelPress() { pressAge = null; fresh = false; },
    /** Clear everything: an authority change, a teleport, a respawn. */
    reset() { vy = 0; grounded = false; fromJump = false; released = false; sinceSupport = null; pressAge = null; fresh = false; },
  };
}
export type JumpFeel = ReturnType<typeof createJumpFeel>;
