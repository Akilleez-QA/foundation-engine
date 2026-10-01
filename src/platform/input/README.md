# `platform/input/`: the shared input layer

The input system (STANDARD STD-SYS-15, ADR 0044, ADR 0047). Game code reads **actions**, never `e.key`, `e.code`, buttons or wheel deltas. Registered action rows (`actions.ts`) are the extension point; the frame facade below (`createInput`) is what a mover or a view samples each frame.

## Registered application input

`inputModule` installs the action dispatcher and its app-owned standard-controller
poller on the existing frame loop. Authors read `ctx.input`; physical controller
positions pass through effective action bindings. The legacy frame facade documented
below is a separate compatibility API, not the registered dispatcher's poll source.
See ADR 0074 for coverage, neutral-state and device-support limits.

## Quick start (a mover)

```ts
import {createInput} from './input';

const abort = new AbortController();
const input = createInput({surface: renderer.domElement, signal: abort.signal, host, label: 'scene'});
input.bindMovePad(pad.querySelectorAll('button'), b => b.dataset.dir);   // an on-screen move pad

// In the frame tick, before the character and camera:
const f = input.sample(dt);
if (!f.mine) { stopWalking(); return; }     // another context (a panel, a modal) owns input
if (f.moveStarted) { route = []; settle = null; }
move(f.move);                               // {x: right, y: forward}, |move| ≤ 1, camera-relative
rig.look(f.look); for (const z of f.zoom) rig.zoom(z);
for (const t of f.taps) pickWorld(t.x, t.y);  // clientX/Y; raycast via getBoundingClientRect
if (f.pressed.has('back')) clearWalk();
for (const a of f.actions) if (a.action === 'cameraMode') rig.cycle(a.mode);
// Teardown: abort.abort() removes every listener and pops the mover's context.
```

`createInput` options: `surface` (the canvas), `signal`, optional `host` (mirrors native modal dialogs and `.view-covered` inside it into a modal context), `contexts` (share one `InputContextStack` between screens), `settings`, `bindings`, `pointer` (slop, tap time, look radians per px), `getPads`, and `win`/`doc`/`now` for tests.

## The frame

| Field | Meaning |
|---|---|
| `move` | Held keys (WASD and arrows by `code`), move-pad pointers and keys, the left stick. Diagonals are unit length. |
| `moveStarted` | A move source was freshly pressed since the last frame. |
| `look` | Radians this frame. `+x` turns the view right (scenes: `yaw -= look.x`), `+y` tilts it down (scenes: `elevation += look.y`). Drag is `.006`/`.004` rad per CSS px, the right stick 120°/70° per second, horizontal trackpad scroll `.005` rad per px. Sensitivity and invert settings are already applied. |
| `zoom` | `ZoomStep[]`, sorted by time. `notches` > 0 zooms **out** (toward Map). Sources: `wheel`, `trackpad`, `pinch`, `key`, `repeat` (key autorepeat or a held d-pad), `pad`. Each carries `t` (event time, ms) and, when the browser reports it, `momentum`. The rig does gesture segmentation, detents and gates; the input layer only normalises. |
| `actions`, `pressed` | Discrete presses since the last frame, latched so a sub-frame tap is never lost: `interact`, `back`, `cameraMode` (`mode`: `cycle` from V/View, `anchor` from R3), `recentre`, `pause`, `mute`, `slot1`–`slot6`. Each has `t` and `device`. |
| `taps` | World taps: at most 12 px of travel (16 px for touch) and 1.5 s. A drag or pinch is never a tap. |
| `cameraInput` | Look, zoom, camera mode or recentre happened (for the auto-follow hold-off). |
| `dragging`, `pinching`, `device` | Gesture state and the last-used device family. |
| `context`, `mine` | The top context. When another is on top the frame is empty and `mine` is false. |

## Bindings

