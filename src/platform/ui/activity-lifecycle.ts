/** Dispose a screen before its successor starts; a queued native close cannot
 * dispose a later generation of the same reusable activity.
 * The shell (activity-navigation.ts) reports each screen's entry and imminent leave by calling `activityEntered` and
 * `activityLeaving` (these were the dialog's `activity-enter` and `activity-before-leave` DOM events). */
type Hooks = {enter(): void; leave(): void};
const screens = new WeakMap<object, Set<Hooks>>();
/** The shell showed `dialog` (a new generation of the activity). */
export function activityEntered(dialog: object) {
  for (const h of [...(screens.get(dialog) ?? [])]) h.enter();
}
/** The shell is about to close `dialog` for another activity. */
export function activityLeaving(dialog: object) {
  for (const h of [...(screens.get(dialog) ?? [])]) h.leave();
}
export function onActivityLeave(dialog: EventTarget & {open: boolean}, cleanup: () => void) {
  let retired = !dialog.open;
  const hooks: Hooks = {
    enter: () => {
      retired = false;
    },
    leave: () => {
      if (retired) return;
      retired = true;
      cleanup();
    },
  };
  const close = () => {
    if (!dialog.open) hooks.leave();
  };
  let set = screens.get(dialog);
  if (!set) screens.set(dialog, (set = new Set()));
  set.add(hooks);
  dialog.addEventListener('close', close);
  return () => {
    hooks.leave();
    set.delete(hooks);
    dialog.removeEventListener('close', close);
  };
}
