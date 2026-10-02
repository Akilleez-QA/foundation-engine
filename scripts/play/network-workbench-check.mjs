#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync, fork } from 'node:child_process';
import { createServer } from 'vite';
import { ROOT } from './lib.mjs';
import { launch } from '../perf/bench-browser.mjs';
import { diagnosticReport } from './diagnostic-report.mjs';
const out = resolve(process.argv[2] ?? 'playtest/network-workbench');
mkdirSync(out, { recursive: true });
const secrets = new Set(),
  redact = (value) => {
    let text = String(value);
    for (const secret of secrets) text = text.split(secret).join('[redacted]');
    return text;
  };
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim(),
  passed: false,
  errors: [],
  consoleErrors: [],
  screenshots: [],
  observations: [],
  wire: {
    alpha: { sentBytes: 0, received: [] },
    beta: { sentBytes: 0, received: [] },
  },
  limitations: [
    'Two isolated desktop Chromium contexts and one separate loopback host process; no WAN, physical-device, TLS deployment or scalability certification.',
    'NW01 ephemeral authentication and command scopes only; no durable recovery, replicated baseline or prediction acceptance.',
    'Credentials are random operator fixtures supplied through trusted IPC and native password inputs; no production identity-provider claim.',
    'NW04 paced reconnect is exercised against one loopback host with injected send refusal and revoked credentials; no WAN loss, host restart fleet or thundering-herd measurement in a browser.',
    'Terminal close classification is exercised for one loopback auth-rejected close (code 1008); a close frame lost before TCP teardown would surface as code 1006 and be paced as transient.',
    'NW08 planned drain uses a second loopback host with drain enabled; "host return" is the operator resume of that same process, not a process restart (fixture credentials do not survive a restart). Capped lifetime is covered by host socket tests, not this browser workflow.',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
let host, drainHost, server, browser, betaContext;
function childHost(args = []) {
  const child = fork(resolve(ROOT, 'tools/network-workbench/server.mjs'), args, {
    cwd: ROOT,
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
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
    readyTimer = setTimeout(() => reject(Error('host startup timeout')), 10000);
  });
  child.on('message', (message) => {
    if (message?.type === 'ready' && !readyDone) {
      readyDone = true;
      clearTimeout(readyTimer);
      for (const token of Object.values(message.credentials ?? {}))
        if (typeof token === 'string') secrets.add(token);
      resolveReady(message);
      return;
    }
    if (message?.type === 'reply') {
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
    if (!readyDone) rejectReady(Error('host exited before readiness'));
    for (const pending of requests.values()) {
      clearTimeout(pending.timer);
      pending.reject(Error('host exited'));
    }
    requests.clear();
  };
  child.once('exit', stop);
  child.once('error', stop);
  function request(method, fields = {}) {
    if (ended || !child.connected)
      return Promise.reject(Error('host unavailable'));
    if (requests.size >= 8)
      return Promise.reject(Error('operator request capacity'));
    const id = `operator-${++serial}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        requests.delete(id);
        reject(Error('operator response timeout'));
      }, 5000);
      requests.set(id, { resolve, reject, timer });
      child.send({ id, method, ...fields }, (error) => {
        if (error) {
          clearTimeout(timer);
          requests.delete(id);
          reject(Error('operator send failed'));
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
        child.removeListener('exit', done);
        resolve(true);
      };
      const timer = setTimeout(() => {
        child.removeListener('exit', done);
        resolve(false);
      }, ms);
      child.once('exit', done);
    });
  return {
    ready,
    request,
    async close() {
      try {
        if (!ended) await request('close');
      } catch {
        /* Escalate only this owned child. */
      }
      if (!(await waitExit(1500))) {
        child.kill('SIGTERM');
        if (!(await waitExit(1500))) {
          child.kill('SIGKILL');
          if (!(await waitExit(1500))) throw Error('owned host did not exit');
        }
      }
      stop();
    },
  };
}
async function untilHost(predicate, owner = host) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const state = await owner.request('read');
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw Error('host oracle condition timed out');
}
try {
  host = childHost();
  const connection = await host.ready;
  assert.match(connection.url, /^ws:\/\/127\.0\.0\.1:\d+\/socket$/);
  assert.equal(Object.keys(connection.credentials).length, 2);
  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  browser = await launch({ width: 1440, height: 960, strictClose: true });
  betaContext = await browser.browser.newContext({
    viewport: { width: 1440, height: 960 },
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  const pages = { alpha: browser.page, beta: await betaContext.newPage() };
  for (const [name, page] of Object.entries(pages)) {
    page.on('pageerror', (error) => report.errors.push(redact(error.message)));
    page.on('console', (message) => {
      if (message.type() === 'error')
        report.consoleErrors.push(redact(message.text()));
    });
    page.on('websocket', (socket) => {
      if (socket.url() !== connection.url) return;
      socket.on('framesent', (frame) => {
        report.wire[name].sentBytes += Buffer.byteLength(frame.payload);
      });
      socket.on('framereceived', (frame) => {
        const text = Buffer.isBuffer(frame.payload)
          ? frame.payload.toString('utf8')
          : frame.payload;
        if (text.length > 1024 || report.wire[name].received.length >= 64) {
          report.errors.push('wire evidence bound exceeded');
          return;
        }
        for (const token of secrets)
          if (text.includes(token))
            report.errors.push('credential disclosed on incoming wire');
        report.wire[name].received.push(redact(text));
      });
    });
  }
  const read = (page) => page.evaluate(() => networkWorkbench.read()),
    click = (page, id) => page.locator('#' + id).click();
  const active = (page) =>
    page.waitForFunction(
      () =>
        window.networkWorkbench?.read().scene === 'sample' &&
        engine.state().scene?.state === 'active',
    );
  const snapshot = async (label) => {
    const state = await host.request('read');
    report.observations.push({
      label,
      host: state,
      clients: { alpha: await read(pages.alpha), beta: await read(pages.beta) },
    });
    return state;
  };
  const shot = async (page, label) => {
    if ((await read(page)).scene === 'sample') {
      const rect = await page.locator('canvas').first().boundingBox();
      assert.ok(
        rect && rect.width >= 640 && rect.height >= 480,
        'active world canvas must occupy visible area',
      );
      assert.ok(await page.evaluate(() => engine.loop().renders > 0));
    }
    assert.equal(await page.locator('#credential').inputValue(), '');
    const path = resolve(out, label + '.png');
    await page.screenshot({ path });
    report.screenshots.push(path);
  };
  const connect = async (page, token) => {
    await page.locator('#endpoint').fill(connection.url);
    await page.locator('#credential').fill(token);
    await click(page, 'connect');
    assert.equal(await page.locator('#credential').inputValue(), '');
  };
  const authenticated = (page, name) =>
    page.waitForFunction(
      (name) => networkWorkbench.read().principal === name,
      name,
    );
  const command = async (page, target, delta) => {
    const renders = await page.evaluate(() => engine.loop().renders),
      prior = (await read(page)).value;
    await page.locator('#target').selectOption(target);
    await page.locator('#delta').fill(String(delta));
    await click(page, 'send');
    await page.waitForFunction(() => networkWorkbench.read().pending === 0);
    if ((await read(page)).value !== prior)
      await page.waitForFunction((n) => engine.loop().renders > n, renders);
  };
  const projected = async (page, name, value) => {
    const rows = await page.evaluate(() => networkWorkbench.world());
    const named = rows.filter((row) => row.name);
    assert.equal(named.length, value === null ? 0 : 1);
    if (value !== null) {
      assert.equal(named[0].name, `accepted:${name}`);
      assert.equal(named[0].shape.kind, 'box');
      assert.deepEqual(named[0].shape.size, [
        1.2,
        0.5 + Math.min(value, 20) * 0.1,
        1.2,
      ]);
    }
  };
  const base =
    server.resolvedUrls.local[0] +
    'tools/network-workbench/index.html?flags=dev.silent#scene/sample';
  await Promise.all(
    Object.values(pages).map(async (page) => {
      await page.goto(base);
      await active(page);
    }),
  );
  // Wrong credential is an actual native authentication attempt, never an operator role switch.
  await connect(pages.alpha, 'invalid-diagnostic-credential');
  await pages.alpha.waitForFunction(
    () => networkWorkbench.read().transport?.state === 'disposed',
  );
  assert.equal((await read(pages.alpha)).principal, null);
  assert.deepEqual((await host.request('read')).counters, {
    alpha: 0,
    beta: 0,
  });
  await connect(pages.alpha, connection.credentials.alpha);
  await authenticated(pages.alpha, 'alpha');
  await connect(pages.beta, connection.credentials.beta);
  await authenticated(pages.beta, 'beta');
  await untilHost(
    (s) =>
      s.intake.connections === 2 && s.peers.every((p) => p.state === 'active'),
  );
  await command(pages.alpha, 'alpha', 3);
  await command(pages.beta, 'beta', 2);
  assert.deepEqual((await snapshot('authorized-two-peers')).counters, {
    alpha: 3,
    beta: 2,
  });
  assert.equal((await read(pages.alpha)).value, 3);
  assert.equal((await read(pages.beta)).value, 2);
  await projected(pages.alpha, 'alpha', 3);
  await projected(pages.beta, 'beta', 2);
  await shot(pages.alpha, 'alpha-authorized');
  await shot(pages.beta, 'beta-authorized');
  await command(pages.alpha, 'beta', 5);
  assert.match((await read(pages.alpha)).message, /Refused: unauthorized/);
  const denied = await snapshot('cross-principal-refusal');
  assert.deepEqual(denied.counters, { alpha: 3, beta: 2 });
  assert.equal(denied.metrics.dispatched, 2);
  await projected(pages.alpha, 'alpha', 3);
  await projected(pages.beta, 'beta', 2);
  // Retiring one scene closes its owned socket and removes its accepted presentation.
  await click(pages.beta, 'exit');
  await pages.beta.waitForFunction(
    () =>
      networkWorkbench.read().scene === 'retired' &&
      engine.state().scene.state === 'active',
  );
  assert.equal((await read(pages.beta)).principal, null);
  assert.equal((await read(pages.beta)).lastFrame, null);
  assert.equal((await read(pages.beta)).lastSend, null);
  await projected(pages.beta, 'beta', null);
  await untilHost((s) => s.intake.connections === 1);
  await shot(pages.beta, 'beta-retired');
  await click(pages.beta, 'return');
  await active(pages.beta);
  await connect(pages.beta, connection.credentials.beta);
  await authenticated(pages.beta, 'beta');
  assert.equal((await read(pages.beta)).value, null);
  await command(pages.beta, 'beta', 1);
  assert.deepEqual((await snapshot('reconnected-new-lease')).counters, {
    alpha: 3,
    beta: 3,
  });
  await projected(pages.beta, 'beta', 3);
  // Revocation is a trusted operator action; browsers cannot select principals.
  await host.request('revoke', { principal: 'alpha' });
  await pages.alpha.waitForFunction(
    () =>
      networkWorkbench.read().principal === null &&
      networkWorkbench.read().transport?.state === 'disposed',
  );
  await projected(pages.alpha, 'alpha', null);
  await untilHost((s) => s.intake.connections === 1);
  await connect(pages.alpha, connection.credentials.alpha);
  await pages.alpha.waitForFunction(
    () => networkWorkbench.read().transport?.state === 'disposed',
  );
  assert.equal((await read(pages.alpha)).principal, null);
  await command(pages.beta, 'beta', 1);
  assert.deepEqual((await snapshot('revoked-peer-and-healthy-peer')).counters, {
    alpha: 3,
    beta: 4,
  });
  await shot(pages.alpha, 'alpha-revoked');
  // NW04: optional paced reconnect. Transport loss reconnects with fresh authentication; commands are never resent.
  const reconnect = async (page) => (await read(page)).reconnect;
  await pages.beta.locator('#auto-reconnect').check();
  await connect(pages.beta, connection.credentials.beta);
  await authenticated(pages.beta, 'beta');
  assert.equal((await reconnect(pages.beta)).armed, true);
  const opened = (await reconnect(pages.beta)).transportsOpened;
  await host.request('blockSends', { principal: 'beta', value: true });
  await click(pages.beta, 'send');
  await pages.beta.waitForFunction(
    () => networkWorkbench.read().reconnect.last?.status === 'wait',
  );
  assert.equal((await read(pages.beta)).pending, 0);
  await host.request('blockSends', { principal: 'beta', value: false });
  await pages.beta.waitForFunction(
    () =>
      networkWorkbench.read().principal === 'beta' &&
      networkWorkbench.read().reconnect.schedule.state === 'idle',
    undefined,
    { timeout: 15000 },
  );
  const recovered = await reconnect(pages.beta);
  assert.equal(recovered.schedule.attempt, 0);
  assert.ok(
    recovered.transportsOpened > opened &&
      recovered.transportsOpened <= opened + recovered.schedule.limits.maxAttempts,
  );
  const afterDrop = await snapshot('paced-reconnect-recovered');
  assert.deepEqual(afterDrop.counters, { alpha: 3, beta: 5 });
  assert.equal(afterDrop.metrics.dispatched, 5, 'reconnect resent no command');
  await untilHost(
    (s) => s.intake.connections === 1 && s.peers.every((p) => p.state === 'active'),
  );
  await command(pages.beta, 'beta', 1);
  assert.equal((await read(pages.beta)).value, 6);
  await shot(pages.beta, 'beta-reconnected');
  // A revoked credential is refused with a terminal close reason: with the default policy the client makes
  // exactly one attempt, releases the credential and never schedules a retry.
  await pages.alpha.locator('#auto-reconnect').check();
  assert.equal(await pages.alpha.locator('#final-refusals').isChecked(), true);
  const refusedFrom = (await reconnect(pages.alpha)).transportsOpened;
  await connect(pages.alpha, connection.credentials.alpha);
  await pages.alpha.waitForFunction(
    () => networkWorkbench.read().reconnect.lastClose !== null,
  );
  const refused = await read(pages.alpha);
  assert.deepEqual(refused.transport.remoteClose, { code: 1008, reason: 'auth-rejected' });
  assert.deepEqual(refused.reconnect.lastClose, {
    code: 1008,
    reason: 'auth-rejected',
    class: 'terminal',
  });
  assert.equal(refused.reconnect.armed, false);
  assert.equal(refused.reconnect.schedule.state, 'idle');
  assert.equal(refused.reconnect.schedule.attempt, 0);
  assert.equal(refused.reconnect.last, null);
  assert.equal(refused.reconnect.transportsOpened, refusedFrom + 1);
  assert.match(refused.message, /Refused by host \(remote-close: auth-rejected\)/);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal((await reconnect(pages.alpha)).transportsOpened, refusedFrom + 1);
  report.observations.push({ label: 'terminal-close-single-attempt', reconnect: await reconnect(pages.alpha) });
  await shot(pages.alpha, 'alpha-refused-final');
  // A creator may instead treat refusals as transient: retries then stop at maxAttempts, offline without spinning.
  await pages.alpha.locator('#final-refusals').uncheck();
  const alphaOpened = (await reconnect(pages.alpha)).transportsOpened;
  await connect(pages.alpha, connection.credentials.alpha);
  await pages.alpha.waitForFunction(
    () => networkWorkbench.read().reconnect.last?.status === 'exhausted',
    undefined,
    { timeout: 20000 },
  );
  const exhausted = await reconnect(pages.alpha);
  assert.equal(exhausted.armed, false);
  assert.equal(exhausted.transportsOpened, alphaOpened + 1 + exhausted.last.attempts);
  assert.equal(exhausted.last.attempts, exhausted.schedule.limits.maxAttempts);
  assert.equal(exhausted.lastClose.class, 'transient');
  assert.match((await read(pages.alpha)).message, /Offline: 5 reconnect attempts failed/);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal((await reconnect(pages.alpha)).transportsOpened, exhausted.transportsOpened);
  assert.equal((await read(pages.alpha)).principal, null);
  await shot(pages.alpha, 'alpha-reconnect-exhausted');
  // Retiring the owner mid-episode cancels the pending wait: no attempt after exit.
  await connect(pages.alpha, connection.credentials.alpha);
  await pages.alpha.waitForFunction(
    () => networkWorkbench.read().reconnect.schedule?.attempt >= 1,
  );
  await click(pages.alpha, 'exit');
  await pages.alpha.waitForFunction(
    () => networkWorkbench.read().scene === 'retired',
  );
  const cancelled = await reconnect(pages.alpha);
  assert.equal(cancelled.armed, false);
  assert.equal(cancelled.schedule, null);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal((await reconnect(pages.alpha)).transportsOpened, cancelled.transportsOpened);
  await untilHost((s) => s.intake.connections === 1);
  await click(pages.alpha, 'return');
  await active(pages.alpha);
  // Every other documented stop path drops the retained credential and opens no further transport.
  const stopsReconnecting = async (label, stop) => {
    await pages.alpha.locator('#auto-reconnect').check();
    await connect(pages.alpha, connection.credentials.alpha);
    await pages.alpha.waitForFunction(
      () =>
        networkWorkbench.read().reconnect.armed &&
        networkWorkbench.read().reconnect.schedule?.attempt >= 1,
    );
    await stop();
    const stopped = await reconnect(pages.alpha);
    assert.equal(stopped.armed, false, `${label}: credential released`);
    assert.equal(stopped.budgetRetryAt, null, `${label}: no budget wait`);
    assert.equal(stopped.schedule.state, 'idle', `${label}: episode ended`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const later = await reconnect(pages.alpha);
    assert.equal(
      later.transportsOpened,
      stopped.transportsOpened,
      `${label}: no transport after stop`,
    );
    assert.equal(later.armed, false, `${label}: stays disarmed`);
    report.observations.push({ label: `reconnect-stop-${label}`, reconnect: later });
  };
  await stopsReconnecting('disconnect', () => click(pages.alpha, 'disconnect'));
  await stopsReconnecting('untick', () =>
    pages.alpha.locator('#auto-reconnect').uncheck(),
  );
  await stopsReconnecting('hidden', () =>
    pages.alpha.evaluate(() => {
      // Simulate a hidden tab, then restore it so frames keep running during the no-attempt window.
      for (const [key, value] of [['hidden', true], ['visibilityState', 'hidden']])
        Object.defineProperty(document, key, { configurable: true, get: () => value });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.hidden;
      delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    }),
  );
  await stopsReconnecting('pagehide', () =>
    pages.alpha.evaluate(() => window.dispatchEvent(new Event('pagehide'))),
  );
  await untilHost((s) => s.intake.connections === 1);
  for (const [name, wire] of Object.entries(report.wire))
    for (const text of wire.received) {
      const frame = JSON.parse(text);
      assert.ok(['authenticated', 'result', 'refused'].includes(frame.type));
      if (frame.type === 'result') assert.equal(frame.target, name);
      assert.equal(Object.hasOwn(frame, 'token'), false);
    }
  await click(pages.beta, 'disconnect');
  await untilHost(
    (s) =>
      s.intake.connections === 0 &&
      s.intake.queuedMessages === 0 &&
      s.intake.pendingAuth === 0,
  );
  const final = await snapshot('all-connections-released');
  assert.deepEqual(final.counters, { alpha: 3, beta: 6 });
  assert.equal(final.metrics.dispatched, 6);
  // NW08: planned drain on a separate opt-in host. alpha follows the notice; beta ignores it and is closed at the
  // deadline. Both reconnect through their retry schedules after the operator ends the drain; no command is resent.
  drainHost = childHost(['--drain']);
  const drained = await drainHost.ready;
  for (const page of Object.values(pages)) {
    await page.locator('#auto-reconnect').check();
    await page.locator('#final-refusals').check();
    await page.locator('#endpoint').fill(drained.url);
  }
  await pages.alpha.locator('#follow-drain').check();
  assert.equal(await pages.beta.locator('#follow-drain').isChecked(), false);
  const connectTo = async (page, token) => {
    await page.locator('#credential').fill(token);
    await click(page, 'connect');
    assert.equal(await page.locator('#credential').inputValue(), '');
  };
  await connectTo(pages.alpha, drained.credentials.alpha);
  await authenticated(pages.alpha, 'alpha');
  await connectTo(pages.beta, drained.credentials.beta);
  await authenticated(pages.beta, 'beta');
  await command(pages.alpha, 'alpha', 1);
  assert.equal((await read(pages.alpha)).value, 1);
  const before = {
    alpha: (await reconnect(pages.alpha)).transportsOpened,
    beta: (await reconnect(pages.beta)).transportsOpened,
  };
  await drainHost.request('drain', { noticeMs: 1500, reconnectAfterMs: 3000 });
  await pages.alpha.waitForFunction(
    () => networkWorkbench.read().drain.state?.state === 'holding',
  );
  const holding = await read(pages.alpha);
  assert.deepEqual(
    { cause: holding.drain.lastNotice.cause, reconnectAfterMs: holding.drain.lastNotice.reconnectAfterMs },
    { cause: 'planned', reconnectAfterMs: 3000 },
  );
  assert.equal(holding.drain.plannedCloses, 1);
  assert.match(holding.message, /Closed for planned host drain; host expected back in \d+ ms/);
  assert.equal(holding.reconnect.transportsOpened, before.alpha, 'no attempt yet');
  await shot(pages.alpha, 'alpha-drain-hold');
  await pages.beta.waitForFunction(
    () => networkWorkbench.read().reconnect.lastClose?.reason === 'drain',
    undefined,
    { timeout: 5000 },
  );
  assert.deepEqual((await reconnect(pages.beta)).lastClose, {
    code: 1012,
    reason: 'drain',
    class: 'transient',
  });
  assert.match((await read(pages.beta)).message, /Connection ended: remote-close: drain/);
  const hostDrained = await untilHost((s) => s.intake.connections === 0, drainHost);
  assert.equal(hostDrained.drain.counts.notices, 2);
  // The hold is honoured: beta's paced attempts may already be refused, but alpha has opened nothing.
  assert.equal((await reconnect(pages.alpha)).transportsOpened, before.alpha);
  assert.equal((await read(pages.alpha)).drain.state.state, 'holding');
  report.observations.push({ label: 'drain-hold', host: hostDrained, alpha: await read(pages.alpha), beta: await read(pages.beta) });
  await drainHost.request('resume');
  for (const name of ['alpha', 'beta'])
    await pages[name].waitForFunction(
      (name) =>
        networkWorkbench.read().principal === name &&
        networkWorkbench.read().reconnect.schedule.state === 'idle',
      name,
      { timeout: 20000 },
    );
  for (const name of ['alpha', 'beta']) {
    const state = await read(pages[name]);
    const opened = state.reconnect.transportsOpened - before[name];
    assert.ok(opened >= 1 && opened <= state.reconnect.schedule.limits.maxAttempts, `${name}: ${opened} paced attempts`);
    assert.ok(state.reconnect.schedule.tokens <= state.reconnect.schedule.limits.budget.capacity - 1, `${name}: budget spent`);
    assert.equal(state.drain.state.state, 'idle');
  }
  const returned = await untilHost(
    (s) => s.intake.connections === 2 && s.peers.every((p) => p.state === 'active'),
    drainHost,
  );
  assert.deepEqual(returned.counters, { alpha: 1, beta: 0 });
  assert.equal(returned.metrics.dispatched, 1, 'drain and reconnect resent no command');
  await command(pages.alpha, 'alpha', 2);
  assert.equal((await read(pages.alpha)).value, 3);
  await shot(pages.alpha, 'alpha-drain-returned');
  report.observations.push({ label: 'drain-returned', host: await drainHost.request('read'), alpha: await read(pages.alpha) });
  for (const page of Object.values(pages)) await click(page, 'disconnect');
  await untilHost((s) => s.intake.connections === 0, drainHost);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.consoleErrors, []);
  report.passed = true;
} catch (error) {
  evidence.fail(Error(redact(error?.stack ?? error)));
} finally {
  for (const [owner, label] of [
    [betaContext, 'second context close'],
    [browser, 'browser close'],
    [server, 'vite close'],
    [host, 'host close'],
    [drainHost, 'drain host close'],
  ]) {
    try {
      await owner?.close();
    } catch (error) {
      evidence.fail(Error(redact(error)), label);
    }
  }
  const serialized = JSON.stringify(report);
  if ([...secrets].some((secret) => serialized.includes(secret))) {
    Object.assign(report, JSON.parse(redact(serialized)));
    evidence.fail(
      Error(
        'credential appeared in captured diagnostic state; evidence redacted',
      ),
    );
  }
  evidence.finish();
}
console.log(`Network workbench passed; evidence ${out}`);
