/**
 * kits/physics/loader: the one place the physics library enters a build. `import()` here is dynamic, so a bundler
 * emits the library (about 3 MB of WebAssembly inlined as base64 in the compat build) as a separate chunk that is
 * fetched only when a scene asks for it. Nothing in this kit imports the library statically; the rest of the kit uses
 * type-only imports, which are erased.
 *
 * Owner: the loader. It holds at most one in-flight or completed load per page (per loader), initialises the
 * WebAssembly module exactly once, and keeps the module for the life of the page (a module cannot be unloaded).
 * Cancellation: an aborted signal settles that caller's promise as `aborted` at once and removes its listener; a load
 * already started keeps running and is cached for the next caller (nothing per-caller was allocated). A failed load is
 * forgotten, so a later call (a scene restart) tries again.
 */
import type * as RapierNamespace from '@dimforge/rapier3d-deterministic-compat';

/** The library namespace the kit drives (type only). */
export type Rapier = typeof RapierNamespace;

export type PhysicsLoad =
  | Readonly<{status: 'ready'; rapier: Rapier}>
  | Readonly<{status: 'aborted'}>
  | Readonly<{status: 'failed'; error: unknown}>;

export interface PhysicsLoader {
  /** Load and initialise once; later calls share the result. Never rejects. */
  load(signal?: AbortSignal): Promise<PhysicsLoad>;
  /** The initialised library, or null before a load completes. Synchronous: systems use it. */
  ready(): Rapier | null;
  /** Load attempts started (a retry after a failure counts again). */
  readonly attempts: number;
}

/** A loader over any source of the library namespace: the default dynamic import, or a test or replacement build. */
export function createPhysicsLoader(source: () => Promise<Rapier>): PhysicsLoader {
  if (typeof source !== 'function') throw new TypeError('physics: loader source must be a function');
  let pending: Promise<Rapier> | null = null,
    loaded: Rapier | null = null,
    attempts = 0;
  const start = (): Promise<Rapier> => {
    if (pending) return pending;
    attempts++;
    const p = (async () => {
      const rapier = await source();
      if (!rapier || typeof rapier.init !== 'function' || typeof rapier.World !== 'function')
        throw new TypeError('physics: the loaded module is not the physics library');
      await rapier.init();
      loaded = rapier;
      return rapier;
    })();
    pending = p;
    p.catch(() => {
      if (pending === p) pending = null; // recovery: the next call retries
    });
    return p;
  };
  return {
    get attempts() {
      return attempts;
    },
    ready: () => loaded,
    load(signal) {
      if (loaded) return Promise.resolve(Object.freeze({status: 'ready', rapier: loaded}));
      if (signal?.aborted) return Promise.resolve(Object.freeze({status: 'aborted'}));
      return new Promise<PhysicsLoad>(resolve => {
        let settled = false;
        const finish = (result: PhysicsLoad) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          resolve(Object.freeze(result));
        };
        const onAbort = () => finish({status: 'aborted'});
        signal?.addEventListener('abort', onAbort, {once: true});
        start().then(
          rapier => finish({status: 'ready', rapier}),
          error => finish({status: 'failed', error}),
        );
      });
    },
  };
}

/** The default loader: the deterministic compat build, imported on first use. */
export const physicsLoader: PhysicsLoader = createPhysicsLoader(
  () => import('@dimforge/rapier3d-deterministic-compat') as Promise<Rapier>,
);

/** Load the physics library once per page. Resolves `ready`, `aborted` or `failed`; never rejects. */
export function loadPhysics(signal?: AbortSignal): Promise<PhysicsLoad> {
  return physicsLoader.load(signal);
}
