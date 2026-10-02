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
const OPEN_TIMEOUT_MS = 60000, ERROR_GRACE_MS = 5000;

const freePort = () => new Promise((resolve, reject) => { const s = netServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const {port} = s.address(); s.close(() => resolve(port)); }); });

/**
 * Where `npm run play` listens: this machine only (127.0.0.1) unless asked. `--host` alone (or ENGINE_HOST=1/true)
 * listens on every network interface, so a phone on the same Wi-Fi can open it; `--host <address>` or
 * ENGINE_HOST=<address> picks one. Anyone on that network can then reach the dev server and its test API.
 */
/** True for a host that only this machine can reach. */
export const isLoopback = host => host === 'localhost' || /^127\./.test(String(host)) || host === '::1' || host === '[::1]';

export function listenHost(argv = process.argv.slice(2), env = process.env) {
  const i = argv.findIndex(a => a === '--host' || a.startsWith('--host='));
  const value = i < 0 ? env.ENGINE_HOST : argv[i].startsWith('--host=') ? argv[i].slice(7) : (argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[i + 1] : true);
  if (value === undefined || value === '' || value === '0' || value === 'false') return '127.0.0.1';
  return value === true || value === '1' || value === 'true' ? true : value;
}

/** The dev server (test API included), on a free local port; `host` as in listenHost (default 127.0.0.1). */
export async function serve({port, host = '127.0.0.1'} = {}) {
  const {createServer} = await import('vite');
  const server = await createServer({root: ROOT, logLevel: 'error', server: {host, port: port ?? await freePort(), strictPort: true}});
  await server.listen();
  // A specific non-loopback address (`--host 192.168.1.5`) is listed only under `network`, with `local` empty.
  const {local = [], network = []} = server.resolvedUrls ?? {};
  const first = local[0] ?? network[0];
  if (!first) { await server.close(); throw Error(`the dev server reported no URL for host ${host === true ? 'all interfaces' : host}`); }
  return {url: first.replace(/\/$/, ''), network: network.map(u => u.replace(/\/$/, '')), close: () => server.close()};
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
  // Stop early (ERROR_GRACE_MS after a fatal sign) only when the page cannot boot: an uncaught exception or the app's own
  // '[engine] boot failed' report. Ordinary console errors (a 404 on a slow, cold dev server) never start the grace.
  let fatalAt = null;
  const fatal = () => { fatalAt ??= Date.now(); };
  b.page.on('pageerror', fatal);
  b.page.on('console', m => { if (m.type() === 'error' && m.text().startsWith('[engine] boot failed')) fatal(); });
  await b.goto(target.href);
  const active = `!!document.querySelector('#app[data-scene="scene.${scene}"][data-scene-state="active"]') && !!window.engine`;
  let failure = null;
  for (const t0 = Date.now(); ;) {
    if (await b.evaluate(active).catch(() => false)) break;
    if (Date.now() - t0 > OPEN_TIMEOUT_MS) { failure = `timeout ${OPEN_TIMEOUT_MS} ms`; break; }
    if (fatalAt !== null && Date.now() - fatalAt > ERROR_GRACE_MS) { failure = 'the app failed to boot (uncaught exception or boot failure report)'; break; }
    await sleep(100);
  }
  if (failure) {
    const state = await b.evaluate(`({hash: location.hash, scene: document.querySelector('#app')?.getAttribute('data-scene'), state: document.querySelector('#app')?.getAttribute('data-scene-state')})`).catch(() => null);
    throw Error(`scene.${scene} did not become active: ${failure} (${JSON.stringify(state)}). Page errors: ${[...b.errors, ...pageErrors.filter(l => /^(error|warning)/.test(l))].join(' | ') || 'none'}. Run npm run check: it reports boot problems such as input binding clashes.`);
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

export const NOT_MEASURED = 'not measured (no frames rendered)';
/**
 * Budget status of a measured window against the game's budgets.json. A window with no rendered frame proves nothing
 * (render on demand draws nothing while a scene is still), so it is NOT_MEASURED, never 'within budget'.
 */
export function budgetStatus(scene, m) {
  const b = budgets().scenes?.[scene]?.budget;
  if (!b) return {scene, status: 'no budget', rows: []};
  if (!m?.renders) return {scene, status: NOT_MEASURED, rows: []};
  // Heap here is the dev server's whole page (unbundled modules included), so it is reported, not judged: the bench
  // measures the budgeted heap on a production build.
  const rows = [['draws', m.drawsPerFrame], ['triangles', m.trisPerFrame]].filter(([k, v]) => b[k] !== undefined && v !== null)
    .map(([k, v]) => ({metric: k, measured: v, budget: b[k], ok: v <= b[k]}));
  return {scene, status: rows.every(r => r.ok) ? 'within budget' : 'OVER BUDGET', rows};
}

/** One line for a budget status: what was over and by how much, and where the recovery steps are. */
export function budgetLine(status) {
  if (status.status !== 'OVER BUDGET') return status.status;
  const over = status.rows.filter(r => !r.ok).map(r => `${r.metric} ${r.measured} > ${r.budget}`).join(', ');
  return `OVER BUDGET (${over} per rendered frame, budgets.json scenes.${status.scene}): recover with .claude/skills/fix-budget/SKILL.md (simplify, instance, bake, LOD); never raise a budget without the author`;
}

export function freshOut(dir = OUT) { rmSync(dir, {recursive: true, force: true}); mkdirSync(dir, {recursive: true}); return dir; }
export function write(dir, name, data) { writeFileSync(join(dir, name), typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2) + '\n'); return join(dir, name); }
