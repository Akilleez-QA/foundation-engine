// scripts/play/lib.mjs: the play-and-see loop's shared parts. A dev server with the test API, and the bench's own
// muted, isolated browser (scripts/perf/bench-browser.mjs): a fresh Chromium with --mute-audio, a throwaway context,
// the page opened with ?flags=dev.silent. The user's browser, profile and audio are never touched.
import {createServer as netServer} from 'node:net';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gameDir} from '../lib/game-dir.mjs';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const OUT = join(ROOT, 'playtest', 'latest');
export const VIEWS = {desktop: {width: 1280, height: 800}, mobile: {width: 390, height: 844, mobile: true}};
export const sleep = ms => new Promise(r => setTimeout(r, ms));
const OPEN_TIMEOUT_MS = 60000,
  ERROR_GRACE_MS = 5000;

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = netServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const {port} = s.address();
      s.close(() => resolve(port));
    });
  });

/**
 * Where `npm run play` listens: this machine only (127.0.0.1) unless asked. `--host` alone (or ENGINE_HOST=1/true)
 * listens on every network interface, so a phone on the same Wi-Fi can open it; `--host <address>` or
 * ENGINE_HOST=<address> picks one. Anyone on that network can then reach the dev server and its test API.
 */
/** True for a host that only this machine can reach. */
export const isLoopback = host =>
  host === 'localhost' || /^127\./.test(String(host)) || host === '::1' || host === '[::1]';

export function listenHost(argv = process.argv.slice(2), env = process.env) {
  const i = argv.findIndex(a => a === '--host' || a.startsWith('--host='));
  const value =
    i < 0
      ? env.ENGINE_HOST
      : argv[i].startsWith('--host=')
        ? argv[i].slice(7)
        : argv[i + 1] && !argv[i + 1].startsWith('-')
          ? argv[i + 1]
          : true;
  if (value === undefined || value === '' || value === '0' || value === 'false') return '127.0.0.1';
  return value === true || value === '1' || value === 'true' ? true : value;
}

/**
 * True when a listen failed because the port is taken: Node's EADDRINUSE, or Vite's own `Port N is already in use`
 * (strictPort), which carries no code.
 */
export const isPortBusy = error =>
  error?.code === 'EADDRINUSE' || /^Port \d+ is already in use$/.test(String(error?.message));

/** The one line a command prints for a busy port, with the next port to try, e.g. `PORT=5174 npm run play`. */
export const portBusyHint = (port, retry) => `port ${port} is busy; try ${retry(Number(port) + 1)}`;

/**
 * The dev server (test API included), on a free local port; `host` as in listenHost (default 127.0.0.1). A taken
 * `port` rejects with an error whose `code` is 'EADDRINUSE' and whose `port` names it, after closing the half-started
 * server; callers print portBusyHint instead of a stack trace. Only `npm run play` passes `watch: true`: a person
 * edits while it runs, so changes reload the page. Every other caller (play:snap, play:script, play:criteria) is a
 * short non-interactive run that never sees an edit, so it starts no file watcher (Vite `server.watch: null`) and
 * spends none of the machine's inotify watches.
 */
export async function serve({port, host = '127.0.0.1', watch = false} = {}) {
  const {createServer} = await import('vite');
  const chosen = port ?? (await freePort());
  // Vite's mergeConfig drops a null from inline config, so `server.watch: null` is set in a config hook instead.
  const noWatch = {
    name: 'engine-no-watch',
    config(config) {
      config.server = {...config.server, watch: null};
    },
  };
  const server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: {host, port: chosen, strictPort: true},
    plugins: watch ? [] : [noWatch],
  });
  try {
    await server.listen();
  } catch (error) {
    await server.close().catch(() => {});
    throw isPortBusy(error)
      ? Object.assign(Error(`port ${chosen} is busy`, {cause: error}), {code: 'EADDRINUSE', port: chosen})
      : error;
  }
  // A specific non-loopback address (`--host 192.168.1.5`) is listed only under `network`, with `local` empty.
  const {local = [], network = []} = server.resolvedUrls ?? {};
  const first = local[0] ?? network[0];
  if (!first) {
    await server.close();
    throw Error(`the dev server reported no URL for host ${host === true ? 'all interfaces' : host}`);
  }
  return {
    url: first.replace(/\/$/, ''),
    network: network.map(u => u.replace(/\/$/, '')),
    watching: server.config.server.watch !== null,
    close: () => server.close(),
  };
}

