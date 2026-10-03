/**
 * core/activity/ports.ts. The small interfaces `core/activity` needs from above and beside it (STD-LAY-7, ADR 0031).
 *
 * L0 never imports L1: the layer manager (`platform/ui/layers.ts`), the renderer pool, the quality system and the
 * game clock implement these ports and hand them in at install. Everything here is types only.
 *
 * `LayerRequest`, `LayerHandle`, `SurfaceRequest` and `SurfaceLease` are deliberately open interfaces: the platform
 * module that implements a port adds its own fields by declaration merging (kernel augmentations), e.g.
 *
 *   declare module '../../core/activity/ports' { interface LayerRequest { element: HTMLElement; modal?: LayerModality } }
 */

/** What the layer stack does to an activity run (ADR 0032). 'hidden' means its own layer is not shown. */
export type Coverage = 'top' | 'scrim' | 'opaque' | 'hidden';

/** What a ticker does under a scrim: stop (default), keep running at full rate, or throttle to `hz`. */
export type WhenCovered = 'pause' | 'run' | { readonly hz: number };

export type FrameMode = 'continuous' | 'on-demand';

/** `core/tiers.ts` owns it; re-exported for the activity host's callers. */
import type { QualityPreset } from '../tiers';
export type { QualityPreset };

export type LayerKind = 'scene' | 'panel' | 'sheet' | 'modal' | 'toast';
export type LayerCover = 'none' | 'scrim' | 'opaque';
export type LayerCloseReason = 'exit' | 'escape' | 'replaced' | 'program' | 'owner-left';

/** What an activity asks of the layer manager. The platform augments it with its element, modality, focus, etc. */
export interface LayerRequest {
  id: string;
  kind: LayerKind;
  /** Activity run that owns the layer; the loop asks coverage by this key. Filled in by the activity host. */
  owner?: string | undefined;
  cover?: LayerCover;
  /** The Graphics screen: the covered scene keeps ticking at full rate beneath it (ADR 0032). */
  preview?: boolean;
}
export interface LayerHandle {
  readonly id: string;
  readonly signal: AbortSignal;
  readonly closed: boolean;
  close(reason?: LayerCloseReason): void;
}

/** Implemented by `platform/ui/layers.ts`. */
export interface LayerPort {
  push(request: LayerRequest): LayerHandle;
  /** Coverage of an owner's activity, from the layer stack. An owner with no layer is 'top'. */
  coverage(owner: string): Coverage;
  /** True while a `preview: true` layer sits above this owner: it ticks at full rate whatever its coverage. */
  previewing?(owner: string): boolean;
  /** Close every layer the owner pushed (the run is leaving). */
  closeOwned(owner: string): void;
  /** Fires whenever the stack changes; the loop re-evaluates at once instead of polling. Returns an unsubscribe. */
  onChange(listener: () => void): () => void;
}

/** What an activity asks of the renderer pool. The platform augments it with its host element etc. */
export interface SurfaceRequest {
  role: string;
  owner?: string;
}
export interface SurfaceLease {
  release(): void;
}
/** Implemented by `platform/render/renderer-pool.ts`. */
export interface SurfacePort {
  acquire(request: SurfaceRequest): SurfaceLease;
}

/** One document `visibilitychange` source (the shell installs it). */
export interface VisibilityPort {
  hidden(): boolean;
  onChange(listener: (hidden: boolean) => void): () => void;
}

/**
 * The structural subset of the contract's `ClockDriver` (ADR 0033) that the loop calls. The loop is its only
 * holder (STD-RUN-5): it advances the clock once per frame and tells it when the tab comes back.
 */
export interface ClockDriverPort {
  advance(realDt: number): { readonly to: number };
  resumeFromAway(reason: 'load' | 'visible'): void;
}

/** `FrameSample` without the renderer's figures; the platform adapter adds draws and triangles. */
export interface LoopFrameSample {
  intervalMs: number;
  /** False for a frame in which nothing rendered (render on demand skipped it). */
  rendered: boolean;
  hidden: boolean;
  /** Milliseconds since the loop last woke from idle or from a hidden tab. */
  sinceEnterMs: number;
}
/** Implemented by the quality system. */
export interface QualityPort {
  preset(): QualityPreset;
  frame(sample: LoopFrameSample): void;
}

/**
 * One frame record for an optional, observational sampler (STD-SYS-18). The loop reuses ONE object for every call:
 * a sampler copies the fields it needs and never retains the record.
 */
export interface FrameRecord extends LoopFrameSample {
  /** The frame timestamp in ms on the scheduler's timebase; for a hidden record, the loop's `now()`. */
  timeMs: number;
  /** Elapsed ms around this frame's tickers, from the loop's `now()` (0 for a hidden record). Main-thread wall time
   *  including the clock call itself: not CPU time, GPU time or worker time. */
  workMs: number;
  /** True for a frame a test driver stepped while frames were held (`stepFrame`): its timestamp and interval are
   *  script-chosen, not display timing. Samplers count it and never treat it as measured time. */
  stepped: boolean;
}
/** At most one per loop (`FrameLoop.attachSampler`). When none is attached the loop reads no extra clock. */
export interface FrameSamplerPort {
  frame(record: Readonly<FrameRecord>): void;
}

/** The injected frame source: `requestAnimationFrame` in the app, a fake in tests. */
export interface FrameScheduler {
  request(callback: (timeMs: number) => void): number;
  cancel(id: number): void;
}
