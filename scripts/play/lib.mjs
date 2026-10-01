// scripts/play/lib.mjs: the play-and-see loop's shared parts. A dev server with the test API, and the bench's own
// muted, isolated browser (scripts/perf/bench-browser.mjs): a fresh Chromium with --mute-audio, a throwaway context,
// the page opened with ?flags=dev.silent. The user's browser, profile and audio are never touched.
import {createServer as netServer} from 'node:net';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gameDir} from '../lib/game-dir.mjs';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const OUT = join(ROOT, 'playtest', 'latest');
export const VIEWS = {desktop: {width: 1280, height: 800}, mobile: {width: 390, height: 844, mobile: true}};
export const sleep = ms => new Promise(r => setTimeout(r, ms));

const freePort = () => new Promise((resolve, reject) => { const s = netServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const {port} = s.address(); s.close(() => resolve(port)); }); });

/** The dev server (test API included), on a free local port. */
export async function serve({port} = {}) {
  const {createServer} = await import('vite');
  const server = await createServer({root: ROOT, logLevel: 'error', server: {host: '127.0.0.1', port: port ?? await freePort(), strictPort: true}});
  await server.listen();
  const url = server.resolvedUrls.local[0].replace(/\/$/, '');
  return {url, close: () => server.close()};
}

export function readJson(file) { return JSON.parse(readFileSync(join(ROOT, file), 'utf8')); }
/** The game's budgets.json (GAME_DIR, else ./game, else templates/blank/game). */
export const budgets = () => JSON.parse(readFileSync(join(gameDir(), 'budgets.json'), 'utf8'));
/** The scene the game opens on: the first row of budgets.json (src/app/templates.test.ts keeps them equal). */
export const homeScene = () => Object.keys(budgets().scenes ?? {})[0] ?? readFileSync(join(gameDir(), 'game.ts'), 'utf8').match(/firstScene:\s*'([a-z0-9-]+)'/)?.[1];

/** Open the game at a scene and wait until the scene shell says it is active. */
export async function open(b, url, scene, {seed = 1, query = {}} = {}) {
  const pageErrors = [];
  b.page.on('console', m => pageErrors.push(`${m.type()}: ${m.text()}`));
  const target = new URL(`${url}/`);
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
  target.searchParams.set('flags', 'dev.silent');
  target.searchParams.set('seed', String(seed));
  target.hash = `scene/${scene}`;
  await b.goto(target.href);
  try { await b.wait(`!!document.querySelector('#app[data-scene="scene.${scene}"][data-scene-state="active"]') && !!window.engine`, 60000); }
  catch (error) {
    const state = await b.evaluate(`({hash: location.hash, scene: document.querySelector('#app')?.getAttribute('data-scene'), state: document.querySelector('#app')?.getAttribute('data-scene-state')})`).catch(() => null);
    throw Error(`scene.${scene} did not become active (${JSON.stringify(state)}). Page errors: ${[...b.errors, ...pageErrors.filter(l => /^(error|warning)/.test(l))].join(' | ') || 'none'}`, {cause: error});
  }
  await sleep(400);
  return pageErrors;
}

/** A short measured window: frames, draws and triangles per rendered frame, frame-interval p95 (the bench's probe). */
export async function measure(b, during, ms = 1200) {
  const before = await b.evaluate(`({draws: window.__draws ?? 0, tris: window.__tris ?? 0, loop: window.engine.loop()})`);
  const t0 = Date.now();
  const intervals = b.evaluate(`new Promise(r => { const out = []; let last = performance.now(); const end = last + ${ms}; const tick = t => { out.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else r(out); }; requestAnimationFrame(tick); })`);
  if (during) await during();
  const iv = (await intervals).sort((a, c) => a - c);
  const after = await b.evaluate(`({draws: window.__draws ?? 0, tris: window.__tris ?? 0, loop: window.engine.loop(), heap: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null})`);
  const renders = after.loop.renders - before.loop.renders;
  const p95 = iv.length ? iv[Math.min(iv.length - 1, Math.floor(iv.length * 0.95))] : null;
  return {ms: Date.now() - t0, renders, drawsPerFrame: renders ? Math.round((after.draws - before.draws) / renders) : 0, trisPerFrame: renders ? Math.round((after.tris - before.tris) / renders) : 0,
    frameMsP95: p95 === null ? null : +p95.toFixed(1), fps: p95 ? Math.min(60, Math.round(1000 / p95)) : null, heapMiB: after.heap === null ? null : +after.heap.toFixed(1)};
}

/** Budget status of a measured window against the game's budgets.json. */
export function budgetStatus(scene, m) {
  const b = budgets().scenes?.[scene]?.budget;
  if (!b) return {scene, status: 'no budget', rows: []};
  // Heap here is the dev server's whole page (unbundled modules included), so it is reported, not judged: the bench
  // measures the budgeted heap on a production build.
  const rows = [['draws', m.drawsPerFrame], ['triangles', m.trisPerFrame]].filter(([k, v]) => b[k] !== undefined && v !== null)
    .map(([k, v]) => ({metric: k, measured: v, budget: b[k], ok: v <= b[k]}));
  return {scene, status: rows.every(r => r.ok) ? 'within budget' : 'OVER BUDGET', rows};
}

export function freshOut(dir = OUT) { rmSync(dir, {recursive: true, force: true}); mkdirSync(dir, {recursive: true}); return dir; }
export function write(dir, name, data) { writeFileSync(join(dir, name), typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2) + '\n'); return join(dir, name); }
