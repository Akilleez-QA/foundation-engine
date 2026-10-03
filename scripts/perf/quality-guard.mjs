#!/usr/bin/env node
// scripts/perf/quality-guard.mjs (`npm run quality:guard`): the picture guard (STANDARD chapter 12, STD-TST-1).
// A performance change must not change the picture unless the change says so. The guard captures the same views of
// two served builds (base and head) in fresh, muted, isolated browsers and compares decoded pixels:
//
//   identical  zero changed RGBA pixels;
//   near       at most floor(width × height / 1000) pixels with any channel more than 2/255 apart;
//   reviewed   the pair passes only when perf/quality/reviewed.json holds a human sign-off for exactly these two
//              pictures (their sha256), naming who reviewed them and why. Nothing else ever approves it.
//
// Tolerances are fixed here; a view file cannot loosen them. Each capture is taken twice and must be identical
// (a view that still moves proves nothing). Evidence (base/head/repeat/diff PNGs and report.json) goes to a new
// --out directory; pixels are never reused or overwritten.
//
// Usage: npm run quality:guard -- --base <emitted build dir> --head <emitted build dir> --out <new dir> [--views file]
//   The default views are perf/quality/views.mjs: [{id, scene, route, mode, settleMs?}].
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {decodePng, encodePng, comparePixels} from './quality-png.mjs';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const REVIEWED_FILE = join(ROOT, 'perf', 'quality', 'reviewed.json');
export const MODES = ['identical', 'near', 'reviewed'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => {
  throw Error(message);
};

export function validateViews(views) {
  if (!Array.isArray(views) || !views.length) fail('declare at least one view; empty coverage cannot pass');
  const ids = new Set();
  for (const v of views) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(v.id ?? '') || ids.has(v.id)) fail(`invalid or duplicate view id: ${v.id}`);
    ids.add(v.id);
    if (!/^scene\.[a-z0-9-]+$/.test(v.scene ?? '')) fail(`${v.id}: declare a scene.* id`);
    if (typeof v.route !== 'string' || !v.route.startsWith('#')) fail(`${v.id}: declare the route that reaches it`);
    if (!MODES.includes(v.mode)) fail(`${v.id}: declare identical, near or reviewed`);
    for (const k of ['maxDifferentPixels', 'channelTolerance', 'tolerance', 'limit'])
      if (v[k] !== undefined) fail(`${v.id}: tolerances are fixed by the guard`);
    if (v.settleMs !== undefined && !(Number.isFinite(v.settleMs) && v.settleMs >= 0 && v.settleMs <= 10000))
      fail(`${v.id}: settleMs must be 0..10000`);
  }
  return views;
}

/** The sign-off for a reviewed pair, or null. Rows: {view, base, head, by, note} with sha256 hex pictures. */
export function reviewedSignOff(rows, view, baseSha, headSha) {
  const row = (rows ?? []).find(r => r.view === view && r.base === baseSha && r.head === headSha);
  return row && typeof row.by === 'string' && row.by.trim() && typeof row.note === 'string' && row.note.trim()
    ? row
    : null;
}

/** Compare two captures under a mode; reviewed pairs consult the sign-off list. */
export function judge(baseBytes, headBytes, view, reviewed = []) {
  const base = decodePng(baseBytes),
    head = decodePng(headBytes);
  const result = comparePixels(base, head, view.mode);
  if (view.mode === 'reviewed') {
    const signOff = reviewedSignOff(reviewed, view.id, hash(baseBytes), hash(headBytes));
    return {...result, pass: !!signOff, signOff};
  }
  return result;
}

export function parseArgs(args) {
  if (args.includes('--help')) return null;
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (
      !['--base', '--head', '--views', '--out'].includes(key) ||
      !args[i + 1] ||
      args[i + 1].startsWith('--') ||
      out[key.slice(2)]
    )
      fail(`invalid argument ${key}; use --help`);
    out[key.slice(2)] = resolve(args[i + 1]);
  }
  out.views ??= join(ROOT, 'perf', 'quality', 'views.mjs');
  for (const key of ['base', 'head', 'out']) if (!out[key]) fail(`missing --${key}; use --help`);
  return out;
}

