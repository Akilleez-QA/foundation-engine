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
import {
  createClosePolicy,
  createDrainFollower,
  createRetrySchedule,
  DEFAULT_TERMINAL_CLOSE_REASONS,
  INTEGRITY_CLOSE_REASON,
} from '../../src/kits/network/index.ts';
import { createRng } from '../../src/core/rng.ts';
import { runRandom } from '../../src/core/run-random.ts';

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
// Optional paced reconnect (NW-04). Off unless the operator ticks the checkbox; a creator may omit or replace it.
const retryLimits = {
  baseMs: 250,
  capMs: 4000,
  maxAttempts: 5,
  budget: { capacity: 8, refillEveryMs: 15000 },
};
// Which validated host close reasons/codes end reconnecting. The stock default (credential refusal, protocol
// violation) applies while "Treat host refusals as final" is ticked; unticked, every loss is paced as transient.
// The opt-in integrity example's close reason (SEC-01) is added so a closed client does not reconnect-spam.
const closePolicy = createClosePolicy({
  terminalReasons: [...DEFAULT_TERMINAL_CLOSE_REASONS, INTEGRITY_CLOSE_REASON],
});
let lastClose = null;
let retry = null,
  reconnectCredential = null,
  reconnectEndpoint = null,
  budgetRetryAt = null,
  lastRetry = null,
  transportsOpened = 0;
