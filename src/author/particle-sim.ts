/**
 * author/particle-sim.ts: the particle field of one scene visit (FX-01). Pure: no three.js, no DOM, no clock. Shared by
 * the browser runtime and `testScene`, so a game's tests see the same admission, despawn and randomness as a player.
 *
 * Owner and lifetime: one field per visit, stepped by the engine's fixed system (`engine.particles`, after the scene's
 * own fixed systems) and disposed with the visit. Each admitted emitter gets one slot with a pool allocated ONCE at
 * admission (typed arrays sized by its `max`, thinned by the quality scale); stepping, spawning, killing and the
 * per-frame write do not allocate per particle (the world query that finds emitters allocates its usual iterator).
 *
 * Bounds and overload:
 * - per emitter: `max` live particles. A spawn into a full pool is dropped and counted (`dropped`), never recycled;
 * - per scene: admitted emitters' `max` sum to at most `limits.max`, and at most `limits.emitters` emitters (one draw
 *   each). An emitter that does not fit is refused and counted by cause (the first refusal of each cause in a visit is
 *   reported) and not
 *   drawn. A refused burst is dropped and counted, and a refused `despawn` one-shot is removed, so a refused hit never
 *   fires late; a refused continuous emitter is admitted on a later step if
 *   capacity frees. Admission uses the unscaled `max`, so it is the same on every quality preset;
 * - per step: at most `PARTICLE_LIMITS.burstsPerStep` bursts and `max` continuous spawns per emitter; the rest are
 *   dropped and counted.
 * Invalid data is reported once per change of problem and the emitter freezes (no step, no spawn) until it is valid.
 *
 * Determinism: an emitter's stream is seeded with one `seed()` draw when admitted. `seed` is the particles' own stream
 * (runtime.ts, testing.ts), never the gameplay `ctx.random`, so effects cannot shift a game's random sequence; every
 * spawn attempt takes exactly four draws (five for a 'random-start' flipbook), before thinning and before the pool check, so the stream (and the
 * `despawn` time) does not depend on the quality preset. Thinning keeps spawn index k when
 * floor((k+1)·scale) > floor(k·scale): a lighter preset draws a deterministic subset of the reference particles.
 */
import {mulberry32} from '../core/rng';
import type {Entity, World} from '../core/ecs/world';
import {Transform} from './defs';
import {Emitter, emitterProblem, flipbookFrame} from './particles';
import {
  PARTICLE_LIMITS,
  normalizeSceneParticles,
  type EmitterData,
  type EmitterSlot,
  type ParticleField,
  type ParticleFieldOptions,
  type ParticlePool,
  type SceneParticleLimits,
  type SceneParticles,
} from './particle-contract';
export type {
  EmitterSlot,
  ParticleField,
  ParticleFieldOptions,
  ParticlePool,
  ParticleRenderer,
  ParticleStats,
  SceneParticles,
} from './particle-contract';

interface Slot extends EmitterSlot {
  rng: () => number;
  spawnIndex: number;
  seenBursts: number;
  carry: number;
  sinceEmit: number;
  emitted: boolean;
  hasPos: boolean;
  ex: number;
  ey: number;
  ez: number;
  /** Linear-light colour keys (rgb × up to 8), refreshed each step from `data.color`. */
  readonly linear: Float32Array;
  drawn: number;
  seen: number;
}
/** Per-entity bookkeeping while the entity has an emitter: survives a rebuild of its slot. */
interface Note {
  seen: number;
  problem: string | null;
  refused: boolean;
  /** Bursts already accounted for (fired, or dropped while refused); null before the first admission or refusal, so a
   *  prefab's `bursts: 1` fires on spawn while a rebuilt or late-admitted emitter never re-fires old bursts. */
  bursts: number | null;
  /** Its renderer refused to bind it: not admitted again this visit. */
  failed: boolean;
}

