/** Bounded completion/publication ownership. Building is delegated to an abort-aware adapter. */
export interface ResidencyLimits {
  requests: number;
  resident: number;
  bytes: number;
}
export function createResidency<T>(limits: ResidencyLimits, release: (value: T) => void) {
  for (const n of Object.values(limits))
    if (!Number.isSafeInteger(n) || n < 1) throw Error('terrain residency: positive integer limits required');
  limits = {...limits};
  type Job = {
    key: string;
    version: number;
    bytes: number;
    abort: AbortController;
    value?: T;
    ready: boolean;
    failed: boolean;
  };
  const jobs = new Map<string, Job>(),
    resident = new Map<string, {version: number; bytes: number; value: T}>();
  let closed = false,
    reserved = 0,
    releaseErrors = 0;
  const retire = (value: T) => {
    try {
      release(value);
    } catch {
      releaseErrors++;
    }
  };
  const discard = (j: Job) => {
    const ready = j.ready;
    j.ready = false;
    reserved -= j.bytes;
    if (ready) retire(j.value!);
  };
  return {
    request(
      key: string,
      version: number,
      bytes: number,
      build: (signal: AbortSignal) => Promise<T>,
    ): 'accepted' | 'stale' | 'saturated' | 'closed' {
      if (closed) return 'closed';
      if (!key || !Number.isSafeInteger(version) || version < 0 || !Number.isSafeInteger(bytes) || bytes < 1)
        throw Error('terrain residency: invalid request');
      const old = jobs.get(key),
        published = resident.get(key);
      if ((old && version <= old.version) || (published && version <= published.version)) return 'stale';
      // A cancelled running job retains its admission until execution actually settles.
      if (old && !old.ready && !old.failed) return 'saturated';
      const reclaim = old?.bytes ?? 0;
      if (
        jobs.size - (old ? 1 : 0) >= limits.requests ||
        bytes > limits.bytes - (reserved - reclaim) ||
        (!published &&
          resident.size + Array.from(jobs.keys()).filter(k => !resident.has(k) && k !== key).length >= limits.resident)
      )
        return 'saturated';
      if (old) {
        jobs.delete(key);
        old.abort.abort();
        discard(old);
        if (closed) return 'closed';
        if (jobs.has(key)) return 'saturated';
        const current = resident.get(key);
        if (current && version <= current.version) return 'stale';
        if (
          jobs.size >= limits.requests ||
          bytes > limits.bytes - reserved ||
          (!current && resident.size + Array.from(jobs.keys()).filter(k => !resident.has(k)).length >= limits.resident)
        )
          return 'saturated';
      }
      const job: Job = {key, version, bytes, abort: new AbortController(), ready: false, failed: false};
      jobs.set(key, job);
      reserved += bytes;
      void Promise.resolve()
        .then(() => {
          if (job.abort.signal.aborted) throw Error('cancelled');
          return build(job.abort.signal);
        })
        .then(
          value => {
            if (closed || job.abort.signal.aborted || jobs.get(key) !== job) {
              retire(value);
              return;
            }
            job.value = value;
            job.ready = true;
          },
          () => {
            job.failed = true;
          },
        )
        .finally(() => {
          if (closed || job.abort.signal.aborted || job.failed) {
            if (jobs.get(key) === job) {
              jobs.delete(key);
              discard(job);
            }
          }
        });
      return 'accepted';
    },
    /** Adapter must publish synchronously and return true only after taking ownership of the new view. */
    publish(maxCount: number, maxBytes: number, apply: (key: string, value: T, old: T | undefined) => boolean): number {
      if (!Number.isSafeInteger(maxCount) || maxCount < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0)
        throw Error('terrain residency: invalid publication budget');
      if (closed) return 0;
      let count = 0,
        bytes = 0;
      for (const [key, j] of jobs) {
        if (!j.ready || j.abort.signal.aborted || count >= maxCount || bytes + j.bytes > maxBytes) continue;
        const old = resident.get(key);
        if (!apply(key, j.value!, old?.value)) continue;
        // Adapters can synchronously cancel, close, evict or recursively publish.
        // Such callbacks must never resurrect or retire already transferred values.
        if (closed || jobs.get(key) !== j || !j.ready || j.abort.signal.aborted || resident.get(key) !== old) continue;
        resident.set(key, {version: j.version, bytes: j.bytes, value: j.value!});
        jobs.delete(key);
        j.ready = false;
        if (old) {
          reserved -= old.bytes;
          retire(old.value);
        }
        count++;
        bytes += j.bytes;
      }
      return count;
    },
    cancel(key: string) {
      const j = jobs.get(key);
      if (!j) return;
      j.abort.abort();
      if (j.ready || j.failed) {
        jobs.delete(key);
        discard(j);
      }
    },
    evict(key: string) {
      const j = jobs.get(key);
      if (j) {
        j.abort.abort();
        if (j.ready || j.failed) {
          jobs.delete(key);
          discard(j);
        }
      }
      const old = resident.get(key);
      if (old) {
        resident.delete(key);
        reserved -= old.bytes;
        retire(old.value);
      }
    },
    get: (key: string) => resident.get(key)?.value,
    stats: () => ({
      requests: jobs.size,
      resident: resident.size,
      bytes: reserved,
      ready: Array.from(jobs.values()).filter(j => j.ready).length,
      closed,
      releaseErrors,
    }),
    close() {
      if (closed) return;
      closed = true;
      for (const [key, j] of jobs) {
        j.abort.abort();
        if (j.ready || j.failed) {
          jobs.delete(key);
          discard(j);
        }
      }
      const retired = [...resident.values()];
      resident.clear();
      for (const r of retired) {
        reserved -= r.bytes;
        retire(r.value);
      }
    },
  };
}
