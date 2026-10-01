import "../../src/app/styles.ts";
import "../replication-workbench/style.css";
import { createApp } from "../../src/core/app.ts";
import { appFeatures } from "../../src/core/settings/app-features.ts";
import { layerModules } from "../../src/app/layer-modules.ts";
import { compileGame } from "../../src/author/compile.ts";
import {
  defineBuild,
  defineGame,
  defineScene,
  defineSystem,
  Name,
  Transform,
  Shape,
} from "../../src/author/index.ts";
import { createTestApi } from "../../src/dev/test-api.ts";
import { appLayers } from "../../src/platform/ui/runtime.ts";
import { createBrowserTransport } from "../../src/platform/network/browser-transport.ts";
import { createPrediction } from "../../src/kits/network/index.ts";

const el = (id) => document.getElementById(id);
const integer = (value) =>
  typeof value === "number" && Number.isSafeInteger(value);
const input = (value) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === 1 &&
  integer(value.add) &&
  Math.abs(value.add) <= 10;
const identity = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= 256;
const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === keys.sort().join(",");
const limits = {
  state: { maxBytes: 64, maxNodes: 1, maxDepth: 1 },
  input: { maxBytes: 128, maxNodes: 4, maxDepth: 2 },
  maxPending: 8,
  maxPendingBytes: 1024,
  maxReplaySteps: 8,
};
let context,
  transport,
  prediction,
  credential = null,
  session = null,
  epoch = null,
  principal = null;
let eligible = false,
  cover = null,
  status = "Disconnected",
  lastCommand = null,
  lastResult = null;
let markers = [],
  projectionKey = "",
  displayKey = "",
  frames = 0,
  rendered = 0;
