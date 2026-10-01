/**
 * platform/render/still-safe.ts: the one marker the change trackers honour (STD-REN-38; `change-tracker.ts`). Its own
 * module so that the art that marks its hooks (loaded everywhere) does not pull the trackers into first-load JS.
 */
type StillSafe = { stillSafe?: boolean };
/** Mark a hook (object/material `onBeforeRender`, `onBeforeShadow`, `onBeforeCompile`) or a render-target texture
 *  whose effect on the picture is fully described by state the scan already reads. Anything unmarked forces. */
export const stillSafe = <F extends object>(hook: F): F => { (hook as StillSafe).stillSafe = true; return hook; };
/** True for a hook marked with `stillSafe`. */
export const isStillSafe = (f: unknown): boolean => !!f && (f as StillSafe).stillSafe === true;
