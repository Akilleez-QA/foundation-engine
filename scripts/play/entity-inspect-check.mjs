#!/usr/bin/env node
// Actual authored scene metadata diagnostic through the public dev API.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';

const out = resolve(process.argv[2] ?? '/tmp/foundation-entity-inspect-browser');
mkdirSync(out, {recursive: true});
const html =
  '<!doctype html><html><head><link rel="icon" href="data:,"><title>Entity metadata inspection</title></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app" class="app-root"></main><pre id="metadata" style="position:fixed;top:60px;left:16px;z-index:100;max-height:75vh;overflow:auto;background:white;color:black;padding:16px"></pre><script type="module" src="/scripts/play/fixtures/entity-inspect-entry.mjs"></script></body></html>';
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  plugins: [
    {
      name: 'entity-inspect-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/__entity-inspect-check.html')) return next();
          res.setHeader('Content-Type', 'text/html');
          res.end(html);
        });
      },
    },
  ],
  server: {host: '127.0.0.1', port: 0},
});
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  passed: false,
  errors: [],
  limitations: [
    'Detached component labels only, no value editor',
    'One app instance; no cross-app stable identity claim',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
let browser;
try {
  await server.listen();
  browser = await launch({width: 800, height: 600});
  browser.page.on('pageerror', error => report.errors.push(String(error)));
  await browser.page.goto(`${server.resolvedUrls.local[0]}__entity-inspect-check.html?flags=dev.silent#scene/sample`);
  const page = browser.page;
  await page.waitForFunction(() => {
    const epoch = window.engine?.state().scene?.epoch;
    return (
      window.engine?.state().scene?.scene === 'scene.sample' &&
      epoch !== undefined &&
      window.engine.entities({expectedEpoch: epoch}).status === 'ready'
    );
  });
  const epoch = await page.evaluate(() => window.engine.state().scene.epoch);
  const initial = await page.evaluate(epoch => window.engine.entities({expectedEpoch: epoch, limit: 1}), epoch);
  assert.equal(initial.status, 'ready');
  assert.equal(initial.page.entities.length, 1);
  assert.deepEqual(
    initial.page.entities[0].components.map(c => c.label),
    ['transform', 'inspection-tag'],
  );
  assert.equal(initial.page.entities[0].componentsComplete, true);
  await page.evaluate(data => {
    window.entityInspect.show(data);
    window.entityInspect.keepHandle();
  }, initial);
  await page.screenshot({path: resolve(out, 'initial.png')});
  await page.evaluate(() => window.engine.goto('other'));
  const replacementEpoch = await page.evaluate(() => window.engine.state().scene.epoch);
  assert.notEqual(replacementEpoch, epoch);
  assert.equal(await page.evaluate(epoch => window.engine.entities({expectedEpoch: epoch}).status, epoch), 'stale');
  assert.equal(await page.evaluate(epoch => window.entityInspect.previous(epoch).status, epoch), 'unavailable');
  const replacement = await page.evaluate(epoch => window.engine.entities({expectedEpoch: epoch}), replacementEpoch);
  assert.equal(replacement.status, 'ready');
  assert.equal(
    replacement.page.entities[0].id,
    initial.page.entities[0].id,
    'local entity IDs can repeat across scene visits',
  );
  await page.evaluate(() => window.entityInspect.dispose());
  const closed = await page.evaluate(epoch => window.engine.entities({expectedEpoch: epoch}), replacementEpoch);
  assert.equal(closed.status, 'unavailable');
  assert.deepEqual(report.errors, []);
  writeFileSync(resolve(out, 'snapshots.json'), JSON.stringify({initial, replacement, closed}, null, 2));
  report.passed = true;
} catch (error) {
  evidence.fail(error);
} finally {
  await evidence.close(browser, 'browser close');
  await evidence.close(server, 'server close');
  evidence.finish();
}

console.log(`Entity inspection passed; evidence ${out}`);
