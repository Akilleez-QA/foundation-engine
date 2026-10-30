import '../../src/app/styles.ts';
import './style.css';
import {createApp} from '../../src/core/app.ts';
import {appFeatures} from '../../src/core/settings/app-features.ts';
import {layerModules} from '../../src/app/layer-modules.ts';
import {compileGame} from '../../src/author/compile.ts';
import {defineBuild, defineGame, defineScene, defineSystem, Name, Transform, Shape} from '../../src/author/index.ts';
import {createTestApi} from '../../src/dev/test-api.ts';
import {appLayers} from '../../src/platform/ui/runtime.ts';
import {createBrowserTransport} from '../../src/platform/network/browser-transport.ts';
import {createViewReceiver} from '../../src/kits/network/index.ts';
import {createReplicaProjection, Replica} from './projection.mjs';

const el = id => document.getElementById(id);
const viewLimits = {
  maxBytes: 65536,
  maxNodes: 4096,
  maxDepth: 8,
  maxEntities: 64,
  maxIdentityLength: 256,
};
const transportLimits = {
  maxMessageBytes: 65536,
  maxQueuedMessages: 4,
  maxQueuedBytes: 131072,
  maxBufferedBytes: 65536,
};
let context, projection, transport, receiver, cover;
let principal = null,
  session = null,
  credential = null,
  credit = null,
  decoration = null;
let eligible = false,
  message = 'Disconnected',
  frames = 0,
  heldDecorationResult = null;
let activity = null,
  lastDisplay = '',
  failure = false;
let adoptionCount = 0,
  adoptionTotalMs = 0,
  adoptionMaxMs = 0;
