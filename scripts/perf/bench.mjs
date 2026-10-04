// scripts/perf/bench.mjs (`npm run bench`): the scene bench (STANDARD chapter 12, ADR 0046, ADR 0053). Run it with tsx:
// it reads the TypeScript budgets and window classifier.
//
// A muted, isolated headless Chromium (bench-browser.mjs) opens the built app pinned to ?quality=reference with the
// `dev.silent` flag, then enters every scene of perf/budgets.ts by its public route, the way a player's link would.
// A scene is ready when the scene shell marks its mount `[data-scene="<id>"][data-scene-state="active"]` (never a
// scene's own DOM). Each idle window samples a fixed number of rendered frames (or ends at its time limit: an
// on-demand scene that is still renders nothing, which is the point); each active window holds the scene row's
// `activeKeys` (default the arrow keys). An active window that drew nothing is a dead window (the scene ended) only
// when its held keys drive the scene: the row names them, or they press one of the game's own input actions. Keys
// that press nothing in the game cannot change the picture, so that window is still, like an idle one (heldKeyPlan).
// Every window is guarded (it must stay in its scene) and classified (ADR 0053). The result is a PerfRun (schema 1)
// in perf/runs/, checked report-only against the budgets unless --no-check.
//
// Usage: tsx scripts/perf/bench.mjs [baseUrl] [--json out.json] [--only a,b] [--active a,b] [--gpu]
//                                   [--viewport desktop|4k|WxH] [--frames N] [--network live] [--no-check]
//   baseUrl  an already served build. Without it the bench builds this tree into a temp folder and serves it.
//   --gpu    drop software GL (set ENGINE_CHROMIUM to a GPU-enabled wrapper for the reference machine).
import {writeFileSync, mkdirSync, readFileSync, renameSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {loadavg} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROBE} from './probe-inject.mjs';
import {ROOT, buildAndServe} from './build.mjs';
import {observeNetwork} from './network.mjs';
import {BENCH_SCENES, ACTIVE_SCENES} from '../../perf/budgets.ts';
import {CLASSIFICATION_VERSION} from '../../src/platform/perf/window-class.ts';
import {activeRestartPlan, restartActiveWindow, sampleAttempts} from './active-restart.mjs';
import {gameActionsPressedBy} from '../../src/author/input-registry.ts';

export const PERF_SCHEMA = 1;
const VIEWPORTS = {desktop: {width: 1280, height: 800}, '4k': {width: 3840, height: 2160}};
/** Window rules, part of the experiment descriptor. */
export const WINDOW = {
  resample: 3,
  settleMs: 1500,
  quietMs: 1000,
  quietTimeoutMs: 30000,
  minMs: 2000,
  maxMs: {swiftshader: 6000, gpu: 4000},
  frames: {swiftshader: 6, gpu: 120},
  activeMs: 4000,
  enterTimeoutMs: 60000,
};
export const PINNED_QUALITY = 'reference';
const SEARCH = `?quality=${PINNED_QUALITY}&flags=dev.silent`;
/** Files whose content is part of every experiment (ADR 0046: all harness helpers). */
export const HARNESS_FILES = [
  'scripts/perf/bench-browser.mjs',
  'scripts/perf/network.mjs',
  'scripts/perf/probe-inject.mjs',
  'scripts/perf/bench.mjs',
  'scripts/perf/active-restart.mjs',
  'scripts/perf/build.mjs',
  'src/platform/perf/window-class.ts',
];

export const sceneSelector = scene => `#app[data-scene="${scene}"]`;
export const readySelector = scene => `#app[data-scene="${scene}"][data-scene-state="active"]`;

