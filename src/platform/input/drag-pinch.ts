/**
 * One-pointer drag and two-finger pinch for a self-contained viewer. Each
 * pointer keeps its own last position, so lifting a pinch finger hands the drag
 * to the remaining finger without a jump. Mouse drags need the primary button.
 * Lost capture, blur and a hidden page end every contact.
 */
type Point = {x: number; y: number};
type Surface = EventTarget & {
  setPointerCapture?(id: number): void;
  releasePointerCapture?(id: number): void;
  hasPointerCapture?(id: number): boolean;
};
export function installDragPinch(
  el: Surface,
  {
    drag,
    zoom,
    start,
    active = () => true,
  }: {
    drag: (dx: number, dy: number) => void;
    zoom: (factor: number) => void;
    start?: () => void;
    active?: () => boolean;
  },
  {
    signal,
    window: win = globalThis.window,
    document: doc = globalThis.document,
  }: {signal: AbortSignal; window?: EventTarget; document?: EventTarget & {hidden?: boolean}},
) {
  const pointers = new Map<number, Point>();
  let spread = 0;
  const measure = () => {
    const [a, b] = [...pointers.values()];
    spread = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const release = (id: number) => {
    try {
      if (el.hasPointerCapture?.(id)) el.releasePointerCapture?.(id);
    } catch {
      /* already gone */
    }
  };
  const end = (id: number) => {
    if (!pointers.delete(id)) return;
    release(id);
    measure();
  };
  const reset = () => {
    for (const id of pointers.keys()) release(id);
    pointers.clear();
    spread = 0;
  };
  el.addEventListener(
    'pointerdown',
    event => {
      const e = event as PointerEvent;
      if (!active() || (e.pointerType !== 'touch' && e.button !== 0)) return;
      try {
        el.setPointerCapture?.(e.pointerId);
      } catch {
        /* synthetic pointer */
      }
      pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
      measure();
      start?.();
    },
    {signal},
  );
  el.addEventListener(
    'pointermove',
    event => {
      const e = event as PointerEvent,
        old = pointers.get(e.pointerId);
      if (!old) return;
      // A mouse release we never saw (for example over a system dialog) ends the drag.
      if (e.pointerType === 'mouse' && e.buttons === 0) {
        end(e.pointerId);
        return;
      }
      pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
      if (!active()) return;
      if (pointers.size >= 2) {
        const before = spread;
        measure();
        if (before > 2 && spread > 2) zoom(before / spread);
        return;
      }
      drag(e.clientX - old.x, e.clientY - old.y);
    },
    {signal},
  );
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
    el.addEventListener(name, e => end((e as PointerEvent).pointerId), {signal});
  win.addEventListener('blur', reset, {signal});
  doc.addEventListener(
    'visibilitychange',
    () => {
      if (doc.hidden) reset();
    },
    {signal},
  );
  el.addEventListener('contextmenu', e => e.preventDefault(), {signal});
  return {
    reset,
    get size() {
      return pointers.size;
    },
  };
}
