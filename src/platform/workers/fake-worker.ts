/**
 * Test doubles for the worker host (Node has no `Worker` the host can use): a manual fake worker,
 * an in-process worker that runs the real runtime, and deterministic timers.
 */
import type { HostToWorker, JobLoaders, WorkerToHost } from './job.ts';
import type { HostTimers, WorkerLike } from './host.ts';
import { createWorkerRuntime, type WorkerPort } from './worker-runtime.ts';

export interface FakeTimers extends HostTimers {
  advance(ms: number): void;
  /** Runs everything due now (including zero-delay timers scheduled while running). */
  flush(): void;
  pending(): number;
}

export function createFakeTimers(): FakeTimers {
  let now = 0;
  let seq = 0;
  const due = new Map<number, { at: number; seq: number; fn: () => void }>();
  const runDue = (limit: number) => {
    for (;;) {
      let next: [number, { at: number; seq: number; fn: () => void }] | undefined;
      for (const t of due) if (t[1].at <= limit && (!next || t[1].at < next[1].at || (t[1].at === next[1].at && t[1].seq < next[1].seq))) next = t;
      if (!next) return;
      due.delete(next[0]);
      now = Math.max(now, next[1].at);
      next[1].fn();
    }
  };
  return {
    setTimeout(fn, ms) { const id = ++seq; due.set(id, { at: now + Math.max(0, ms), seq: id, fn }); return id; },
    clearTimeout(h) { due.delete(h as number); },
    advance(ms) { const target = now + ms; runDue(target); now = target; },
    flush() { runDue(now); },
    pending: () => due.size,
  };
}

/** A worker the test drives by hand. */
export class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: WorkerToHost }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly received: { message: HostToWorker; transfer: Transferable[] }[] = [];
  terminated = false;
  postMessage(message: HostToWorker, transfer: Transferable[]) { this.received.push({ message, transfer }); }
  terminate() { this.terminated = true; }
  /** The `run` message currently assigned to this worker. */
  lastRun() {
    for (let i = this.received.length - 1; i >= 0; i--) {
      const m = this.received[i]!.message;
      if (m.type === 'run') return m;
    }
    return undefined;
  }
  cancels() { return this.received.filter((r) => r.message.type === 'cancel').length; }
  complete(output: unknown) {
    const run = this.lastRun();
    if (!run) throw new Error('no run to complete');
    this.onmessage?.({ data: { type: 'done', job: run.job, kind: run.kind, output } });
  }
  ackCancel() { const run = this.lastRun()!; this.onmessage?.({ data: { type: 'cancelled', job: run.job } }); }
  throwInJob(message: string) { const run = this.lastRun()!; this.onmessage?.({ data: { type: 'failed', job: run.job, message } }); }
  crash() { this.onerror?.(new Error('crashed')); }
}

export function fakeWorkerFactory() {
  const workers: FakeWorker[] = [];
  return { workers, create: () => { const w = new FakeWorker(); workers.push(w); return w; } };
}

/** A worker that runs the real runtime in-process; messages cross as timer tasks, as in a browser. */
export function createInProcessWorker(loaders: JobLoaders, timers: HostTimers): WorkerLike & { terminated: boolean } {
  let terminated = false;
  const port: WorkerPort = {
    onmessage: null,
    postMessage(message) {
      timers.setTimeout(() => { if (!terminated) worker.onmessage?.({ data: message }); }, 0);
    },
  };
  const worker = {
    onmessage: null as WorkerLike['onmessage'],
    onerror: null as WorkerLike['onerror'],
    get terminated() { return terminated; },
    postMessage(message: HostToWorker) {
      timers.setTimeout(() => { if (!terminated) port.onmessage?.({ data: message }); }, 0);
    },
    terminate() { terminated = true; },
  };
  createWorkerRuntime(port, loaders, (fn) => { timers.setTimeout(() => { if (!terminated) fn(); }, 0); });
  return worker;
}
