import '../../src/app/styles.ts';
import './style.css';
import {createApp} from '../../src/core/app.ts';
import {appFeatures} from '../../src/core/settings/app-features.ts';
import {layerModules} from '../../src/app/layer-modules.ts';
import {compileGame} from '../../src/author/compile.ts';
import {defineBuild, defineGame, defineScene, defineSaveSection, defineSystem} from '../../src/author/index.ts';
import {createTestApi} from '../../src/dev/test-api.ts';
import {saveModule} from '../../src/core/save/module.ts';
import {browserPort} from '../../src/core/save/storage-port.ts';
import {initial, parseDocument, storageKey} from './document.mjs';
import {createProjection} from './projection.mjs';

const params = new URLSearchParams(location.search);
const viewOnly = params.get('mode') === 'view';
// View entry never imports the editing session/controller or mounts controls.
const editing = viewOnly ? null : await import('./controller.mjs');
const uiModule = viewOnly ? null : await import('./ui.mjs');
const local = browserPort('local');
let quotaFailure = false,
  readFailure = false;
const port = {
  ...local,
  get(key) {
    if (readFailure && key === storageKey) throw new DOMException('Injected read denial', 'SecurityError');
    return local.get(key);
  },
  set(key, bytes) {
    if (quotaFailure && key === storageKey) throw new DOMException('Injected quota failure', 'QuotaExceededError');
    local.set(key, bytes);
  },
};
const section = defineSaveSection({id: 'authoring.document', scope: 'device', initial, parse: parseDocument});
const brief = defineBuild({
  goal: 'Optionally author two generic objects using bounded preview, history and local save.',
  genre: 'diagnostic',
  pitch: 'A replaceable desktop manual-authoring demonstration.',
  coreLoop: ['Select', 'Preview', 'Commit', 'Save'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']},
  success: [
    {
      id: 'S1',
      check: 'Manual controls and headless commands preserve authored identity through save and reload.',
      how: 'playtest',
      by: 'scripts/play/authoring-check.mjs',
    },
  ],
});
const game = defineGame({id: 'manual-authoring', version: '0.1.0', title: 'Manual authoring', firstScene: 'sample'});
let controller, projection, ui, handle;
const reload = () => {
  const url = new URL(location.href);
  url.searchParams.set('reverse', params.get('reverse') === '1' ? '0' : '1');
  location.assign(url);
};
// Existing frame host observes external tool mutations; renderer skips unchanged worlds.
const sync = defineSystem({id: 'authoring-sync', phase: 'frame', run() {}});
const scene = defineScene({
  id: 'sample',
  title: 'Authored world',
  systems: [sync],
  view: {camera: {position: [9, 11, 13], target: [0, 0, 0], fov: 48}, background: 0x182332},
  enter(ctx) {
    handle = ctx.save(section);
    projection = createProjection(ctx.world, {reverse: params.get('reverse') === '1'});
    if (viewOnly) {
      projection.apply(handle.get());
      document.querySelector('#editor').remove();
      document.body.classList.add('view-mode');
      document.querySelector('#mode-note').textContent = ' · View only — editor omitted';
    } else {
      controller = editing.createController({
        value: handle.get(),
        saveHandle: handle,
        projection,
        hasEnvelope: () => {
          try {
            return port.get(storageKey) !== null;
          } catch {
            return false;
          }
        },
        notify: state => ui?.render(state),
      });
      ui = uiModule.mountEditor(document.querySelector('#editor'), {...controller, reload});
    }
  },
  exit() {
    ui?.dispose();
    controller?.dispose();
    if (!controller) projection?.dispose();
  },
});
const compiled = compileGame({brief, game, defs: [scene, section, sync]});
const modules = layerModules(game, brief).map(m =>
  m.id === 'core.save'
    ? saveModule({
        namespace: game.id,
        build: 'manual-authoring@0.1.0',
        storage: () => ({local: port, session: browserPort('session')}),
      })
    : m,
);
const app = createApp([...modules, ...compiled.modules], {
  mode: 'test',
  flag: id => appFeatures().enabled(id),
  probes: true,
});
const booted = app.boot();
window.engine = createTestApi(app, booted);
// Explicit diagnostic boundary injection: no private promise or global Storage patch.
window.authoring = {
  get commands() {
    return controller;
  },
  reload,
  state: () => controller?.state() ?? {value: handle?.get(), viewOnly: true},
  world: () => projection?.inspect(),
  failure(kind, enabled = true) {
    if (kind === 'quota') quotaFailure = enabled;
    else if (kind === 'read') readFailure = enabled;
    else if (kind === 'projection') projection.failNext();
    else throw Error('Unknown failure');
  },
  dispose() {
    app.dispose();
  },
};
await booted;
