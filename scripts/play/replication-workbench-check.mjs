#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync, fork} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out = resolve(process.argv[2] ?? 'playtest/replication-workbench');
mkdirSync(out, {recursive: true});
const secrets = new Set(),
  redact = value => {
    let text = String(value);
    for (const secret of secrets) text = text.split(secret).join('[redacted]');
    return text;
  };
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim(),
  workingTreeDirty:
    execFileSync('git', ['status', '--porcelain'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim().length > 0,
  passed: false,
  errors: [],
  consoleErrors: [],
  screenshots: [],
  observations: [],
  wire: {
    alpha: {sentBytes: 0, received: []},
    beta: {sentBytes: 0, received: []},
  },
  limitations: [
    'Two isolated desktop Chromium contexts and one separate loopback host process; no WAN, physical-device, TLS deployment or scalability certification.',
    'NW02 complete scoped views only; no durable recovery or prediction acceptance. Credit withholding is application-level slow consumption, not physical TCP backpressure.',
    'Credentials are random operator fixtures supplied through trusted IPC and native password inputs; no production identity-provider claim.',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
let host, server, browser, betaContext;
function childHost() {
  const child = fork(resolve(ROOT, 'tools/replication-workbench/server.mjs'), [], {
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
  child.on('message', message => {
    if (message?.type === 'ready' && !readyDone) {
      readyDone = true;
      clearTimeout(readyTimer);
      for (const token of Object.values(message.credentials ?? {})) if (typeof token === 'string') secrets.add(token);
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
    if (ended || !child.connected) return Promise.reject(Error('host unavailable'));
    if (requests.size >= 8) return Promise.reject(Error('operator request capacity'));
    const id = `operator-${++serial}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        requests.delete(id);
        reject(Error('operator response timeout'));
      }, 5000);
      requests.set(id, {resolve, reject, timer});
      child.send({id, method, ...fields}, error => {
        if (error) {
          clearTimeout(timer);
          requests.delete(id);
          reject(Error('operator send failed'));
        }
      });
    });
  }
  const waitExit = ms =>
    new Promise(resolve => {
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
async function untilHost(predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const state = await host.request('read');
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error('host oracle condition timed out');
}

try {
  host = childHost();
  const connection = await host.ready;
  assert.match(connection.url, /^ws:\/\/127\.0\.0\.1:\d+\/socket$/);
  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: {host: '127.0.0.1', port: 0},
  });
  await server.listen();
  browser = await launch({width: 1440, height: 960, strictClose: true});
  betaContext = await browser.browser.newContext({
    viewport: {width: 1440, height: 960},
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  const pages = {alpha: browser.page, beta: await betaContext.newPage()};
  for (const [name, page] of Object.entries(pages)) {
    page.on('pageerror', error => report.errors.push(redact(error.message)));
    page.on('console', message => {
      if (message.type() === 'error') report.consoleErrors.push(redact(message.text()));
    });
    page.on('websocket', socket => {
      if (socket.url() !== connection.url) return;
      socket.on('framesent', frame => {
        report.wire[name].sentBytes += Buffer.byteLength(frame.payload);
      });
      socket.on('framereceived', frame => {
        const text = Buffer.isBuffer(frame.payload) ? frame.payload.toString('utf8') : frame.payload;
        const wire = report.wire[name];
        wire.receivedBytes = (wire.receivedBytes ?? 0) + Buffer.byteLength(text);
        if (Buffer.byteLength(text) > 65536 || wire.received.length >= 96 || wire.receivedBytes > 262144) {
          report.errors.push('wire evidence bound exceeded');
          return;
        }
        for (const token of secrets)
          if (text.includes(token)) report.errors.push('credential disclosed on incoming wire');
        wire.received.push(redact(text));
      });
    });
  }
  const read = page => page.evaluate(() => replicationWorkbench.read());
  const world = page => page.evaluate(() => replicationWorkbench.world());
  const click = (page, id) => page.locator('#' + id).click();
  const active = page =>
    page.waitForFunction(
      () => window.replicationWorkbench?.read().eligible && engine.state().scene?.state === 'active',
    );
  const ready = (page, after = -1) =>
    page.waitForFunction(
      n => replicationWorkbench.read().receiver?.state === 'ready' && replicationWorkbench.read().receiver.sequence > n,
      after,
    );
  const settled = () => untilHost(s => s.peers.every(peer => peer.publisher && peer.publisher.outstanding === null));
  const connect = async name => {
    const page = pages[name];
    await active(page);
    await page.locator('#endpoint').fill(connection.url);
    await page.locator('#credential').fill(connection.credentials[name]);
    await click(page, 'connect');
    await ready(page);
    assert.equal((await read(page)).principal, name);
    assert.equal(await page.locator('#credential').inputValue(), '');
    await settled();
  };
  const operator = async (method, payload) => {
    await settled();
    return host.request(method, {payload});
  };
  const rendered = new Map();
  const projected = async name => {
    const page = pages[name],
      authority = await host.request('read'),
      scope = authority.scopes[name];
    const expected = authority.entities
      .filter(e => !e.omitted && (scope.ids === null || scope.ids.includes(e.id)))
      .map(e => ({
        id: e.id,
        incarnation: e.incarnation,
        fields: {
          ...(!scope.removed.includes('value') ? {value: e.value} : {}),
          ...(!scope.removed.includes('private') ? {private: `${name}:${e.id}`} : {}),
        },
      }));
    await page.waitForFunction(() =>
      [...document.querySelectorAll('canvas')].some(c => getComputedStyle(c).visibility === 'visible'),
    );
    const sequence = (await read(page)).receiver.sequence;
    const previousRender = rendered.get(name);
    if (!previousRender || previousRender.sequence !== sequence)
      await page.waitForFunction(n => engine.loop().renders > n, previousRender?.count ?? 0);
    rendered.set(name, {
      sequence,
      count: await page.evaluate(() => engine.loop().renders),
    });
    const client = await read(page),
      rows = await world(page),
      replicas = rows.filter(r => r.replica);
    assert.deepEqual(client.receiver.view.entities, expected);
    assert.deepEqual(
      replicas.map(r => r.replica).sort((a, b) => a.id.localeCompare(b.id)),
      [...expected].sort((a, b) => a.id.localeCompare(b.id)),
    );
    assert.equal(rows.filter(r => r.name === 'local-ground').length, 1);
    for (const row of replicas) {
      const e = expected.find(e => e.id === row.replica.id);
      assert.deepEqual(row.shape.size, [0.55, 0.4 + Math.min(e.fields.value ?? 0, 20) * 0.04, 0.55]);
      assert.equal(row.shape.color, Object.hasOwn(e.fields, 'private') ? 0x75cabb : 0xe7bd67);
    }
    return replicas;
  };
  const cleared = async page => {
    assert.equal((await world(page)).filter(r => r.replica).length, 0);
    assert.equal(await page.locator('#fields').textContent(), '');
    assert.equal(
      await page
        .locator('canvas')
        .first()
        .evaluate(c => getComputedStyle(c).visibility),
      'hidden',
    );
  };
  const shot = async (page, label) => {
    assert.equal(await page.locator('#credential').inputValue(), '');
    const rect = await page.locator('canvas').first().boundingBox();
    assert.ok(rect && rect.width >= 640 && rect.height >= 480);
    assert.ok(await page.evaluate(() => engine.loop().renders > 0));
    const path = resolve(out, label + '.png');
    await page.screenshot({path});
    report.screenshots.push(path);
  };
  const note = async label => {
    const {timings, ...authority} = await host.request('read');
    report.observations.push({
      label,
      host: authority,
      clients: {alpha: await read(pages.alpha), beta: await read(pages.beta)},
    });
  };
  const base = server.resolvedUrls.local[0] + 'tools/replication-workbench/index.html?flags=dev.silent#scene/sample';
  await Promise.all(
    Object.values(pages).map(async page => {
      await page.goto(base);
      await active(page);
    }),
  );
  await connect('alpha');
  await connect('beta');
  await projected('alpha');
  await projected('beta');
  await note('two-private-baselines');
  await shot(pages.alpha, 'alpha-baseline');
  await shot(pages.beta, 'beta-baseline');
  const before = await read(pages.alpha),
    initialEntity = (await world(pages.alpha)).find(r => r.replica?.id === 'entity-0').entity;
  await operator('removeField', {
    principal: 'alpha',
    field: 'private',
    removed: true,
  });
  await ready(pages.alpha, before.receiver.sequence);
  assert.equal((await read(pages.alpha)).receiver.view.worldRevision, before.receiver.view.worldRevision);
  assert.equal((await world(pages.alpha)).find(r => r.replica?.id === 'entity-0').entity, initialEntity);
  await projected('alpha');
  await projected('beta');
  await note('disclosure-only-field-removal');
  let seq = (await read(pages.alpha)).receiver.sequence;
  await operator('setScope', {
    principal: 'alpha',
    ids: ['entity-0', 'entity-1'],
  });
  await ready(pages.alpha, seq);
  await projected('alpha');
  await click(pages.alpha, 'hold-decoration');
  const oldEntity = (await world(pages.alpha)).find(r => r.replica?.id === 'entity-0').entity;
  seq = (await read(pages.alpha)).receiver.sequence;
  await operator('replaceEntity', {id: 'entity-0'});
  await ready(pages.alpha, seq);
  await click(pages.alpha, 'release-decoration');
  assert.equal((await read(pages.alpha)).heldDecorationResult, false);
  assert.notEqual((await world(pages.alpha)).find(r => r.replica?.id === 'entity-0').entity, oldEntity);
  await projected('alpha');
  await settled();
  await note('incarnation-rejects-held-decoration');
  seq = (await read(pages.alpha)).receiver.sequence;
  await operator('omitEntity', {id: 'entity-1', omitted: true});
  await ready(pages.alpha, seq);
  await projected('alpha');
  await operator('oversize', {principal: 'alpha', enabled: true});
  await pages.alpha.waitForFunction(() => replicationWorkbench.read().receiver?.state === 'unavailable');
  await cleared(pages.alpha);
  assert.equal((await world(pages.alpha)).filter(r => r.name === 'local-ground').length, 1);
  await operator('oversize', {principal: 'alpha', enabled: false});
  await ready(pages.alpha);
  await projected('alpha');
  seq = (await read(pages.alpha)).receiver.sequence;
  await operator('setScope', {principal: 'alpha', ids: null});
  await ready(pages.alpha, seq);
  await pages.alpha.locator('#fail-projection').check();
  await click(pages.alpha, 'refresh');
  await pages.alpha.waitForFunction(() => replicationWorkbench.read().receiver?.state === 'unavailable');
  await cleared(pages.alpha);
  await note('partial-projection-fail-cleared');
  await pages.alpha.locator('#fail-projection').uncheck();
  await click(pages.alpha, 'refresh');
  await ready(pages.alpha);
  await projected('alpha');
  for (const mode of ['scrim', 'opaque']) {
    const priorSession = (await read(pages.alpha)).session;
    // Capture facts inside the same native click dispatch, before a subsequent scene update is possible.
    await pages.alpha.evaluate(mode => {
      document.getElementById('cover-' + mode).addEventListener(
        'click',
        () => {
          window.coverageEvidence = {
            read: replicationWorkbench.read(),
            world: replicationWorkbench.world(),
            canvasHidden: [...document.querySelectorAll('canvas')].every(
              c => getComputedStyle(c).visibility === 'hidden',
            ),
          };
        },
        {once: true},
      );
    }, mode);
    await click(pages.alpha, 'cover-' + mode);
    const at = await pages.alpha.evaluate(() => coverageEvidence);
    assert.equal(at.read.activity.coverage, mode);
    assert.equal(at.read.eligible, false);
    assert.equal(at.read.principal, null);
    assert.equal(at.read.receiver, null);
    assert.equal(at.world.filter(r => r.replica).length, 0);
    assert.equal(at.canvasHidden, true);
    const frames = at.read.frames;
    await untilHost(s => s.peers.length === 1);
    assert.equal((await read(pages.alpha)).frames, frames);
    await shot(pages.alpha, 'alpha-covered-' + mode);
    await click(pages.alpha, 'close-cover');
    await active(pages.alpha);
    assert.equal((await read(pages.alpha)).receiver, null);
    await connect('alpha');
    assert.notEqual((await read(pages.alpha)).session, priorSession);
    await projected('alpha');
  }
  const previous = (await read(pages.beta)).session;
  await click(pages.beta, 'exit');
  await pages.beta.waitForFunction(
    () => engine.state().scene?.scene === 'scene.retired' && engine.state().scene?.state === 'active',
  );
  assert.equal((await read(pages.beta)).principal, null);
  assert.equal((await world(pages.beta)).filter(r => r.replica).length, 0);
  await click(pages.beta, 'return');
  await active(pages.beta);
  await connect('beta');
  assert.notEqual((await read(pages.beta)).session, previous);
  await projected('beta');
  await pages.alpha.locator('#hold-credit').check();
  seq = (await read(pages.alpha)).receiver.sequence;
  await operator('changeWorld', {id: 'entity-0', value: 9});
  await ready(pages.alpha, seq);
  await untilHost(s => Boolean(s.peers.find(p => p.principal === 'alpha')?.publisher.outstanding));
  // Intentionally bypass settled(): privacy revocation cannot wait behind application credit.
  await host.request('removeField', {
    payload: {principal: 'alpha', field: 'value', removed: true},
  });
  await pages.alpha.waitForFunction(() => replicationWorkbench.read().principal === null);
  await cleared(pages.alpha);
  await untilHost(s => s.peers.length === 1);
  await ready(pages.beta);
  await projected('beta');
  await note('stalled-credit-privacy-retirement');
  await shot(pages.alpha, 'alpha-retired-credit');
  for (const [name, wire] of Object.entries(report.wire))
    for (const text of wire.received) {
      const frame = JSON.parse(text);
      assert.ok(['authenticated', 'view', 'view-unavailable'].includes(frame.type));
      if (frame.type === 'authenticated') assert.equal(frame.principal, name);
      if (frame.type === 'view')
        for (const e of frame.entities)
          if (Object.hasOwn(e.fields, 'private')) assert.equal(e.fields.private, `${name}:${e.id}`);
      assert.equal(Object.hasOwn(frame, 'token'), false);
    }
  await click(pages.beta, 'disconnect');
  await untilHost(s => s.intake.connections === 0 && s.intake.queuedMessages === 0);
  await note('released');
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
  ]) {
    try {
      await owner?.close();
    } catch (error) {
      evidence.fail(Error(redact(error)), label);
    }
  }
  const serialized = JSON.stringify(report);
  if ([...secrets].some(secret => serialized.includes(secret))) {
    Object.assign(report, JSON.parse(redact(serialized)));
    evidence.fail(Error('credential appeared in captured diagnostic state; evidence redacted'));
  }
  evidence.finish();
}
console.log(`Replication workbench passed; evidence ${out}`);
