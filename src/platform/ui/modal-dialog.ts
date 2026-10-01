/**
 * platform/ui/modal-dialog.ts: a shell `<dialog>` opened as a `modal` layer (, ADR 0020,
 * STD-RUN-20). Sound, Comfort, the guide and Reset open through it.
 *
 * - The layer is `kind: 'modal'`, `modal: 'page'`, `cover: 'scrim'`: the shell and every layer below turn inert, the
 *   top-down key traversal stops at it, and a scene underneath pauses per its tickers' `whenCovered` (
 *   decided by ADR 0015 and ADR 0032: only a preview layer, the Graphics screen, keeps the scene drawing).
 * - Tab and Shift+Tab wrap inside the dialog (`layers.cycleFocus` through the action dispatcher); Back (Escape) closes
 *   it once, and a held Escape closes nothing more; M mute stays an 'always' row, so it works inside it.
 * - Focus returns to the control that opened it. An opener inside a menu that has since closed (the settings menu closes
 *   when one of its buttons is pressed) is not rendered, so focus returns to that menu's `<summary>`, as the Graphics
 *   screen's does.
 * - The dialog is still shown with `showModal`, as the Graphics screen and the travel map are: the page's own
 *   `dialog:modal` readers (narration, the sound caption, `modalDialogAbove`, the traversal's DOM-modal context) keep
 *   seeing it until their own migration steps. The browser picks the first focus exactly as before.
 * - A native close (its × button, a form, the pad's B as a close request) closes the layer too; closing the layer
 *   closes the dialog.
 */
import type { LayerHandle, LayerInfo, LayerManager } from './layers';
import { appLayers } from './runtime';

export interface ModalDialogOptions {
  /** The layer id, `modal.<name>`. */
  id: string;
  /** Where focus starts. Default: where `showModal` put it (its first focusable, or an `autofocus` control). */
  initialFocus?: () => HTMLElement | null | undefined;
  /** The manager (tests). Default: the app's layers for the dialog's document. */
  layers?: LayerManager;
}

interface Opening { layer?: LayerHandle }
const open = new WeakMap<HTMLDialogElement, Opening>();
const watched = new WeakSet<HTMLDialogElement>();
const rendered = (e: HTMLElement | null | undefined): boolean => !!e && e.isConnected && e.getClientRects().length > 0;
/** The opener, else the summary of the closed `<details>` it sits in. */
function returnTarget(opener: HTMLElement | null): HTMLElement | null {
  if (!opener || rendered(opener)) return opener;
  const menu = opener.closest('details');
  const summary = menu && Array.from(menu.children).find(c => c.tagName === 'SUMMARY') as HTMLElement | undefined;
  return summary && rendered(summary) ? summary : opener;
}
const shown = (d: HTMLDialogElement) => (typeof d.showModal === 'function' ? d.open : d.hasAttribute('open'));

/** Open `dialog` as a modal layer. Opening one that is already open returns its layer. */
export function openModalDialog(dialog: HTMLDialogElement, o: ModalDialogOptions): LayerHandle {
  const live = open.get(dialog);
  if (live?.layer && !live.layer.closed) return live.layer;
  const doc = dialog.ownerDocument, layers = o.layers ?? appLayers(doc);
  // The opener is read before showModal moves focus into the dialog.
  const active = doc.activeElement as HTMLElement | null;
  const opener = active && active !== doc.body && !dialog.contains(active) ? active : null;
  if (!watched.has(dialog)) {
    watched.add(dialog);
    // The close event is queued as a task: one from an earlier closing can arrive after the dialog reopened, so only
    // a dialog that is really shut closes its layer.
    dialog.addEventListener('close', () => { if (!shown(dialog)) open.get(dialog)?.layer?.close('exit'); });
  }
  const opening: Opening = {};
  open.set(dialog, opening);
  let admitted: LayerInfo | undefined;
  const closeNative = () => {
    if (!shown(dialog)) return;
    if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
  };
  try {
    if (!shown(dialog)) {
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    }
    // Native focus can synchronously open a replacement before this layer exists.
    if (open.get(dialog) !== opening) {
      const replacement = open.get(dialog)?.layer;
      if (replacement) return replacement;
      throw Error('modal opening lost ownership');
    }
    const layer = layers.open({
      id: o.id, kind: 'modal', element: dialog, cover: 'scrim', modal: 'page',
      initialFocus: () => {
        // Capture the admitted identity before authored focus can replace it or throw.
        admitted = layers.stack().find(layer => layer.id === o.id && layer.element === dialog);
        return o.initialFocus ? o.initialFocus() : (dialog.contains(doc.activeElement) ? doc.activeElement as HTMLElement : null);
      },
      returnFocus: () => returnTarget(opener),
      onClose: () => {
        if (open.get(dialog) !== opening) return;
        open.delete(dialog); // Retire before native close or focus callbacks can reopen it.
        closeNative();
      },
    });
    opening.layer = layer;
    if (open.get(dialog) !== opening) layer.close('replaced');
    else if (layer.closed) {
      // A replacement callback can supersede this request before layer admission.
      open.delete(dialog);
      closeNative();
    }
    return layer;
  } catch (error) {
    const errors = [error];
    const ownsDialog = open.get(dialog) === opening;
    // open() may throw before returning a handle. Retire only this captured layer,
    // including a stale outer layer whose different-id replacement is now live.
    const owned = admitted ?? (ownsDialog ? layers.stack().find(layer => layer.id === o.id && layer.element === dialog) : undefined);
    try { if (owned) layers.close(owned, ownsDialog ? 'program' : 'replaced'); } catch (cleanup) { errors.push(cleanup); }
    if (open.get(dialog) === opening) {
      open.delete(dialog);
      try { closeNative(); } catch (cleanup) { errors.push(cleanup); }
    }
    if (errors.length > 1) throw new AggregateError(errors, 'modal opening failed');
    throw error;
  }
}
