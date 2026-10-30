/**
 * platform/render/render-backend.ts: the render backend seam (ADR 0078; STD-REN-1, STD-REN-3, STD-REN-5).
 *
 * The renderer pool owns renderers and contexts by role; a backend is what it creates them with. The creator selects
 * the backend in the brief (`defineBuild({ render: { backend } })`); the default is `webgl2`. Only the WebGL2 backend
 * exists (`backends/webgl/backend.ts`): selecting `webgpu` is refused with `RenderBackendUnavailableError` until the
 * WebGPU backend lands, and nothing ever falls back silently.
 *
 * This module holds contracts and the selection rule only. It imports no renderer, so the brief, the shell and
 * diagnostics may read it without loading GPU code.
 */
import type {ProgramReadiness} from './program-readiness';
import type {ProgramValidation} from './program-validation';

/** Every backend a brief may name. */
export type RenderBackendId = 'webgl2' | 'webgpu';
export const DEFAULT_RENDER_BACKEND: RenderBackendId = 'webgl2';

/** What a backend can do; the pool and the verification tools branch on these, never on the backend id. */
export interface RenderBackendCapabilities {
  /** Several view canvases drawn from one context (the `stage` role's shared context). */
  readonly multiCanvas: boolean;
  /** Synchronous pixel read-back (`readRenderTargetPixels`; the `utility` role's snapshots). */
  readonly syncReadback: boolean;
  /** Programs can be inspected after compile (link status, parallel compile completion). */
  readonly programIntrospection: boolean;
  /** Multi-draw is available, so `BatchedMesh` draws stay batched. */
  readonly multiDraw: boolean;
}

/** The objects a context created and has not deleted (the release's leak sweep), and program link validation. */
export interface ContextObjects {
  live: Map<object, string>;
  validation: ProgramValidation;
}

/** A context on a detached canvas the pool owns (the `stage` and `utility` roles). */
export interface DetachedContext<C> {
  canvas: HTMLCanvasElement;
  gl: C;
}

/** Readiness of one lease's preceding GPU work after an actual draw (never a presentation guarantee). */
export interface FrameReadiness {
  wait(signal: AbortSignal): Promise<'ready' | 'retired'>;
  retire(): void;
}

/**
 * One render backend: renderer construction, contexts, loss, object tracking and readiness. `C` is the backend's
 * context and `R` its renderer. Everything here runs at lease, release, preparation or loss, never per frame.
 */
export interface RenderBackend<C, R> {
  readonly id: RenderBackendId;
  readonly capabilities: RenderBackendCapabilities;
  /** The canvas events that report a lost and a restored context. */
  readonly lostEvent: string;
  readonly restoredEvent: string;
  /** A renderer on a new canvas (`canvas` undefined), or on `canvas` with an existing `context`. */
  createRenderer(canvas?: HTMLCanvasElement, context?: C): R;
  /** The context a renderer draws with. */
  contextOf(renderer: R): C;
  /** The `stage` role's shared context on a canvas of `doc`, with that stage's antialias. Throws when the backend
   *  cannot start. (The `utility` role, pool-snapshot.ts, reads pixels back synchronously, so it makes its own WebGL2
   *  context: it is available only where `capabilities.syncReadback` holds.) */
  createStageContext(antialias: boolean, doc: Document): DetachedContext<C>;
  /** Start recording what `context` creates and deletes from now on (its startup objects are never swept). */
  track(context: C): ContextObjects;
  /** Delete one swept object through the entry point its tracker recorded. */
  deleteObject(context: C, entry: string, object: object): void;
  isLost(context: C): boolean;
  /** Give the context up for good (a retired or recycled context). */
  lose(context: C): void;
  /** Readiness of the programs `objects` tracks, after compile. */
  programsReady(context: C, objects: ContextObjects, signal: AbortSignal): Promise<ProgramReadiness>;
  /** Frame readiness for one lease; `retired` says when the lease ended. */
  frameReadiness(context: C, retired: () => boolean): FrameReadiness;
}

/** A scene's output transform, as backend-neutral data (author/scene-output.ts validates it; each backend maps it onto
 *  its renderer: backends/webgl/output.ts). `'none'` with exposure 1 is the picture without tone mapping. */
export type ToneMappingName = 'none' | 'aces' | 'agx' | 'neutral';
export interface RenderOutput {
  toneMapping: ToneMappingName;
  exposure: number;
}

/** Why this build cannot provide `backend`, or null when it can. */
export function renderBackendProblem(backend: unknown): string | null {
  if (backend === 'webgl2') return null;
  if (backend === 'webgpu')
    return "render.backend 'webgpu' is not available yet: the WebGPU backend has not landed (ADR 0078). Select 'webgl2' (the default) or leave render.backend out.";
  return `render.backend ${JSON.stringify(backend)} is unknown: expected 'webgl2' or 'webgpu'.`;
}

/** The creator selected a backend this build cannot provide. Never caught into a silent fallback. */
export class RenderBackendUnavailableError extends Error {
  override readonly name = 'RenderBackendUnavailableError';
  constructor(readonly backend: unknown) {
    super(renderBackendProblem(backend) ?? '');
  }
}

/** `backend` when this build provides it; throws `RenderBackendUnavailableError` otherwise. */
export function availableRenderBackend(backend: RenderBackendId): 'webgl2' {
  if (backend !== 'webgl2') throw new RenderBackendUnavailableError(backend);
  return backend;
}
