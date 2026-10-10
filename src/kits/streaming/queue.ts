/**
 * kits/streaming/queue.ts: an on-demand streaming queue with byte and concurrency budgets, priorities, cancellation
 * and retry.
 *
 * Systems request keys (asset ids, clip libraries, chunk records) with a priority and an estimated byte size. Each
 * `pump(now, out)` from an ordinary system observes running work, publishes completions in start order, moves due
 * retries back to the queue and starts the highest-priority queued keys while the concurrency and byte budgets allow.
 * The frame never waits: work runs through the caller's port (a lease cache, the model owner, a worker job, a fetch)
 * and results are seen on the first pump after they settle.
 *
 * Requests are counted per key: several requesters share one load, the key's priority is the highest of its live
 * requests, and the value is released through its own `release` when the last request is cancelled. Cancelling
 * running work aborts it, but its concurrency slot and byte reservation are held until the work reports that its
 * execution settled (rejecting delivery is not the same as stopping execution). Failures retry with deterministic
 * backoff in the caller's ticks up to `maxAttempts`.
 *
 * Tables are bounded by `maxEntries` and `maxRequests`; nothing grows past them.
 */

/** What a port's work reports when polled. */
export type StreamPoll<T> =
  | {readonly status: 'pending'}
  | {readonly status: 'ready'; readonly value: T; readonly bytes: number; release(): void}
  | {readonly status: 'failed'; readonly error?: unknown; readonly retry?: boolean};

/** One running load. */
export interface StreamWork<T> {
  /** Non-blocking. After `cancel`, reports `pending` until execution has settled, then anything else. */
  poll(): StreamPoll<T>;
  /** Stop the work. A value produced after this is released by the work itself, never published. Idempotent. */
  cancel(): void;
}

export interface StreamPort<T> {
  /** Begin loading `key`. A synchronous throw counts as a failed attempt. */
  start(key: string, signal: AbortSignal): StreamWork<T>;
}

export interface StreamLimits {
  /** Distinct keys tracked (queued, waiting to retry, running, ready, failed, retiring). 1..65,536. */
  readonly maxEntries: number;
  /** Live request handles. maxEntries..1,048,576; default 4 × maxEntries (capped). */
  readonly maxRequests?: number;
  /** Running works, including cancelled works that have not settled. 1..256. */
  readonly maxConcurrent: number;
  /** Byte budget: estimates of running works plus actual bytes of ready values. Positive safe integer. */
  readonly maxBytes: number;
  /** Most starts per pump. 1..maxConcurrent; default maxConcurrent. */
  readonly maxStartsPerPump?: number;
  /** Attempts per key before it fails. 1..16; default 3. */
  readonly maxAttempts?: number;
  /** Backoff after the n-th failure: retryTicks × 2^(n-1), at most maxRetryTicks. Integers ≥ 0; defaults 30 and 600. */
  readonly retryTicks?: number;
  readonly maxRetryTicks?: number;
  /**
   * When the highest-priority queued key cannot start for lack of a slot or bytes, cancel running works of strictly
   * lower priority (lowest first, latest started first) and requeue their keys. Default false.
   */
  readonly preempt?: boolean;
}

export const STREAM_CEILING = Object.freeze({entries: 65_536, requests: 1 << 20, concurrent: 256, attempts: 16});

export type StreamState = 'absent' | 'queued' | 'waiting' | 'running' | 'ready' | 'failed';

export type StreamEventKind = 'started' | 'ready' | 'retrying' | 'failed' | 'preempted';

/**
 * - `idle`: nothing queued.
 * - `complete`: every queued key that could start did; none is waiting for a slot or bytes.
 * - `blocked`: the highest-priority queued key waits for a slot or bytes (lower-priority keys do not overtake it).
 * - `budget`: `maxStartsPerPump` was reached with startable keys left.
 * - `closed`: disposed.
 */
export type StreamPumpStatus = 'idle' | 'complete' | 'blocked' | 'budget' | 'closed';

export interface StreamPumpResult {
  status: StreamPumpStatus;
  /** Events of this pump in order: completions (in start order), retries, preemptions, then starts. */
  readonly kinds: StreamEventKind[];
  readonly keys: string[];
  count: number;
}

/** Capacity covers the most events one pump can produce, so events are never dropped. */
export function createStreamResult(limits: Pick<StreamLimits, 'maxConcurrent' | 'maxStartsPerPump'>): StreamPumpResult {
  const c = intIn(limits.maxConcurrent, 1, STREAM_CEILING.concurrent, 'maxConcurrent');
  const s = limits.maxStartsPerPump === undefined ? c : intIn(limits.maxStartsPerPump, 1, c, 'maxStartsPerPump');
  const n = 2 * c + s;
  return {
    status: 'idle',
    kinds: new Array<StreamEventKind>(n).fill('started'),
    keys: new Array<string>(n).fill(''),
    count: 0,
  };
}