export function readJson(file) {
  return JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
}
/** The game's budgets.json (GAME_DIR, else ./game, else templates/blank/game). */
export const budgets = () => JSON.parse(readFileSync(join(gameDir(), 'budgets.json'), 'utf8'));
/** The scene the game opens on: the first row of budgets.json (src/app/templates.test.ts keeps them equal). */
export const homeScene = () =>
  Object.keys(budgets().scenes ?? {})[0] ??
  readFileSync(join(gameDir(), 'game.ts'), 'utf8').match(/firstScene:\s*'([a-z0-9-]+)'/)?.[1];

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
  const fatal = () => {
    fatalAt ??= Date.now();
  };
  b.page.on('pageerror', fatal);
  b.page.on('console', m => {
    if (m.type() === 'error' && m.text().startsWith('[engine] boot failed')) fatal();
  });
  await b.goto(target.href);
  const active = `!!document.querySelector('#app[data-scene="scene.${scene}"][data-scene-state="active"]') && !!window.engine`;
  let failure = null;
  for (const t0 = Date.now(); ;) {
    if (await b.evaluate(active).catch(() => false)) break;
    if (Date.now() - t0 > OPEN_TIMEOUT_MS) {
      failure = `timeout ${OPEN_TIMEOUT_MS} ms`;
      break;
    }
    if (fatalAt !== null && Date.now() - fatalAt > ERROR_GRACE_MS) {
      failure = 'the app failed to boot (uncaught exception or boot failure report)';
      break;
    }
    await sleep(100);
  }
  if (failure) {
    const state = await b
      .evaluate(
        `({hash: location.hash, scene: document.querySelector('#app')?.getAttribute('data-scene'), state: document.querySelector('#app')?.getAttribute('data-scene-state')})`,
      )
      .catch(() => null);
    throw Error(
      `scene.${scene} did not become active: ${failure} (${JSON.stringify(state)}). Page errors: ${[...b.errors, ...pageErrors.filter(l => /^(error|warning)/.test(l))].join(' | ') || 'none'}. Run npm run check: it reports boot problems such as input binding clashes.`,
    );
  }
  await sleep(400);
  return pageErrors;
}

/** A short measured window: frames, draws, post draws and triangles per rendered frame, frame-interval p95 (the bench's
 *  probe). Post-processing passes are counted apart from the scene's draws (postDraws). */
export async function measure(b, during, ms = 1200) {
  const before = await b.evaluate(
    `({draws: window.__draws ?? 0, post: window.__post ?? 0, tris: window.__tris ?? 0, loop: window.engine.loop()})`,
  );
  const t0 = Date.now();
  const intervals = b.evaluate(
    `new Promise(r => { const out = []; let last = performance.now(); const end = last + ${ms}; const tick = t => { out.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else r(out); }; requestAnimationFrame(tick); })`,
  );
  if (during) await during();
  const iv = (await intervals).sort((a, c) => a - c);
  const after = await b.evaluate(
    `({draws: window.__draws ?? 0, post: window.__post ?? 0, tris: window.__tris ?? 0, loop: window.engine.loop(), heap: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null})`,
  );
  const renders = after.loop.renders - before.loop.renders;
  const p95 = iv.length ? iv[Math.min(iv.length - 1, Math.floor(iv.length * 0.95))] : null;
  return {
    ms: Date.now() - t0,
    renders,
    drawsPerFrame: renders ? Math.round((after.draws - before.draws) / renders) : 0,
    postDrawsPerFrame: renders ? Math.round((after.post - before.post) / renders) : 0,
    trisPerFrame: renders ? Math.round((after.tris - before.tris) / renders) : 0,
    frameMsP95: p95 === null ? null : +p95.toFixed(1),
    fps: p95 ? Math.min(60, Math.round(1000 / p95)) : null,
    heapMiB: after.heap === null ? null : +after.heap.toFixed(1),
  };
}

/**
 * Settle bounds for play:snap: windows of `windowMs`; the scene has settled when `stableWindows` consecutive windows
 * each drew frames and match the window before within `tolerance` (relative) on draws, post draws and triangles per
 * frame; `maxMs` ends the wait either way (the last window is then judged and the result says it did not settle).
 */
