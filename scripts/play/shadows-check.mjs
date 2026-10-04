#!/usr/bin/env node
// scripts/play/shadows-check.mjs (`npm run test:shadows-browser`): creator shadows (VIS-03) in a real composed app, in
// the bench's muted, isolated headless Chromium (`?flags=dev.silent`), on the reference and low presets.
//   - the floor where the crate's shadow falls is darker with shadows than the same spot without them;
//   - only opted-in lights cast: the sun always (its map follows shadows.quality), the lantern's point light at
//     reference (lights.shadowed-max 4) but not at low (0), where its request is reported exactly once; a shadow
//     request in a scene without sceneShadows() is drawn without a shadow and reported once;
//   - a forced redraw of a still scene draws no shadow-map (off-screen) draws: maps redraw only on change
//     (shadowDrawsIdle 0); moving a caster redraws them once; an idle scene draws no frames;
//   - a scene without sceneShadows() draws no off-screen pass at all.
// Limitations: desktop Chromium with software GL; no physical device, GPU timing or visual-quality judgement.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT, sleep} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {decodePng} from '../perf/quality-png.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out = resolve(process.argv[2] ?? '/tmp/foundation-shadows-browser');
mkdirSync(out, {recursive: true});
const html =
  '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Shadows diagnostic</title></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app" class="app-root"></main><script type="module" src="/scripts/play/fixtures/shadows-entry.mjs"></script></body></html>';
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  plugins: [
    {
      name: 'shadows-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/__shadows.html')) {
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
    'Shadow-map draws are the draws issued while a framebuffer is bound (the scene has no other off-screen pass).',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
const luminance = ([r, g, b]) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
const patch = async (p, at) => {
  const png = decodePng(await p.screenshot({type: 'png', clip: {x: at.x - 3, y: at.y - 3, width: 7, height: 7}}));
  const sum = [0, 0, 0];
  for (let i = 0; i < png.width * png.height; i++) for (let c = 0; c < 3; c++) sum[c] += png.data[i * 4 + c];
  return sum.map(v => Math.round(v / (png.width * png.height)));
};
// Where the crate's shadow falls: the sun comes from (-6, 12, -4), so the shadow lies towards +x, +z of the crate.
const CONTACT = [0.85, 0.55],
  OPEN = [4.5, 3.5];
let browser;
try {
  await server.listen();
  for (const quality of ['reference', 'low']) {
    browser = await launch({width: 960, height: 640, strictClose: true});
    const p = browser.page,
      run = {quality};
    report.runs.push(run);
    const snap = () => p.evaluate(() => window.shadowsCheck.snapshot());
    const settle = async () => {
      let last = -1;
      for (let i = 0; i < 60; i++) {
        const {renders} = await snap();
        if (renders === last) return renders;
        last = renders;
        await sleep(300);
      }
      throw Error('the scene never went still');
    };
    const enter = async id => {
      await p.evaluate(target => window.shadowsCheck.goto(target), id);
      await p.waitForFunction(target => window.shadowsCheck.snapshot().scene === target, id);
      await settle();
    };
    await p.goto(`${server.resolvedUrls.local[0]}__shadows.html?flags=dev.silent&quality=${quality}#scene/lit`);
    await p.waitForFunction(
      () => window.shadowsCheck?.snapshot().scene === 'lit' && window.shadowsCheck.snapshot().renders > 0,
      null,
      {timeout: 60000},
    );
    await settle();
    const lit = await snap();
    run.lit = lit;
    await p.screenshot({path: resolve(out, `shadows-${quality}.png`)});
    // The sun always casts; the lantern only where lights.shadowed-max allows one local shadow light.
    assert.equal(lit.shadowLights, quality === 'low' ? 1 : 2, 'shadow-casting lights in the drawn scene');
    assert.deepEqual(lit.lights.shadowed, quality === 'low' ? {point: 0, spot: 0} : {point: 1, spot: 0});
    const shaded = await patch(p, await p.evaluate(([x, z]) => window.shadowsCheck.at(x, z), CONTACT));
    const open = await patch(p, await p.evaluate(([x, z]) => window.shadowsCheck.at(x, z), OPEN));
    // Idle: nothing drawn. A forced redraw of the still scene draws the picture but no shadow map.
    const idleFrom = (await snap()).renders;
    await sleep(800);
    run.idleRenders = (await snap()).renders - idleFrom;
    assert.equal(run.idleRenders, 0, 'an idle scene draws no frames');
    const still = await snap();
    assert.equal(await p.evaluate(() => window.shadowsCheck.redraw()), true);
    await p.waitForFunction(n => window.shadowsCheck.snapshot().renders > n, still.renders);
    const redrawn = await snap();
    run.shadowDrawsIdle = redrawn.offscreen - still.offscreen;
    assert.equal(run.shadowDrawsIdle, 0, 'a still scene redraws no shadow map');
    // Moving a caster redraws the maps.
    await p.evaluate(() => window.shadowsCheck.move('crate', 0.4));
    await settle();
    const moved = await snap();
    run.shadowDrawsMoved = moved.offscreen - redrawn.offscreen;
    assert.ok(run.shadowDrawsMoved > 0, 'a moved caster redraws the shadow maps');
    await p.evaluate(() => window.shadowsCheck.move('crate', 0));
    await settle();

    await enter('flat');
    const flat = await snap();
    assert.equal(flat.shadowLights, 0, 'no shadows without sceneShadows()');
    const flatShaded = await patch(p, await p.evaluate(([x, z]) => window.shadowsCheck.at(x, z), CONTACT));
    const flatOpen = await patch(p, await p.evaluate(([x, z]) => window.shadowsCheck.at(x, z), OPEN));
    await p.screenshot({path: resolve(out, `no-shadows-${quality}.png`)});
    const offFrom = (await snap()).offscreen;
    await p.evaluate(() => window.shadowsCheck.redraw());
    await sleep(500);
    assert.equal((await snap()).offscreen - offFrom, 0, 'no off-screen pass without shadows');
    run.contact = {shaded: luminance(shaded), flat: luminance(flatShaded)};
    run.open = {shaded: luminance(open), flat: luminance(flatOpen)};
    assert.ok(
      luminance(shaded) + 25 < luminance(flatShaded),
      `the crate's shadow darkens the floor: ${luminance(shaded)} with shadows, ${luminance(flatShaded)} without`,
    );
    assert.ok(
      Math.abs(luminance(open) - luminance(flatOpen)) <= 6,
      `open floor is unchanged: ${run.open.shaded} vs ${run.open.flat}`,
    );
    // Reports, each exactly once: the flat scene's lantern asks for a shadow in a scene without shadows; at low the lit
    // scene's lantern finds no shadowed slot. Nothing else is reported.
    const reported = re => browser.errors.filter(e => re.test(e)).length;
    assert.equal(
      reported(/flat: a PointLight casts no shadow: the scene has no shadows/),
      1,
      browser.errors.join(' | '),
    );
    assert.equal(
      reported(/lit: a PointLight casts no shadow: no shadowed point slot is free/),
      quality === 'low' ? 1 : 0,
    );
    assert.deepEqual(
      browser.errors.filter(e => !/casts no shadow/.test(e)),
      [],
    );
    await browser.close();
    browser = null;
    console.log(
      `shadows (${quality}): contact ${run.contact.shaded} vs ${run.contact.flat} without · casting lights ${lit.shadowLights} · idle shadow draws 0 · moved ${run.shadowDrawsMoved}`,
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
console.log(`Creator shadows passed; evidence ${out}`);
