/**
 * platform/render/quality-knobs.ts: the knob types of the quality service (ADR 0029, STD-SET-5 to STD-SET-13).
 * Types only, plus the preset list. Pure: no DOM, no three.
 *
 * `QualityPreset` lives in `core/tiers.ts`; it is re-exported here for the quality service's callers.
 */
import { QUALITY_PRESETS, type QualityPreset } from '../../core/tiers';

/** 'reference' is the reference machine (docs/STANDARD.md §1.2): the design bar and the only gated tier. */
export type { QualityPreset } from '../../core/tiers';
export { isQualityPreset } from '../../core/tiers';
/** Display order on the Graphics screen, reference first. The others are ports. */
export const PRESETS: readonly QualityPreset[] = QUALITY_PRESETS;

/** Graphics screen groups, in display order. */
export type KnobGroup = 'resolution' | 'shadows' | 'atmosphere' | 'clouds' | 'terrain' | 'post' | 'effects' | 'sky' | 'reflections'
  | 'textures' | 'frame-rate' | 'interface';
export const KNOB_GROUPS: readonly KnobGroup[] = ['resolution', 'shadows', 'atmosphere', 'clouds', 'terrain', 'post', 'effects', 'sky', 'reflections', 'textures', 'frame-rate', 'interface'];

/**
 * Typed knob values. Every module that registers knobs augments this interface (like `EngineEvents`):
 * `declare module '<path>/platform/render/quality-knobs' { interface GraphicsKnobs { 'clouds.mode': ... } }`.
 */
export interface GraphicsKnobs {
  'resolution.scale': number;                          // multiplies the pixel-ratio cap; 0.5–1
  'resolution.max-pixel-ratio': 1 | 1.5 | 2 | 3;
  'resolution.antialias': boolean;                     // applies on the next renderer context
  'shadows.quality': 'off' | 'low' | 'medium' | 'high' | 'ultra';
  'textures.max-size': 1024 | 2048 | 4096 | 8192;
  'textures.anisotropy': 1 | 4 | 8 | 16;
  'textures.canvas-budget-mib': 16 | 32 | 96 | 256;    // PaintedSurfaces
  'post.mode': 'off' | 'basic' | 'full';
  'effects.particles': 0.25 | 0.5 | 0.75 | 1;           // share of non-essential particles drawn (FX-01)
  'frame-rate.cap': 0 | 30 | 60 | 120;                 // 0 = display rate
  'interface.backdrop-blur': boolean;
  'interface.live-contexts': 1 | 2 | 3 | 4;            // renderer pool ceiling
}
export type KnobId = keyof GraphicsKnobs;
export type KnobValue<K extends KnobId = KnobId> = GraphicsKnobs[K];

/** How a change takes effect: next frame, when the scene is re-entered (automatic on close), or on the next renderer context. */
export type KnobApplies = 'live' | 'reenter-scene' | 'next-context';
export const APPLIES_ORDER: readonly KnobApplies[] = ['live', 'reenter-scene', 'next-context'];

export type KnobControl<K extends KnobId = KnobId> =
  | { kind: 'choice'; options: readonly GraphicsKnobs[K][]; optionLabels?: readonly string[] }   // options ordered cheapest first
  | { kind: 'range'; min: number; max: number; step: number }
  | { kind: 'toggle' };

/**
 * A content floor (STD-SET-10): no preset value may go below it. A floor that only a player may cross (shadows `off`)
 * sets `playerMayCross`; otherwise a player override below it is ignored at resolution. For a choice it names the
 * lowest allowed option (options are ordered cheapest first); for a range, the minimum; for a toggle, the required value.
 */
export interface KnobFloor<K extends KnobId = KnobId> { value: GraphicsKnobs[K]; reason: string; playerMayCross?: boolean }

