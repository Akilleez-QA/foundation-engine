#!/usr/bin/env node
// Opt-in finite desktop diagnostic; run only in the serialized browser slot.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
const out = resolve(process.argv[2] ?? 'playtest/regional-surface');
mkdirSync(out, {recursive: true});
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Regional canonical surface diagnostic</title><style>
body{margin:0;background:#101827;color:#eaf0fa;font:16px system-ui}main{max-width:1000px;margin:16px auto}h1{font-size:25px;margin:8px 0}p{margin:8px 0;color:#bed0e5}canvas{display:block;width:100%;height:auto}fieldset{border:1px solid #486382;margin:12px 0;padding:10px}button,select{font:inherit;color:#fff;background:#263b56;border:1px solid #7b9dbb;border-radius:4px;padding:8px;margin:3px}button:disabled{opacity:.4}button:focus-visible,select:focus-visible{outline:3px solid #ffde77;outline-offset:2px}small{display:block;color:#b2c2d7}</style></head><body><main>
<h1>Four regions, one accepted landscape</h1><p id="status" role="status" aria-live="polite"></p><canvas width="1000" height="600" aria-label="Four coloured terrain cores with mixed-detail chunks"></canvas>
<fieldset><legend>Creator-selected replacement policy</legend><label>Request <select id="mode"><option value="normal">Raise / restore shared vertex</option><option value="failure">Invalid worker evaluator parameters</option><option value="view-failure">Fail after two candidate meshes</option><option value="refusal">Insufficient worker reservation</option></select></label><button id="edit">Prepare edit</button><button id="retry">Retry normal edit</button><button id="release">Review worker results</button><button id="publish">Publish four together</button><button id="cancel">Cancel replacement</button><button id="close">Close view</button><button id="reenter">Reenter view</button></fieldset>
<small>Desktop diagnostic. Results are held for explicit review, then published together. Pending, refused, failed and cancelled work keeps the previous rendered landscape and canonical contact queries. Tab and Enter operate every control.</small>
</main><script type="module" src="/scripts/play/fixtures/regional-surface-entry.mjs"></script></body></html>`;
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  plugins: [
    {
      name: 'regional-surface-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/__regional-surface-check.html')) return next();
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
    'Finite desktop diagnostic, not a device performance certification or global terrain streamer.',
    'Eight rendered chunks use creator-selected strides 1 and 2; canonical contacts remain full resolution.',
    'Worker completion is held by a visible review control to inspect lifetime transitions deterministically.',
    'The independent oracle covers a bounded heightfield without material/exclusion semantics.',
  ],
};
let browser;
try {
  await server.listen();
  browser = await launch({width: 1120, height: 1000});
  const page = browser.page;
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push(`console: ${message.text()}`);
  });
  await page.goto(`${server.resolvedUrls.local[0]}__regional-surface-check.html?flags=dev.silent`);
  await page.waitForFunction(() => !!window.regionalSurface);
  const state = () => page.evaluate(() => window.regionalSurface.state());
  const wait = phase => page.waitForFunction(p => window.regionalSurface.state().phase === p, phase);
  const click = id => page.locator(`#${id}`).click();
  const stable = (actual, expected) => {
    for (const key of [
      'revision',
      'queryHeight',
      'queryStatus',
      'acceptedRevisions',
      'renderRevision',
      'oracle',
      'leftHaloNormal',
    ])
      assert.deepEqual(actual[key], expected[key], `${key} changed before publication`);
  };
  const oracle = s => {
    assert.equal(s.oracle.haloLeaks, 0);
    assert.ok(s.oracle.positionError < 1e-7);
    assert.ok(s.oracle.normalError < 1e-10);
    assert.ok(s.oracle.renderNormalError < 1e-6);
    assert.ok(s.oracle.contactError < 1e-7);
    assert.ok(s.oracle.rayError < 1e-6);
    assert.ok(s.oracle.boundExcess < 1e-6);
    assert.deepEqual(s.acceptedRevisions, [s.revision, s.revision, s.revision, s.revision]);
    assert.deepEqual(s.renderRevision, s.acceptedRevisions);
    assert.equal(s.sceneMeshes, 8);
  };
  const initial = await state();
  oracle(initial);
  assert.equal(initial.phase, 'accepted');
  assert.equal(initial.workers.workersAvailable, true);
  assert.ok(initial.workers.workers > 0);
  assert.ok(initial.workers.peakRunning > 0);
  assert.ok(initial.strides.includes(1) && initial.strides.includes(2));
  await page.screenshot({path: resolve(out, 'initial.png')});
  // Native keyboard activation, not an exposed mutation API.
  await page.locator('#edit').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.regionalSurface.state().settled);
  const pending = await state();
  stable(pending, initial);
  assert.equal(pending.phase, 'pending');
  await page.screenshot({path: resolve(out, 'pending.png')});
  await click('release');
  await wait('ready');
  const ready = await state();
  stable(ready, initial);
  assert.equal(ready.candidate, true);
  await page.locator('#publish').focus();
  await page.keyboard.press('Enter');
  await wait('accepted');
  const published = await state();
  oracle(published);
  assert.equal(published.raised, true);
  assert.equal(published.publications, 1);
  assert.notEqual(published.queryHeight, initial.queryHeight);
  assert.notDeepEqual(published.leftHaloNormal, initial.leftHaloNormal);
  await page.screenshot({path: resolve(out, 'published.png')});
  await page.locator('#mode').selectOption('view-failure');
  await click('edit');
  await page.waitForFunction(() => window.regionalSurface.state().settled);
  await click('release');
  await wait('failed');
  const viewFailed = await state();
  stable(viewFailed, published);
  assert.equal(viewFailed.sceneMeshes, 8);
  assert.equal(viewFailed.candidate, false);
  assert.match(viewFailed.lastOutcome, /^Intentional diagnostic:/);
  for (const kind of ['geometries', 'materials']) {
    assert.equal(viewFailed.resources[`${kind}Created`] - published.resources[`${kind}Created`], 2);
    assert.equal(viewFailed.resources[`${kind}Disposed`] - published.resources[`${kind}Disposed`], 2);
    assert.equal(viewFailed.resources[`${kind}Created`] - viewFailed.resources[`${kind}Disposed`], 8);
  }
  assert.equal(viewFailed.resources.duplicateDisposals, 0);
  // Retry must prepare a complete replacement after rollback; cancelling it retains the accepted document.
  await click('retry');
  await page.waitForFunction(() => window.regionalSurface.state().settled);
  await click('release');
  await wait('ready');
  const recoveredView = await state();
  stable(recoveredView, published);
  assert.equal(recoveredView.candidate, true);
  await click('cancel');
  await page.locator('#mode').selectOption('failure');
  await click('edit');
  await wait('failed');
  const failed = await state();
  stable(failed, published);
  assert.match(failed.lastOutcome, /parameters|job|worker/i);
  await page.locator('#mode').selectOption('refusal');
  await click('edit');
  await page.waitForFunction(() => window.regionalSurface.state().settled);
  await click('release');
  await wait('refused');
  const refused = await state();
  stable(refused, published);
  await click('retry');
  await page.waitForFunction(() => window.regionalSurface.state().settled);
  await click('cancel');
  await page.waitForFunction(() => window.regionalSurface.state().lateIgnored > 0);
  const cancelled = await state();
  stable(cancelled, published);
  assert.equal(cancelled.candidate, false);
  await click('retry');
  await page.waitForFunction(() => window.regionalSurface.state().settled);
  const beforeClose = await state();
  await click('close');
  await click('reenter');
  await page.waitForFunction(n => window.regionalSurface.state().lateIgnored > n, beforeClose.lateIgnored);
  const reentered = await state();
  stable(reentered, published);
  assert.equal(reentered.session, beforeClose.session + 1);
  assert.equal(reentered.candidate, false);
  assert.equal(reentered.sceneMeshes, 8);
  await click('retry');
  await page.waitForFunction(() => window.regionalSurface.state().settled);
  await click('release');
  await wait('ready');
  await click('publish');
  await wait('accepted');
  const restored = await state();
  oracle(restored);
  assert.equal(restored.raised, false);
  assert.equal(restored.publications, 2);
  assert.equal(restored.queryHeight, initial.queryHeight);
  await page.screenshot({path: resolve(out, 'restored.png')});
  const unchanged = await state();
  assert.deepEqual(await state(), unchanged, 'reading diagnostics must not redraw or allocate a generation');
  await click('close');
  const closed = await state();
  assert.equal(closed.closed, true);
  assert.equal(closed.workers.reservedBytes, 0);
  assert.equal(closed.sceneMeshes, 0);
  assert.equal(closed.resources.geometriesCreated, closed.resources.geometriesDisposed);
  assert.equal(closed.resources.materialsCreated, closed.resources.materialsDisposed);
  assert.equal(closed.resources.duplicateDisposals, 0);
  assert.deepEqual(report.errors, []);
  writeFileSync(
    resolve(out, 'snapshots.json'),
    JSON.stringify(
      {
        initial,
        pending,
        ready,
        published,
        viewFailed,
        recoveredView,
        failed,
        refused,
        cancelled,
        reentered,
        restored,
        closed,
      },
      null,
      2,
    ),
  );
  report.passed = true;
  console.log(`Regional surface diagnostic passed; evidence ${out}`);
} catch (error) {
  report.errors.push(String(error));
  throw error;
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  try {
    await browser?.close();
  } finally {
    await server.close();
  }
}
