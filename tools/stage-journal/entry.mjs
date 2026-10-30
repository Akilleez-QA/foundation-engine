import '../../src/app/styles.ts';
import '../authoring/style.css';
import {createApp} from '../../src/core/app.ts';
import {appFeatures} from '../../src/core/settings/app-features.ts';
import {layerModules} from '../../src/app/layer-modules.ts';
import {compileGame} from '../../src/author/compile.ts';
import {
  defineBuild,
  defineGame,
  defineScene,
  defineSaveSection,
  defineSystem,
  defineEntity,
  Name,
  Transform,
  Shape,
} from '../../src/author/index.ts';
import {createTestApi} from '../../src/dev/test-api.ts';
import {saveModule} from '../../src/core/save/module.ts';
import {browserPort} from '../../src/core/save/storage-port.ts';
import {hud, ui} from '../../src/kits/ui/index.ts';
import {createJournalController, initialEnvelope, parseEnvelope, storageKey} from './controller.mjs';
const section = defineSaveSection({
  id: 'journal.session',
  scope: 'device',
  initial: initialEnvelope(),
  parse: parseEnvelope,
});
const brief = defineBuild({
  goal: 'Show accepted staged work and coherent reward publication with truthful save feedback.',
  genre: 'diagnostic',
  pitch: 'An optional desktop journal consumer.',
  coreLoop: ['Perform', 'Review', 'Choose', 'Deliver'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']},
  success: [
    {
      id: 'S1',
      check: 'Accepted actions, explicit transitions and reward retry restore coherently.',
      how: 'playtest',
      by: 'scripts/play/stage-journal-check.mjs',
    },
  ],
});
const game = defineGame({
  id: 'stage-journal',
  version: '0.1.0',
  title: 'Staged journal',
  firstScene: 'sample',
  kits: [ui()],
});
const local = browserPort('local');
let denyWrites = false,
  controller,
  context,
  abort,
  observedStatus,
  saveHandle;
const port = {
  ...local,
  set(key, value) {
    if (denyWrites && key === storageKey) throw Error('Injected journal storage rejection');
    local.set(key, value);
  },
};
const el = id => document.getElementById(id);
function render(s = controller.state()) {
  const progress = s.view.progress[0],
    terminal = s.view.status === 'complete',
    active = s.view.status === 'active';
  observedStatus = s.saveStatus;
  el('stage').textContent = `Stage: ${s.view.stage}`;
  el('progress').textContent = `Accepted work: ${progress.count} / ${progress.target}`;
  const completion = terminal
    ? 'Run complete'
    : s.view.status === 'cancelled'
      ? 'Run cancelled'
      : s.view.ready
        ? 'Requirements ready — explicit choice required'
        : 'Run active';
  el('completion').textContent = completion;
  el('message').textContent = s.message;
  el('persistence').textContent = s.persistence;
  el('reward').textContent =
    `Reward quantity: ${s.reward} · Stored sample: ${s.blocker} · Receipt: ${s.receipt ? 'accepted' : 'pending'}`;
  el('capability').textContent = `Calibration capability: ${s.capability ? 'granted' : 'not granted'}`;
  el('start').disabled = !active || s.view.ready || !!s.pending;
  el('choose').disabled = !active || !s.view.ready;
  el('choose').textContent = s.view.stage === 'prepare' ? 'Continue to confirmation' : 'Finish run';
  el('deliver').disabled = !terminal;
  el('cancel').disabled = !active;
  el('free').disabled = !s.blocker;
  el('save').disabled = s.saveStatus === 'newer';
  const h = hud(context);
  h.line(
    'summary',
    `${s.view.stage}: ${progress.count}/${progress.target} · ${s.pending ? 'Action pending' : completion}`,
  );
  h.line('journal-state', completion, {importance: 'detail'});
  h.line('journal-reward', el('reward').textContent, {importance: 'detail'});
  h.line('journal-grant', el('capability').textContent, {importance: 'detail'});
  h.line('journal-storage', s.persistence, {importance: 'detail'});
}
const system = defineSystem({
  id: 'journal-work',
  phase: 'frame',
  run(ctx) {
    controller?.advance(ctx.time.t);
    if (controller && saveHandle.status() !== observedStatus) render();
  },
});
const subject = defineEntity({
  id: 'subject',
  components: [Name({name: 'subject'}), Transform({y: 0.5}), Shape({kind: 'box', size: [1, 1, 1], color: 0x75d8d0})],
});
const scene = defineScene({
  id: 'sample',
  title: 'Staged journal',
  systems: [system],
  entities: [subject],
  view: {camera: {position: [3, 3, 5], target: [0, 0.5, 0]}, background: 0x182332},
  enter(ctx) {
    context = ctx;
    abort = new AbortController();
    saveHandle = ctx.save(section);
    controller = createJournalController({
      saveHandle,
      now: ctx.time.t,
      hasEnvelope: () => port.get(storageKey) !== null,
      notify: render,
    });
    hud(ctx).present({mode: 'disclose', label: 'Open journal', closeLabel: 'Close journal'});
    for (const id of ['start', 'choose', 'deliver', 'free', 'cancel', 'save'])
      el(id).addEventListener('click', () => controller[id](), {signal: abort.signal});
    el('reload').addEventListener('click', () => location.reload(), {signal: abort.signal});
    render();
  },
  exit() {
    abort?.abort();
    controller?.dispose();
  },
});
const compiled = compileGame({brief, game, defs: [scene, section, system]});
const modules = layerModules(game, brief).map(m =>
  m.id === 'core.save'
    ? saveModule({
        namespace: game.id,
        build: 'stage-journal@0.1.0',
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
window.journal = {
  state: () => controller?.state(),
  failure(value) {
    denyWrites = value;
  },
  dispose() {
    app.dispose();
  },
};
await booted;