export function parseArgs(argv) {
  const arg = f => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const vp = arg('--viewport') ?? 'desktop';
  const view = VIEWPORTS[vp] ?? (/^\d+x\d+$/.test(vp) ? {width: +vp.split('x')[0], height: +vp.split('x')[1]} : null);
  if (!view) throw Error('unknown --viewport ' + vp);
  const gpu = argv.includes('--gpu');
  return {
    base: argv[0]?.startsWith('http') ? argv[0].replace(/\/$/, '') : arg('--base'),
    out: arg('--json') ?? arg('--out'),
    only: arg('--only')?.split(',') ?? null,
    active: arg('--active')?.split(',') ?? [...ACTIVE_SCENES],
    keys: ['ArrowUp', 'ArrowLeft'],
    gpu,
    view,
    frames: +(arg('--frames') ?? WINDOW.frames[gpu ? 'gpu' : 'swiftshader']),
    liveNetwork: arg('--network') === 'live',
    check: !argv.includes('--no-check'),
    quiet: argv.includes('--quiet'),
  };
}

const git = (...a) => {
  try {
    return execFileSync('git', a, {cwd: ROOT, encoding: 'utf8'}).trim();
  } catch {
    return '';
  }
};
const sha256 = s => createHash('sha256').update(s).digest('hex');

/**
 * The keys an active window holds in a scene, and whether they drive it. A row's `activeKeys` are the author's word
 * that they do. Otherwise the default keys drive the scene when they press one of the game's own input actions
 * (`rows`: gameInputRows, engine rows excluded); `rows` null (the game's definitions did not load) leaves it unknown,
 * which the classifier treats as driving, so a dead window is never excused by a missing fact.
 */
export function heldKeyPlan(row, defaultKeys, rows) {
  if (
    row.activeKeys !== undefined &&
    (!Array.isArray(row.activeKeys) || !row.activeKeys.length || row.activeKeys.some(k => typeof k !== 'string' || !k))
  )
    throw Error(
      `budgets.json scene ${row.id}: activeKeys must be a non-empty list of key names ('ArrowUp', 'KeyW', 'Space')`,
    );
  if (row.activeKeys) return {keys: [...row.activeKeys], drive: true, source: 'activeKeys', actions: []};
  if (!rows) return {keys: [...defaultKeys], drive: undefined, source: 'unknown', actions: []};
  const actions = [...new Set(defaultKeys.flatMap(k => gameActionsPressedBy(rows, k)))];
  return {keys: [...defaultKeys], drive: actions.length > 0, source: 'bindings', actions};
}

/** The game's input rows (engine rows included, filtered by gameActionsPressedBy); null when the game does not load in Node. */
async function loadInputRows(log) {
  try {
    const [{loadGame}, {gameInputRows}] = await Promise.all([
      import('../../src/app/game-files.ts'),
      import('../../src/author/input-registry.ts'),
    ]);
    const {game, defs} = await loadGame();
    return gameInputRows(game, defs);
  } catch (e) {
    log(
      "bench: the game's input bindings could not be read (" +
        String(e.message).slice(0, 160) +
        '); an active window that draws nothing stays inconclusive',
    );
    return null;
  }
}

/** The ADR 0046 experiment descriptor: everything but the build that decides what a run measures. */
export function experimentDescriptor(o, {browser, gpuString, launchArguments = []}) {
  const harness = Object.fromEntries(
    HARNESS_FILES.map(f => {
      try {
        return [f, sha256(readFileSync(join(ROOT, f)))];
      } catch {
        return [f, 'missing'];
      }
    }),
  );
  const route = BENCH_SCENES.map(p => p.id).filter(p => !o.only || o.only.includes(p));
  return {
    schema: PERF_SCHEMA,
    harness: o.gpu ? 'gpu' : 'swiftshader',
    browser,
    backend: gpuString,
    viewport: {...o.view, dpr: 1},
    quality: PINNED_QUALITY + ' (pinned)',
    calm: false,
    execution: {launchArguments},
    locale: 'en-US',
    clock: 'wall',
    comparisonPolicy: 'strict-taxonomy-v1',
    route,
    routes: Object.fromEntries(BENCH_SCENES.map(p => [p.id, p.route])),
    active: o.active.filter(p => route.includes(p)),
    keys: o.keys,
    activeRestart: Object.fromEntries(
      BENCH_SCENES.filter(p => route.includes(p.id) && activeRestartPlan(p)).map(p => [p.id, activeRestartPlan(p)]),
    ),
    activeKeys: Object.fromEntries(
      BENCH_SCENES.filter(p => p.activeKeys?.length && route.includes(p.id)).map(p => [p.id, p.activeKeys]),
    ),
    window: {...WINDOW, frames: o.frames},
    network: o.liveNetwork ? 'live' : 'hermetic',
    classificationVersion: CLASSIFICATION_VERSION,
    readinessVersion: 1,
    helpers: harness,
  };
}

