#!/usr/bin/env node
// Actual runtime sync/scene exit with Three instrumentation; no private production API.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
const out = resolve(process.argv[2] ?? 'playtest/indexed-geometry');
mkdirSync(out, {recursive: true});
const html =
  '<!doctype html><html><head><link rel="icon" href="data:,"><title>Indexed geometry transaction diagnostic</title></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app" class="app-root"></main><script type="module" src="/scripts/play/fixtures/indexed-geometry-entry.mjs"></script></body></html>';
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  plugins: [
    {
      name: 'indexed-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/__indexed.html')) {
            res.setHeader('Content-Type', 'text/html');
            res.end(html);
          } else next();
        });
      },
    },
  ],
  server: {host: '127.0.0.1', port: 0},
});
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  dirtyWorktree: !!execFileSync('git', ['status', '--porcelain'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  passed: false,
  samples: [],
  limitations: [
    'Instrumented Chromium composition; not physical-device performance evidence',
    'The deliberate disposer failure removes its scene ticker by existing policy; assertions inspect published geometry and subsequent route cleanup, not resumed rendering',
  ],
};
let browser;
try {
  await server.listen();
  browser = await launch({width: 900, height: 700});
  const p = browser.page;
  await p.goto(`${server.resolvedUrls.local[0]}__indexed.html?flags=dev.silent&quality=reference#scene/sample`);
  await p.waitForFunction(() => window.indexedCheck?.snapshot().active);
  const snapshot = () => p.evaluate(() => window.indexedCheck.snapshot());
  for (let revision = 1; revision <= 10; revision++) {
    const before = await snapshot();
    await p.evaluate(revision => window.indexedCheck.revise(revision), revision);
    await p.waitForFunction(before => {
      const state = window.indexedCheck.snapshot();
      return state.frame > before.frame && state.active !== before.active;
    }, before);
    const state = await snapshot();
    assert.equal(state.seen.filter(g => !g.disposals).length, 1);
    assert.ok(state.seen.every(g => g.disposals <= 1));
    report.samples.push(state);
  }
  await p.screenshot({path: resolve(out, 'indexed.png')});
  const beforeFailure = await snapshot();
  await p.evaluate(() => {
    window.indexedCheck.failOldDisposal();
    window.indexedCheck.revise(11);
  });
  await p.waitForFunction(() => window.indexedCheck.snapshot().failures === 1);
  report.afterFailure = await snapshot();
  assert.notEqual(
    report.afterFailure.active,
    beforeFailure.active,
    'replacement published despite old disposal failure',
  );
  assert.equal(report.afterFailure.seen.filter(g => !g.disposals).length, 1);
  await p.evaluate(() => window.hudCheck.goto('other'));
  await p.waitForFunction(() => window.hudCheck.state().world?.scene === 'other');
  report.final = await snapshot();
  assert.ok(report.final.seen.every(g => g.disposals === 1));
  assert.equal(browser.errors.length, 1, 'only the deliberately failing disposal is reported');
  assert.match(browser.errors[0], /indexed diagnostic disposal failure/);
  report.expectedErrors = [...browser.errors];
  // Fresh composition: dispose the real app synchronously inside the swap callback.
  await p.goto('about:blank');
  await p.goto(`${server.resolvedUrls.local[0]}__indexed.html?flags=dev.silent&quality=reference#scene/sample`);
  await p.waitForFunction(() => window.indexedCheck?.snapshot().active);
  await p.evaluate(() => {
    window.indexedCheck.disposeAppOnOldDisposal();
    window.indexedCheck.revise(1);
  });
  await p.waitForFunction(() => window.indexedCheck.snapshot().appDisposed);
  report.disposedDuringSwap = await snapshot();
  assert.equal(report.disposedDuringSwap.lateDraws, 0, 'no scene draw after callback disposed the app');
  assert.ok(report.disposedDuringSwap.seen.every(g => g.disposals === 1));
  assert.equal(browser.errors.length, 1, 'app disposal introduces no extra render or cleanup failures');
  report.passed = true;
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  try {
    await browser?.close();
  } finally {
    await server.close();
  }
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(`Indexed geometry transactions passed; evidence ${out}`);
