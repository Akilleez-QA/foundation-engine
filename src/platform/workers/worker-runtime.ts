/**
 * The generic worker side of the host protocol (ADR 0059 decision 1; ADR 0062 decision 2).
 * One active job per worker. Modules load on demand from the loader table. A `cancel` message is
 * seen only at a checkpoint that yields to the task queue; an unsliced job is stopped by termination.
 */
import {
  JobCancelledSignal,
  type HostToWorker,
  type JobContext,
  type JobLoaders,
  type JobModule,
  type WorkerToHost,
} from './job.ts';

export interface WorkerPort {
  postMessage(message: WorkerToHost, transfer?: Transferable[]): void;
  onmessage: ((event: { data: HostToWorker }) => void) | null;
}

/**
 * Yields to the task queue. MUST be a message/timer task, never `Promise.resolve()`: a microtask
 * yield does not let a queued `cancel` message run (ADR 0062 decision 2).
 */
export type TaskYield = (fn: () => void) => void;

const defaultYield: TaskYield = (fn) => { globalThis.setTimeout(fn, 0); };

export function createWorkerRuntime(port: WorkerPort, loaders: JobLoaders, yieldTask: TaskYield = defaultYield): void {
  const modules = new Map<string, Promise<JobModule>>();
  let active: { job: number; cancelled: boolean } | null = null;

  const load = (kind: string) => {
    let m = modules.get(kind);
    if (!m) {
      const loader = loaders[kind];
      if (!loader) return Promise.reject(new Error(`no job module registered for ${kind}`));
      m = loader();
      // A failed load (a chunk that could not be fetched) is forgotten, so the next job of that kind loads it again.
      const loading = m;
      modules.set(kind, loading);
      loading.catch(() => { if (modules.get(kind) === loading) modules.delete(kind); });
    }
    return m;
  };

  const run = async (job: number, kind: string, input: unknown) => {
    const state = { job, cancelled: false };
    active = state;
    const ctx: JobContext = {
      cancelled: () => state.cancelled,
      checkpoint: () => new Promise<void>((resolve, reject) => {
        yieldTask(() => (state.cancelled ? reject(new JobCancelledSignal()) : resolve()));
      }),
    };
    try {
      const mod = await load(kind);
      if (state.cancelled) throw new JobCancelledSignal();
      const out = await mod.run(input, ctx);
      if (state.cancelled) port.postMessage({ type: 'cancelled', job });
      else port.postMessage({ type: 'done', job, kind, output: out.output }, [...(out.transfer ?? [])]);
    } catch (err) {
      if (err instanceof JobCancelledSignal || state.cancelled) port.postMessage({ type: 'cancelled', job });
      else port.postMessage({ type: 'failed', job, message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (active === state) active = null;
    }
  };

  port.onmessage = ({ data }) => {
    if (data.type === 'cancel') {
      if (active && active.job === data.job) active.cancelled = true;
      return;
    }
    void run(data.job, data.kind, data.input);
  };
}
