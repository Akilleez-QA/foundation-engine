import * as T from 'three';
import type {leaseCube, CubeSpec} from '../platform/assets/cube';
import type {TextureLibrary} from '../platform/assets/textures';
import {isAbortError, type Lease} from '../platform/assets/lease-cache';
import {isInteriorReflection, interiorReflectionKey, type InteriorReflection} from './interior-reflection';
import type {leaseInteriorReflection} from './scene-interior-reflection';

export type CubeLoader = () => Promise<{leaseCube: typeof leaseCube}>;
const loadCube: CubeLoader = () => import('../platform/assets/cube');
export type InteriorLoader = () => Promise<{leaseInteriorReflection: typeof leaseInteriorReflection}>;
const loadInterior: InteriorLoader = () => import('./scene-interior-reflection');

const keyOf = (spec: CubeSpec | InteriorReflection): string => {
  if (isInteriorReflection(spec))
    try {
      return interiorReflectionKey(spec);
    } catch {
      /* Malformed: key by its JSON; building it reports the error. */
    }
  return JSON.stringify(spec);
};

/** Background and reflection are independent bindings with generation-safe replacement. An interior reflection
 *  (`{ kind: 'interior' }`) is built once per distinct interior data and disposed when replaced, cleared or on exit. */
export function bindSceneCubes(
  scene: T.Scene,
  library: TextureLibrary,
  signal: AbortSignal,
  invalidate: () => void,
  report: (error: unknown) => void,
  load: CubeLoader = loadCube,
  interior: InteriorLoader = loadInterior,
) {
  type Slot = {
    key: string;
    life?: AbortController | undefined;
    lease?: Lease<T.Texture> | undefined;
    pending?: Promise<void>;
  };
  const slots: {background: Slot; environment: Slot} = {background: {key: ''}, environment: {key: ''}};
  const original = {background: scene.background, environment: scene.environment};
  let closed = false;

  const safeReport = (error: unknown) => {
    try {
      report(error);
    } catch {
      /* Never create an unhandled rejection from a diagnostic. */
    }
  };
  const release = (lease: Lease<T.Texture> | undefined, errors?: unknown[]) => {
    try {
      lease?.release();
    } catch (error) {
      if (errors) errors.push(error);
      else safeReport(error);
    }
  };

  function replace(name: keyof typeof slots, slot: Slot, spec: CubeSpec | InteriorReflection): void {
    // Snapshot authored values before the optional module boundary; callers may mutate their row later.
    // Runtime callers can still supply malformed rows: retain the previous binding and report safely.
    // Loads the optional module, then allocates only if this request is still the live one.
    let acquire: (signal: AbortSignal, live: () => boolean) => Promise<Lease<T.Texture> | undefined>;
    try {
      if (isInteriorReflection(spec)) {
        const request = structuredClone(spec);
        // Built synchronously from data inside the lazy chunk: no decode, nothing in flight to cancel.
        acquire = async (_signal, live) => {
          const module = await interior();
          return live() ? module.leaseInteriorReflection(request) : undefined;
        };
      } else {
        const request: CubeSpec = {faces: [...spec.faces], screenPx: spec.screenPx};
        acquire = async (signal, live) => {
          const module = await load();
          return live() ? module.leaseCube(library, request, signal, 16 * 1024 * 1024, safeReport) : undefined;
        };
      }
    } catch (error) {
      safeReport(error);
      return;
    }
    const life = (slot.life = new AbortController());
    const live = () => !closed && !life.signal.aborted && slot.life === life;
    // One old plus one replacement, each capped at 16 MiB; two independent bindings cap at 64 MiB.
    slot.pending = Promise.resolve()
      .then(async () => {
        if (!live()) return;
        return acquire(life.signal, live);
      })
      .then(
        lease => {
          if (!lease) return;
          if (!live()) {
            release(lease);
            return;
          }
          const old = slot.lease;
          slot.lease = lease;
          slot.life = undefined;
          scene[name] = lease.value;
          release(old);
          invalidate();
        },
        error => {
          if (!closed && !life.signal.aborted && !isAbortError(error)) safeReport(error);
        },
      )
      .catch(safeReport);
  }

  function syncSlot(name: keyof typeof slots, spec: CubeSpec | InteriorReflection | undefined): boolean {
    const slot = slots[name],
      key = spec ? keyOf(spec) : '';
    let changed = false;
    if (key !== slot.key) {
      slot.key = key;
      slot.life?.abort();
      slot.life = undefined;
      if (!spec) {
        if (scene[name] === slot.lease?.value) scene[name] = original[name] as T.Texture | null;
        const old = slot.lease;
        slot.lease = undefined;
        release(old);
        changed = true;
      } else replace(name, slot, spec);
    }
    if (slot.lease && scene[name] !== slot.lease.value) {
      scene[name] = slot.lease.value;
      changed = true;
    }
    return changed;
  }

  const owner = {
    sync(background?: CubeSpec, reflection?: CubeSpec | InteriorReflection, fallback?: number) {
      if (closed) return false;
      const clearing = !!slots.background.key && !background;
      const a = syncSlot('background', background),
        b = syncSlot('environment', reflection);
      if (clearing && fallback !== undefined) scene.background = new T.Color(fallback);
      return a || b;
    },
    dispose() {
      if (closed) return;
      closed = true;
      signal.removeEventListener('abort', abort);
      const errors: unknown[] = [];
      for (const name of ['background', 'environment'] as const) {
        const slot = slots[name];
        slot.life?.abort();
        if (scene[name] === slot.lease?.value) scene[name] = original[name] as T.Texture | null;
        const old = slot.lease;
        slot.lease = undefined;
        release(old, errors);
      }
      if (errors.length) safeReport(new AggregateError(errors, 'scene cube cleanup failed'));
    },
  };
  const abort = () => owner.dispose();
  signal.addEventListener('abort', abort, {once: true});
  if (signal.aborted) owner.dispose();
  return owner;
}
