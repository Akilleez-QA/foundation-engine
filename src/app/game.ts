/**
 * app/game.ts: the game this build runs. Its code is outside the engine (`@game`: GAME_DIR, else ./game, else
 * templates/blank/game; scripts/lib/game-dir.mjs) and written against the author API (`@engine`). The brief and the
 * game's identity come from there; nothing else in the engine names a game.
 */
import brief from '@game/build.brief';
import game from '@game/game';

export { brief, game };
