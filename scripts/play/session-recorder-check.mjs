#!/usr/bin/env node
// scripts/play/session-recorder-check.mjs: the PERF-01 sustained-session recorder in the real app, in the bench's
// muted, isolated Chromium (software GL unless ENGINE_GPU=1). EMULATED evidence only: it exercises the recorder and
// its evidence format; it never measures a physical device and never satisfies DV-01.
//
//   node -r ./scripts/silent-browser.cjs scripts/play/session-recorder-check.mjs [outDir] [--minutes 0.5] [--window-ms 5000]
//        [--mobile] [--profile <label>]
//
// Phases: (A) `?session-record` auto-start includes cold start, follows the scene, and `download()` saves a local file;
// (B) a long run started through `engine.sessionRecorder` with the bench probe's cumulative draw/triangle counters,
// a deliberate main-thread stall, a synthetic hidden-tab period and (when the game has two scenes) a route change.
// Every request is checked to stay on the local dev server: the recorder transmits nothing.
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {ROOT, VIEWS, budgets, homeScene, open, serve, sleep} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {PROBE} from '../perf/probe-inject.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
import {gameDir} from '../lib/game-dir.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const out = resolve(positional[0] ?? 'playtest/diagnostics/session-recorder');
const minutes = Number(flag('--minutes', '0.5'));
const windowMs = Number(flag('--window-ms', '5000'));
const mobile = args.includes('--mobile');
assert.ok(minutes > 0 && Number.isFinite(minutes), '--minutes must be positive');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], {cwd: ROOT, encoding: 'utf8'}).trim() !== '';
const view = mobile ? VIEWS.mobile : VIEWS.desktop;
const profile = flag('--profile', `emulated-${mobile ? 'phone' : 'desktop'}-${process.env.ENGINE_GPU === '1' ? 'gpu' : 'swiftshader'}`);
mkdirSync(out, {recursive: true});