// A dedicated jitter stream: never the scene's gameplay ctx.random(). `?seed=` replays it exactly; otherwise each
// tab gets an independent stream so separate clients do not retry in lockstep.
function retryRandom() {
  const seed = new URLSearchParams(location.search).get('seed');
  if (seed !== null && /^\d+$/.test(seed))
    return createRng(`network-workbench.reconnect:${seed}`).next;
  const stream = runRandom.stream('network-workbench.reconnect');
  return () => stream.next();
}
// Optional planned drain (NW-08). Off unless "Follow host drain notices" is ticked: then a notice stops new commands,
// the client closes once pending replies settle (or at the notice deadline) and waits for the host's announced return
// before the retry schedule paces a fresh, freshly authenticated attempt.
const drainLimits = { maxNoticeMs: 60000, maxReconnectAfterMs: 60000 };
let follower = null,
  lastNotice = null,
  plannedCloses = 0;
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
  const admits = follower?.admits() ?? true;
  const display = JSON.stringify([state, principal, value, message, active, admits]);
  if (display === lastDisplay) return;
  el('status').textContent = principal ? `${principal} · ${state}` : state;
  el('result').textContent = message;
  el('send').disabled = !active || state !== 'open' || !principal || !admits;
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
/** End any reconnect episode and forget the retained credential. Spent budget tokens are not refunded. */
function stopReconnect() {
  reconnectCredential = null;
  reconnectEndpoint = null;
  budgetRetryAt = null;
  retry?.cancel();
  follower?.reset();
}
/** Planned loss: hold until the host's announced return, then pace through the retry schedule as usual. */
function holdForDrain(reason, now) {
  retire(reason);
  const hold = follower.closed(now);
  plannedCloses++;
  if (hold.status === 'hold')
    message = `${reason}; host expected back in ${Math.max(0, Math.round(hold.untilMs - now))} ms`;
}
function openTransport(url, token) {
  try {
    transport = createBrowserTransport({ url, limits });
    pendingCredential = token;
    transportsOpened++;
    return true;
  } catch {
    message = 'Invalid endpoint';
    return false;
  }
}
function connect() {
  if (!active || !context) return;
  retire('Connecting');
  stopReconnect();
  lastClose = null;
  const token = el('credential').value,
    url = el('endpoint').value;
  el('credential').value = '';
  // Retained in memory only while automatic reconnect is armed; every attempt authenticates afresh.
  if (openTransport(url, token) && el('auto-reconnect').checked) {
    reconnectCredential = token;
    reconnectEndpoint = url;
  }
  render();
}
/** Ask the schedule when to try again; never reconnects synchronously and never resends commands. */
function scheduleReconnect(now) {
  if (!active || !retry || reconnectCredential === null) return;
  const result = retry.next(now);
  lastRetry = result;
  if (result.status === 'wait')
    message = `${message}; reconnect attempt ${result.attempt} in ${result.delayMs} ms`;
  else if (result.status === 'budget-empty') {
    budgetRetryAt = result.refillAtMs;
    message = 'Offline: retry budget empty; waiting for it to refill';
  } else {
    stopReconnect();
    message =
      result.status === 'exhausted'
        ? `Offline: ${result.attempts} reconnect attempts failed; connect explicitly`
        : 'Offline; connect explicitly';
  }
}
function lost(reason, now) {
  retire(reason);
  scheduleReconnect(now);
}
/** A remote close is untrusted input: only the transport's validated token/code reach the policy and the text. */
function closedByHost(read, now) {
  const remote = read.remoteClose;
  const terminal =
    el('final-refusals').checked && closePolicy.classify(remote) === 'terminal';
  lastClose = {
    code: remote?.code ?? null,
    reason: remote?.reason ?? null,
    class: terminal ? 'terminal' : 'transient',
  };
  const cause = remote?.reason ? `${read.reason}: ${remote.reason}` : read.reason;
  if (!terminal && follower?.read().state === 'draining') {
    holdForDrain(`Closed by host drain (${cause})`, now);
    return;
  }
  if (!terminal) {
    lost(`Connection ended: ${cause}`, now);
    return;
  }
  // A refusal will repeat on a fresh connection: stop, forget the credential, and wait for the operator.
  retire(`Refused by host (${cause}); connect explicitly`);
  stopReconnect();
}
function receive(raw, now) {
  const frame = decodeResponse(raw, { principal, pending });
  if (frame.type === 'drain') {
    lastNotice = frame;
    if (!el('follow-drain').checked) {
      message = `Host announced a ${frame.cause} drain (not followed)`;
      return;
    }
    const outcome = follower.notice(
      {
        cause: frame.cause,
        closeInMs: frame.closeInMs,
        reconnectAfterMs: frame.reconnectAfterMs,
      },
      now,
    );
    if (outcome.status === 'invalid') throw Error('drain bounds');
    if (outcome.status === 'draining' || outcome.status === 'updated')
      message = `Host ${frame.cause} drain: finishing ${pending.size} pending; no new commands`;
    lastFrame = frame;
    return;
  }
  if (frame.type === 'authenticated') {
    retry?.succeeded(now);
    // The follower is not reset here: a notice can precede `authenticated` in one batch, and the drain must stand.
    // A completed hold already cleared it (release), and explicit connect/stop paths reset it.
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
  run(ctx) {
    frames++;
    // The scene's own monotonic visit time; the schedule owns no timer.
    const now = ctx.time.t * 1000;
    const live = ['connecting', 'open'].includes(transport?.read().state);
    if (!live && follower?.release(now)) {
      if (reconnectCredential !== null && retry) scheduleReconnect(now);
      else message = 'Host drain over; connect explicitly';
    }
    if (!live && reconnectCredential !== null && retry) {
      if (budgetRetryAt !== null) {
        if (now >= budgetRetryAt) {
          budgetRetryAt = null;
          scheduleReconnect(now);
        }
      } else if (retry.due(now)) {
        if (openTransport(reconnectEndpoint, reconnectCredential))
          message = 'Reconnecting with fresh authentication';
        else stopReconnect();
      }
    }
    if (!transport) return;
    if (transport.read().state === 'open' && pendingCredential !== null) {
      const credential = pendingCredential;
      pendingCredential = null;
      lastSend = transport.send(
        JSON.stringify({ v: 1, type: 'auth', token: credential }),
      );
      if (lastSend.status !== 'sent')
        lost('Authentication transport refused', now);
    }
    for (const raw of transport.drain(4)) {
      try {
        receive(raw, now);
      } catch {
        // A protocol failure is not a transport loss: no automatic retry.
        retire('Invalid server response');
        stopReconnect();
        break;
      }
    }
    if (
      transport.read().state === 'open' &&
      follower?.read().state === 'draining' &&
      (pending.size === 0 || follower.closeDue(now))
    )
      // Cooperative close: replies to admitted commands have settled, or the notice ran out (outcome unknown, not resent).
      holdForDrain('Closed for planned host drain', now);
    if (transport.read().state === 'closed') closedByHost(transport.read(), now);
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
    // One schedule per scene visit; its budget spans every reconnect episode of this visit.
    retry = createRetrySchedule({ limits: retryLimits, random: retryRandom() });
    follower = createDrainFollower({ limits: drainLimits });
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
    stopReconnect();
    retry?.dispose();
    retry = null;
    follower?.dispose();
    follower = null;
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
el('disconnect').addEventListener('click', () => {
  retire('Disconnected');
  stopReconnect();
});
el('auto-reconnect').addEventListener('change', () => {
  if (!el('auto-reconnect').checked) stopReconnect();
});
el('send').addEventListener('click', () => {
  if (
    !active ||
    !principal ||
    !transport ||
    !(follower?.admits() ?? true) ||
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
  if (!document.hidden) return;
  retire('Suspended; reconnect explicitly');
  stopReconnect();
});
window.addEventListener('pagehide', () => {
  retire('Page retired');
  stopReconnect();
});
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
    // Never exposes the retained credential, only whether reconnect is armed.
    reconnect: {
      armed: reconnectCredential !== null,
      schedule: retry?.read() ?? null,
      last: lastRetry,
      budgetRetryAt,
      transportsOpened,
      lastClose,
    },
    drain: {
      follow: el('follow-drain').checked,
      state: follower?.read() ?? null,
      lastNotice,
      plannedCloses,
    },
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
