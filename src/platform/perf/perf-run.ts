import type {ScriptedWindow} from './scripted-window';
// platform/perf/perf-run.ts: the `PerfRun` file (schema 1), written by scripts/perf/bench.mjs to
// perf/runs/ and read by the gate. Types only. Everything here is local: no number leaves the device (D8).
import type {WindowClassification} from './window-class';

export type Harness = 'swiftshader' | 'gpu';
export type SampleMode = 'idle' | 'active';

/**
 * Report-only per-frame submission counters from the WebGL probe (ADR 0051 decision 1). Means per rendered frame.
 * They become gated fields only after two consecutive benches agree within tolerance.
 */
export interface SubmissionCounters {
  useProgram: number;
  /** Programs linked during the window (a first-use signal, not a reason to drop frames; ADR 0053). */
  programsCreated: number;
  /** three's `getProgram` lookups. null: there is no production-free hook yet (open work, ADR 0051). */
  programLookups: number | null;
  uniformCalls: number;
  bindVertexArray: number;
  bufferSubData: number;
  textureUploads: number;
  /**
   * Share of rendered frames that drew into an off-screen framebuffer. A proxy for the shadow scheduler's
   * due frames ÷ rendered frames until `platform/render/shadows` reports its own `stats.updates`.
   */
  shadowDueRatio: number;
}

/** Texture uploads in a window, by ADR 0053 purpose. */
export interface UploadSummary {
  initial: number;
  recurring: number;
  firstUse: number;
  unknown: number;
  bytes: number;
}

export type PerfSample = {
  /** Sample id the budgets bind to: `<scene>` (idle) and `<scene>:active`. */
  id: string;
  scene: string;
  mode: SampleMode;
  /** Set when the sample was rejected (wrong scene, timeout, incomplete). A rejected sample carries no numbers. */
  error?: string;
  /** Where the page was at the end of the window. */
  hash?: string;
  classification?: WindowClassification;
  scriptedWindow?: ScriptedWindow;
  readiness?: {start: Record<string, unknown>; end: Record<string, unknown>};
  windowMs?: number;
  frames?: number;
  renderedFrames?: number;
  renderedFrameRatio?: number;
  drawsPerRenderedFrame?: number;
  drawsMaxFrame?: number;
  trisPerRenderedFrame?: number;
  offscreenDrawsPerRenderedFrame?: number;
  /** Post-processing draws per rendered frame (fullscreen passes; never part of drawsPerRenderedFrame). */
  postDrawsPerRenderedFrame?: number;
  shadowPassDrawsMax?: number;
  shadowPassesMax?: number;
  taskMsPerFrame?: number;
  frameMsP95?: number;
  frameMsMax?: number;
  layouts?: number;
  heapMB?: number;
  textureMiB?: number;
  canvasMiB?: number;
  canvases?: number;
  liveContexts?: number;
  enterMs?: number;
  enterMB?: number;
  /** Loading went quiet before the window (no prerequisite request in flight for 1 s, within 30 s). */
  networkQuiet?: boolean;
  /** Extra windows taken because earlier ones were not comparable (ADR 0053), and why those were not. */
  resampled?: number;
  earlierAttempts?: string[];
  submission?: SubmissionCounters;
  uploads?: UploadSummary;
  topTextures?: string[];
  /** Active windows: the keys held, whether they drive the scene (null: unknown), how that was decided, and the game
   *  actions they press. A window whose keys press nothing and that drew nothing is still, not dead (window-class). */
  heldKeys?: string[];
  heldKeysDrive?: boolean | null;
  heldKeysSource?: 'activeKeys' | 'bindings' | 'unknown';
  heldKeyActions?: string[];
};

export interface StartupSample {
  appReadyMs: number;
  transferredMB: number;
  jsKB: number;
  heapMB: number;
  textureMiB: number;
  canvasMiB: number;
  liveContexts: number;
  [extra: string]: number;
}

export interface PerfRun {
  schema: 1;
  sha: string;
  /** True when the tree had uncommitted changes: such a run never becomes a baseline. */
  dirty: boolean;
  harness: Harness;
  viewport: {width: number; height: number; dpr: number};
  gpu: string;
  browser: string;
  when: string;
  /** 1-minute load average at the start (ADR 0053: recorded with every run). */
  loadAverage: number;
  /** Hash of the experiment descriptor (ADR 0046); the cache key also covers the build. */
  descriptor: string;
  /** The build the bench made and served (null when it was given a base URL): the ADR 0046 whole-build key. */
  build?: {digest: string; files: number} | null;
  /** 'hermetic': requests leaving the served origin were blocked (counted here by origin). 'live': they went out. */
  network?: {mode: 'hermetic' | 'live'; external: Record<string, number>};
  startup: StartupSample | null;
  samples: PerfSample[];
  afterTour: {textureMiB: number; canvasMiB: number; heapMB: number; liveContexts: number} | null;
  chunks: Record<string, number>;
  pageErrors?: string[];
}
