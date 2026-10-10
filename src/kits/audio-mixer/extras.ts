/**
 * Audio policy helpers that compose with the platform output and the cue mixer: listener placement between camera
 * and character, Doppler playback rates, retrigger pitch escalation and per-sound instance limits. Pure or
 * caller-owned values; no audio context, timer or frame loop.
 */
import {RATE_LIMITS, type CueVoice} from '../../platform/audio/audio-output';

export type AudioVec3 = readonly [number, number, number];
export interface ListenerPose {
  readonly position: AudioVec3;
  readonly forward: AudioVec3;
  readonly up: AudioVec3;
}

const fail = (message: string): never => {
  throw new RangeError(`audio-mixer: ${message}`);
};
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9;
function vec(v: unknown, what: string): AudioVec3 {
  if (!Array.isArray(v) && !ArrayBuffer.isView(v)) return fail(`${what} must be [x, y, z]`);
  const a = v as ArrayLike<unknown>;
  if (a.length !== 3) return fail(`${what} must be [x, y, z]`);
  const x = a[0],
    y = a[1],
    z = a[2];
  if (!finite(x) || !finite(y) || !finite(z)) return fail(`${what} must be finite`);
  return [x, y, z];
}
const unit = (v: AudioVec3, what: string): AudioVec3 => {
  const n = Math.hypot(...v);
  if (!(n > 0)) return fail(`${what} must not be zero`);
  return [v[0] / n, v[1] / n, v[2] / n];
};

/**
 * The listener for third-person games: position blended from the camera (`blend` 0) to the character (`blend` 1),
 * orientation from the camera (what the player sees decides left and right). Assign the result to `ctx.view.listener`.
 * Spatial-audio `pump` should receive the same position, so audibility and panning agree.
 */
export function blendListener(input: {
  readonly camera: {readonly position: AudioVec3; readonly target: AudioVec3};
  readonly character: AudioVec3;
  readonly blend: number;
  readonly up?: AudioVec3;
}): ListenerPose {
  if (typeof input !== 'object' || input === null) fail('input must be an object');
  const cam = input.camera;
  if (typeof cam !== 'object' || cam === null) fail('camera must be an object');
  const p = vec(cam.position, 'camera position'),
    t = vec(cam.target, 'camera target'),
    c = vec(input.character, 'character'),
    b = input.blend;
  if (!(typeof b === 'number' && b >= 0 && b <= 1)) fail('blend must be in [0, 1]');
  const forward = unit([t[0] - p[0], t[1] - p[1], t[2] - p[2]], 'camera direction');
  let up = input.up === undefined ? ([0, 1, 0] as AudioVec3) : unit(vec(input.up, 'up'), 'up');
  // Make up perpendicular to forward (a camera looking straight down keeps a valid frame).
  const d = up[0] * forward[0] + up[1] * forward[1] + up[2] * forward[2];
  let ortho: AudioVec3 = [up[0] - d * forward[0], up[1] - d * forward[1], up[2] - d * forward[2]];
  // Straight up or down: use the screen-up a look-at camera would have (-z looking down, +z looking up).
  if (Math.hypot(...ortho) < 1e-6) ortho = [0, 0, forward[1] < 0 ? -1 : 1];
  up = unit(ortho, 'up');
  return Object.freeze({
    position: Object.freeze([
      p[0] + (c[0] - p[0]) * b,
      p[1] + (c[1] - p[1]) * b,
      p[2] + (c[2] - p[2]) * b,
    ]) as AudioVec3,
    forward: Object.freeze(forward) as AudioVec3,
    up: Object.freeze(up) as AudioVec3,
  });
}

/**
 * Doppler playback rate for a moving source and listener: (c + v_listener·n) / (c - v_source·n), where n points from
 * the source to the listener and c is the speed of sound (default 343). Speeds along n are clamped below c, and the
 * result is clamped to [min, max] (default 0.5 to 2, always inside the platform `RATE_LIMITS`). `factor` scales the
 * effect (0 = none, 1 = physical; default 1). Apply with `voice.setRate(rate)`.
 */
