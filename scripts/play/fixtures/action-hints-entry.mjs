// Exercises the public description API against a real compiled scene and dispatcher.
import {app, sceneContext} from './hud-entry.mjs';
import {actionOf} from '../../../src/author/ids.ts';
await window.hudBoot;
while (!sceneContext()) await new Promise(requestAnimationFrame);
const hint = document.createElement('output');
hint.className = 'action-hint-diagnostic';
hint.style.cssText =
  'position:absolute;bottom:8px;left:8px;right:8px;padding:8px;pointer-events:none;color:white;background:#18212d;font:16px sans-serif;overflow-wrap:anywhere;';
sceneContext().view.overlay.append(hint);
const describe = () => sceneContext().input.describe('hud-details');
// This fixture supports two declared keys and standard pad positions; it is not a universal glyph formatter.
const render = () => {
  const ctx = sceneContext(),
    d = describe();
  hint.textContent = d
    ? ctx.text('game.hint.summary', {
        action: ctx.text(d.labelKey),
        keys: d.keys
          .map(k =>
            k === 'code:KeyU' ? ctx.text('game.hint.keyU') : k === 'code:KeyI' ? ctx.text('game.hint.keyI') : k,
          )
          .join(', '),
        pad: d.pad
          .map(p => (p === 'x' ? ctx.text('game.hint.west') : p === 'y' ? ctx.text('game.hint.north') : p))
          .join(', '),
      })
    : '';
};
const saved = new URLSearchParams(location.search).get('savedControls') === 'player';
const set = value => {
  if (saved) app.services.controlsSettings.set(value);
  else app.services.input.setOverrides(value);
  render();
};
window.hintCheck = {
  describe,
  render,
  savedStatus: () => (saved ? app.services.controlsSettings.status() : null),
  player: () => app.services.save.activePlayer(),
  addPlayer: () => app.services.save.addPlayer('Diagnostic other player'),
  usePlayer: id => app.services.save.setActivePlayer(id),
  unknown: () => sceneContext().input.describe('missing'),
  axis: () => sceneContext().input.describe('move'),
  remap: () => set({[actionOf('hud-details')]: {keys: ['code:KeyU'], pad: ['x']}}),
  reset: () => {
    if (saved) app.services.controlsSettings.reset();
    else app.services.input.setOverrides({});
    render();
  },
};
render();
