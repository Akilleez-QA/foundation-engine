/**
 * author/particles.ts: optional particle emitters (FX-01). Plain data; the scene runtime simulates them on the fixed
 * step (`author/particle-sim.ts`) and draws each emitter as ONE instanced draw of camera-facing quads
 * (`author/scene-particles.ts`). A game that never adds an `Emitter` pays no draw and allocates no pool.
 *
 *   [Transform({ y: 1 }), defineEmitter({ mode: 'burst', count: 24, bursts: 1, lifetime: [.3, .6], speed: [2, 5],
 *     spread: Math.PI, gravity: [0, -9.8, 0], size: [.15, 0], color: [0xfff2a8, 0xff6a00], despawn: true })]
 *
 * - `mode: 'burst'` emits `count` particles each time `bursts` grows (`burst(world, entity)` adds one); a prefab with
 *   `bursts: 1` emits once when it is spawned. `mode: 'continuous'` emits `rate` per second while `playing`.
 * - Curves (`size`, `color`, `opacity`) are 1 to 8 keys spread evenly over a particle's life, linearly interpolated.
 * - Randomness is seeded from `ctx.random()` (one draw when the emitter starts) into the emitter's own stream, and every
 *   spawn attempt takes the same number of draws whatever the quality preset, so a replay with `?seed=` is exact and a
 *   lighter preset shows a deterministic subset of the same particles.
 * - Particles are presentation: they never change the world, except `despawn: true`, which removes the entity at a
 *   time computed from the data alone (identical on every preset).
 */
import { component, type ComponentInit, type Entity, type World } from '../core/ecs/world';
import { EMITTER_ID, PARTICLE_LIMITS, type EmitterData } from './particle-contract';
export { PARTICLE_LIMITS, type EmitterData, type EmitterMode, type EmitterBlending } from './particle-contract';

export const EMITTER_DEFAULTS: Readonly<EmitterData> = Object.freeze({
  mode: 'burst', max: 64, rate: 20, count: 16, bursts: 0, playing: true,
  lifetime: [.5, 1], speed: [1, 3], direction: [0, 1, 0], spread: Math.PI / 4, gravity: [0, 0, 0], drag: 0,
  size: [.2], color: [0xffffff], opacity: [1, 0], texture: '', blending: 'additive', essential: false, despawn: false,
} as EmitterData);

const copy = (d: Readonly<EmitterData>): EmitterData => ({ ...d, lifetime: [...d.lifetime], speed: [...d.speed], direction: [...d.direction],
  gravity: [...d.gravity], size: [...d.size], color: [...d.color], opacity: [...d.opacity] } as EmitterData);

/** The emitter component. Use {@link defineEmitter} for a checked initialiser. */
export const Emitter = /* @__PURE__ */ component<EmitterData>(EMITTER_ID, copy(EMITTER_DEFAULTS));

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const within = (n: unknown, lo: number, hi: number) => num(n) && n >= lo && n <= hi;
const vec3 = (v: unknown, limit: number) => Array.isArray(v) && v.length === 3 && within(v[0], -limit, limit) && within(v[1], -limit, limit) && within(v[2], -limit, limit);
const pair = (v: unknown, lo: number, hi: number) => Array.isArray(v) && v.length === 2 && within(v[0], lo, hi) && within(v[1], lo, hi) && v[0] <= v[1];
function keys(v: unknown, ok: (n: unknown) => boolean): boolean {
  if (!Array.isArray(v) || v.length < 1 || v.length > PARTICLE_LIMITS.keys) return false;
  for (let i = 0; i < v.length; i++) if (!ok(v[i])) return false;
  return true;
}
const rgb = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0xffffff;
const unit = (n: unknown) => within(n, 0, 1);
const sized = (n: unknown) => within(n, 0, PARTICLE_LIMITS.size);

/**
 * The first problem with `d`, or null. Allocation-free on valid data (the runtime calls it every fixed step); the
 * message is stable for a given problem, so a report can be deduplicated by comparing it.
 */