function allocatePool(capacity: number, flipbook: boolean): ParticlePool {
  return {
    capacity,
    live: 0,
    pos: new Float64Array(capacity * 3),
    prev: new Float64Array(capacity * 3),
    vel: new Float64Array(capacity * 3),
    age: new Float64Array(capacity),
    prevAge: new Float64Array(capacity),
    life: new Float64Array(capacity),
    offset: new Float32Array(capacity * 3),
    size: new Float32Array(capacity),
    tint: new Float32Array(capacity * 4),
    frame: new Float32Array(flipbook ? capacity : 0),
    start: new Float32Array(flipbook ? capacity : 0),
  };
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** A curve of 1…8 evenly spaced keys at t in [0, 1]. */
function curve(keys: ArrayLike<number>, n: number, t: number, stride = 1, at = 0): number {
  // Hot path: callers pass n keys of `stride` values each (n ≥ 1), t in [0, 1], so every index is in range.
  if (n <= 1) return keys[at]!;
  const x = t * (n - 1),
    i = x >= n - 1 ? n - 2 : Math.floor(x),
    f = x - i;
  const a = keys[i * stride + at]!,
    b = keys[(i + 1) * stride + at]!;
  return a + (b - a) * f;
}
/** Is spawn index k drawn at `scale`? Deterministic, preset-independent subset. */
export const keeps = (k: number, scale: number) => scale >= 1 || Math.floor((k + 1) * scale) > Math.floor(k * scale);

export function createParticleField(o: ParticleFieldOptions): ParticleField {
  const scale = Number.isFinite(o.scale) ? Math.min(1, Math.max(0.01, o.scale)) : 1;
  const slots = new Map<Entity, Slot>(),
    notes = new Map<Entity, Note>(),
    finished: Entity[] = [];
  // Emitters waiting for admission this step (reused arrays): admitted after retired slots free their capacity.
  const waiting: Entity[] = [],
    waitingData: EmitterData[] = [];
  const counts = {spawned: 0, thinned: 0, dropped: 0, refused: 0, invalid: 0};
  let tick = 0,
    reserved = 0,
    disposed = false;
  // Refusals by cause; each cause is reported once per visit (a later refusal for the other cause is still reported).
  const refusals = {emitters: 0, particles: 0},
    refusalReported = {emitters: false, particles: false};
  const report = (error: Error) => {
    try {
      o.report(error);
    } catch {
      /* Diagnostics cannot stop the step. */
    }
  };
  // Per-step scratch (numbers only): the rotated launch axis and two perpendicular unit vectors.
  let ax = 0,
    ay = 1,
    az = 0,
    ux = 1,
    uy = 0,
    uz = 0,
    wx = 0,
    wy = 0,
    wz = 1;

  const release = (slot: Slot) => {
    if (slots.get(slot.entity) !== slot) return;
    slots.delete(slot.entity);
    reserved -= slot.reserved;
    slot.pool.live = 0;
    const note = notes.get(slot.entity);
    if (note) note.bursts = slot.seenBursts;
    try {
      o.renderer?.release(slot);
    } catch (error) {
      report(error instanceof Error ? error : Error(String(error)));
    }
  };

  const admit = (e: Entity, d: EmitterData, note: Note): Slot | undefined => {
    const cause = slots.size >= o.limits.emitters ? 'emitters' : reserved + d.max > o.limits.max ? 'particles' : null;
    if (cause) {
      if (!note.refused) {
        note.refused = true;
        counts.refused++;
        refusals[cause]++;
        // Once per cause per visit: sustained overload must not flood the log; stats keep counting.
        if (!refusalReported[cause]) {
          refusalReported[cause] = true;
          report(
            Error(
              cause === 'emitters'
                ? `particles: emitter on entity ${e} refused: the scene's limit of ${o.limits.emitters} emitters is reached. Further refusals for this cause are counted in stats.refusals.emitters, not reported`
                : `particles: emitter on entity ${e} refused: its max ${d.max} would exceed the scene's ${o.limits.max} reserved particles (${reserved} reserved). Further refusals for this cause are counted in stats.refusals.particles, not reported`,
            ),
          );
        }
      }
      return undefined;
    }
    note.refused = false;
    const s = d.essential ? 1 : scale,
      cols = d.frames?.cols ?? 0,
      rows = d.frames?.rows ?? 0;
    const slot: Slot = {
      entity: e,
      data: d,
      reserved: d.max,
      scale: s,
      texture: d.texture,
      blending: d.blending,
      cols,
      rows,
      view: undefined,
      pool: allocatePool(Math.max(1, Math.ceil(d.max * s)), cols > 0),
      rng: mulberry32(Math.floor(Math.min(0.999999999, Math.max(0, o.seed())) * 4294967296) >>> 0),
      spawnIndex: 0,
      seenBursts: note.bursts ?? 0,
      carry: 0,
      sinceEmit: 0,
      emitted: false,
      hasPos: false,
      ex: 0,
      ey: 0,
      ez: 0,
      linear: new Float32Array(PARTICLE_LIMITS.keys * 3),
      drawn: 0,
      seen: tick,
    };
    slots.set(e, slot);
    reserved += d.max;
    try {
      o.renderer?.bind(slot);
    } catch (error) {
      note.failed = true;
      report(error instanceof Error ? error : Error(String(error)));
      release(slot);
      return undefined;
    }
    return slot;
  };

  /** The launch frame for this step: `direction` rotated by the transform (three.js 'XYZ' Euler order), normalised. */
  const frame = (d: EmitterData, rx: number, ry: number, rz: number) => {
    let x = d.direction[0],
      y = d.direction[1],
      z = d.direction[2],
      t: number;
    const len = Math.hypot(x, y, z);
    x /= len;
    y /= len;
    z /= len;
    if (rz) {
      const c = Math.cos(rz),
        s = Math.sin(rz);
      t = x * c - y * s;
      y = x * s + y * c;
      x = t;
    }
    if (ry) {
      const c = Math.cos(ry),
        s = Math.sin(ry);
      t = x * c + z * s;
      z = -x * s + z * c;
      x = t;
    }
    if (rx) {
      const c = Math.cos(rx),
        s = Math.sin(rx);
      t = y * c - z * s;
      z = y * s + z * c;
      y = t;
    }
    ax = x;
    ay = y;
    az = z;
    // u: any unit vector perpendicular to a; w = a × u.
    if (Math.abs(ax) < 0.9) {
      ux = 0;
      uy = az;
      uz = -ay;
    } else {
      ux = -az;
      uy = 0;
      uz = ax;
    }
    const ul = Math.hypot(ux, uy, uz);
    ux /= ul;
    uy /= ul;
    uz /= ul;
    wx = ay * uz - az * uy;
    wy = az * ux - ax * uz;
    wz = ax * uy - ay * ux;
  };

  const spawn = (slot: Slot, d: EmitterData, f: number, dt: number, x: number, y: number, z: number) => {
    const r = slot.rng,
      u0 = r(),
      u1 = r(),
      u2 = r(),
      u3 = r(),
      // 'random-start' takes a fifth draw per attempt (before thinning, so the stream stays preset-independent); every
      // other emitter keeps exactly four, so its particles are unchanged by the flipbook feature.
      frames = slot.cols ? d.frames : null,
      u4 = frames?.mode === 'random-start' ? r() : 0;
    const k = slot.spawnIndex++;
    counts.spawned++;
    if (!keeps(k, slot.scale)) {
      counts.thinned++;
      return;
    }
    const p = slot.pool;
    if (p.live >= p.capacity) {
      counts.dropped++;
      return;
    }
    const life = d.lifetime[0] + (d.lifetime[1] - d.lifetime[0]) * u0,
      age = (1 - f) * dt;
    if (age >= life) return;
    const speed = d.speed[0] + (d.speed[1] - d.speed[0]) * u1;
    const cosT = 1 - u2 * (1 - Math.cos(d.spread)),
      sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const phi = 2 * Math.PI * u3,
      cp = Math.cos(phi) * sinT,
      sp = Math.sin(phi) * sinT;
    const vx = (ax * cosT + ux * cp + wx * sp) * speed,
      vy = (ay * cosT + uy * cp + wy * sp) * speed,
      vz = (az * cosT + uz * cp + wz * sp) * speed;
    // Spread spawns along the emitter's movement through this step, so a moving emitter leaves an even trail.
    const sx = slot.ex + (x - slot.ex) * f,
      sy = slot.ey + (y - slot.ey) * f,
      sz = slot.ez + (z - slot.ez) * f;
    const i = p.live++,
      j = i * 3;
    p.prev[j] = sx;
    p.prev[j + 1] = sy;
    p.prev[j + 2] = sz;
    p.pos[j] = sx + vx * age;
    p.pos[j + 1] = sy + vy * age;
    p.pos[j + 2] = sz + vz * age;
    p.vel[j] = vx;
    p.vel[j + 1] = vy;
    p.vel[j + 2] = vz;
    p.prevAge[i] = 0;
    p.age[i] = age;
    p.life[i] = life;
    if (frames) p.start[i] = Math.floor(u4 * (frames.count ?? frames.cols * frames.rows));
  };

  const simulate = (
    slot: Slot,
    d: EmitterData,
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
    dt: number,
  ): boolean => {
    const p = slot.pool;
    if (!slot.hasPos) {
      slot.ex = x;
      slot.ey = y;
      slot.ez = z;
      slot.hasPos = true;
    }
    const n = d.color.length;
    // Hot path: i < n = d.color.length ≤ 8 keys (linear holds 8 × 3); pool indices below stay under p.live ≤ capacity.
    for (let i = 0; i < n; i++) {
      const c = d.color[i]!;
      slot.linear[i * 3] = toLinear(((c >> 16) & 255) / 255);
      slot.linear[i * 3 + 1] = toLinear(((c >> 8) & 255) / 255);
      slot.linear[i * 3 + 2] = toLinear((c & 255) / 255);
    }
    // 1. Advance and retire (swap-remove keeps [0, live) packed).
    const gx = d.gravity[0] * dt,
      gy = d.gravity[1] * dt,
      gz = d.gravity[2] * dt,
      keep = Math.max(0, 1 - d.drag * dt);
    for (let i = 0; i < p.live;) {
      const age = (p.age[i] = p.age[i]! + dt);
      if (age >= p.life[i]!) {
        const last = --p.live;
        if (i !== last) {
          const a = i * 3,
            b = last * 3;
          for (let c = 0; c < 3; c++) {
            p.pos[a + c] = p.pos[b + c]!;
            p.prev[a + c] = p.prev[b + c]!;
            p.vel[a + c] = p.vel[b + c]!;
          }
          p.age[i] = p.age[last]!;
          p.prevAge[i] = p.prevAge[last]!;
          p.life[i] = p.life[last]!;
          if (slot.cols) p.start[i] = p.start[last]!;
        }
        continue; // index i now holds the last particle, not yet advanced this step: process it next.
      }
      p.prevAge[i] = age - dt;
      const j = i * 3;
      const px = (p.prev[j] = p.pos[j]!),
        py = (p.prev[j + 1] = p.pos[j + 1]!),
        pz = (p.prev[j + 2] = p.pos[j + 2]!);
      const vx = (p.vel[j] = (p.vel[j]! + gx) * keep),
        vy = (p.vel[j + 1] = (p.vel[j + 1]! + gy) * keep),
        vz = (p.vel[j + 2] = (p.vel[j + 2]! + gz) * keep);
      p.pos[j] = px + vx * dt;
      p.pos[j + 1] = py + vy * dt;
      p.pos[j + 2] = pz + vz * dt;
      i++;
    }
    // 2. Spawn.
    let bursts = 0,
      stream = 0;
    if (d.mode === 'burst') {
      let pending = d.bursts - slot.seenBursts;
      if (pending < 0) pending = 0; // lowered by the author: nothing to fire
      slot.seenBursts = d.bursts;
      bursts = pending > PARTICLE_LIMITS.burstsPerStep ? PARTICLE_LIMITS.burstsPerStep : pending;
      counts.dropped += (pending - bursts) * d.count;
      slot.carry = 0;
    } else if (d.playing && d.rate > 0) {
      slot.carry += d.rate * dt;
      stream = Math.floor(slot.carry);
      slot.carry -= stream;
      if (stream > d.max) {
        counts.dropped += stream - d.max;
        stream = d.max;
      }
    } else slot.carry = 0;
    const attempts = bursts * d.count + stream;
    if (attempts > 0) {
      frame(d, rx, ry, rz);
      for (let b = 0; b < bursts; b++) for (let k = 0; k < d.count; k++) spawn(slot, d, 1, dt, x, y, z);
      for (let k = 0; k < stream; k++) spawn(slot, d, (k + 1) / stream, dt, x, y, z);
      slot.emitted = true;
      slot.sinceEmit = 0;
    } else slot.sinceEmit += dt;
    slot.ex = x;
    slot.ey = y;
    slot.ez = z;
    // 3. Finished? A function of the data and the step count only, never of which particles a preset kept.
    return (
      d.despawn &&
      slot.emitted &&
      slot.sinceEmit >= d.lifetime[1] &&
      (d.mode === 'burst' ? d.bursts <= slot.seenBursts : !d.playing)
    );
  };

  const field: ParticleField = {
    get stats() {
      let live = 0;
      for (const s of slots.values()) live += s.pool.live;
      return {emitters: slots.size, live, reserved, ...counts, refusals: {...refusals}};
    },
    step(world, dt) {
      if (disposed || !(dt > 0)) return;
      tick++;
      finished.length = 0;
      waiting.length = 0;
      waitingData.length = 0;
      for (const [e, tr, d] of world.query(Transform, Emitter)) {
        let note = notes.get(e);
        if (!note) notes.set(e, (note = {seen: tick, problem: null, refused: false, bursts: null, failed: false}));
        note.seen = tick;
        let slot = slots.get(e);
        if (
          slot &&
          (slot.data !== d ||
            slot.reserved !== d.max ||
            slot.texture !== d.texture ||
            slot.blending !== d.blending ||
            slot.cols !== (d.frames?.cols ?? 0) ||
            slot.rows !== (d.frames?.rows ?? 0))
        ) {
          release(slot);
          slot = undefined;
        }
        const problem = emitterProblem(d);
        if (problem !== note.problem) {
          note.problem = problem;
          if (problem) {
            counts.invalid++;
            report(Error(`${problem} (entity ${e})`));
          }
        }
        if (problem) {
          if (slot) slot.seen = tick;
          continue;
        }
        if (!slot) {
          waiting.push(e);
          waitingData.push(d);
          continue;
        }
        slot.seen = tick;
        if (simulate(slot, d, tr.x, tr.y, tr.z, tr.rx, tr.ry, tr.rz, dt)) finished.push(e);
      }
      for (const slot of slots.values()) if (slot.seen !== tick) release(slot);
      for (const [e, note] of notes) if (note.seen !== tick) notes.delete(e);
      // Admission in spawn order, after this step's retirements, so freed capacity is reused at once.
      for (let i = 0; i < waiting.length; i++) {
        // i < waiting.length = waitingData.length (pushed together); every waiting entity got a note above.
        const e = waiting[i]!,
          d = waitingData[i]!,
          note = notes.get(e)!;
        if (note.failed) continue;
        const slot = admit(e, d, note);
        if (!slot) {
          // Refused: a burst is dropped and counted, never fired late from a stale position; a one-shot that would remove
          // itself is removed now. A continuous emitter waits and starts when capacity frees.
          if (d.mode === 'burst') {
            const pending = d.bursts - (note.bursts ?? 0);
            note.bursts = d.bursts;
            if (pending > 0) {
              counts.dropped += pending * d.count;
              if (d.despawn) finished.push(e);
            }
          }
          continue;
        }
        const tr = world.get(e, Transform)!;
        if (simulate(slot, d, tr.x, tr.y, tr.z, tr.rx, tr.ry, tr.rz, dt)) finished.push(e);
      }
      for (const e of finished) {
        const slot = slots.get(e);
        if (slot) release(slot);
        notes.delete(e);
        world.despawn(e);
      }
    },
    interpolate(alpha) {
      if (disposed) return false;
      const a = alpha > 0 ? (alpha < 1 ? alpha : 1) : 0;
      let changed = false;
      for (const slot of slots.values()) {
        const p = slot.pool,
          d = slot.data,
          n = p.live;
        if (n === 0 && slot.drawn === 0) continue;
        changed = true;
        slot.drawn = n;
        const sizes = d.size,
          sn = sizes.length,
          ops = d.opacity,
          on = ops.length,
          cn = d.color.length,
          frames = slot.cols ? d.frames : null,
          frameCount = frames ? (frames.count ?? frames.cols * frames.rows) : 0,
          fps = frames?.fps ?? 0;
        // Hot path: i < n = p.live ≤ capacity, so every pool index is in range.
        for (let i = 0; i < n; i++) {
          const j = i * 3,
            q = i * 4;
          const prevAge = p.prevAge[i]!,
            life = p.life[i]!;
          const age = prevAge + (p.age[i]! - prevAge) * a,
            t = age <= 0 ? 0 : age >= life ? 1 : age / life;
          const x0 = p.prev[j]!,
            y0 = p.prev[j + 1]!,
            z0 = p.prev[j + 2]!;
          p.offset[j] = x0 + (p.pos[j]! - x0) * a;
          p.offset[j + 1] = y0 + (p.pos[j + 1]! - y0) * a;
          p.offset[j + 2] = z0 + (p.pos[j + 2]! - z0) * a;
          p.size[i] = curve(sizes, sn, t);
          p.tint[q] = curve(slot.linear, cn, t, 3, 0);
          p.tint[q + 1] = curve(slot.linear, cn, t, 3, 1);
          p.tint[q + 2] = curve(slot.linear, cn, t, 3, 2);
          p.tint[q + 3] = curve(ops, on, t);
          if (frames) p.frame[i] = flipbookFrame(frames.mode, frameCount, fps, age, life, p.start[i]!);
        }
        try {
          o.renderer?.draw(slot, n);
        } catch (error) {
          report(error instanceof Error ? error : Error(String(error)));
        }
      }
      return changed;
    },
    bindFailed(slot, error) {
      const note = notes.get(slot.entity);
      if (note) note.failed = true;
      report(error instanceof Error ? error : Error(String(error)));
      release(slot as Slot);
    },
    busy(world) {
      if (disposed) return false;
      for (const s of slots.values()) if (s.pool.live > 0 || (s.data.despawn && s.emitted)) return true;
      for (const [e, , d] of world.query(Transform, Emitter)) {
        if (
          d.mode === 'continuous'
            ? d.playing && d.rate > 0
            : d.bursts > (slots.get(e)?.seenBursts ?? notes.get(e)?.bursts ?? 0)
        )
          return true;
      }
      return false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      for (const slot of [...slots.values()])
        try {
          release(slot);
        } catch (error) {
          errors.push(error);
        }
      notes.clear();
      if (errors.length) throw new AggregateError(errors, 'particle cleanup failed');
    },
  };
  return field;
}

/**
 * A scene's particle support: `defineScene({ particles: sceneParticles({ max, emitters }) })`. Without it a scene's
 * emitters are not simulated or drawn (and are reported once). Defaults: 16 emitters reserving 4,096 particles.
 */
export function sceneParticles(limits?: Partial<SceneParticleLimits>): SceneParticles {
  const normalized = normalizeSceneParticles(limits);
  return Object.freeze({
    kind: 'scene-particles' as const,
    limits: normalized,
    createField: (o: Omit<ParticleFieldOptions, 'limits'>) => createParticleField({...o, limits: normalized}),
  });
}
