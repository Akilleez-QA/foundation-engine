#!/usr/bin/env node
// scripts/play/lights-check.mjs (`npm run test:lights-browser`): local lights (VIS-02) in a real composed app, in the
// bench's muted, isolated headless Chromium (`?flags=dev.silent`), on the reference and low presets.
//   - the floor under a lantern's point light is brighter than the floor 10 m away (outside every light's reach);
//   - the visit's rig is fixed: as many three.js point and spot lights as slots, whatever is spawned or despawned;
//   - spawning and despawning a light links no program (no recompile, STD-REN-11), and each draws once;
//   - an idle scene draws no frames; a light's intensity change draws once;
//   - low (`lights.local-max` 2): the essential lantern keeps its slot, the third lantern is refused and reported
//     exactly once, and it is admitted when a slot frees;
//   - leaving the scene removes every light.
// Limitations: desktop Chromium with software GL; no physical device, GPU timing, fill-rate or visual-quality judgement.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT, sleep} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {decodePng} from '../perf/quality-png.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out = resolve(process.argv[2] ?? '/tmp/foundation-lights-browser');
mkdirSync(out, {recursive: true});
const html =
  '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Lights diagnostic</title></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app" class="app-root"></main><script type="module" src="/scripts/play/fixtures/lights-entry.mjs"></script></body></html>';
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  plugins: [
    {
      name: 'lights-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/__lights.html')) {
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
    'Desktop Chromium with software GL only; no physical device, GPU timing, fill-rate or visual-quality acceptance.',
    'Brightness is judged on 9x9 pixel patches of the floor.',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
const luminance = ([r, g, b]) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
const patch = async (p, at) => {
  const png = decodePng(await p.screenshot({type: 'png', clip: {x: at.x - 4, y: at.y - 4, width: 9, height: 9}}));
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
    const snap = () => p.evaluate(() => window.lightsCheck.snapshot());
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
    await p.goto(`${server.resolvedUrls.local[0]}__lights.html?flags=dev.silent&quality=${quality}#scene/lamps`);
    await p.waitForFunction(
      () => window.lightsCheck?.snapshot().scene === 'lamps' && window.lightsCheck.snapshot().renders > 0,
      null,
      {timeout: 60000},
    );
    await settle();
    const start = await snap();
    run.start = start;
    const slots = quality === 'low' ? {point: 2, spot: 1} : {point: 3, spot: 1};
    assert.deepEqual(start.lights.slots, slots);
    assert.deepEqual({points: start.rig.points, spots: start.rig.spots}, {points: slots.point, spots: slots.spot});
    await p.screenshot({path: resolve(out, `lights-${quality}.png`)});
    // Lit floor near a lantern, dark floor 10 m away (outside every light's 6 m reach and the spot's cone).
    const near = await patch(p, await p.evaluate(() => window.lightsCheck.at(-5, 3)));
    const far = await patch(p, await p.evaluate(() => window.lightsCheck.at(5, 3)));
    run.near = near;
    run.far = far;
    assert.ok(luminance(near) > luminance(far) + 30, `the lantern lights the floor: near ${near}, far ${far}`);
    // Idle: nothing drawn.
    const idleFrom = (await snap()).renders;
    await sleep(800);
    run.idleRenders = (await snap()).renders - idleFrom;
    assert.equal(run.idleRenders, 0, 'an idle scene draws no frames');
    // A change of intensity draws once.
    const dimFrom = (await snap()).renders;
    await p.evaluate(() => window.lightsCheck.dim('lantern-a', 4));
    run.dimRenders = (await settle()) - dimFrom;
    assert.equal(run.dimRenders, 1, 'one redraw per light change');
    if (quality === 'low') {
      // Two point slots: the essential lantern and the first other one; the third is refused, reported once.
      assert.deepEqual(start.lights.admitted, {point: 2, spot: 1});
      const refusals = browser.errors.filter(e => /PointLight\(s\) not drawn/.test(e));
      assert.equal(refusals.length, 1, `refusal reported once: ${browser.errors.join(' | ')}`);
      assert.equal(start.lights.refused.full, 1);
      await p.evaluate(() => window.lightsCheck.despawn('lantern-b'));
      await settle();
      const after = await snap();
      assert.deepEqual(after.lights.admitted, {point: 2, spot: 1}, 'the refused lantern takes the freed slot');
      assert.equal(after.lights.refused.full, 0);
      browser.errors.splice(
        0,
        browser.errors.length,
        ...browser.errors.filter(e => !/PointLight\(s\) not drawn/.test(e)),
      );
    } else {
      assert.deepEqual(start.lights.admitted, {point: 3, spot: 1});
      // Free a slot, then spawn and despawn a lantern: no program links, one redraw each, the rig unchanged.
      await p.evaluate(() => window.lightsCheck.despawn('lantern-c'));
      await settle();
      const before = await snap();
      await p.evaluate(() => window.lightsCheck.spawn('lantern-d'));
      const spawned = await settle();
      const mid = await snap();
      assert.equal(spawned - before.renders, 1, 'a spawned light draws once');
      assert.equal(mid.programs, before.programs, 'spawning a light links no program');
      assert.deepEqual(mid.lights.admitted, {point: 3, spot: 1});
      await p.evaluate(() => window.lightsCheck.despawn('lantern-d'));
      const gone = await settle();
      const end = await snap();
      assert.equal(gone - mid.renders, 1, 'a despawned light draws once');
      assert.equal(end.programs, before.programs, 'despawning a light links no program');
      assert.deepEqual({points: end.rig.points, spots: end.rig.spots}, {points: 3, spots: 1}, 'the rig never changes');
      run.programs = {before: before.programs, after: end.programs};
    }
    // Leaving removes every light with the visit.
    await p.evaluate(() => window.lightsCheck.goto('other'));
    await p.waitForFunction(() => window.lightsCheck.snapshot().scene === 'other');
    await settle();
    assert.deepEqual((await snap()).rig, {points: 0, spots: 0, lit: 0});
    assert.deepEqual(browser.errors, []);
    await browser.close();
    browser = null;
    console.log(
      `lights (${quality}): slots ${slots.point}+${slots.spot} · near floor ${luminance(near)} vs far ${luminance(far)} · idle 0 · one redraw per change`,
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
console.log(`Local lights passed; evidence ${out}`);
