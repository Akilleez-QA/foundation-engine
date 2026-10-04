#!/usr/bin/env node
// tools/visual-courtyard/browser.mjs (`npm run test:three-kit-browser`): the three.js escape hatch (@kits/three) in a
// real game, the courtyard fixture (GAME_DIR=tools/visual-courtyard/game), in the bench's muted, isolated headless
// Chromium (`?flags=dev.silent`) with the bench's draw probe:
//   - glow (still): a custom-object lantern (a PointLight and emissive glass) drawn through an EffectComposer with
//     UnrealBloomPass (a render override). It draws real frames, the point light lights the floor under it, its draws and
//     triangles are counted against the scene's budget row, and the still scene draws no frame (render on change);
//   - courtyard-lit: 8 lantern custom objects (2 with point-light shadows), moonlight shadows and bloom; one three.js
//     copy shared by the engine and the addons; counts within the row;
//   - courtyard: the same courtyard through the author API only (the "before" picture);
//   - leaving each kit scene leaves no geometry and no more textures behind than leaving the author-API courtyard (the
//     renderer pool's release audit: point and sun shadow maps, the composer's targets and the kit's tree are disposed),
//     and no page error or kit report was logged.
// Writes report.json and before/after screenshots (desktop and phone) to the output folder.
// Limitations: software GL; no physical device, GPU timing or visual-quality judgement beyond the screenshots.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {launch} from '../../scripts/perf/bench-browser.mjs';
import {PROBE} from '../../scripts/perf/probe-inject.mjs';
import {decodePng} from '../../scripts/perf/quality-png.mjs';
import {diagnosticReport} from '../../scripts/play/diagnostic-report.mjs';
import {budgetStatus, measure, open, ROOT, serve, sleep, VIEWS} from '../../scripts/play/lib.mjs';

const out = resolve(process.argv[2] ?? 'playtest/three-kit');
mkdirSync(out, {recursive: true});
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  passed: false,
  errors: [],
  scenes: {},
  screenshots: [],
  limitations: [
    'Desktop Chromium with software GL (and a phone-sized viewport); no physical device, GPU timing or visual-quality acceptance.',
    'Draws include everything the render override draws (the EffectComposer passes): the kit cannot tell game post passes from scene draws.',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));

/** Screen position of a world point for the scene's camera (fov degrees, looking from `eye` at `target`). */
function project([x, y, z], {eye, target, fov}, width, height) {
  const sub = (a, b) => a.map((v, i) => v - b[i]),
    dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
    cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm = a => a.map(v => v / Math.hypot(...a));
  const f = norm(sub(target, eye)),
    r = norm(cross(f, [0, 1, 0])),
    u = cross(r, f),
    d = sub([x, y, z], eye);
  const cz = dot(d, f),
    k = 1 / Math.tan(((fov / 2) * Math.PI) / 180);
  return [
    Math.round(((dot(d, r) * k) / (cz * (width / height)) / 2 + 0.5) * width),
    Math.round((0.5 - (dot(d, u) * k) / cz / 2) * height),
  ];
}
/** Mean luminance (0-255) of a square of pixels around (x, y). */
function luminance(png, [x, y], r = 6) {
  let sum = 0,
    n = 0;
  for (let j = y - r; j <= y + r; j++)
    for (let i = x - r; i <= x + r; i++) {
      const p = (j * png.width + i) * 4;
      sum += 0.2126 * png.data[p] + 0.7152 * png.data[p + 1] + 0.0722 * png.data[p + 2];
      n++;
    }
  return sum / n;
}

const kitStats = b => b.evaluate('window.engine.extensions().three ?? null');
const poolRelease = b => b.evaluate("window.engine.probe('render.pool')?.lastRelease ?? null");
const shot = async (b, name) => {
  const file = resolve(out, `${name}.png`);
  const png = await b.page.screenshot({type: 'png'});
  writeFileSync(file, png);
  report.screenshots.push(file);
  return decodePng(png);
};
const watchErrors = (b, view) => {
  b.page.on('pageerror', e => report.errors.push(`${view}: ${e.message}`));
  b.page.on('console', m => {
    if (m.type() === 'error') report.errors.push(`${view}: ${m.text()}`);
  });
};
/** A measured window of real frames: the scene is asked to redraw if it is still. */
const frames = b =>
  measure(
    b,
    async () => {
      for (let i = 0; i < 5; i++) {
        await b.evaluate('window.engine.redraw()');
        await sleep(120);
      }
    },
    1200,
  );
const goto = async (b, scene) => {
  await b.evaluate(`window.engine.goto(${JSON.stringify(scene)})`);
  await b.page.waitForFunction(
    s => document.querySelector(`#app[data-scene="scene.${s}"][data-scene-state="active"]`),
    scene,
    {timeout: 60000},
  );
};

