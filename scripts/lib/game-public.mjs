// scripts/lib/game-public.mjs: each game's own static files (W1-5). A game keeps the files it serves (models, textures,
// sounds, decoders) in `<game>/public/`, next to its code, so a build ships that game's files and no other template's.
//
//   <game>/public/models/robot.glb   is served and built as   <base>models/robot.glb   (asset url '/models/robot.glb')
//
// That folder is Vite's own `publicDir` (vite.config.ts: publicDir: gamePublicDir()), so the dev server and the build
// treat it exactly as Vite treats any public folder: Vite serves it in dev (Range requests, ?url/?raw/?import) and
// copies it into the build output after the bundle is written; nothing here reads, holds or streams the files. A game
// without its own `public/` folder falls back to the repository's root `public/` (the folder older games used; the
// engine keeps nothing there). Only one of the two is ever used.
//
// gamePublic() checks the folder in use before the dev server starts and when a build starts, and stops either with
// the same message when:
// - it holds a reserved name at its top: index.html, LICENSE.txt, COPYRIGHT.txt or THIRD_PARTY_NOTICES.txt, which the
//   build writes itself (the app page and the licence notices); a copy would replace them;
// - it holds a symbolic link: the dev server would follow it and the build would copy the link, not the file;
// - the game has its own folder and the root `public/` still holds files, which would then be silently left out.
//
// Owner: the Vite config; the game folder comes from scripts/lib/game-dir.mjs. Bounds: one directory walk per check.
import {existsSync, readdirSync, statSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {ROOT, gameDir} from './game-dir.mjs';

/** Names the build writes itself at the top of its output; a public file with one of these names is refused. */
export const RESERVED = ['index.html', 'LICENSE.txt', 'COPYRIGHT.txt', 'THIRD_PARTY_NOTICES.txt'];

const isDir = dir => existsSync(dir) && statSync(dir).isDirectory();
const rel = (dir, e) =>
  relative(dir, join(e.parentPath ?? e.path, e.name))
    .split(sep)
    .join('/');
const entries = dir => (isDir(dir) ? readdirSync(dir, {recursive: true, withFileTypes: true}) : []);

/** Every file under `dir`, relative, with '/' separators, sorted; [] when the folder does not exist. */
export function publicFiles(dir) {
  return entries(dir)
    .filter(e => e.isFile())
    .map(e => rel(dir, e))
    .sort();
}

/** The public folder a build of the game uses: `<game>/public/` when it exists, else the shared root `public/`. */
export function gamePublicDir({game = join(gameDir(), 'public'), shared = join(ROOT, 'public')} = {}) {
  return isDir(game) ? game : shared;
}

const show = path => relative(ROOT, path).split(sep).join('/') || '.';

/** Why `dir` cannot be served and built as the public folder ([] when it can). `shared` is the root folder. */
export function publicProblems(dir, shared = join(ROOT, 'public')) {
  if (!dir || !isDir(dir)) return [];
  const out = [],
    all = entries(dir);
  const reserved = new Set(RESERVED.map(n => n.toLowerCase()));
  const clash = all
    .filter(e => (e.isFile() || e.isSymbolicLink()) && !rel(dir, e).includes('/') && reserved.has(e.name.toLowerCase()))
    .map(e => e.name)
    .sort();
  if (clash.length)
    out.push(
      `${show(dir)} holds ${clash.join(', ')}: the build writes ${clash.length > 1 ? 'these names' : 'this name'} itself (the app page and the licence notices) and a copy would replace ${clash.length > 1 ? 'them' : 'it'}. Rename or move ${clash.length > 1 ? 'them' : 'it'} into a subfolder.`,
    );
  const links = all
    .filter(e => e.isSymbolicLink())
    .map(e => rel(dir, e))
    .sort();
  if (links.length)
    out.push(
      `${show(dir)} holds ${links.length} symbolic link(s) (${links.slice(0, 5).join(', ')}${links.length > 5 ? ', …' : ''}): the dev server would follow them but the build copies the link, not the file. Copy the files in instead.`,
    );
  if (dir !== shared) {
    const left = publicFiles(shared);
    if (left.length)
      out.push(
        `the game has its own ${show(dir)}, so the ${left.length} file(s) in the root ${show(shared)} (${left.slice(0, 5).join(', ')}${left.length > 5 ? ', …' : ''}) would be served and built by no one. Move them into ${show(dir)}.`,
      );
  }
  return out;
}

const message = problems => 'static files: ' + problems.join(' ');

/** The Vite plugin: refuses a public folder the dev server and the build would not treat the same (see the header). */
export function gamePublic({shared = join(ROOT, 'public')} = {}) {
  let dir = '';
  return {
    name: 'engine-game-public',
    configResolved(config) {
      dir = config.publicDir || '';
    },
    configureServer() {
      const problems = publicProblems(dir, shared);
      if (problems.length) throw Error(message(problems));
    },
    buildStart() {
      const problems = publicProblems(dir, shared);
      if (problems.length) this.error(message(problems));
    },
  };
}
