// scripts/lib/game-dir.mjs: which game this checkout builds, for Vite, the perf tools and the play scripts.
//   --game <dir>        on the command line (`npm run gate -- --game templates/arcade/game`) sets GAME_DIR for this
//                       process and everything it starts, on any shell (POSIX, PowerShell, cmd.exe);
//   GAME_DIR=<dir>      (relative to the repository root) wins otherwise;
//   else ./game/        when it exists (a game made from a template with `npm run new-game`);
//   else templates/blank/game, so the engine repository itself always builds and tests something.
// A GAME_DIR without a game.ts stops the command with one line that lists the template game folders.
import {existsSync, readdirSync} from 'node:fs';
import {isAbsolute, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DEFAULT_TEMPLATE = 'templates/blank/game';

/** The value of `--game <dir>` or `--game=<dir>` in a command line, '' when the flag has no value, or undefined. */
export function gameArg(argv = process.argv.slice(2)) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--game') return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '';
    if (argv[i].startsWith('--game=')) return argv[i].slice('--game='.length);
  }
  return undefined;
}

/** The template game folders, relative to the root (templates/<name>/game). */
export function templateGameDirs(root = ROOT) {
  const dir = join(root, 'templates');
  return existsSync(dir)
    ? readdirSync(dir)
        .filter(n => existsSync(join(dir, n, 'game', 'game.ts')))
        .sort()
        .map(n => `templates/${n}/game`)
    : [];
}

const resolveDir = env =>
  env.GAME_DIR
    ? isAbsolute(env.GAME_DIR)
      ? env.GAME_DIR
      : join(ROOT, env.GAME_DIR)
    : existsSync(join(ROOT, 'game', 'game.ts'))
      ? join(ROOT, 'game')
      : join(ROOT, DEFAULT_TEMPLATE);

/** Why the selected game folder cannot be used (one line), or null. */
export function gameDirProblem(env = process.env) {
  const dir = resolveDir(env);
  if (existsSync(join(dir, 'game.ts'))) return null;
  return `GAME_DIR ${env.GAME_DIR ?? dir} has no game.ts. Use ./game (npm run new-game) or one of: ${templateGameDirs().join(', ')}`;
}

export function gameDir(env = process.env) {
  const problem = gameDirProblem(env);
  if (problem) throw Object.assign(Error(problem), {code: 'ENGINE_GAME_DIR'});
  return resolveDir(env);
}
/** The game directory relative to the root, with forward slashes (for messages and evidence). */
export const gameDirLabel = (dir = gameDir()) => relative(ROOT, dir).split('\\').join('/');

// Command-line entry points import this module, so `--game` and a wrong GAME_DIR are handled once, before any work and
// before any child process starts (children inherit the environment).
const fromArg = gameArg();
if (fromArg === '') {
  console.error(`--game needs a folder, e.g. --game templates/blank/game. One of: ${templateGameDirs().join(', ')}`);
  process.exit(2);
}
if (fromArg) process.env.GAME_DIR = fromArg;
if (process.env.GAME_DIR) {
  const problem = gameDirProblem();
  if (problem) {
    console.error(problem);
    process.exit(2);
  }
}
