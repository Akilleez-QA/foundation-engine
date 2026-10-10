/**
 * platform/render/gpu-timer.ts: optional measured GPU time per frame (ADR 0172; STD-REN-5 loss).
 *
 * One timer belongs to one WebGL2 context and one frame owner (the scene runtime, or a creator's own renderer). It
 * wraps the owner's draw in a `TIME_ELAPSED` query from `EXT_disjoint_timer_query_webgl2` and reads the answer back
 * a few frames later without ever waiting:
 *
 *  - **Bounded ring.** At most `capacity` queries are in flight. `begin` with every slot pending skips that frame
 *    (`skippedBusy`); it never blocks and never grows. A query still unanswered after `maxPendingPolls` polls is
 *    abandoned (`abandoned`) so a driver that never answers cannot pin the ring.
 *  - **One active query.** `begin` while a query is open is refused (`skippedNested`): WebGL allows one active
 *    `TIME_ELAPSED` query per context, so nested owners cannot overlap.
 *  - **Non-blocking readback.** `poll` checks `QUERY_RESULT_AVAILABLE` oldest first and stops at the first that is
 *    not ready (results complete in submission order); `QUERY_RESULT` is read only once available.
 *  - **Disjoint.** When `GPU_DISJOINT_EXT` reports a disjoint operation (a clock change, a context switch), every
 *    answered and pending result in the ring is discarded (`disjoint`), never reported.
 *  - **Attribution.** Each result carries the frame number passed to the `begin` that opened it.
 *  - **Unavailable.** Without the extension (or WebGL2 queries) the timer is `unavailable`, every call is a no-op and
 *    `lastMs` stays undefined; nothing pretends to be a measurement.
 *  - **Context loss.** A lost context (`isContextLost()`, or the recovery owner's `contextLost()`) drops the ring
 *    without deleting (its objects died with the context). On restore (`contextRestored()`, which the scene runtime
 *    calls from the recovery owner's restore hook, or a later call that observes the context live again) the
 *    extension is looked up again and fresh queries are made lazily.
 *  - **Disposal.** Deletes the queries it made (when the context is live) and refuses further work.
 *
 * Nothing here schedules a frame, reads a clock or allocates per frame once the ring is filled. When no owner creates
 * a timer, no extension is requested and no query exists.
 */

/** `EXT_disjoint_timer_query_webgl2` enums (fixed by the extension's specification). */
export const TIME_ELAPSED_EXT = 0x88bf;
export const GPU_DISJOINT_EXT = 0x8fbb;
/** WebGL2 query parameters. */
const QUERY_RESULT = 0x8866;
const QUERY_RESULT_AVAILABLE = 0x8867;
export const GPU_TIMER_EXTENSION = 'EXT_disjoint_timer_query_webgl2';

/** The structural subset of `WebGL2RenderingContext` the timer uses (a fake in tests). */
export interface GpuTimerContext {
  getExtension(name: string): unknown;
  createQuery(): object | null;
  deleteQuery(query: object | null): void;
  beginQuery(target: number, query: object): void;
  endQuery(target: number): void;
  getQueryParameter(query: object, pname: number): unknown;
  getParameter(pname: number): unknown;
  isContextLost(): boolean;
}

export interface GpuTimerOptions {
  /** Queries in flight at once, 1..16. Default 4 (readback normally lands 1-3 frames later). */
  capacity?: number;
  /** Completed results kept for `take()`, 1..4096. Default 64; older results are dropped and counted. */
  maxResults?: number;
  /** Polls a pending query may wait before it is abandoned, 1..600. Default 60. */
  maxPendingPolls?: number;
  /** Called once per measured result, during `poll`, with the frame `begin` named. A throw is counted and contained. */
  onResult?: ((frame: number, gpuMs: number) => void) | undefined;
}

export type GpuTimerStatus = 'available' | 'unavailable' | 'lost' | 'disposed';

/** One measured frame: the frame number its `begin` named and the GPU time between begin and end. */
export interface GpuTimerResult {
  frame: number;
  gpuMs: number;
}

