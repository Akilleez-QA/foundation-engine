// core/events.ts: the typed event bus. ADR 0004, D3.
// Modules add events by declaration merging, in their own folder:
//   declare module '../../core/events' { interface EngineEvents { 'player.changed': { id: PlayerId; previous: PlayerId } } }
// Names are '<area>.<verb-past>' or '<area>.<noun>.<verb-past>'. Each area has one owning module,
// declared in its manifest's `eventAreas`; the kernel's scoped `emit` enforces it (ADR 0063).
// Events report the past. Commands are service methods. Nothing is emitted per frame.

/** Augmented per module. The kernel owns only the `app` area. */
export interface EngineEvents {
  'app.module-failed': {id: string; phase: BootPhase; error: string};
  'app.started': {ms: number};
}

export type BootPhase = 'discover' | 'register' | 'patch' | 'freeze' | 'validate' | 'install' | 'start';

export type EventKey = keyof EngineEvents & string;

/** Areas only the kernel emits in. */
export const KERNEL_EVENT_AREAS: readonly string[] = Object.freeze(['app']);

/** The owning area of an event name: 'progression.fact.recorded' → 'progression'. */
export function eventArea(name: string): string {
  const dot = name.indexOf('.');
  return dot < 0 ? name : name.slice(0, dot);
}

export interface EventBus {
  /** Subscribe. Passing the owner's AbortSignal ties the subscription to its lifetime. Returns an unsubscribe. */
  on<K extends EventKey>(k: K, fn: (p: EngineEvents[K]) => void, signal?: AbortSignal): () => void;
  /** Synchronous, in subscription order. A throwing listener is reported and skipped; later listeners still run. */
  emit<K extends EventKey>(k: K, p: EngineEvents[K]): void;
}

/** Scalar diagnostics only: no payload or error object is handed to observers.
 * A rejected depth attempt has no completion. Returning a completion observes listener failures.
 */
export type EmitObserver = (
  name: EventKey,
  depth: number,
  rejected: boolean,
) => ((listenerErrors: number) => void) | void;

/** Dev console, test API and profiler only (dev/ imports it; features never do). */
export interface EventBusDebug {
  /** Sees each emit after listeners. Membership is snapshotted at emit entry, like listeners; additions/removals affect later emits. */
  tap(fn: (k: EventKey, p: unknown, listeners: number) => void): () => void;
  listenerCount(k?: EventKey): number;
  /** One optional diagnostic owner. Replacement retires the old binding; stale disposers cannot clear the new one. */
  observeEmits(observer: EmitObserver): () => void;
}

export interface EventBusOptions {
  /** Where listener errors go. Defaults to console.error. Reporter failures are contained; nested reports are suppressed. */
  onListenerError?: (k: EventKey, error: unknown) => void;
  /** Re-entrant emit depth that counts as an event loop (a listener that re-emits its own event). */
  maxDepth?: number;
}

export function createEventBus(opts: EventBusOptions = {}): EventBus & EventBusDebug {
  const listeners = new Map<EventKey, Set<(p: unknown) => void>>();
  const taps = new Set<(k: EventKey, p: unknown, n: number) => void>();
  const maxDepth = opts.maxDepth ?? 32;
  const report = opts.onListenerError ?? ((k, e) => console.error(`[events] listener for ${k} threw`, e));
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1)
    throw new RangeError('event maxDepth must be a positive safe integer');
  let depth = 0,
    reporting = false,
    observing = false;
  let observer: {begin: EmitObserver} | undefined;
  const diagnostic = <T>(fn: () => T): T | undefined => {
    observing = true;
    try {
      return fn();
    } catch {
      /* diagnostics never interrupt delivery */
    } finally {
      observing = false;
    }
    return undefined;
  };
  const reportSafely = (k: EventKey, error: unknown) => {
    if (reporting) return;
    reporting = true;
    try {
      report(k, error);
    } catch {
      /* reporting must never interrupt delivery or report itself */
    } finally {
      reporting = false;
    }
  };
  return {
    on(k, fn, signal) {
      if (signal?.aborted) return () => {};
      let set = listeners.get(k);
      if (!set) listeners.set(k, (set = new Set()));
      const entry = fn as (p: unknown) => void;
      set.add(entry);
      const off = () => {
        set!.delete(entry);
        signal?.removeEventListener('abort', off);
      };
      signal?.addEventListener('abort', off, {once: true});
      return off;
    },
    emit(k, p) {
      const trace = observing ? undefined : observer;
      if (depth >= maxDepth) {
        if (trace) diagnostic(() => trace.begin(k, depth + 1, true));
        throw new Error(`[events] ${k} re-emitted ${maxDepth} deep: an event loop`);
      }
      depth++;
      let finish: ((errors: number) => void) | void = undefined,
        errors = 0;
      try {
        const set = listeners.get(k),
          debugSnapshot = [...taps],
          delivery = set ? [...set] : [];
        if (trace) finish = diagnostic(() => trace.begin(k, depth, false));
        // Snapshot: a listener that unsubscribes (or subscribes) during emit does not change this delivery.
        for (const fn of delivery) {
          try {
            fn(p);
          } catch (e) {
            errors++;
            reportSafely(k, e);
          }
        }
        for (const t of debugSnapshot) {
          try {
            t(k, p, set?.size ?? 0);
          } catch {
            /* taps never break emit */
          }
        }
      } finally {
        if (finish && observer === trace) {
          const complete = finish;
          diagnostic(() => complete(errors));
        }
        depth--;
      }
    },
    observeEmits(begin) {
      const binding = {begin};
      observer = binding;
      return () => {
        if (observer === binding) observer = undefined;
      };
    },
    tap(fn) {
      taps.add(fn);
      return () => {
        taps.delete(fn);
      };
    },
    listenerCount(k) {
      if (k) return listeners.get(k)?.size ?? 0;
      let n = 0;
      for (const s of listeners.values()) n += s.size;
      return n;
    },
  };
}
