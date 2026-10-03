import type {PoolStats, RendererPool} from './renderer-pool-types';
import {availableRenderBackend, DEFAULT_RENDER_BACKEND, type RenderBackendId} from './render-backend';

// One app pool reference. Only render consumers supply its implementation factory;
// shell handover and diagnostics must not initialize rendering as a side effect.
let installed: RendererPool | undefined;
export function getAppRendererPool(create: () => RendererPool): RendererPool {
  return (installed ??= create());
}

/** Retire unused surfaces after handover, if any rendering has been initialized. */
export function settleAppRendererPool(): void {
  installed?.settle();
}
/** Undefined before the first render consumer requests the pool. */
export function rendererPoolStats(): PoolStats | undefined {
  return installed?.stats();
}

let backend: RenderBackendId = DEFAULT_RENDER_BACKEND;
/**
 * The brief's render backend (ADR 0078), selected when the game compiles, before any render consumer creates the
 * pool. Throws `RenderBackendUnavailableError` for a backend this build cannot provide (today: 'webgpu'), and when
 * the pool already exists with another backend.
 */
export function selectAppRenderBackend(id: RenderBackendId): void {
  availableRenderBackend(id);
  if (installed && id !== backend) throw Error('render backend changed after the renderer pool started');
  backend = id;
}
/** The backend the app's pool is (or will be) created with. */
export function appRenderBackend(): RenderBackendId {
  return backend;
}
