#!/usr/bin/env node
// scripts/play/spatial-audio-check.mjs (`npm run test:audio-browser`): deterministic signal evidence for the spatial
// voice path. The muted, isolated test browser (scripts/perf/bench-browser.mjs: `--mute-audio`, throwaway profile)
// opens a fixture that renders the real output into OfflineAudioContexts: rendering goes to memory, never to a device,
// and no real-time AudioContext is created. System and application audio are never touched.
//
// Proves: the panning model applied per voice and the HRTF limit's equal-power fallback (on the nodes and in the
// rendered signal), distance gain per model against the spec formulas, the audible cutoff, the filter stage's values
// and ramp continuity, and smoothed position ramps. It does not prove perceived localisation, which needs human
// headphone trials, or any device's cost.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';

const out = resolve(process.argv[2] ?? 'playtest/audio/spatial');
mkdirSync(out, {recursive: true});
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim(),
  errors: [],
  limitations: [
    'OfflineAudioContext in one Chromium build: proves configuration and rendered signal behaviour, not perceived localisation',
    'Generic browser HRTF data; no human listening trials, no Firefox/WebKit runs, no device cost or latency measurement',
  ],
};
const evidence = diagnosticReport(report, resolve(out, 'report.json'));
const html =
  '<!doctype html><html><head><link rel="icon" href="data:,"></head><body><script type="module" src="/scripts/play/fixtures/spatial-audio-entry.mjs"></script></body></html>';
