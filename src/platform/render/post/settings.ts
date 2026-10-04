/**
 * platform/render/post/settings.ts: the post-processing contract, backend-neutral (owner `platform.render.post`;
 * ADR 0078 "effects stay modular"; STD-REN-24, STD-SET-4/5, STD-PRF-9).
 *
 * A scene asks for post-processing with plain data (`defineScene({ view: { post } })`, `ctx.view.post`); the player's
 * `post.mode` knob chooses how much of it runs. This module validates the data and resolves the plan a backend
 * implementation draws: it imports no renderer, so the author API and the shell may read it without loading GPU code.
 * The WebGL2 implementation is `webgl.ts` here (GLSL, a lazy chunk); a WebGPU backend adds its own implementation of
 * the same plan (TSL, under `backends/webgpu/`) one module at a time. Author data never names a pass.
 *
 * Tiers (`post.mode`, exact preset mapping in quality.ts: reference full, high full, medium basic, low off):
 *  - `off`: the scene draws straight to the canvas as it does without post. Tone mapping still comes from the scene's
 *    renderer output setting, so exposure is kept; bloom, vignette and grade are not drawn.
 *  - `basic`: one scene target (half-float, MSAA when `resolution.antialias` is on) and one combined fullscreen pass:
 *    tone map, grade, vignette and sRGB output. 1 post draw.
 *  - `full`: `basic` plus a half-resolution bloom chain of 5 mips: 1 threshold pass, 4 downsamples and 4 upsamples
 *    before the combined pass. 10 post draws.
 *
 * Post draws are counted apart from scene draws (`postDraws`, docs/recipes/add-a-budget.md): `draws` keeps measuring
 * the scene's own complexity.
 */

/** The `post.mode` knob values, cheapest first. */
export type PostMode = 'off' | 'basic' | 'full';
export const POST_MODES: readonly PostMode[] = ['off', 'basic', 'full'];

type RGB = readonly [number, number, number];

/** A glow around bright pixels (linear HDR values above `threshold`). Drawn at `full` only. */
export interface PostBloom {
  /** How much glow is added (0 to 3). Default 0.6. */
  strength?: number;
  /** Linear brightness where glow starts (0 to 16). 1 is "brighter than white"; emissive 2 to 6 glows. Default 1. */
  threshold?: number;
  /** How far the glow spreads (0 tight to 1 wide). Default 0.5. */
  radius?: number;
}
/** Darker corners. Drawn at `basic` and `full`. */
export interface PostVignette {
  /** 0 (none) to 1 (black corners). Default 0. */
  amount?: number;
}
/** A colour grade on the tone-mapped picture. Drawn at `basic` and `full`. */
export interface PostGrade {
  /** Raises the darks per channel (-0.5 to 0.5). Default [0, 0, 0]. */
  lift?: RGB;
  /** Scales the brights per channel (0 to 4). Default [1, 1, 1]. */
  gain?: RGB;
  /** 0 grey to 2 vivid. Default 1. */
  saturation?: number;
}
/** What a scene asks of post-processing. Every field is optional; `bloom: false` turns the glow off even at `full`. */
export interface PostSettings {
  bloom?: PostBloom | false;
  vignette?: PostVignette;
  grade?: PostGrade;
}

/** Validated settings with every default filled in. */
export interface PostResolved {
  readonly bloom: Readonly<Required<PostBloom>> | null;
  readonly vignette: Readonly<Required<PostVignette>>;
  readonly grade: Readonly<{lift: RGB; gain: RGB; saturation: number}>;
}

/** What a backend draws this frame: null is `off` (direct rendering). */
export interface PostPlan extends PostResolved {
  readonly mode: 'basic' | 'full';
}

export const POST_DEFAULTS = Object.freeze({
  bloom: Object.freeze({strength: 0.6, threshold: 1, radius: 0.5}),
  vignette: Object.freeze({amount: 0}),
  grade: Object.freeze({lift: [0, 0, 0] as RGB, gain: [1, 1, 1] as RGB, saturation: 1}),
});

/** Inclusive bounds of every number (a data error outside them, naming the field). */
export const POST_LIMITS = Object.freeze({
  strength: [0, 3],
  threshold: [0, 16],
  radius: [0, 1],
  amount: [0, 1],
  lift: [-0.5, 0.5],
  gain: [0, 4],
  saturation: [0, 2],
} as const);

/** Bloom chain depth (mips at half resolution and below) and the post draws each tier issues. */
export const BLOOM_MIPS = 5;
export const POST_DRAWS: Readonly<Record<PostMode, number>> = {off: 0, basic: 1, full: 2 * BLOOM_MIPS};

const KEYS = {
  post: ['bloom', 'vignette', 'grade'],
  bloom: ['strength', 'threshold', 'radius'],
  vignette: ['amount'],
  grade: ['lift', 'gain', 'saturation'],
} as const;

