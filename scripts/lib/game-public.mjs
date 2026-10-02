// scripts/lib/game-public.mjs: each game's own static files (W1-5). A game keeps the files it serves (models, textures,
// sounds, decoders) in `<game>/public/`, next to its code, so a build ships that game's files and no other template's.
//
//   <game>/public/models/robot.glb   is served and built as   <base>models/robot.glb   (asset url '/models/robot.glb')
//
// The repository's root `public/` is still Vite's public folder: anything there is shared by every game built from
// this checkout and ships with each of them. The engine itself keeps nothing there. A path present in both folders is
// ambiguous: the build stops with both file names, and the dev server serves the game's file and warns once.
//
// Owner: the Vite config (vite.config.ts) through gamePublic(); the game folder comes from scripts/lib/game-dir.mjs.
// Bounds: files are read when the build emits them (one at a time) and streamed by the dev server; nothing is cached.
import {createReadStream, existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {extname, join, normalize, relative, sep} from 'node:path';
import {ROOT, gameDir} from './game-dir.mjs';

/** Every file under `dir`, relative, with '/' separators, sorted; [] when the folder does not exist. */
export function publicFiles(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir, {recursive: true, withFileTypes: true}).filter(e => e.isFile())
    .map(e => relative(dir, join(e.parentPath ?? e.path, e.name)).split(sep).join('/')).sort();
}

/** Paths present in both the game's public folder and the shared root folder. */
export function conflicts(gamePublicDir, sharedDir) {
  const shared = new Set(publicFiles(sharedDir));
  return publicFiles(gamePublicDir).filter(f => shared.has(f));
}

const TYPES = {'.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ktx2': 'image/ktx2', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.json': 'application/json', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.txt': 'text/plain', '.css': 'text/css'};

/** The file under `dir` a request path names (after the base), or null. Never leaves `dir`. */
export function resolveRequest(dir, pathname, base = '/') {
  let path;
  try { path = decodeURIComponent(pathname); } catch { return null; }
  if (!path.startsWith(base)) return null;
  const file = normalize(join(dir, path.slice(base.length)));
  if (!file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

const conflictMessage = (list, gamePublicDir, sharedDir) => `${list.length} file(s) are in both the game's public folder and the shared root public folder: ` +
  list.slice(0, 5).map(f => `${relative(ROOT, join(gamePublicDir, f)).split(sep).join('/')} and ${relative(ROOT, join(sharedDir, f)).split(sep).join('/')}`).join('; ') +
  (list.length > 5 ? ` (+${list.length - 5})` : '') + '. Keep each file in one place (a game\'s own files belong in its public/ folder).';

/** The Vite plugin: serve `<game>/public/` in dev and emit it into every build. */
export function gamePublic({dir = () => join(gameDir(), 'public'), shared = join(ROOT, 'public')} = {}) {
  return {
    name: 'engine-game-public',
    configureServer(server) {
      const gamePublicDir = dir();
      const clash = conflicts(gamePublicDir, shared);
      if (clash.length) server.config.logger.warn(conflictMessage(clash, gamePublicDir, shared) + ' The dev server serves the game\'s copy.');
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const file = resolveRequest(gamePublicDir, new URL(req.url ?? '/', 'http://x').pathname, server.config.base);
        if (!file) return next();
        res.setHeader('Content-Type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Content-Length', statSync(file).size);
        res.setHeader('Cache-Control', 'no-cache');
        if (req.method === 'HEAD') { res.end(); return; }
        createReadStream(file).on('error', next).pipe(res);
      });
    },
    generateBundle() {
      const gamePublicDir = dir();
      const clash = conflicts(gamePublicDir, shared);
      if (clash.length) this.error(conflictMessage(clash, gamePublicDir, shared));
      for (const fileName of publicFiles(gamePublicDir)) this.emitFile({type: 'asset', fileName, source: readFileSync(join(gamePublicDir, fileName))});
    },
  };
}
