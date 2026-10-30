/**
 * app/main.ts: the composition root (ADR 0026, ADR 0036). It builds the app from app/modules.ts on the app-wide bus
 * and boots it. A module that fails is reported and left out; the rest of the app still boots. In DEV and test builds
 * the test API (dev/attach.ts, injected by vite.config.ts; nothing imports dev/) receives the booted app.
 */
import './styles';
import {createApp} from '../core/app';
import {appBus} from '../core/app-events';
import {appFeatures} from '../core/settings/app-features';
import {DEV, TEST_API} from '../core/env';
import {modules, moduleSources} from './modules';
import {game} from './game';

document.title = game.title;
const testApi = TEST_API && appFeatures().enabled('dev.test-api');
const app = createApp(modules, {
  mode: DEV ? 'dev' : 'prod',
  events: appBus,
  flag: id => appFeatures().enabled(id),
  probes: testApi,
  sourceOf: (_m, i) => moduleSources[i],
});
const booted = app.boot();
if (testApi) {
  const g = globalThis as {
    engineAttach?: (a: typeof app, b: typeof booted) => void;
    enginePendingApp?: {app: typeof app; booted: typeof booted};
  };
  if (g.engineAttach) g.engineAttach(app, booted);
  else g.enginePendingApp = {app, booted};
}
void booted.then(
  report => {
    if (report.modules.some(m => m.status !== 'installed')) console.warn('[engine] boot report', report);
  },
  error => {
    console.error('[engine] boot failed', error);
    void import('./boot-failure').then(
      m => m.showBootFailure(),
      e => console.error('[engine] boot failure card', e),
    );
  },
);