- **Keyboard** (`keyboard.ts`, `defaultKeyBindings`). Movement by `code`: WASD and the arrows. Mnemonics by `key`, case-insensitive: M mute, V camera cycle, `+ = I` / NumpadAdd zoom in, `- _ O` / NumpadSubtract zoom out, C recentre, P pause, E, Enter and Space interact, Escape back, 1–6 quick slots. Toggles ignore repeat; key zoom repeats at most 8 notches a second. Ctrl, Meta and Alt chords are never consumed; IME and editable targets are ignored; a focused button owns Space and Enter. Held keys clear on blur, hidden, pagehide, pointer-lock and fullscreen changes, Meta keyup and every context change. After a clear, only a fresh press moves again. Autorepeat does not re-arm (AliasHeldInput's rule). `settings.singleKeyShortcuts=false` turns the character shortcuts off (WCAG 2.1.4).
- **Pointer** (`pointer.ts`). One recognizer per surface. The first pointer taps or drags to look, a second pinches (log-ratio notches after a 20 px latch), and further pointers are ignored. Lifting one pinch finger hands over to a one-finger drag with no jump. Only mouse `button 0`. The context menu and side-button navigation are suppressed. Every gesture ends on `pointercancel`, `lostpointercapture`, a move with `buttons===0`, blur, pagehide and hidden.
- **Wheel** (`wheel.ts`). Reads `deltaMode` first: a line is 16 px, a page is 0.9 × `innerHeight`. One notch is 100 px, clamped to ±1.5 per event. Ctrl+wheel without a physical Control key is a pinch at 0.45 z per e-fold (≈ 6.2 notches). Safari `gesture*` events are handled, with the double-zoom guard. The trackpad heuristic changes gain only (×0.8). Horizontal scroll turns the view.
- **Gamepad** (`gamepad.ts`). Polled inside `sample()`. Only primitives are kept between frames. Scaled radial dead zones: 0.18 for moving (linear) and 0.15 for looking (curve 1.6), outer 0.95. Buttons use .55/.45 hysteresis. A confirms (interact), B goes back, Start pauses, View cycles the camera, R3 cycles anchors, Y recentres. The d-pad zooms (first press `pad`, then after 400 ms every 150 ms as `repeat`); set `settings.dpad='move'` to move with it (large outdoor scenes usually do). LB zooms out and RB zooms in with either setting, repeating the same way. `settings.nintendoSwap` swaps A and B. A pad must be neutral after connect, reset or a context change before it counts. Disconnecting the active pad emits `pause`. `input.rumble(strength, ms)` is capped at 0.5 and 200 ms, and is feature-detected. `padFamily(id)` gives the glyph family.

## Contexts, overlays and menus

```ts
const layer = input.openLayer('modal', {element: panel, label: 'guide', onFrame: f => { if (f.pressed.has('back')) close(); }});
// ...
layer.pop();   // restores focus to the opener; held input was cancelled on push and on pop
```

- The stack order is `gameplay < viewer < ui < modal`. Every push and pop cancels held keys, pad pointers, drags and pinches, and requires the gamepad to return to neutral. Only the top context gets the frame.
- **Viewer** layers (viewpoints, inspectors, zoomable viewers) receive `move`, `look` and `zoom` through `onFrame`. The mover's frame is empty while one is open. This is how "the viewer owns the wheel" works.
- **ui/modal** layers trap Tab in `element` and focus its first control (or `initialFocus`). On pop, focus returns to the opener, or to `restoreFocus()` if the opener has gone. The d-pad, the left stick and the arrow keys move focus spatially (`ui-nav.ts`: the first move is immediate, then repeats at 380 ms and every 120 ms; `data-nav-up|down|left|right` selectors override). A clicks the focused control. B and Escape arrive as `back` in `onFrame`. Arrow keys stay native in text fields, ranges, selects and roving groups (`[role=toolbar]`, `[data-nav-native]` and so on). For native `showModal()` dialogs, which already handle Escape, don't close twice on `back`.
- A minigame's `ui`/`modal` layer can pass `stick: 'play'`: while it is on top the left stick arrives as `move`, the right stick as `look` and the bumpers as `zoom` in its `onFrame`, while the d-pad still moves menu focus, A clicks the focused control and B arrives as `back`. Call `input.syncDom()` before opening it over a DOM dialog so the observed `dom-modal` context sits underneath.
- `observeDomModals(stack, host)` (used by the `host` option) turns native modal dialogs, visible `[role=dialog]`/`[aria-modal]` overlays and `.view-covered` into a single `modal` context, so plain DOM overlays need no input code. `stack.owns(context)` says whether a context owns input.
- B on a covering overlay that no layer handles (a `dom-modal` context: a map overlay, a minigame card) dispatches a synthetic Escape `keydown` at its focused control, then closes a native `<dialog>` that is still open as Escape would. It never closes the screen that holds the mover. The keyboard reader ignores that synthetic event, so the prompts stay on the gamepad.
- `input.reset()` drops all held and in-flight input, for example when a scripted camera takes over.

## Device and prompts

`document.body.dataset.inputDevice` is `keyboard-mouse`, `touch` or `gamepad`, with a 500 ms dwell. Mouse movement alone switches only away from touch (24 px within 250 ms), never away from the gamepad: a Steam Deck trackpad moves the mouse. The gamepad counts only on button edges or a strong stick held for two frames. Style prompts with `[data-input-device=…]`, and read `input.gamepad.family` for glyphs.

Optional saved remaps are provided by `controls-settings-module.ts`, composed
explicitly with the existing input and save owners. See
[the saved controls guide](../../../docs/guides/controls-settings.md).

## Viewport changes during a contact

A window `resize` retires active contacts in `bindPointerControl`,
`attachPointer`, and author `bindScenePointer`, using their existing cancellation
owners. Capture and held/pressed gesture state clear; old moves/releases cannot
resume that contact. A fresh down is required against the new element geometry.
This includes orientation changes that emit window resize; it does not claim
visual-viewport-only events or physical-device acceptance. Already emitted discrete
actions are not undone. Existing blur, pagehide and pointer cancellation remain
unchanged. See the [regression receipt](../../../docs/verification/input-resize-20261001/README.md).
