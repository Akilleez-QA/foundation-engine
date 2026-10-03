/** Largest travel, in CSS px, that still counts as a world tap in a 3D view. */
export const WORLD_TAP_SLOP = 12;
/** World taps, drags and launches start only from the primary button: a mouse's left button, a touch contact or a pen tip. Right, middle, back and forward never move, drag or launch. */
export const primaryPress = (e: {button: number}) => e.button === 0;
/** A press that travelled no farther than the slop between down and up. */
export const withinTap = (
  start: {x: number; y: number} | null | undefined,
  e: {clientX: number; clientY: number},
  slop = WORLD_TAP_SLOP,
) => !!start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= slop;
/** A move that reports no held buttons means the release happened where we could not hear it (outside the window, or a lost capture). */
export const pressReleased = (e: {buttons: number}) => e.buttons === 0;
/** Mac ctrl-click, two-finger clicks and Chrome Android long-presses must not open a menu over a game canvas. Uses the handler property so releaseCanvasHandlers drops it with the others. */
export function blockContextMenu(element: HTMLElement) {
  element.oncontextmenu = e => e.preventDefault();
}