export type StreamRequestStatus = 'accepted' | 'refused-bytes' | 'refused-full' | 'closed';

export interface StreamRequest {
  readonly status: StreamRequestStatus;
  /** A handle for setPriority and cancel; -1 when not accepted. */
  readonly handle: number;
}

export interface StreamStats {
  readonly entries: number;
  readonly requests: number;
  readonly queued: number;
  readonly waiting: number;
  readonly running: number;
  readonly retiring: number;
  readonly ready: number;
  readonly failed: number;
  /** Reserved estimates of running and retiring works plus actual bytes of ready values. */
  readonly bytes: number;
  readonly starts: number;
  readonly completed: number;
  readonly failures: number;
  readonly retries: number;
  readonly preemptions: number;
  readonly cancelled: number;
  /** Ready values whose actual bytes exceeded their estimate but still fit the budget. */
  readonly overEstimate: number;
  /** Ready values refused because their actual bytes did not fit the budget. */
  readonly oversize: number;
  /** `release` calls that threw; counted, never rethrown. */
  readonly releaseErrors: number;
  readonly closed: boolean;
}

export interface StreamQueue<T> {
  /** Ask for `key` at `priority` (finite; higher first) with an estimated size in bytes. */
  request(key: string, o: {readonly priority: number; readonly bytes: number}): StreamRequest;
  /** Change one request's priority. False when the handle is not live. */
  setPriority(handle: number, priority: number): boolean;
  /** End one request. The last request of a key cancels its load or releases its value. False when not live. */
  cancel(handle: number): boolean;
  state(key: string): StreamState;
  /** The ready value, or undefined. Valid until the key's last request is cancelled. */
  get(key: string): T | undefined;
  /** The error of a failed key's last attempt. */
  error(key: string): unknown;
  /** Observe, publish, retry and start. `now` is the caller's nondecreasing integer tick. Returns `out.status`. */
  pump(now: number, out: StreamPumpResult): StreamPumpStatus;
  stats(): StreamStats;
  /** Cancel every running work, release every ready value; terminal and idempotent. */
  dispose(): void;
}

type Phase = 'queued' | 'waiting' | 'running' | 'ready' | 'failed' | 'retiring';

interface Entry<T> {
  readonly key: string;
  phase: Phase;
  priority: number;
  /** Order of first request; ties in priority start in this order. */
  readonly seq: number;
  /** Start order, for publishing completions and choosing preemption victims. */
  startSeq: number;
  readonly handles: Set<number>;
  estimate: number;
  /** Bytes charged to the budget: the estimate while running or retiring, actual bytes when ready. */
  charged: number;
  attempts: number;
  retryAt: number;
  heapPos: number;
  work?: StreamWork<T> | undefined;
  controller?: AbortController | undefined;
  value?: T | undefined;
  release?: (() => void) | undefined;
  error?: unknown;
}

function intIn(n: unknown, lo: number, hi: number, what: string): number {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < lo || n > hi)
    throw new RangeError(`streaming: ${what} must be an integer ${lo}..${hi}`);
  return n;
}
function finite(n: unknown, what: string): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new RangeError(`streaming: ${what} must be finite`);
  return n === 0 ? 0 : n;
}