/** One view of one served build: enter it, wait for the scene, take two screenshots that must be identical. */
export async function captureView(b, url, view) {
  await b.goto(`${url}/?quality=reference&flags=dev.silent${view.route}`);
  await b.wait(`!!document.querySelector('#app[data-scene="${view.scene}"][data-scene-state="active"]')`, 60000);
  await new Promise(r => setTimeout(r, view.settleMs ?? 1500));
  const shot = async () => {
    await b.evaluate(
      'document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true)))))',
    );
    return b.page.screenshot({type: 'png'});
  };
  const bytes = await shot(),
    repeat = await shot();
  const state = await b.evaluate(
    `({hash:location.hash,scene:document.querySelector('#app')?.getAttribute('data-scene'),width:innerWidth,height:innerHeight,dpr:devicePixelRatio})`,
  );
  if (state.scene !== view.scene) fail(`${view.id}: expected ${view.scene}, found ${state.scene}`);
  const stability = comparePixels(decodePng(bytes), decodePng(repeat), 'identical');
  if (!stability.pass)
    fail(
      `${view.id}: the view still changes (${stability.different} pixels between two captures); make it still before comparing builds`,
    );
  if (b.errors.length) fail(`${view.id}: page errors: ${b.errors.join(' | ')}`);
  return {bytes, repeat, state};
}

export async function main(args = process.argv.slice(2)) {
  const o = parseArgs(args);
  if (!o) {
    console.log(
      'Usage: npm run quality:guard -- --base <build dir> --head <build dir> --out <new evidence dir> [--views perf/quality/views.mjs]',
    );
    return;
  }
  if (existsSync(o.out)) fail('the evidence directory already exists; choose a new --out');
  for (const dir of [o.base, o.head])
    if (!existsSync(join(dir, 'index.html'))) fail(`missing ${dir}/index.html; supply an emitted build`);
  const mod = await import(pathToFileURL(o.views).href);
  const views = validateViews(mod.views),
    viewport = mod.viewport ?? {width: 1280, height: 800};
  const reviewed = existsSync(REVIEWED_FILE) ? JSON.parse(readFileSync(REVIEWED_FILE, 'utf8')) : [];
  mkdirSync(o.out, {recursive: true});
  const {launch} = await import('./bench-browser.mjs');
  const {digestDir} = await import('./build.mjs');
  const {preview} = await import('vite');
  const report = {schema: 1, when: new Date().toISOString(), viewport, views: [], failures: [], builds: {}};
  const servers = [];
  try {
    const urls = {};
    for (const side of ['base', 'head']) {
      report.builds[side] = {path: o[side], ...digestDir(o[side])};
      const server = await preview({
        root: ROOT,
        logLevel: 'error',
        build: {outDir: o[side]},
        preview: {host: '127.0.0.1', port: 0, strictPort: false, open: false},
      });
      servers.push(server);
      urls[side] = server.resolvedUrls?.local?.[0]?.replace(/\/$/, '') ?? fail(`no preview URL for ${side}`);
    }
    for (const view of views) {
      const row = {id: view.id, scene: view.scene, mode: view.mode, captures: {}};
      report.views.push(row);
      try {
        const got = {};
        for (const side of ['base', 'head']) {
          const b = await launch(viewport);
          try {
            got[side] = await captureView(b, urls[side], view);
            const file = `${view.id}-${side}.png`;
            writeFileSync(join(o.out, file), got[side].bytes);
            writeFileSync(join(o.out, `${view.id}-${side}-repeat.png`), got[side].repeat);
            row.captures[side] = {
              file,
              sha256: hash(got[side].bytes),
              state: got[side].state,
              browser: b.version,
              launchArgs: b.launchArguments,
            };
          } finally {
            await b.close();
          }
        }
        const {diff, signOff, ...result} = judge(got.base.bytes, got.head.bytes, view, reviewed);
        row.result = {...result, ...(signOff ? {signOff} : {})};
        row.diff = `${view.id}-diff.png`;
        writeFileSync(join(o.out, row.diff), encodePng(diff));
        if (!result.pass)
          fail(
            view.mode === 'reviewed'
              ? `${view.id}: reviewed needs a sign-off in perf/quality/reviewed.json for base ${row.captures.base.sha256.slice(0, 12)} / head ${row.captures.head.sha256.slice(0, 12)}; inspect ${row.diff}`
              : `${view.id}: ${view.mode} failed: ${view.mode === 'identical' ? result.different : result.beyondTolerance}/${result.pixels} pixels differ (limit ${result.limit}); inspect ${row.diff}; fix the change, never the tolerance`,
          );
      } catch (error) {
        row.failure = error.message;
        report.failures.push(error.message);
      }
    }
    for (const side of ['base', 'head'])
      if (digestDir(o[side]).digest !== report.builds[side].digest) fail(`${side} build changed during capture; rerun`);
  } catch (error) {
    report.failures.push(error.message);
  } finally {
    for (const s of servers.reverse()) await new Promise(r => s.httpServer.close(r));
    report.pass = report.failures.length === 0 && report.views.length === views.length;
    writeFileSync(join(o.out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  for (const f of report.failures) console.error('FAIL ' + f);
  console.log(`${report.pass ? 'PASS' : 'FAIL'} quality guard; evidence: ${o.out}`);
  if (!report.pass) process.exitCode = 1;
  return report;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(e => {
    console.error('FAIL quality guard: ' + e.message);
    process.exitCode = 1;
  });
