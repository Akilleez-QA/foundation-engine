/** Pure gain policy. Each lease releases only its own request; the strongest active duck wins. */
export function createDucking(onChange: (gain: number) => void = () => {}) {
  const leases = new Map<symbol, number>();
  const releases = new Map<symbol, () => void>();
  let closed = false,
    gain = 1;
  const update = () => {
    let next = 1;
    for (const factor of leases.values()) next = Math.min(next, factor);
    if (next !== gain) {
      gain = next;
      onChange(gain);
    }
  };
  return {
    get gain() {
      return gain;
    },
    acquire(factor: number, signal?: AbortSignal): () => void {
      if (!Number.isFinite(factor) || factor < 0 || factor > 1) throw Error('duck factor must be in [0, 1]');
      if (closed) throw Error('ducking disposed');
      if (signal?.aborted) return () => {};
      const id = Symbol();
      leases.set(id, factor);
      const release = () => {
        signal?.removeEventListener('abort', release);
        releases.delete(id);
        if (leases.delete(id)) update();
      };
      signal?.addEventListener('abort', release, {once: true});
      releases.set(id, release);
      update();
      return () => {
        release();
        releases.delete(id);
      };
    },
    dispose() {
      if (closed) return;
      closed = true;
      // Detach every owner's listener, then restore the unducked gain once.
      const all = [...releases.values()];
      releases.clear();
      leases.clear();
      for (const release of all) release();
      update();
    },
  };
}