const report = {
  revision, dirty, game: gameDir().replace(ROOT, '').replace(/^\//, ''), view, minutes, windowMs, profile,
  scope: 'emulated browser run: recorder mechanics and evidence format only; not physical-device evidence; DV-01 remains open',
  errors: [], externalRequests: [], phases: {},
  limitations: [
    'Headless Chromium on the build machine (software GL unless ENGINE_GPU=1): frame times describe this host, not any supported device',
    'The hidden-tab period is synthetic (document.hidden overridden and visibilitychange dispatched); a real tab switch or screen lock was not exercised',
    'The stall is a deliberate main-thread busy loop; no thermal throttling was induced or measured',
    'Draw/triangle counters come from the bench probe wrapping WebGL in this test browser only',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
let server, browser;
try {
  server = await serve();
  const origin = new URL(server.url).origin;
  browser = await launch({...view, strictClose: true});
  report.browser = {version: browser.version, executable: browser.executable, launchArguments: browser.launchArguments};
  const page = browser.page;
  await page.addInitScript(PROBE);
  page.on('pageerror', e => report.errors.push(String(e?.message ?? e)));
  page.on('request', r => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) report.externalRequests.push(r.url()); });
  const scenes = Object.keys(budgets().scenes ?? {});
  const home = homeScene();

  // ---- Phase A: auto-start from the address, cold start included, local download.
  await open(browser, server.url, home, {query: {'session-record': '', 'session-profile': profile, 'session-evidence': 'emulated',
    'session-build': revision.slice(0, 12), 'session-window-ms': '1000'}});
  await sleep(1500);
  const auto = await page.evaluate(() => { const s = engine.currentSession(); return s && s.evidence(); });
  assert.ok(auto, '?session-record started a recorder at attach');
  assert.equal(auto.state, 'recording');
  assert.equal(auto.meta.evidence, 'emulated');
  assert.ok(auto.segments.some(s => s.scene === `scene.${home}`), 'the entered scene starts a segment');
  assert.ok(auto.session.frames > 0);
  const downloaded = page.waitForEvent('download');
  assert.equal(await page.evaluate(() => engine.currentSession().download('session-perf-auto.json')), true);
  const file = await downloaded;
  await file.saveAs(resolve(out, 'auto-start.json'));
  const saved = JSON.parse(readFileSync(resolve(out, 'auto-start.json'), 'utf8'));
  assert.equal(saved.schema, 'foundation.session-perf');
  report.phases.autoStart = {segments: auto.segments, frames: auto.session.frames, windows: auto.windows.length, downloaded: true};

  // ---- Phase B: the long run.
  const meta = {profile, evidence: 'emulated', build: revision.slice(0, 12) + (dirty ? '-dirty' : ''), notes: report.scope};
  await page.evaluate(({windowMs, maxWindows, meta}) => {
    window.__session = engine.sessionRecorder({windowMs, maxWindows, meta,
      counters: () => ({draws: window.__draws ?? NaN, triangles: window.__tris ?? NaN})});
  }, {windowMs, maxWindows: Math.max(4, Math.ceil(minutes * 60_000 / windowMs) + 8), meta});
  assert.equal(await page.evaluate(() => engine.currentSession() === window.__session), true);
  // Workload: where the scene has a named player, move it every 100 ms so frames render (a still scene renders nothing,
  // by design). The driver lives in the test page only; it is not part of the recorder.
  report.workload = await page.evaluate(() => {
    let k = 0;
    window.__drive = window.setInterval(() => { k++; window.engine.teleport(Math.sin(k / 10) * 3, Math.cos(k / 10) * 3); }, 100);
    return window.engine.teleport(0, 0) ? 'teleport the named player every 100 ms' : 'no named player: the scene ran as authored';
  });
  const totalMs = minutes * 60_000, t0 = Date.now();
  const second = scenes.find(s => s !== home);
  let stalled = false, hid = false, routed = false;
  while (Date.now() - t0 < totalMs) {
    const elapsed = Date.now() - t0;
    if (!stalled && elapsed > totalMs * 0.25) {
      // A deliberate 120 ms main-thread stall inside a frame: it must appear as a severe frame.
      // Resolve only after the loop has ticked twice more: the tick carrying the stalled interval is the first or
      // second loop frame after the stall (rAF callback order within a frame), and holding the clock before that
      // tick would reset the loop's interval and silently drop the stall. Bounded so an idle loop fails clearly.
      await page.evaluate(() => new Promise((r, reject) => requestAnimationFrame(() => {
        const end = performance.now() + 120; while (performance.now() < end) { /* stall */ }
        const seen = engine.loop().frames, deadline = performance.now() + 30_000;
        const wait = () => {
          if (engine.loop().frames >= seen + 2) r();
          else if (performance.now() > deadline) reject(new Error(`the frame loop did not tick after the stall (frames ${seen} -> ${engine.loop().frames})`));
          else requestAnimationFrame(wait);
        };
        requestAnimationFrame(wait);
      })));
      stalled = true;
      // Held, script-stepped frames (engine.clock) must be counted but never timed.
      await page.evaluate(() => { engine.clock.hold(); engine.clock.step(500); engine.clock.resume(); });
    }
    if (!hid && elapsed > totalMs * 0.45) {
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', {configurable: true, get: () => true}); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(3000);
      await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
      hid = true;
    }
    if (!routed && second && elapsed > totalMs * 0.6) {
      await page.evaluate(s => engine.goto(s), second);
      await sleep(Math.min(10_000, totalMs * 0.1));
      await page.evaluate(s => engine.goto(s), home);
      routed = true;
    }
    await sleep(Math.min(2000, Math.max(100, totalMs - (Date.now() - t0))));
  }
  await page.evaluate(() => window.clearInterval(window.__drive));
  const live = await page.evaluate(() => engine.loop());
  await page.evaluate(() => window.__session.stop());
  const e = await page.evaluate(() => window.__session.evidence());
  writeFileSync(resolve(out, 'session-perf.json'), JSON.stringify(e, null, 2) + '\n');

  assert.equal(e.schema, 'foundation.session-perf');
  assert.equal(e.state, 'stopped');
  assert.equal(e.meta.evidence, 'emulated');
  assert.ok(e.windows.filter(w => w.complete).length >= 2, 'at least two complete windows for drift');
  assert.ok(e.windows.length <= e.recorder.maxWindows, 'bounded');
  assert.equal(e.session.hiddenTransitions, 1, 'the synthetic hidden period reached the recorder through the loop');
  assert.ok(e.windows.some(w => w.end === 'hidden'), 'hidden closes the open window');
  assert.ok(e.session.severeFrames >= 1, 'the deliberate stall is a severe frame');
  assert.equal(e.session.steppedFrames, 10, 'ten 50 ms stepped frames are counted');
  assert.equal(e.session.clockAnomalies, 0, 'stepped timestamps never reach the session timeline');
  assert.ok(e.session.frameMs.max >= 100, 'the stall appears in the distribution');
  assert.equal(e.session.counterFailures, 0, 'the counters were readable at every window boundary');
  for (const w of e.windows) assert.equal(w.drawsPerRenderedFrame === null, w.renderedFrames === 0, 'per-rendered-frame means exist exactly when frames rendered');
  if (second) assert.ok(e.segments.some(s => s.scene === `scene.${second}`), 'the route change starts a segment');
  assert.ok(e.drift.length >= 1);
  assert.equal(await page.evaluate(() => engine.currentSession().state), 'stopped');
  assert.deepEqual(report.externalRequests, [], 'nothing left the local server');
  assert.deepEqual(report.errors, []);
  report.phases.long = {state: e.state, windows: e.windows.length, complete: e.windows.filter(w => w.complete).length,
    segments: e.segments.length, session: e.session, drift: e.drift, loop: live, routed, stalled, hid};
  report.passed = true;
} catch (error) { evidence.fail(error); }
finally {
  await evidence.close(browser, 'browser cleanup'); await evidence.close(server, 'server cleanup'); evidence.finish();
}
console.log(`Session recorder: PASS; ${out}`);
