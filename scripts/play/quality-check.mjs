#!/usr/bin/env node
// Actual starter boot integration; generated sources must already exist.
// node -r ./scripts/silent-browser.cjs scripts/play/quality-check.mjs [output-directory]
import assert from 'node:assert/strict';
import {diagnosticReport} from './diagnostic-report.mjs';
import {mkdirSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {serve, ROOT, homeScene} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {gameDir} from '../lib/game-dir.mjs';
const output = resolve(process.argv[2] ?? '/tmp/foundation-quality-evidence');
mkdirSync(output, {recursive: true});
const report = {
  kind: 'actual-starter-quality-boot',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  dirtyWorktree: execFileSync('git', ['status', '--porcelain'], {cwd: ROOT, encoding: 'utf8'}).trim().length > 0,
  sourceSha256: Object.fromEntries(
    [
      'src/platform/render/quality-module.ts',
      'src/platform/render/quality-runtime.ts',
      'src/app/layer-modules.ts',
      'scripts/play/quality-check.mjs',
    ].map(p => [
      p,
      createHash('sha256')
        .update(readFileSync(resolve(ROOT, p)))
        .digest('hex'),
    ]),
  ),
  limitations: [
    'Browser emulation, not physical-device performance or art acceptance',
    'Saved choice seeded through valid storage envelope; starter has no wired Graphics UI',
    'Hardware detection suppressed by automated browser; no hardware detection claim',
  ],
  states: [],
};
const evidence = diagnosticReport(report, resolve(output, 'report.json'));
let server, b;
try {
  server = await serve();
  b = await launch({width: 1280, height: 800, strictClose: true});
  const context = await b.browser.newContext({viewport: {width: 1280, height: 800}, deviceScaleFactor: 2});
  await b.context.close();
  b.page = await context.newPage();
  b.page.on('pageerror', e => b.errors.push(String(e)));
  b.page.on('console', m => {
    if (m.type() === 'error') b.errors.push(m.text());
  });
  await b.page.addInitScript(() => {
    window.graphicsWrites = [];
    const set = Storage.prototype.setItem,
      remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (k, v) {
      if (k.endsWith('|device|graphics.settings')) window.graphicsWrites.push(['set', k]);
      return set.call(this, k, v);
    };
    Storage.prototype.removeItem = function (k) {
      if (k.endsWith('|device|graphics.settings')) window.graphicsWrites.push(['remove', k]);
      return remove.call(this, k);
    };
  });
  const scene = homeScene();
  const state = async (name, query = '') => {
    await b.page.goto('about:blank');
    await b.page.goto(`${server.url}/?flags=dev.silent${query}#scene/${scene}`, {waitUntil: 'load'});
    await b.page.waitForFunction(
      `window.engine && window.engine.probe('quality') && document.querySelector('#app[data-scene-state="active"] canvas')`,
    );
    await b.page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const sample = await b.page.evaluate(() => {
      const canvas = document.querySelector('#app canvas'),
        r = canvas.getBoundingClientRect();
      return {
        quality: window.engine.probe('quality'),
        pool: window.engine.probe('render.pool'),
        scene: window.engine.probe('scene'),
        dpr: devicePixelRatio,
        canvas: {
          width: canvas.width,
          height: canvas.height,
          cssWidth: r.width,
          cssHeight: r.height,
          ratio: canvas.width / r.width,
        },
        graphicsStorage: Object.fromEntries(
          Object.entries(localStorage).filter(([k]) => k.endsWith('|device|graphics.settings')),
        ),
        graphicsWrites: window.graphicsWrites,
        graphicsButton: !!document.querySelector('#graphics-button'),
      };
    });
    assert.equal(sample.dpr, 2);
    assert.equal(sample.quality.governing, false);
    const screenshot = resolve(output, `${name}.png`);
    await b.page.screenshot({path: screenshot});
    report.states.push({name, ...sample, screenshot});
    return sample;
  };
  const initial = await state('authored-default');
  assert.equal(initial.quality.source, 'default');
  assert.equal(
    initial.graphicsButton,
    false,
    'This diagnostic uses the unwired starter; add a real UI journey if that changes',
  );
  // Read the selected starter identity; source='player' after boot verifies the actual module consumed this namespace.
  const gameSource = readFileSync(resolve(gameDir(), 'game.ts'), 'utf8');
  const gameId = gameSource.match(/\bid:\s*['"]([a-z0-9-]+)['"]/)?.[1];
  assert.ok(gameId, 'Selected starter must declare a literal game id for this diagnostic');
  const key = `${gameId}|device|graphics.settings`;
  const envelope = JSON.stringify({
    v: 1,
    by: 'quality-diagnostic@1',
    data: {preset: 'medium', overrides: {}, governor: false},
  });
  await b.page.evaluate(({key, envelope}) => localStorage.setItem(key, envelope), {key, envelope});
  const saved = await state('saved-medium');
  assert.deepEqual(saved.quality, {preset: 'medium', source: 'player', governing: false});
  const baseline = saved.graphicsStorage;
  const low = await state('pin-low', '&quality=low');
  assert.deepEqual(low.quality, {preset: 'low', source: 'pinned', governing: false});
  const reference = await state('pin-reference', '&quality=reference');
  assert.deepEqual(reference.quality, {preset: 'reference', source: 'pinned', governing: false});
  for (const s of [low, reference]) {
    assert.deepEqual(s.graphicsStorage, baseline);
    assert.deepEqual(s.graphicsWrites, []);
  }
  assert.ok(Math.abs(low.canvas.ratio - 0.85) < 0.005);
  assert.equal(reference.canvas.ratio, 2);
  assert.equal(low.canvas.cssWidth, reference.canvas.cssWidth);
  assert.equal(low.canvas.cssHeight, reference.canvas.cssHeight);
  const restored = await state('restored-medium');
  assert.deepEqual(restored.quality, saved.quality);
  assert.deepEqual(restored.graphicsStorage, baseline);
  assert.ok(Math.abs(restored.canvas.ratio - 1.5) < 0.005);
  const invalid = await state('invalid-pin-saved-choice', '&quality=not-a-preset');
  assert.deepEqual(invalid.quality, saved.quality);
  assert.deepEqual(b.errors, []);
  report.browser = b.version;
  report.launchArguments = b.launchArguments;
  report.errors = b.errors;
  report.passed = true;
} catch (error) {
  evidence.fail(error);
} finally {
  await evidence.close(b, 'browser cleanup');
  await evidence.close(server, 'server cleanup');
  evidence.finish();
}
console.log(`Actual quality boot: ${report.states.length} states passed. Evidence: ${output}`);