export function emitterProblem(d: EmitterData): string | null {
  if (!d || typeof d !== 'object') return 'emitter: data must be an object';
  if (d.mode !== 'burst' && d.mode !== 'continuous') return 'emitter: mode must be burst or continuous';
  if (!Number.isInteger(d.max) || d.max < 1 || d.max > PARTICLE_LIMITS.perEmitter) return `emitter: max must be an integer in [1, ${PARTICLE_LIMITS.perEmitter}]`;
  if (!within(d.rate, 0, PARTICLE_LIMITS.rate)) return `emitter: rate must be in [0, ${PARTICLE_LIMITS.rate}]`;
  if (!Number.isInteger(d.count) || d.count < 0 || d.count > d.max) return 'emitter: count must be an integer in [0, max]';
  if (!Number.isInteger(d.bursts) || d.bursts < 0) return 'emitter: bursts must be a non-negative integer';
  if (typeof d.playing !== 'boolean') return 'emitter: playing must be boolean';
  if (!pair(d.lifetime, 0, PARTICLE_LIMITS.lifetime) || !(d.lifetime[0] > 0)) return `emitter: lifetime must be [min, max] with 0 < min <= max <= ${PARTICLE_LIMITS.lifetime}`;
  if (!pair(d.speed, 0, PARTICLE_LIMITS.speed)) return `emitter: speed must be [min, max] with 0 <= min <= max <= ${PARTICLE_LIMITS.speed}`;
  if (!vec3(d.direction, 1e6) || (d.direction[0] === 0 && d.direction[1] === 0 && d.direction[2] === 0)) return 'emitter: direction must be a non-zero [x, y, z]';
  if (!within(d.spread, 0, Math.PI)) return 'emitter: spread must be in [0, π] radians';
  if (!vec3(d.gravity, PARTICLE_LIMITS.gravity)) return `emitter: gravity must be [x, y, z], each within ±${PARTICLE_LIMITS.gravity}`;
  if (!within(d.drag, 0, PARTICLE_LIMITS.drag)) return `emitter: drag must be in [0, ${PARTICLE_LIMITS.drag}]`;
  if (!keys(d.size, sized)) return `emitter: size must be 1 to ${PARTICLE_LIMITS.keys} keys in [0, ${PARTICLE_LIMITS.size}] metres`;
  if (!keys(d.color, rgb)) return `emitter: color must be 1 to ${PARTICLE_LIMITS.keys} 24-bit RGB keys`;
  if (!keys(d.opacity, unit)) return `emitter: opacity must be 1 to ${PARTICLE_LIMITS.keys} keys in [0, 1]`;
  if (typeof d.texture !== 'string' || d.texture.length > PARTICLE_LIMITS.textureId || (d.texture !== '' && !KEBAB.test(d.texture))) return 'emitter: texture must be \'\' or a kebab-case texture asset id';
  if (d.blending !== 'additive' && d.blending !== 'normal') return 'emitter: blending must be additive or normal';
  if (typeof d.essential !== 'boolean') return 'emitter: essential must be boolean';
  if (typeof d.despawn !== 'boolean') return 'emitter: despawn must be boolean';
  return null;
}

/** Throws on data the runtime would not simulate as written, naming the field. */
export function validateEmitter(d: EmitterData): void {
  const problem = emitterProblem(d);
  if (problem) throw Error(problem);
}

/** A checked `Emitter` initialiser; omitted fields take {@link EMITTER_DEFAULTS} (`count` at most `max`). */
export function defineEmitter(input: Partial<EmitterData>): ComponentInit<EmitterData> {
  const base = copy(EMITTER_DEFAULTS);
  // An omitted burst size never exceeds the pool it is given.
  const count = input.count ?? (Number.isInteger(input.max) ? Math.min(base.count, input.max!) : base.count);
  const data = copy({ ...base, ...input, count } as EmitterData);
  validateEmitter(data);
  return Emitter(data);
}

/** Request `n` more bursts from `entity`'s emitter (fired on the next fixed step). False without an emitter. */
export function burst(world: World, entity: Entity, n = 1): boolean {
  const e = world.get(entity, Emitter);
  if (!e || !Number.isInteger(n) || n < 1) return false;
  e.bursts += n; world.touch();
  return true;
}
