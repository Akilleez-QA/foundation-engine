// core/budget.ts: the performance budget TYPES (ADR 0025, 0029, 0030). Types plus
// `budgetFor`; the checker is platform/perf/budget-check.ts. They live in core (L0) because SceneDef holds a
// SceneBudget. Flat fields are the reference preset's values; `ports` holds a lighter preset's overrides once
// that port is built.
import type {Ported, PortPreset, QualityPreset} from './tiers';

export interface SceneBudgetValues {
  /** GL draws per rendered frame, shadow pass included, post-processing excluded (worst window of the scene). */
  draws: number;
  /** Post-processing fullscreen draws per rendered frame (`view.post` at the preset's `post.mode`: 0 off, 1 basic,
   *  10 full). Counted apart so `draws` keeps measuring the scene's own complexity. */
  postDraws?: number;
  /** Triangles submitted per rendered frame, shadow pass included. */
  triangles: number;
  /** Off-screen draws in the busiest frame (the bench's `shadowPassDrawsMax`): for each shadow light, the casters in
   *  range of each map face, summed (a sun or spot light has 1 face, a point light 6). Any other render-target draw in
   *  that frame counts too. Shadow maps redraw only when something moves, so active windows set it. */
  shadowCasters: number;
  /** Off-screen passes in the busiest frame (the bench's `shadowPassesMax`): one per shadow-map face that drew
   *  (sun or spot 1, point light 6), plus any other render-target pass. Optional: unset is unmeasured. */
  shadowPasses?: number;
  /** Shadow-pass draws per rendered frame while still; 0 = static maps. */
  shadowDrawsIdle: number;
  /** Shadow-pass draws per rendered frame during the active script, rebuilds included (ADR 0037). */
  shadowDrawsActive?: number;
  /** Share of frames that draw while the scene is still (ADR 0015). */
  idleRenderRatio: number;
  /** Live GPU texture bytes. */
  textureMiB: number;
  /** Live 2D canvas backing store, page-wide, after GC. */
  canvasMiB: number;
  /** JS heap after two forced GCs. */
  heapMiB: number;
  /** Live WebGL contexts. */
  contexts: number;
  /** p95 at 3840×2160 on the reference GPU. */
  frameMs: number;
  /** Enter from the home scene, warm cache, reference GPU. */
  loadMs: number;
  /** Bytes transferred to enter from the home scene in the same session. */
  loadMiB: number;
  /** The scene's own lazy chunk(s), minified. */
  chunkKiB: number;
  /** p95 sim host + readouts per frame, reference run only. */
  simMs?: number;
  /** p95 navigation → first presented frame of this scene from the home scene (ADR 0041), reference run. */
  handoverMs?: number;
  /** Min accepted/requested world time over the bench route; 1.0 on the reference run (ADR 0049). */
  worldDilation?: number;
}

export type SceneBudget = Ported<SceneBudgetValues> & {provenance: {measured: string; run: string}};

/** App-wide numbers that are not per scene. */
export interface AppBudget {
  firstLoadJsKiB: number;
  startupMiB: number;
  startupHeapMiB: number;
  appReadyMs: {desktop: number};
  retainedCanvasMiBAfterTour: number;
  retainedHeapMiBAfterTour: number;
}

/** Fallback order for a preset's own values: its port, then each heavier port, then the reference values. */
const CHAIN: Readonly<Record<QualityPreset, readonly PortPreset[]>> = {
  reference: [],
  high: ['high'],
  medium: ['medium', 'high'],
  low: ['low', 'medium', 'high'],
};

/** The values that apply at `preset` (low → medium → high → reference). */
export function budgetFor<T extends object>(b: Ported<T>, preset: QualityPreset): T {
  const {ports, ...flat} = b as Ported<T> & Record<string, unknown>;
  const out: Record<string, unknown> = {...flat};
  for (const port of [...CHAIN[preset]].reverse()) Object.assign(out, ports?.[port] ?? {});
  return out as T;
}