const GPU_STRING = `(()=>{const c=document.createElement('canvas');const g=c.getContext('webgl2');const e=g&&g.getExtension('WEBGL_debug_renderer_info');const r=g?g.getParameter(e?e.UNMASKED_RENDERER_WEBGL:g.RENDERER):'none';g?.getExtension('WEBGL_lose_context')?.loseContext();return r})()`;

/** Runs the bench and returns the PerfRun. Never touches system audio: the browser is always muted and silent. */
export async function runBench(o, {log = console.log} = {}) {
  const restartPlans = new Map(BENCH_SCENES.map(row => [row.id, activeRestartPlan(row)]));
  if (!BENCH_SCENES.length)
    throw Error("game/budgets.json lists no scenes: add the game's scenes (docs/recipes/add-a-budget.md)");
  const {launch, sleep} = await import('./bench-browser.mjs');
  const {classifyWindow} = await import('../../src/platform/perf/window-class.ts');
  const served = o.base ? null : await buildAndServe();
  const base = o.base ?? served.url;
  const b = await launch({...o.view, gpu: o.gpu});
  const harness = o.gpu ? 'gpu' : 'swiftshader';
  try {
    await b.page.goto('about:blank');
    const gpuString = await b.evaluate(GPU_STRING);
    const browser = 'Chromium ' + b.version;
    const descriptor = experimentDescriptor(o, {browser, gpuString, launchArguments: b.launchArguments});
    const run = {
      schema: PERF_SCHEMA,
      sha: git('rev-parse', 'HEAD'),
      dirty: git('status', '--porcelain', '--untracked-files=no').length > 0,
      harness,
      viewport: {...o.view, dpr: 1},
      gpu: gpuString,
      browser,
      when: new Date().toISOString(),
      loadAverage: +loadavg()[0].toFixed(2),
      descriptor: sha256(JSON.stringify(descriptor)),
      experiment: descriptor,
      build: served ? {digest: served.digest, files: served.fileCount} : null,
      startup: null,
      samples: [],
      afterTour: null,
      chunks: served?.chunks ?? {},
    };
    const metrics = async () =>
      Object.fromEntries((await b.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    const gcHeap = async () => {
      await b.send('HeapProfiler.collectGarbage');
      await sleep(200);
      await b.send('HeapProfiler.collectGarbage');
      return +((await b.send('Runtime.getHeapUsage')).usedSize / 1048576).toFixed(1);
    };
    const network = await observeNetwork(b, {base, liveNetwork: o.liveNetwork});
    await b.send('Performance.enable');
    await b.send('HeapProfiler.enable');
    await b.page.addInitScript(PROBE);

    /** One window, re-sampled in its scene up to WINDOW.resample times while it is not comparable (ADR 0053). */
    async function sample(id, scene, row, mode, during, extra = {}) {
      const plan = mode === 'active' ? restartPlans.get(row.id) : null;
      const s = await sampleAttempts({
        measure: () => measure(id, scene, row, mode, during, extra),
        prepare: plan ? () => restartActiveWindow(b.page, row, plan) : undefined,
        resample: WINDOW.resample,
        retry: i => log(' '.repeat(20), `not comparable; re-sampling ${id} (${i}/${WINDOW.resample})`),
      });
      run.samples.push(s);
      return s;
    }
    async function measure(id, scene, row, mode, during, extra) {
      const {held, ...rest} = extra;
      extra = rest;
      const at = await b.evaluate('location.hash');
      const opened =
        at === row.route &&
        (await b.evaluate(
          `window.__winOpen(${JSON.stringify(sceneSelector(row.scene))},${mode === 'idle' ? o.frames : 0},${WINDOW.minMs},${mode === 'idle' ? WINDOW.maxMs[harness] : WINDOW.activeMs},false)`,
        ));
      if (!opened) {
        const s = {id, scene, mode, error: `not in ${row.route} at the start of the window`, hash: at};
        log(id.padEnd(20), 'REJECTED', s.error);
        return s;
      }
      const start = network.snapshot(),
        m0 = await metrics();
      if (during) await during();
      await b.evaluate('window.__win?.finished');
      const w = await b.evaluate('window.__winClose()');
      const m1 = await metrics(),
        end = network.snapshot();
      const {classification, uploads} = classifyWindow({
        mode,
        epochBreak: w.epochBreak,
        contextLost: w.lostContexts > 0,
        frames: w.frames,
        renderedFrames: w.rendered,
        complete: w.complete,
        pendingAtStart: start.pending,
        requestsDuring: end.requests - start.requests,
        uploads: w.uploads,
        programsCreated: w.counts.programsCreated,
        ...(mode === 'active' && held ? {heldKeysDrive: held.drive} : {}),
      });
      if (held)
        extra = {
          ...extra,
          heldKeys: held.keys,
          heldKeysDrive: held.drive ?? null,
          heldKeysSource: held.source,
          ...(held.actions.length ? {heldKeyActions: held.actions} : {}),
        };
      if (classification.kind === 'invalid') {
        const s = {
          id,
          scene,
          mode,
          ...(held ? {heldKeys: held.keys} : {}),
          error: 'rejected: ' + classification.reasons.join('; '),
          hash: w.hash,
          classification,
        };
        log(id.padEnd(20), 'REJECTED', s.error);
        return s;
      }
      const drawn = Math.max(1, w.rendered),
        per = k => +(((m1[k] - m0[k]) * 1000) / Math.max(1, w.frames)).toFixed(2),
        mean = v => +(v / drawn).toFixed(1);
      const heapMB = await gcHeap();
      const g = await b.evaluate('window.__gpu()');
      const sum = p => uploads.filter(u => u.purpose === p).length;
      const s = {
        id,
        scene,
        mode,
        hash: w.hash,
        classification,
        windowMs: Math.round(w.ms),
        frames: w.frames,
        renderedFrames: w.rendered,
        renderedFrameRatio: +(w.rendered / Math.max(1, w.frames)).toFixed(2),
        drawsPerRenderedFrame: Math.round(w.draws / drawn),
        drawsMaxFrame: w.drawsMax,
        trisPerRenderedFrame: Math.round(w.tris / drawn),
        offscreenDrawsPerRenderedFrame: Math.round(w.off / drawn),
        postDrawsPerRenderedFrame: Math.round((w.post ?? 0) / drawn),
        shadowPassDrawsMax: g.shadowPassDrawsMax,
        taskMsPerFrame: per('TaskDuration'),
        frameMsP95: w.frameMsP95 === null ? undefined : +w.frameMsP95.toFixed(2),
        frameMsMax: w.frameMsMax === null ? undefined : +w.frameMsMax.toFixed(2),
        ...(harness === 'gpu' && w.frameMsP95 !== null ? {frameMs: +w.frameMsP95.toFixed(2)} : {}),
        layouts: m1.LayoutCount - m0.LayoutCount,
        heapMB,
        textureMiB: g.textureMiB,
        canvasMiB: g.canvasMiB,
        canvases: g.canvases,
        liveContexts: g.liveContexts,
        submission: {
          useProgram: mean(w.counts.useProgram),
          programsCreated: w.counts.programsCreated,
          programLookups: null,
          uniformCalls: mean(w.counts.uniformCalls),
          bindVertexArray: mean(w.counts.bindVertexArray),
          bufferSubData: mean(w.counts.bufferSubData),
          textureUploads: w.counts.textureUploads,
          shadowDueRatio: +(w.offFrames / drawn).toFixed(2),
        },
        uploads: {
          initial: sum('initial'),
          recurring: sum('recurring'),
          firstUse: sum('firstUse'),
          unknown: sum('unknown'),
          bytes: uploads.reduce((a, u) => a + u.bytes, 0),
        },
        ...extra,
      };
      if (!o.quiet && classification.reasons.length) log(' '.repeat(20), classification.reasons.join('; '));
      log(
        id.padEnd(20),
        `${classification.kind.padEnd(12)} draws ${s.drawsPerRenderedFrame} (max ${s.drawsMaxFrame}) tris ${s.trisPerRenderedFrame} frames ${s.renderedFrames}/${s.frames} tex ${s.textureMiB} canvas ${s.canvasMiB} heap ${s.heapMB} ctx ${s.liveContexts}` +
          (extra.enterMs ? ` enter ${extra.enterMs}ms ${extra.enterMB}MB` : ''),
      );
      return s;
    }
    /** Waits until nothing has been in flight for quietMs; false when loading never went quiet. */
    const quiet = async () => {
      const t = Date.now();
      let since = 0,
        revision = -1;
      while (Date.now() - t < WINDOW.quietTimeoutMs) {
        await sleep(100);
        const n = network.snapshot();
        if (n.pending || n.revision !== revision) {
          since = 0;
          revision = n.revision;
        } else if (!since) since = Date.now();
        else if (Date.now() - since >= WINDOW.quietMs) return true;
      }
      return false;
    };
    const walk = (k1, k2) => async () => {
      await b.key(k1, true);
      await sleep(WINDOW.activeMs / 2);
      await b.key(k1, false);
      await b.key(k2, true);
      await sleep(WINDOW.activeMs / 2 - 50);
      await b.key(k2, false);
    };

    // Startup: the first scene of the table is where the app starts.
    const [home, ...rest] = BENCH_SCENES;
    const t0 = Date.now();
    await b.goto(base + '/' + SEARCH + home.route);
    await b.wait(`!!document.querySelector(${JSON.stringify(readySelector(home.scene))})`, WINDOW.enterTimeoutMs);
    const ready = Date.now() - t0;
    const pin = `new URLSearchParams(location.search).get('quality')`;
    if ((await b.evaluate(pin)) !== PINNED_QUALITY)
      throw Error('the bench page is not pinned to ?quality=' + PINNED_QUALITY);
    const startupQuiet = await quiet();
    const nav = await b.evaluate(
      `(()=>{const r=performance.getEntriesByType('resource');return {jsKB:Math.round(r.filter(x=>x.name.endsWith('.js')).reduce((a,x)=>a+(x.encodedBodySize||x.transferSize),0)/1024)}})()`,
    );
    const heap0 = await gcHeap(),
      g0 = await b.evaluate('window.__gpu()');
    run.startup = {
      appReadyMs: ready,
      transferredMB: +(network.snapshot().bytes / 1048576).toFixed(2),
      jsKB: nav.jsKB,
      heapMB: heap0,
      textureMiB: g0.textureMiB,
      canvasMiB: g0.canvasMiB,
      liveContexts: g0.liveContexts,
      networkQuiet: startupQuiet ? 1 : 0,
    };
    log('startup'.padEnd(20), JSON.stringify(run.startup));
    const inputRows = o.active.length ? await loadInputRows(log) : null;
    const visit = async (row, entered) => {
      if (o.only && !o.only.includes(row.id)) return;
      try {
        let extra = {};
        if (!entered) {
          const b0 = network.snapshot().bytes,
            e0 = Date.now();
          await b.evaluate(`location.hash=${JSON.stringify(row.route)};1`);
          await b.wait(`!!document.querySelector(${JSON.stringify(readySelector(row.scene))})`, WINDOW.enterTimeoutMs);
          const enterMs = Date.now() - e0;
          await sleep(WINDOW.settleMs);
          const networkQuiet = await quiet();
          extra = {enterMs, enterMB: +((network.snapshot().bytes - b0) / 1048576).toFixed(2), networkQuiet};
        } else {
          await sleep(WINDOW.settleMs);
          await quiet();
        }
        await sample(row.id, row.id, row, 'idle', null, {
          ...extra,
          topTextures: await b.evaluate('window.__topTex(6)'),
        });
        if (o.active.includes(row.id)) {
          const held = heldKeyPlan(row, o.keys, inputRows);
          if (!o.quiet && held.drive === false)
            log(
              ' '.repeat(20) +
                `${row.id}:active holds ${held.keys.join('+')}, which press no game action: a window that draws nothing is still, not dead (set activeKeys in budgets.json to the keys that move this scene)`,
            );
          await sample(row.id + ':active', row.id, row, 'active', walk(held.keys[0], held.keys[1] ?? held.keys[0]), {
            held,
          });
        }
      } catch (e) {
        const s = {id: row.id, scene: row.id, mode: 'idle', error: String(e.message).slice(0, 200)};
        run.samples.push(s);
        log(row.id.padEnd(20), 'ERROR', s.error);
      }
    };
    await visit(home, true);
    for (const row of rest) {
      await visit(row, false);
      await b.evaluate(`location.hash=${JSON.stringify(home.route)};1`);
      await b
        .wait(`!!document.querySelector(${JSON.stringify(readySelector(home.scene))})`, WINDOW.enterTimeoutMs)
        .catch(() => {});
    }
    if ((await b.evaluate(pin)) !== PINNED_QUALITY) throw Error('the ?quality= pin was lost during the tour');
    const heapA = await gcHeap(),
      ga = await b.evaluate('window.__gpu()');
    run.afterTour = {textureMiB: ga.textureMiB, canvasMiB: ga.canvasMiB, heapMB: heapA, liveContexts: ga.liveContexts};
    log('afterTour'.padEnd(20), JSON.stringify(run.afterTour));
    run.network = {
      mode: o.liveNetwork ? 'live' : 'hermetic',
      external: Object.fromEntries([...network.external].sort()),
    };
    if (b.errors.length) run.pageErrors = b.errors.slice(0, 5).map(String);
    return run;
  } finally {
    await b.close();
    await served?.close();
  }
}

export function defaultRunPath(run) {
  return join(
    ROOT,
    'perf',
    'runs',
    `${(run.sha || 'nogit').slice(0, 12)}${run.dirty ? '-dirty' : ''}-${run.harness}-${run.viewport.width}x${run.viewport.height}.json`,
  );
}
export function writeRun(run, path = defaultRunPath(run)) {
  mkdirSync(join(path, '..'), {recursive: true});
  writeFileSync(path + '.tmp', JSON.stringify(run, null, 1));
  renameSync(path + '.tmp', path);
  return path;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const o = parseArgs(process.argv.slice(2));
  const run = await runBench(o).catch(async error => {
    if ((await import('./bench-browser.mjs')).reportBrowserError(error)) process.exit(1);
    throw error;
  });
  const path = writeRun(run, o.out);
  console.log(
    'PerfRun →',
    path,
    `(${run.samples.length} samples, ${run.samples.filter(s => s.error).length} rejected)`,
  );
  if (o.check) {
    const {reportRun} = await import('./budget-check.ts');
    console.log(reportRun(run).text);
  }
  if (run.samples.some(s => s.error)) process.exitCode = 2;
}
