#!/usr/bin/env node
// scripts/play/particle-check.mjs (`npm run test:particle-browser`): optional particle emitters (FX-01) in a real
// composed app, in the bench's muted, isolated headless Chromium (`?flags=dev.silent`). Draw and triangle counts are
// read from the renderer's own `info` after each scene draw.
//   - idle emitters (no live particles) cost no draw, and an idle scene draws no frames;
//   - a live emitter is exactly one more draw, two triangles per live particle; two live emitters are two draws;
//   - the `effects.particles` knob thins non-essential emitters (low: half of the reference particles);
//   - a textured emitter leases the library texture and applies it;
//   - when particles die the picture is drawn once more without them, then the scene is still again;
//   - the drawing code is a separate chunk, fetched once for a scene whose own entities have emitters;
//   - leaving the scene disposes every emitter geometry and releases the texture (library resident bytes 0);
//   - a scene with no systems (on-demand frames) plays its own one-shot burst, removes the entity, then draws nothing;
//   - a flipbook emitter (a 2 × 2 sheet packed by fx:pack, 'over-life') is one draw, and its frame attribute and the
//     pixels on screen advance through the cells in order: red, green, blue, yellow.
// Limitations: desktop Chromium with software GL; no physical device, GPU timing or visual-quality judgement beyond
// screenshots.
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT, sleep} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
import {decodePng, encodePng} from '../perf/quality-png.mjs';
import {packFrames} from '../fx-pack.mjs';
const out = resolve(process.argv[2] ?? '/tmp/foundation-particle-browser');
mkdirSync(out, {recursive: true});
// The flipbook sheet: four 32 px solid cells (red, green, blue, yellow), packed as fx:pack packs a sequence.
const COLOURS = {red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], yellow: [255, 255, 0]};
const cell = rgb => {
  const data = Buffer.alloc(32 * 32 * 4);
  for (let i = 0; i < 32 * 32; i++) data.set([...rgb, 255], i * 4);
  return {width: 32, height: 32, data};
};
const sheetPng = encodePng(packFrames(Object.values(COLOURS).map(cell)).atlas);
/** The dominant sheet colour in a screenshot (at least 500 pixels of it), or null. */
const dominant = png => {
  const {data} = decodePng(png),
    counts = Object.fromEntries(Object.keys(COLOURS).map(k => [k, 0]));
  for (let i = 0; i < data.length; i += 4)
    for (const [name, [r, g, b]] of Object.entries(COLOURS))
      if (Math.abs(data[i] - r) < 60 && Math.abs(data[i + 1] - g) < 60 && Math.abs(data[i + 2] - b) < 60)
        counts[name]++;
  const [name, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n >= 500 ? name : null;
};
const html =
  '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Particle diagnostic</title></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app" class="app-root"></main><script type="module" src="/scripts/play/fixtures/particle-entry.mjs"></script></body></html>';
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  publicDir: resolve(ROOT, 'templates/mechanics/game/public'),
  plugins: [
    {
      name: 'particle-diagnostic',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/__fx/sheet.png')) {
            res.setHeader('Content-Type', 'image/png');
            res.end(sheetPng);
          } else if (req.url?.startsWith('/__particles.html')) {
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
    'Counts are renderer.info per scene draw, not GPU work.',
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
    await p.goto(
      `${server.resolvedUrls.local[0]}__particles.html?flags=dev.silent&quality=${quality}&seed=7#scene/sample`,
    );
    await p.waitForFunction(
      () => window.particleCheck?.snapshot().particles !== null && window.particleCheck.snapshot().renders > 0,
      null,
      {timeout: 60000},
    );
    const snap = () => p.evaluate(() => window.particleCheck.snapshot());
    // Settle, then the baseline: the floor box only; the emitters are admitted but idle. Loading finishes first (the
    // drawing chunk and the textured emitter's texture, applied while it is hidden), then the frame count must hold
    // still for 500 ms, so the idle window below measures idleness, not late loading.
    await p.waitForFunction(() => window.particleCheck.snapshot().particles.textures.applied === 1, null, {
      timeout: 30000,
    });
    const settle = async () => {
      let last = (await snap()).renders;
      for (let stable = 0, tries = 0; stable < 5; tries++) {
        assert.ok(tries < 200, 'the scene settled within 20 s');
        await sleep(100);
        const now = (await snap()).renders;
        stable = now === last ? stable + 1 : 0;
        last = now;
      }
    };
    await settle();
    const base = await snap();
    run.base = base.last;
    assert.equal(base.particles.live, 0);
    assert.equal(base.particles.draws, 0, 'idle emitters issue no draw');
    assert.equal(base.chunk, 1, 'the particle drawing chunk was fetched once');
    const before = base.renders;
    await sleep(800);
    assert.equal((await snap()).renders - before, 0, 'an idle scene with idle emitters draws no frames');
    // One burst: one more draw, two triangles per live particle.
    await p.evaluate(() => window.particleCheck.fire('sparks'));
    await p.waitForFunction(() => window.particleCheck.snapshot().particles.live > 0);
    const live = await snap();
    run.burst = {last: live.last, live: live.particles.live, thinned: live.particles.thinned};
    assert.equal(live.particles.draws, 1);
    await p.waitForFunction(n => window.particleCheck.snapshot().renders > n, live.renders);
    const drawn = await snap();
    assert.equal(drawn.last.calls, base.last.calls + 1, 'a live emitter is one draw');
    assert.ok(
      drawn.last.triangles > base.last.triangles && (drawn.last.triangles - base.last.triangles) % 2 === 0,
      'two triangles per particle',
    );
    assert.ok(drawn.last.triangles - base.last.triangles <= 2 * 48);
    const expectedFirst = quality === 'low' ? 24 : 48;
    assert.equal(live.particles.spawned, 48, 'spawn attempts are the same on every preset');
    assert.equal(
      live.particles.spawned - live.particles.thinned,
      expectedFirst,
      `${quality} draws ${expectedFirst} of 48`,
    );
    await p.screenshot({path: resolve(out, `burst-${quality}.png`)});
    // A trail and a textured burst together: three emitters live at once are three draws.
    await p.evaluate(() => {
      window.particleCheck.trail(true);
      window.particleCheck.fire('glow');
      window.particleCheck.fire('sparks');
    });
    await p.waitForFunction(() => window.particleCheck.snapshot().particles.draws === 3);
    const busy = await snap();
    await p.waitForFunction(n => window.particleCheck.snapshot().renders > n + 2, busy.renders);
    const three = await snap();
    run.three = {last: three.last, particles: three.particles};
    assert.ok(
      three.last.calls >= base.last.calls + 2 && three.last.calls <= base.last.calls + 3,
      `two or three emitters live in the last draw (${three.last.calls})`,
    );
    await p.screenshot({path: resolve(out, `trail-${quality}.png`)});
    // Stop: everything dies, one last draw without particles, then still.
    await p.evaluate(() => window.particleCheck.trail(false));
    await p.waitForFunction(() => window.particleCheck.snapshot().particles.live === 0, null, {timeout: 10000});
    await sleep(300);
    const quiet = await snap();
    assert.equal(quiet.particles.draws, 0);
    assert.equal(quiet.last.calls, base.last.calls, 'back to the baseline draws');
    assert.equal(quiet.last.triangles, base.last.triangles);
    await sleep(800);
    assert.equal((await snap()).renders - quiet.renders, 0, 'still again after the particles die');
    assert.equal(quiet.particles.emitters, 3);
    assert.equal(quiet.particles.refused, 0);
    assert.equal(quiet.particles.invalid, 0);
    run.quiet = {last: quiet.last, particles: quiet.particles};
    // Leave: every emitter geometry disposed and the texture released.
    await p.evaluate(() => window.particleCheck.goto('other'));
    await p.waitForFunction(() => window.particleCheck.snapshot().scene === 'other');
    await p.waitForFunction(() => window.particleCheck.snapshot().assets.residentMiB === 0);
    const left = await snap();
    assert.equal(left.disposedGeometries, 3, 'three emitter geometries disposed with the visit');
    run.left = {disposedGeometries: left.disposedGeometries, assets: left.assets};
    // On-demand frames: a scene without systems plays its own one-shot burst, removes it, and is still again.
    await p.evaluate(() => window.particleCheck.goto('still'));
    await p.waitForFunction(() => window.particleCheck.snapshot().scene === 'still');
    await p.waitForFunction(() => (window.particleCheck.snapshot().particles?.spawned ?? 0) > 0, null, {
      timeout: 30000,
    });
    await p.waitForFunction(() => window.particleCheck.snapshot().entities === 1, null, {timeout: 10000});
    await sleep(300);
    const still = await snap();
    assert.equal(still.particles.live, 0);
    assert.equal(still.particles.draws, 0);
    assert.equal(still.particles.spawned - still.particles.thinned, quality === 'low' ? 16 : 32);
    assert.ok(still.renders > left.renders, 'the burst was drawn');
    await sleep(800);
    assert.equal((await snap()).renders - still.renders, 0, 'on-demand scene still after its burst');
    run.still = {particles: still.particles, last: still.last};
    // Flipbook: one draw; the frame attribute and the picture step through the sheet's cells in reading order.
    await p.evaluate(() => window.particleCheck.goto('flipbook'));
    await p.waitForFunction(() => window.particleCheck.snapshot().scene === 'flipbook');
    await p.waitForFunction(() => window.particleCheck.snapshot().particles?.textures.applied === 1, null, {
      timeout: 30000,
    });
    await settle();
    const flipBase = await snap();
    assert.equal(flipBase.particles.draws, 0);
    await p.evaluate(() => window.particleCheck.fire('flip'));
    await p.waitForFunction(() => window.particleCheck.snapshot().particles.live === 1);
    const colours = [],
      frames = [],
      calls = new Set();
    for (let tries = 0; tries < 80; tries++) {
      const s = await snap();
      if (s.particles.live === 0) break;
      calls.add(s.last.calls - flipBase.last.calls);
      assert.equal(s.particles.draws, 1, 'a flipbook emitter is one draw');
      const f = s.flipFrames?.[0];
      if (f !== undefined && frames.at(-1) !== f) frames.push(f);
      const png = await p.screenshot(),
        c = dominant(png);
      if (c && colours.at(-1) !== c) {
        colours.push(c);
        writeFileSync(resolve(out, `flipbook-${quality}-${colours.length - 1}-${c}.png`), png);
      }
      await sleep(100);
    }
    assert.deepEqual(frames, [0, 1, 2, 3], 'the frame attribute advances over the life');
    assert.deepEqual(colours, ['red', 'green', 'blue', 'yellow'], 'the picture shows the cells in reading order');
    assert.ok(
      [...calls].every(n => n === 0 || n === 1),
      `at most one extra draw (${[...calls]})`,
    );
    run.flipbook = {frames, colours, extraDraws: [...calls]};
    assert.deepEqual(browser.errors, []);
    await browser.close();
    browser = null;
    console.log(
      `particles (${quality}): idle 0 draws and 0 frames; burst +1 draw (${drawn.last.triangles - base.last.triangles} triangles, ${expectedFirst}/48 particles); three emitters ${three.last.calls - base.last.calls} draws; still after; 3 geometries disposed and texture released on exit; on-demand scene played its burst, despawned it and went still; flipbook 1 draw, frames ${frames.join(',')} shown as ${colours.join(', ')}`,
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
console.log(`Particle emitters passed; evidence ${out}`);