export function dopplerRate(input: {
  readonly source: AudioVec3;
  readonly sourceVelocity: AudioVec3;
  readonly listener: AudioVec3;
  readonly listenerVelocity?: AudioVec3;
  readonly speedOfSound?: number;
  readonly factor?: number;
  readonly min?: number;
  readonly max?: number;
}): number {
  if (typeof input !== 'object' || input === null) fail('input must be an object');
  const s = vec(input.source, 'source'),
    vs = vec(input.sourceVelocity, 'sourceVelocity'),
    l = vec(input.listener, 'listener'),
    vl =
      input.listenerVelocity === undefined ? ([0, 0, 0] as AudioVec3) : vec(input.listenerVelocity, 'listenerVelocity');
  const c = input.speedOfSound ?? 343,
    factor = input.factor ?? 1,
    min = input.min ?? 0.5,
    max = input.max ?? 2;
  if (!finite(c) || c <= 0) fail('speedOfSound must be positive');
  if (!finite(factor) || factor < 0 || factor > 10) fail('factor must be in [0, 10]');
  if (!(finite(min) && finite(max) && min >= RATE_LIMITS.min && max <= RATE_LIMITS.max && min <= 1 && max >= 1))
    fail(`min and max must bracket 1 within [${RATE_LIMITS.min}, ${RATE_LIMITS.max}]`);
  const d: AudioVec3 = [l[0] - s[0], l[1] - s[1], l[2] - s[2]];
  const dist = Math.hypot(...d);
  if (dist === 0 || factor === 0) return 1;
  const n = [d[0] / dist, d[1] / dist, d[2] / dist];
  const limit = c * 0.99;
  const towardListener = Math.max(-limit, Math.min(limit, (vs[0] * n[0]! + vs[1] * n[1]! + vs[2] * n[2]!) * factor));
  const listenerToward = Math.max(-limit, Math.min(limit, -(vl[0] * n[0]! + vl[1] * n[1]! + vl[2] * n[2]!) * factor));
  const rate = (c + listenerToward) / (c - towardListener);
  return Math.min(max, Math.max(min, rate));
}

/**
 * Retrigger pitch escalation (rising pickups, combo hits): each trigger of a key within `window` seconds of the
 * previous one raises the pitch by `semitones`, up to `maxSteps`; a longer gap resets it. Bounded keys (oldest
 * forgotten first). `trigger(key, now)` returns the playback rate for this trigger.
 */
export function createRetrigger(options: {
  readonly window: number;
  readonly semitones: number;
  readonly maxSteps: number;
  readonly maxKeys?: number;
}) {
  if (typeof options !== 'object' || options === null) fail('options must be an object');
  const {window, semitones, maxSteps} = options;
  const maxKeys = options.maxKeys ?? 64;
  if (!finite(window) || window <= 0 || window > 60) fail('window must be in (0, 60] seconds');
  if (!finite(semitones) || semitones < -24 || semitones > 24) fail('semitones must be in [-24, 24]');
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 0 || maxSteps > 64) fail('maxSteps must be an integer 0-64');
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1 || maxKeys > 4096) fail('maxKeys must be an integer 1-4096');
  if (Math.abs(semitones * maxSteps) > 24) fail('semitones * maxSteps must stay within two octaves');
  const keys = new Map<string, {at: number; step: number}>();
  let last = -Infinity;
  return {
    trigger(key: string, now: number): number {
      if (typeof key !== 'string' || key.length === 0 || key.length > 256) fail('key must be 1-256 characters');
      if (!finite(now) || now < last) fail('now must be finite and nondecreasing');
      last = now;
      const prev = keys.get(key);
      const step = prev && now - prev.at <= window ? Math.min(prev.step + 1, maxSteps) : 0;
      keys.delete(key);
      keys.set(key, {at: now, step});
      if (keys.size > maxKeys) keys.delete(keys.keys().next().value!);
      return Math.min(RATE_LIMITS.max, Math.max(RATE_LIMITS.min, 2 ** ((step * semitones) / 12)));
    },
    /** The escalation step (0 = base pitch) a trigger of `key` at `now` would play, without triggering it. */
    peek(key: string, now: number): number {
      if (typeof key !== 'string' || key.length === 0 || key.length > 256) fail('key must be 1-256 characters');
      const prev = keys.get(key);
      return prev && finite(now) && now - prev.at <= window ? Math.min(prev.step + 1, maxSteps) : 0;
    },
    reset(key?: string): void {
      if (key === undefined) {
        keys.clear();
        last = -Infinity; // a restarted timebase (e.g. song time) may begin again from 0
      } else keys.delete(key);
    },
  };
}
export type Retrigger = ReturnType<typeof createRetrigger>;

