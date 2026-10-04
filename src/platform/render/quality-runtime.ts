/**
 * platform/render/quality-runtime.ts: the running game's quality service (ADR 0029;
 * STD-SET-4, STD-SET-11, STD-SET-12).
 *
 * - `createAppQuality` builds the one service from the device-scope section `graphics.settings` (owned by core/save,
 *   passed in as a `GraphicsChoiceStore`), the page's `?quality=<preset>` pin and, on a first run only, the device
 *   probe when no authored startup preset was supplied (or, with `deviceClassSafety`, to limit a constrained mobile GPU's
 *   start below an undeclared authored default). A pinned run (a gate, a bench, a verifier) reads nothing, writes nothing and never detects or governs.
 * - `appQuality()` is that service. Before `installAppQuality` it is a default, unsaved `reference` service, which
 *   is what tests and tools without a page see.
 * - `livePixelRatio(renderer, max)` replaces `renderer.setPixelRatio(renderPixelRatio(max))`: it sets
 *   `quality.pixelRatio(max)` now and again whenever a live knob changes, until the renderer is disposed.
 *
 * This file and quality.ts are the only scenes that read `devicePixelRatio` or probe the GPU (STD-SET-4).
 */
import {
  createQuality,
  isQualityPreset,
  readDeviceSignals,
  type DeviceSignals,
  type GraphicsChoiceStore,
  type KnobRegistry,
  type Quality,
  type QualityPreset,
  type ShadowMapRequest,
} from './quality';

const browserDpr = (): number => (typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);

let installed: Quality | null = null;
let bindingEpoch = 0;
/** Make `q` the app's quality service (main.ts, before any renderer exists). */
export function installAppQuality(q: Quality): Quality {
  bindingEpoch++;
  installed = q;
  return q;
}
/** Owned binding: retiring an older app cannot clear a newer installation. */
export function bindAppQuality(q: Quality): () => void {
  installAppQuality(q);
  const epoch = bindingEpoch;
  return () => {
    if (bindingEpoch === epoch) {
      bindingEpoch++;
      installed = null;
    }
  };
}
/** The app's quality service. */
export function appQuality(): Quality {
  return (installed ??= createQuality({devicePixelRatio: browserDpr}));
}

/** `?quality=<preset>` pins the preset for a gate, bench or verifier run. Anything else is no pin. */
export function pinnedPreset(search: string): QualityPreset | undefined {
  const v = new URLSearchParams(search).get('quality');
  return v !== null && isQualityPreset(v) ? v : undefined;
}

/**
 * The one device probe (STD-SET-4): touch, memory, cores, data saver, and the GPU string and texture limit from a
 * throwaway WebGL2 context that is released at once. Only called on a first run, when nothing is saved.
 */
export function probeDevice(doc: Document = document): DeviceSignals | undefined {
  // CI never uses detection: an automated browser (the verifiers, the gate, the bench) gets the unsaved
  // Reference default and writes nothing, so every run starts from the same state.
  if (typeof navigator === 'object' && navigator.webdriver === true) return undefined;
  try {
    const canvas = doc.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    const signals = readDeviceSignals({
      matchMedia: typeof matchMedia === 'function' ? q => matchMedia(q) : undefined,
      navigator: typeof navigator === 'object' ? (navigator as never) : undefined,
      gl,
    });
    (gl?.getExtension('WEBGL_lose_context') as {loseContext(): void} | null)?.loseContext();
    return signals;
  } catch {
    return undefined;
  }
}

/**
 * Is the GPU probe worth running for the device-class rule under an authored default? A browser that reports 8 GB and
 * more than 4 cores skips it (most desktop Chromium), so a desktop start costs no throwaway WebGL context. The cost of
 * the gate: an entry-level mobile GPU that reports 8 GB and more than 4 cores keeps its authored start. Unreported
 * memory (Safari, Firefox) still probes.
 */
export function mayBeLimited(nav: {deviceMemory?: number; hardwareConcurrency?: number} | undefined): boolean {
  if (!nav) return false;
  return !(typeof nav.deviceMemory === 'number' && nav.deviceMemory >= 8 && (nav.hardwareConcurrency ?? 0) > 4);
}

export interface AppQualityOptions {
  /** Author-selected startup quality; pins and saved choices take precedence. */
  initialPreset?: QualityPreset;
  /** `initialPreset` is a default the creator did not declare: a constrained mobile GPU starts lower (quality.ts,
   *  `deviceClassCap`). Off when the brief declares `quality.tier`. */
  deviceClassSafety?: boolean;
  /** The saved choice for this device (section `graphics.settings`). */
  store: GraphicsChoiceStore;
  /** `location.search`: `?quality=<preset>` pins. */
  search?: string;
  /** Recorded with a first-run detection. */
  build?: string;
  signals?: () => DeviceSignals | undefined;
  /** The knob registry: the core knobs plus every module's rows (main.ts adds world knobs). */
  registry?: KnobRegistry;
}
/** The running game's service: pin > saved choice > authored startup > optional detection/default. */
export function createAppQuality(o: AppQualityOptions): Quality {
  return createQuality({
    registry: o.registry,
    initialPreset: o.initialPreset,
    store: o.store,
    pinned: pinnedPreset(o.search ?? ''),
    build: o.build,
    deviceClassSafety: o.deviceClassSafety,
    signals:
      o.signals ??
      (() =>
        o.initialPreset !== undefined && !mayBeLimited(typeof navigator === 'object' ? (navigator as never) : undefined)
          ? undefined
          : probeDevice()),
    devicePixelRatio: browserDpr,
  });
}

