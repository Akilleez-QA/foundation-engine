import type {PoolStats, RendererPool} from './renderer-pool-types';

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
