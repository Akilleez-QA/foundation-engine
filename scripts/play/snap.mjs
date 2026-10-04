#!/usr/bin/env node
// scripts/play/snap.mjs (`npm run play:snap [-- --scene <id>] [--mobile] [--quality <preset>] [--calm]`): see the game.
// A muted, isolated browser opens the scene, takes a desktop screenshot (and a phone one with --mobile), holds the
// arrow keys a little to measure
// an active frame (and, when nothing redrew because the scene is still, asks the loop for redraws through the test
// API's engine.redraw() so the budget is judged on real frames), and writes what it saw to playtest/latest/ (gitignored):
//   <scene>-desktop.png [<scene>-mobile.png]   the pictures to show the author
//   probe.json                                   scene, world state (resources, named entities), scatters, fps, draws, tris,
//                                                gpu (textureMiB, shadowPasses, shadowCasters), budget status (every
//                                                count against the scene's row), page errors and console lines
// The summary prints every view's draws, triangles and verdict, a counts line with draws, postDraws, triangles,
// shadowCasters, shadowPasses and textureMiB each against the scene's budget (look checklist item 9), then its measured
// fps labelled advisory: software GL in an emulated viewport is not device evidence, so fps is never judged.
// Screenshot paths are relative to the repository.
// Exit code 1 when the page had errors or the scene is over budget, so an agent notices. A window with no rendered frame
// is reported as 'not measured (no frames rendered)', never as 'within budget'.
//
// Tiers: the phone view is pinned to the phone default (PHONE_PRESET, medium: the device-class start rule for a
// minimum-class phone), because an automated browser never runs detection and would otherwise show the reference
// picture. --quality <reference|high|medium|low> pins every view instead; the desktop view is unpinned without it. Each
// view prints the tier it ran at and why, and its budget is judged at that tier (the row's ports).
// Activity: every view watches 1.5 s with no input and records renders, whether the picture changed and the particle
// counters. --calm opens every view with reduced motion (the default of the Calm setting), names the shots
// <scene>-<view>-calm.png and reports whether motion and emitters stopped; it never changes the exit code (whether what
// still moves is decorative is a person's judgement).
import {PROBE} from '../perf/probe-inject.mjs';
import {
  activity,
  activityLine,
  budgetLine,
  budgetStatus,
  countsLine,
  gpuCensus,
  evidencePath,
  frameRateLine,
  freshOut,
  homeScene,
  PHONE_PRESET,
  measure,
  open,
  serve,
  sleep,
  VIEWS,
  viewLine,
  viewPreset,
  write,
} from './lib.mjs';

const argv = process.argv.slice(2);
const arg = f => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const scene = arg('--scene') ?? homeScene();
const quality = arg('--quality');

export async function snap({scene, mobile = false, url, quality, calm = false}) {
  const {launch} = await import('../perf/bench-browser.mjs');
  const dir = freshOut();
  const probe = {
    scene,
    when: new Date().toISOString(),
    ...(calm ? {calm: true} : {}),
    views: {},
    errors: [],
    console: [],
  };
  for (const [name, view] of Object.entries(VIEWS).filter(([n]) => n === 'desktop' || mobile)) {
    const pin = viewPreset(name, quality);
    const b = await launch(view);
    try {
      await b.page.addInitScript(PROBE);
      // Calm: the OS reduced-motion preference, the default of the comfort.calm setting (STD-SET-2).
      if (calm) await b.page.emulateMedia({reducedMotion: 'reduce'});
      const lines = await open(b, url, scene, pin ? {query: {quality: pin}} : {});
      const preset = await b.evaluate(`window.engine.probe('quality') ?? null`);
      const calmOn = calm ? !!(await b.evaluate(`window.engine.probe('settings')?.calm`)) : undefined;
      const shot = evidencePath(
        write(dir, `${scene}-${name}${calm ? '-calm' : ''}.png`, await b.page.screenshot({type: 'png'})),
      );
      // What moves on its own with no input: frames, picture changes and particles (with --calm: did it all stop?).
      const still = await measure(b, null, 600);
      const idle = await activity(b);
      const moving = await measure(b, async () => {
        await b.key('ArrowUp', true);
        await sleep(500);
        await b.key('ArrowUp', false);
        await b.key('ArrowDown', true);
        await sleep(500);
        await b.key('ArrowDown', false);
      });
      // Render on demand: a still scene draws nothing while keys it does not read are held. Ask for redraws through the
      // sanctioned test API path so the budget is judged on real frames, not on an empty window.
      const redrawn = moving.renders
        ? null
        : await measure(
            b,
            async () => {
              for (let i = 0; i < 5; i++) {
                await b.evaluate('window.engine.redraw()');
                await sleep(80);
              }
            },
            600,
          );
      const judged = redrawn ?? moving;
      // Texture memory now, and the busiest frame's shadow passes and draws since the scene opened (the bench probe).
      const gpu = await gpuCensus(b);
      probe.views[name] = {
        screenshot: shot,
        viewport: view,
        quality: {preset: preset?.preset ?? null, source: preset?.source ?? null, requested: pin},
        ...(calm ? {calm: calmOn} : {}),
        activity: idle,
        still,
        moving,
        ...(redrawn ? {redrawn} : {}),
        state: await b.evaluate('window.engine.state()'),
        // Instanced scatters: copies, draws and triangles per scatter (null when the scene has none).
        scatter: await b.evaluate('window.engine.scatter?.() ?? null'),
        gpu,
        budget: {
          ...budgetStatus(scene, judged, {gpu, preset: preset?.preset ?? 'reference'}),
          window: redrawn ? 'redrawn' : 'moving',
        },
      };
      probe.errors.push(...b.errors.map(e => `${name}: ${e}`));
      probe.console.push(...lines.filter(l => !l.startsWith('debug')).map(l => `${name}: ${l}`));
    } finally {
      await b.close();
    }
  }
  write(dir, 'probe.json', probe);
  return probe;
}

