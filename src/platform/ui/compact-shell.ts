import type { Shell } from './shell';
import type { LayerHandle, LayerManager } from './layers';

const contentOwners = new WeakMap<HTMLElement, object>();

/** Optional presentation of the existing registry; no second control/action inventory. */
export function compactShellMenu(options: {
  menu: HTMLDetailsElement; layers: LayerManager; signal: AbortSignal;
  closeLabel: string; cancelInput(): void;
}): { close(): void; dispose(): void } {
  const { menu, layers, signal } = options;
  const doc = menu.ownerDocument;
  const trigger = menu.querySelector<HTMLElement>('summary')!;
  const content = menu.querySelector<HTMLElement>('.shell-menu-content')!;
  const identity = {};
  contentOwners.set(content, identity);
  const panel = doc.createElement('section');
  panel.className = 'shell-compact-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', trigger.textContent ?? '');
  const closeButton = doc.createElement('button');
  closeButton.type = 'button'; closeButton.textContent = options.closeLabel;
  closeButton.className = 'shell-compact-close';
  const life = new AbortController();
  let layer: LayerHandle | null = null;
  let disposed = false;
  let opening = false;
  let cancelledOpening = false;
  const restore = () => {
    layer = null;
    if (contentOwners.get(content) === identity) {
      menu.append(content);
      if (!disposed) trigger.setAttribute('aria-expanded', 'false');
    }
    panel.remove();
  };
  const close = () => { if (opening) cancelledOpening = true; layer?.close('exit'); };
  const dispose = () => {
    if (disposed) return;
    disposed = true; life.abort();
    menu.classList.remove('shell-menu-compact');
    trigger.removeAttribute('aria-haspopup'); trigger.removeAttribute('aria-expanded');
    signal.removeEventListener('abort', dispose);
    const acquired = layer;
    restore(); // A replacement must find the rows even while layers.open has not returned.
    if (opening) cancelledOpening = true;
    acquired?.close('exit');
  };
  menu.classList.add('shell-menu-compact');
  trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', event => {
    event.preventDefault();
    if (disposed || layer || opening) return;
    opening = true; cancelledOpening = false;
    try {
      options.cancelInput();
      if (disposed || cancelledOpening) return;
      menu.open = false;
      panel.append(content, closeButton); doc.body.append(panel);
      trigger.setAttribute('aria-expanded', 'true');
      const opened = layers.open({ id: 'shell.compact-menu', kind: 'modal', element: panel, cover: 'scrim', modal: 'page',
        initialFocus: () => content.querySelector<HTMLElement>('button') ?? closeButton,
        returnFocus: () => trigger.isConnected ? trigger : null,
        onClose: restore,
      });
      layer = opened.closed ? null : opened;
      if (disposed || cancelledOpening) close();
    } catch (error) { restore(); throw error; } finally { opening = false; }
  }, { signal: life.signal });
  // Close before a row's own handler opens another surface; its existing handler remains intact.
  panel.addEventListener('click', event => {
    if ((event.target as Element).closest('button')) close();
  }, { capture: true, signal: life.signal });
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) dispose();
  return { close, dispose };
}


type CompactOptions = Omit<Parameters<typeof compactShellMenu>[0], 'menu'>;
type CompactRegistration = {
  disposed: boolean;
  controller?: ReturnType<typeof compactShellMenu>;
  stop?: () => void;
  dispose(): void;
};
const registrations = new WeakMap<Shell, CompactRegistration>();

/** Loading and lifecycle are paid only by compositions selecting the compact presentation. */
export function configureCompactShell(shell: Shell, options: CompactOptions): { close(): void; dispose(): void } {
  options = { ...options }; // Own the selected lifetime and callbacks even before the menu exists.
  const previous = registrations.get(shell);
  const registration: CompactRegistration = {
    disposed: false,
    dispose() {
      if (registration.disposed) return;
      registration.disposed = true;
      registration.stop?.();
      options.signal.removeEventListener('abort', registration.dispose);
      if (registrations.get(shell) === registration) registrations.delete(shell);
      registration.controller?.dispose();
    },
  };
  registrations.set(shell, registration);
  previous?.dispose();
  if (registrations.get(shell) === registration && !options.signal.aborted) {
    options.signal.addEventListener('abort', registration.dispose, { once: true });
    try {
      const stop = shell.onMenu(menu => {
        if (registration.disposed || registrations.get(shell) !== registration) return;
        const controller = compactShellMenu({ ...options, menu });
        registration.controller = controller;
        if (registration.disposed) controller.dispose();
      });
      registration.stop = stop;
      if (registration.disposed) stop();
    } catch (error) { registration.dispose(); throw error; }
  } else registration.dispose();
  return { close: () => { if (!registration.disposed) registration.controller?.close(); }, dispose: registration.dispose };
}
