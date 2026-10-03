#!/usr/bin/env node
// scripts/play/material-check.mjs (`npm run test:material-browser`): authored `Material` surfaces in a real composed
// app, in the bench's muted, isolated headless Chromium (`?flags=dev.silent`).
//   - textured shapes draw a MeshStandardMaterial with the authored wrap, repeat, roughness, metalness, emission and
//     transparency; one library texture per wrap (two here: repeat and mirror), one view per (texture, wrap, repeat);
//   - a shape without Material keeps the original MeshLambertMaterial;
//   - anisotropy follows the quality preset (reference: the context maximum capped at 16; low: 1);
//   - nothing redraws when nothing changed; an authored change draws once; animating opacity on a textured shape
//     keeps its material and texture (no new material, lease, load or disposal);
//   - leaving the scene disposes every surface clone and releases the shared texture (library resident bytes 0).
// Limitations: desktop Chromium with software GL; no physical device, no visual quality judgement beyond screenshots.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT, sleep} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out = resolve(process.argv[2] ?? '/tmp/foundation-material-browser');
mkdirSync(out, {recursive: true});
const html =
  '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Material diagnostic</title></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app" class="app-root"></main><script type="module" src="/scripts/play/fixtures/material-entry.mjs"></script></body></html>';
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  publicDir: resolve(ROOT, 'templates/mechanics/game/public'),
  plugins: [
    {
      name: 'material-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/__material.html')) {
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
    'Anisotropy is read from the material sampler, not measured in pixels.',
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
    const textureRequests = [];
    p.on('request', r => {
      if (r.url().endsWith('/textures/mechanics/panel.png')) textureRequests.push(r.url());
    });
    await p.goto(`${server.resolvedUrls.local[0]}__material.html?flags=dev.silent&quality=${quality}#scene/sample`);
    await p.waitForFunction(() => window.materialCheck?.snapshot().drawn.filter(m => m.map?.ready).length === 3, null, {
      timeout: 60000,
    });
    const snap = () => p.evaluate(() => window.materialCheck.snapshot());
    const loaded = await snap(),
      by = name => loaded.drawn.find(m => m.name === name);
    run.loaded = loaded;
    assert.equal(by('plain').type, 'MeshLambertMaterial');
    assert.equal(by('plain').map, null);
    for (const name of ['tiled', 'mirrored', 'floor']) assert.equal(by(name).type, 'MeshStandardMaterial', name);
    assert.deepEqual([by('tiled').roughness, by('tiled').metalness, by('tiled').map.repeat], [0.6, 0.2, [3, 2]]);
    assert.deepEqual(
      [by('mirrored').map.wrapS, by('mirrored').emissive, by('mirrored').transparent, by('mirrored').opacity],
      [1002, 0x221100, true, 0.8],
    );
    const maps = ['tiled', 'mirrored', 'floor'].map(n => by(n).map);
    assert.equal(new Set(maps.map(m => m.uuid)).size, 3, 'three (texture, wrap, repeat) views');
    assert.equal(maps[0].source, maps[2].source, 'the two repeating surfaces share one library texture');
    assert.notEqual(maps[0].source, maps[1].source, 'mirror is a different sampler: its own counted texture');
    assert.equal(loaded.assets.loads, 2, 'one library load per wrap');
    assert.ok(textureRequests.length >= 1 && textureRequests.length <= 2, 'at most one request per library texture');
    const anisotropy = maps[0].anisotropy;
    if (quality === 'low') assert.equal(anisotropy, 1);
    else assert.ok(anisotropy >= 1 && anisotropy <= 16);
    assert.ok(maps.every(m => m.anisotropy === anisotropy));
    run.anisotropy = anisotropy;
    await p.screenshot({path: resolve(out, `materials-${quality}.png`)});
    // Idle: nothing changed, nothing drawn.
    const before = (await snap()).renders;
    await sleep(800);
    const idle = (await snap()).renders - before;
    assert.equal(idle, 0, 'an idle scene draws no frames');
    run.idleRenders = idle;
    // Animate opacity on a textured surface: changed in place, nothing reloaded or disposed.
    const fading = by('mirrored');
    for (const opacity of [0.7, 0.6, 0.5, 0.4, 0.3]) {
      await p.evaluate(o => window.materialCheck.fade(o), opacity);
      await p.waitForFunction(
        o => window.materialCheck.snapshot().drawn.find(m => m.name === 'mirrored')?.opacity === o,
        opacity,
      );
    }
    const faded = await snap(),
      after = faded.drawn.find(m => m.name === 'mirrored');
    assert.deepEqual([after.uuid, after.map.uuid], [fading.uuid, fading.map.uuid], 'same material and texture view');
    assert.equal(faded.assets.loads, 2);
    assert.ok(!faded.disposed.includes(fading.map.uuid));
    // One authored change draws, then the scene is still again.
    await p.evaluate(() => window.materialCheck.roughen());
    await p.waitForFunction(() => window.materialCheck.snapshot().drawn.find(m => m.name === 'tiled')?.roughness === 1);
    await p.evaluate(() => window.materialCheck.retexture());
    await p.waitForFunction(
      () => window.materialCheck.snapshot().drawn.find(m => m.name === 'plain')?.map?.ready === true,
    );
    await p.evaluate(() => window.materialCheck.strip());
    await p.waitForFunction(
      () => window.materialCheck.snapshot().drawn.find(m => m.name === 'tiled')?.type === 'MeshLambertMaterial',
    );
    const changed = await snap();
    assert.equal(changed.assets.loads, 2, 'later surfaces reuse the resident texture');
    const settled = changed.renders;
    await sleep(800);
    assert.equal((await snap()).renders - settled, 0, 'still again after the changes');
    const clones = changed.drawn.filter(m => m.map).map(m => m.map.uuid);
    // Leave: every clone disposed, the shared texture released.
    await p.evaluate(() => window.materialCheck.goto('other'));
    await p.waitForFunction(() => window.materialCheck.snapshot().scene === 'other');
    await p.waitForFunction(() => window.materialCheck.snapshot().assets.residentMiB === 0);
    const left = await snap();
    run.left = {disposed: left.disposed.length, assets: left.assets};
    for (const uuid of clones) assert.ok(left.disposed.includes(uuid), `clone ${uuid} disposed`);
    assert.ok(left.assets.disposed >= 1, 'the shared texture was disposed with its last lease');
    assert.deepEqual(browser.errors, []);
    await browser.close();
    browser = null;
    console.log(
      `materials (${quality}): 3 textured surfaces from 2 loads (one per wrap), opacity animated in place, anisotropy ${anisotropy}, idle renders 0, released on exit`,
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
console.log(`Material surfaces passed; evidence ${out}`);
