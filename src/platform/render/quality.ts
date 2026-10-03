/**
 * platform/render/quality.ts: the quality service core (ADR 0017 as superseded by ADR 0029;
 * ADR 0034 for the one WebGL2 path; STD-SET-5 to STD-SET-13, STD-PRI-4, STD-PRI-5).
 *
 * `quality-runtime.ts` builds the app's service from the `graphics.settings` section; every renderer's pixel ratio goes
 * through `livePixelRatio(renderer, max)` (= `quality.pixelRatio(max)`, re-applied on a change); shadow maps go through
 * `liveShadowMap(light, request, renderer)`; and the Graphics screen (platform/ui/graphics-screen.ts) is generated from
 * the knob registry below. Kits and features register their own knobs (STD-SET-6).
 *
 * Rules:
 *  - 'reference' (the reference machine, docs/STANDARD.md §1.2) is the design bar; lower presets are ports that
 *    scale COST, never CONTENT.
 *  - Detection picks only the FIRST preset, on a first run, and records why. The player's choice always wins.
 *  - The governor is optional and OFF by default. It moves only the runtime resolution scale, between 0.6 and the
 *    player's scale, never writes settings, and never runs in a gate or bench (a pinned preset).
 *  - Device decisions are knob reads: nothing else reads `devicePixelRatio`, the pointer type or the screen width to
 *    choose a cost. 'lite' art variants are role detail (background props), chosen by on-screen size through
 *    `quality.textureVariant(variants, onScreenPx)`, not tier knobs. Contact never changes with a preset (STD-REN-22).
 *
 * Pure apart from `readDeviceSignals`, which reads an injected environment. No three import.
 */
import {
  APPLIES_ORDER,
  KNOB_GROUPS,
  PRESETS,
  isQualityPreset,
  type AnyKnobDef,
  type DetectedPreset,
  type Detection,
  type DeviceSignals,
  type FrameSample,
  type FrameStats,
  type GraphicsChoiceStore,
  type GraphicsKnobs,
  type GraphicsSettings,
  type KnobApplies,
  type KnobDef,
  type KnobId,
  type KnobOverrides,
  type PresetSource,
  type QualityChange,
  type QualityPreset,
  type ResolvedQuality,
  type ShadowMapRequest,
  type ShadowMapSize,
} from './quality-knobs';

export * from './quality-knobs';
import type {SaveSection} from '../../core/save/section';

// ------------------------------------------------------------------------------------------------ the saved section
/** The settings a device starts from before it has a saved or detected choice. */
export const defaultGraphicsSettings = (): GraphicsSettings => ({preset: 'reference', overrides: {}, governor: false});
/** The device's graphics choice (device scope, never exported; STD-SET-13). `null` until detection or the player chose:
 *  the quality service detects only then (STD-SET-11). */
export const graphicsSettingsSection: SaveSection<GraphicsSettings | null> = {
  id: 'graphics.settings',
  scope: 'device',
  version: 1,
  export: false,
  initial: () => null,
  parse: raw => {
    if (raw === null) return null;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid graphics settings');
    return normalizeSettings(raw as GraphicsSettings);
  },
};

// ------------------------------------------------------------------------------------------------ core knobs
const SHADOW_SIZES = {off: 0, low: 1024, medium: 1024, high: 2048, ultra: 4096} as const;
export const shadowMapFor = (q: GraphicsKnobs['shadows.quality']): ShadowMapSize => SHADOW_SIZES[q];