/**
 * Per-sound instance limits: at most `limits[key]` live voices per key (default `defaultLimit`). When full, `oldest`
 * stops the oldest live voice of that key to make room; `refuse` declines the new one. Voices are the platform
 * `CueVoice` handles (ended voices free their slot automatically). `admit(key)` says whether to play; after playing,
 * `track(key, voice)` records it.
 */
export function createInstanceLimits(options: {
  readonly limits?: Readonly<Record<string, number>>;
  readonly defaultLimit: number;
  readonly policy: 'oldest' | 'refuse';
  readonly maxKeys?: number;
}) {
  if (typeof options !== 'object' || options === null) fail('options must be an object');
  const {defaultLimit, policy} = options;
  const maxKeys = options.maxKeys ?? 256;
  const checkLimit = (n: unknown, what: string) => {
    if (!Number.isSafeInteger(n) || (n as number) < 1 || (n as number) > 256) fail(`${what} must be an integer 1-256`);
    return n as number;
  };
  checkLimit(defaultLimit, 'defaultLimit');
  if (policy !== 'oldest' && policy !== 'refuse') fail('policy must be oldest or refuse');
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1 || maxKeys > 4096) fail('maxKeys must be an integer 1-4096');
  const limits = new Map<string, number>();
  for (const [k, n] of Object.entries(options.limits ?? {})) limits.set(k, checkLimit(n, `limit for ${k}`));
  const live = new Map<string, CueVoice[]>();
  const prune = (key: string) => {
    const list = (live.get(key) ?? []).filter(v => !v.ended);
    if (list.length) live.set(key, list);
    else live.delete(key);
    return list;
  };
  let stolen = 0,
    refused = 0;
  return {
    get stats() {
      return Object.freeze({stolen, refused, keys: live.size});
    },
    /** Whether a new voice of `key` may start now; with `oldest`, stops the oldest live voice when full. */
    admit(key: string): boolean {
      if (typeof key !== 'string' || key.length === 0 || key.length > 256) fail('key must be 1-256 characters');
      const list = prune(key);
      const limit = limits.get(key) ?? defaultLimit;
      if (!live.has(key) && live.size >= maxKeys) for (const other of [...live.keys()]) prune(other);
      if (list.length < limit) {
        if (live.has(key) || live.size < maxKeys) return true;
        refused++;
        return false;
      }
      if (policy === 'refuse') {
        refused++;
        return false;
      }
      list.shift()!.stop();
      stolen++;
      return true;
    },
    /** Record a started voice (null from a skipped play is ignored). */
    /**
     * Record a started voice (null from a skipped play is ignored). Call `admit`, play, then `track` with no other
     * `admit` of the same key in between; a voice beyond the key's limit or the key capacity is stopped at once.
     */
    track(key: string, voice: CueVoice | null): void {
      if (!voice || voice.ended) return;
      const list = prune(key);
      const limit = limits.get(key) ?? defaultLimit;
      if (list.length >= limit || (!live.has(key) && live.size >= maxKeys)) {
        voice.stop();
        refused++;
        return;
      }
      list.push(voice);
      live.set(key, list);
    },
    count(key: string): number {
      return prune(key).length;
    },
    stopAll(): void {
      for (const list of live.values()) for (const v of list) v.stop();
      live.clear();
    },
  };
}
export type InstanceLimits = ReturnType<typeof createInstanceLimits>;
