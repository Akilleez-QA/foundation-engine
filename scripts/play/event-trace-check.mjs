#!/usr/bin/env node
// Real browser clock + public dev API export; not cross-worker or CPU profiling evidence.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';

const out = resolve(process.argv[2] ?? '/tmp/foundation-event-trace-browser');
mkdirSync(out, {recursive: true});
const html =
  '<!doctype html><html><head><link rel="icon" href="data:,"><title>Event trace diagnostic</title></head><body><script type="module" src="/scripts/play/fixtures/event-trace-entry.mjs"></script></body></html>';
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  plugins: [
    {
      name: 'event-trace-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/__event-trace-check.html')) return next();
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
  limitations: ['Synchronous app bus elapsed intervals only', 'No external trace viewer import exercised'],
};
let browser;
try {
  await server.listen();
  browser = await launch({width: 800, height: 600});
  browser.page.on('pageerror', error => report.errors.push(String(error)));
  await browser.page.goto(`${server.resolvedUrls.local[0]}__event-trace-check.html?flags=dev.silent`);
  await browser.page.waitForFunction(() => typeof window.traceCheck === 'function');
  const {snapshot, exported} = await browser.page.evaluate(() => window.traceCheck());
  assert.equal(snapshot.records.length, 4);
  assert.equal(snapshot.invalidClockSamples, 0);
  assert.equal(exported.traceEvents.length, 2);
  const [outer, inner] = exported.traceEvents;
  assert.equal(outer.name, 'app.started');
  assert.equal(inner.name, 'app.module-failed');
  assert.equal(inner.args.parent, outer.args.id);
  for (const event of exported.traceEvents) {
    assert.equal(event.ph, 'X');
    assert.ok(Number.isFinite(event.ts) && event.ts >= 0);
    assert.ok(Number.isFinite(event.dur) && event.dur >= 0);
  }
  assert.ok(inner.ts >= outer.ts);
  assert.ok(inner.ts + inner.dur <= outer.ts + outer.dur + 1e-6);
  assert.equal(exported.metadata.incompleteSpans, 0);
  assert.equal(exported.metadata.invalidTimingSpans, 0);
  assert.deepEqual(report.errors, []);
  writeFileSync(resolve(out, 'trace.json'), JSON.stringify(exported, null, 2));
  writeFileSync(resolve(out, 'snapshot.json'), JSON.stringify(snapshot, null, 2));
  report.passed = true;
  console.log(`Event trace export passed; evidence ${out}`);
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await server.close();
}