/** The core knobs. Reference values are the reference machine's full quality. */
export const coreKnobs: readonly AnyKnobDef[] = [
  {
    id: 'resolution.scale',
    wired: {by: 'livePixelRatio'},
    group: 'resolution',
    label: 'graphics.resolution.scale',
    control: {kind: 'range', min: 0.5, max: 1, step: 0.05},
    presets: {reference: 1, high: 1, medium: 1, low: 0.85},
    applies: 'live',
    owner: 'platform.render',
  },
  {
    id: 'resolution.max-pixel-ratio',
    wired: {by: 'livePixelRatio'},
    group: 'resolution',
    label: 'graphics.resolution.max-pixel-ratio',
    control: {kind: 'choice', options: [1, 1.5, 2, 3]},
    presets: {reference: 2, high: 2, medium: 1.5, low: 1},
    applies: 'live',
    owner: 'platform.render',
  },
  {
    id: 'resolution.antialias',
    group: 'resolution',
    label: 'graphics.resolution.antialias',
    control: {kind: 'toggle'},
    presets: {reference: true, high: true, medium: true, low: false},
    applies: 'next-context',
    owner: 'platform.render',
  },
  {
    id: 'shadows.quality',
    wired: {by: 'liveShadowMap'},
    group: 'shadows',
    label: 'graphics.shadows.quality',
    control: {kind: 'choice', options: ['off', 'low', 'medium', 'high', 'ultra']},
    // Medium preserves requested high shadow maps; preset tuning never depends on input capability.
    presets: {reference: 'ultra', high: 'high', medium: 'high', low: 'low'},
    applies: 'live',
    owner: 'platform.render',
    floor: {value: 'low', reason: 'shadows off is a player choice only (STD-SET-10)', playerMayCross: true},
    cost: v => ({off: 0, low: 0.15, medium: 0.25, high: 0.5, ultra: 1})[v],
  },
  {
    id: 'textures.max-size',
    group: 'textures',
    label: 'graphics.textures.max-size',
    control: {kind: 'choice', options: [1024, 2048, 4096, 8192]},
    presets: {reference: 8192, high: 4096, medium: 2048, low: 1024},
    applies: 'reenter-scene',
    owner: 'platform.assets',
  },
  {
    id: 'textures.anisotropy',
    group: 'textures',
    label: 'graphics.textures.anisotropy',
    control: {kind: 'choice', options: [1, 4, 8, 16]},
    presets: {reference: 16, high: 8, medium: 4, low: 1},
    applies: 'reenter-scene',
    owner: 'platform.render',
  },
  {
    id: 'textures.canvas-budget-mib',
    group: 'textures',
    label: 'graphics.textures.canvas-budget',
    control: {kind: 'choice', options: [16, 32, 96, 256]},
    presets: {reference: 256, high: 96, medium: 32, low: 16},
    applies: 'live',
    owner: 'platform.render',
  },
  {
    id: 'post.mode',
    group: 'post',
    label: 'graphics.post.mode',
    control: {kind: 'choice', options: ['off', 'basic', 'full']},
    presets: {reference: 'full', high: 'full', medium: 'basic', low: 'off'},
    applies: 'live',
    owner: 'platform.render.post',
  },
  // Particle density (FX-01): a lighter preset draws a deterministic subset of each non-essential emitter's particles
  // and allocates a pool that much smaller. Essential emitters are never thinned (their content floor); unwired until
  // a template reads it, like anisotropy (read by the scene runtime when a visit starts).
  {
    id: 'effects.particles',
    group: 'effects',
    label: 'graphics.effects.particles',
    control: {kind: 'choice', options: [0.25, 0.5, 0.75, 1]},
    presets: {reference: 1, high: 1, medium: 0.75, low: 0.5},
    applies: 'reenter-scene',
    owner: 'platform.render',
  },
  {
    id: 'frame-rate.cap',
    group: 'frame-rate',
    label: 'graphics.frame-rate.cap',
    control: {
      kind: 'choice',
      options: [0, 30, 60, 120],
      optionLabels: ['graphics.frame-rate.display', '30', '60', '120'],
    },
    presets: {reference: 0, high: 0, medium: 60, low: 30},
    applies: 'live',
    owner: 'core.activity',
  },
  {
    id: 'interface.backdrop-blur',
    group: 'interface',
    label: 'graphics.interface.backdrop-blur',
    control: {kind: 'toggle'},
    presets: {reference: true, high: true, medium: true, low: false},
    applies: 'live',
    owner: 'platform.ui',
  },
  {
    id: 'interface.live-contexts',
    group: 'interface',
    label: 'graphics.interface.live-contexts',
    control: {kind: 'choice', options: [1, 2, 3, 4]},
    presets: {reference: 4, high: 3, medium: 2, low: 1},
    applies: 'next-context',
    owner: 'platform.render',
  },
];

