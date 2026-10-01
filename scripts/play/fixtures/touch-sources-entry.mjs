import {app, sceneContext} from './hud-entry.mjs';
import {bindPointerControl} from '../../../src/platform/input/pointer-control.ts';
import {actionOf} from '../../../src/author/ids.ts';
await window.hudBoot;
while (!sceneContext()) await new Promise(requestAnimationFrame);
const life = new AbortController();
const buttons = [];
const contacts = [];
document.addEventListener('pointerdown', event => {
  contacts.push({type: event.pointerType, id: event.pointerId, target: event.target.id, button: event.button, primary: event.isPrimary});
  if (contacts.length > 8) contacts.shift();
}, {capture: true, signal: life.signal});
let detailsControl;
for (const [name, action, left] of [['movement', actionOf('move', 'positive'), 20], ['details', actionOf('touch-check'), 220]]) {
  const button = document.createElement('button');
  button.id = `touch-${name}`;
  button.textContent = name;
  Object.assign(button.style, {position: 'fixed', left: `${left}px`, bottom: '30px', width: '140px', height: '90px', zIndex: '100', touchAction: 'none', userSelect: 'none'});
  document.body.append(button);
  const control = bindPointerControl(button, {input: app.services.input, actions: [action], signal: life.signal});
  if (name === 'details') detailsControl = control;
  buttons.push(button);
}
window.touchCheck = {
  contacts: () => contacts.slice(),
  presses: () => sceneContext().state.touchPresses ?? 0,
  enableModal: () => {
    detailsControl.dispose();
    detailsControl = bindPointerControl(buttons[1], {input: app.services.input, actions: [actionOf('hud-details')], signal: life.signal});
  },
  held: () => app.services.input.held(actionOf('move', 'positive')),
  dispose: () => { life.abort(); for (const button of buttons) button.remove(); },
};
