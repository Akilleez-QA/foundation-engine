/**
 * dev/attach.ts: installs `window.engine` over the booted app. vite.config.ts injects this module into index.html for
 * the dev server and `vite build --mode test` only; no source file imports it (ADR 0026). app/main.ts runs first and
 * leaves its app in `enginePendingApp`; a later boot (HMR) calls `engineAttach` directly.
 */
import type {App, BootReport} from '../core/app';
import {appFeatures} from '../core/settings/app-features';
import {createTestApi, type EngineTestApi} from './test-api';
import {sessionOptionsFromSearch} from './session-recording';

declare global {
  interface Window {
    engine?: EngineTestApi;
  }
}

if (appFeatures().enabled('dev.test-api')) {
  const g = globalThis as {
    engineAttach?: (a: App, b: Promise<BootReport>) => void;
    enginePendingApp?: {app: App; booted: Promise<BootReport>};
  };
  g.engineAttach = (app, booted) => {
    window.engine = createTestApi(app, booted);
    autoRecord(window.engine);
  };
  if (g.enginePendingApp) {
    g.engineAttach(g.enginePendingApp.app, g.enginePendingApp.booted);
    delete g.enginePendingApp;
  }
}

/** `?session-record` starts the PERF-01 recorder at attach, so cold start is included (session-recording.ts). */
function autoRecord(engine: EngineTestApi): void {
  const options = sessionOptionsFromSearch(location.search);
  if (!options) return;
  try {
    engine.sessionRecorder(options);
  } catch (error) {
    console.warn('session-record: not started', error);
  }
}