export const SETTLE = Object.freeze({windowMs: 600, stableWindows: 2, tolerance: 0.05, maxMs: 8000});

/** Two windows agree: both drew frames and every per-frame count is within `tolerance` of the other (relative). */
export function windowsAgree(a, b, tolerance = SETTLE.tolerance) {
  if (!a?.renders || !b?.renders) return false;
  const near = (x, y) => Math.abs(x - y) <= tolerance * Math.max(Math.abs(x), Math.abs(y), 1);
  return (
    near(a.drawsPerFrame, b.drawsPerFrame) &&
    near(a.postDrawsPerFrame ?? 0, b.postDrawsPerFrame ?? 0) &&
    near(a.trisPerFrame, b.trisPerFrame)
  );
}

/** Whether the last `stableWindows` windows each agree with the one before (so stableWindows + 1 windows at least). */
export function hasSettled(windows, {stableWindows = SETTLE.stableWindows, tolerance = SETTLE.tolerance} = {}) {
  if (windows.length < stableWindows + 1) return false;
  for (let i = windows.length - stableWindows; i < windows.length; i++)
    if (!windowsAgree(windows[i - 1], windows[i], tolerance)) return false;
  return true;
}

/**
 * Measure from the moment a scene opens until its per-frame counts settle. A scene may warm up: compile programs,
 * stream or build geometry, render shadow maps or other passes only on its first frames, or cull nothing until its
 * bounds are known. Each window asks the loop for a few redraws through the test API, so a still scene draws too.
 * Returns the first window (`warmUp`), the last (`steady`), whether it settled, the windows taken and the time.
 */
export async function settle(b, o = {}) {
  const {windowMs, stableWindows, tolerance, maxMs} = {...SETTLE, ...o};
  const t0 = Date.now(),
    windows = [];
  const redraws = async () => {
    for (let i = 0; i < 4; i++) {
      await b.evaluate('window.engine.redraw()');
      await sleep(windowMs / 5);
    }
  };
  do windows.push(await measure(b, redraws, windowMs));
  while (!hasSettled(windows, {stableWindows, tolerance}) && Date.now() - t0 < maxMs);
  return {
    warmUp: windows[0],
    steady: windows.at(-1),
    settled: hasSettled(windows, {stableWindows, tolerance}),
    windows: windows.length,
    ms: Date.now() - t0,
  };
}

/** One line comparing the warm-up window with the steady one, e.g. `warm-up 41 draws, 1,636,000 tris → steady …`. */
export function warmUpLine(s) {
  const f = m =>
    m?.renders ? `${m.drawsPerFrame} draws, ${m.trisPerFrame.toLocaleString('en-US')} tris` : 'no frames';
  const how = s.settled
    ? `settled after ${(s.ms / 1000).toFixed(1)} s (${s.windows} windows)`
    : `did not settle within ${(s.ms / 1000).toFixed(1)} s; the budget is judged on the last frames`;
  return `warm-up (first ${s.windowMs ?? SETTLE.windowMs} ms after open, not judged): ${f(s.warmUp)} → steady: ${f(s.steady)} · ${how}`;
}

/** The page's GPU census from the bench probe (probe-inject.mjs): texture memory and the busiest frame's shadow work
 *  since the page opened the scene. Null fields when the probe is not installed. */
export async function gpuCensus(b) {
  const g = await b.evaluate('window.__gpu ? window.__gpu() : null').catch(() => null);
  return {
    textureMiB: g?.textureMiB ?? null,
    shadowPasses: g?.shadowPassesMax ?? null,
    shadowCasters: g?.shadowPassDrawsMax ?? null,
  };
}

/** Lighter presets fall back to their heavier ports, then the reference values (src/core/budget.ts budgetFor). */
const PORT_CHAIN = {reference: [], high: ['high'], medium: ['high', 'medium'], low: ['high', 'medium', 'low']};
/** A budget row's values at a quality preset: the flat reference values with that preset's ports applied. */
export function budgetAt(budget, preset = 'reference') {
  const {ports, ...flat} = budget ?? {};
  const out = {...flat};
  for (const p of PORT_CHAIN[preset] ?? []) Object.assign(out, ports?.[p] ?? {});
  return out;
}

