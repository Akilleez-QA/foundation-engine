/** Moving by physical key: Shift and Caps Lock change `e.key` but never `e.code`, so every held key finds its release. */
export type WalkDirection = 'up' | 'down' | 'left' | 'right';
export const walkKeys: Readonly<Record<string, WalkDirection>> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};
type Shortcut = {key: string; repeat?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean};
const plain = (e: Shortcut) => !e.ctrlKey && !e.metaKey && !e.altKey;
/** F: a view-focus shortcut (centre the view on the player's subject), whatever the letter case. */
export const isFocusViewKey = (e: Shortcut) => plain(e) && e.key.toLowerCase() === 'f';
type HoldKey = {code: string; repeat: boolean; preventDefault(): void};
type HoldButton = {onkeydown: unknown; onkeyup: unknown; onblur: unknown};
/** A focused hold-to-act button: Space or Enter presses, releasing it or leaving the button lets go. */
export function holdButtonKeys(button: HoldButton, press: () => void, release: () => void) {
  const hold = (e: HoldKey) => e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter';
  button.onkeydown = (e: HoldKey) => {
    if (!hold(e)) return;
    e.preventDefault();
    if (!e.repeat) press();
  };
  button.onkeyup = (e: HoldKey) => {
    if (!hold(e)) return;
    e.preventDefault();
    release();
  };
  button.onblur = release;
}
