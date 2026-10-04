#!/usr/bin/env node
// scripts/play/snap.mjs (`npm run play:snap [-- --scene <id>] [--mobile]`): see the game. A muted, isolated browser
// opens the scene, takes a desktop screenshot (and a phone one with --mobile), holds the arrow keys a little to measure
// an active frame (and, when nothing redrew because the scene is still, asks the loop for redraws through the test
// API's engine.redraw() so the budget is judged on real frames), and writes what it saw to playtest/latest/ (gitignored):
//   <scene>-desktop.png [<scene>-mobile.png]   the pictures to show the author
//   probe.json                                   scene, world state (resources, named entities), scatters, fps, draws, tris,
//                                                budget status, page errors and console lines
// The summary prints every view's draws, triangles and verdict, then its measured fps labelled advisory: software GL in
// an emulated viewport is not device evidence, so fps is never judged. Screenshot paths are relative to the repository.
// Exit code 1 when the page had errors or the scene is over budget, so an agent notices. A window with no rendered frame
// is reported as 'not measured (no frames rendered)', never as 'within budget'.
import {PROBE} from '../perf/probe-inject.mjs';
import {
  budgetLine,
  budgetStatus,
  evidencePath,
  frameRateLine,
  freshOut,
  homeScene,
  measure,
  open,
  serve,
  sleep,
  VIEWS,
  viewLine,
  write,
} from './lib.mjs';

const argv = process.argv.slice(2);
const arg = f => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const scene = arg('--scene') ?? homeScene();

export async function snap({scene, mobile = false, url}) {
  const {launch} = await import('../perf/bench-browser.mjs');
  const dir = freshOut();
  const probe = {scene, when: new Date().toISOString(), views: {}, errors: [], console: []};
  for (const [name, view] of Object.entries(VIEWS).filter(([n]) => n === 'desktop' || mobile)) {
    const b = await launch(view);
    try {
      await b.page.addInitScript(PROBE);
      const lines = await open(b, url, scene);
      const shot = evidencePath(write(dir, `${scene}-${name}.png`, await b.page.screenshot({type: 'png'})));
      const still = await measure(b, null, 600);
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
      probe.views[name] = {
        screenshot: shot,
        viewport: view,
        still,
        moving,
        ...(redrawn ? {redrawn} : {}),
        state: await b.evaluate('window.engine.state()'),
        // Instanced scatters: copies, draws and triangles per scatter (null when the scene has none).
        scatter: await b.evaluate('window.engine.scatter?.() ?? null'),
        budget: {...budgetStatus(scene, judged), window: redrawn ? 'redrawn' : 'moving'},
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
  for (const [name, v] of Object.entries(p.views)) if (name !== 'desktop') console.log(viewLine(name, v));
  if (p.errors.length) console.log(`  page errors:\n    ${p.errors.join('\n    ')}`);
  console.log('  details: playtest/latest/probe.json');
  return p.errors.length || Object.values(p.views).some(v => v.budget.status === 'OVER BUDGET') ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith('snap.mjs')) {
  const server = await serve();
  try {
    process.exitCode = report(await snap({scene, mobile: argv.includes('--mobile'), url: server.url}));
  } catch (error) {
    if (!(await import('../perf/bench-browser.mjs')).reportBrowserError(error)) {
      console.error(`play:snap ${scene}: ${error.message}`);
      process.exitCode = 1;
    }
  } finally {
    await server.close();
  }
}