/** Which tier a view ran at, and why. */
function qualityLine(name, v) {
  const q = v.quality;
  const why = q.requested
    ? name === 'mobile' && q.requested === PHONE_PRESET && !quality
      ? `pinned: the phone default, device-class rule; --quality <preset> to change`
      : 'pinned by --quality'
    : `${q.source ?? 'unknown'}; not pinned`;
  return `quality: ${q.preset ?? 'unknown'} (${why})${q.requested && q.preset !== q.requested ? ` · REQUESTED ${q.requested}` : ''}`;
}

/** The console report of a snap: pictures, world, frames, the budget verdict (with what was measured) and errors. */
function report(p) {
  const d = p.views.desktop,
    st = d.state;
  console.log(
    `play:snap ${p.scene}: ${Object.values(p.views)
      .map(v => v.screenshot)
      .join(', ')}`,
  );
  const w = st.world;
  console.log(
    `  world: ${w?.entities ?? 0} entities · state ${JSON.stringify(w?.state ?? {})}${w?.named?.player ? ` · player (${w.named.player.x}, ${w.named.player.z})` : ''}`,
  );
  const m = d.redrawn ?? d.moving;
  console.log(`  moving: ${d.moving.renders} renders, ${frameRateLine(d.moving)} · still: ${d.still.renders} renders`);
  console.log(
    `  budget (${d.budget.window === 'redrawn' ? 'forced redraws: the scene did not redraw on its own' : 'moving window'}): ${m.renders ? `${m.drawsPerFrame} draws, ${m.trisPerFrame} tris per rendered frame · ` : ''}${budgetLine(d.budget)}`,
  );
  const counts = countsLine(d.budget);
  if (counts) console.log(`  counts: ${counts}`);
  console.log(`  ${qualityLine('desktop', d)}`);
  console.log(`  ${p.calm ? 'calm' : 'activity'}: ${activityLine(d.activity, d.calm)}`);
  for (const [name, v] of Object.entries(p.views)) {
    if (name === 'desktop') continue;
    console.log(viewLine(name, v));
    const c = countsLine(v.budget);
    if (c) console.log(`    counts: ${c}`);
    console.log(`    ${qualityLine(name, v)}`);
    console.log(`    ${p.calm ? 'calm' : 'activity'}: ${activityLine(v.activity, v.calm)}`);
  }
  if (p.errors.length) console.log(`  page errors:\n    ${p.errors.join('\n    ')}`);
  console.log('  details: playtest/latest/probe.json');
  return p.errors.length || Object.values(p.views).some(v => v.budget.status === 'OVER BUDGET') ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith('snap.mjs')) {
  const server = await serve();
  try {
    process.exitCode = report(
      await snap({scene, mobile: argv.includes('--mobile'), url: server.url, quality, calm: argv.includes('--calm')}),
    );
  } catch (error) {
    if (!(await import('../perf/bench-browser.mjs')).reportBrowserError(error)) {
      console.error(`play:snap ${scene}: ${error.message}`);
      process.exitCode = 1;
    }
  } finally {
    await server.close();
  }
}
