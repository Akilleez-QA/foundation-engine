#!/usr/bin/env node
// scripts/play/interior-reflection-check.mjs (`npm run test:interior-reflection-browser`): the procedural interior reflection
// (`environment.reflection: { kind: 'interior' }`) in a real composed app, in the bench's muted, isolated headless Chromium
// (`?flags=dev.silent`), on the reference and low presets.
//   - a mirror-like metal sphere lit only by its environment shows the interior's light at its centre and the dim walls
//     near its rim; the same sphere without a reflection stays dark;
//   - the interior is prefiltered (PMREM) once per interior: a republished environment with equal interior data builds nothing,
//     a changed interior builds one replacement and disposes the old texture, leaving the scene disposes it;
//   - a redraw costs the same draws with and without the interior (no per-frame cost); an idle scene draws no frames.
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
const out = resolve(process.argv[2] ?? '/tmp/foundation-interior-reflection-browser');
mkdirSync(out, {recursive: true});
const html =
  '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Interior reflection diagnostic</title></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app" class="app-root"></main><script type="module" src="/scripts/play/fixtures/interior-reflection-entry.mjs"></script></body></html>';
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  plugins: [
    {
      name: 'interior-reflection-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/__interior.html')) {
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
let browser;
try {
  await server.listen();
  for (const quality of ['reference', 'low']) {
    browser = await launch({width: 960, height: 640, strictClose: true});
    const p = browser.page,
      run = {quality};
    report.runs.push(run);
    const snap = () => p.evaluate(() => window.interiorCheck.snapshot());
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
      await p.evaluate(() => window.interiorCheck.redraw());
      await p.waitForFunction(n => window.interiorCheck.snapshot().renders > n, from);
      return (await snap()).lastDraws;
    };
    const centre = () => p.evaluate(() => window.interiorCheck.at(0.5, 0.5));
    await p.goto(`${server.resolvedUrls.local[0]}__interior.html?flags=dev.silent&quality=${quality}#scene/interior`);
    await p.waitForFunction(
      () => window.interiorCheck?.snapshot().scene === 'interior' && window.interiorCheck.snapshot().environment,
      null,
      {timeout: 60000},
    );
    await settle();
    await p.screenshot({path: resolve(out, `interior-${quality}.png`)});
    const first = await snap();
    assert.equal(first.prefilters, 1, 'the interior is prefiltered once');
    // The sphere's centre faces the camera and mirrors the light behind it; near its rim it mirrors the walls.
    run.centre = await patch(p, await centre());
    run.rim = await patch(p, await p.evaluate(() => window.interiorCheck.at(0.5, 0.5 - 0.17)));
    assert.ok(Math.min(...run.centre) > 150, `the light shows at the centre: ${run.centre}`);
    assert.ok(Math.max(...run.rim) < 100, `the dim walls show near the rim: ${run.rim}`);
    // Idle: nothing drawn.
    const idleFrom = (await snap()).renders;
    await sleep(800);
    run.idleRenders = (await snap()).renders - idleFrom;
    assert.equal(run.idleRenders, 0, 'an idle scene draws no frames');
    run.interiorDraws = await redrawDraws();
    assert.equal((await snap()).prefilters, 1, 'a redraw builds nothing');
    // Equal interior data in a republished environment keeps the texture and its prefilter.
    await p.evaluate(() => window.interiorCheck.republish());
    await settle();
    const kept = await snap();
    assert.equal(kept.environment, first.environment, 'equal interior data keeps its texture');
    assert.equal(kept.prefilters, 1);
    // A changed interior: one replacement, prefiltered once, the old texture disposed; the light turns red.
    await p.evaluate(() => window.interiorCheck.relight());
    await p.waitForFunction(e => window.interiorCheck.snapshot().environment !== e, first.environment);
    await settle();
    const relit = await snap();
    assert.equal(relit.prefilters, 2, 'a changed interior is prefiltered once');
    assert.ok(relit.disposed.includes(first.environment), 'the old interior texture is disposed');
    run.relit = await patch(p, await centre());
    assert.ok(run.relit[0] > 150 && run.relit[2] < 60, `the reflected light turned red: ${run.relit}`);
    // The same view without a reflection: dark, the same draws, and the interior texture gone with the visit.
    await p.evaluate(() => window.interiorCheck.goto('plain'));
    await p.waitForFunction(() => window.interiorCheck.snapshot().scene === 'plain');
    await settle();
    const left = await snap();
    assert.equal(left.environment, null);
    assert.ok(left.disposed.includes(relit.environment), 'leaving disposes the interior texture');
    run.plain = await patch(p, await centre());
    assert.ok(Math.max(...run.plain) < 40, `without a reflection the sphere stays dark: ${run.plain}`);
    run.plainDraws = await redrawDraws();
    assert.equal(
      run.interiorDraws,
      run.plainDraws,
      `per-frame draws: ${run.interiorDraws} with the interior vs ${run.plainDraws}`,
    );
    assert.deepEqual(browser.errors, []);
    await browser.close();
    browser = null;
    console.log(
      `interior reflection (${quality}): centre ${run.centre} · rim ${run.rim} · relit ${run.relit} · plain ${run.plain} · ` +
        `draws ${run.interiorDraws}/${run.plainDraws} · prefilters 2 · idle 0`,
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
console.log(`Interior reflection passed; evidence ${out}`);
