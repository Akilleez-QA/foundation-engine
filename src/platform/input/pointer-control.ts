import type { ActionId, InputActions } from './actions';
import { ownActionSource } from './owned-action-source';

/** One independently captured contact per explicitly authored control, including non-primary touch. */
export function bindPointerControl(element: HTMLElement, options: {
  input: InputActions;
  actions: readonly ActionId[];
  /** Choose declared digital actions from element-local CSS coordinates. Default: all declared actions. */
  select?: (x: number, y: number, width: number, height: number) => readonly ActionId[];
  signal: AbortSignal;
}): { dispose(): void } {
  const { input, signal, select } = options;
  const actions = [...options.actions];
  const life = new AbortController();
  const source = ownActionSource(input, actions, 'touch', life.signal);
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  let active: number | null = null;
  let disposed = false;
  const reset = () => {
    const id = active;
    active = null;
    try { source.set([]); }
    finally {
      if (id !== null) {
        try {
          if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
        } catch { /* Detached controls may lose capture first. */ }
      }
    }
  };
  const off = input.onCancel(reset, life.signal);
  const sample = (e: PointerEvent) => {
    const id = active;
    const epoch = input.epoch;
    const bounds = element.getBoundingClientRect();
    const selected = select ? select(e.clientX - bounds.left, e.clientY - bounds.top, bounds.width, bounds.height) : actions;
    if (!disposed && id !== null && active === id && input.epoch === epoch) source.set(selected);
  };
  const listener = { signal: life.signal };
  element.addEventListener('pointerdown', e => {
    if (disposed || active !== null || doc.hidden || e.button !== 0 || e.pointerType !== 'touch') return;
    e.preventDefault();
    active = e.pointerId;
    try { element.setPointerCapture(e.pointerId); } catch { reset(); return; }
    try { sample(e); } catch (error) { reset(); throw error; }
  }, listener);
  element.addEventListener('pointermove', e => {
    if (e.pointerId !== active) return;
    if (e.buttons === 0) { reset(); return; }
    try { sample(e); } catch (error) { reset(); throw error; }
  }, listener);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    element.addEventListener(type, e => { if (e.pointerId === active) reset(); }, listener);
  }
  win?.addEventListener('blur', reset, listener);
  win?.addEventListener('pagehide', reset, listener);
  win?.addEventListener('resize', reset, listener);
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) reset(); }, listener);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const errors: unknown[] = [];
    try { reset(); } catch (error) { errors.push(error); }
    try { source.dispose(); } catch (error) { errors.push(error); }
    off();
    life.abort();
    signal.removeEventListener('abort', dispose);
    if (errors.length) throw new AggregateError(errors, 'pointer control release failed');
  };
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) dispose();
  return { dispose };
}
