#!/usr/bin/env node
// scripts/play/subpath-check.mjs (`npm run test:subpath-browser`): a production build served from a sub-path loads
// every file the template ships. GitHub Pages project sites serve a game under /<repository>/ and itch.io under an
// arbitrary folder, so a root-absolute asset URL (`/models/x.glb`) 404s there.
//
// For each template (all, or those named on the command line): build it with `--base ./` (any folder) and, when it
// declares asset files, also with `--base /sub/<template>/` (a known sub-path); serve each build ONLY under
// /sub/<template>/ from a static server, open
// the first scene in the bench's muted, isolated headless Chromium (`?flags=dev.silent`), and require:
//   - the scene becomes active with no page errors and no console errors;
//   - no request leaves the sub-path, and no response is a 4xx/5xx;
//   - every file the template declares with `defineAsset` exists in the build and was fetched by the engine from the
//     sub-path with a 2xx (a declared file the first scene does not load is fetched by the page instead and recorded).
//
//   node -r ./scripts/silent-browser.cjs scripts/play/subpath-check.mjs [outDir] [--template <name>]...
//
// Limitations: desktop Chromium with software GL only; static hosting is emulated by a local server; no physical
// device, CDN or real GitHub Pages/itch.io upload is exercised.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {extname, join, normalize, resolve, sep} from 'node:path';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';

const args = process.argv.slice(2),
  only = [];
let out = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--template') only.push(args[++i]);
  else out = args[i];
}
out = resolve(out ?? join(tmpdir(), 'foundation-subpath-browser'));
mkdirSync(out, {recursive: true});
const templates = readdirSync(join(ROOT, 'templates'))
  .filter(n => existsSync(join(ROOT, 'templates', n, 'game', 'game.ts')) && (!only.length || only.includes(n)))
  .sort();
if (only.some(n => !templates.includes(n))) throw Error(`subpath-check: unknown template in ${only.join(', ')}`);

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain',
  '.wasm': 'application/wasm',
};
const walk = dir =>
  readdirSync(dir, {withFileTypes: true}).flatMap(e =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

/** Every `defineAsset({... url: '...'})` path a template's game folder declares. */
export function declaredAssets(dir) {
  const found = new Map();
  for (const file of walk(dir).filter(f => /\.(?:ts|mts)$/.test(f) && !/\.test\.ts$/.test(f))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/defineAsset\(\s*\{([^}]*)\}/g)) {
      const id = m[1].match(/\bid:\s*'([^']+)'/)?.[1],
        url = m[1].match(/\burl:\s*'([^']+)'/)?.[1];
      if (id && url) found.set(id, url.replace(/^\/+/, ''));
    }
  }
  return [...found].map(([id, path]) => ({id, path}));
}

/** A static host that serves `dir` only under `prefix` (like a Pages project site); everything else is a 404. */
function host(dir, prefix) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!path.startsWith(prefix)) {
      res.statusCode = 404;
      res.end('outside the sub-path');
      return;
    }
    const rel = path.slice(prefix.length) || 'index.html',
      file = normalize(join(dir, rel));
    if (!file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
  return new Promise(done =>
    server.listen(0, '127.0.0.1', () =>
      done({
        origin: `http://127.0.0.1:${server.address().port}`,
        close: () =>
          new Promise(r => {
            server.close(() => r());
            server.closeAllConnections();
          }),
      }),
    ),
  );
}

function build(template, base, outDir) {
  const env = {...process.env, GAME_DIR: `templates/${template}/game`};
  for (const argv of [
    ['scripts/generate.mjs'],
    [
      'node_modules/vite/bin/vite.js',
      'build',
      '--base',
      base,
      '--outDir',
      outDir,
      '--emptyOutDir',
      '--logLevel',
      'error',
    ],
  ]) {
    const r = spawnSync(process.execPath, argv, {cwd: ROOT, env, encoding: 'utf8'});
    if (r.status !== 0) throw Error(`${template}: ${argv.join(' ')} failed\n${r.stdout}\n${r.stderr}`);
  }
}

