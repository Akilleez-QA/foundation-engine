/** Keep controller sampling out of startup until a standard-mapped controller is available. */
import type {ActionGamepadOptions} from './action-gamepad';
import type {PadLike} from './gamepad';

type Adapter = Pick<typeof import('./action-gamepad'), 'installActionGamepad'>;
export interface LazyActionGamepadOptions extends ActionGamepadOptions {
  load?: () => Promise<Adapter>;
  report?: (error: unknown) => void;
}

export function installLazyActionGamepad(o: LazyActionGamepadOptions): void {
  if (o.signal.aborted) return;
  let pending = false,
    installed = false,
    attempt: AbortController | undefined;
  const report = (error: unknown) => {
    try {
      o.report?.(error);
    } catch {
      /* Reporting cannot strand installation. */
    }
  };
  const abort = () => {
    try {
      attempt?.abort();
    } catch (error) {
      report(error);
    }
  };
  o.signal.addEventListener('abort', abort, {once: true});
  const start = () => {
    if (pending || installed || o.signal.aborted) return;
    pending = true;
    void Promise.resolve()
      .then(() => {
        if (o.signal.aborted) return undefined;
        return (o.load ?? (() => import('./action-gamepad')))();
      })
      .then(adapter => {
        if (!adapter || o.signal.aborted) return;
        attempt = new AbortController();
        adapter.installActionGamepad({...o, signal: attempt.signal});
        installed = true;
        o.win.removeEventListener('gamepadconnected', connected);
      })
      .catch(error => {
        abort();
        attempt = undefined;
        report(error);
      })
      .finally(() => {
        pending = false;
      });
  };
  const connected = (event: Event) => {
    const pad = (event as GamepadEvent).gamepad;
    if (pad?.connected && pad.mapping === 'standard') start();
  };
  o.win.addEventListener('gamepadconnected', connected, {signal: o.signal});
  try {
    const pads: readonly (PadLike | null)[] = o.getPads ? o.getPads() : (globalThis.navigator?.getGamepads?.() ?? []);
    if (Array.from(pads).some(pad => pad?.connected && pad.mapping === 'standard')) start();
  } catch (error) {
    report(error);
  }
}
