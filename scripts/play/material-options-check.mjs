#!/usr/bin/env node
// scripts/play/material-options-check.mjs (`npm run test:material-options-browser`): material options in a real composed
// app, in the bench's muted, isolated headless Chromium (`?flags=dev.silent`).
//   - 'toon' shading draws a few flat luminance bands where the standard sphere beside it shades smoothly;
//   - a `Mesh` (defineMesh) with an emissive `Material` glows; the same mesh without one stays dark and matte;
//   - `side: 'double'` draws a plane seen from behind; the default front side does not;
//   - `alphaCutoff` cuts out the transparent half of a texture with no transparency sorting;
//   - a Mesh with vertex colours keeps them under a flat Material;
//   - a `Model` with a Material draws visit-owned toon overrides; the same model without one keeps its shared materials;
//   - nothing redraws when idle; a change of shading class redraws once and adds at most one program;
//   - leaving the scene disposes every override material, surface material and toon gradient.
// It also writes before/after pictures of a ported courtyard corner (the options that existed before, then the new
// ones) for review. Limitations: desktop Chromium with software GL; pixels are checked by thresholds, not judged.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT, sleep} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
import {decodePng, encodePng} from '../perf/quality-png.mjs';

const out = resolve(process.argv[2] ?? '/tmp/foundation-material-options-browser');
mkdirSync(out, {recursive: true});

