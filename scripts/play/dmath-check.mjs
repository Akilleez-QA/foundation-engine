#!/usr/bin/env node
// scripts/play/dmath-check.mjs (`npm run test:dmath-browser`): cross-engine evidence for the optional deterministic
// maths (src/core/dmath.ts). The muted, isolated test browser opens a fixture that computes the committed golden
// vectors (src/core/dmath.golden.json) and a seeded character-kit workload (motion, facing, rotated solids, camera
// yaw, root motion, exp/log/pow) with dmath and with the browser's own Math. This Node process computes the same.
//
// Proves: dmath's bits in this Chromium equal the committed hex vectors and Node's, and the deterministic workload's
// per-tick digest is identical in both engines. Reports (does not assert) how many Math.* results differ between
// the two engines, which is why the module exists. It does not prove other browsers, physical devices or a full
// scene replay. Run with `node --import tsx`.
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
import {dmath, platformMath} from '../../src/core/dmath.ts';
import {computeGolden} from '../../src/core/dmath-vectors.ts';
import {characterRun, timings} from '../../tools/dmath-bench/workload.ts';

const out = resolve(process.argv[2] ?? 'playtest/dmath');
mkdirSync(out, {recursive: true});
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  errors: [],
  node: {node: process.versions.node, v8: process.versions.v8},
  limitations: [
    'One desktop Chromium build against one Node: no Firefox/WebKit, other runtimes or physical devices',
    'Pure workload through the kit modules, not a full scene replay through the stock runtime',
    'Timings are one machine in one run; not a frame budget',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
const html =
  '<!doctype html><html><head><link rel="icon" href="data:,"></head><body><script type="module" src="/scripts/play/fixtures/dmath-entry.mjs"></script></body></html>';
const differing = (a, b) =>
  Object.fromEntries(Object.keys(a).map(fn => [fn, a[fn].filter((row, i) => row.at(-1) !== b[fn][i].at(-1)).length]));
let server, browser;
try {
  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    plugins: [
      {
        name: 'dmath-diagnostic',
        configureServer(s) {
          s.middlewares.use((req, res, next) => {
            if (!req.url?.startsWith('/__dmath.html')) return next();
            res.setHeader('Content-Type', 'text/html');
            res.end(html);
          });
        },
      },
    ],
    server: {host: '127.0.0.1', port: 0},
  });
  await server.listen();
  browser = await launch({width: 400, height: 300, strictClose: true});
  const page = browser.page;
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.goto(`${server.resolvedUrls.local[0]}__dmath.html?flags=dev.silent`);
  await page.waitForFunction(() => window.dmathReady === true, null, {timeout: 120000});
  const web = await page.evaluate(() => window.dmathResult);
  report.browser = {version: browser.version, userAgent: web.userAgent};

  const committed = JSON.parse(readFileSync(resolve(ROOT, 'src/core/dmath.golden.json'), 'utf8')).cases;
  const nodeGolden = computeGolden(dmath),
    nodePlatform = computeGolden(platformMath);
  const cases = Object.values(committed).reduce((n, rows) => n + rows.length, 0);
  assert.deepEqual(web.golden, committed, 'Chromium dmath bits equal the committed golden vectors');
  assert.deepEqual(nodeGolden, committed, 'Node dmath bits equal the committed golden vectors');
  report.golden = {
    cases,
    chromiumEqualsCommitted: true,
    nodeEqualsCommitted: true,
    mathDiffersBetweenEngines: differing(web.platformGolden, nodePlatform),
  };

  const nodeDet = characterRun(dmath),
    nodePlat = characterRun(platformMath);
  assert.deepEqual(
    web.character.deterministic,
    nodeDet,
    'the deterministic character workload is bit-identical in Chromium and Node',
  );
  report.character = {
    ticks: nodeDet.ticks,
    deterministic: {chromium: web.character.deterministic.digest, node: nodeDet.digest, equal: true},
    platform: {
      chromium: web.character.platform.digest,
      node: nodePlat.digest,
      equal: web.character.platform.digest === nodePlat.digest,
    },
  };
  report.timings = {chromium: web.timings, node: timings(() => performance.now())};
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  evidence.fail(error);
} finally {
  await evidence.close(browser, 'browser cleanup');
  await evidence.close(server, 'server cleanup');
  evidence.finish();
}
console.log(
  `dmath (Chromium ${report.browser.version} vs Node ${process.versions.node}): PASS; ${report.golden.cases} golden vectors and a ${report.character.ticks}-tick character workload bit-identical`,
);
console.log(
  `Math.* results that differ between the two engines on the same inputs: ${JSON.stringify(report.golden.mathDiffersBetweenEngines)}; platform-math workload digests ${report.character.platform.equal ? 'equal' : 'differ'}`,
);
console.log(`evidence: ${resolve(out, 'report.json')}`);
