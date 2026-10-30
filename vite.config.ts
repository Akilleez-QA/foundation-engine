import {defineConfig, type Plugin} from 'vite';
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {compactKeys} from './scripts/compact-keys.mjs';
import {threeGlsl} from './scripts/three-glsl.mjs';
import {gameDir} from './scripts/lib/game-dir.mjs';
import {gamePublic, gamePublicDir} from './scripts/lib/game-public.mjs';

// The generated string catalogues and key types (ADR 0043) are gitignored, so every build and dev server regenerates
// them first: `npm run build`, the gate, the deploy guard and the verify scripts all build through here. The dev
// server regenerates when a strings or narration shard changes.
const runStrings = () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./scripts/strings.mjs', import.meta.url))], {
    encoding: 'utf8',
  });
  if (r.status !== 0) throw Error(r.stderr || 'scripts/strings.mjs failed');
};
const isShard = (file: string) =>
  /[\\/](?:strings|narration)[\\/](?:[\w-]+[\\/])*[\w-]+\.json$/.test(file) && !/[\\/]generated[\\/]/.test(file);
const engineStrings: Plugin = {
  name: 'engine-strings',
  buildStart: runStrings,
  configureServer(server) {
    server.watcher.on('change', file => {
      if (isShard(file))
        try {
          runStrings();
        } catch (e) {
          server.config.logger.error(String(e));
        }
    });
  },
};
// The test API (ADR 0026): the dev server and `vite build --mode test` add src/dev/attach.ts as a second module script.
// Nothing in src imports dev/, and a production build never sees the tag, so it ships no test-API code.
const testApi: Plugin = {
  name: 'engine-test-api',
  apply: (_config, {command, mode}) => command === 'serve' || mode === 'test',
  transformIndexHtml: {
    order: 'pre',
    handler: () =>
      existsSync(fileURLToPath(new URL('./src/dev/attach.ts', import.meta.url)))
        ? [{tag: 'script', attrs: {type: 'module', src: '/src/dev/attach.ts'}, injectTo: 'body'}]
        : [],
  },
};
// Distributable builds carry the engine grant and dependency notices; source delivery remains the distributor's duty.
const licenseNotices: Plugin = {
  name: 'engine-license-notices',
  apply: 'build',
  generateBundle() {
    for (const [source, fileName] of [
      ['LICENSE', 'LICENSE.txt'],
      ['COPYRIGHT', 'COPYRIGHT.txt'],
      ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.txt'],
    ] as const) {
      this.emitFile({
        type: 'asset',
        fileName,
        source: readFileSync(fileURLToPath(new URL(source, import.meta.url)), 'utf8'),
      });
    }
  },
};
// Whenever the dev or preview server listens beyond this machine (`npm run dev -- --host`, ENGINE_HOST), say so.
const loopback = (host: unknown) =>
  host === undefined || host === false || host === 'localhost' || host === '::1' || /^127\./.test(String(host));
const lanNotice =
  'Listening on the local network: anyone on this network can reach this server (and the dev test API) while it runs. Use a trusted network and stop it with Ctrl+C when done.';
const lanWarning: Plugin = {
  name: 'engine-lan-warning',
  configureServer(server) {
    server.httpServer?.once('listening', () => {
      if (!loopback(server.config.server.host)) server.config.logger.warn(lanNotice);
    });
  },
  configurePreviewServer(server) {
    server.httpServer?.once('listening', () => {
      if (!loopback(server.config.preview.host)) server.config.logger.warn(lanNotice);
    });
  },
};
const devHost = (value?: string): string | true =>
  !value || value === '0' || value === 'false' ? '127.0.0.1' : value === '1' || value === 'true' ? true : value;
