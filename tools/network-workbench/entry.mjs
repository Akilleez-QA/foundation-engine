import '../../src/app/styles.ts';
import './style.css';
import { createApp } from '../../src/core/app.ts';
import { appFeatures } from '../../src/core/settings/app-features.ts';
import { layerModules } from '../../src/app/layer-modules.ts';
import { compileGame } from '../../src/author/compile.ts';
import {
  defineBuild,
  defineGame,
  defineScene,
  defineSystem,
  Name,
  Transform,
  Shape,
} from '../../src/author/index.ts';
import { createTestApi } from '../../src/dev/test-api.ts';
import { createBrowserTransport } from '../../src/platform/network/browser-transport.ts';

import { decodeResponse } from './client-protocol.mjs';

const el = (id) => document.getElementById(id);
const limits = {
  maxMessageBytes: 1024,
  maxQueuedMessages: 16,
  maxQueuedBytes: 8192,
  maxBufferedBytes: 4096,
};
let active = false;
let context,
  transport,
  pendingCredential = null,
  principal = null,
  value = null;
let actor = null,
  nextId = 0,
  frames = 0,
  lastFrame = null,
  lastSend = null;
let message = 'Disconnected',
  lastDisplay = '',
  lastProjection = '';
const pending = new Map();

function project() {
  if (!active || !context) return;
  const signature = JSON.stringify([principal, value]);
  if (signature === lastProjection) return;
  if (actor !== null) context.world.despawn(actor);
  actor = null;
  if (principal && value !== null) {
    const height = 0.5 + Math.min(value, 20) * 0.1;
    actor = context.world.spawn(
      Name({ name: `accepted:${principal}` }),
      Transform({ x: 1.5, y: height / 2 }),
      Shape({
        kind: 'box',
        size: [1.2, height, 1.2],
        color: principal === 'alpha' ? 0x75cabb : 0xe7bd67,
      }),
    );
  }
  lastProjection = signature;
}
function render() {
  const state = transport?.read().state ?? 'disconnected';
  const display = JSON.stringify([state, principal, value, message, active]);
  if (display === lastDisplay) return;
  el('status').textContent = principal ? `${principal} · ${state}` : state;
  el('result').textContent = message;
  el('send').disabled = !active || state !== 'open' || !principal;
  el('connect').disabled = !active;
  lastDisplay = display;
  project();
}
function retire(reason) {
  transport?.dispose();
  pendingCredential = null;
  principal = null;
  value = null;
  pending.clear();
  lastFrame = null;
  lastSend = null;
  message = reason;
  render();
}
function connect() {
  if (!active || !context) return;
  retire('Connecting');
  const token = el('credential').value;
  el('credential').value = '';
  try {
    transport = createBrowserTransport({ url: el('endpoint').value, limits });
    pendingCredential = token;
  } catch {
    message = 'Invalid endpoint';
  }
  render();
}
function receive(raw) {
  const frame = decodeResponse(raw, { principal, pending });
  if (frame.type === 'authenticated') {
    principal = frame.principal;
    el('target').value = principal;
    message = 'Authenticated; no command result yet';
  } else if (frame.type === 'result') {
    pending.delete(frame.id);
    value = frame.value;
    message = `Accepted value ${value}`;
  } else {
    if (frame.id !== undefined) pending.delete(frame.id);
    message = `Refused: ${frame.reason}`;
  }
  lastFrame = frame;
}
const poll = defineSystem({
  id: 'network-intake',
  phase: 'frame',
  run() {
    frames++;
    if (!transport) return;
    if (transport.read().state === 'open' && pendingCredential !== null) {
      const credential = pendingCredential;
      pendingCredential = null;
      lastSend = transport.send(
        JSON.stringify({ v: 1, type: 'auth', token: credential }),
      );
      if (lastSend.status !== 'sent')
        retire('Authentication transport refused');
    }
    for (const raw of transport.drain(4)) {
      try {
        receive(raw);
      } catch {
        retire('Invalid server response');
        break;
      }
    }
    if (transport.read().state === 'closed')
      retire(`Connection ended: ${transport.read().reason}`);
    render();
  },
});
const scene = defineScene({
  id: 'sample',
  title: 'Network connection',
  systems: [poll],
  view: {
    camera: { position: [6, 5, 8], target: [1, 0.5, 0] },
    background: 0x172738,
  },
  enter(ctx) {
    active = true;
    context = ctx;
    actor = null;
    lastProjection = '';
    lastDisplay = '';
    ctx.world.spawn(
      Transform({ y: -0.1 }),
      Shape({ kind: 'box', size: [7, 0.2, 5], color: 0x355065 }),
    );
    el('exit').disabled = false;
    el('return').disabled = true;
    render();
  },
  exit() {
    retire('Scene retired');
    active = false;
    context = null;
    actor = null;
    el('connect').disabled = true;
    el('send').disabled = true;
  },
});
const retired = defineScene({
  id: 'retired',
  title: 'Retired connection',
  view: { background: 0x172738 },
  enter(ctx) {
    context = ctx;
    render();
    el('exit').disabled = true;
    el('return').disabled = false;
  },
  exit() {
    context = null;
  },
});
el('connect').addEventListener('click', connect);
el('disconnect').addEventListener('click', () => retire('Disconnected'));
el('send').addEventListener('click', () => {
  if (
    !active ||
    !principal ||
    !transport ||
    pending.size >= 8 ||
    nextId === Number.MAX_SAFE_INTEGER
  )
    return;
  const id = `request-${++nextId}`;
  const target = el('target').value;
  lastSend = transport.send(
    JSON.stringify({
      v: 1,
      type: 'command',
      id,
      target,
      delta: Number(el('delta').value),
    }),
  );
  if (lastSend.status === 'sent') {
    pending.set(id, target);
    message = 'Awaiting host response';
  } else message = `Transport refused: ${lastSend.reason}`;
  render();
});
el('exit').addEventListener('click', () => context?.scene.goto('retired'));
el('return').addEventListener('click', () => context?.scene.goto('sample'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) retire('Suspended; reconnect explicitly');
});
window.addEventListener('pagehide', () => retire('Page retired'));
const brief = defineBuild({
  goal: 'Exercise authenticated scoped commands over real transport',
  pitch: 'Optional network diagnostic',
  genre: 'diagnostic',
  coreLoop: ['Connect', 'Authorize', 'Observe', 'Retire'],
  devices: {
    targets: ['desktop'],
    minimum: 'desktop',
    input: ['keyboard', 'pointer'],
  },
  success: [
    {
      id: 'S1',
      check:
        'Only an active authenticated principal can change its authorized target',
      how: 'playtest',
      by: 'scripts/play/network-workbench-check.mjs',
    },
  ],
});
const game = defineGame({
  id: 'network-workbench',
  version: '0.1.0',
  title: 'Network workbench',
  firstScene: 'sample',
});
const compiled = compileGame({ brief, game, defs: [scene, retired] });
const app = createApp([...layerModules(game, brief), ...compiled.modules], {
  mode: 'test',
  flag: (id) => appFeatures().enabled(id),
  probes: true,
});
const booted = app.boot();
window.engine = createTestApi(app, booted);
window.networkWorkbench = {
  read: () => ({
    principal,
    value,
    pending: pending.size,
    lastFrame,
    lastSend,
    message,
    frames,
    scene: context?.scene.id,
    transport: transport?.read() ?? null,
  }),
  world: () =>
    context
      ? [...context.world.query(Shape)].map(([entity, shape]) => ({
          name: context.world.get(entity, Name)?.name ?? null,
          shape,
        }))
      : [],
};
await booted;
