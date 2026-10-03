/**
 * The one worker host (ADR 0059 as amended by ADR 0062; STD-RUN-35 to STD-RUN-41).
 *
 * - The designated only `new Worker` site (STD-RUN-35; lint rule `new-worker`). Noun-free: ids, payloads, keys,
 *   versions, signals.
 * - Admission precedes allocation: slots, pending count and reserved bytes are bounded before
 *   `materialise()` runs; saturation and oversize are named outcomes (STD-RUN-40).
 * - One active job per worker. Cancellation invalidates delivery at once, then removes queued work,
 *   posts `cancel` to a sliced job (terminating it if the deadline passes), or terminates an unsliced one
 *   (STD-RUN-41). The slot is not reusable until the worker acknowledges or is retired.
 * - Delivery rechecks owner lifetime, caller signal and version; an undelivered output is released
 *   exactly once through its kind's `release` (STD-RUN-36).
 * - The frame never waits (STD-RUN-37): results arrive through promises; nothing here blocks.
 * - A declared main-thread fallback runs one bounded slice per task when workers are unavailable;
 *   `unavailable` kinds reject with a recoverable, reported error (STD-RUN-38).
 */
import {
  WorkerJobError,
  type HostToWorker,
  type JobClass,
  type JobKind,
  type JobRequest,
  type JobResult,
  type WorkerJobErrorReason,
  type WorkerToHost,
} from './job.ts';
import {PROVISIONAL_WORKER_PROFILE, sizePool, type PoolSize, type WorkerProfile} from './pool-sizing.ts';

/** The part of `Worker` the host uses; tests inject a fake. */
export interface WorkerLike {
  postMessage(message: HostToWorker, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: {data: WorkerToHost}) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** Spawns one worker; throws if it cannot. */
export type WorkerFactory = () => WorkerLike;

/** Timer seam (no wall-clock reads needed). Defaults to the platform's `setTimeout`. */
export interface HostTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface WorkerHostOptions {
  readonly profile?: WorkerProfile;
  /** Defaults to `navigator.hardwareConcurrency`. */
  readonly hardwareConcurrency?: number;
  /** Distinct (kind, key) version histories per owner signal. Default 4096; zero disables keyed admission. */
  readonly maxKeysPerOwner?: number;
  /** `null` declares workers unavailable. Defaults to a module worker on `worker-entry.ts`, if `Worker` exists. */
  readonly createWorker?: WorkerFactory | null;
  readonly timers?: HostTimers;
  /** Developer report for spawn failures, throws, crashes and unavailability (STD-PRI-11).
   * Exceptions are contained; nested diagnostics during a report are suppressed. Job failures settle first. */
  readonly report?: (error: WorkerJobError) => void;
}

export interface WorkerHostStats {
  readonly workers: number;
  readonly running: number;
  readonly pending: number;
  readonly reservedBytes: number;
  readonly peakRunning: number;
  readonly peakReservedBytes: number;
  readonly workersAvailable: boolean;
}

export interface WorkerHost {
  readonly size: PoolSize;
  /** Never rejects for control flow; rejects only with {@link WorkerJobError}. */
  run<I, O>(request: JobRequest<I, O>, signal: AbortSignal): Promise<JobResult<O>>;
  stats(): WorkerHostStats;
  /** Cancels every job and terminates every worker. */
  dispose(): void;
}

/** The designated only `new Worker` site (STD-RUN-35). */
function defaultWorkerFactory(): WorkerFactory | null {
  if (typeof Worker === 'undefined') return null;
  return () => new Worker(new URL('./worker-entry.ts', import.meta.url), {type: 'module'}) as WorkerLike;
}

const defaultTimers: HostTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: h => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>),
};

type AnyKind = JobKind<unknown, unknown>;

interface Entry {
  readonly id: number;
  readonly req: JobRequest<unknown, unknown>;
  readonly kind: AnyKind;
  readonly signal: AbortSignal;
  readonly scope: string | undefined;
  readonly bytes: number;
  readonly cls: JobClass;
  phase: 'pending' | 'running' | 'finished';
  /** The promise has settled; any later output is released, never delivered. */
  delivered: boolean;
  slot: Slot | null;
  settle(result: JobResult<unknown> | WorkerJobError): void;
}