export interface GpuTimerStats {
  status: GpuTimerStatus;
  capacity: number;
  inFlight: number;
  /** Results reported (available, not disjoint, finite). */
  measured: number;
  /** Results discarded because the extension reported a disjoint operation. */
  disjoint: number;
  /** Frames not measured because every ring slot was still pending. */
  skippedBusy: number;
  /** `begin` refused because a query was already open. */
  skippedNested: number;
  /** Pending queries given up after `maxPendingPolls` polls. */
  abandoned: number;
  /** Context losses observed (each drops the ring). */
  losses: number;
  /** Completed results evicted before `take()` read them. */
  droppedResults: number;
  /** Results with a non-finite or negative value (never reported). */
  invalid: number;
  /** `onResult` calls that threw. */
  listenerErrors: number;
}

export interface GpuTimer {
  readonly status: GpuTimerStatus;
  /** The most recent measured GPU time in ms, or undefined when none has been measured (or unavailable). */
  readonly lastMs: number | undefined;
  /** Opens this frame's query. False when not measured (unavailable, lost, busy, nested, disposed). */
  begin(frame: number): boolean;
  /** Closes the open query; a no-op when none is open. */
  end(): void;
  /** Reads answered queries without waiting; returns how many new results were reported. */
  poll(): number;
  /** Drains the completed results, oldest first. */
  take(): GpuTimerResult[];
  stats(): GpuTimerStats;
  /** The recovery owner saw the context lost. */
  contextLost(): void;
  /** The recovery owner saw the context restored: look the extension up again. */
  contextRestored(): void;
  dispose(): void;
}

interface Slot {
  query: object;
  frame: number;
  polls: number;
}

const bounded = (name: string, value: number, min: number, max: number) => {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError(`gpu timer ${name} must be an integer in ${min}..${max}`);
  return value;
};
const increment = (n: number) => Math.min(Number.MAX_SAFE_INTEGER, n + 1);

/** A context without WebGL2 queries (WebGL1): the timer is `unavailable`. */
export type GpuTimerAnyContext = GpuTimerContext | {isContextLost(): boolean; getExtension(name: string): unknown};

