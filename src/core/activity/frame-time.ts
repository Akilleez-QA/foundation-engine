import {monotonicNow} from '../clock';
let current: number | undefined;
/** Milliseconds from the currently dispatching FrameInfo. Outside dispatch, event callers use monotonic time.
 * Never use this for profiling elapsed CPU time; it deliberately stays constant throughout a frame. */
export const frameNow = (): number => current ?? monotonicNow();
/** FrameLoop dispatch scope. Restore the previous timestamp after nested loops and thrown callbacks. */
export function withFrameTime<T>(milliseconds: number, run: () => T): T {
  const previous = current;
  current = milliseconds;
  try {
    return run();
  } finally {
    current = previous;
  }
}
