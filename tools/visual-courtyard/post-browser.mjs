// tools/visual-courtyard/post-browser.mjs (`npm run test:post-browser`): post-processing (`view.post`, the `post.mode`
// knob) in the courtyard fixture (GAME_DIR=tools/visual-courtyard/game), in the bench's muted, isolated headless
// Chromium (`?flags=dev.silent`) with the bench's draw probe, at the reference (full), medium (basic) and low (off)
// presets:
//   - glow-post (still): an emissive box with ACES tone mapping and post. The tier is exact: `postDraws` per rendered
//     frame is 10, 1 and 0, and the scene's own `draws` are the same at every tier. Bloom spreads light into pixels
//     beside the box at full and not at off. A still scene draws no frame. A scene without post fetches no post code;
//   - leaving the scene leaves no geometry and no more textures than leaving the author-API courtyard (release audit);
//   - courtyard-post: the trial courtyard with tone mapping, bloom, vignette and grade at each tier, and the courtyard
//     without post ("before"), as screenshots, desktop and phone-sized.
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

const out = resolve(process.argv[2] ?? 'playtest/post');
mkdirSync(out, {recursive: true});
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  passed: false,
  errors: [],
  tiers: {},
  screenshots: [],
  limitations: [
    'Desktop Chromium with software GL (and a phone-sized viewport); no physical device, GPU timing or visual-quality acceptance.',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
const PRESETS = {reference: 'full', medium: 'basic', low: 'off'};
const POST_DRAWS = {full: 10, basic: 1, off: 0};

const luminance = (png, [x, y], r = 4) => {
  let sum = 0,
    n = 0;
  for (let j = y - r; j <= y + r; j++)
    for (let i = x - r; i <= x + r; i++) {
      const p = (j * png.width + i) * 4;
      sum += 0.2126 * png.data[p] + 0.7152 * png.data[p + 1] + 0.0722 * png.data[p + 2];
      n++;
    }
  return sum / n;
};
const shot = async (b, name) => {
  const file = resolve(out, `${name}.png`);
  const png = await b.page.screenshot({type: 'png'});
  writeFileSync(file, png);
  report.screenshots.push(file);
  return decodePng(png);
};
const watch = (b, view) => {
  const chunks = [];
  b.page.on('pageerror', e => report.errors.push(`${view}: ${e.message}`));
  b.page.on('console', m => {
    if (m.type() === 'error') report.errors.push(`${view}: ${m.text()}`);
  });
  b.page.on('request', r => {
    const path = new URL(r.url()).pathname;
    if (/backends\/webgl\/post\.ts$|\/post-[\w-]+\.js$/.test(path)) chunks.push(path);
  });
  return chunks;
};
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
const postStats = b => b.evaluate('window.engine.post()');
const release = b => b.evaluate("window.engine.probe('render.pool')?.lastRelease ?? null");

let server, browser;
try {
  server = await serve();
  for (const [preset, tier] of Object.entries(PRESETS)) {
    browser = await launch({...VIEWS.desktop, strictClose: true});
    const chunks = watch(browser, preset);
    await browser.page.addInitScript(PROBE);
    // The author-API courtyard first: no post, so no post code.
    await open(browser, server.url, 'courtyard', {query: {quality: preset}});
    await sleep(500);
    assert.deepEqual(chunks, [], 'a scene without post fetches no post code');
    await goto(browser, 'glow-post');
    const baseline = await release(browser);
    await browser.page.waitForFunction(t => window.engine.post()?.mode === t, tier, {timeout: 60000});
    const r = (report.tiers[preset] = {tier, stats: await postStats(browser)});
    assert.ok(chunks.length >= 1, 'a scene with post fetches the post code');
    r.frames = await frames(browser);
    r.budget = budgetStatus('glow-post', r.frames);
    assert.ok(r.frames.renders > 0);
    assert.equal(r.frames.postDrawsPerFrame, POST_DRAWS[tier], `${tier}: post draws counted apart`);
    assert.equal(r.budget.status, 'within budget', JSON.stringify(r.budget));
    await sleep(300);
    r.still = await measure(browser, null, 800);
    assert.equal(r.still.renders, 0, 'a still scene with post draws no frame');
    const png = await shot(browser, `glow-post-${tier}-desktop`);
    // The box (about 105 px wide at 1280x800) sits at the view's centre; sample the background just beside it.
    r.beside = +luminance(png, [Math.round(png.width / 2 + png.width * 0.05), Math.round(png.height * 0.53)]).toFixed(
      1,
    );
    // Courtyard pictures at this tier, after leaving the post scene.
    await goto(browser, 'courtyard-post');
    const audit = (r.released = await release(browser));
    assert.equal(audit?.geometries, 0, 'no geometry left behind');
    assert.ok(
      audit?.textures <= baseline.textures,
      `no texture beyond the author-API baseline (${audit?.textures} > ${baseline.textures})`,
    );
    await browser.page.waitForFunction(t => window.engine.post()?.mode === t, tier, {timeout: 60000});
    await sleep(1500);
    r.courtyard = await frames(browser);
    assert.equal(r.courtyard.postDrawsPerFrame, POST_DRAWS[tier]);
    await shot(browser, `after-courtyard-post-${tier}-desktop`);
    if (preset === 'reference') {
      await goto(browser, 'courtyard');
      await sleep(1500);
      await shot(browser, 'before-courtyard-desktop');
    }
    await browser.close();
    browser = null;
  }
  const t = report.tiers;
  assert.equal(t.reference.frames.drawsPerFrame, t.low.frames.drawsPerFrame, 'scene draws are the same at every tier');
  assert.equal(t.medium.frames.drawsPerFrame, t.low.frames.drawsPerFrame);
  assert.ok(
    t.reference.beside > t.low.beside + 8,
    `bloom spreads light beside the box: ${t.reference.beside} vs ${t.low.beside}`,
  );

  for (const scene of ['courtyard-post', 'courtyard']) {
    browser = await launch({...VIEWS.mobile, strictClose: true});
    watch(browser, `mobile ${scene}`);
    await open(browser, server.url, scene, {query: {quality: 'reference'}});
    await sleep(2000);
    await shot(browser, `${scene === 'courtyard' ? 'before-courtyard' : 'after-courtyard-post-full'}-mobile`);
    await browser.close();
    browser = null;
  }
  assert.deepEqual(report.errors, [], 'no page error and no post report');
  report.passed = true;
} catch (error) {
  evidence.fail(error);
} finally {
  if (browser) await evidence.close(browser, 'browser cleanup');
  await evidence.close(server, 'server cleanup');
  evidence.finish();
}
console.log(JSON.stringify(report, null, 2));
