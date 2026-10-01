/** Delivery on the scene's existing resize owner, never another observer or clock. */
export function createViewSize(
  signal: AbortSignal,
  read: () => Readonly<{ width: number; height: number }>,
  report: (error: unknown) => void,
) {
  type Listener = (size: Readonly<{ width: number; height: number }>) => void;
  const listeners = new Set<Listener>();
  let last = Object.freeze({ ...read() });
  let refreshing = false;
  const deliver = (listener: Listener, size = last) => {
    try { listener(size); } catch (error) {
      try { report(error); } catch { /* Diagnostics cannot interrupt viewport ownership or sibling delivery. */ }
    }
  };
  signal.addEventListener('abort', () => listeners.clear(), { once: true });
  return {
    observe(listener: Listener) {
      if (signal.aborted) return () => {};
      listeners.add(listener);
      deliver(listener, Object.freeze({ ...read() }));
      return () => { listeners.delete(listener); };
    },
    refresh() {
      // A delivery owns one geometry snapshot. Reentrant changes are read by the next resize/refresh,
      // never recursively drained: a selector that resizes its own view cannot create an unbounded loop here.
      if (signal.aborted || refreshing) return;
      refreshing = true;
      try {
        const next = read();
        if (last.width === next.width && last.height === next.height) return;
        const snapshot = Object.freeze({ ...next });
        last = snapshot;
        for (const listener of [...listeners]) {
          if (!signal.aborted && listeners.has(listener)) deliver(listener, snapshot);
        }
      } finally { refreshing = false; }
    },
  };
}
