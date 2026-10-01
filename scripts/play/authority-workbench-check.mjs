#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync, fork } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "vite";
import { ROOT } from "./lib.mjs";
import { launch } from "../perf/bench-browser.mjs";
import { diagnosticReport } from "./diagnostic-report.mjs";
import { initializeAuthorityWorkbench } from "../../tools/authority-workbench/server.mjs";
const out = resolve(process.argv[2] ?? "playtest/authority-workbench");
mkdirSync(out, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), "foundation-authority-browser-"));
const secrets = new Set();
const redact = (value) => {
  let text = String(value);
  for (const secret of secrets) text = text.split(secret).join("[redacted]");
  return text;
};
const report = {
  revision: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim(),
  workingTreeDirty: !!execFileSync("git", ["status", "--porcelain"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim(),
  passed: false,
  errors: [],
  consoleErrors: [],
  screenshots: [],
  observations: [],
  wire: { a: [], b: [] },
  limitations: [
    "Two desktop Chromium contexts and separate loopback host; no WAN, physical-device, production identity or scale certification.",
    "SIGKILL and independent SQLite readback cover process crashes, not physical power loss. Marker positions share an explicit dynamic scale; exact numeric values remain visible.",
  ],
};
const evidence = diagnosticReport(report, resolve(out, "report.json"));
let host, server, browser, secondContext;
function childHost() {
  const child = fork(
    resolve(ROOT, "tools/authority-workbench/server.mjs"),
    [],
    {
      cwd: ROOT,
      env: { ...process.env, AUTHORITY_WORKBENCH_DIRECTORY: directory },
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  const requests = new Map();
  let serial = 0,
    ended = false,
    readyDone = false,
    readyTimer,
    resolveReady,
    rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
    readyTimer = setTimeout(() => reject(Error("host startup timeout")), 10000);
  });
  child.on("message", (message) => {
    if (message?.type === "ready" && !readyDone) {
      readyDone = true;
      clearTimeout(readyTimer);
      for (const token of Object.values(message.credentials ?? {}))
        if (typeof token === "string") secrets.add(token);
      resolveReady(message);
      return;
    }
    if (message?.type === "reply") {
      const pending = requests.get(message.id);
      if (!pending) return;
      requests.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(Error(redact(message.error)));
      else pending.resolve(message.value);
    }
  });
  const stop = () => {
    ended = true;
    clearTimeout(readyTimer);
    if (!readyDone) rejectReady(Error("host exited before readiness"));
    for (const pending of requests.values()) {
      clearTimeout(pending.timer);
      pending.reject(Error("host exited"));
    }
    requests.clear();
  };
  child.once("exit", stop);
  child.once("error", stop);
  function request(method, fields = {}) {
    if (ended || !child.connected)
      return Promise.reject(Error("host unavailable"));
    if (requests.size >= 8)
      return Promise.reject(Error("operator request capacity"));
    const id = `operator-${++serial}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        requests.delete(id);
        reject(Error("operator response timeout"));
      }, 5000);
      requests.set(id, { resolve, reject, timer });
      child.send({ id, method, ...fields }, (error) => {
        if (error) {
          clearTimeout(timer);
          requests.delete(id);
          reject(Error("operator send failed"));
        }
      });
    });
  }
  const waitExit = (ms) =>
    new Promise((resolve) => {
      if (ended) {
        resolve(true);
        return;
      }
      const done = () => {
        clearTimeout(timer);
        child.removeListener("exit", done);
        resolve(true);
      };
      const timer = setTimeout(() => {
        child.removeListener("exit", done);
        resolve(false);
      }, ms);
      child.once("exit", done);
    });
  return {
    ready,
    request,
    async crash() {
      child.kill("SIGKILL");
      if (!(await waitExit(5000))) throw Error("host crash timeout");
      stop();
    },
    async close() {
      try {
        if (!ended) await request("close");
      } catch {
        /* Escalate only this owned child. */
      }
      if (!(await waitExit(1500))) {
        child.kill("SIGTERM");
        if (!(await waitExit(1500))) {
          child.kill("SIGKILL");
          if (!(await waitExit(1500))) throw Error("owned host did not exit");
        }
      }
      stop();
    },
  };
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function untilHost(predicate) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const value = await host.request("read");
    if (predicate(value)) return value;
    await delay(25);
  }
  throw Error("host observation timed out");
}
function physical() {
  const db = new DatabaseSync(join(directory, "world.db"), { readOnly: true });
  try {
    return JSON.parse(
      db.prepare("SELECT envelope FROM checkpoint WHERE id=1").get().envelope,
    );
  } finally {
    db.close();
  }
}
try {
  await initializeAuthorityWorkbench({ directory });
  host = childHost();
  let connection = await host.ready;
  server = await createServer({
    root: ROOT,
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  browser = await launch({ width: 1440, height: 960, strictClose: true });
  secondContext = await browser.browser.newContext({
    viewport: { width: 1440, height: 960 },
    locale: "en-US",
    timezoneId: "UTC",
  });
  const pages = { a: browser.page, b: await secondContext.newPage() };
  const read = (page) => page.evaluate(() => authorityWorkbench.read());
  const click = (page, id) => page.locator("#" + id).click();
  const ready = (page) =>
    page.waitForFunction(
      () => window.authorityWorkbench?.read().prediction?.status === "ready",
    );
  const value = async (page, confirmed, predicted, pending) => {
    await page.waitForFunction(
      ([c, p, n]) => {
        const r = authorityWorkbench.read().prediction;
        return (
          r?.status === "ready" &&
          r.confirmed.state.value === c &&
          r.predicted.value === p &&
          r.pending.length === n
        );
      },
      [confirmed, predicted, pending],
    );
    assert.equal(
      await page.locator("#confirmed").innerText(),
      String(confirmed),
    );
    assert.equal(
      await page.locator("#predicted").innerText(),
      String(predicted),
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll("canvas")].some(
        (c) => getComputedStyle(c).visibility === "visible",
      ),
    );
    const facts = await page.evaluate(() => authorityWorkbench.world());
    for (const [name, n] of [
      ["confirmed-marker", confirmed],
      ["predicted-marker", predicted],
    ]) {
      const marker = facts.find((row) => row.name === name);
      assert.ok(marker);
      assert.equal(
        marker.transform.x,
        (n / Math.max(10, Math.abs(confirmed), Math.abs(predicted))) * 5,
      );
    }
  };
  const connect = async (name) => {
    const page = pages[name];
    await page.waitForFunction(
      () => window.authorityWorkbench?.read().eligible,
    );
    await page.locator("#endpoint").fill(connection.url);
    await page.locator("#credential").fill(connection.credentials[name]);
    await click(page, "connect");
    await ready(page);
    assert.equal((await read(page)).principal, name);
    assert.equal(await page.locator("#credential").inputValue(), "");
  };
  const note = async (label) => {
    const states = {};
    for (const [name, page] of Object.entries(pages))
      states[name] = await read(page);
    report.observations.push({
      label,
      host: await host.request("read"),
      physical: physical(),
      clients: states,
    });
    const path = resolve(out, label + ".png");
    await pages.a.screenshot({ path });
    report.screenshots.push(path);
  };
  const predict = async (name, amount) => {
    await pages[name].locator("#amount").fill(String(amount));
    await click(pages[name], "predict");
  };
  for (const [name, page] of Object.entries(pages)) {
    page.on("pageerror", (e) => report.errors.push(redact(e.message)));
    page.on("console", (m) => {
      if (m.type() === "error") report.consoleErrors.push(redact(m.text()));
    });
    page.on("websocket", (socket) =>
      socket.on("framereceived", (frame) => {
        const text = String(frame.payload);
        if (Buffer.byteLength(text) > 4096 || report.wire[name].length >= 128) {
          report.errors.push("bounded wire capture exceeded");
          return;
        }
        if ([...secrets].some((secret) => text.includes(secret)))
          report.errors.push("credential disclosed");
        report.wire[name].push(redact(text));
      }),
    );
    await page.goto(
      `${server.resolvedUrls.local[0]}tools/authority-workbench/index.html?flags=dev.silent`,
    );
    await connect(name);
  }
  await value(pages.a, 0, 0, 0);
  await value(pages.b, 0, 0, 0);
  await pages.a.locator("#hold-send").check();
  await predict("a", 2);
  await predict("a", 3);
  await value(pages.a, 0, 5, 2);
  await note("01-predicted");
  await click(pages.a, "send-next");
  await value(pages.a, 2, 5, 1);
  await value(pages.b, 2, 2, 0);
  const older = await host.request("captureBaseline", { principal: "a" });
  assert.equal(
    (await host.request("operatorAdd", { add: 1 })).status,
    "committed",
  );
  await value(pages.a, 3, 6, 1);
  await value(pages.b, 3, 3, 0);
  assert.deepEqual((await read(pages.a)).prediction.correction, {
    changed: true,
    replayed: 1,
  });
  await note("02-visible-correction");
  const current = await host.request("captureBaseline", { principal: "a" });
  await host.request("deliverBaseline", { principal: "a", baseline: current });
  await host.request("deliverBaseline", { principal: "a", baseline: older });
  await pages.a.waitForFunction(
    () =>
      authorityWorkbench.read().baselines.duplicate >= 1 &&
      authorityWorkbench.read().baselines.obsolete >= 1,
  );
  await value(pages.a, 3, 6, 1);
  await click(pages.a, "send-next");
  await value(pages.a, 6, 6, 0);
  await value(pages.b, 6, 6, 0);
  assert.equal(physical().state, 6);
  const committedRevision = physical().revision;
  await click(pages.a, "retry");
  await pages.a.waitForFunction(
    () => authorityWorkbench.read().lastResult?.status === "duplicate",
  );
  assert.equal(physical().revision, committedRevision);
  await note("03-exact-retry");
  // A commit occurs independently of the requester. Hold the adapter reply, then kill the process.
  await host.request("holdCommitResponse", { enabled: true });
  await pages.a.locator("#hold-send").uncheck();
  await predict("a", 1);
  await untilHost((s) => s.commitResponseHeld);
  assert.equal(physical().state, 7);
  assert.equal(physical().revision, committedRevision + 1);
  await host.crash();
  await pages.a.waitForFunction(
    () => authorityWorkbench.read().prediction === null,
  );
  host = childHost();
  connection = await host.ready;
  await connect("a");
  await connect("b");
  await value(pages.a, 7, 7, 0);
  await value(pages.b, 7, 7, 0);
  assert.equal((await read(pages.a)).prediction.confirmed.processedThrough, 3);
  await note("04-restarted-after-commit-before-reply");
  // Pending input cannot survive coverage or scene ownership loss.
  await pages.a.locator("#hold-send").check();
  await predict("a", 2);
  await value(pages.a, 7, 9, 1);
  const previous = (await read(pages.a)).epoch;
  await click(pages.a, "cover-open");
  await pages.a.waitForFunction(
    () => authorityWorkbench.read().prediction === null,
  );
  assert.equal(
    (await pages.a.evaluate(() => authorityWorkbench.world())).filter((r) =>
      r.name?.endsWith("-marker"),
    ).length,
    0,
  );
  await click(pages.a, "cover-close");
  await connect("a");
  assert.notEqual((await read(pages.a)).epoch, previous);
  await value(pages.a, 7, 7, 0);
  await predict("a", 2);
  await click(pages.a, "exit");
  await pages.a.waitForFunction(
    () =>
      engine.state().scene?.scene === "scene.retired" &&
      engine.state().scene?.state === "active",
  );
  assert.equal((await read(pages.a)).prediction, null);
  await click(pages.a, "return");
  await connect("a");
  await value(pages.a, 7, 7, 0);
  await note("05-retired-control");
  await host.request("operatorAdd", { add: 10 });
  await value(pages.a, 17, 17, 0);
  await predict("a", 2);
  await value(pages.a, 17, 19, 1);
  const scaled = await pages.a.evaluate(() => authorityWorkbench.world());
  assert.notEqual(
    scaled.find((r) => r.name === "confirmed-marker").transform.x,
    scaled.find((r) => r.name === "predicted-marker").transform.x,
  );
  assert.match(await pages.a.locator("#scale").innerText(), /19/);
  await note("06-explicit-shared-scale");
  // A malformed first baseline must not manufacture a high initial command floor.
  await click(pages.a, "disconnect");
  await host.request("holdDisclosure", { principal: "a", enabled: true });
  await pages.a.locator("#credential").fill(connection.credentials.a);
  await click(pages.a, "connect");
  await pages.a.waitForFunction(
    () => authorityWorkbench.read().session !== null,
  );
  const malformed = await host.request("captureBaseline", { principal: "a" });
  malformed.processedThrough = malformed.revision + 1;
  await host.request("deliverBaseline", {
    principal: "a",
    baseline: malformed,
  });
  await pages.a.waitForFunction(
    () =>
      authorityWorkbench.read().status ===
      "Invalid authority frame; reconnect required",
  );
  assert.equal((await read(pages.a)).prediction, null);
  await host.request("releaseDisclosure", { principal: "a" });
  await connect("a");
  await value(pages.a, 17, 17, 0);
  await note("07-invalid-baseline-recovery");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.consoleErrors, []);
  report.passed = true;
} catch (error) {
  evidence.fail(Error(redact(error?.stack ?? error)));
} finally {
  for (const [owner, label] of [
    [secondContext, "context"],
    [browser, "browser"],
    [server, "vite"],
    [host, "host"],
  ]) {
    try {
      await owner?.close();
    } catch (error) {
      evidence.fail(Error(redact(error)), label);
    }
  }
  rmSync(directory, { recursive: true, force: true });
  const serialized = JSON.stringify(report);
  if ([...secrets].some((s) => serialized.includes(s))) {
    Object.assign(report, JSON.parse(redact(serialized)));
    evidence.fail(Error("credential redacted"), "report");
  }
  evidence.finish();
}
console.log(`Authority workbench passed; evidence ${out}`);