/** The counts play:snap judges, in budget-row order (the gate's count metrics it can measure on a dev server). */
export const SNAP_METRICS = ['draws', 'postDraws', 'triangles', 'shadowCasters', 'shadowPasses', 'textureMiB'];

/**
 * The preset `play:snap --mobile` pins by default: what the device-class start rule (ADR 0079,
 * src/platform/render/quality.ts deviceClassCap) gives a minimum-class phone (a mobile GPU with 4 GB of memory or 4
 * cores): medium, so the phone picture shows medium's basic post (no bloom), fewer light slots and one shadowed local
 * light. A capable phone starts on high and an entry-level one on low: pass `--quality high` or `--quality low`.
 * An automated browser never runs detection (it would start on the brief's default, usually reference).
 * scripts/play/phone-preset.test.ts keeps this equal to the rule.
 */
export const PHONE_PRESET = 'medium';
export const PRESETS = ['reference', 'high', 'medium', 'low'];

/** The preset a view runs at: `--quality` for every view, else the phone default for the mobile view, else no pin. */
export function viewPreset(name, quality) {
  if (quality !== undefined && !PRESETS.includes(quality))
    throw Error(`--quality must be one of ${PRESETS.join(', ')} (got ${quality})`);
  return quality ?? (name === 'mobile' ? PHONE_PRESET : null);
}

/** Copies, emitters and pictures over a still window with no input: what keeps moving on its own. */
export async function activity(b, ms = 1500) {
  const read = () =>
    b.evaluate(`({loop: window.engine.loop(), particles: window.engine.particles ? window.engine.particles() : null})`);
  const before = await read();
  const first = await b.page.screenshot({type: 'png'});
  await sleep(ms);
  const after = await read();
  const second = await b.page.screenshot({type: 'png'});
  const p0 = before.particles,
    p1 = after.particles;
  // Particles actually added: spawn attempts less those thinned, withheld by Calm or dropped (attempts go on under
  // Calm, so the particles' stream stays the same; only what is shown stops).
  const shown = p => (p ? p.spawned - (p.thinned ?? 0) - (p.calmed ?? 0) - (p.dropped ?? 0) : 0);
  return {
    ms,
    renders: after.loop.renders - before.loop.renders,
    pictureChanged: !first.equals(second),
    particles: p1
      ? {
          emitters: p1.emitters,
          live: p1.live,
          spawned: shown(p1) - shown(p0),
          calmed: (p1.calmed ?? 0) - (p0?.calmed ?? 0),
          draws: p1.draws,
        }
      : null,
  };
}

/** One line for a still window's activity; with Calm on, whether motion and emitters stopped. */
export function activityLine(a, calm) {
  const p = a.particles;
  const parts = [
    `${a.renders} renders`,
    a.pictureChanged ? 'picture changed' : 'picture unchanged',
    p
      ? `${p.emitters} emitter(s), ${p.live} live, ${p.spawned} spawned${p.calmed ? ` (${p.calmed} withheld by Calm)` : ''}`
      : 'no particles',
  ];
  const head = `still ${(a.ms / 1000).toFixed(1)} s with no input: ${parts.join(', ')}`;
  if (calm === undefined) return head;
  if (!calm) return `${head} · CALM NOT ON (the page did not apply reduced motion)`;
  const motion = a.renders === 0 && !a.pictureChanged;
  const emitters = !p || p.spawned === 0;
  return `${head} · motion ${motion ? 'stopped' : 'NOT stopped'}, emitters ${emitters ? 'stopped' : 'NOT stopped'} (a person judges whether what still moves is decorative)`;
}

export const NOT_MEASURED = 'not measured (no frames rendered)';
/**
 * Budget status of a measured window against the game's budgets.json, at the preset the page ran (`preset`, default
 * reference; a lighter preset reads the row's `ports`). Per rendered frame: draws, postDraws, triangles; busiest
 * frame since the scene opened: shadowCasters, shadowPasses; live: textureMiB (`gpu`, from gpuCensus). A window with
 * no rendered frame proves nothing (render on demand draws nothing while a scene is still), so it is NOT_MEASURED,
 * never 'within budget'. `measured` keeps every value, budgeted or not, so the summary can print it.
 */