const hideCanvas = hidden => {
  for (const canvas of el('app').querySelectorAll('canvas')) canvas.style.visibility = hidden ? 'hidden' : '';
};
function render() {
  const state = receiver?.read();
  const current = JSON.stringify({
    principal,
    session,
    message,
    eligible,
    state: state?.state,
    sequence: state?.sequence,
    fields: state?.view?.entities,
  });
  if (current === lastDisplay) return;
  lastDisplay = current;
  el('status').textContent = principal ? `${principal} · ${state?.state ?? 'waiting'}` : 'disconnected';
  el('result').textContent = message;
  el('fields').textContent = state?.view ? JSON.stringify(state.view.entities, null, 2) : '';
  el('connect').disabled = !eligible;
  el('refresh').disabled = !eligible || !session;
}
function retire(reason) {
  receiver?.dispose();
  receiver = null;
  transport?.dispose();
  projection?.clear();
  principal = null;
  session = null;
  credential = null;
  credit = null;
  decoration = null;
  heldDecorationResult = null;
  message = reason;
  hideCanvas(true);
  render();
}
function connect() {
  if (!eligible || !context) return;
  retire('Connecting');
  credential = el('credential').value;
  el('credential').value = '';
  try {
    transport = createBrowserTransport({
      url: el('endpoint').value,
      limits: transportLimits,
    });
  } catch {
    credential = null;
    message = 'Invalid endpoint';
  }
  render();
}
function transmit(frame) {
  if (!eligible || !transport) return false;
  const result = transport.send(JSON.stringify(frame));
  if (result.status !== 'sent') {
    retire('Transport unavailable');
    return false;
  }
  return true;
}
function acknowledge() {
  if (!credit || el('hold-credit').checked) return;
  const exact = credit;
  credit = null;
  transmit({
    v: 1,
    type: 'view-ack',
    session: exact.session,
    sequence: exact.sequence,
  });
}
function receive(raw) {
  if (!receiver) {
    const frame = JSON.parse(raw);
    if (
      !frame ||
      Object.keys(frame).length !== 4 ||
      frame.v !== 1 ||
      frame.type !== 'authenticated' ||
      !['alpha', 'beta'].includes(frame.principal) ||
      typeof frame.session !== 'string' ||
      !frame.session ||
      frame.session.length > 256
    )
      throw Error('authentication response');
    principal = frame.principal;
    session = frame.session;
    receiver = createViewReceiver({session, limits: viewLimits});
    message = 'Waiting for complete baseline';
    return;
  }
  const start = performance.now(),
    result = receiver.receive(raw),
    state = receiver.read();
  if (state.state === 'retired') {
    retire('Protocol failure; reconnect required');
    return;
  }
  if (result.status === 'accepted') {
    hideCanvas(true);
    const projected = projection.replace(state.view);
    if (projected.status !== 'projected') {
      receiver.invalidate('projection-failed');
      projection.clear();
      hideCanvas(true);
      message = 'Projection unavailable';
    } else {
      message = `View ${state.sequence}; world revision ${state.view.worldRevision}`;
    }
    const elapsed = performance.now() - start;
    adoptionCount++;
    adoptionTotalMs += elapsed;
    adoptionMaxMs = Math.max(adoptionMaxMs, elapsed);
  } else if (result.status === 'unavailable') {
    projection.clear();
    hideCanvas(true);
    message = 'Host view unavailable';
  }
  if (['accepted', 'unavailable', 'duplicate'].includes(result.status)) {
    credit = {session, sequence: state.sequence};
    acknowledge();
  }
}
const poll = defineSystem({
  id: 'replication-intake',
  phase: 'frame',
  run() {
    frames++;
    if (!eligible || !transport) return;
    if (transport.read().state === 'open' && credential !== null) {
      const token = credential;
      credential = null;
      transmit({v: 1, type: 'auth', token});
    }
    for (const raw of transport.drain(2)) {
      try {
        receive(raw);
      } catch {
        retire('Invalid server frame');
        break;
      }
    }
    if (transport.read().state === 'closed') retire('Connection ended; reconnect required');
    render();
  },
});
const sample = defineScene({
  id: 'sample',
  title: 'Scoped views',
  systems: [poll],
  view: {
    camera: {position: [9, 7, 11], target: [3, 0, 2]},
    background: 0x172738,
  },
  enter(ctx) {
    context = ctx;
    eligible = false;
    lastDisplay = '';
    projection = createReplicaProjection(ctx.world, {
      beforeWrite: (_id, index) => {
        if (failure && index === 1) throw Error('injected projection failure');
      },
    });
    ctx.world.spawn(
      Name({name: 'local-ground'}),
      Transform({x: 3, y: -0.1, z: 2}),
      Shape({kind: 'box', size: [9, 0.2, 8], color: 0x355065}),
    );
    el('exit').disabled = false;
    el('return').disabled = true;
    render();
  },
  activity(_ctx, facts) {
    activity = facts;
    eligible = facts.phase === 'active' && facts.coverage === 'top' && !facts.documentHidden;
    if (!eligible) retire('Suspended; reconnect for a fresh baseline');
    render();
  },
  rendered() {
    if (eligible && receiver?.read().state === 'ready') hideCanvas(false);
  },
  exit() {
    eligible = false;
    retire('Scene retired');
    projection?.dispose();
    projection = null;
    context = null;
    cover?.close('owner-left');
    cover = null;
  },
});
const retired = defineScene({
  id: 'retired',
  title: 'Retired scoped view',
  view: {background: 0x172738},
  enter(ctx) {
    context = ctx;
    eligible = false;
    el('exit').disabled = true;
    el('return').disabled = false;
    render();
  },
  exit() {
    context = null;
  },
});
el('connect').addEventListener('click', connect);
el('disconnect').addEventListener('click', () => retire('Disconnected'));
el('refresh').addEventListener('click', () => {
  if (session) transmit({v: 1, type: 'view-refresh', session});
});
el('release-credit').addEventListener('click', () => {
  el('hold-credit').checked = false;
  acknowledge();
});
el('fail-projection').addEventListener('change', () => {
  failure = el('fail-projection').checked;
});
el('hold-decoration').addEventListener('click', () => {
  decoration = projection?.prepareDecoration('entity-0') ?? null;
  heldDecorationResult = null;
});
el('release-decoration').addEventListener('click', () => {
  const callback = decoration;
  decoration = null;
  heldDecorationResult = callback?.() ?? false;
});
function openCover(mode) {
  if (!eligible || cover) return;
  const element = el('cover');
  element.dataset.mode = mode;
  element.hidden = false;
  cover = appLayers(document).push({
    id: 'replication-cover',
    kind: 'modal',
    element,
    cover: mode,
    modal: 'page',
    initialFocus: () => el('close-cover'),
    returnFocus: () => el('connect'),
    onClose: () => {
      element.hidden = true;
      cover = null;
    },
  });
}
el('cover-scrim').addEventListener('click', () => openCover('scrim'));
el('cover-opaque').addEventListener('click', () => openCover('opaque'));
el('close-cover').addEventListener('click', () => cover?.close('close'));
el('exit').addEventListener('click', () => context?.scene.goto('retired'));
el('return').addEventListener('click', () => context?.scene.goto('sample'));
window.addEventListener('pagehide', () => retire('Page retired'));
const brief = defineBuild({
  goal: 'Exercise scoped disclosure and complete view replacement',
  pitch: 'Optional scoped view diagnostic',
  genre: 'diagnostic',
  coreLoop: ['Connect', 'Disclose', 'Replace', 'Retire'],
  devices: {
    targets: ['desktop'],
    minimum: 'desktop',
    input: ['keyboard', 'pointer'],
  },
  success: [
    {
      id: 'S1',
      check: 'Only current complete authorized views appear and retired disclosure is cleared',
      how: 'playtest',
      by: 'scripts/play/replication-workbench-check.mjs',
    },
  ],
});
const game = defineGame({
  id: 'replication-workbench',
  version: '0.1.0',
  title: 'Scoped views',
  firstScene: 'sample',
});
const compiled = compileGame({brief, game, defs: [sample, retired]});
const app = createApp([...layerModules(game, brief), ...compiled.modules], {
  mode: 'test',
  flag: id => appFeatures().enabled(id),
  probes: true,
});
const booted = app.boot();
window.engine = createTestApi(app, booted);
window.replicationWorkbench = {
  read: () => ({
    principal,
    session,
    eligible,
    activity,
    message,
    frames,
    credit,
    heldDecorationResult,
    receiver: receiver?.read() ?? null,
    transport: transport?.read() ?? null,
    adoption: {
      count: adoptionCount,
      totalMs: adoptionTotalMs,
      maxMs: adoptionMaxMs,
    },
  }),
  world: () =>
    context
      ? [...context.world.query()].map(([entity]) => ({
          entity,
          name: context.world.get(entity, Name)?.name ?? null,
          replica: context.world.get(entity, Replica) ?? null,
          shape: context.world.get(entity, Shape) ?? null,
        }))
      : [],
};
await booted;
