// perf/quality/views.mjs: the views the picture guard compares between two builds (scripts/perf/quality-guard.mjs).
// One row per view: a scene, the route that reaches it, and how strict the comparison is. A view must be still after
// `settleMs` (the guard captures it twice and rejects any difference). By default every scene in the game's
// budgets.json is compared as 'near' at its start; a game adds views (a framed moment, a menu state) here.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {gameDir} from '../../scripts/lib/game-dir.mjs';

export const viewport = {width: 1280, height: 800};
const budgets = JSON.parse(readFileSync(join(gameDir(), 'budgets.json'), 'utf8'));
export const views = Object.entries(budgets.scenes ?? {}).map(([id, row]) => ({
  id: `${id}-start`,
  scene: row.scene,
  route: row.route,
  mode: 'near',
  settleMs: 1500,
}));
