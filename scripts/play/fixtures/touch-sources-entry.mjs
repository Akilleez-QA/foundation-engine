import {app, sceneContext} from './hud-entry.mjs';
import {bindPointerControl} from '../../../src/platform/input/pointer-control.ts';
import {actionOf} from '../../../src/author/ids.ts';
import {touchButton} from '../../../src/kits/ui/index.ts';
await window.hudBoot;
while (!sceneContext()) await new Promise(requestAnimationFrame);
const life = new AbortController();
const buttons = [];
const contacts = [];
document.addEventListener(
  'pointerdown',
  event => {
    contacts.push({
      type: event.pointerType,
      id: event.pointerId,
      target: event.target.id,
      button: event.button,
      primary: event.isPrimary,
    });
    if (contacts.length > 8) contacts.shift();
  },
  {capture: true, signal: life.signal},
);
let detailsControl;
for (const [name, action, left] of [
  ['movement', actionOf('move', 'positive'), 20],
  ['details', actionOf('touch-check'), 220],
]) {
  const button = document.createElement('button');
  button.id = `touch-${name}`;
  button.textContent = name;
  Object.assign(button.style, {
    position: 'fixed',
    left: `${left}px`,
    bottom: '30px',
    width: '140px',
    height: '90px',
    zIndex: '100',
    touchAction: 'none',
    userSelect: 'none',
  });
  document.body.append(button);
  const control = bindPointerControl(button, {input: app.services.input, actions: [action], signal: life.signal});
  if (name === 'details') detailsControl = control;
  buttons.push(button);
}
// The ui kit's held touch button over the scene overlay (shown here regardless of the emulated pointer media).
const holdButton = touchButton(sceneContext(), 'touch-hold', {
  label: 'Hold',
  show: 'always',
  inset: {right: 20, top: 120},
  signal: life.signal,
});
window.touchCheck = {
  holdState: () => ({
    presses: sceneContext().state.holdPresses ?? 0,
    ticks: sceneContext().state.holdTicks ?? 0,
    held: app.services.input.held(actionOf('touch-hold')),
    down: holdButton.element?.dataset.down !== undefined,
  }),
  contacts: () => contacts.slice(),
  presses: () => sceneContext().state.touchPresses ?? 0,
  enableModal: () => {
    detailsControl.dispose();
    detailsControl = bindPointerControl(buttons[1], {
      input: app.services.input,
      actions: [actionOf('hud-details')],
      signal: life.signal,
    });
  },
  held: () => app.services.input.held(actionOf('move', 'positive')),
  dispose: () => {
    life.abort();
    for (const button of buttons) button.remove();
  },
};
