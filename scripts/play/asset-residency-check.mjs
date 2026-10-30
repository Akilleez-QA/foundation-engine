#!/usr/bin/env node
// RES-01 opt-in native diagnostic (docs/guides/asset-residency.md): texture residency estimates against the bytes three
// uploads, renderer.info.memory counts across park/re-acquire, and an actual WebGL context loss and restoration.
// Run: ENGINE_CHROMIUM=<chromium> node -r ./scripts/silent-browser.cjs scripts/play/asset-residency-check.mjs [out-dir]
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
const out = resolve(process.argv[2] ?? '/tmp/foundation-asset-residency');
mkdirSync(out, {recursive: true});
const html =
  '<!doctype html><html><head><link rel="icon" href="data:,"><title>Asset residency diagnostic</title></head><body><script type="module" src="/scripts/play/fixtures/asset-residency-entry.mjs"></script></body></html>';
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  plugins: [
    {
      name: 'residency-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/__residency.html')) {
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
  steps: {},
  limitations: [
    'Isolated Chromium WebGL2 fixture of the texture library; estimates and counts, not driver memory, device timing or whole-scene restoration',
  ],
};
let browser;
try {
  await server.listen();
  browser = await launch({width: 320, height: 240});
  const p = browser.page;
  report.browser = browser.version;
  await p.goto(`${server.resolvedUrls.local[0]}__residency.html?flags=dev.silent`);
  await p.waitForFunction(() => window.residencyCheck);
  const call = name => p.evaluate(n => window.residencyCheck[n](), name);
  const red = px => px[0] >= 250 && px[1] <= 5 && px[2] <= 5;

  const setup = (report.steps.setup = await call('setup'));
  assert.equal(setup.drawn.memory.textures, 3, 'renderer.info counts one upload per live library texture');
  assert.ok(red(setup.drawn.pixel), `drawn pixel ${setup.drawn.pixel}`);
  for (const e of setup.estimates)
    assert.ok(Math.abs(e.ratio - 1) < 0.01, `${e.id} estimate within 1% of the uploaded mip chain (${e.ratio})`);

  const exit = (report.steps.exit = await call('exit'));
  assert.equal(
    exit.memory.textures,
    0,
    'after scene exit no texture stays on the GPU: the pin was parked, the rest disposed',
  );
  assert.equal(exit.stats.pinnedMiB * 1024 * 1024, exit.heroBytes, 'the pinned texture is retained CPU-side');
  assert.equal(exit.stats.disposed, 2);

  const again = (report.steps.reacquire = await call('reacquire'));
  assert.equal(again.stats.loads, 3, 'the pinned texture is not fetched or decoded again');
  assert.equal(again.memory.textures, 1, 're-acquired texture uploaded by the next draw');
  assert.ok(red(again.pixel));

  await call('lose');
  await p.waitForFunction(() => window.residencyCheck.snapshot().events.includes('lost'));
  await call('restore');
  await p.waitForFunction(() => window.residencyCheck.snapshot().events.includes('restored'));
  const restored = (report.steps.restored = await call('afterRestore'));
  assert.ok(red(restored.pixel), `restored pixel ${restored.pixel}`);
  assert.equal(restored.memory.textures, 1);
  assert.equal(restored.stats.loads, 3, 'restoration re-uploads from the retained source without a reload');

  const down = (report.steps.teardown = await call('teardown'));
  assert.equal(down.owned, false);
  assert.equal(down.stats.residentMiB, 0);
  assert.deepEqual(browser.errors, []);
  report.passed = true;
} catch (error) {
  report.error = String(error?.stack ?? error);
  throw error;
} finally {
  try {
    await browser?.close();
  } finally {
    await server.close();
  }
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(`Asset residency native check passed; evidence ${out}`);