let server, browser;
try {
  server = await serve();
  browser = await launch({...VIEWS.desktop, strictClose: true});
  watchErrors(browser, 'desktop');
  await browser.page.addInitScript(PROBE);
  await open(browser, server.url, 'glow', {query: {quality: 'reference'}});

  // glow: one lantern through an EffectComposer, a still scene.
  await browser.page.waitForFunction(() => window.engine.extensions().three?.live === 1, null, {timeout: 60000});
  const glow = (report.scenes.glow = {stats: await kitStats(browser)});
  assert.deepEqual(
    [glow.stats.admitted, glow.stats.refused, glow.stats.override, glow.stats.owned],
    [1, 0, true, 3],
    'one lantern admitted; the composer, its bloom and output passes owned; the override draws',
  );
  glow.frames = await frames(browser);
  glow.budget = budgetStatus('glow', glow.frames);
  assert.ok(glow.frames.renders > 0, 'the override drew real frames');
  // Scene pass (floor, post, cap, glass) plus the composer's passes: all counted, none hidden.
  assert.ok(glow.frames.drawsPerFrame > 4, `draws counted: ${glow.frames.drawsPerFrame}`);
  assert.ok(glow.frames.trisPerFrame >= 2 + 12 + 12, `triangles counted: ${glow.frames.trisPerFrame}`);
  assert.equal(glow.budget.status, 'within budget', JSON.stringify(glow.budget));
  await sleep(300);
  glow.still = await measure(browser, null, 800);
  assert.equal(glow.still.renders, 0, 'a still kit scene draws no frame');
  const png = await shot(browser, 'glow-desktop');
  const cam = {eye: [0, 5, 7], target: [0, 1, 0], fov: 50};
  const under = luminance(png, project([-2, 0, 1.2], cam, png.width, png.height)),
    far = luminance(png, project([5, 0, 1.2], cam, png.width, png.height));
  glow.floor = {underLantern: +under.toFixed(1), farAway: +far.toFixed(1)};
  assert.ok(under > far * 1.5 + 4, `the point light lights the floor: ${under} vs ${far}`);

  // courtyard-lit: 8 lanterns, 2 shadowed, moon shadow, bloom; one three.js copy.
  await goto(browser, 'courtyard-lit');
  report.scenes.glow.released = await poolRelease(browser);
  await browser.page.waitForFunction(() => window.engine.extensions().three?.live === 8, null, {timeout: 60000});
  const lit = (report.scenes['courtyard-lit'] = {
    stats: await kitStats(browser),
    state: (await browser.evaluate('window.engine.state()')).world.state,
  });
  assert.equal(lit.state.threeCopies, 1, 'the addons share the engine three.js copy');
  assert.deepEqual([lit.stats.admitted, lit.stats.refused, lit.stats.shadows], [8, 0, true]);
  await sleep(1500); // particles and the first shadow maps settle
  lit.frames = await frames(browser);
  lit.budget = budgetStatus('courtyard-lit', lit.frames);
  assert.ok(lit.frames.renders > 0);
  assert.equal(lit.budget.status, 'within budget', JSON.stringify(lit.budget));
  await shot(browser, 'after-courtyard-lit-desktop');

  // courtyard: the author-API picture.
  await goto(browser, 'courtyard');
  lit.released = await poolRelease(browser);
  await sleep(1500);
  const before = (report.scenes.courtyard = {frames: await frames(browser)});
  before.budget = budgetStatus('courtyard', before.frames);
  assert.equal(before.budget.status, 'within budget', JSON.stringify(before.budget));
  await shot(browser, 'before-courtyard-desktop');
  // The author-API scene's own release is the baseline: the kit scenes may leave nothing more.
  await goto(browser, 'glow');
  const baseline = (before.released = await poolRelease(browser));
  for (const [scene, audit] of [
    ['glow', glow.released],
    ['courtyard-lit', lit.released],
  ]) {
    assert.equal(audit?.geometries, 0, `${scene}: no geometry left behind`);
    assert.ok(
      audit?.textures <= baseline.textures,
      `${scene}: no texture left beyond the author-API baseline (${audit?.textures} > ${baseline.textures})`,
    );
  }
  await browser.close();
  browser = null;

  // The phone-sized pictures (evidence only).
  for (const scene of ['courtyard-lit', 'courtyard']) {
    browser = await launch({...VIEWS.mobile, strictClose: true});
    watchErrors(browser, `mobile ${scene}`);
    await open(browser, server.url, scene, {query: {quality: 'reference'}});
    await sleep(2000);
    await shot(browser, `${scene === 'courtyard' ? 'before' : 'after'}-${scene}-mobile`);
    await browser.close();
    browser = null;
  }
  assert.deepEqual(report.errors, [], 'no page error and no kit report');
  report.passed = true;
} catch (error) {
  evidence.fail(error);
} finally {
  if (browser) await evidence.close(browser, 'browser cleanup');
  await evidence.close(server, 'server cleanup');
  evidence.finish();
}
console.log(JSON.stringify(report, null, 2));