const report = {
  passed: false,
  templates: [],
  limitations: [
    'Desktop Chromium emulation with software GL only; no physical device.',
    'Static hosting is a local sub-path server; no real GitHub Pages, itch.io or CDN upload.',
    'Only the first scene of each template is opened; declared assets it does not load are fetched by the page.',
  ],
};
const evidence = diagnosticReport(report, join(out, 'report.json'));
let browser;
try {
  browser = await launch({width: 1280, height: 800, strictClose: true});
  const page = browser.page;
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);
  for (const template of templates) {
    const game = join(ROOT, 'templates', template, 'game');
    const scene = Object.keys(JSON.parse(readFileSync(join(game, 'budgets.json'), 'utf8')).scenes ?? {})[0];
    assert.ok(scene, `${template}: budgets.json names no first scene`);
    const assets = declaredAssets(game);
    const prefix = `/sub/${template}/`;
    for (const base of assets.length ? ['./', prefix] : ['./']) {
      const dir = mkdtempSync(join(tmpdir(), 'engine-subpath-'));
      const row = {
        template,
        base,
        scene,
        assets: assets.map(a => a.path),
        loaded: [],
        pageFetched: [],
        requests: 0,
        errors: [],
      };
      report.templates.push(row);
      let served;
      try {
        build(template, base, dir);
        for (const a of assets) assert.ok(existsSync(join(dir, a.path)), `${template}: ${a.path} is not in the build`);
        served = await host(dir, prefix);
        const responses = [],
          requests = [];
        const onRequest = r => requests.push(r.url()),
          onResponse = r => responses.push({url: r.url(), status: r.status()});
        const onError = e => row.errors.push(String(e?.message ?? e)),
          onConsole = m => {
            if (m.type() === 'error') row.errors.push(m.text());
          };
        page.on('request', onRequest);
        page.on('response', onResponse);
        page.on('pageerror', onError);
        page.on('console', onConsole);
        try {
          await page.goto(`${served.origin}${prefix}index.html?flags=dev.silent#scene/${scene}`);
          await page.waitForSelector(`#app[data-scene="scene.${scene}"][data-scene-state="active"]`, {timeout: 60000});
          await page.waitForLoadState('networkidle', {timeout: 30000});
          const missing = assets.filter(a => !responses.some(r => r.url === `${served.origin}${prefix}${a.path}`));
          // Wait briefly for in-flight engine loads the idle heuristic missed.
          for (
            let i = 0;
            i < 20 && missing.some(a => !responses.some(r => r.url === `${served.origin}${prefix}${a.path}`));
            i++
          )
            await new Promise(r => setTimeout(r, 250));
          for (const a of assets) {
            const hit = responses.find(r => r.url === `${served.origin}${prefix}${a.path}`);
            if (hit) {
              assert.ok(
                hit.status >= 200 && hit.status < 300,
                `${template} (${base}): ${a.path} answered ${hit.status}`,
              );
              row.loaded.push(a.path);
              continue;
            }
            const status = await page.evaluate(
              path => fetch(new URL(path, document.baseURI)).then(r => r.status),
              a.path,
            );
            assert.equal(status, 200, `${template} (${base}): ${a.path} is not served from the sub-path`);
            row.pageFetched.push(a.path);
          }
          row.requests = requests.length;
          const outside = requests.filter(u => u.startsWith(served.origin) && !new URL(u).pathname.startsWith(prefix));
          assert.deepEqual(outside, [], `${template} (${base}): requests left the sub-path`);
          const failed = responses.filter(r => r.status >= 400);
          assert.deepEqual(failed, [], `${template} (${base}): failed responses`);
          assert.deepEqual(row.errors, [], `${template} (${base}): page errors`);
          const shot = join(out, `${template}-${base === './' ? 'relative' : 'absolute'}.png`);
          await page.screenshot({path: shot});
          row.screenshot = shot;
          row.passed = true;
          console.log(
            `subpath ${template} (base ${base}): scene.${scene} active; ${row.loaded.length} asset(s) loaded by the engine, ${row.pageFetched.length} fetched by the page; ${requests.length} requests, none outside ${prefix}`,
          );
        } finally {
          page.off('request', onRequest);
          page.off('response', onResponse);
          page.off('pageerror', onError);
          page.off('console', onConsole);
          await page.goto('about:blank');
        }
      } finally {
        await served?.close();
        rmSync(dir, {recursive: true, force: true});
      }
    }
  }
  report.passed = report.templates.every(r => r.passed);
} catch (error) {
  evidence.fail(error);
} finally {
  await evidence.close(browser, 'browser close');
  // Leave the generated catalogues for the checkout's own game, as every other script expects.
  spawnSync(process.execPath, ['scripts/generate.mjs'], {cwd: ROOT, stdio: 'ignore'});
  evidence.finish();
}
console.log(`Sub-path builds passed for ${templates.join(', ')}; evidence ${out}`);
