import {defineConfig, type Plugin} from 'vite';
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {compactKeys} from './scripts/compact-keys.mjs';
import {gameDir} from './scripts/lib/game-dir.mjs';

// The generated string catalogues and key types (ADR 0043) are gitignored, so every build and dev server regenerates
// them first: `npm run build`, the gate, the deploy guard and the verify scripts all build through here. The dev
// server regenerates when a strings or narration shard changes.
const runStrings = () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./scripts/strings.mjs', import.meta.url))], {encoding: 'utf8'});
  if (r.status !== 0) throw Error(r.stderr || 'scripts/strings.mjs failed');
};
const isShard = (file: string) => /[\\/](?:strings|narration)[\\/](?:[\w-]+[\\/])*[\w-]+\.json$/.test(file) && !/[\\/]generated[\\/]/.test(file);
const engineStrings: Plugin = {
  name: 'engine-strings', buildStart: runStrings,
  configureServer(server) { server.watcher.on('change', file => { if (isShard(file)) try { runStrings(); } catch (e) { server.config.logger.error(String(e)); } }); },
};
// The test API (ADR 0026): the dev server and `vite build --mode test` add src/dev/attach.ts as a second module script.
// Nothing in src imports dev/, and a production build never sees the tag, so it ships no test-API code.
const testApi: Plugin = {
  name: 'engine-test-api', apply: (_config, {command, mode}) => command === 'serve' || mode === 'test',
  transformIndexHtml: {order: 'pre', handler: () => existsSync(fileURLToPath(new URL('./src/dev/attach.ts', import.meta.url)))
    ? [{tag: 'script', attrs: {type: 'module', src: '/src/dev/attach.ts'}, injectTo: 'body'}] : []},
};
// Distributable builds carry the engine grant and dependency notices; source delivery remains the distributor's duty.
const licenseNotices: Plugin = {
  name: 'engine-license-notices', apply: 'build',
  generateBundle() {
    for (const [source, fileName] of [['LICENSE','LICENSE.txt'],['COPYRIGHT','COPYRIGHT.txt'],['THIRD_PARTY_NOTICES.md','THIRD_PARTY_NOTICES.txt']]) {
      this.emitFile({type:'asset',fileName,source:readFileSync(fileURLToPath(new URL(source,import.meta.url)),'utf8')});
    }
  },
};
const devHost = (value?: string): string | true => !value || value === '0' || value === 'false' ? '127.0.0.1' : value === '1' || value === 'true' ? true : value;
// Workers are module workers and the worker host loads job modules on demand: ES output with code splitting.
// Production builds ship short string ids instead of readable keys (scripts/compact-keys.mjs).
export default defineConfig({
  json: {namedExports: false},
  // Game code imports the author API as `@engine` (src/author/index.ts) and optional kits as `@kits/<name>`; the app
  // reaches the game being built as `@game` (scripts/lib/game-dir.mjs: GAME_DIR, else ./game, else templates/blank/game).
  resolve: {alias: [
    // Keep one Three identity while allowing optional loaders/animation classes to remain in lazy chunks.
    {find: /^three$/, replacement: fileURLToPath(new URL('./node_modules/three/src/Three.js', import.meta.url))},
    {find: /^@engine$/, replacement: fileURLToPath(new URL('./src/author/index.ts', import.meta.url))},
    {find: /^@kits\/([a-z-]+)$/, replacement: fileURLToPath(new URL('./src/kits/', import.meta.url)) + '$1/index.ts'},
    {find: /^@game\//, replacement: gameDir() + '/'},
  ]},
  plugins: [engineStrings, licenseNotices, compactKeys(fileURLToPath(new URL('./src/generated/strings/compact-ids.json', import.meta.url))), testApi],
  // `npm run dev` and `npm run preview` listen on this machine only. `npm run dev -- --host` (Vite's own flag) or
  // ENGINE_HOST=1 listens on the local network too, e.g. to open the game on a phone on the same Wi-Fi; everyone on
  // that network can then reach the dev server. `npm run play -- --host` does the same for the play server.
  server: {host: devHost(process.env.ENGINE_HOST)},
  preview: {host: devHost(process.env.ENGINE_HOST)},
  optimizeDeps: {entries: ['index.html']},
  build: {cssCodeSplit: true, target: 'es2022'},
  worker: {format: 'es'},
});