/** A 32x32 texture: an opaque left half, a fully transparent right half. */
function halves() {
  const size = 32,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) data.set(x < size / 2 ? [235, 235, 235, 255] : [235, 235, 235, 0], (y * size + x) * 4);
  return encodePng({width: size, height: size, data});
}
/** A 64x64 fern leaf: a pointed blade with a darker midrib and side veins, transparent around it. */
function leaf() {
  const size = 64,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = y / (size - 1),
        u = (x - (size - 1) / 2) / ((size - 1) / 2),
        half = Math.sin(Math.PI * Math.min(1, v * 1.08)) * (0.75 - 0.35 * v),
        inside = Math.abs(u) < half && v > 0.02,
        rib = Math.abs(u) < 0.06,
        vein = Math.abs(((Math.abs(u) * 0.6 + v) * 9) % 1 - 0.5) < 0.08;
      const g = rib ? 120 : vein ? 150 : 190 - Math.round(60 * Math.abs(u));
      data.set(inside ? [Math.round(g * 0.35), g, Math.round(g * 0.3), 255] : [0, 0, 0, 0], (y * size + x) * 4);
    }
  return encodePng({width: size, height: size, data});
}
const textures = {'/textures/check/halves.png': halves(), '/textures/check/leaf.png': leaf()};
const html =
  '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Material options diagnostic</title></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app" class="app-root"></main><script type="module" src="/scripts/play/fixtures/material-options-entry.mjs"></script></body></html>';
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  publicDir: resolve(ROOT, 'templates/mechanics/game/public'),
  plugins: [
    {
      name: 'material-options-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          const path = req.url?.split('?')[0] ?? '';
          if (path === '/__material-options.html') {
            res.setHeader('Content-Type', 'text/html');
            res.end(html);
          } else if (textures[path]) {
            res.setHeader('Content-Type', 'image/png');
            res.end(textures[path]);
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
    'Bands, glow, faces and cut-outs are checked by pixel thresholds at projected points, not by a reference image.',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
let browser;
try {
  await server.listen();
  for (const quality of ['reference', 'low']) {
    browser = await launch({width: 960, height: 640, strictClose: true});
    const p = browser.page,
      run = {quality};
    report.runs.push(run);
    await p.goto(`${server.resolvedUrls.local[0]}__material-options.html?flags=dev.silent&quality=${quality}#scene/options`);
    const snap = () => p.evaluate(() => window.materialOptions.snapshot());
    const all = s => s.drawn.flatMap(m => m.materials.map(x => ({...x, name: m.name, model: m.model})));
    await p.waitForFunction(
      () => {
        const s = window.materialOptions.snapshot();
        const cutout = s.drawn.find(m => m.name === 'cutout');
        return s.scene === 'options' && s.drawn.filter(m => m.model).length >= 2 && !!cutout?.materials[0].map;
      },
      null,
      {timeout: 60000},
    );
    await sleep(500); // the cut-out texture and models arrive and draw once more
    const canvas = p.locator('.scene-view canvas').first();
    const picture = async () => decodePng(await canvas.screenshot());
    const pixelXY = (img, x, y) => {
      const i = (y * img.width + x) * 4;
      return [img.data[i], img.data[i + 1], img.data[i + 2]];
    };
    const pixelAt = (img, ndc) => {
      const x = Math.round(((ndc.x + 1) / 2) * (img.width - 1)),
        y = Math.round(((1 - ndc.y) / 2) * (img.height - 1)),
        i = (y * img.width + x) * 4;
      return [img.data[i], img.data[i + 1], img.data[i + 2]];
    };
    const project = name => p.evaluate(n => window.materialOptions.project(n), name);
    const loaded = await snap(),
      by = name => all(loaded).find(m => m.name === name);
    run.programs = loaded.programs;
    // Classes and fields as declared.
    assert.equal(by('smooth').type, 'MeshLambertMaterial', 'a shape without Material keeps its matte material');
    assert.equal(by('toon').type, 'MeshToonMaterial');
    assert.equal(by('toon').gradient.steps, 3);
    assert.equal(by('gem-plain').type, 'MeshLambertMaterial', 'a mesh without Material keeps its matte material');
    assert.deepEqual([by('gem').type, by('gem').flatShading, by('gem').emissive], ['MeshStandardMaterial', true, 0xff6a10]);
    assert.equal(by('back-single').side, 0);
    assert.equal(by('back-double').side, 2);
    assert.equal(by('cutout').alphaTest, 0.5);
    assert.equal(by('cutout').transparent, false, 'a cut-out is not sorted');
    assert.deepEqual([by('rock').vertexColors, by('rock').flatShading], [true, true]);
    const parts = all(loaded).filter(m => m.model);
    assert.ok(parts.some(m => m.type === 'MeshToonMaterial' && m.emissive === 0x00ff66 && !m.shared), 'model override');
    assert.ok(parts.some(m => m.shared), 'the model without Material keeps its shared materials');
    // Pixels.
    const img = await picture();
    writeFileSync(resolve(out, `options-${quality}.png`), encodePng(img));
    // Over each sphere's disk: a smooth surface spreads over many values, a toon one sits in a few flat bands.
    const bands = async name => {
      const c = await project(name),
        cx = Math.round(((c.x + 1) / 2) * (img.width - 1)),
        cy = Math.round(((1 - c.y) / 2) * (img.height - 1)),
        r = Math.round(0.13 * (img.height - 1) * 0.5),
        counts = new Map();
      let total = 0;
      for (let y = -r; y <= r; y++)
        for (let x = -r; x <= r; x++) {
          if (x * x + y * y > r * r) continue;
          const v = Math.round(luminance(pixelXY(img, cx + x, cy + y)) / 2);
          counts.set(v, (counts.get(v) ?? 0) + 1);
          total++;
        }
      const sorted = [...counts.values()].sort((a, b) => b - a);
      // How much of the disk its three most common values cover (three toon steps).
      return {values: sorted.length, top3: +(sorted.slice(0, 3).reduce((a, n) => a + n, 0) / total).toFixed(3)};
    };
    const smooth = await bands('smooth'),
      toon = await bands('toon');
    run.bands = {smooth, toon};
    assert.ok(toon.top3 >= 0.9, `three flat bands cover the toon sphere (${toon.top3})`);
    assert.ok(smooth.top3 < 0.8 && smooth.values > toon.values, `the smooth sphere shades continuously (${smooth.top3})`);
    const glow = pixelAt(img, await project('gem')),
      dull = pixelAt(img, await project('gem-plain'));
    run.gem = {glow, dull};
    assert.ok(glow[0] > 200 && glow[0] > glow[2] + 80, `the emissive Mesh glows orange (${glow})`);
    assert.ok(luminance(glow) > luminance(dull) + 40, 'the same mesh without Material is not glowing');
    const background = [0x18, 0x20, 0x2a];
    const near = (a, b, t = 12) => a.every((v, i) => Math.abs(v - b[i]) <= t);
    const single = pixelAt(img, await project('back-single')),
      double = pixelAt(img, await project('back-double'));
    run.sides = {single, double};
    assert.ok(near(single, background), `a front-sided plane seen from behind is not drawn (${single})`);
    assert.ok(!near(double, background, 20) && double[1] > double[2], `a double-sided plane is (${double})`);
    const kept = pixelAt(img, await project('cutout-left')),
      cut = pixelAt(img, await project('cutout-right'));
    run.cutout = {kept, cut};
    assert.ok(luminance(kept) > 80, `the opaque half draws (${kept})`);
    assert.ok(near(cut, background), `the transparent half is cut out (${cut})`);
    // Idle: nothing changed, nothing drawn.
    const before = (await snap()).renders;
    await sleep(800);
    assert.equal((await snap()).renders - before, 0, 'an idle scene draws no frames');
    // A class swap: one new surface, one redraw, at most one new program, the old material released.
    const old = by('toon');
    const settled = await snap();
    await p.evaluate(() => window.materialOptions.shade('matte'));
    await p.waitForFunction(
      () => window.materialOptions.snapshot().drawn.find(m => m.name === 'toon')?.materials[0].type === 'MeshLambertMaterial',
    );
    await sleep(800);
    const swapped = await snap();
    run.swap = {renders: swapped.renders - settled.renders, programs: swapped.programs - settled.programs};
    assert.equal(swapped.renders - settled.renders, 1, 'a class swap redraws once');
    assert.ok(swapped.programs - settled.programs <= 1, 'and adds at most one program');
    assert.ok(swapped.disposed.includes(old.uuid), 'the old toon material is released');
    // Same class again: in place, no new material.
    const matte = all(swapped).find(m => m.name === 'toon');
    await p.evaluate(() => window.materialOptions.shade('matte'));
    await sleep(300);
    assert.equal(all(await snap()).find(m => m.name === 'toon').uuid, matte.uuid);
    // Leave: every authored and override material, and every toon gradient, disposed.
    const owned = all(swapped).filter(m => !m.shared);
    const gradients = all(loaded)
      .filter(m => m.gradient)
      .map(m => m.gradient.uuid);
    await p.evaluate(() => window.materialOptions.goto('other'));
    await p.waitForFunction(() => window.materialOptions.snapshot().scene === 'other');
    await sleep(300);
    const left = await snap();
    for (const m of owned) assert.ok(left.disposed.includes(m.uuid), `${m.name} ${m.type} disposed on exit`);
    for (const uuid of gradients) assert.ok(left.disposed.includes(uuid), 'toon gradient disposed on exit');
    run.left = {owned: owned.length, gradients: new Set(gradients).size};
    // Before/after pictures of the ported courtyard corner.
    for (const id of ['before', 'after']) {
      await p.evaluate(s => window.materialOptions.goto(s), id);
      await p.waitForFunction(
        s => window.materialOptions.snapshot().scene === s && window.materialOptions.snapshot().drawn.some(m => m.model),
        id,
        {timeout: 60000},
      );
      await sleep(800);
      const shot = await snap();
      run[id] = {calls: shot.calls, programs: shot.programs};
      writeFileSync(resolve(out, `courtyard-${id}-${quality}.png`), encodePng(await picture()));
    }
    assert.deepEqual(browser.errors, []);
    await browser.close();
    browser = null;
    console.log(
      `material options (${quality}): three bands cover ${toon.top3} of the toon sphere vs ${smooth.top3} smooth, mesh glows, double side and cut-out drawn, class swap 1 redraw +${run.swap.programs} program, released on exit; courtyard draws ${run.before.calls} -> ${run.after.calls}`,
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
console.log(`Material options passed; evidence ${out}`);
