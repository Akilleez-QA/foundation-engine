/**
 * kits/streaming/ports.ts: adapters from existing owners to the queue's poll-based work.
 *
 * - `promisePort` wraps any `(key, signal) => Promise<{value, bytes, release}>` (a lease cache acquisition, a model
 *   library lease, a worker-host job, a fetch). Settlement is observed on the next pump; a value that arrives after
 *   cancellation is released here, never published.
 * - `leasePort` adapts a lease acquisition (`{value, release}`) plus a byte measure (for example the cache's own
 *   `info(key).bytes`, which follows its residency accounting).
 * - `modelPort` streams through the scene's model owner: it spawns an invisible entity with a `Model` of the asset and
 *   reports ready when `modelState` reports the asset adopted. Release despawns that entity; the model owner's lease
 *   cache and residency policy decide what stays warm.
 */
import type {ComponentInit, Entity, World} from '../../core/ecs/world';
import type {StreamPoll, StreamPort, StreamWork} from './queue';

export interface StreamValue<T> {
  readonly value: T;
  readonly bytes: number;
  release(): void;
}

/** True for an abort-shaped rejection (`AbortError` by name). */
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

export interface PromisePortOptions {
  /** Whether a rejection may be retried. Default: every rejection except an abort. */
  retryable?(error: unknown): boolean;
}

export function promisePort<T>(
  start: (key: string, signal: AbortSignal) => Promise<StreamValue<T>>,
  options: PromisePortOptions = {},
): StreamPort<T> {
  if (typeof start !== 'function') throw new TypeError('streaming: promisePort needs a start function');
  const retryable = options.retryable ?? ((error: unknown) => !isAbort(error));
  return {
    start(key, signal): StreamWork<T> {
      let result: StreamPoll<T> = {status: 'pending'};
      let cancelled = false,
        settled = false;
      const own = new AbortController();
      const onAbort = () => own.abort();
      if (signal.aborted) own.abort();
      else signal.addEventListener('abort', onAbort, {once: true});
      const settle = (poll: StreamPoll<T>) => {
        settled = true;
        signal.removeEventListener('abort', onAbort);
        if (!cancelled) {
          result = poll;
          return;
        }
        // Settled after cancellation: report settlement first, then release what arrived (errors swallowed so a
        // throwing release can never keep the queue's slot).
        result = {status: 'failed', retry: false};
        if (poll.status === 'ready')
          try {
            poll.release();
          } catch {
            // The value is abandoned either way.
          }
      };
      const canRetry = (error: unknown) => {
        try {
          return retryable(error) === true;
        } catch {
          return false;
        }
      };
      let promise: Promise<StreamValue<T>>;
      try {
        promise = Promise.resolve(start(key, own.signal));
      } catch (error) {
        promise = Promise.reject(error);
      }
      promise.then(
        v => {
          if (!v || typeof v.release !== 'function') {
            settle({status: 'failed', error: new TypeError('streaming: start resolved without release'), retry: false});
            return;
          }
          let released = false;
          settle({
            status: 'ready',
            value: v.value,
            bytes: v.bytes,
            release() {
              if (released) return;
              released = true;
              v.release();
            },
          });
        },
        error => settle({status: 'failed', error, retry: canRetry(error)}),
      );
      return {
        poll: () => result,
        cancel() {
          if (cancelled) return;
          cancelled = true;
          own.abort();
          if (settled && result.status === 'ready') {
            const ready = result;
            result = {status: 'failed', retry: false};
            try {
              ready.release();
            } catch {
              // The value is abandoned either way.
            }
          }
        },
      };
    },
  };
}

/** A lease acquisition (`LeaseCache.acquire`, `AssetLeases.acquire`, `ModelLibrary.model`) with a byte measure. */
export function leasePort<T, L extends {readonly value: T; release(): void}>(
  acquire: (key: string, signal: AbortSignal) => Promise<L>,
  bytesOf: (lease: L, key: string) => number,
  options?: PromisePortOptions,
): StreamPort<T> {
  return promisePort<T>(async (key, signal) => {
    const lease = await acquire(key, signal);
    let bytes: number;
    try {
      bytes = bytesOf(lease, key);
    } catch (error) {
      lease.release();
      throw error;
    }
    return {value: lease.value, bytes, release: () => lease.release()};
  }, options);
}

/** What `modelPort` needs from a scene: its world, the observed model state and how to make a hidden model entity. */
export interface ModelPortHost {
  readonly world: World;
  modelState(entity: Entity): {readonly status: 'absent' | 'loading' | 'ready' | 'failed'};
  /** Components for a hidden entity that loads `asset` (for example `[Transform(), Model({asset, visible: false})]`). */
  components(asset: string): readonly ComponentInit<object>[];
  /** Bytes charged for a ready asset. The model owner does not report per-asset bytes to scenes, so this is an estimate. */
  bytes(asset: string): number;
}

/** Stream model assets through the scene's model owner. The value is the hidden entity holding the loaded model. */
export function modelPort(host: ModelPortHost): StreamPort<Entity> {
  return {
    start(asset): StreamWork<Entity> {
      const world = host.world;
      const e = world.spawn(...host.components(asset));
      let done = false;
      const release = () => {
        if (done) return;
        done = true;
        world.despawn(e);
      };
      return {
        poll(): StreamPoll<Entity> {
          if (done) return {status: 'failed', retry: false};
          if (!world.exists(e)) {
            done = true;
            return {status: 'failed', error: new Error('streaming: model entity removed'), retry: false};
          }
          const s = host.modelState(e).status;
          if (s === 'ready') return {status: 'ready', value: e, bytes: host.bytes(asset), release};
          if (s === 'failed') {
            release();
            return {status: 'failed', error: new Error(`streaming: model ${asset} failed`)};
          }
          return {status: 'pending'};
        },
        // The model owner retires its own pending load when the entity goes away.
        cancel: release,
      };
    },
  };
}