const timings = { count: 0, totalMs: 0, maxMs: 0 };
const sentCommands = new Map();
const baselines = { reconciled: 0, duplicate: 0, obsolete: 0, foreign: 0 };
function hide(hidden) {
  for (const canvas of el("app").querySelectorAll("canvas"))
    canvas.style.visibility = hidden ? "hidden" : "";
}
function clearMarkers() {
  if (context) for (const entity of markers) context.world.despawn(entity);
  markers = [];
  projectionKey = "";
  hide(true);
}
function project() {
  const facts = prediction?.read();
  if (!eligible || facts?.status !== "ready") {
    clearMarkers();
    return;
  }
  const values = [facts.confirmed.state.value, facts.predicted.value];
  const key = JSON.stringify(values);
  const extent = Math.max(10, ...values.map(Math.abs));
  el("scale").textContent = `World span: −${extent} to +${extent}`;
  if (key === projectionKey) return;
  hide(true);
  for (let index = 0; index < 2; index++) {
    const init = [
      Name({ name: index ? "predicted-marker" : "confirmed-marker" }),
      Transform({ x: (values[index] / extent) * 5, y: 0.5, z: index * 2 }),
      Shape({
        kind: "box",
        size: [0.8, 1, 0.8],
        color: index ? 0xe7bd67 : 0x75cabb,
      }),
    ];
    if (markers[index] === undefined)
      markers[index] = context.world.spawn(...init);
    else
      for (const component of init)
        context.world.add(markers[index], component);
  }
  projectionKey = key;
}
function render() {
  const facts = prediction?.read();
  const key = JSON.stringify([eligible, status, principal, facts, lastResult]);
  if (key === displayKey) return;
  displayKey = key;
  el("status").textContent = principal
    ? `${principal} · ${facts?.status ?? "awaiting baseline"}`
    : status;
  el("result").textContent = lastResult
    ? `${status} · last result: ${lastResult.status}`
    : status;
  el("confirmed").textContent = facts?.confirmed
    ? String(facts.confirmed.state.value)
    : "—";
  el("predicted").textContent = facts?.predicted
    ? String(facts.predicted.value)
    : "—";
  el("pending").textContent = String(facts?.pending.length ?? 0);
  el("correction").textContent = facts?.correction
    ? `${facts.correction.changed ? "Changed" : "Unchanged"} / ${facts.correction.replayed}`
    : "—";
  el("connect").disabled = !eligible;
  for (const id of ["predict", "send-next", "retry"])
    el(id).disabled = !eligible || facts?.status !== "ready";
  project();
}
function retire(reason) {
  prediction?.dispose();
  prediction = null;
  transport?.dispose();
  transport = null;
  credential = null;
  session = null;
  epoch = null;
  principal = null;
  lastCommand = null;
  lastResult = null;
  sentCommands.clear();
  status = reason;
  clearMarkers();
  render();
}
function transmit(frame) {
  if (!eligible || !transport) return false;
  const outcome = transport.send(JSON.stringify(frame));
  if (outcome.status !== "sent") {
    status = "Send refused; retain exact pending input for retry";
    render();
    return false;
  }
  return true;
}
function sendCommand(command) {
  if (!command || !session || !epoch) return;
  if (!sentCommands.has(command.sequence) && sentCommands.size >= 9) {
    status = "Outgoing correlation capacity; await a result";
    render();
    return;
  }
  lastCommand = { sequence: command.sequence, json: command.json };
  if (
    transmit({
      v: 1,
      type: "command",
      session,
      epoch,
      sequence: command.sequence,
      inputJson: command.json,
    })
  )
    sentCommands.set(command.sequence, command.json);
}
function receive(raw) {
  const frame = JSON.parse(raw);
  if (!session) {
    if (
      !exact(frame, ["v", "type", "principal", "session", "epoch"]) ||
      frame.v !== 1 ||
      frame.type !== "authenticated" ||
      !["a", "b"].includes(frame.principal) ||
      !identity(frame.session) ||
      !identity(frame.epoch)
    )
      throw Error("authentication frame");
    ({ principal, session, epoch } = frame);
    status = "Waiting for coherent baseline";
    return;
  }
  if (
    !frame ||
    frame.v !== 1 ||
    frame.session !== session ||
    frame.epoch !== epoch
  )
    throw Error("stale control frame");
  if (frame.type === "result") {
    const permitted = [
      "v",
      "type",
      "session",
      "epoch",
      "sequence",
      "status",
      "revision",
      "resultJson",
    ];
    if (
      Object.keys(frame).some((k) => !permitted.includes(k)) ||
      !integer(frame.sequence) ||
      frame.sequence < 1 ||
      ![
        "committed",
        "duplicate",
        "refused",
        "busy",
        "unknown",
        "unavailable",
        "retired",
        "result-unavailable",
        "conflict",
        "gap",
        "exhausted",
      ].includes(frame.status) ||
      (frame.revision !== undefined &&
        (!integer(frame.revision) || frame.revision < 0)) ||
      (frame.resultJson !== undefined &&
        (typeof frame.resultJson !== "string" || frame.resultJson.length > 512))
    )
      throw Error("result frame");
    if (!sentCommands.has(frame.sequence))
      throw Error("unsolicited command result");
    const terminal =
      frame.status === "committed" || frame.status === "duplicate";
    if (terminal) {
      if (
        !exact(frame, [
          "v",
          "type",
          "session",
          "epoch",
          "sequence",
          "status",
          "revision",
          "resultJson",
        ]) ||
        !integer(frame.revision) ||
        frame.revision < frame.sequence ||
        typeof frame.resultJson !== "string"
      )
        throw Error("terminal result");
      const result = JSON.parse(frame.resultJson);
      if (!exact(result, ["value"]) || !integer(result.value))
        throw Error("result payload");
    } else if (
      !exact(frame, ["v", "type", "session", "epoch", "sequence", "status"])
    )
      throw Error("refusal result");
    sentCommands.delete(frame.sequence);
    lastResult = {
      sequence: frame.sequence,
      status: frame.status,
      revision: frame.revision ?? null,
    };
    status = "Result received; baseline controls reconciliation";
    return;
  }
  if (
    !exact(frame, [
      "v",
      "type",
      "session",
      "epoch",
      "revision",
      "processedThrough",
      "stateJson",
    ]) ||
    frame.type !== "baseline" ||
    !integer(frame.revision) ||
    frame.revision < 0 ||
    !integer(frame.processedThrough) ||
    frame.processedThrough < 0 ||
    frame.processedThrough > frame.revision ||
    typeof frame.stateJson !== "string" ||
    frame.stateJson.length > 64
  )
    throw Error("baseline frame");
  const begin = performance.now();
  if (!prediction) {
    prediction = createPrediction({
      epoch,
      baseline: frame,
      limits,
      validateState: integer,
      validateInput: input,
      reduce: (state, command) => JSON.stringify(state + command.add),
    });
    status = "Trusted baseline adopted";
  } else {
    const outcome = prediction.reconcile(frame);
    if (Object.hasOwn(baselines, outcome.status)) baselines[outcome.status]++;
    status = `Baseline ${outcome.status}`;
  }
  const ms = performance.now() - begin;
  timings.count++;
  timings.totalMs += ms;
  timings.maxMs = Math.max(timings.maxMs, ms);
}
const poll = defineSystem({
  id: "authority-intake",
  phase: "frame",
  run() {
    frames++;
    if (!eligible || !transport) return;
    if (transport.read().state === "open" && credential !== null) {
      const token = credential;
      credential = null;
      transmit({ v: 1, type: "auth", token });
    }
    for (const raw of transport.drain(2)) {
      try {
        receive(raw);
      } catch {
        retire("Invalid authority frame; reconnect required");
        break;
      }
    }
    if (transport?.read().state === "closed")
      retire("Connection ended; reconnect required");
    render();
  },
});
const sample = defineScene({
  id: "sample",
  title: "Durable authority",
  systems: [poll],
  view: {
    camera: { position: [8, 7, 12], target: [1, 0, 1] },
    background: 0x172738,
  },
  enter(ctx) {
    context = ctx;
    eligible = false;
    displayKey = "";
    ctx.world.spawn(
      Name({ name: "local-ground" }),
      Transform({ x: 0, y: -0.1, z: 1 }),
      Shape({ kind: "box", size: [13, 0.2, 6], color: 0x355065 }),
    );
    el("exit").disabled = false;
    el("return").disabled = true;
    render();
  },
  activity(_ctx, facts) {
    eligible =
      facts.phase === "active" &&
      facts.coverage === "top" &&
      !facts.documentHidden;
    if (!eligible) retire("Scene control retired; reconnect required");
    render();
  },
  rendered() {
    rendered++;
    if (eligible && prediction?.read().status === "ready") hide(false);
  },
  exit() {
    eligible = false;
    retire("Scene retired");
    context = null;
    cover?.close("owner-left");
    cover = null;
  },
});
const retired = defineScene({
  id: "retired",
  title: "Retired authority",
  view: { background: 0x172738 },
  enter(ctx) {
    context = ctx;
    eligible = false;
    el("exit").disabled = true;
    el("return").disabled = false;
    render();
  },
  exit() {
    context = null;
  },
});
el("connect").addEventListener("click", () => {
  if (!eligible || !context) return;
  retire("Connecting");
  credential = el("credential").value;
  el("credential").value = "";
  try {
    transport = createBrowserTransport({
      url: el("endpoint").value,
      limits: {
        maxMessageBytes: 4096,
        maxQueuedMessages: 8,
        maxQueuedBytes: 32768,
        maxBufferedBytes: 4096,
      },
    });
  } catch {
    credential = null;
    status = "Invalid endpoint";
  }
  render();
});
el("disconnect").addEventListener("click", () => retire("Disconnected"));
el("predict").addEventListener("click", () => {
  const add = Number(el("amount").value);
  if (!eligible || !prediction || !integer(add) || Math.abs(add) > 10) return;
  const result = prediction.push(JSON.stringify({ add }));
  status = `Input ${result.status}`;
  if (result.status === "predicted" && !el("hold-send").checked)
    sendCommand(result.input);
  render();
});
el("send-next").addEventListener("click", () =>
  sendCommand(prediction?.read().pending[0]),
);
el("retry").addEventListener("click", () => sendCommand(lastCommand));
el("cover-open").addEventListener("click", () => {
  if (!eligible || cover) return;
  const element = el("cover");
  element.hidden = false;
  cover = appLayers(document).push({
    id: "authority-cover",
    kind: "modal",
    element,
    cover: "scrim",
    modal: "page",
    initialFocus: () => el("cover-close"),
    returnFocus: () => el("connect"),
    onClose: () => {
      element.hidden = true;
      cover = null;
    },
  });
});
el("cover-close").addEventListener("click", () => cover?.close("close"));
el("exit").addEventListener("click", () => context?.scene.goto("retired"));
el("return").addEventListener("click", () => context?.scene.goto("sample"));
window.addEventListener("pagehide", () => retire("Page retired"));
const brief = defineBuild({
  goal: "Observe durable commands and optional bounded prediction",
  pitch: "Durable authority diagnostic",
  genre: "diagnostic",
  coreLoop: ["Predict", "Commit", "Correct", "Recover"],
  devices: {
    targets: ["desktop"],
    minimum: "desktop",
    input: ["keyboard", "pointer"],
  },
  success: [
    {
      id: "S1",
      check:
        "Exact retries preserve durable state and coherent baselines correct visible predictions",
      how: "playtest",
      by: "scripts/play/authority-workbench-check.mjs",
    },
  ],
});
const game = defineGame({
  id: "authority-workbench",
  version: "0.1.0",
  title: "Durable authority",
  firstScene: "sample",
});
const compiled = compileGame({ brief, game, defs: [sample, retired] });
const app = createApp([...layerModules(game, brief), ...compiled.modules], {
  mode: "test",
  flag: (id) => appFeatures().enabled(id),
  probes: true,
});
const booted = app.boot();
window.engine = createTestApi(app, booted);
window.authorityWorkbench = {
  read: () => ({
    principal,
    session,
    epoch,
    eligible,
    status,
    frames,
    rendered,
    prediction: prediction?.read() ?? null,
    lastResult,
    baselines: { ...baselines },
    timings: { ...timings },
    transport: transport?.read() ?? null,
  }),
  world: () =>
    context
      ? [...context.world.query()].map(([entity]) => ({
          entity,
          name: context.world.get(entity, Name)?.name ?? null,
          transform: context.world.get(entity, Transform) ?? null,
          shape: context.world.get(entity, Shape) ?? null,
        }))
      : [],
};
await booted;
