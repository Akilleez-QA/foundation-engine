#!/usr/bin/env node
// Real Chromium module-worker acceptance through the production WorkerHost and discovered loader table.
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';

const out = resolve(process.argv[2] ?? 'playtest/cellular-wasm');
mkdirSync(out, {recursive: true});
const sourcePaths = [
  'src/core/rng.ts',
  'src/kits/procgen/grid-job.ts',
  'src/kits/procgen/cellular.ts',
  'src/kits/procgen/cellular-wasm.ts',
  'src/kits/procgen/cellular-wasm-bytes.ts',
  'src/kits/procgen/workers/cellular-wasm.job.ts',
  'src/platform/workers/host.ts',
  'src/platform/workers/job.ts',
  'src/platform/workers/job-rows.ts',
  'src/platform/workers/pool-sizing.ts',
  'src/platform/workers/worker-entry.ts',
  'src/platform/workers/worker-runtime.ts',
  'scripts/play/cellular-wasm-check.mjs',
  'scripts/play/fixtures/cellular-wasm-entry.mjs',
].sort();
const sourceIdentity = () => {
  const hash = createHash('sha256');
  const files = sourcePaths.map(path => {
    const bytes = readFileSync(resolve(ROOT, path));
    // Length-framed, sorted path/byte pairs distinguish both content and file boundaries.
    hash.update(`${Buffer.byteLength(path)}:${path}:${bytes.length}:`);
    hash.update(bytes);
    return {path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
  });
  return {
    algorithm: 'sha256',
    framing: 'UTF-8 path byte length:path:file byte length:raw file bytes',
    digest: hash.digest('hex'),
    files,
  };
};
const report = {
  baseRevision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  dirtyWorktree: execFileSync('git', ['status', '--porcelain'], {cwd: ROOT, encoding: 'utf8'}).trim().length > 0,
  source: sourceIdentity(),
  environment: {node: process.version, platform: process.platform, architecture: process.arch, tempDirectory: tmpdir()},
  passed: false,
  errors: [],
  workerUrls: [],
  limitations: [
    'Isolated Chromium acceptance; timer progress proves task scheduling, not a physical-device latency or throughput guarantee.',
  ],
};
const server = await createServer({
  configFile: false,
  root: ROOT,
  publicDir: false,
  logLevel: 'error',
  server: {host: '127.0.0.1', port: 0, watch: null},
  worker: {format: 'es'},
  optimizeDeps: {noDiscovery: true, include: []},
  plugins: [
    {
      name: 'cellular-wasm-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/__cellular-wasm.html')) return next();
          res.setHeader('Content-Type', 'text/html');
          res.end(
            '<!doctype html><title>Cellular WASM diagnostic</title><script type="module" src="/scripts/play/fixtures/cellular-wasm-entry.mjs"></script>',
          );
        });
      },
    },
  ],
});
let browser;
try {
  await server.listen();
  browser = await launch({width: 800, height: 600, strictClose: true});
  report.environment.browserVersion = browser.browser.version();
  report.environment.browserExecutable = browser.executable;
  report.environment.launchArguments = browser.launchArguments;
  browser.page.on('pageerror', error => report.errors.push(String(error)));
  browser.page.on('worker', worker => report.workerUrls.push(worker.url()));
  await browser.page.goto(`${server.resolvedUrls.local[0]}__cellular-wasm.html?flags=dev.silent`);
  await browser.page.waitForFunction(() => !!window.runCellularWasmCheck, null, {timeout: 30_000});
  report.result = await browser.page.evaluate(async () => {
    let deadline;
    try {
      return await Promise.race([
        window.runCellularWasmCheck(),
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(Error('acceptance exceeded 60 seconds')), 60_000);
        }),
      ]);
    } finally {
      clearTimeout(deadline);
    }
  });
  assert.ok(report.workerUrls.length >= 2, 'browser did not create genuine workers');
  assert.ok(report.workerUrls.every(url => url.includes('/src/platform/workers/worker-entry.ts')));
  assert.equal(report.result.completion.workersAvailable, true);
  assert.equal(report.result.completion.peakRunning, 2);
  assert.equal(report.result.fallback.workers, 0);
  assert.equal(report.result.fallback.workersAvailable, false);
  assert.deepEqual(report.errors, []);
  assert.equal(sourceIdentity().digest, report.source.digest, 'checked sources changed during browser acceptance');
  report.passed = true;
} catch (error) {
  report.failure = String(error?.stack ?? error);
  throw error;
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  try {
    await browser?.close();
  } finally {
    await server.close();
  }
}
console.log(`cellular-wasm: PASS; ${out}`);