const fail = (where: string, field: string, why: string): never => {
  throw Error(`${where}.${field} ${why}`);
};
const record = (v: unknown, where: string, keys: readonly string[]): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error(`${where} must be an object`);
  for (const k of Object.keys(v)) if (!keys.includes(k)) fail(where, k, `is unknown (expected ${keys.join(', ')})`);
  return v as Record<string, unknown>;
};
const num = (o: Record<string, unknown>, where: string, field: keyof typeof POST_LIMITS, fallback: number) => {
  const v = o[field];
  if (v === undefined) return fallback;
  const [min, max] = POST_LIMITS[field];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    fail(where, field, `must be a number from ${min} to ${max}`);
  return v as number;
};
const rgb = (o: Record<string, unknown>, where: string, field: 'lift' | 'gain', fallback: RGB): RGB => {
  const v = o[field];
  if (v === undefined) return fallback;
  const [min, max] = POST_LIMITS[field];
  if (!Array.isArray(v) || v.length !== 3 || !v.every(x => typeof x === 'number' && Number.isFinite(x)))
    fail(where, field, 'must be three numbers [r, g, b]');
  const out = v as number[];
  if (out.some(x => x < min || x > max)) fail(where, field, `channels must be from ${min} to ${max}`);
  return [out[0]!, out[1]!, out[2]!];
};

/** Validate `settings` and fill in the defaults. Throws, naming the field, on anything out of contract. */
export function resolvePost(settings: PostSettings, where = 'view.post'): PostResolved {
  const o = record(settings, where, KEYS.post);
  let bloom: PostResolved['bloom'] = null;
  if (o.bloom !== false) {
    const b = o.bloom === undefined ? {} : record(o.bloom, `${where}.bloom`, KEYS.bloom);
    const d = POST_DEFAULTS.bloom;
    bloom = Object.freeze({
      strength: num(b, `${where}.bloom`, 'strength', d.strength),
      threshold: num(b, `${where}.bloom`, 'threshold', d.threshold),
      radius: num(b, `${where}.bloom`, 'radius', d.radius),
    });
  }
  const v = o.vignette === undefined ? {} : record(o.vignette, `${where}.vignette`, KEYS.vignette);
  const g = o.grade === undefined ? {} : record(o.grade, `${where}.grade`, KEYS.grade);
  return Object.freeze({
    bloom,
    vignette: Object.freeze({amount: num(v, `${where}.vignette`, 'amount', POST_DEFAULTS.vignette.amount)}),
    grade: Object.freeze({
      lift: rgb(g, `${where}.grade`, 'lift', POST_DEFAULTS.grade.lift),
      gain: rgb(g, `${where}.grade`, 'gain', POST_DEFAULTS.grade.gain),
      saturation: num(g, `${where}.grade`, 'saturation', POST_DEFAULTS.grade.saturation),
    }),
  });
}

/** A validated copy of `settings` for a scene definition (throws on a data error). */
export function validatePost(settings: PostSettings, where = 'view.post'): PostSettings {
  resolvePost(settings, where);
  return structuredClone(settings);
}

/** The tier's plan: null at `off` (or with no settings), `basic` without the glow, `full` with it when asked for. */
export function postPlan(settings: PostResolved | null, mode: PostMode): PostPlan | null {
  if (!settings || mode === 'off') return null;
  return Object.freeze({...settings, mode, bloom: mode === 'full' ? settings.bloom : null});
}

/** Post draws a plan issues per rendered frame (the `postDraws` budget row). */
export const postDrawsOf = (plan: PostPlan | null): number =>
  !plan ? 0 : plan.bloom ? POST_DRAWS.full : POST_DRAWS.basic;

/** Bloom mip sizes for a drawing buffer of `width` x `height`: half resolution first, halving, at least 1. */
export function bloomSizes(width: number, height: number): [number, number][] {
  const out: [number, number][] = [];
  let w = Math.max(1, Math.ceil(width / 2)),
    h = Math.max(1, Math.ceil(height / 2));
  for (let i = 0; i < BLOOM_MIPS; i++) {
    out.push([w, h]);
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return out;
}

/**
 * GPU bytes post targets hold at `width` x `height` (the `postTargetMiB` report): the half-float scene colour (8 B/px)
 * and its depth (4 B/px), multisampled storage when `samples` > 0 (the resolved colour is kept too), and the bloom
 * mips when there is bloom.
 */
export function postTargetBytes(bloom: boolean, width: number, height: number, samples: number): number {
  const px = width * height;
  let bytes = px * 8 + (samples > 0 ? px * samples * (8 + 4) : px * 4);
  if (bloom) for (const [w, h] of bloomSizes(width, height)) bytes += w * h * 8;
  return bytes;
}

/** A stable key for the change check: equal keys draw the same picture. */
export const postKey = (plan: PostPlan | null): string => (plan ? JSON.stringify(plan) : 'off');
