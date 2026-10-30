/**
 * app/boot-failure.ts: what the player sees when the boot itself fails (a BootValidationError, such as two modules
 * with one id, or any other rejected boot). Honest degradation (STD-PRI-11): the page explains itself instead of
 * staying blank, and the error still goes to the console. The boot stopped before any module installed, so saved
 * data is untouched and "Reload" is a plain reload.
 */
import {t} from '../core/i18n/app-i18n';

export function showBootFailure(doc: Document = document): HTMLElement {
  const card = doc.createElement('div');
  card.className = 'boot-failure';
  card.setAttribute('role', 'alert');
  const part = (tag: string, text: string) => {
    const e = doc.createElement(tag);
    e.textContent = text;
    return e;
  };
  const retry = part('button', t('engine.shell.boot-retry')) as HTMLButtonElement;
  retry.type = 'button';
  retry.onclick = () => doc.defaultView?.location.reload();
  card.append(part('p', t('engine.shell.boot-failed')), part('p', t('engine.shell.boot-failed-text')), retry);
  doc.body.append(card);
  retry.focus({preventScroll: true});
  return card;
}
