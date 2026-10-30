#!/usr/bin/env node
// Actual runtime sync/scene exit with Three instrumentation; no private production API.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
const out = resolve(process.argv[2] ?? '/tmp/foundation-primitive-retention');
mkdirSync(out, {recursive: true});
const html =
  '<!doctype html><html><head><link rel="icon" href="data:,"><title>Primitive retention diagnostic</title></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app" class="app-root"></main><script type="module" src="/scripts/play/fixtures/primitive-retention-entry.mjs"></script></body></html>';
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  plugins: [
    {
      name: 'primitive-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/__primitive.html')) {
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
  passed: false,
  samples: [],
  limitations: ['Instrumented Chromium composition; not physical-device performance evidence'],
};
let browser;
try {
  await server.listen();
  browser = await launch({width: 900, height: 700});
  const p = browser.page;
  await p.goto(`${server.resolvedUrls.local[0]}__primitive.html?flags=dev.silent&quality=reference#scene/sample`);
  await p.waitForFunction(() => window.primitiveCheck?.snapshot().active.some(m => m.name === 'subject'));
  const snapshot = () => p.evaluate(() => window.primitiveCheck.snapshot());
  const wait = predicate => p.waitForFunction(predicate);
  const initial = await snapshot();
  const originalId = initial.active.find(m => m.name === 'subject').id;
  await p.evaluate(() => window.primitiveCheck.share());
  await wait(() => window.primitiveCheck.snapshot().active.length === 2);
  const shared = await snapshot();
  assert.equal(new Set(shared.active.map(m => m.id)).size, 1);
  for (let step = 0; step < 30; step++) {
    const width = 1.1 + step / 100;
    await p.evaluate(width => window.primitiveCheck.resize(width), width);
    await p.waitForFunction(
      width => window.primitiveCheck.snapshot().active.some(m => m.name === 'subject' && m.width === width),
      width,
    );
    const state = await snapshot();
    assert.equal(state.seen.filter(g => g.disposals === 0).length, 2);
    assert.ok(state.seen.every(g => g.disposals <= 1));
    assert.equal(state.seen.find(g => g.id === originalId).disposals, 0);
    report.samples.push(state);
  }
  await p.evaluate(() => window.primitiveCheck.removeSubject());
  await wait(() => window.primitiveCheck.snapshot().active.length === 1);
  assert.equal((await snapshot()).seen.filter(g => g.disposals === 0).length, 1);
  await p.evaluate(() => window.primitiveCheck.removeShared());
  await wait(() => window.primitiveCheck.snapshot().active.length === 0);
  assert.ok((await snapshot()).seen.every(g => g.disposals === 1));
  await p.evaluate(() => window.primitiveCheck.share());
  await wait(() => window.primitiveCheck.snapshot().active.length === 1);
  await p.screenshot({path: resolve(out, 'shared.png')});
  await p.evaluate(() => window.hudCheck.goto('other'));
  await wait(() => window.hudCheck.state().world?.scene === 'other');
  report.final = await snapshot();
  assert.ok(report.final.seen.every(g => g.disposals === 1));
  assert.deepEqual(browser.errors, []);
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
console.log(`Primitive geometry retention passed; evidence ${out}`);
