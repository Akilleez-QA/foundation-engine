#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';

const out = resolve(process.argv[2] ?? 'playtest/diagnostics/route-dependencies');
mkdirSync(out, {recursive: true});
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  workingTree: execFileSync('git', ['status', '--porcelain'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  errors: [],
  observations: [],
  screenshots: [],
  configuration: {
    viewport: {width: 1280, height: 800},
    motionPerStep: 0.5,
    actorHalfExtent: 0.2,
    obstacle: {x: [-1, 1], z: [-0.5, 0.5]},
    queueWorkPerOffer: 128,
  },
  limitations: [
    'Finite authored coordinates/scopes; no automatic spatial partitioning or publication atomicity',
    'Desktop browser diagnostic only; physical devices, sustained performance, mobile and gate budgets unverified',
    'Portal revision replacement between planning and crossing; no arbitrary callback mutation atomicity claim',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
const html = `<!doctype html><html><head><meta charset="UTF-8"><link rel="icon" href="data:,"><style>
#app{position:fixed!important;inset:120px 340px 0 0!important;width:auto!important;height:auto!important}
#controls{position:fixed;inset:42px 0 auto 0;z-index:100;display:flex;flex-wrap:wrap;gap:6px;padding:8px;background:#eef3f7;color:#13202c}
#controls button{padding:8px;color:#13202c;background:white;border:1px solid #63788a;border-radius:4px}
#metadata{position:fixed;inset:120px 0 0 auto;width:324px;overflow:auto;margin:0;padding:8px;font:12px monospace;background:#eef3f7;color:#13202c}
</style></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header>
<main id="app"></main><nav id="controls" aria-label="Diagnostic controls"></nav><pre id="metadata"></pre>
<script type="module" src="/scripts/play/fixtures/route-dependencies-entry.mjs"></script></body></html>`;
let server, browser;
try {
  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    plugins: [
      {
        name: 'route-dependencies-diagnostic',
        configureServer(s) {
          s.middlewares.use((req, res, next) => {
            if (!req.url?.startsWith('/__route-dependencies.html')) return next();
            res.setHeader('Content-Type', 'text/html');
            res.end(html);
          });
        },
      },
    ],
    server: {host: '127.0.0.1', port: 0},
  });
  await server.listen();
  browser = await launch({...report.configuration.viewport, strictClose: true});
  report.browser = {version: browser.version, executable: browser.executable, arguments: browser.launchArguments};
  report.errors = browser.errors;
  const page = browser.page;
  await page.goto(`${server.resolvedUrls.local[0]}__route-dependencies.html?flags=dev.silent#scene/sample`);
  await page.waitForFunction(
    () =>
      window.routeDiagnostic?.ready() &&
      window.engine?.state().scene?.scene === 'scene.sample' &&
      window.engine.state().scene.state !== 'entering',
  );
  await page.evaluate(() => engine.clock.hold());
  async function command(action, keyboard = false) {
    const before = await page.evaluate(() => routeDiagnostic.snapshot().commands);
    const control = page.locator(`[data-action="${action}"]`);
    if (keyboard) {
      await control.focus();
      await page.keyboard.press('Enter');
    } else await control.click();
    await page.evaluate(() => engine.clock.step(16));
    const state = await page.evaluate(() => routeDiagnostic.snapshot());
    report.observations.push({action, ...state});
    assert.equal(state.commands, before + 1, `${action}: native control must reach the consumer`);
    return state;
  }
  async function screenshot(name) {
    await page.screenshot({path: resolve(out, name)});
    report.screenshots.push(name);
  }
  // Expectations are authored here independently of fixture route/path/status outputs.
  function positions(state, west, east) {
    assert.deepEqual(state.positions.west, west);
    assert.deepEqual(state.positions.east, east);
  }
  // Axis-aligned swept box vs independent obstacle expanded by the actor half extent.
  function noContact(from, to) {
    assert.ok(from[0] === to[0] || from[1] === to[1], 'finite example uses axis-aligned segments');
    const overlapX = Math.max(from[0], to[0]) >= -1.2 && Math.min(from[0], to[0]) <= 1.2;
    const overlapZ = Math.max(from[1], to[1]) >= -0.7 && Math.min(from[1], to[1]) <= 0.7;
    assert.ok(!(overlapX && overlapZ), `unexpected swept contact: ${from} -> ${to}`);
  }
  let state = await command('reset', true);
  positions(state, [-4, 0], [-4, 4]);
  await command('prepare');
  state = await command('step');
  positions(state, [-3.5, 0], [-3.5, 4]);
  assert.deepEqual(state.tickets, {west: 'valid', east: 'valid'});
  await command('reject');
  state = await command('step');
  positions(state, [-3, 0], [-3, 4]);
  assert.equal(state.scopes.west.revision, 0);
  await screenshot('01-prepared-rejected.png');
  await command('prepare');
  state = await command('accept');
  assert.deepEqual(state.notification, {status: 'accepted', affected: ['west']});
  const invalidated = state.positions.west;
  for (let i = 0; i < 2; i++) {
    state = await command('step');
    positions(state, invalidated, [-2.5 + i * 0.5, 4]);
    assert.deepEqual(state.tickets, {west: 'stale', east: 'valid'});
  }
  await screenshot('02-invalidated-west.png');
  await command('replan');
  // Explicit handwritten coordinate oracle: up, across, down, finish (22 half-unit steps).
  const expected = [
    ...Array.from({length: 4}, (_, i) => [-3, (i + 1) * 0.5]),
    ...Array.from({length: 12}, (_, i) => [-3 + (i + 1) * 0.5, 2]),
    ...Array.from({length: 4}, (_, i) => [3, 2 - (i + 1) * 0.5]),
    [3.5, 0],
    [4, 0],
  ];
  let previous = [-3, 0];
  for (const [i, target] of expected.entries()) {
    state = await command('step');
    positions(state, target, [Math.min(4, -2 + (i + 1) * 0.5), 4]);
    noContact(previous, state.positions.west);
    previous = [...state.positions.west];
    if (i === 9) await screenshot('03-detour.png');
  }
  await screenshot('04-arrived.png');
  await command('reset');
  await command('prepare');
  await command('accept');
  await command('replan');
  state = await command('step');
  positions(state, [-4, 0.5], [-3.5, 4]);
  await command('unavailable');
  for (let i = 0; i < 2; i++) {
    state = await command('step');
    positions(state, [-4, 0.5], [-3 + i * 0.5, 4]);
    assert.equal(state.tickets.west, 'unavailable');
    assert.equal(state.tickets.east, 'valid');
  }
  await screenshot('05-not-ready.png');
  state = await command('revise');
  assert.equal(state.portalRevision, 1);
  assert.equal(state.crossingRevision, 0);
  state = await command('cross');
  assert.equal(state.crossing.status, 'stale');
  assert.deepEqual(state.positions.traveler, [-1, -3]);
  await screenshot('06-outdated-crossing.png');
  await command('refresh');
  state = await command('cross');
  assert.equal(state.crossing.status, 'ready');
  assert.deepEqual(state.positions.traveler, [1, -3]);
  await screenshot('07-current-crossing.png');
  report.final = state;
  await page.evaluate(() => routeDiagnostic.dispose());
  const cleanup = await page.evaluate(() => routeDiagnostic.cleanup());
  assert.equal(cleanup.queue.requests, 0);
  assert.equal(cleanup.dependencies.routes, 0);
  assert.equal(cleanup.controls, 0);
  report.cleanup = cleanup;
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  evidence.fail(error);
} finally {
  await evidence.close(browser, 'browser cleanup');
  await evidence.close(server, 'server cleanup');
  if (report.errors.length) evidence.fail(new Error(report.errors.join('\n')), 'browser errors');
  evidence.finish();
}
console.log(`Route dependencies: PASS; ${out}`);
