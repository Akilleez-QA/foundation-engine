// S2: the pose-to-pose exports in the stock model loader, in one isolated muted browser (no Blender).
// Clip names and durations come from the engine's model inspection; loop seams, foot planting under root
// motion, the strike's impact marker and the wave are checked frame by frame on a held clock.
// Run: GAME_DIR=tools/pose-to-pose/game node -r ./scripts/silent-browser.cjs tools/pose-to-pose/browser.mjs [outDir]
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {launch} from '../../scripts/perf/bench-browser.mjs';
import {PROBE} from '../../scripts/perf/probe-inject.mjs';
import {serve, open, measure, budgetStatus} from '../../scripts/play/lib.mjs';

const out = resolve(process.argv.slice(2).find(a => !a.startsWith('-')) ?? 'playtest/pose-to-pose');
const models = new URL('./game/public/models/', import.meta.url);
const manifest = name => JSON.parse(readFileSync(new URL(`${name}.clips.json`, models), 'utf8'));
const STEP = 1000 / 60;
const sanitise = name => name.replace(/[[\].:/]/g, '').replace(/\s/g, '_'); // three.js PropertyBinding rules

test('S2: clips play by name with their durations, loops have no seam pop and the strike event fires once', async () => {
  mkdirSync(out, {recursive: true});
  const report = {passed: false, errors: [], clips: {}, seams: {}, limitations: []};
  report.limitations.push(
    'Desktop Chromium with software GL only; no physical device, GPU or performance acceptance.',
    'Seams are judged on sampled joint positions at 60 Hz steps; visual smoothness is for a person to judge.',
  );
  let server, browser;
  try {
    server = await serve();
    browser = await launch({strictClose: true});
    const page = browser.page;
    await page.addInitScript(PROBE);
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => m.type() === 'error' && report.errors.push(m.text()));
    await open(browser, server.url, 'main');
    await page.waitForFunction(() => {
      const s = window.engine.state().world.state;
      return s.robotStatus === 'ready' && s.bugStatus === 'ready';
    });
    await page.evaluate(() => window.engine.clock.hold());
    const state = () => page.evaluate(() => window.engine.state().world.state);
    const step = (n = 1) =>
      page.evaluate(
        ([n, ms]) => {
          for (let i = 0; i < n; i++) window.engine.clock.step(ms);
        },
        [n, STEP],
      );
    const inspect = (entity, sockets = []) =>
      page.evaluate(
        ([entity, sockets]) =>
          window.engine.model({entity, expectedEpoch: window.engine.state().scene.epoch, sockets, clipLimit: 64}),
        [entity, sockets],
      );
    const start = await state();

    // 1. Every clip by its exact name, with the duration the definition declared.
    for (const [key, name] of [
      ['robotEntity', 'pose-robot'],
      ['bugEntity', 'pose-bug'],
    ]) {
      const info = await inspect(start[key]);
      assert.equal(info.status, 'ready', `${name} inspection`);
      const found = Object.fromEntries(info.model.clips.items.map(c => [c.name.value, c.duration]));
      const wanted = manifest(name).clips;
      assert.deepEqual(Object.keys(found).sort(), wanted.map(c => c.name).sort(), `${name} clip names`);
      for (const c of wanted) assert.ok(Math.abs(found[c.name] - c.duration) < 1e-4, `${name} ${c.name} duration`);
      report.clips[name] = found;
    }

    // 2. Loops: the step across the wrap is no larger than its neighbours; feet stay put under root motion.
    async function sampleLoop(entityKey, clip, sockets, cycles, relative) {
      const samples = [];
      for (let i = 0; i < Math.ceil((cycles * clip.duration * 1000) / STEP); i++) {
        await step();
        const info = await inspect(start[entityKey], sockets.map(sanitise));
        const s = await state();
        assert.ok(
          info.model.sockets.every(k => k.status === 'ready'),
          'sockets resolve by node name',
        );
        samples.push({
          time: info.model.playback.time,
          clip: info.model.playback.clip.value,
          world: info.model.sockets.map(k => k.matrix.slice(12, 15)),
          origin: relative ? [s.robotX, 0, s.robotZ] : [0, 0, 0],
        });
      }
      assert.ok(
        samples.every(s => s.clip === clip.name),
        `${clip.name} kept playing`,
      );
      const local = samples.map(s => s.world.map(p => p.map((v, i) => v - s.origin[i])));
      const moves = local.map((pose, i) =>
        i ? Math.max(...pose.map((p, k) => Math.hypot(...p.map((v, j) => v - local[i - 1][k][j])))) : 0,
      );
      const wraps = samples.map((s, i) => i > 0 && s.time < samples[i - 1].time).flatMap((w, i) => (w ? [i] : []));
      assert.ok(wraps.length >= 1, `${clip.name} wrapped at least once`);
      const seam = wraps.map(i => {
        const around = [i - 2, i - 1, i + 1, i + 2].filter(j => j > 0 && j < moves.length).map(j => moves[j]);
        return {step: i, move: moves[i], neighbours: Math.max(...around)};
      });
      for (const s of seam)
        assert.ok(
          s.move <= 1.5 * s.neighbours + 1e-4,
          `${clip.name}: the loop seam moves ${s.move.toFixed(4)} m in one step, neighbours ${s.neighbours.toFixed(4)} m`,
        );
      report.seams[clip.name] = {steps: samples.length, largestStep: Math.max(...moves), wraps: seam};
      return samples;
    }
    const scuttle = manifest('pose-bug').clips.find(c => c.name === 'scuttle');
    await sampleLoop('bugEntity', scuttle, ['leg1_tip.L', 'leg2_tip.R', 'tail.3', 'stinger'], 1.6, false);
    const walk = manifest('pose-robot').clips.find(c => c.name === 'walk');
    const walked = await sampleLoop('robotEntity', walk, ['foot.L', 'foot.R', 'hand.R', 'spine.006'], 1.6, true);
    // The planted left foot, in world space while the root motion carries the robot, stays within 4 cm.
    // Runs are split where the robot is placed back at the start of its path (a seek, not motion).
    const footL = walked.map(s => ({p: s.world[0], z: s.origin[2]}));
    const low = Math.min(...footL.map(f => f.p[1]));
    let run = [],
      spread = 0,
      runs = 0;
    const close = () => {
      if (run.length > 2) {
        runs++;
        for (const a of run) for (const b of run) spread = Math.max(spread, Math.hypot(a[0] - b[0], a[2] - b[2]));
      }
      run = [];
    };
    footL.forEach((f, i) => {
      if (i && f.z < footL[i - 1].z) close();
      if (f.p[1] <= low + 0.01) run.push(f.p);
      else close();
    });
    close();
    report.walkPlantedFoot = {runs, spread};
    assert.ok(runs >= 1 && spread < 0.04, `the planted foot slides ${spread.toFixed(3)} m in the engine`);
    const after = await state();
    report.travelled = {metres: after.travelled, expected: (after.walkTime / walk.duration) * walk.rootMotion.stride};
    assert.ok(Math.abs(report.travelled.metres - report.travelled.expected) < 0.01, 'root motion travels the stride');
    await page.screenshot({path: resolve(out, 'loops.png')});

    // 3. The strike: one `impact` marker on the strike clip's own clock, then back to the scuttle loop.
    await page.keyboard.press('Space');
    const strike = manifest('pose-bug').clips.find(c => c.name === 'strike');
    const impact = strike.events.find(e => e.name === 'impact').at;
    let impactStep = null,
      shot = false;
    for (let i = 0; i < Math.ceil((strike.duration + 0.2) * 60); i++) {
      await step();
      const s = await state();
      if (impactStep === null && s.impacts === 1) {
        impactStep = i;
        const info = await inspect(start.bugEntity);
        report.impact = {at: s.impactAt, clip: info.model.playback.clip.value, clipTime: info.model.playback.time};
      }
      if (!shot && s.impacts === 1) {
        await page.screenshot({path: resolve(out, 'strike-impact.png')});
        shot = true;
      }
    }
    const done = await state();
    assert.equal(done.impacts, 1, 'the impact event fired exactly once');
    assert.equal(report.impact.clip, 'strike');
    assert.ok(Math.abs(report.impact.at - impact) < 1e-9, 'the marker carries the event time');
    assert.ok(Math.abs(report.impact.clipTime - impact) <= 1.5 / 60, 'it fired within a frame of the clip time');
    assert.equal(done.bugClip, 'scuttle', 'the one-shot strike hands back to the scuttle loop');

    // 4. The wave holds its last pose with the right hand raised; walking resumes on the second press.
    const before = (await inspect(start.robotEntity, [sanitise('hand.R')])).model.sockets[0].matrix[13];
    await page.keyboard.press('KeyE');
    await step(Math.ceil(0.8 * 60));
    const waved = await inspect(start.robotEntity, [sanitise('hand.R')]);
    assert.equal(waved.model.playback.clip.value, 'wave');
    report.wave = {handRise: waved.model.sockets[0].matrix[13] - before, time: waved.model.playback.time};
    assert.ok(report.wave.handRise > 0.3, 'the right hand rises above the head');
    await page.screenshot({path: resolve(out, 'wave.png')});
    await page.keyboard.press('KeyE');
    await step(2);
    assert.equal((await state()).robotClip, 'walk');

    // 5. Counts against the declared budget.
    await page.evaluate(() => window.engine.clock.resume());
    report.renderCounts = await measure(
      browser,
      async () => {
        for (let i = 0; i < 3; i++) {
          await browser.evaluate('window.engine.redraw()');
          await page.waitForTimeout(100);
        }
      },
      500,
    );
    report.budget = budgetStatus('main', report.renderCounts);
    assert.ok(report.renderCounts.renders > 0, 'frames rendered');
    assert.equal(report.budget.status, 'within budget');
    assert.deepEqual(report.errors, [], 'no page or console errors');
    report.passed = true;
  } finally {
    writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
    console.log(JSON.stringify(report, null, 2));
  }
});
