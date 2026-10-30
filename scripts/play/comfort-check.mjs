#!/usr/bin/env node
// Existing settings/save owner and real computed CSS; not device or accessibility certification.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out = resolve(process.argv[2] ?? 'playtest/ui/comfort');
mkdirSync(out, {recursive: true});
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  dirtyWorktree: execFileSync('git', ['status', '--porcelain'], {cwd: ROOT, encoding: 'utf8'}).trim().length > 0,
  states: [],
  limitations: [
    'Actual settings service with browser storage and computed CSS',
    'No finished preference screen or physical-device/200% zoom certification',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
const html =
  '<!doctype html><html><head><link rel="icon" href="data:,"></head><body><header class="shell-header"><h1>Comfort diagnostic</h1><button id="sample" style="transition:opacity var(--engine-motion)">Reading sample</button></header><main>Existing preference tokens</main><script type="module" src="/scripts/play/fixtures/comfort-entry.mjs"></script></body></html>';
let server, b;
try {
  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    plugins: [
      {
        name: 'comfort-diagnostic',
        configureServer(s) {
          s.middlewares.use((req, res, next) => {
            if (!req.url?.startsWith('/__comfort.html')) return next();
            res.setHeader('Content-Type', 'text/html');
            res.end(html);
          });
        },
      },
    ],
    server: {host: '127.0.0.1', port: 0},
  });
  await server.listen();
  b = await launch({width: 820, height: 600, strictClose: true});
  await b.page.emulateMedia({reducedMotion: 'no-preference'});
  const ready = () => b.page.waitForFunction(() => !!window.comfortCheck);
  const sample = async name => {
    const value = await b.page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('#sample'));
      return {font: style.fontSize, motion: style.transitionDuration};
    });
    report.states.push({name, ...value});
    return value;
  };
  await b.page.goto(`${server.resolvedUrls.local[0]}__comfort.html?flags=dev.silent`);
  await ready();
  assert.deepEqual(await sample('default'), {font: '14px', motion: '0.22s'});
  await b.page.evaluate(() => {
    comfortCheck.set('comfort.large-type', true);
    comfortCheck.set('comfort.calm', true);
  });
  assert.deepEqual(await sample('selected'), {font: '17px', motion: '0s'});
  await b.page.screenshot({path: resolve(out, 'selected.png')});
  await b.page.waitForFunction(() =>
    Object.entries(localStorage).some(
      ([key, value]) =>
        key.endsWith('|device|settings.values') &&
        JSON.parse(value).data['comfort.large-type'] === true &&
        JSON.parse(value).data['comfort.calm'] === true,
    ),
  );
  await b.page.reload();
  await ready();
  assert.deepEqual(await sample('reloaded'), {font: '17px', motion: '0s'});
  await b.page.evaluate(() => comfortCheck.reset());
  assert.deepEqual(await sample('reset'), {font: '14px', motion: '0.22s'});
  await b.page.waitForFunction(() =>
    Object.entries(localStorage).some(
      ([key, value]) => key.endsWith('|device|settings.values') && Object.keys(JSON.parse(value).data).length === 0,
    ),
  );
  await b.page.reload();
  await ready();
  assert.deepEqual(await sample('reset-reloaded'), {font: '14px', motion: '0.22s'});
  await b.page.evaluate(() => {
    document.documentElement.dataset.comfort = 'large';
    document.documentElement.dataset.calm = '';
  });
  assert.deepEqual(await sample('legacy-attributes'), {font: '17px', motion: '0s'});
  await b.page.evaluate(() => {
    delete document.documentElement.dataset.comfort;
    delete document.documentElement.dataset.calm;
  });
  await b.page.emulateMedia({reducedMotion: 'reduce'});
  await b.page.waitForFunction(() => getComputedStyle(document.querySelector('#sample')).transitionDuration === '0s');
  assert.deepEqual(await sample('os-reduced-motion'), {font: '14px', motion: '0s'});
  assert.deepEqual(b.errors, []);
  report.passed = true;
} catch (error) {
  evidence.fail(error);
} finally {
  await evidence.close(b, 'browser cleanup');
  await evidence.close(server, 'server cleanup');
  evidence.finish();
}
console.log(`Comfort settings: PASS; ${out}`);