/** A registry row (`Registries.graphicsKnobs`). A new effect appears on the Graphics screen by registering these. */
export interface KnobDef<K extends KnobId = KnobId> {
  id: K;
  group: KnobGroup;
  label: string;                                       // string key
  help?: string;                                       // string key
  control: KnobControl<K>;
  /** The value each preset uses. 'reference' is authored first, at full quality; the others are ports. */
  presets: Record<QualityPreset, GraphicsKnobs[K]>;
  applies: KnobApplies;
  /** Relative GPU cost of a value (0–1), measured by bench-perf on the reference machine, for the screen's cost bars. */
  cost?: ((v: GraphicsKnobs[K]) => number) | undefined;
  floor?: KnobFloor<K>;
  /** Owning module id, for provenance on the screen and in bug reports. */
  owner: string;
  /**
   * Set only when the game reads this knob today: `by` names the function the running scenes call (a registry test
   * finds its call sites). The Graphics screen shows only wired knobs, so no control changes nothing; an unwired
   * knob stays registered and resolved (the profile reads it) and appears once its owning step wires it.
   */
  wired?: { by: string };
}
/** Any registered knob, whatever its id (the registry's element type). */
export type AnyKnobDef = { [K in KnobId]: KnobDef<K> }[KnobId];

export type KnobOverrides = Partial<{ [K in KnobId]: GraphicsKnobs[K] }>;

/** Saved per device: section `graphics.settings` (scope device, version 1, not exported; STD-SET-13). */
export interface GraphicsSettings {
  preset: QualityPreset;
  overrides: KnobOverrides;                            // only what the player changed after picking a preset
  governor: boolean;                                   // optional, off by default
  detected?: DetectedPreset;                           // what detection picked on the first run, with its reasons
}
export interface DetectedPreset {
  preset: QualityPreset; reasons: string[]; build: string;
  /** A lighter preset detection suggests but never applies (the device looks weak); the screen offers it. */
  suggested?: QualityPreset;
}

/**
 * The player's choice, as stored. Injected: `core/save` owns the section and its storage. `read()` returns
 * undefined when nothing has ever been saved on this device (a first run); only then does detection run.
 */
export interface GraphicsChoiceStore {
  read(): GraphicsSettings | undefined;
  write(next: GraphicsSettings): void;
}

/** What detection reads. Gathered by `readDeviceSignals` (the only device probe) or supplied by a test. */
export interface DeviceSignals {
  coarsePointer: boolean;                              // retained probe metadata; never selects graphics quality
  deviceMemory?: number | undefined;                   // GB, navigator.deviceMemory (Chromium only)
  cores?: number | undefined;                          // navigator.hardwareConcurrency
  gpu?: string | undefined;                            // WEBGL_debug_renderer_info UNMASKED_RENDERER_WEBGL
  maxTextureSize: number;
  saveData?: boolean | undefined;
}
export interface Detection {
  /** Applied on a first run: always today's pixel ratio (Wave 1). */
  preset: QualityPreset; reasons: string[]; softwareGl: boolean;
  /** Suggested only, never applied: Medium or Low for a device that looks weak, with why. */
  suggested?: QualityPreset; suggestedReasons?: string[];
}

/** Where the current preset came from. 'pinned' is a gate or bench `?quality=` run: nothing is read, written or governed. */
export type PresetSource = 'player' | 'detected' | 'default' | 'pinned';

/** Every registered knob resolved: override when still legal and above its floor, else the preset's value. */
export interface ResolvedQuality {
  readonly preset: QualityPreset;
  readonly source: PresetSource;
  readonly values: ReadonlyMap<KnobId, unknown>;
  get<K extends KnobId>(id: K): GraphicsKnobs[K];
}

/** One frame from the one loop. Idle (not rendered) and hidden frames are ignored by the governor. */
export interface FrameSample { intervalMs: number; rendered: boolean; hidden: boolean; sinceEnterMs: number }
export interface FrameStats { p50Ms: number; p95Ms: number; fps: number; draws: number; triangles: number; gpuMs?: number }

/** `quality.changed`. `runtime` marks a governor move, which never touches settings. */
export interface QualityChange { knob?: KnobId; preset?: QualityPreset; applies: KnobApplies; runtime?: true }

export type ShadowMapRequest = 512 | 1024 | 2048 | 4096;
export type ShadowMapSize = 0 | ShadowMapRequest;
