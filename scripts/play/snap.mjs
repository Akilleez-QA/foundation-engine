#!/usr/bin/env node
// scripts/play/snap.mjs (`npm run play:snap [-- --scene <id>] [--mobile]`): see the game. A muted, isolated browser
// opens the scene, takes a desktop screenshot (and a phone one with --mobile), holds the arrow keys a little to measure
// an active frame, and writes what it saw to playtest/latest/ (gitignored):
//   <scene>-desktop.png [<scene>-mobile.png]   the pictures to show the author
//   probe.json                                   scene, world state (resources, named entities), fps, draws, tris,
//                                                budget status, page errors and console lines
// Exit code 1 when the page had errors or the scene is over budget, so an agent notices.
import {PROBE} from '../perf/probe-inject.mjs';
import {budgetStatus, freshOut, homeScene, measure, open, serve, sleep, VIEWS, write} from './lib.mjs';

const argv = process.argv.slice(2);
const arg = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
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
      const shot = write(dir, `${scene}-${name}.png`, await b.page.screenshot({type: 'png'}));
      const still = await measure(b, null, 600);
      const moving = await measure(b, async () => { await b.key('ArrowUp', true); await sleep(500); await b.key('ArrowUp', false); await b.key('ArrowDown', true); await sleep(500); await b.key('ArrowDown', false); });
      probe.views[name] = {screenshot: shot, viewport: view, still, moving, state: await b.evaluate('window.engine.state()'), budget: budgetStatus(scene, moving)};
      probe.errors.push(...b.errors.map(e => `${name}: ${e}`));
      probe.console.push(...lines.filter(l => !l.startsWith('debug')).map(l => `${name}: ${l}`));
    } finally { await b.close(); }
  }
  write(dir, 'probe.json', probe);
  return probe;
}

if (process.argv[1] && process.argv[1].endsWith('snap.mjs')) {
  const server = await serve();
  try {
    const p = await snap({scene, mobile: argv.includes('--mobile'), url: server.url});
    const d = p.views.desktop, st = d.state;
    console.log(`play:snap ${scene}: ${Object.values(p.views).map(v => v.screenshot.replace(/^.*playtest/, 'playtest')).join(', ')}`);
    const w = st.world;
    console.log(`  world: ${w?.entities ?? 0} entities · state ${JSON.stringify(w?.state ?? {})}${w?.named?.player ? ` · player (${w.named.player.x}, ${w.named.player.z})` : ''}`);
    console.log(`  moving: ${d.moving.fps ?? '-'} fps (p95 ${d.moving.frameMsP95} ms), ${d.moving.drawsPerFrame} draws, ${d.moving.trisPerFrame} tris · still: ${d.still.renders} renders · ${d.budget.status}`);
    if (p.errors.length) console.log(`  page errors:\n    ${p.errors.join('\n    ')}`);
    console.log('  details: playtest/latest/probe.json');
    process.exitCode = p.errors.length || Object.values(p.views).some(v => v.budget.status === 'OVER BUDGET') ? 1 : 0;
  } catch (error) { if (!(await import('../perf/bench-browser.mjs')).reportBrowserError(error)) throw error; }
  finally { await server.close(); }
}