/** What `livePixelRatio` needs from a renderer (three's WebGLRenderer, or a pooled renderer). */
export interface PixelRatioTarget {
  setPixelRatio(ratio: number): void;
  getPixelRatio?(): number;
  dispose(): void;
}

let resizePending = false;
/**
 * A backbuffer resized by a pixel-ratio change is blank until its owner draws again. Scenes that draw on demand
 * draw on `resize`, so one synthetic resize follows a live change (a real resize runs the same handlers).
 */
function redrawAfterResize(): void {
  if (resizePending || typeof window !== 'object' || typeof Event !== 'function') return;
  resizePending = true;
  queueMicrotask(() => {
    resizePending = false;
    window.dispatchEvent(new Event('resize'));
  });
}

/**
 * Sets `quality.pixelRatio(max)` on `renderer`, and again whenever the ratio changes (the Graphics screen), until
 * `renderer.dispose()`. `max` stays the activity's ceiling.
 */
export function livePixelRatio<R extends PixelRatioTarget>(
  renderer: R,
  max?: number,
  quality: Quality = appQuality(),
): R {
  let current = quality.pixelRatio(max);
  renderer.setPixelRatio(current);
  // A preset change reports its slowest knob's `applies`, so every change is checked; the ratio knobs are all live.
  const off = quality.subscribe(() => {
    const next = quality.pixelRatio(max);
    if ((renderer.getPixelRatio?.() ?? current) === next) return;
    renderer.setPixelRatio((current = next));
    redrawAfterResize();
  });
  const dispose = renderer.dispose;
  renderer.dispose = function (this: R, ...args: unknown[]) {
    off();
    return (dispose as (...a: unknown[]) => void).apply(this, args);
  } as R['dispose'];
  return renderer;
}

/** What `liveShadowMap` needs from a shadow-casting light (three's DirectionalLight or SpotLight). */
export interface ShadowLightTarget {
  castShadow: boolean;
  shadow: {mapSize: {x: number; set(x: number, y: number): unknown}; map: {dispose(): void} | null};
}
export interface LiveShadowMap {
  /** A new requested size (a scene that sizes its map by its view, e.g. on resize); the knob still caps it. */
  request(size: ShadowMapRequest): void;
  dispose(): void;
}
/**
 * Sizes `light`'s shadow map as `quality.shadowMapSize(requested)` now and again whenever the Graphics screen changes
 * `shadows.quality`. At Reference (`ultra`, 4096) every request ≤ 4096 is kept as asked, so the map is
 * exactly what the scene asked for before. `off` (a player choice only) stops the light casting; the light casts again
 * when shadows come back. A resized map is released and redrawn on the next frame (the shadow scheduler sees the new
 * size). Stops following the knob on `dispose()` or when `owner` (the scene's renderer) is disposed.
 */
export function liveShadowMap(
  light: ShadowLightTarget,
  requested: ShadowMapRequest,
  owner?: {dispose(): void},
  quality: Quality = appQuality(),
): LiveShadowMap {
  let want = requested,
    offByKnob = false,
    live = true;
  const apply = (): boolean => {
    const size = quality.shadowMapSize(want);
    if (size === 0) {
      if (light.castShadow) {
        light.castShadow = false;
        offByKnob = true;
        return true;
      }
      return false;
    }
    let changed = false;
    if (offByKnob) {
      light.castShadow = true;
      offByKnob = false;
      changed = true;
    }
    if (light.shadow.mapSize.x !== size) {
      light.shadow.mapSize.set(size, size);
      light.shadow.map?.dispose();
      light.shadow.map = null;
      changed = true;
    }
    return changed;
  };
  apply();
  const off = quality.subscribe(() => {
    if (apply()) redrawAfterResize();
  });
  const handle: LiveShadowMap = {
    request(size) {
      want = size;
      if (live) apply();
    },
    dispose() {
      if (!live) return;
      live = false;
      off();
    },
  };
  if (owner) {
    const dispose = owner.dispose;
    owner.dispose = function (this: unknown, ...args: unknown[]) {
      handle.dispose();
      return (dispose as (...a: unknown[]) => unknown).apply(this, args);
    } as typeof owner.dispose;
  }
  return handle;
}
