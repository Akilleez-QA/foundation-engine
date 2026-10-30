/** One pointer session per scene. Cancellation invalidates the gesture, not merely its next event. */
export function bindScenePointer(
  canvas: HTMLCanvasElement,
  options: {
    signal: AbortSignal;
    owns(): boolean;
    press(timeStamp: number): void;
    canceled(): void;
    blocked(): void;
    invalidate(): void;
  },
) {
  const doc = canvas.ownerDocument,
    win = doc.defaultView;
  const pointer = {x: 0, y: 0, down: false, pressed: false};
  let active: number | null = null,
    stopped = false,
    wasBlocked = false;
  const cancel = () => {
    const id = active;
    active = null;
    pointer.down = false;
    pointer.pressed = false;
    options.canceled();
    if (id !== null && canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
    options.invalidate();
  };
  const sync = () => {
    if (stopped) return false;
    const blocked = doc.hidden || !options.owns();
    if (blocked && !wasBlocked) {
      cancel();
      options.blocked();
    }
    wasBlocked = blocked;
    return !blocked && !stopped;
  };
  const point = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
    pointer.y = (-(e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1;
  };
  const listeners = new AbortController();
  const listener = {signal: listeners.signal};
  canvas.addEventListener(
    'pointerdown',
    e => {
      if (e.button !== 0 || active !== null || !sync()) return;
      active = e.pointerId;
      point(e);
      pointer.down = true;
      pointer.pressed = true;
      try {
        canvas.setPointerCapture?.(e.pointerId);
      } catch {
        /* A detached synthetic pointer has no capture. */
      }
      options.press(e.timeStamp);
      options.invalidate();
    },
    listener,
  );
  canvas.addEventListener(
    'pointermove',
    e => {
      if (!sync() || (active !== null && active !== e.pointerId)) return;
      if (active !== null && e.buttons === 0) {
        cancel();
        return;
      }
      point(e);
    },
    listener,
  );
  doc.addEventListener(
    'pointerup',
    e => {
      if (e.pointerId !== active) return;
      const id = active;
      active = null;
      pointer.down = false;
      if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
      options.invalidate();
    },
    listener,
  );
  for (const type of ['pointercancel', 'lostpointercapture'] as const)
    canvas.addEventListener(
      type,
      e => {
        if (e.pointerId === active) cancel();
      },
      listener,
    );
  win?.addEventListener('blur', cancel, listener);
  win?.addEventListener('pagehide', cancel, listener);
  win?.addEventListener('resize', cancel, listener);
  doc.addEventListener('visibilitychange', sync, listener);
  const observer = typeof MutationObserver === 'function' ? new MutationObserver(sync) : null;
  observer?.observe(doc.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['open', 'class', 'hidden', 'role', 'aria-modal', 'style'],
  });
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    listeners.abort();
    options.signal.removeEventListener('abort', dispose);
    observer?.disconnect();
    cancel();
  };
  options.signal.addEventListener('abort', dispose, {once: true});
  if (options.signal.aborted) dispose();
  return {pointer, cancel, sync, dispose};
}
