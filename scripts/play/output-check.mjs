#!/usr/bin/env node
// scripts/play/output-check.mjs (`npm run test:output-browser`): scene output (tone mapping and exposure) in a real
// composed app, in the bench's muted, isolated headless Chromium (`?flags=dev.silent`), on the reference and low presets.
//   - a scene without `view.output` draws with three's fresh-renderer defaults (NoToneMapping, exposure 1), so its
//     bright emissive lantern clips to flat colour, as it always did;
//   - the same scene with `output: { toneMapping: 'aces', exposure: 0.5 }` keeps the lantern below clipping;
//   - an idle scene draws no frames; a run-time `ctx.view.output` change draws exactly once and applies to the
//     renderer; an equal value draws nothing;
//   - leaving for a scene without output gives it the default output again (a fresh renderer per lease).
// Limitations: desktop Chromium with software GL; no physical device, no visual quality judgement beyond the pixels.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT, sleep} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {decodePng} from '../perf/quality-png.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out = resolve(process.argv[2] ?? '/tmp/foundation-output-browser');
mkdirSync(out, {recursive: true});
const html =
  '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Output diagnostic</title></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app" class="app-root"></main><script type="module" src="/scripts/play/fixtures/output-entry.mjs"></script></body></html>';
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  plugins: [
    {
      name: 'output-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/__output.html')) {
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
    'Desktop Chromium with software GL only; no physical device, GPU or visual-quality acceptance.',
    'Clipping is judged on one 9x9 pixel patch at the lantern centre.',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
const NO_TONE_MAPPING = 0,
  ACES = 4;
let browser;
/** The mean colour of a 9x9 patch at the lantern's centre, from a real screenshot. */
const patch = async (p, at) => {
  const png = decodePng(await p.screenshot({type: 'png', clip: {x: at.x - 4, y: at.y - 4, width: 9, height: 9}}));
  const sum = [0, 0, 0];
  for (let i = 0; i < png.width * png.height; i++) for (let c = 0; c < 3; c++) sum[c] += png.data[i * 4 + c];
  return sum.map(v => Math.round(v / (png.width * png.height)));
};
try {
  await server.listen();
  for (const quality of ['reference', 'low']) {
    browser = await launch({width: 960, height: 640, strictClose: true});
    const p = browser.page,
      run = {quality};
    report.runs.push(run);
    const snap = () => p.evaluate(() => window.outputCheck.snapshot());
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
    await p.goto(`${server.resolvedUrls.local[0]}__output.html?flags=dev.silent&quality=${quality}#scene/plain`);
    await p.waitForFunction(
      () => window.outputCheck?.snapshot().scene === 'plain' && window.outputCheck.snapshot().renders > 0,
      null,
      {timeout: 60000},
    );
    await settle();
    const plain = await snap();
    assert.deepEqual(plain.output, {toneMapping: NO_TONE_MAPPING, exposure: 1}, 'default output is a fresh renderer');
    assert.deepEqual(plain.view, {toneMapping: 'none', exposure: 1});
    run.plain = await patch(p, plain.lantern);
    await p.screenshot({path: resolve(out, `output-none-${quality}.png`)});
    // The default clips: at least two channels saturate, so the warm lantern reads as flat yellow-white.
    assert.ok(run.plain.filter(c => c >= 254).length >= 2, `none clips: ${run.plain}`);

    await p.evaluate(() => window.outputCheck.goto('graded'));
    await p.waitForFunction(() => window.outputCheck.snapshot().scene === 'graded');
    await settle();
    const graded = await snap();
    assert.deepEqual(graded.output, {toneMapping: ACES, exposure: 0.5});
    run.aces = await patch(p, graded.lantern);
    await p.screenshot({path: resolve(out, `output-aces-${quality}.png`)});
    // ACES rolls the highlight off instead of clipping it: no channel saturates and the warm hue order survives.
    assert.ok(Math.max(...run.aces) < 254, `aces keeps the lantern below clipping: ${run.aces}`);
    assert.ok(run.aces[0] > run.aces[1] && run.aces[1] > run.aces[2] + 20, `aces keeps the lantern warm: ${run.aces}`);

    // Idle: nothing changed, nothing drawn.
    const idleFrom = (await snap()).renders;
    await sleep(800);
    run.idleRenders = (await snap()).renders - idleFrom;
    assert.equal(run.idleRenders, 0, 'an idle scene draws no frames');
    // A run-time change draws exactly once, then the scene is still again.
    const before = (await snap()).renders;
    await p.evaluate(() => window.outputCheck.setOutput({exposure: 1.6}));
    await p.waitForFunction(() => window.outputCheck.snapshot().output.exposure === 1.6);
    const after = await settle();
    run.changeRenders = after - before;
    assert.equal(run.changeRenders, 1, 'one redraw per output change');
    run.brighter = await patch(p, (await snap()).lantern);
    assert.ok(run.brighter[1] > run.aces[1], `more exposure is brighter: ${run.brighter} vs ${run.aces}`);
    const same = (await snap()).renders;
    await p.evaluate(() => window.outputCheck.setOutput({exposure: 1.6}));
    await sleep(600);
    assert.equal((await snap()).renders - same, 0, 'an equal output draws nothing');

    // Leaving: the next scene without output starts from the defaults again.
    await p.evaluate(() => window.outputCheck.goto('plain'));
    await p.waitForFunction(() => window.outputCheck.snapshot().scene === 'plain');
    await settle();
    assert.deepEqual((await snap()).output, {toneMapping: NO_TONE_MAPPING, exposure: 1});
    assert.deepEqual(browser.errors, []);
    await browser.close();
    browser = null;
    console.log(
      `output (${quality}): none ${run.plain} (clipped) · aces ${run.aces} (not clipped) · idle renders 0 · one redraw per change`,
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
console.log(`Scene output passed; evidence ${out}`);
