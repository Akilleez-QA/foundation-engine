#!/usr/bin/env node
// scripts/play/sky-check.mjs (`npm run test:sky-browser`): the gradient sky and exp2 haze (VIS-05) in a real composed
// app, in the bench's muted, isolated headless Chromium (`?flags=dev.silent`), on the reference and low presets.
//   - the sky's colour at the horizon (the view's centre row) and near the top of the view match the authored
//     gradient within 10/255 per channel;
//   - a far crate in exp2 haze with `color: 'sky'` fades into the horizon colour; a near crate keeps its own colour;
//   - the sky costs one draw against the same view with a plain background;
//   - an idle scene draws no frames; a non-sky environment change keeps the sky texture; a sky change replaces it once
//     and disposes the old one; leaving the scene disposes the texture.
// Limitations: desktop Chromium with software GL; no physical device or visual-quality judgement beyond the pixels.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT, sleep} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {decodePng} from '../perf/quality-png.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out = resolve(process.argv[2] ?? '/tmp/foundation-sky-browser');
mkdirSync(out, {recursive: true});
const html =
  '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Sky diagnostic</title></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app" class="app-root"></main><script type="module" src="/scripts/play/fixtures/sky-entry.mjs"></script></body></html>';
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  plugins: [
    {
      name: 'sky-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/__sky.html')) {
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
    'Desktop Chromium with software GL only; no physical device or visual-quality acceptance.',
    'Colours are judged on 5x5 pixel patches.',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
const patch = async (p, at) => {
  const png = decodePng(await p.screenshot({type: 'png', clip: {x: at.x - 2, y: at.y - 2, width: 5, height: 5}}));
  const sum = [0, 0, 0];
  for (let i = 0; i < png.width * png.height; i++) for (let c = 0; c < 3; c++) sum[c] += png.data[i * 4 + c];
  return sum.map(v => Math.round(v / (png.width * png.height)));
};
const close = (got, want, tolerance, what) =>
  assert.ok(
    got.every((v, i) => Math.abs(v - want[i]) <= tolerance),
    `${what}: got ${got}, want ${want} (±${tolerance})`,
  );
const HORIZON = [0xf0, 0xa0, 0x60];
let browser;
try {
  await server.listen();
  for (const quality of ['reference', 'low']) {
    browser = await launch({width: 960, height: 640, strictClose: true});
    const p = browser.page,
      run = {quality};
    report.runs.push(run);
    const snap = () => p.evaluate(() => window.skyCheck.snapshot());
    const settle = async () => {
      let last = -1;
      for (let i = 0; i < 40; i++) {
        const {renders} = await snap();
        if (renders === last) return renders;
        last = renders;
        await sleep(250);
      }
      throw Error('the scene never went still');
    };
    const redrawDraws = async () => {
      const from = (await snap()).renders;
      await p.evaluate(() => window.skyCheck.redraw());
      await p.waitForFunction(n => window.skyCheck.snapshot().renders > n, from);
      return (await snap()).lastDraws;
    };
    await p.goto(`${server.resolvedUrls.local[0]}__sky.html?flags=dev.silent&quality=${quality}#scene/dusk`);
    await p.waitForFunction(
      () => window.skyCheck?.snapshot().scene === 'dusk' && window.skyCheck.snapshot().renders > 0,
      null,
      {
        timeout: 60000,
      },
    );
    await settle();
    await p.screenshot({path: resolve(out, `sky-${quality}.png`)});
    // The horizon is the view's centre row (a level camera); sample it left of centre, clear of both crates.
    run.horizon = await patch(p, await p.evaluate(() => window.skyCheck.at(0.25, 0.5)));
    close(run.horizon, HORIZON, 10, 'horizon');
    // Near the top of the view the elevation is atan(tan(fov/2) * 0.9) at the centre column.
    const elevation = await p.evaluate(() => Math.atan(Math.tan((window.skyCheck.fov() * Math.PI) / 360) * 0.9));
    run.top = await patch(p, await p.evaluate(() => window.skyCheck.at(0.5, 0.05)));
    close(run.top, await p.evaluate(e => window.skyCheck.expected(e), elevation), 10, 'top of the view');
    // The far crate vanishes into the horizon colour; the near one does not.
    run.far = await patch(p, await p.evaluate(() => window.skyCheck.at(0.43, 0.47)));
    close(run.far, HORIZON, 12, 'far crate in haze');
    run.near = await patch(p, await p.evaluate(() => window.skyCheck.at(0.71, 0.62)));
    assert.ok(
      Math.abs(run.near[0] - HORIZON[0]) + Math.abs(run.near[2] - HORIZON[2]) > 60,
      `near crate keeps its colour: ${run.near}`,
    );
    // Idle: nothing drawn.
    const idleFrom = (await snap()).renders;
    await sleep(800);
    run.idleRenders = (await snap()).renders - idleFrom;
    assert.equal(run.idleRenders, 0, 'an idle scene draws no frames');
    run.skyDraws = await redrawDraws();
    // A change that is not the sky keeps its texture; a sky change replaces it once and disposes the old one.
    const texture = (await snap()).skyTexture;
    assert.ok(texture);
    await p.evaluate(() => window.skyCheck.brighten());
    await settle();
    assert.equal((await snap()).skyTexture, texture, 'the texture is kept when the sky did not change');
    await p.evaluate(() => window.skyCheck.recolour());
    await settle();
    const recoloured = await snap();
    assert.notEqual(recoloured.skyTexture, texture);
    assert.ok(recoloured.disposed.includes(texture), 'the old sky texture is disposed');
    // The same view without a sky: one draw fewer; the sky texture is gone with the visit.
    await p.evaluate(() => window.skyCheck.goto('plain'));
    await p.waitForFunction(() => window.skyCheck.snapshot().scene === 'plain');
    await settle();
    run.plainDraws = await redrawDraws();
    const left = await snap();
    assert.equal(left.skyTexture, null);
    assert.ok(left.disposed.includes(recoloured.skyTexture), 'leaving disposes the sky texture');
    // The sky is one draw; the stars are one more (a scene that already has points pays only for the sky).
    assert.equal(run.skyDraws - run.plainDraws, 2, `sky and stars: ${run.skyDraws} vs ${run.plainDraws} draws`);
    assert.deepEqual(browser.errors, []);
    await browser.close();
    browser = null;
    console.log(
      `sky (${quality}): horizon ${run.horizon} · top ${run.top} · far crate ${run.far} · +${run.skyDraws - run.plainDraws} draws (sky + stars) · idle 0`,
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
console.log(`Gradient sky passed; evidence ${out}`);