let server, browser;
try {
  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    plugins: [
      {
        name: 'spatial-audio-diagnostic',
        configureServer(s) {
          s.middlewares.use((req, res, next) => {
            if (!req.url?.startsWith('/__spatial-audio.html')) return next();
            res.setHeader('Content-Type', 'text/html');
            res.end(html);
          });
        },
      },
    ],
    server: {host: '127.0.0.1', port: 0},
  });
  await server.listen();
  browser = await launch({width: 400, height: 300, strictClose: true});
  const page = browser.page;
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.goto(`${server.resolvedUrls.local[0]}__spatial-audio.html?flags=dev.silent`);
  await page.waitForFunction(() => window.spatialAudioReady === true);
  const r = await page.evaluate(() => window.spatialAudio.run());
  report.results = r;
  const db = (a, b) => 20 * Math.log10((a + 1e-12) / (b + 1e-12));
  const close = (a, b, tolerance, what) =>
    assert.ok(Math.abs(a - b) <= tolerance, `${what}: ${a} vs ${b} (±${tolerance})`);

  // Panning model selection and the HRTF limit, on the nodes and in the signal.
  assert.deepEqual(r.selection.voices, ['HRTF', 'equalpower', 'equalpower']);
  assert.deepEqual(r.selection.nodes, ['HRTF', 'equalpower', 'equalpower']);
  assert.equal(r.selection.downgraded, 2);
  assert.equal(r.selection.refused, 0, 'HRTF never refuses playback');
  const ep = r.panning.equalpower,
    hrtf = r.panning.HRTF,
    capped = r.panning['HRTF limit 0'];
  assert.deepEqual(ep.models, ['equalpower']);
  assert.deepEqual(hrtf.models, ['HRTF']);
  assert.deepEqual(capped.models, ['equalpower']);
  assert.equal(capped.downgraded, 1);
  for (const [name, p] of Object.entries(r.panning)) {
    assert.ok(p.frontRms > 1e-3, `${name} renders sound (HRTF data loaded)`);
    assert.ok(p.leftOverRightDb > 3, `${name}: a source on the left is louder on the left (${p.leftOverRightDb} dB)`);
  }
  // Equal-power folds front/back and ignores elevation (the documented limitation); HRTF does not.
  assert.ok(ep.frontBackDiff < 1e-4, `equal-power front and back identical (${ep.frontBackDiff})`);
  assert.ok(ep.elevationDiff < 1e-4, `equal-power ignores elevation (${ep.elevationDiff})`);
  assert.ok(
    capped.frontBackDiff < 1e-4,
    `the HRTF limit's fallback really renders equal-power (${capped.frontBackDiff})`,
  );
  assert.ok(hrtf.frontBackDiff > 0.05, `HRTF front and back differ (${hrtf.frontBackDiff})`);
  assert.ok(hrtf.elevationDiff > 0.05, `HRTF above and level differ (${hrtf.elevationDiff})`);

  // Distance gain per model matches the spec formulas; inverse and exponential ignore maxDistance (40) at 60.
  for (const row of r.distance)
    close(row.measured, row.expected, 0.01 * row.expected + 1e-4, `${row.model} at ${row.distance}`);
  // Audible cutoff: refused start, silence beyond, return in range at the model's gain.
  assert.equal(r.cutoff.culledVoice, null);
  assert.equal(r.cutoff.culled, 1);
  assert.ok(r.cutoff.before > 1e-2, 'audible within the cutoff');
  assert.ok(r.cutoff.beyond < 1e-5, `silent beyond the cutoff (${r.cutoff.beyond})`);
  close(r.cutoff.back, r.cutoff.expectedBack, 0.02 * r.cutoff.expectedBack, 'back in range at the inverse gain');
  // Filter stage: values after the ramp, attenuation, and no instant step.
  assert.equal(r.filter.type, 'lowpass');
  close(r.filter.frequencyAfter, 375, 375 * 0.01, 'filter frequency after the ramp');
  assert.ok(
    r.filter.attenuationDb > 30,
    `3 kHz attenuated by the 375 Hz low-pass and 0.5 gain (${r.filter.attenuationDb} dB)`,
  );
  assert.ok(
    r.filter.worstBlockStepDb < 4,
    `ramped: no 128-frame block steps by 4 dB or more (${r.filter.worstBlockStepDb} dB)`,
  );
  // Position smoothing on an off-axis pass: an instant move jumps the stereo balance in one block; a smoothed move
  // sweeps it in small per-block steps. Both end at the same place.
  assert.ok(
    r.smoothing.instant.worstBlockBalanceStepDb > 15,
    `instant move jumps (${r.smoothing.instant.worstBlockBalanceStepDb} dB in one block)`,
  );
  assert.ok(
    r.smoothing.smoothed.worstBlockBalanceStepDb < 4,
    `smoothed move sweeps (worst ${r.smoothing.smoothed.worstBlockBalanceStepDb} dB per block)`,
  );
  for (const run of [r.smoothing.instant, r.smoothing.smoothed]) {
    assert.ok(run.startRightOverLeftDb > 6 && run.settledRightOverLeftDb < -6, 'right before, left after');
    close(run.finalX, -5, 0.01, 'final position');
  }
  // spatial-audio kit over the real output: occlusion ramps the filter, a stolen voice fades.
  const occ = r.kitOcclusion;
  assert.equal(occ.blocked.occluded, true);
  assert.equal(occ.clear.occluded, false);
  assert.ok(
    db(occ.clear.after, occ.blocked.after) > 15,
    `occluded 3 kHz is >15 dB quieter (${db(occ.clear.after, occ.blocked.after)} dB)`,
  );
  close(occ.clear.after, occ.clear.before, 0.02 * occ.clear.before, 'a clear path is unchanged');
  assert.ok(
    occ.blocked.worstBlockStepDb < 4,
    `occlusion ramps without a step (worst ${occ.blocked.worstBlockStepDb} dB per block)`,
  );
  const steal = r.kitSteal;
  assert.equal(steal.stolen, 1);
  assert.equal(steal.voices, 1, 'the stolen voice was stopped after its fade; the new one plays');
  assert.ok(db(steal.before, steal.faded) > 30, `the stolen voice faded (${db(steal.before, steal.faded)} dB)`);
  assert.ok(steal.worstFadeStepDb < 6, `faded, not cut (worst ${steal.worstFadeStepDb} dB per block)`);
  assert.ok(steal.after > steal.before, 'the stronger emission plays after the steal');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  evidence.fail(error);
} finally {
  await evidence.close(browser, 'browser cleanup');
  await evidence.close(server, 'server cleanup');
  evidence.finish();
}
console.log(`Spatial audio (OfflineAudioContext): PASS; ${out}`);
