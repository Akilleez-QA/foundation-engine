#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';

const out = resolve(process.argv[2] ?? 'playtest/diagnostics/system-timing');
mkdirSync(out, {recursive: true});
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  errors: [],
  limitations: [
    'Synchronous elapsed authored callback intervals, not CPU/worker time',
    'No external viewer import or physical-device performance acceptance',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
const html =
  '<!doctype html><html><head><link rel="icon" href="data:,"></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app"></main><pre id="metadata" style="position:fixed;inset:60px 16px 16px;z-index:100;overflow:auto;background:white;color:black;padding:16px"></pre><script type="module" src="/scripts/play/fixtures/system-timing-entry.mjs"></script></body></html>';
let server, browser;
try {
  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    plugins: [
      {
        name: 'system-timing-diagnostic',
        configureServer(s) {
          s.middlewares.use((req, res, next) => {
            if (!req.url?.startsWith('/__system-timing.html')) return next();
            res.setHeader('Content-Type', 'text/html');
            res.end(html);
          });
        },
      },
    ],
    server: {host: '127.0.0.1', port: 0},
  });
  await server.listen();
  browser = await launch({width: 800, height: 600, strictClose: true});
  const page = browser.page;
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.goto(`${server.resolvedUrls.local[0]}__system-timing.html?flags=dev.silent#scene/sample`);
  await page.waitForFunction(
    () =>
      window.engine?.state().scene?.scene === 'scene.sample' &&
      window.engine.state().scene.state !== 'entering' &&
      window.systemTiming,
  );
  await page.evaluate(() => {
    engine.clock.hold();
    systemTiming.start();
    engine.clock.step(50);
    systemTiming.show();
  });
  const snapshot = await page.evaluate(() => systemTiming.capture.snapshot());
  assert.equal(snapshot.records.length, 2);
  assert.deepEqual(
    snapshot.records.map(r => r.ordinal),
    [0, 1],
  );
  assert.deepEqual(snapshot.labels, ['timed-work', 'timed-sibling']);
  assert.ok(snapshot.records[0].durationMs >= 2, 'known synchronous work must be attributed');
  assert.ok(snapshot.records[1].durationMs >= 0, 'sibling invocation has its own valid interval');
  const exported = await page.evaluate(() => systemTiming.capture.exportTrace());
  assert.equal(exported.traceEvents[0].dur, snapshot.records[0].durationMs * 1000);
  assert.equal(exported.traceEvents[0].args.epoch, snapshot.epoch);
  await page.screenshot({path: resolve(out, 'capture.png')});
  await page.evaluate(() => {
    systemTiming.capture.dispose();
    engine.clock.step(50);
  });
  assert.equal(await page.evaluate(() => systemTiming.capture.snapshot().records.length), 2);
  await page.evaluate(() => {
    systemTiming.start();
    engine.clock.resume();
  });
  await page.evaluate(() => engine.goto('other'));
  assert.equal(await page.evaluate(() => systemTiming.capture.snapshot().disposed), true);
  assert.equal(await page.evaluate(() => systemTiming.previous.systemTrace()), null);
  await page.evaluate(() => {
    systemTiming.capture = engine.systemTrace();
    systemTiming.dispose();
  });
  assert.equal(await page.evaluate(() => systemTiming.capture.snapshot().disposed), true);
  assert.equal(await page.evaluate(() => engine.systemTrace()), null);
  assert.deepEqual(report.errors, []);
  writeFileSync(resolve(out, 'trace.json'), JSON.stringify(exported, null, 2));
  report.snapshot = snapshot;
  report.passed = true;
} catch (error) {
  evidence.fail(error);
} finally {
  await evidence.close(browser, 'browser cleanup');
  await evidence.close(server, 'server cleanup');
  evidence.finish();
}
console.log(`System timing: PASS; ${out}`);
