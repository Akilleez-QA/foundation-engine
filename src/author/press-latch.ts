/**
 * author/press-latch.ts: one scene visit's pressed actions and pointer press, addressed to lanes (STD-SIM-12).
 *
 * - A press is pending until the next fixed tick begins; that tick (all fixed systems in it) sees it, later ticks do
 *   not. A frame that runs zero fixed ticks (frame time below the step, or a resumed dt = 0 frame) keeps it pending.
 * - Per-frame systems, and reads outside the runner, see the presses that arrived since the previous frame ended.
 * - Retention is bounded by the visit and by cancellation: `clear()` (input/pointer cancellation, overlay, hidden tab,
 *   loss of input ownership, a frame that does not simulate) drops pending presses; the latch dies with the visit.
 *   A running fixed lane consumes a pending press within one step of frame time.
 */
const POINTER = Symbol('pointer');
type Key = string | typeof POINTER;
export interface PointerSource { x: number; y: number; down: boolean; pressed: boolean }

export function createPressLatch() {
  const pending = new Set<Key>(), frame = new Set<Key>(), tick = new Set<Key>();
  let lane: 'idle' | 'fixed' | 'frame' = 'idle';
  const has = (key: Key) => (lane === 'fixed' ? tick : frame).has(key);
  return {
    add(id: string) { pending.add(id); frame.add(id); },
    has: (id: string) => has(id),
    /** Lane-addressed view of the visit's pointer; `pressed` follows the same rules as actions. */
    pointer(source: PointerSource) {
      return {
        get x() { return source.x; }, get y() { return source.y; }, get down() { return source.down; },
        get pressed() { return has(POINTER); },
      };
    },
    pointerPressed() { pending.add(POINTER); frame.add(POINTER); },
    /** Runner hook: a fixed step begins and takes every pending press. */
    // Size guards: Set iteration and clear() allocate in V8 even when empty, and these run every tick.
    beginStep() { lane = 'fixed'; if (tick.size) tick.clear(); if (pending.size) { for (const k of pending) tick.add(k); pending.clear(); } },
    /** Runner hook: the per-frame lane begins. */
    beginFrameLane() { lane = 'frame'; if (tick.size) tick.clear(); },
    /** The frame ended: per-frame presses are spent; pending presses wait for a fixed tick. */
    endFrame() { lane = 'idle'; if (tick.size) tick.clear(); if (frame.size) frame.clear(); },
    clear() { pending.clear(); frame.clear(); tick.clear(); },
  };
}
export type PressLatch = ReturnType<typeof createPressLatch>;
