import copyCatalog from './strings/graphics-button/en.json';
import {appI18n as copyI18n,t as copyText} from '../../core/i18n/app-i18n';
copyI18n.addCatalog('en',copyCatalog);
// platform/ui/graphics-button.ts: the settings menu's Graphics… button, installed at boot.
// The Graphics screen itself (graphics-screen.ts) is fetched and built on the first press, so it never weighs on the
// first-load bundle (ADR 0025). The button, its row and its scene in the menu are the same as before.
import { appShell, type ShellButtonDef } from './shell';

/** The button, as the screen has always made it. */
export function graphicsButton(doc: Document): HTMLButtonElement {
  const button = doc.createElement('button');
  button.setAttribute('type', 'button'); button.setAttribute('id', 'graphics-button'); button.setAttribute('aria-haspopup', 'dialog');
  button.textContent = copyText("engine.graphics-button.label");
  button.title = copyText("engine.graphics-button.hint");
  return button;
}

/** Its shell row in the settings menu. */
export const GRAPHICS_ROW = (element: HTMLButtonElement): ShellButtonDef => ({ id: 'shell.graphics', zone: 'menu', order: 70, element, level: 'detailed' });

/**
 * Adds the button to the settings menu; its first press loads the screen through `load` (which builds it around this
 * button) and every press opens it. A failed load is forgotten, so the next press tries again.
 */
export function installGraphicsButton(load: (button: HTMLButtonElement) => Promise<{ open(from?: HTMLElement | null): void }>, doc: Document = document): HTMLButtonElement {
  const button = graphicsButton(doc);
  let screen: Promise<{ open(from?: HTMLElement | null): void }> | null = null;
  button.addEventListener('click', () => {
    // Focus returns to what had it at the press (the screen may open a moment later, once loaded).
    const active = doc.activeElement as HTMLElement | null, from = active && active !== doc.body ? active : null;
    const pending = (screen ??= load(button));
    pending.then(s => s.open(from), error => { if (screen === pending) screen = null; console.error('The Graphics screen could not load.', error); });
  });
  appShell(doc).add(GRAPHICS_ROW(button));
  return button;
}
