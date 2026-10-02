/** Renderer contracts only; safe for shell diagnostics without loading GPU implementation. */
import type * as T from 'three';
import type { StageSurfaceRequest } from './pool-stage';
import type { ShadowTechnique } from './shadow-technique';

declare module '../../core/probe' { interface EngineProbes { 'render.pool': PoolStats } }

export type SurfaceRole = 'world' | 'stage' | 'utility';

/** What a scene sets on its renderer. Everything left out is three's default for a new renderer. */
export interface RenderProfile {
  toneMapping: T.ToneMapping;
  toneMappingExposure: number;
  outputColorSpace: T.ColorSpace;
  shadowMap: { enabled: boolean; type: T.ShadowMapType };
  clearColor: T.ColorRepresentation;
  clearAlpha: number;
  localClippingEnabled: boolean;
}

export interface SurfaceRequest {
  /** `world` here; a `stage` lease takes a `StageSurfaceRequest` (pool-stage.ts); `utility` is `snapshot` (pool-snapshot.ts). */
  role: 'world';
  /** The element the canvas is moved into. */
  host: HTMLElement;
  /** Where in `host`: appended (default) or prepended. */
  insert?: 'append' | 'prepend';
  /** Owner's lifetime: when given, the lease is released with it. */
  ctx?: { own<D extends { dispose(): void }>(d: D): D };
  /** The ceiling for the quality pixel ratio (applied live until release). */
  maxPixelRatio?: number;
  profile?: Partial<RenderProfile>;
  /** The shadow technique at `ultra`: `reference` (default) gives the scene's sun cascades; a staged area keeps
   *  its authored map (ADR 0061). */
  shadows?: ShadowTechnique;
}

export interface RenderSurface {
  readonly renderer: T.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly role: SurfaceRole;
  /** True for the pooled world context; false for an overflow lease (a second world while one is leased). */
  readonly pooled: boolean;
  /** The context was lost while this lease held it. */
  onLost(fn: () => void): () => void;
  onRestored(fn: () => void): () => void;
  /** Ends the lease (idempotent). The renderer must not be used afterwards. */
  /** World leases only: readiness of currently tracked programs after compile; no shadow/upload guarantee. */
  programsReady?(signal: AbortSignal): Promise<import('./program-readiness').ProgramReadiness>;
  release(): void;
  dispose(): void;
}

/** One release's leak audit: what the renderer still counted, and the GL objects the pool had to delete. */
export interface LeaseAudit { textures: number; geometries: number; programs: number; glObjects: number }

export interface PoolStats {
  /** WebGL contexts the pool created (world, overflow, stage and utility). */
  created: number;
  /** Live contexts the pool holds now (leased or parked, not lost). */
  contexts: number;
  leases: number;
  losses: number;
  recreations: number;
  recycles: number;
  overflows: number;
  /** The last release's audit. */
  lastRelease: LeaseAudit | null;
}

/** Tier caps for the recycle valve. */
export interface RecycleValve { textures: number; geometries: number; every: number }

export interface HeldFrame {
  /** Cross-fade the held image out over `ms` (0: at once), then remove it. */
  fade(ms: number): Promise<void>;
  /** Remove it at once. */
  drop(): void;
  readonly element: HTMLCanvasElement;
}

export interface RendererPool {
  /** Synchronous lease (the legacy openers build their scene in one call). Null when WebGL cannot start. */
  lease(req: SurfaceRequest | StageSurfaceRequest<Partial<RenderProfile>>): RenderSurface | null;
  /** `lease`: rejects when WebGL cannot start. */
  acquire(req: SurfaceRequest | StageSurfaceRequest<Partial<RenderProfile>>): Promise<RenderSurface>;
  /** A scene activated: retire a parked world context nobody leased (a staged scene brought its own renderer). */
  settle(): void;
  /** Copy the world canvas's next drawn frame into an overlay; null when there is nothing to hold. */
  hold(): Promise<HeldFrame | null>;
  readonly state: 'ok' | 'lost';
  stats(): PoolStats;
  /** Plug the `utility` role in (pool-snapshot.ts). `worldChanged` runs before the world context changes hands
   *  (a lease, a release, a retire), so the role drops anything bound to it. */
  attachUtility(u: { worldChanged(): void }): UtilityAccess;
}

/** What the `utility` role (pool-snapshot.ts) may use: the pool's renderer factory, its stats (the role counts
 *  its own context there) and the world context, leased or parked (`renderer` is the lease's while `leased`). */
export interface UtilityAccess {
  make(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext): PoolRenderer;
  stats: PoolStats;
  world(): { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext; leased: boolean; lost: boolean; renderer?: PoolRenderer | null } | null;
}

type GL = WebGL2RenderingContext;
/** The renderer the pool needs (three's WebGLRenderer; a fake in tests). */
export type PoolRenderer = Pick<T.WebGLRenderer, 'domElement' | 'getContext' | 'dispose' | 'forceContextLoss' | 'resetState' | 'info'> & Partial<T.WebGLRenderer>;
export interface RendererPoolOptions {
  /** World renderers: test/dev defaults to full Three diagnostics; production validates links without success logs. */
  programDiagnostics?: 'full' | 'failure-only';
  /** Make a renderer: on a new canvas (`context` undefined) or on the pooled canvas and context. */
  createRenderer?(canvas?: HTMLCanvasElement, context?: GL): PoolRenderer;
  pixelRatio?(renderer: PoolRenderer, max: number | undefined): void;
  /** Install the shadow scheduler on a leased renderer (every shadow light the pool's renderers draw). */
  shadows?(renderer: PoolRenderer, technique: ShadowTechnique): void;
  valve?: RecycleValve;
  doc?: Document;
  /** Run `fn` in the next frame, after every scene has rendered; returns a cancel. */
  nextFrame?(fn: () => void): () => void;
  holdTimeoutMs?: number;
  /** The `stage` role's shared context: a detached canvas and its WebGL2 context. */
  createStageContext?(antialias: boolean): { canvas: HTMLCanvasElement; gl: GL };
}

