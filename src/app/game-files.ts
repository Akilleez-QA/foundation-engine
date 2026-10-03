/**
 * app/game-files.ts: the game's definitions read from disk, for node tools and tests (the browser build uses
 * `import.meta.glob('@game/…')` in app/modules.ts). Same rule: every `*.ts` default export except tests, the brief,
 * game.ts and the files under public/ and tools/.
 */
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gameDir} from '../../scripts/lib/game-dir.mjs';
import type {AuthorDef, GameDefinition} from '../author/defs';
import type {BuildBrief} from '../author/build';

export const GAME_DIR = gameDir();

export function gameFiles(dir = GAME_DIR): string[] {
  return (readdirSync(dir, {recursive: true}) as string[])
    .map(f => f.split('\\').join('/'))
    .filter(
      f =>
        f.endsWith('.ts') &&
        !f.endsWith('.test.ts') &&
        f !== 'build.brief.ts' &&
        f !== 'game.ts' &&
        !f.startsWith('public/') &&
        !f.startsWith('tools/'),
    )
    .map(f => join(dir, f))
    .sort();
}

/** The definitions (default exports); helper files without one are skipped. */
export async function loadGameDefinitions(dir = GAME_DIR): Promise<AuthorDef[]> {
  const all = await Promise.all(
    gameFiles(dir).map(async f => ((await import(pathToFileURL(f).href)) as {default?: AuthorDef}).default),
  );
  return all.filter((d): d is AuthorDef => !!d && typeof d === 'object' && 'kind' in d);
}

/** The whole game from disk: its brief, its identity and its definitions. */
export async function loadGame(
  dir = GAME_DIR,
): Promise<{dir: string; brief: BuildBrief; game: GameDefinition; defs: AuthorDef[]}> {
  const load = async (f: string) => ((await import(pathToFileURL(join(dir, f)).href)) as {default: unknown}).default;
  return {
    dir,
    brief: (await load('build.brief.ts')) as BuildBrief,
    game: (await load('game.ts')) as GameDefinition,
    defs: await loadGameDefinitions(dir),
  };
}