interface Slot {
  readonly worker: WorkerLike;
  entry: Entry | null;
  alive: boolean;
  idleTimer: unknown;
  cancelTimer: unknown;
}

export function createWorkerHost(options: WorkerHostOptions = {}): WorkerHost {
  const size = sizePool(
    options.hardwareConcurrency ??
      (globalThis as {navigator?: {hardwareConcurrency?: number}}).navigator?.hardwareConcurrency,
    options.profile ?? PROVISIONAL_WORKER_PROFILE,
  );
  const maxKeysPerOwner = options.maxKeysPerOwner ?? 4096;
  if (!Number.isSafeInteger(maxKeysPerOwner) || maxKeysPerOwner < 0)
    throw new RangeError('maxKeysPerOwner must be a nonnegative safe integer');
  const createWorker = options.createWorker === undefined ? defaultWorkerFactory() : options.createWorker;
  const timers = options.timers ?? defaultTimers;
  const reporter = options.report;
  let reporting = false;
  const report = (error: WorkerJobError) => {
    if (reporting) return;
    reporting = true;
    try {
      reporter?.(error);
    } catch {
      /* Diagnostics cannot interrupt settlement, retirement or fallback. */
    } finally {
      reporting = false;
    }
  };

  let workersAvailable = createWorker !== null;
  let disposed = false;
  let nextId = 1;
  let reserved = 0;
  let peakRunning = 0;
  let peakReserved = 0;
  let inlineBusy: Entry | null = null;
  const slots: Slot[] = [];
  const queues: Record<JobClass, Entry[]> = {foreground: [], background: []};
  const kinds = new Map<string, AnyKind>();
  /** Per owner lifetime (keyed by its signal): newest version and current entry per `(kind, key)`. */
  const scopes = new WeakMap<AbortSignal, {versions: Map<string, number>; current: Map<string, Entry>}>();

  const scopesOf = (owner: AbortSignal) => {
    let s = scopes.get(owner);
    if (!s) scopes.set(owner, (s = {versions: new Map(), current: new Map()}));
    return s;
  };
  const running = () => slots.reduce((n, s) => n + (s.entry ? 1 : 0), 0) + (inlineBusy ? 1 : 0);
  const pendingCount = () => queues.foreground.length + queues.background.length;

  const fail = (e: Entry, reason: WorkerJobErrorReason, detail?: string) => {
    const error = new WorkerJobError(reason, e.kind.id, detail);
    e.settle(error);
    report(error);
  };

  /** Ends the reservation once execution has stopped or output ownership passed. Idempotent. */
  const finish = (e: Entry) => {
    if (e.phase === 'finished') return;
    if (e.phase === 'pending') {
      const q = queues[e.cls];
      const i = q.indexOf(e);
      if (i >= 0) q.splice(i, 1);
    }
    e.phase = 'finished';
    e.slot = null;
    reserved -= e.bytes;
    if (e.scope !== undefined) {
      const cur = scopesOf(e.req.owner.signal).current;
      if (cur.get(e.scope) === e) cur.delete(e.scope);
    }
  };

  const isCurrent = (e: Entry) => {
    if (e.signal.aborted || e.req.owner.signal.aborted) return false;
    if (e.scope === undefined) return true;
    return scopesOf(e.req.owner.signal).versions.get(e.scope) === e.req.version;
  };

  /** Cleanup is one attempted handoff; a callback failure must not retain execution capacity. */
  const release = (kind: AnyKind, output: unknown) => {
    try {
      kind.release?.(output);
    } catch (cause) {
      const error = new WorkerJobError('threw', kind.id, 'output release failed');
      error.cause = cause;
      report(error);
    }
  };

  /** Delivery is a separate authority check (ADR 0062 decision 3). */
  const deliver = (e: Entry, output: unknown) => {
    if (e.delivered) {
      release(e.kind, output);
      return;
    }
    if (!isCurrent(e)) {
      e.settle({status: e.signal.aborted || e.req.owner.signal.aborted ? 'cancelled' : 'superseded'});
      release(e.kind, output);
      return;
    }
    e.settle({status: 'done', output});
  };

  // ---------------------------------------------------------------- slots

  const retire = (slot: Slot) => {
    if (!slot.alive) return;
    slot.alive = false;
    timers.clearTimeout(slot.idleTimer);
    timers.clearTimeout(slot.cancelTimer);
    slot.worker.onmessage = null;
    slot.worker.onerror = null;
    slot.worker.terminate();
    const i = slots.indexOf(slot);
    if (i >= 0) slots.splice(i, 1);
    const e = slot.entry;
    slot.entry = null;
    if (e) finish(e);
    pump();
  };

  const armIdle = (slot: Slot) => {
    timers.clearTimeout(slot.idleTimer);
    if (slots.length <= size.warm) return;
    slot.idleTimer = timers.setTimeout(() => {
      if (slot.alive && slot.entry === null && slots.length > size.warm) retire(slot);
    }, size.idleReleaseMs);
  };

  const free = (slot: Slot, expected: Entry) => {
    // Authored cleanup/reporting can retire this slot before delivery returns.
    if (!slot.alive || slot.entry !== expected) return;
    timers.clearTimeout(slot.cancelTimer);
    const e = slot.entry;
    slot.entry = null;
    if (e) finish(e);
    armIdle(slot);
    pump();
  };

  const onMessage = (slot: Slot, msg: WorkerToHost) => {
    const e = slot.entry;
    if (!e || e.id !== msg.job) {
      // A result for a job this slot no longer runs: release it once, never deliver.
      if (msg.type === 'done') {
        const kind = kinds.get(msg.kind);
        if (kind) release(kind, msg.output);
      }
      return;
    }
    if (msg.type === 'done') deliver(e, msg.output);
    else if (msg.type === 'failed') {
      if (!e.delivered) fail(e, 'threw', msg.message);
    } else if (!e.delivered) e.settle({status: 'cancelled'});
    free(slot, e);
  };

  const spawn = (): Slot | null => {
    if (!createWorker) return null;
    let worker: WorkerLike;
    try {
      worker = createWorker();
    } catch (err) {
      workersAvailable = false;
      report(new WorkerJobError('spawn', 'host', err instanceof Error ? err.message : String(err)));
      return null;
    }
    const slot: Slot = {worker, entry: null, alive: true, idleTimer: undefined, cancelTimer: undefined};
    worker.onmessage = event => onMessage(slot, event.data);
    worker.onerror = event => {
      const e = slot.entry;
      if (e && !e.delivered) fail(e, 'terminated', event instanceof Error ? event.message : 'worker error');
      retire(slot);
    };
    slots.push(slot);
    return slot;
  };

  /** Background cannot take the last foreground-reserved slot unless the port has only one. */
  const acquire = (cls: JobClass): Slot | 'none' | 'unavailable' => {
    const busy = slots.reduce((n, s) => n + (s.entry ? 1 : 0), 0);
    const limit = cls === 'foreground' || size.cap === 1 ? size.cap : size.cap - 1;
    if (busy >= limit) return 'none';
    const idle = slots.find(s => s.entry === null);
    if (idle) return idle;
    if (slots.length >= size.cap) return 'none';
    return spawn() ?? 'unavailable';
  };

  const dispatch = (e: Entry, slot: Slot) => {
    timers.clearTimeout(slot.idleTimer);
    // Keep the entry discoverable by cancellation/disposal while authored allocation runs.
    let payload;
    try {
      payload = e.req.materialise();
    } catch (err) {
      finish(e);
      fail(e, 'threw', err instanceof Error ? err.message : String(err));
      if (slot.alive) armIdle(slot);
      return;
    }
    // materialise may synchronously abort, dispose this host, or admit a newer version.
    if (disposed || !slot.alive || e.delivered || !isCurrent(e)) {
      if (!e.delivered)
        cancel(
          e,
          disposed || !slot.alive || e.signal.aborted || e.req.owner.signal.aborted ? 'cancelled' : 'superseded',
        );
      if (slot.alive) armIdle(slot);
      return;
    }
    queues[e.cls].shift();
    e.phase = 'running';
    e.slot = slot;
    slot.entry = e;
    try {
      slot.worker.postMessage({type: 'run', job: e.id, kind: e.kind.id, input: payload.input}, [
        ...(payload.transfer ?? []),
      ]);
    } catch (err) {
      slot.entry = null;
      finish(e);
      fail(e, 'threw', err instanceof Error ? err.message : String(err));
      armIdle(slot);
      return;
    }
    peakRunning = Math.max(peakRunning, running());
  };

  // ---------------------------------------------------------------- main-thread fallback

  /** Returns false when the head job must wait for the inline lane. */
  const runInline = (e: Entry): boolean => {
    const fallback = e.kind.fallback;
    if (fallback.mode === 'unavailable') {
      finish(e);
      fail(e, 'unavailable', 'workers unavailable and no main-thread fallback declared');
      return true;
    }
    if (inlineBusy) return false;
    queues[e.cls].shift();
    e.phase = 'running';
    inlineBusy = e;
    peakRunning = Math.max(peakRunning, running());
    const done = () => {
      if (inlineBusy === e) inlineBusy = null;
      finish(e);
      pump();
    };
    let slices: Generator<void, unknown, void>;
    try {
      const payload = e.req.materialise();
      if (disposed || e.delivered || !isCurrent(e)) {
        if (!e.delivered)
          cancel(e, disposed || e.signal.aborted || e.req.owner.signal.aborted ? 'cancelled' : 'superseded');
        done();
        return true;
      }
      slices = fallback.slices(payload.input);
    } catch (err) {
      fail(e, 'threw', err instanceof Error ? err.message : String(err));
      done();
      return true;
    }
    // One bounded slice per task: the frame never waits on more than one slice.
    const step = () => {
      if (e.delivered) {
        // One close attempt only: a generator may yield from finally instead of finishing.
        try {
          slices.return(undefined);
        } catch (cause) {
          const error = new WorkerJobError('threw', e.kind.id, 'fallback cleanup failed');
          error.cause = cause;
          report(error);
        } finally {
          done();
        }
        return;
      }
      let r: IteratorResult<void, unknown>;
      try {
        r = slices.next();
      } catch (err) {
        fail(e, 'threw', err instanceof Error ? err.message : String(err));
        done();
        return;
      }
      if (r.done) {
        deliver(e, r.value);
        done();
        return;
      }
      timers.setTimeout(step, 0);
    };
    timers.setTimeout(step, 0);
    return true;
  };

  // ---------------------------------------------------------------- scheduling

  let pumping = false;
  let again = false;
  function pump() {
    if (pumping) {
      again = true;
      return;
    }
    pumping = true;
    try {
      do {
        again = false;
        pumpOnce();
      } while (again);
    } finally {
      pumping = false;
    }
  }

  function pumpOnce() {
    while (!disposed) {
      const e = queues.foreground[0] ?? queues.background[0];
      if (!e) return;
      if (!workersAvailable) {
        if (!runInline(e)) return;
        continue;
      }
      const slot = acquire(e.cls);
      if (slot === 'unavailable') continue;
      if (slot === 'none') {
        if (e.cls === 'foreground' && size.cap === 1) {
          const bg = slots.find(s => s.entry && s.entry.cls === 'background' && !s.entry.delivered)?.entry;
          if (bg) cancel(bg, 'preempted');
        }
        return;
      }
      dispatch(e, slot);
    }
  }

  /** Invalidates delivery now, then stops execution by the kind's declared rule. */
  function cancel(e: Entry, status: 'cancelled' | 'superseded' | 'preempted') {
    if (e.delivered) return;
    e.settle({status});
    if (e.phase === 'pending') {
      finish(e);
      pump();
      return;
    }
    const slot = e.slot;
    if (e.phase !== 'running' || !slot) return; // inline: the slice loop sees `delivered` and stops
    const c = e.kind.cancellation;
    if (c.mode === 'sliced') {
      slot.worker.postMessage({type: 'cancel', job: e.id}, []);
      slot.cancelTimer = timers.setTimeout(() => {
        if (slot.entry === e) retire(slot);
      }, c.deadlineMs);
    } else {
      retire(slot);
    }
  }

  const admit = (bytes: number, cls: JobClass) => {
    const fits = () => pendingCount() < size.maxPending && reserved + bytes <= size.maxReservedBytes;
    if (fits()) return true;
    // Speculation is coalesced or cancelled before current work is rejected.
    while (cls === 'foreground' && !fits() && queues.background.length > 0) cancel(queues.background[0]!, 'preempted');
    return fits();
  };

  const registerKind = (kind: AnyKind) => {
    const known = kinds.get(kind.id);
    if (known && known !== kind) throw new Error(`worker job kind ${kind.id} registered twice with different rows`);
    if (!known) kinds.set(kind.id, kind);
  };

  return {
    size,
    run<I, O>(request: JobRequest<I, O>, signal: AbortSignal): Promise<JobResult<O>> {
      const req = request as JobRequest<unknown, unknown>;
      registerKind(req.kind);
      const early = (status: 'cancelled' | 'superseded' | 'saturated' | 'oversized') =>
        Promise.resolve({status} as JobResult<O>);
      const {input, output, scratch} = req.bytes;
      if (![input, output, scratch].every(b => Number.isFinite(b) && b >= 0)) {
        throw new RangeError(`worker job ${req.kind.id}: reserved bytes must be finite and non-negative`);
      }
      if (disposed || signal.aborted || req.owner.signal.aborted) return early('cancelled');
      const bytes = input + output + scratch;
      if (bytes > size.maxReservedBytes) return early('oversized');

      let scope: string | undefined;
      let previous: Entry | undefined;
      if (req.key !== undefined) {
        if (!Number.isFinite(req.version)) throw new RangeError('keyed worker version must be finite');
        scope = `${req.kind.id}\u0000${req.key}`;
        const s = scopesOf(req.owner.signal);
        const latest = s.versions.get(scope);
        // Retain known high-water marks; never evict history and accidentally accept stale work.
        if (latest === undefined && s.versions.size >= maxKeysPerOwner) return early('saturated');
        if (latest !== undefined && req.version < latest) return early('superseded');
        s.versions.set(scope, req.version);
        previous = s.current.get(scope);
        if (previous) cancel(previous, 'superseded');
      }
      // Supersession can dispatch queued authored allocation before this request owns an abort listener.
      const ended = () => disposed || signal.aborted || req.owner.signal.aborted;
      const replaced = () => {
        if (scope === undefined) return false;
        const state = scopesOf(req.owner.signal),
          current = state.current.get(scope);
        return state.versions.get(scope) !== req.version || (current !== undefined && current !== previous);
      };
      if (ended()) return early('cancelled');
      if (replaced()) return early('superseded');
      const admitted = admit(bytes, req.class);
      // Admission may preempt background work and pump the same external callback boundary.
      if (ended()) return early('cancelled');
      if (replaced()) return early('superseded');
      if (!admitted) return early('saturated');

      return new Promise<JobResult<O>>((resolve, reject) => {
        const onAbort = () => cancel(e, 'cancelled');
        const e: Entry = {
          id: nextId++,
          req,
          kind: req.kind,
          signal,
          scope,
          bytes,
          cls: req.class,
          phase: 'pending',
          delivered: false,
          slot: null,
          settle(result) {
            if (e.delivered) return;
            e.delivered = true;
            signal.removeEventListener('abort', onAbort);
            req.owner.signal.removeEventListener('abort', onAbort);
            if (result instanceof WorkerJobError) reject(result);
            else resolve(result as JobResult<O>);
          },
        };
        signal.addEventListener('abort', onAbort, {once: true});
        req.owner.signal.addEventListener('abort', onAbort, {once: true});
        reserved += bytes;
        peakReserved = Math.max(peakReserved, reserved);
        if (scope !== undefined) scopesOf(req.owner.signal).current.set(scope, e);
        queues[e.cls].push(e);
        pump();
      });
    },
    stats() {
      return {
        workers: slots.length,
        running: running(),
        pending: pendingCount(),
        reservedBytes: reserved,
        peakRunning,
        peakReservedBytes: peakReserved,
        workersAvailable,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const e of [...queues.foreground, ...queues.background]) cancel(e, 'cancelled');
      if (inlineBusy) cancel(inlineBusy, 'cancelled');
      for (const slot of [...slots]) {
        if (slot.entry) slot.entry.settle({status: 'cancelled'});
        retire(slot);
      }
    },
  };
}
