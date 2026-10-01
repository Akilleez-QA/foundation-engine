// scripts/lib/game-dir.mjs: which game this checkout builds, for Vite, the perf tools and the play scripts.
//   GAME_DIR=<dir>      (relative to the repository root) wins;
//   else ./game/        when it exists (a game made from a template with `npm run new-game`);
//   else templates/blank/game, so the engine repository itself always builds and tests something.
import {existsSync} from 'node:fs';
import {isAbsolute, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DEFAULT_TEMPLATE = 'templates/blank/game';

export function gameDir(env = process.env) {
  const dir = env.GAME_DIR ? (isAbsolute(env.GAME_DIR) ? env.GAME_DIR : join(ROOT, env.GAME_DIR))
    : existsSync(join(ROOT, 'game', 'game.ts')) ? join(ROOT, 'game') : join(ROOT, DEFAULT_TEMPLATE);
  if (!existsSync(join(dir, 'game.ts'))) throw Error(`GAME_DIR ${dir} has no game.ts`);
  return dir;
}
/** The game directory relative to the root, with forward slashes (for messages and evidence). */
export const gameDirLabel = (dir = gameDir()) => relative(ROOT, dir).split('\\').join('/');