export function createStreamQueue<T>(port: StreamPort<T>, limits: StreamLimits): StreamQueue<T> {
  if (!port || typeof port.start !== 'function') throw new TypeError('streaming: port.start must be a function');
  if (!limits || typeof limits !== 'object') throw new TypeError('streaming: limits must be an object');
  const maxEntries = intIn(limits.maxEntries, 1, STREAM_CEILING.entries, 'maxEntries');
  const maxRequests =
    limits.maxRequests === undefined
      ? Math.min(STREAM_CEILING.requests, maxEntries * 4)
      : intIn(limits.maxRequests, maxEntries, STREAM_CEILING.requests, 'maxRequests');
  const maxConcurrent = intIn(limits.maxConcurrent, 1, STREAM_CEILING.concurrent, 'maxConcurrent');
  const maxBytes = intIn(limits.maxBytes, 1, Number.MAX_SAFE_INTEGER, 'maxBytes');
  const maxStarts =
    limits.maxStartsPerPump === undefined
      ? maxConcurrent
      : intIn(limits.maxStartsPerPump, 1, maxConcurrent, 'maxStartsPerPump');
  const maxAttempts =
    limits.maxAttempts === undefined ? 3 : intIn(limits.maxAttempts, 1, STREAM_CEILING.attempts, 'maxAttempts');
  const retryTicks = limits.retryTicks === undefined ? 30 : intIn(limits.retryTicks, 0, 2 ** 30, 'retryTicks');
  const maxRetryTicks =
    limits.maxRetryTicks === undefined ? 600 : intIn(limits.maxRetryTicks, retryTicks, 2 ** 40, 'maxRetryTicks');
  if (limits.preempt !== undefined && typeof limits.preempt !== 'boolean')
    throw new TypeError('streaming: preempt must be boolean');
  const preempt = limits.preempt === true;

  const entries = new Map<string, Entry<T>>();
  const handles = new Map<number, {entry: Entry<T>; priority: number}>();
  // Running and retiring works in start order (at most maxConcurrent).
  const running: Entry<T>[] = [];
  // Max-heap of queued entries by (priority desc, seq asc).
  const heap: Entry<T>[] = [];
  const waiting = new Set<Entry<T>>();
  let nextHandle = 1,
    nextSeq = 0,
    nextStart = 0,
    bytes = 0,
    lastNow = 0,
    closed = false;
  const counters = {
    starts: 0,
    completed: 0,
    failures: 0,
    retries: 0,
    preemptions: 0,
    cancelled: 0,
    overEstimate: 0,
    oversize: 0,
    releaseErrors: 0,
  };

  const higher = (a: Entry<T>, b: Entry<T>) => a.priority > b.priority || (a.priority === b.priority && a.seq < b.seq);
  const set = (i: number, e: Entry<T>) => {
    heap[i] = e;
    e.heapPos = i;
  };
  const up = (i: number) => {
    const e = heap[i]!;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!higher(e, heap[p]!)) break;
      set(i, heap[p]!);
      i = p;
    }
    set(i, e);
  };
  const down = (i: number) => {
    const e = heap[i]!;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= heap.length) break;
      const r = l + 1;
      const m = r < heap.length && higher(heap[r]!, heap[l]!) ? r : l;
      if (!higher(heap[m]!, e)) break;
      set(i, heap[m]!);
      i = m;
    }
    set(i, e);
  };
  const enqueue = (e: Entry<T>) => {
    e.phase = 'queued';
    heap.push(e);
    e.heapPos = heap.length - 1;
    up(e.heapPos);
  };
  const dequeue = (e: Entry<T>) => {
    const i = e.heapPos;
    e.heapPos = -1;
    const last = heap.pop()!;
    if (last === e) return;
    set(i, last);
    up(i);
    down(last.heapPos);
  };
  const reprioritise = (e: Entry<T>) => {
    let p = -Infinity;
    for (const h of e.handles) p = Math.max(p, handles.get(h)!.priority);
    if (p === e.priority) return;
    e.priority = p;
    if (e.phase === 'queued') {
      up(e.heapPos);
      down(e.heapPos);
    }
  };
  const safeRelease = (release: (() => void) | undefined) => {
    if (!release) return;
    try {
      release();
    } catch {
      counters.releaseErrors++;
    }
  };
  const stopWork = (e: Entry<T>) => {
    e.controller?.abort();
    try {
      e.work?.cancel();
    } catch {
      // A failing cancel cannot be retried; the slot is still held until the work settles.
    }
  };
  /** The entry lost its last request. */
  const drop = (e: Entry<T>) => {
    counters.cancelled++;
    switch (e.phase) {
      case 'queued':
        dequeue(e);
        entries.delete(e.key);
        return;
      case 'waiting':
        waiting.delete(e);
        entries.delete(e.key);
        return;
      case 'running':
        // Keep the slot and the reservation until execution settles; the key can be requested again meanwhile.
        e.phase = 'retiring';
        stopWork(e);
        entries.delete(e.key);
        return;
      case 'ready':
        bytes -= e.charged;
        safeRelease(e.release);
        e.value = undefined;
        e.release = undefined;
        entries.delete(e.key);
        return;
      default:
        entries.delete(e.key);
    }
  };

  const finish = (out: StreamPumpResult, status: StreamPumpStatus) => {
    out.status = status;
    return status;
  };

  const queue: StreamQueue<T> = {
    request(key, o) {
      if (closed) return {status: 'closed', handle: -1};
      if (typeof key !== 'string' || key.length === 0 || key.length > 512)
        throw new RangeError('streaming: key must be a string of 1..512 characters');
      if (!o || typeof o !== 'object') throw new TypeError('streaming: request options must be an object');
      const priority = finite(o.priority, 'priority');
      const est = intIn(o.bytes, 0, Number.MAX_SAFE_INTEGER, 'bytes');
      if (est > maxBytes) return {status: 'refused-bytes', handle: -1};
      let e = entries.get(key);
      if (handles.size >= maxRequests || (!e && entries.size + countRetiring() >= maxEntries))
        return {status: 'refused-full', handle: -1};
      const handle = nextHandle++;
      if (!e) {
        e = {
          key,
          phase: 'queued',
          priority,
          seq: nextSeq++,
          startSeq: -1,
          handles: new Set(),
          estimate: est,
          charged: 0,
          attempts: 0,
          retryAt: 0,
          heapPos: -1,
        };
        entries.set(key, e);
        handles.set(handle, {entry: e, priority});
        e.handles.add(handle);
        enqueue(e);
      } else {
        // A later request may raise the estimate of a load that has not started.
        if ((e.phase === 'queued' || e.phase === 'waiting') && est > e.estimate) e.estimate = est;
        handles.set(handle, {entry: e, priority});
        e.handles.add(handle);
        reprioritise(e);
      }
      return {status: 'accepted', handle};
    },
    setPriority(handle, priority) {
      const p = finite(priority, 'priority');
      if (closed) return false;
      const h = handles.get(handle);
      if (!h) return false;
      h.priority = p;
      reprioritise(h.entry);
      return true;
    },
    cancel(handle) {
      if (closed) return false;
      const h = handles.get(handle);
      if (!h) return false;
      handles.delete(handle);
      const e = h.entry;
      e.handles.delete(handle);
      if (e.handles.size === 0) drop(e);
      else reprioritise(e);
      return true;
    },
    state(key) {
      const e = closed ? undefined : entries.get(key);
      if (!e) return 'absent';
      return e.phase === 'retiring' ? 'absent' : e.phase;
    },
    get(key) {
      const e = closed ? undefined : entries.get(key);
      return e?.phase === 'ready' ? e.value : undefined;
    },
    error(key) {
      const e = closed ? undefined : entries.get(key);
      return e?.phase === 'failed' || e?.phase === 'waiting' ? e.error : undefined;
    },
    pump(now, out) {
      if (
        !out ||
        !Array.isArray(out.kinds) ||
        !Array.isArray(out.keys) ||
        out.kinds.length < 2 * maxConcurrent + maxStarts
      )
        throw new TypeError('streaming: result must come from createStreamResult with these limits');
      out.count = 0;
      if (closed) return finish(out, 'closed');
      if (typeof now !== 'number' || !Number.isSafeInteger(now) || now < lastNow)
        throw new RangeError('streaming: now must be a nondecreasing safe integer');
      lastNow = now;
      const emit = (kind: StreamEventKind, key: string) => {
        out.kinds[out.count] = kind;
        out.keys[out.count++] = key;
      };
      // 1. Observe running and retiring works, in start order.
      for (let i = 0; i < running.length;) {
        const e = running[i]!;
        let p: StreamPoll<T>;
        try {
          p = e.work!.poll();
        } catch (error) {
          p = {status: 'failed', error};
        }
        if (p.status === 'pending') {
          i++;
          continue;
        }
        running.splice(i, 1);
        bytes -= e.charged;
        e.charged = 0;
        e.work = undefined;
        e.controller = undefined;
        if (e.phase === 'retiring') {
          // Delivery was rejected; release anything that still arrived.
          if (p.status === 'ready') safeRelease(() => p.release());
          continue;
        }
        if (p.status === 'ready') {
          const actual = typeof p.bytes === 'number' && Number.isSafeInteger(p.bytes) && p.bytes >= 0 ? p.bytes : NaN;
          if (Number.isNaN(actual) || bytes + actual > maxBytes) {
            safeRelease(() => p.release());
            counters.oversize++;
            e.error = new RangeError(
              Number.isNaN(actual) ? 'streaming: invalid byte size' : 'streaming: value exceeds the byte budget',
            );
            e.attempts = maxAttempts;
            e.phase = 'failed';
            counters.failures++;
            emit('failed', e.key);
            continue;
          }
          if (actual > e.estimate) counters.overEstimate++;
          e.phase = 'ready';
          e.value = p.value;
          e.release = () => p.release();
          e.charged = actual;
          bytes += actual;
          e.error = undefined;
          counters.completed++;
          emit('ready', e.key);
          continue;
        }
        // Failed.
        counters.failures++;
        e.error = p.error;
        if (p.retry !== false && e.attempts < maxAttempts) {
          e.phase = 'waiting';
          e.retryAt = now + Math.min(maxRetryTicks, retryTicks * 2 ** (e.attempts - 1));
          waiting.add(e);
          emit('retrying', e.key);
        } else {
          e.phase = 'failed';
          emit('failed', e.key);
        }
      }
      // 2. Due retries rejoin the queue (insertion order of waiting is deterministic).
      for (const e of waiting)
        if (e.retryAt <= now) {
          waiting.delete(e);
          counters.retries++;
          enqueue(e);
        }
      // 3. Start the highest-priority keys; never let a lower one overtake a blocked head.
      let starts = 0;
      let status: StreamPumpStatus = heap.length === 0 ? 'idle' : 'complete';
      while (heap.length > 0) {
        const head = heap[0]!;
        const fits = () => running.length < maxConcurrent && bytes + head.estimate <= maxBytes;
        if (starts >= maxStarts) {
          status = fits() ? 'budget' : 'blocked';
          break;
        }
        if (!fits() && preempt) {
          // Lowest priority first, latest started first; only strictly lower than the head; never retiring ones.
          // Stop once the head would fit after every retiring work settles (their slots and bytes are still held).
          let retiringSlots = 0,
            retiringBytes = 0;
          for (const r of running)
            if (r.phase === 'retiring') {
              retiringSlots++;
              retiringBytes += r.charged;
            }
          for (;;) {
            if (running.length - retiringSlots < maxConcurrent && bytes - retiringBytes + head.estimate <= maxBytes)
              break;
            let victim: Entry<T> | undefined;
            for (const r of running)
              if (
                r.phase === 'running' &&
                r.priority < head.priority &&
                (!victim ||
                  r.priority < victim.priority ||
                  (r.priority === victim.priority && r.startSeq > victim.startSeq))
              )
                victim = r;
            if (!victim) break;
            victim.phase = 'retiring';
            retiringSlots++;
            retiringBytes += victim.charged;
            stopWork(victim);
            counters.preemptions++;
            emit('preempted', victim.key);
            // The key keeps its requests: a fresh entry takes its place in the queue; the old one retires.
            const fresh: Entry<T> = {
              key: victim.key,
              phase: 'queued',
              priority: victim.priority,
              seq: victim.seq,
              startSeq: -1,
              handles: victim.handles,
              estimate: victim.estimate,
              charged: 0,
              attempts: victim.attempts - 1,
              retryAt: 0,
              heapPos: -1,
            };
            for (const h of fresh.handles) handles.get(h)!.entry = fresh;
            entries.set(fresh.key, fresh);
            enqueue(fresh);
          }
        }
        if (!fits()) {
          status = 'blocked';
          break;
        }
        dequeue(head);
        head.phase = 'running';
        head.attempts++;
        head.startSeq = nextStart++;
        head.charged = head.estimate;
        bytes += head.charged;
        const controller = new AbortController();
        head.controller = controller;
        counters.starts++;
        starts++;
        try {
          head.work = port.start(head.key, controller.signal);
          if (!head.work || typeof head.work.poll !== 'function' || typeof head.work.cancel !== 'function')
            throw new TypeError('streaming: port.start must return a work with poll and cancel');
        } catch (error) {
          const bad = head.work;
          head.work = {poll: () => ({status: 'failed', error}), cancel: () => bad?.cancel?.()};
        }
        running.push(head);
        emit('started', head.key);
      }
      return finish(out, status);
    },
    stats() {
      let ready = 0,
        failed = 0,
        retiring = 0;
      for (const e of entries.values()) {
        if (e.phase === 'ready') ready++;
        else if (e.phase === 'failed') failed++;
      }
      for (const r of running) if (r.phase === 'retiring') retiring++;
      return Object.freeze({
        entries: closed ? 0 : entries.size,
        requests: closed ? 0 : handles.size,
        queued: heap.length,
        waiting: waiting.size,
        running: running.length - retiring,
        retiring,
        ready,
        failed,
        bytes,
        ...counters,
        closed,
      });
    },
    dispose() {
      if (closed) return;
      closed = true;
      for (const r of running) stopWork(r);
      running.length = 0;
      for (const e of entries.values())
        if (e.phase === 'ready') {
          safeRelease(e.release);
          e.value = undefined;
        }
      entries.clear();
      handles.clear();
      heap.length = 0;
      waiting.clear();
      bytes = 0;
    },
  };
  function countRetiring(): number {
    let n = 0;
    for (const r of running) if (r.phase === 'retiring') n++;
    return n;
  }
  return queue;
}
