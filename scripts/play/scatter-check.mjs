#!/usr/bin/env node
// scripts/play/scatter-check.mjs (`npm run test:scatter-browser`): instanced scatter in a real composed app, in the
// bench's muted, isolated headless Chromium (`?flags=dev.silent`).
//   - each admitted scatter is one draw: a box plus three scatters (1,400 grass cones, 60 rocks, 8 posts) draw 4 calls;
//   - the renderer's triangle count equals the box plus every scatter's triangles x kept copies (budgets are honest);
//   - the `effects.scatter-density` knob thins non-essential scatters on the low preset; essential posts keep all 8;
//   - placement is deterministic: leaving and re-entering draws the same instance buffers;
//   - nothing redraws when idle; moving a scatter's origin redraws once without a rebuild;
//   - leaving disposes every instance buffer.
// It also writes before/after pictures and draw counts of a courtyard ported from a creator trial (lanterns as one
// entity per part, then as point scatters plus grass and rocks). Limitations: desktop Chromium with software GL.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT, sleep} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';

const out = resolve(process.argv[2] ?? '/tmp/foundation-scatter-browser');
mkdirSync(out, {recursive: true});
const html =
  '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Scatter diagnostic</title></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app" class="app-root"></main><script type="module" src="/scripts/play/fixtures/scatter-entry.mjs"></script></body></html>';
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  plugins: [
    {
      name: 'scatter-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/__scatter.html')) {
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
    await p.goto(`${server.resolvedUrls.local[0]}__scatter.html?flags=dev.silent&quality=${quality}#scene/yard`);
    const snap = () => p.evaluate(() => window.scatterCheck.snapshot());
    await p.waitForFunction(() => window.scatterCheck.snapshot().scatter?.scatters === 3, null, {timeout: 60000});
    await sleep(500);
    const s = await snap();
    run.yard = {calls: s.last.calls, triangles: s.last.triangles, scatter: s.scatter};
    const by = name => s.scatter.list.find(l => l.name === name);
    assert.equal(s.last.calls, 4, 'a box and three scatters: four draws');
    assert.equal(s.last.triangles, 12 + s.scatter.triangles, 'renderer triangles = box + every kept copy');
    assert.equal(by('posts').instances, 8, 'essential posts are never thinned');
    if (quality === 'reference') {
      assert.deepEqual([by('grass').instances, by('rocks').instances], [1400, 60]);
    } else {
      assert.ok(
        by('grass').instances < 1400 * 0.45 && by('grass').instances > 1400 * 0.25,
        `low thins grass (${by('grass').instances})`,
      );
      assert.ok(by('rocks').instances < 60, 'low thins rocks');
    }
    assert.equal(by('grass').requested, 1400);
    // Idle: once the start-up frames have settled (no new frame for a second), nothing is drawn.
    for (let still = 0, seen = -1, i = 0; still < 4 && i < 40; i++) {
      const r = (await snap()).renders;
      still = r === seen ? still + 1 : 0;
      seen = r;
      await sleep(250);
    }
    const idle = (await snap()).renders;
    await sleep(800);
    assert.equal((await snap()).renders - idle, 0, 'an idle scene draws no frames');
    // Move the origin: one redraw, same buffers.
    const print = s.fingerprint;
    await p.evaluate(() => window.scatterCheck.shift(0.5));
    await sleep(600);
    const moved = await snap();
    assert.equal(moved.renders - idle, 1, 'moving a scatter redraws once');
    assert.equal(moved.fingerprint, print, 'and does not rebuild its instances');
    assert.equal(moved.instancedDisposed, 0);
    // Leave and come back: the same layout; leaving disposed the three instance buffers.
    await p.evaluate(() => window.scatterCheck.goto('other'));
    await p.waitForFunction(() => window.scatterCheck.snapshot().scene === 'other');
    await sleep(300);
    assert.equal((await snap()).instancedDisposed, 3, 'leaving disposes every instance buffer');
    await p.evaluate(() => window.scatterCheck.goto('yard'));
    await p.waitForFunction(() => window.scatterCheck.snapshot().scatter?.scatters === 3, null, {timeout: 60000});
    await sleep(500);
    assert.equal((await snap()).fingerprint, print, 'the same placement on every visit');
    await p.screenshot({path: resolve(out, `yard-${quality}.png`)});
    // Before/after courtyard.
    for (const id of ['before', 'after']) {
      await p.evaluate(s => window.scatterCheck.goto(s), id);
      await p.waitForFunction(s => window.scatterCheck.snapshot().scene === s, id, {timeout: 60000});
      await sleep(1200);
      const shot = await snap();
      run[id] = {calls: shot.last.calls, triangles: shot.last.triangles, scatter: shot.scatter};
      await p.screenshot({path: resolve(out, `courtyard-${id}-${quality}.png`)});
    }
    assert.ok(
      run.after.calls < run.before.calls,
      'the scattered courtyard draws fewer calls despite its grass and rocks',
    );
    assert.deepEqual(browser.errors, []);
    await browser.close();
    browser = null;
    console.log(
      `scatter (${quality}): 3 scatters in 3 draws, ${s.scatter.instances} copies, ${s.last.triangles} triangles matched; idle 0; move 1 redraw, no rebuild; same layout on re-entry; courtyard ${run.before.calls} -> ${run.after.calls} draws (${run.before.triangles} -> ${run.after.triangles} triangles)`,
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
console.log(`Scatter passed; evidence ${out}`);
