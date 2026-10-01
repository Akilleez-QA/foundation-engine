import { createRouteQueue, type RouteRequest } from './queue';
import type { PathResult } from './search';

export type LifetimeRouteRequest = Omit<RouteRequest, 'owner'>;
export type LifetimeRouteAdmission = 'accepted' | 'stale' | 'duplicate' | 'conflict' | 'saturated' | 'closed' | 'retired';
/** An in-process lifetime. Labels are diagnostic; methods never resolve an owner by label. */
export interface RouteOwner {
  readonly label: string;
  offer(request: LifetimeRouteRequest): LifetimeRouteAdmission;
  result(id: string): PathResult | null;
  release(id: string): void;
  retire(): void;
}
export type RouteOwnerAdmission = { status: 'accepted'; owner: RouteOwner } | { status: 'saturated' | 'closed' | 'retired' };

/** Optional lifetime adapter; all search work and node accounting stay in the existing queue. */
export function createLifetimeRouteQueue(options: { maxOwners: number; maxRequests: number; maxNodes: number }) {
  const { maxOwners, maxRequests, maxNodes } = options;
  const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
  const isAborted = (signal: AbortSignal | undefined) => signal !== undefined && (aborted.call(signal) as boolean);
  if (![maxOwners, maxRequests, maxNodes].every(n => Number.isSafeInteger(n) && n > 0)) throw Error('navigation: invalid lifetime limits');
  // The legacy queue also caps owner tombstones by maxRequests. Fixed reusable slots
  // bound those tombstones; the adapter independently enforces the public request cap.
  const queue = createRouteQueue({ maxRequests: Math.max(maxOwners, maxRequests), maxNodes });
  type Lifetime = { retired: boolean; ids: Set<string>; cleanup(): void };
  type Slot = { epoch: number; lifetime?: Lifetime };
  const slots: Slot[] = [];
  let closed = false, busy = false;
  const idle = () => { if (busy) throw Error('navigation: reentrant lifetime operation'); };
  const flush = () => {
    for (const slot of slots) if (slot.lifetime?.retired) { slot.lifetime.cleanup(); slot.lifetime = undefined; }
    if (closed) queue.dispose();
  };
  return {
    openOwner(input: { label: string; signal?: AbortSignal }): RouteOwnerAdmission {
      if (closed) return { status: 'closed' };
      idle(); busy = true;
      try {
        const { label, signal } = input;
        if (closed) return { status: 'closed' };
        if (isAborted(signal)) return { status: 'retired' };
        if (typeof label !== 'string') throw Error('navigation: invalid owner label');
        let index = slots.findIndex(slot => !slot.lifetime && slot.epoch < Number.MAX_SAFE_INTEGER);
        if (index < 0) {
          if (slots.length >= maxOwners) return { status: 'saturated' };
          index = slots.push({ epoch: -1 }) - 1;
        }
        const slot = slots[index]!, key = String(index);
        const internalId = (id: string) => JSON.stringify([index, id]);
        let generation: number | undefined;
        const lifetime: Lifetime = {
          retired: false, ids: new Set(),
          cleanup() {
            if (signal !== undefined) EventTarget.prototype.removeEventListener.call(signal, 'abort', retire);
            for (const id of lifetime.ids) queue.release(internalId(id));
            lifetime.ids.clear();
          },
        };
        const retire = () => { lifetime.retired = true; if (!busy) flush(); };
        slot.lifetime = lifetime;
        if (signal !== undefined) EventTarget.prototype.addEventListener.call(signal, 'abort', retire, { once: true });
        const owner: RouteOwner = Object.freeze({
          label,
          offer(input: LifetimeRouteRequest): LifetimeRouteAdmission {
            if (closed) return 'closed';
            if (lifetime.retired) return 'retired';
            idle(); busy = true;
            try {
              // Read each caller property once under the guard. Accessors may retire or
              // dispose, but cannot reopen this slot while its admission is in flight.
              const { id, generation: requestedGeneration, graph, start, goal } = input;
              if (closed) return 'closed';
              if (lifetime.retired || slot.lifetime !== lifetime) return 'retired';
              if (typeof id !== 'string' || !id || !Number.isSafeInteger(requestedGeneration) || requestedGeneration < 0) throw Error('navigation: invalid request identity');
              if (generation !== undefined && requestedGeneration < generation) return 'stale';
              const advances = generation === undefined || requestedGeneration > generation;
              if (advances && slot.epoch === Number.MAX_SAFE_INTEGER) return 'saturated';
              if (!lifetime.ids.has(id) && queue.stats.requests - (advances ? lifetime.ids.size : 0) >= maxRequests) return 'saturated';
              const epoch = slot.epoch + (advances ? 1 : 0);
              const status = queue.offer({ id: internalId(id), owner: key, generation: epoch, graph, start, goal });
              if (status === 'accepted') {
                // Record even a retired admission so deferred cleanup releases it, and
                // retain the actual legacy epoch before this slot can be reused.
                if (advances) lifetime.ids.clear();
                lifetime.ids.add(id); generation = requestedGeneration; slot.epoch = epoch;
              }
              return closed ? 'closed' : lifetime.retired || slot.lifetime !== lifetime ? 'retired' : status;
            } finally { busy = false; flush(); }
          },
          result(id: string) {
            if (closed || lifetime.retired || slot.lifetime !== lifetime) return null;
            if (typeof id !== 'string') throw Error('navigation: invalid request id');
            return queue.result(internalId(id));
          },
          release(id: string) {
            if (closed || lifetime.retired || slot.lifetime !== lifetime) return;
            idle();
            if (typeof id !== 'string') throw Error('navigation: invalid request id');
            queue.release(internalId(id)); lifetime.ids.delete(id);
          },
          retire,
        });
        return { status: 'accepted', owner };
      } finally { busy = false; flush(); }
    },
    pump(maxWork: number) { idle(); return queue.pump(maxWork); },
    dispose() {
      if (closed) return;
      closed = true;
      for (const slot of slots) if (slot.lifetime) slot.lifetime.retired = true;
      if (!busy) flush();
    },
    get stats() { return { requests: queue.stats.requests, nodes: queue.stats.nodes, owners: slots.filter(slot => slot.lifetime && !slot.lifetime.retired).length, slots: slots.length, closed }; },
  };
}
