/** Moving views yield to native modals and visible in-world dialog overlays. */
export function viewOwnsInput(host: HTMLElement): boolean {
  const doc = host.ownerDocument;
  // showModal() moves focus into the topmost modal, independently of DOM order.
  const focusedModal = doc.activeElement?.closest<HTMLDialogElement>('dialog:modal');
  const modals = doc.querySelectorAll<HTMLDialogElement>('dialog:modal');
  const modal = focusedModal ?? modals.item(modals.length - 1);
  if (modal && !modal.contains(host)) return false;
  const scope = modal ?? doc;
  for (const overlay of Array.from(scope.querySelectorAll<HTMLElement>('[role="dialog"],[aria-modal="true"]'))) {
    // An overlay that routes its input through a pushed layer (data-input-layer) is not a DOM modal to the mover.
    if (
      overlay === host ||
      overlay.contains(host) ||
      overlay.hidden ||
      overlay.hasAttribute('data-input-layer') ||
      !overlay.getClientRects().length
    )
      continue;
    const style = getComputedStyle(overlay);
    if (style.display !== 'none' && style.visibility !== 'hidden') return false;
  }
  return true;
}