// ------------------------------------------------------------------------------------------------ knob rules
/** The value-erased view of any knob row that the rules below read. Every `KnobDef<K>` is assignable to it. */
export interface LooseDef {
  id: KnobId;
  group: string;
  owner: string;
  applies: KnobApplies;
  wired?: {by: string};
  control:
    | {kind: 'choice'; options: readonly unknown[]}
    | {kind: 'range'; min: number; max: number; step: number}
    | {kind: 'toggle'};
  presets: Readonly<Record<QualityPreset, unknown>>;
  floor?: {value: unknown; reason: string; playerMayCross?: boolean};
}

/** Is `v` a legal value for the knob's control? */
export function legal(d: LooseDef, v: unknown): boolean {
  const c = d.control;
  return c.kind === 'toggle'
    ? typeof v === 'boolean'
    : c.kind === 'range'
      ? typeof v === 'number' && Number.isFinite(v) && v >= c.min && v <= c.max
      : (c.options as readonly unknown[]).includes(v);
}
/** Is a legal `v` below the knob's content floor? Choice options are ordered cheapest first. */
export function belowFloor(d: LooseDef, v: unknown): boolean {
  const f = d.floor;
  if (!f) return false;
  const c = d.control;
  if (c.kind === 'range') return typeof v === 'number' && v < (f.value as number);
  if (c.kind === 'toggle') return v !== f.value;
  const opts = c.options as readonly unknown[];
  return opts.indexOf(v) < opts.indexOf(f.value);
}
/** Registry validation (boot phase 5, STD-SET-6, STD-SET-10): unique ids, every preset legal and above its floor. */
export function knobProblems(defs: readonly LooseDef[]): string[] {
  const p: string[] = [],
    seen = new Set<string>();
  for (const d of defs) {
    if (seen.has(d.id)) p.push(`duplicate knob ${d.id}`);
    seen.add(d.id);
    if (!(KNOB_GROUPS as readonly string[]).includes(d.group)) p.push(`${d.id}: unknown group ${d.group}`);
    if (!d.owner) p.push(`${d.id}: no owner`);
    if (d.wired !== undefined && !d.wired.by) p.push(`${d.id}: wired names no consumer`);
    if (d.floor && !legal(d, d.floor.value)) p.push(`${d.id}: floor is not a legal value`);
    for (const preset of PRESETS) {
      if (!(preset in d.presets)) {
        p.push(`${d.id}: no value for preset ${preset}`);
        continue;
      }
      const v = d.presets[preset];
      if (!legal(d, v)) p.push(`${d.id}: preset ${preset} value is not a legal option`);
      else if (belowFloor(d, v)) p.push(`${d.id}: preset ${preset} crosses the content floor (${d.floor!.reason})`);
    }
  }
  return p;
}

/** The knob registry (`Registries.graphicsKnobs`). Effects add rows at register time; the Graphics screen reads `list()`. */
export interface KnobRegistry {
  add<K extends KnobId>(def: KnobDef<K>): void;
  get<K extends KnobId>(id: K): KnobDef<K> | undefined;
  list(): readonly AnyKnobDef[]; // in screen group order, then registration order
  readonly version: number; // bumps on every add
}
export function createKnobRegistry(initial: readonly AnyKnobDef[] = coreKnobs): KnobRegistry {
  const rows = new Map<KnobId, AnyKnobDef>();
  let version = 0,
    sorted: AnyKnobDef[] | null = null;
  const insert = (d: AnyKnobDef) => {
    if (rows.has(d.id)) throw new Error(`graphics knob ${d.id} is already registered by ${rows.get(d.id)!.owner}`);
    const problems = knobProblems([d]);
    if (problems.length) throw new Error(`graphics knob ${d.id} rejected: ${problems.join('; ')}`);
    rows.set(d.id, d);
    version++;
    sorted = null;
  };
  const reg: KnobRegistry = {
    add(def) {
      insert(def as AnyKnobDef);
    },
    get: id => rows.get(id) as never,
    list() {
      if (!sorted) {
        const order = [...rows.values()];
        sorted = order
          .map((d, i) => ({d, i}))
          .sort((a, b) => KNOB_GROUPS.indexOf(a.d.group) - KNOB_GROUPS.indexOf(b.d.group) || a.i - b.i)
          .map(x => x.d);
      }
      return sorted;
    },
    get version() {
      return version;
    },
  };
  for (const d of initial) insert(d);
  return reg;
}

