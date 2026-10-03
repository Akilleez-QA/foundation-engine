/**
 * Job vocabulary for the one worker host (ADR 0059 amended by ADR 0062;
 * STD-RUN-35 to STD-RUN-41).
 *
 * Noun-free by rule: this file knows job ids, payloads, transferables, keys, versions,
 * owner lifetimes and signals. It knows no body, vessel, region or asset. Job modules are
 * owned by their domain and registered as rows (`job-rows.ts`).
 */

/** Generic urgency classes (ADR 0062 decision 4). The caller assigns policy; the host never infers it. */
export type JobClass = 'foreground' | 'background';

/**
 * A resumable pure calculation. Each `yield` ends one bounded slice; the return value is the output.
 * The same generator can drive a worker (through {@link drainSlices}) and the main-thread fallback.
 */
export type JobSlices<O> = Generator<void, O, void>;

/**
 * Declared fallback (STD-RUN-38). `main-thread` requires an explicitly resumable implementation:
 * wrapping an unsliced function in an idle callback is forbidden (ADR 0062 decision 5), so the type
 * demands a slice generator. Cancellation attempts generator.return once and retires host capacity even
 * if cleanup throws. Cleanup errors are reported with their original cause without changing cancellation.
 * A finally block that yields is not drained: authors must complete cancellation cleanup without yielding
 * and within one bounded call. The host cannot force a throwing or yielding finally block to finish.
 * `unavailable` settles as a recoverable, reported failure.
 */
export type JobFallback<I, O> =
  {readonly mode: 'main-thread'; readonly slices: (input: I) => JobSlices<O>} | {readonly mode: 'unavailable'};

/**
 * How a running job stops (ADR 0062 decision 2; STD-RUN-41).
 * - `sliced`: the module checks {@link JobContext.checkpoint} at bounded intervals; the host posts
 *   `cancel` and terminates the worker if the acknowledgement misses `deadlineMs` (Provisional).
 * - `unsliced`: the host terminates the worker at once and replaces it on demand.
 */
export type JobCancellation = {readonly mode: 'sliced'; readonly deadlineMs: number} | {readonly mode: 'unsliced'};

/** One registered job kind. A kind is a row: id, cancellation, fallback and cleanup. */
export interface JobKind<I, O> {
  /** Stable row id, e.g. `job.example.sum`. The worker resolves it through its loader table. */
  readonly id: string;
  readonly cancellation: JobCancellation;
  readonly fallback: JobFallback<I, O>;
  /**
   * Releases an output that will never be delivered (stale, cancelled, superseded or owner gone).
   * Attempted exactly once per undelivered output, e.g. to close a decoded image handle.
   * Exceptions are reported and contained; cleanup is not retried and cannot change the job outcome.
   */
  readonly release?: (output: O) => void;
}

/** An owner lifetime: supersession keys are scoped to it, and its abort cancels its jobs. */
export interface JobOwner {
  readonly id: string;
  readonly signal: AbortSignal;
}

/** Bytes reserved at admission, before any payload is created (ADR 0062 decision 1). */
export interface JobBytes {
  readonly input: number;
  readonly output: number;
  readonly scratch: number;
}

/** A payload made after admission. `transfer` lists buffers whose ownership moves to the worker. */
export interface JobPayload<I> {
  readonly input: I;
  /**
   * Buffers to detach on post. They MUST be owned by this request alone: never a live simulation
   * buffer or a shared-cache buffer (STD-RUN-36). Copy first if the caller keeps using the data.
   */
  readonly transfer?: readonly Transferable[];
}

/** A request descriptor. Admission reads it; `materialise` runs only when the job is dispatched. */
export interface JobRequest<I, O> {
  readonly kind: JobKind<I, O>;
  readonly owner: JobOwner;
  /** Finite when keyed; monotonic per `(owner, kind, key)`. A lower version than the newest seen is stale. */
  readonly version: number;
  /** Optional logical key; supersession scope is `(owner lifetime, job kind, key)`. */
  readonly key?: string;
  readonly class: JobClass;
  readonly bytes: JobBytes;
  /** Builds (or rebuilds) the payload. It is the retry recipe; it is never called for a rejected request. */
  readonly materialise: () => JobPayload<I>;
}

/**
 * Named, resolved outcomes. Failures reject with {@link WorkerJobError} instead (STD-RUN-38).
 * - `done`: the output; ownership passes to the caller.
 * - `cancelled`: the caller's signal or the owner lifetime aborted.
 * - `superseded`: a newer version in the same scope replaced this one (or this one was already stale).
 * - `preempted`: background work yielded its only slot to foreground work; the caller may retry.
 * - `saturated`: admission refused; the existing presentation stays. Work capacity may recover on retry;
 *   a full per-owner distinct-key history remains full for that lifetime (reuse known keys or a new owner).
 * - `oversized`: the request alone exceeds the reserved-byte limit.
 */
export type JobResult<O> =
  | {readonly status: 'done'; readonly output: O}
  | {readonly status: 'cancelled' | 'superseded' | 'preempted' | 'saturated' | 'oversized'};

export type WorkerJobErrorReason = 'spawn' | 'threw' | 'terminated' | 'unavailable';

/** The one named error the host rejects with. `unavailable` is recoverable: retry later. */
export class WorkerJobError extends Error {
  override readonly name = 'WorkerJobError';
  constructor(
    readonly reason: WorkerJobErrorReason,
    readonly kind: string,
    detail?: string,
  ) {
    super(`worker job ${kind} ${reason}${detail ? `: ${detail}` : ''}`);
  }
}

// ------------------------------------------------------------------ inside the worker

/** What a job module sees. No DOM, no rendering library, no registry (STD-RUN-36). */
export interface JobContext {
  /** Yields to the worker's task queue (a message task, not a microtask) and throws if cancelled. */
  checkpoint(): Promise<void>;
  cancelled(): boolean;
}

export interface JobOutput<O> {
  readonly output: O;
  readonly transfer?: readonly Transferable[];
}

/** A job module: a pure function of its input. */
export interface JobModule<I = unknown, O = unknown> {
  run(input: I, ctx: JobContext): JobOutput<O> | Promise<JobOutput<O>>;
}

/** Loader table: job kind id → lazy module import. The worker loads a module on first use. */
export type JobLoaders = Readonly<Record<string, () => Promise<JobModule>>>;

/** Thrown by {@link JobContext.checkpoint} once cancelled; the runtime turns it into a `cancelled` ack. */
export class JobCancelledSignal extends Error {
  override readonly name = 'JobCancelledSignal';
}

/** Drives a slice generator inside a worker, taking a cancellation checkpoint every `slicesPerCheck` slices. */
export async function drainSlices<O>(slices: JobSlices<O>, ctx: JobContext, slicesPerCheck = 1): Promise<O> {
  let n = 0;
  try {
    for (;;) {
      const step = slices.next();
      if (step.done) return step.value;
      if (++n >= slicesPerCheck) {
        n = 0;
        await ctx.checkpoint();
      }
    }
  } finally {
    slices.return(undefined as never);
  }
}

// ------------------------------------------------------------------ message protocol (one shape)

export type HostToWorker =
  | {readonly type: 'run'; readonly job: number; readonly kind: string; readonly input: unknown}
  | {readonly type: 'cancel'; readonly job: number};

export type WorkerToHost =
  | {readonly type: 'done'; readonly job: number; readonly kind: string; readonly output: unknown}
  | {readonly type: 'failed'; readonly job: number; readonly message: string}
  | {readonly type: 'cancelled'; readonly job: number};
