// perf/budgets.ts: the per-scene performance budgets at the reference preset (STANDARD chapter 12, ADR 0025).
//
// The numbers live in the game's budgets.json (GAME_DIR/budgets.json, next to its code; scripts/lib/game-dir.mjs), so the ratchet (scripts/perf/budget-ratchet.mjs) can compare them across
// revisions without running code: a budget only falls, and a raise needs a reviewed `Perf-Budget:` commit trailer.
// Each scene row says how the bench reaches it (its route), whether it gets an active (input held) window, and its
// budget. A missing metric is UNMEASURED and skipped by the checker. The software-GL gate blocks on counts only
// (draws, triangles, casters, texture/canvas MiB, heap, contexts, load MiB); timings are advisory there.
import type {AppBudget, SceneBudgetValues} from '../src/core/budget';
import type {Ported} from '../src/core/tiers';
import {
  toCheckBudget,
  type BudgetMetric,
  type CheckBudget,
  type SampleBinding,
} from '../src/platform/perf/budget-check';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {gameDir} from '../scripts/lib/game-dir.mjs';

export interface BenchScene {
  /** The scene row's id ('scene.main'). */
  scene: string;
  /** The route the bench enters it by (the player's own address). */
  route: string;
  /** Also sample an active window (the row's `activeKeys` held, default the arrow keys). */
  active?: boolean;
  /**
   * The keys (browser key names: 'ArrowUp', 'KeyW', 'Space') the active window holds, first for half the window, then
   * the second. Naming them says they drive the scene, so a window that then draws no frame is dead (inconclusive).
   * Without them the arrow keys are held and drive the scene only if they press one of the game's own input actions.
   */
  activeKeys?: string[];
  /** Before each active attempt, wait for this visible in-scene marker, press the native restart key,
   * then require the old marker to detach and the same scene to become active. Bounded setup is outside
   * measurement; no gameplay mutation, redraw forcing or budget exemption. */
  activeRestart?: {when: string; key: string; timeoutMs: number};
  budget: Ported<Partial<SceneBudgetValues>>;
  provenance?: {measured: string; run: string; note?: string};
}
export interface BudgetData {
  schema: 1;
  app: AppBudget;
  largeChunkAllow: string[];
  scenes: Record<string, BenchScene>;
}

/** Where the budgets live: the game being built. */
export const BUDGET_FILE = join(gameDir(), 'budgets.json');
export const BUDGET_DATA = JSON.parse(readFileSync(BUDGET_FILE, 'utf8')) as BudgetData;
/** Short scene ids ('main'), in bench order: the first is where the app starts. */
export const SCENE_IDS: readonly string[] = Object.keys(BUDGET_DATA.scenes);
export const BENCH_SCENES: readonly (BenchScene & {id: string})[] = Object.entries(BUDGET_DATA.scenes).map(
  ([id, scene]) => ({id, ...scene}),
);
export const ACTIVE_SCENES: readonly string[] = BENCH_SCENES.filter(p => p.active).map(p => p.id);
export const APP_BUDGET: AppBudget = BUDGET_DATA.app;
export const LARGE_CHUNK_ALLOW: readonly string[] = BUDGET_DATA.largeChunkAllow;

const COUNTS: readonly BudgetMetric[] = [
  'draws',
  'triangles',
  'shadowCasters',
  'textureMiB',
  'canvasMiB',
  'heapMiB',
  'contexts',
];
const ENTRY: readonly BudgetMetric[] = ['loadMs', 'loadMiB', 'frameMs'];
const IDLE: readonly BudgetMetric[] = ['shadowDrawsIdle', 'idleRenderRatio'];

/** Sample id → scene and metrics. Idle behaviour is proved only on the reference GPU. */
export const BENCH_BINDINGS: SampleBinding[] = [
  ...SCENE_IDS.flatMap((p): SampleBinding[] => [
    {sample: p, scene: p, metrics: [...COUNTS, ...ENTRY]},
    {sample: p, scene: p, metrics: IDLE, gpuOnly: true},
    ...(ACTIVE_SCENES.includes(p)
      ? [{sample: p + ':active', scene: p, metrics: [...COUNTS, 'frameMs'] as BudgetMetric[]}]
      : []),
  ]),
  {sample: 'startup', scene: 'app', metrics: ['loadMiB', 'heapMiB']},
  {sample: 'afterTour', scene: 'app-after-tour', metrics: ['canvasMiB', 'heapMiB']},
];

/** Every budget in the checker's shape. The app budget sits under the pseudo-scenes 'app' and 'app-after-tour'. */
export const CHECK_BUDGETS: Record<string, CheckBudget> = {
  ...Object.fromEntries(Object.entries(BUDGET_DATA.scenes).map(([p, scene]) => [p, toCheckBudget(scene.budget)])),
  app: {loadMiB: APP_BUDGET.startupMiB, heapMiB: APP_BUDGET.startupHeapMiB, firstLoadJsKiB: APP_BUDGET.firstLoadJsKiB},
  'app-after-tour': {canvasMiB: APP_BUDGET.retainedCanvasMiBAfterTour, heapMiB: APP_BUDGET.retainedHeapMiBAfterTour},
};
