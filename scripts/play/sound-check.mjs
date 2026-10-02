#!/usr/bin/env node
// scripts/play/sound-check.mjs (`npm run test:sound-browser`): a game's own sound files in a real composed app, in the
// bench's muted, isolated headless Chromium with `?flags=dev.silent`. Automated pages are always silent (STD-TST-8), so
// this proves the parts a test may: a scene's `sounds` are fetched once from the public base while it loads, a missing
// file (here the dev server's HTML fallback page) is reported once per visit without breaking the scene, `ctx.play` with volume/pitch/position never creates an
// AudioContext or plays, and re-entering the scene does not fetch a held file again. Decoding and audible playback are
// covered only by unit tests with an injected AudioContext; listening on devices is manual and unverified here.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT, sleep} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out = resolve(process.argv[2] ?? '/tmp/foundation-sound-browser');
mkdirSync(out, {recursive: true});
const html = '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Sound diagnostic</title></head><body><header class="shell-header"><div class="header-left"></div><div class="header-right"></div></header><main id="app" class="app-root"></main><script type="module" src="/scripts/play/fixtures/sound-entry.mjs"></script></body></html>';
const server = await createServer({root: ROOT, logLevel: 'error', plugins: [{name: 'sound-diagnostic', configureServer(s) {
  s.middlewares.use((req, res, next) => { if (req.url?.startsWith('/__sound.html')) { res.setHeader('Content-Type', 'text/html'); res.end(html); } else next(); });
}}], server: {host: '127.0.0.1', port: 0}});
const report = {revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(), passed: false,
  limitations: ['Automation is always silent: no AudioContext, decode or audible playback happens in this check.', 'Desktop Chromium only; no physical device or listening evidence.']};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
let browser;
try {
  await server.listen();
  browser = await launch({width: 800, height: 600, strictClose: true});
  const p = browser.page, requests = [], warnings = [];
  p.on('request', r => { if (r.url().includes('/sounds/mechanics/')) requests.push(new URL(r.url()).pathname); });
  p.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text()); });
  await p.goto(`${server.resolvedUrls.local[0]}__sound.html?flags=dev.silent#scene/sample`);
  await p.waitForFunction(() => window.soundCheck?.scene() === 'sample', null, {timeout: 60000});
  await p.waitForFunction(() => window.soundCheck.audio().sounds.fetches === 2);
  await p.waitForFunction(() => window.soundCheck.audio().sounds.failures === 1);
  const entered = await p.evaluate(() => window.soundCheck.audio());
  report.entered = entered;
  assert.equal(entered.silent, true); assert.equal(entered.contexts, 0);
  assert.equal(entered.sounds.files, 1); assert.ok(entered.sounds.encodedBytes > 1000); assert.equal(entered.sounds.decodes, 0);
  assert.deepEqual([...requests].sort(), ['/sounds/mechanics/chime.wav', '/sounds/mechanics/missing.wav']);
  // Plays in a silent page are skipped: no context, nothing played, nothing thrown.
  await p.evaluate(() => { window.soundCheck.play('chime', {volume: .5, pitch: 1.5, position: [1, 0, 2]}); window.soundCheck.play('ui.click'); });
  assert.equal(await p.evaluate(() => window.soundCheck.voice('chime')), null);
  await assert.rejects(p.evaluate(() => window.soundCheck.play('chime', {volume: 2})), /volume/);
  const played = await p.evaluate(() => window.soundCheck.audio());
  assert.equal(played.contexts, 0); assert.equal(played.played, 0); assert.equal(played.skipped, entered.skipped + 3);
  // Re-entering keeps the held file; the failed one is tried again once.
  await p.evaluate(() => document.location.assign('#scene/other'));
  await p.waitForFunction(() => window.soundCheck.scene() === 'other');
  await p.evaluate(() => document.location.assign('#scene/sample'));
  await p.waitForFunction(() => window.soundCheck.scene() === 'sample');
  await p.waitForFunction(() => window.soundCheck.audio().sounds.fetches === 3);
  await sleep(300);
  const again = await p.evaluate(() => window.soundCheck.audio());
  report.reentered = again;
  assert.equal(again.sounds.fetches, 3, 'only the missing file is fetched again'); assert.equal(again.sounds.failures, 2);
  assert.equal(requests.filter(r => r.endsWith('chime.wav')).length, 1);
  const soundWarnings = warnings.filter(w => /sound 'missing' failed/.test(w));
  assert.equal(soundWarnings.length, 2, 'one report per visit');
  report.warnings = warnings;
  const unexpected = browser.errors;
  assert.deepEqual(unexpected, []);
  report.passed = true;
} catch (error) { evidence.fail(error); }
finally { await evidence.close(browser, 'browser close'); await evidence.close(server, 'server close'); evidence.finish(); }
console.log(`Sound files passed (fetched with the scene, silent under automation); evidence ${out}`);
