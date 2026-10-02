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
export interface JumpFeelInput { pressed: boolean; held: boolean; grounded: boolean }
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
  /** Seconds since the last supported tick, or null while supported or after a jump consumed the grace. */
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

/**
 * Create one actor's vertical controller. Bounded constant state; no timers, callbacks or allocation per step beyond
 * the returned record. Invalid steps throw before any state changes.
 */
export function createJumpFeel(config: JumpFeelConfig) {
  const d = deriveJump(config);
  const coyote = bounded('coyoteTime', config.coyoteTime, 0.1, 0, 1), buffer = bounded('bufferTime', config.bufferTime, 0.1, 0, 1);
  const maxDt = bounded('maxDt', config.maxDt, 0.25, 0, 0.25, true);
  let vy = 0, grounded = false, fromJump = false, released = false, sinceSupport: number | null = null, pressAge: number | null = null;

  const gravityAt = (v: number, held: boolean) => {
    // Evaluated for the open interval just below v: velocity only decreases under gravity.
    if (v > 0 && fromJump && released) return d.releaseGravity;
    if (held && d.apexSpeed > 0 && v <= d.apexSpeed && v > -d.apexSpeed) return d.apexGravity;
    return v > 0 ? d.gravity : d.fallGravity;
  };
  const nextBreak = (v: number) => {
    let best = -d.maxFallSpeed;
    for (const b of [d.apexSpeed, 0, -d.apexSpeed]) if (b < v && b > best) best = b;
    return best;
  };

  /** Integrate `dt` seconds exactly; returns [dy, peak]. Bounded: at most four regime changes per step. */
  const integrate = (dt: number, held: boolean): [number, number] => {
    let left = dt, y = 0, peak = 0;
    if (vy < -d.maxFallSpeed) vy = -d.maxFallSpeed;
    for (let guard = 0; left > 0 && guard < 6; guard++) {
      if (vy <= -d.maxFallSpeed) { y += vy * left; left = 0; break; }
      const g = gravityAt(vy, held), stop = nextBreak(vy), span = (vy - stop) / g;
      const used = Math.min(left, span);
      y += vy * used - 0.5 * g * used * used;
      vy = used === span ? stop : vy - g * used;
      if (vy <= 0 && fromJump) released = false;
      left -= used; peak = Math.max(peak, y);
    }
    return [y, peak];
  };

  return {
    derived: d,
    get state(): JumpFeelState { return Object.freeze({ vy, grounded, fromJump, released, sinceSupport, pressAge }); },
    /**
     * Advance one tick. `dt === 0` only records a press (a frame that ran no simulation); timers do not age.
     * Throws RangeError for a negative, non-finite or over-long step, or non-boolean facts, without changing state.
     */
    step(dt: number, input: JumpFeelInput): JumpFeelStep {
      if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0 || dt > maxDt) throw new RangeError(`jump: step must be within [0, ${maxDt}] seconds`);
      if (!input || typeof input.pressed !== 'boolean' || typeof input.held !== 'boolean' || typeof input.grounded !== 'boolean') throw new RangeError('jump: pressed, held and grounded must be booleans');
      if (input.pressed) pressAge = 0;
      if (dt === 0) return { dy: 0, vy, peak: 0, jumped: false };
      // Support reported while still rising is ignored: the caller resolved last tick's motion before this jump left it.
      grounded = input.grounded && vy <= 0;
      if (grounded) { vy = 0; fromJump = false; released = false; sinceSupport = 0; }
      const canJump = grounded || (sinceSupport !== null && sinceSupport < coyote);
      let jumped = false;
      if (pressAge !== null && pressAge <= buffer && canJump) {
        vy = d.launchSpeed; jumped = true; grounded = false; fromJump = true; released = false; pressAge = null; sinceSupport = null;
      }
      if (fromJump && vy > 0 && !input.held) released = true;
      const [dy, peak] = integrate(dt, input.held);
      if (pressAge !== null) { pressAge += dt; if (pressAge > buffer) pressAge = null; }
      if (sinceSupport !== null && !grounded) { sinceSupport += dt; if (sinceSupport >= coyote) sinceSupport = null; }
      else if (sinceSupport !== null && grounded) sinceSupport = 0;
      return { dy, vy, peak, jumped };
    },
    /** Caller hit a ceiling: drop upward velocity. */
    ceiling() { if (vy > 0) vy = 0; },
    /** External vertical velocity (a spring, a knockback). Not a jump: release gravity does not apply. */
    setVelocity(v: number) {
      if (!Number.isFinite(v) || Math.abs(v) > 1000) throw new RangeError('jump: velocity must be finite and within ±1000 m/s');
      vy = v; fromJump = false; released = false; if (v > 0) { grounded = false; sinceSupport = null; }
    },
    /** Drop a pending press (a menu opened, control moved elsewhere). */
    cancelPress() { pressAge = null; },
    /** Clear everything: an authority change, a teleport, a respawn. */
    reset() { vy = 0; grounded = false; fromJump = false; released = false; sinceSupport = null; pressAge = null; },
  };
}
export type JumpFeel = ReturnType<typeof createJumpFeel>;