/** Resolve every knob: the player's override if still legal (and not below a floor it may not cross), else the preset's value. */
export function resolveKnobs(
  defs: readonly LooseDef[],
  s: GraphicsSettings,
  source: PresetSource = 'player',
): ResolvedQuality {
  const values = new Map<KnobId, unknown>();
  for (const d of defs) {
    const o = (s.overrides as Record<string, unknown>)[d.id];
    const ok = o !== undefined && legal(d, o) && (!belowFloor(d, o) || d.floor?.playerMayCross === true);
    values.set(d.id, ok ? o : d.presets[s.preset]);
  }
  return {
    preset: s.preset,
    source,
    values,
    get<K extends KnobId>(id: K): GraphicsKnobs[K] {
      if (!values.has(id)) throw new Error(`graphics knob ${id} is not registered`);
      return values.get(id) as GraphicsKnobs[K];
    },
  };
}

/** Accept a stored value defensively: a bad preset falls back to reference, a bad override map to none. */
export function normalizeSettings(raw: GraphicsSettings): GraphicsSettings {
  const overrides =
    raw.overrides && typeof raw.overrides === 'object' && !Array.isArray(raw.overrides) ? {...raw.overrides} : {};
  const out: GraphicsSettings = {
    preset: isQualityPreset(raw.preset) ? raw.preset : 'reference',
    overrides,
    governor: raw.governor === true,
  };
  if (raw.detected && isQualityPreset(raw.detected.preset)) {
    out.detected = {
      preset: raw.detected.preset,
      reasons: [...(raw.detected.reasons ?? [])],
      build: String(raw.detected.build ?? ''),
    };
    if (isQualityPreset(raw.detected.suggested)) out.detected.suggested = raw.detected.suggested;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ detection
const REFERENCE_GPU =
  /(RTX [2-9]0[6-9]0( ?Ti| SUPER)?|RTX A[4-6]000|Radeon RX [67][7-9]\d0|Radeon RX 9\d{3}|Apple M\d+ (Pro|Max|Ultra))/i;
const LOW_GPU =
  /(Mali-(4|T[678]|G[57]\d)\b|Adreno \(TM\) [345]\d\d|PowerVR|Intel.*HD Graphics [2-6]\d{2,3}\b|GC\d{3,4}|VideoCore)/i;
const SOFTWARE_GL = /(SwiftShader|llvmpipe|softpipe|Software Rasterizer|Microsoft Basic Render)/i;

/**
 * Picks the FIRST preset only. Callers never apply it over a saved choice.
 *
 * Input capability is not graphics capability (ADR 0070). A reference-class GPU with sufficient cores starts
 * at Reference; other hardware starts at High. Weak resource signals only suggest a lighter preset, never
 * silently cross a quality floor. Saved choices, including legacy detected Medium, remain unchanged.
 */
export function detectPreset(s: DeviceSignals): Detection {
  const softwareGl = !!s.gpu && SOFTWARE_GL.test(s.gpu);
  const weak: string[] = [],
    lighter: string[] = [];
  if (softwareGl) weak.push(`software GL (${s.gpu})`);
  else if (s.gpu && LOW_GPU.test(s.gpu)) weak.push(`entry-level GPU ${s.gpu}`);
  if (s.maxTextureSize < 4096) weak.push(`texture limit ${s.maxTextureSize}`);
  if (s.deviceMemory !== undefined && s.deviceMemory <= 2) weak.push(`${s.deviceMemory} GB memory`);
  else if (s.deviceMemory !== undefined && s.deviceMemory <= 4) lighter.push(`${s.deviceMemory} GB memory`);
  if (s.saveData) lighter.push('data saver');
  const suggestion = (preset: QualityPreset): Pick<Detection, 'suggested' | 'suggestedReasons'> => {
    const rank = (p: QualityPreset) => PRESETS.indexOf(p);
    const want: QualityPreset | undefined = weak.length ? 'low' : lighter.length ? 'medium' : undefined;
    return want && rank(want) > rank(preset) ? {suggested: want, suggestedReasons: weak.length ? weak : lighter} : {};
  };
  if (!weak.length && s.gpu && REFERENCE_GPU.test(s.gpu) && (s.cores ?? 0) >= 8) {
    return {
      preset: 'reference',
      reasons: [`reference-class GPU ${s.gpu}`, `${s.cores} cores`, ...lighter],
      softwareGl,
      ...suggestion('reference'),
    };
  }
  return {
    preset: 'high',
    reasons: [s.gpu ? `GPU ${s.gpu}` : 'GPU not reported', ...weak, ...lighter],
    softwareGl,
    ...suggestion('high'),
  };
}

/** The minimal environment the probe reads; the browser's `window` and a WebGL2 context satisfy it. */
export interface DeviceProbeEnv {
  matchMedia?: ((q: string) => {matches: boolean}) | undefined;
  navigator?: {deviceMemory?: number; hardwareConcurrency?: number; connection?: {saveData?: boolean}} | undefined;
  gl?: {MAX_TEXTURE_SIZE: number; getParameter(p: number): unknown; getExtension(name: string): unknown} | null;
}
/** The one device probe (STD-SET-4): touch, deviceMemory, cores, data saver, GPU string and texture limit. */
export function readDeviceSignals(env: DeviceProbeEnv): DeviceSignals {
  const nav = env.navigator ?? {};
  let gpu: string | undefined,
    maxTextureSize = 4096;
  if (env.gl) {
    const info = env.gl.getExtension('WEBGL_debug_renderer_info') as {UNMASKED_RENDERER_WEBGL: number} | null;
    const g = info ? env.gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : undefined;
    if (typeof g === 'string' && g) gpu = g;
    const m = env.gl.getParameter(env.gl.MAX_TEXTURE_SIZE);
    if (typeof m === 'number' && m > 0) maxTextureSize = m;
  }
  return {
    coarsePointer: env.matchMedia?.('(any-pointer: coarse)').matches ?? false,
    deviceMemory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined,
    cores: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : undefined,
    saveData: nav.connection?.saveData === true ? true : undefined,
    gpu,
    maxTextureSize,
  };
}

// ------------------------------------------------------------------------------------------------ pure numbers
/** min(dpr, activity max, knob max) × scale. No rounding, so reference at scale 1 equals today's renderPixelRatio on desktop. */
export function pixelRatio(dpr: number, knobs: {maxPixelRatio: number; scale: number}, activityMax = Infinity): number {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.min(d, activityMax, knobs.maxPixelRatio) * knobs.scale;
}
/** Largest variant ≤ the max size, and the smallest that gives ≤ 2 texels per on-screen pixel. */
export function textureVariant(maxSize: number, variants: readonly number[], onScreenPx = Infinity): number {
  if (!variants.length) throw new Error('textureVariant needs at least one variant');
  const sorted = [...variants].sort((a, b) => a - b),
    allowed = sorted.filter(v => v <= maxSize),
    want = Math.min(maxSize, onScreenPx * 2);
  return allowed.find(v => v >= want) ?? allowed[allowed.length - 1] ?? sorted[0]!; // sorted is non-empty (checked above)
}

// ------------------------------------------------------------------------------------------------ the governor
export interface GovernorOptions {
  frames: number;
  warmupMs: number;
  slowFactor: number;
  fastFactor: number;
  slowToAct: number;
  fastToAct: number;
  down: number;
  up: number;
}
export const GOVERNOR_FLOOR = 0.6;
const GOVERNOR_DEFAULTS: GovernorOptions = {
  frames: 60,
  warmupMs: 2000,
  slowFactor: 1.2,
  fastFactor: 0.75,
  slowToAct: 2,
  fastToAct: 5,
  down: 0.85,
  up: 1.1,
};

/**
 * Revives AdaptiveResolution (adaptive-resolution.ts:3, 0 users), which only ever lowered the ratio. Moves only a
 * runtime scale between min(floor, ceiling) and the ceiling (the PLAYER's 'resolution.scale'). Ignores idle,
 * hidden and warm-up frames. Acts on the p75 of each window, with hysteresis (2 slow windows down, 5 fast up).
 */
export class ResolutionGovernor {
  private window: number[] = [];
  private slow = 0;
  private fast = 0;
  scale: number;
  private readonly o: GovernorOptions;
  constructor(
    private ceiling: number,
    public budgetMs: number,
    private floor = GOVERNOR_FLOOR,
    options: Partial<GovernorOptions> = {},
  ) {
    this.o = {...GOVERNOR_DEFAULTS, ...options};
    this.scale = ceiling;
  }
  setCeiling(c: number): void {
    this.ceiling = c;
    this.scale = Math.min(this.scale, c);
  }
  reset(): void {
    this.window = [];
    this.slow = 0;
    this.fast = 0;
    this.scale = this.ceiling;
  }
  /** Returns the new scale when it changes, else null. */
  sample(s: FrameSample): number | null {
    if (!s.rendered || s.hidden || s.sinceEnterMs < this.o.warmupMs || !(s.intervalMs > 0 && s.intervalMs < 250))
      return null;
    this.window.push(s.intervalMs);
    if (this.window.length < this.o.frames) return null;
    const sorted = this.window.sort((a, b) => a - b),
      p75 = sorted[Math.floor(sorted.length * 0.75)]!; // non-empty window; floor(0.75 n) < n
    this.window = [];
    if (p75 > this.budgetMs * this.o.slowFactor) {
      this.fast = 0;
      if (++this.slow < this.o.slowToAct) return null;
      this.slow = 0;
      const n = Math.max(Math.min(this.floor, this.ceiling), +(this.scale * this.o.down).toFixed(3));
      if (n === this.scale) return null;
      return (this.scale = n);
    }
    this.slow = 0;
    if (p75 < this.budgetMs * this.o.fastFactor && this.scale < this.ceiling) {
      if (++this.fast < this.o.fastToAct) return null;
      this.fast = 0;
      return (this.scale = Math.min(this.ceiling, +(this.scale * this.o.up).toFixed(3)));
    }
    this.fast = 0;
    return null;
  }
}

// ------------------------------------------------------------------------------------------------ the service
export interface Quality {
  readonly preset: QualityPreset;
  readonly source: PresetSource;
  readonly settings: Readonly<GraphicsSettings>;
  /** The typed knob reader. */
  knob<K extends KnobId>(id: K): GraphicsKnobs[K];
  /** Every registered knob resolved; `deriveProfile` builds QualityProfile from this. */
  resolved(): ResolvedQuality;
  /** Replaces renderPixelRatio(max): min(dpr, max-pixel-ratio, activityMax) × (governor scale or 'resolution.scale'). */
  pixelRatio(activityMax?: number): number;
  /** Requested map size clamped by 'shadows.quality'; 0 = shadows off. */
  shadowMapSize(requested: ShadowMapRequest): ShadowMapSize;
  textureVariant(variants: readonly number[], onScreenPx?: number): number;
  // ---- the Graphics screen (a later step)
  setPreset(p: QualityPreset): void; // clears overrides
  setKnob<K extends KnobId>(id: K, v: GraphicsKnobs[K]): void;
  setGovernor(on: boolean): void;
  /** True only when the player (or a guardian) enabled it and the preset is not pinned. */
  readonly governing: boolean;
  knobs(): readonly AnyKnobDef[];
  stats(): FrameStats;
  /** Fed by the one frame loop. */
  frame(sample: FrameSample & {draws: number; triangles: number}): void;
  subscribe(fn: (change: QualityChange) => void, signal?: AbortSignal): () => void;
}

export interface QualityOptions {
  /** The knob registry; defaults to a registry holding the core knobs. */
  registry?: KnobRegistry | undefined;
  /** The player's saved choice (section 'graphics.settings'), owned by core/save. */
  store?: GraphicsChoiceStore;
  /** Authored startup preset, used only without a pin or saved choice. Remains unsaved until the player acts. */
  initialPreset?: QualityPreset | undefined;
  /** First-run probe; called at most once, only without a saved choice or authored startup preset. */
  signals?: () => DeviceSignals | undefined;
  devicePixelRatio?: () => number;
  /** A gate or bench `?quality=<preset>`: no read, no write, no detection, no governor. */
  pinned?: QualityPreset | undefined;
  /** Recorded with a detection. */
  build?: string | undefined;
  /** Governor budget when 'frame-rate.cap' is 0 (display rate). */
  displayFrameMs?: number;
}

const STATS_FRAMES = 120;

export function createQuality(options: QualityOptions = {}): Quality {
  if (options.initialPreset !== undefined && !isQualityPreset(options.initialPreset))
    throw new Error('unknown authored quality preset');
  const registry = options.registry ?? createKnobRegistry();
  const dpr = options.devicePixelRatio ?? (() => 1);
  const pinned = options.pinned;
  let settings: GraphicsSettings, source: PresetSource;

  if (pinned) {
    settings = {preset: pinned, overrides: {}, governor: false};
    source = 'pinned';
  } else {
    const saved = options.store?.read();
    if (saved) {
      settings = normalizeSettings(saved);
      const untouched = settings.detected?.preset === settings.preset && Object.keys(settings.overrides).length === 0;
      source = untouched ? 'detected' : 'player';
    } else if (options.initialPreset !== undefined) {
      settings = {...defaultGraphicsSettings(), preset: options.initialPreset};
      source = 'default';
    } else {
      const signals = options.signals?.();
      if (signals) {
        const d = detectPreset(signals);
        const detected: DetectedPreset = {
          preset: d.preset,
          reasons: d.reasons,
          build: options.build ?? '',
          ...(d.suggested ? {suggested: d.suggested} : {}),
        };
        settings = {preset: d.preset, overrides: {}, governor: false, detected};
        source = 'detected';
        options.store?.write(clone(settings));
      } else {
        settings = defaultGraphicsSettings();
        source = 'default';
      }
    }
  }

  let cache: ResolvedQuality | null = null,
    cacheVersion = -1;
  const resolved = (): ResolvedQuality => {
    if (!cache || cacheVersion !== registry.version) {
      cache = resolveKnobs(registry.list(), settings, source);
      cacheVersion = registry.version;
    }
    return cache;
  };
  const invalidate = () => {
    cache = null;
  };
  const knob = <K extends KnobId>(id: K): GraphicsKnobs[K] => resolved().get(id);
  const budgetMs = () => {
    const cap = knob('frame-rate.cap');
    return cap > 0 ? 1000 / cap : (options.displayFrameMs ?? 1000 / 60);
  };

  const governor = new ResolutionGovernor(knob('resolution.scale'), budgetMs());
  const governing = () => settings.governor && !pinned;
  const effectiveScale = () => (governing() ? governor.scale : knob('resolution.scale'));

  const listeners = new Set<(c: QualityChange) => void>();
  const emit = (c: QualityChange) => {
    for (const fn of [...listeners]) fn(c);
  };
  const persist = () => {
    if (!pinned) options.store?.write(clone(settings));
  };

  const intervals: number[] = [];
  let lastDraws = 0,
    lastTriangles = 0;

  const q: Quality = {
    get preset() {
      return settings.preset;
    },
    get source() {
      return source;
    },
    get settings() {
      return settings;
    },
    get governing() {
      return governing();
    },
    knob,
    resolved,
    pixelRatio: activityMax =>
      pixelRatio(dpr(), {maxPixelRatio: knob('resolution.max-pixel-ratio'), scale: effectiveScale()}, activityMax),
    shadowMapSize: requested => Math.min(requested, shadowMapFor(knob('shadows.quality'))) as ShadowMapSize,
    textureVariant: (variants, onScreenPx) => textureVariant(knob('textures.max-size'), variants, onScreenPx),

    setPreset(p) {
      if (!isQualityPreset(p)) throw new Error(`unknown quality preset ${String(p)}`);
      const before = resolved();
      settings = {...settings, preset: p, overrides: {}};
      source = pinned ? 'pinned' : 'player';
      invalidate();
      persist();
      const after = resolved();
      let applies: KnobApplies = 'live';
      for (const d of registry.list())
        if (
          before.values.get(d.id) !== after.values.get(d.id) &&
          APPLIES_ORDER.indexOf(d.applies) > APPLIES_ORDER.indexOf(applies)
        )
          applies = d.applies;
      governor.setCeiling(knob('resolution.scale'));
      emit({preset: p, applies});
    },
    setKnob(id, v) {
      const d: LooseDef | undefined = registry.get(id);
      if (!d) throw new Error(`graphics knob ${id} is not registered`);
      if (!legal(d, v)) throw new Error(`illegal value for graphics knob ${id}`);
      if (belowFloor(d, v) && !d.floor?.playerMayCross)
        throw new Error(`graphics knob ${id} cannot go below its content floor (${d.floor!.reason})`);
      const overrides: KnobOverrides = {...settings.overrides};
      if (v === d.presets[settings.preset]) delete overrides[id];
      else (overrides as Record<string, unknown>)[id] = v;
      settings = {...settings, overrides};
      source = pinned ? 'pinned' : 'player';
      invalidate();
      persist();
      if (id === 'resolution.scale') governor.setCeiling(knob('resolution.scale'));
      emit({knob: id, applies: d.applies});
    },
    setGovernor(on) {
      if (settings.governor === on) return;
      const beforeScale = effectiveScale();
      settings = {...settings, governor: on};
      persist();
      governor.setCeiling(knob('resolution.scale'));
      governor.reset();
      if (effectiveScale() !== beforeScale) emit({knob: 'resolution.scale', applies: 'live', runtime: true});
    },
    knobs: () => registry.list(),
    stats() {
      if (!intervals.length) return {p50Ms: 0, p95Ms: 0, fps: 0, draws: lastDraws, triangles: lastTriangles};
      const s = [...intervals].sort((a, b) => a - b),
        at = (f: number) => s[Math.min(s.length - 1, Math.floor(s.length * f))]!; // s is non-empty; index clamped below s.length
      const mean = s.reduce((a, b) => a + b, 0) / s.length;
      return {
        p50Ms: at(0.5),
        p95Ms: at(0.95),
        fps: mean > 0 ? 1000 / mean : 0,
        draws: lastDraws,
        triangles: lastTriangles,
      };
    },
    frame(sample) {
      if (sample.rendered && !sample.hidden && sample.intervalMs > 0) {
        intervals.push(sample.intervalMs);
        if (intervals.length > STATS_FRAMES) intervals.shift();
        lastDraws = sample.draws;
        lastTriangles = sample.triangles;
      }
      if (!governing()) return;
      governor.budgetMs = budgetMs();
      if (governor.sample(sample) !== null) emit({knob: 'resolution.scale', applies: 'live', runtime: true});
    },
    subscribe(fn, signal) {
      if (signal?.aborted) return () => {};
      listeners.add(fn);
      const off = () => {
        listeners.delete(fn);
        signal?.removeEventListener('abort', off);
      };
      signal?.addEventListener('abort', off, {once: true});
      return off;
    },
  };
  return q;
}

function clone(s: GraphicsSettings): GraphicsSettings {
  return {
    preset: s.preset,
    overrides: {...s.overrides},
    governor: s.governor,
    ...(s.detected ? {detected: {...s.detected, reasons: [...s.detected.reasons]}} : {}),
  };
}