export function budgetStatus(scene, m, {gpu = null, preset = 'reference'} = {}) {
  const row = budgets().scenes?.[scene]?.budget;
  const measured = {
    draws: m?.renders ? m.drawsPerFrame : null,
    postDraws: m?.renders ? (m.postDrawsPerFrame ?? null) : null,
    triangles: m?.renders ? m.trisPerFrame : null,
    shadowCasters: gpu?.shadowCasters ?? null,
    shadowPasses: gpu?.shadowPasses ?? null,
    textureMiB: gpu?.textureMiB ?? null,
  };
  if (!row) return {scene, preset, status: 'no budget', rows: [], measured};
  if (!m?.renders) return {scene, preset, status: NOT_MEASURED, rows: [], measured};
  // Heap here is the dev server's whole page (unbundled modules included), so it is reported, not judged: the bench
  // measures the budgeted heap on a production build.
  const b = budgetAt(row, preset);
  const rows = SNAP_METRICS.filter(k => b[k] !== undefined && measured[k] !== null).map(k => ({
    metric: k,
    measured: measured[k],
    budget: b[k],
    ok: measured[k] <= b[k],
  }));
  return {scene, preset, status: rows.every(r => r.ok) ? 'within budget' : 'OVER BUDGET', rows, measured};
}

/** Every count against its budget, e.g. `draws 29/40 · postDraws 10/10 · textureMiB 42.3/48`; a value the row does not
 *  budget prints as `shadowPasses 0 (no budget)`. Look-checklist item 9 reads texture memory and shadow work here. */
export function countsLine(status) {
  const judged = new Map(status.rows.map(r => [r.metric, r]));
  return SNAP_METRICS.filter(k => status.measured?.[k] !== null && status.measured?.[k] !== undefined)
    .map(k => {
      const r = judged.get(k);
      const v = k === 'triangles' ? status.measured[k].toLocaleString('en-US') : status.measured[k];
      return r
        ? `${k} ${v}/${k === 'triangles' ? r.budget.toLocaleString('en-US') : r.budget}${r.ok ? '' : ' OVER'}`
        : `${k} ${v} (no budget)`;
    })
    .join(' · ');
}

/** One line for a budget status: what was over and by how much, and where the recovery steps are. */
export function budgetLine(status) {
  if (status.status !== 'OVER BUDGET') return status.status;
  const over = status.rows
    .filter(r => !r.ok)
    .map(r => `${r.metric} ${r.measured} > ${r.budget}`)
    .join(', ');
  const at = status.preset && status.preset !== 'reference' ? ` at ${status.preset}` : '';
  return `OVER BUDGET (${over}${at}, budgets.json scenes.${status.scene}): recover with .claude/skills/fix-budget/SKILL.md (simplify, instance, bake, LOD); never raise a budget without the author`;
}

/**
 * Frame rate of a measured window for a summary line. It is advisory: software GL in an emulated viewport on a shared
 * machine says little about a device, so play:snap reports it and never judges a budget on it.
 */
export function frameRateLine(m) {
  return m?.renders ? `${m.fps ?? '-'} fps (p95 ${m.frameMsP95 ?? '-'} ms), advisory` : 'fps not measured';
}

/** The summary line of a view other than desktop: draws, triangles and the verdict, then the advisory frame rate. */
export function viewLine(name, v) {
  const m = v.redrawn ?? v.moving;
  const counts = m?.renders
    ? `${m.drawsPerFrame} draws${m.postDrawsPerFrame ? ` (+${m.postDrawsPerFrame} post)` : ''}, ${m.trisPerFrame} tris per rendered frame · `
    : '';
  return `  ${name} budget (${v.budget.window === 'redrawn' ? 'forced redraws' : 'moving window'}): ${counts}${budgetLine(v.budget)} · ${frameRateLine(v.moving)}`;
}

/** An evidence file's path as the CLI prints it: relative to the repository root, with forward slashes. */
export const evidencePath = file => relative(ROOT, file).split(sep).join('/');

export function freshOut(dir = OUT) {
  rmSync(dir, {recursive: true, force: true});
  mkdirSync(dir, {recursive: true});
  return dir;
}
export function write(dir, name, data) {
  writeFileSync(
    join(dir, name),
    typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2) + '\n',
  );
  return join(dir, name);
}
