#!/usr/bin/env node
// scripts/play/blob-shadows-check.mjs (`npm run test:blob-shadows-browser`): blob (contact) shadows (VIS-10) in a real
// composed app, in the bench's muted, isolated headless Chromium (`?flags=dev.silent`), on the reference and low presets.
//   - all blobs are ONE draw: the scene draws exactly 1 call and 2 x drawn triangles more than its blob-less twin, and
//     the blob mesh casts no shadow (the twin has the same shadow casters);
//   - policy: the two capsules inside the sun's shadow box get no blob, the five beyond it want one, the cap of four
//     keeps the nearest four (one dropped) on both presets (their sun map is live: shadows.quality floor is low);
//   - the player's `shadows.quality: off` gives every capsule a blob (still capped at four);
//   - nothing redraws or uploads while idle; moving a capsule redraws and uploads once;
//   - leaving the scene disposes the blob mesh once.
// Limitations: desktop Chromium with software GL; no physical device, GPU timing or visual-quality judgement.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT, sleep} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';

const out = resolve(process.argv[2] ?? '/tmp/foundation-blob-shadows-browser');
mkdirSync(out, {recursive: true});
const html =
  '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Blob shadows diagnostic</title></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app" class="app-root"></main><script type="module" src="/scripts/play/fixtures/blob-shadows-entry.mjs"></script></body></html>';
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  plugins: [
    {
      name: 'blob-shadows-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/__blob-shadows.html')) {
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
  runs: [],
  limitations: [
    'Desktop Chromium with software GL only; no physical device, GPU timing or visual-quality acceptance.',
    'Draws and triangles are read from three.js renderer counters of the drawn frame, not the bench probe.',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
let browser;
try {
  await server.listen();
  for (const quality of ['reference', 'low']) {
    browser = await launch({width: 960, height: 640, strictClose: true});
    const p = browser.page,
      run = {quality};
    report.runs.push(run);
    const snap = () => p.evaluate(() => window.blobShadowsCheck.snapshot());
    const settle = async () => {
      let seen = -1;
      for (let i = 0; i < 60; i++) {
        const {renders} = await snap();
        if (renders === seen) return renders;
        seen = renders;
        await sleep(300);
      }
      throw Error('the scene never went still');
    };
    const redraw = async () => {
      const before = (await snap()).renders;
      assert.equal(await p.evaluate(() => window.blobShadowsCheck.redraw()), true);
      await p.waitForFunction(n => window.blobShadowsCheck.snapshot().renders > n, before);
      await settle();
      return snap();
    };
    await p.goto(`${server.resolvedUrls.local[0]}__blob-shadows.html?flags=dev.silent&quality=${quality}#scene/blobs`);
    await p.waitForFunction(() => window.blobShadowsCheck?.snapshot().blobs?.capacity === 4, null, {timeout: 60000});
    await settle();
    const shown = await redraw();
    run.blobs = shown.blobs;
    await p.screenshot({path: resolve(out, `blobs-${quality}.png`)});
    assert.deepEqual(
      [shown.blobs.candidates, shown.blobs.drawn, shown.blobs.dropped, shown.blobs.draws],
      [7, 4, 1, 1],
      'two capsules in the sun box have real shadows; five beyond want blobs; the cap keeps four',
    );
    assert.deepEqual(shown.blobMesh, {count: 4, castShadow: false, visible: true});

    // Idle: no frame, no upload.
    const idleFrom = await snap();
    await sleep(800);
    const idleTo = await snap();
    assert.equal(idleTo.renders - idleFrom.renders, 0, 'an idle scene draws no frames');
    assert.equal(idleTo.blobs.uploads, idleFrom.blobs.uploads, 'and uploads no instances');
    // A forced redraw of the still scene uploads nothing.
    assert.equal((await redraw()).blobs.uploads, idleTo.blobs.uploads, 'a redraw of a still scene uploads nothing');
    // Move a capsule beyond the box: one upload.
    await p.evaluate(() => window.blobShadowsCheck.move('far-a', 9));
    await settle();
    const moved = await snap();
    assert.ok(moved.renders > idleTo.renders, 'moving a capsule redraws');
    assert.equal(moved.blobs.uploads, idleTo.blobs.uploads + 1, 'and uploads once');

    // The player's shadows off: every capsule wants a blob, still capped.
    await p.evaluate(() => window.blobShadowsCheck.shadowQuality('off'));
    const off = await redraw();
    run.shadowsOff = off.blobs;
    await p.screenshot({path: resolve(out, `blobs-shadows-off-${quality}.png`)});
    assert.deepEqual([off.blobs.candidates, off.blobs.drawn, off.blobs.dropped], [7, 4, 3]);
    await p.evaluate(q => window.blobShadowsCheck.shadowQuality(q), quality === 'low' ? 'low' : 'ultra');
    const back = await redraw();
    assert.deepEqual(
      [back.blobs.drawn, back.blobs.dropped],
      [4, 1],
      'shadows back on: the sun hides its casters again',
    );

    // Cost: exactly one draw and two triangles per drawn blob over the twin; the same shadow casters.
    await p.evaluate(() => window.blobShadowsCheck.goto('twin'));
    await p.waitForFunction(() => window.blobShadowsCheck.snapshot().scene === 'twin', null, {timeout: 60000});
    await settle();
    const left = await snap();
    assert.equal(left.blobDisposed, 1, 'leaving disposes the blob mesh once');
    const twin = await redraw();
    run.cost = {
      blobs: shown.last,
      twin: twin.last,
      casters: [shown.casters, twin.casters],
    };
    assert.equal(twin.blobMesh, null);
    assert.equal(shown.last.calls - twin.last.calls, 1, 'all blobs are one draw call');
    assert.equal(shown.last.triangles - twin.last.triangles, 2 * 4, 'two triangles per drawn blob');
    assert.equal(shown.casters, twin.casters, 'blobs add no shadow caster');
    assert.deepEqual(browser.errors, []);
    await browser.close();
    browser = null;
    console.log(
      `blob shadows (${quality}): 7 candidates, 4 drawn in 1 draw (+${shown.last.triangles - twin.last.triangles} triangles), 1 dropped; shadows off ${off.blobs.drawn} drawn / ${off.blobs.dropped} dropped; idle 0; move 1 upload; disposed on exit`,
    );
  }
  report.passed = true;
} catch (error) {
  evidence.fail(error);
} finally {
  await evidence.close(browser, 'browser close');
  await evidence.close(server, 'server close');
  evidence.finish();
}
console.log(`Blob shadows passed; evidence ${out}`);