const slash = (path: string) => path.replace(/\\/g, '/');
// PORT is read by every command that loads this config, so a value that is not a port number is left to Vite's default.
const previewPort = (value?: string): {port?: number; strictPort?: boolean} => {
  const port = Number(value);
  return value && Number.isInteger(port) && port > 0 && port < 65536 ? {port, strictPort: true} : {};
};
const engineBarrel = slash(fileURLToPath(new URL('./src/author/index.ts', import.meta.url)));
// Workers are module workers and the worker host loads job modules on demand: ES output with code splitting.
// Production builds ship short string ids instead of readable keys (scripts/compact-keys.mjs).
export default defineConfig({
  json: {namedExports: false},
  // Game code imports the author API as `@engine` (src/author/index.ts) and optional kits as `@kits/<name>`; the app
  // reaches the game being built as `@game` (scripts/lib/game-dir.mjs: GAME_DIR, else ./game, else templates/blank/game).
  resolve: {
    alias: [
      // Keep one Three identity while allowing optional loaders/animation classes to remain in lazy chunks. three's
      // addons (`three/addons/*`, a game with @kits/three) import `three` too, so they get this same copy.
      {find: /^three$/, replacement: fileURLToPath(new URL('./node_modules/three/src/Three.js', import.meta.url))},
      {find: /^@engine$/, replacement: fileURLToPath(new URL('./src/author/index.ts', import.meta.url))},
      {find: /^@kits\/([a-z-]+)$/, replacement: fileURLToPath(new URL('./src/kits/', import.meta.url)) + '$1/index.ts'},
      {find: /^@game\//, replacement: gameDir() + '/'},
    ],
  },
  plugins: [
    engineStrings,
    lanWarning,
    licenseNotices,
    gamePublic(),
    threeGlsl(),
    compactKeys(fileURLToPath(new URL('./src/generated/strings/compact-ids.json', import.meta.url))),
    testApi,
  ],
  // Static files: Vite's publicDir is the game's own `<game>/public/`, or the root `public/` for a game without one
  // (scripts/lib/game-public.mjs), so the dev server and the build serve the same files the same way. A build ships
  // only the game it builds, never another template's files; gamePublic() refuses reserved names and symbolic links.
  publicDir: gamePublicDir(),
  // `npm run dev` and `npm run preview` listen on this machine only. `npm run dev -- --host` (Vite's own flag) or
  // ENGINE_HOST=1 listens on the local network too, e.g. to open the game on a phone on the same Wi-Fi; everyone on
  // that network can then reach the dev server. `npm run play -- --host` does the same for the play server.
  // ENGINE_WATCH=0 starts no file watcher (`server.watch: null`): the browser-check preload (scripts/silent-browser.cjs)
  // sets it, because those servers never see an edit; `npm run dev` and `npm run play` keep watching.
  server: {host: devHost(process.env.ENGINE_HOST), ...(process.env.ENGINE_WATCH === '0' ? {watch: null} : {})},
  // `PORT=4174 npm run preview` serves on that port and stops if it is taken (as `npm run play` does); without PORT,
  // preview starts at 4173 and moves to the next free port, printing the address it chose.
  preview: {host: devHost(process.env.ENGINE_HOST), ...previewPort(process.env.PORT)},
  // The optional physics kit's library (src/kits/physics/loader.ts) is a self-contained ES module reached only by a
  // dynamic import. Pre-bundling it on discovery made the dev server re-optimise mid-load (504 Outdated Optimize Dep);
  // serving it as is avoids that and costs nothing for games that never import the kit.
  optimizeDeps: {entries: ['index.html'], exclude: ['@dimforge/rapier3d-deterministic-compat']},
  // src/author/index.ts is a pure re-export barrel (scripts/vite-config.test.mjs keeps it so). Declaring it free of
  // side effects lets Rolldown (Vite 8) drop the unused test helpers' static edge to the worker host, so the host
  // stays a lazy chunk as it was under Rollup instead of joining first-load JS.
  build: {
    cssCodeSplit: true,
    target: 'es2022',
    rolldownOptions: {
      treeshake: {
        moduleSideEffects: (id: string) => (slash(id) === engineBarrel ? false : undefined),
      },
    },
  },
  worker: {format: 'es'},
});