export function createGpuTimer(context: GpuTimerAnyContext, options: GpuTimerOptions = {}): GpuTimer {
  const queries = typeof (context as Partial<GpuTimerContext>).createQuery === 'function';
  const gl = context as GpuTimerContext;
  const capacity = bounded('capacity', options.capacity ?? 4, 1, 16);
  const maxResults = bounded('maxResults', options.maxResults ?? 64, 1, 4096);
  const maxPendingPolls = bounded('maxPendingPolls', options.maxPendingPolls ?? 60, 1, 600);

  /** Spare query objects for this context (reused; never more than `capacity`). */
  const spare: object[] = [];
  /** Pending queries, oldest first. */
  const pending: Slot[] = [];
  const results: GpuTimerResult[] = [];
  let made = 0,
    open: Slot | null = null,
    status: GpuTimerStatus = 'unavailable',
    lastMs: number | undefined;
  const counts = {
    measured: 0,
    disjoint: 0,
    skippedBusy: 0,
    skippedNested: 0,
    abandoned: 0,
    losses: 0,
    droppedResults: 0,
    invalid: 0,
    listenerErrors: 0,
  };

  const lost = () => {
    try {
      return gl.isContextLost();
    } catch {
      return true;
    }
  };
  const acquire = (): GpuTimerStatus => {
    if (lost()) return 'lost';
    if (!queries) return 'unavailable';
    try {
      return gl.getExtension(GPU_TIMER_EXTENSION) ? 'available' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  };
  /** Objects of a lost context are dead: forget them without calling into the context. */
  const forget = () => {
    spare.length = 0;
    pending.length = 0;
    open = null;
    made = 0;
  };
  /** Ends an open query and deletes every query this timer made (live context only). */
  const dropOwned = () => {
    const owned = [...spare, ...pending.map(s => s.query), ...(open ? [open.query] : [])];
    if (open) {
      try {
        gl.endQuery(TIME_ELAPSED_EXT);
      } catch {
        /* The query is deleted below either way. */
      }
    }
    for (const q of owned) gl.deleteQuery(q);
  };
  const markLost = () => {
    if (status === 'disposed' || status === 'lost') return;
    // Reported lost while the context still answers: delete what was made so a false report leaks nothing.
    if (!lost()) dropOwned();
    forget();
    status = 'lost';
    counts.losses = increment(counts.losses);
  };
  /** Live check at every entry point: notices a loss (or a restore) the recovery owner has not reported yet. */
  const live = (): boolean => {
    if (status === 'disposed') return false;
    if (lost()) {
      markLost();
      return false;
    }
    if (status === 'lost') status = acquire();
    return status === 'available';
  };
  const release = (slot: Slot) => {
    if (spare.length < capacity) spare.push(slot.query);
    else {
      made--;
      gl.deleteQuery(slot.query);
    }
  };
  const record = (frame: number, ms: number) => {
    lastMs = ms;
    counts.measured = increment(counts.measured);
    results.push({frame, gpuMs: ms});
    if (results.length > maxResults) {
      results.shift();
      counts.droppedResults = increment(counts.droppedResults);
    }
    if (options.onResult) {
      try {
        options.onResult(frame, ms);
      } catch {
        counts.listenerErrors = increment(counts.listenerErrors);
      }
    }
  };

  status = acquire();

  return {
    get status() {
      return status;
    },
    get lastMs() {
      return lastMs;
    },
    begin(frame) {
      if (!live()) return false;
      if (open) {
        counts.skippedNested = increment(counts.skippedNested);
        return false;
      }
      if (pending.length >= capacity) {
        counts.skippedBusy = increment(counts.skippedBusy);
        return false;
      }
      let query = spare.pop() ?? null;
      if (!query) {
        if (made >= capacity) {
          counts.skippedBusy = increment(counts.skippedBusy);
          return false;
        }
        query = gl.createQuery();
        if (!query) {
          // A context that cannot make a query is lost or out of objects; measure nothing this frame.
          if (lost()) markLost();
          return false;
        }
        made++;
      }
      gl.beginQuery(TIME_ELAPSED_EXT, query);
      open = {query, frame, polls: 0};
      return true;
    },
    end() {
      const slot = open;
      if (!slot) return;
      open = null;
      if (lost()) {
        markLost();
        return;
      }
      gl.endQuery(TIME_ELAPSED_EXT);
      pending.push(slot);
    },
    poll() {
      if (!live() || !pending.length) return 0;
      let reported = 0,
        answered = 0;
      while (answered < pending.length) {
        const slot = pending[answered]!;
        if (!gl.getQueryParameter(slot.query, QUERY_RESULT_AVAILABLE)) break;
        answered++;
      }
      // Disjoint is read after availability: it covers every query answered so far, so all of them are suspect.
      const disjoint = !!gl.getParameter(GPU_DISJOINT_EXT);
      if (disjoint) {
        for (const slot of pending.splice(0)) {
          counts.disjoint = increment(counts.disjoint);
          release(slot);
        }
        return 0;
      }
      for (const slot of pending.splice(0, answered)) {
        const ns = gl.getQueryParameter(slot.query, QUERY_RESULT);
        const ms = typeof ns === 'number' ? ns / 1e6 : Number.NaN;
        if (Number.isFinite(ms) && ms >= 0) {
          record(slot.frame, ms);
          reported++;
        } else counts.invalid = increment(counts.invalid);
        release(slot);
      }
      for (let i = 0; i < pending.length;) {
        const slot = pending[i]!;
        if (++slot.polls > maxPendingPolls) {
          pending.splice(i, 1);
          counts.abandoned = increment(counts.abandoned);
          // A query that never answers is deleted, not reused.
          made--;
          gl.deleteQuery(slot.query);
        } else i++;
      }
      return reported;
    },
    take() {
      return results.splice(0);
    },
    stats: () => ({status, capacity, inFlight: pending.length + (open ? 1 : 0), ...counts}),
    contextLost: markLost,
    contextRestored() {
      if (status === 'disposed') return;
      forget();
      status = acquire();
    },
    dispose() {
      if (status === 'disposed') return;
      if (!lost()) dropOwned();
      forget();
      status = 'disposed';
    },
  };
}
