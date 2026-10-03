#!/usr/bin/env node
// Browser regression: on a first entry, a goto re-entry, a restart and a return, no scene system steps before enter().
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';

const out = resolve(process.argv[2] ?? 'playtest/diagnostics/scene-entry-order');
mkdirSync(out, {recursive: true});
const report = {revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(), errors: [],
  limitations: ['Emulated desktop browser only; not physical-device evidence']};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
const html = '<!doctype html><html><head><link rel="icon" href="data:,"></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app"></main><script type="module" src="/scripts/play/fixtures/scene-entry-order-entry.mjs"></script></body></html>';
let server, browser;
try {
  server = await createServer({root: ROOT, logLevel: 'error', plugins: [{name: 'scene-entry-order-diagnostic', configureServer(s) {
    s.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/__scene-entry-order.html')) return next();
      res.setHeader('Content-Type', 'text/html'); res.end(html);
    });
  }}], server: {host: '127.0.0.1', port: 0}});
  await server.listen();
  browser = await launch({width: 800, height: 600, strictClose: true});
  const page = browser.page;
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.goto(`${server.resolvedUrls.local[0]}__scene-entry-order.html?flags=dev.silent#scene/level`);
  const stepped = () => page.waitForFunction(() => window.engine?.state().world?.state?.fixedSteps > 2 && window.engine.state().world.state.frameSteps > 2, {}, {timeout: 15000});
  await stepped();
  await page.evaluate(() => engine.goto('level', {n: '2'})); await stepped();
  await page.evaluate(() => { entryOrder.restart = true; });
  await page.waitForFunction(() => entryOrder.enters.length === 3, {}, {timeout: 15000}); await stepped();
  await page.evaluate(() => engine.goto('other'));
  await page.evaluate(() => engine.goto('level', {n: '3'})); await stepped();
  const log = await page.evaluate(() => window.entryOrder);
  report.enters = log.enters; report.early = log.early;
  assert.deepEqual(log.enters, [{}, {n: '2'}, {n: '2'}, {n: '3'}], 'one enter() per visit');
  assert.deepEqual(log.early, [], 'no system stepped before its visit entered');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) { evidence.fail(error); }
finally {
  await evidence.close(browser, 'browser cleanup'); await evidence.close(server, 'server cleanup'); evidence.finish();
}
console.log(`Scene entry order: PASS; ${out}`);
