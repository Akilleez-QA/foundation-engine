/**
 * author/scene-post.ts: one scene visit's post-processing (owner `platform.render.post`; settings in
 * platform/render/post/settings.ts).
 *
 * A scene asks for post with `view.post` (or later, `ctx.view.post`); the player's `post.mode` knob picks the tier.
 * The drawing code is a lazy chunk (`backends/webgl/post.ts`), requested when the scene prepares (or when settings first
 * appear): a scene without post never downloads it. Until it arrives, and whenever the plan is `off`, the scene draws
 * straight to the canvas as it does without post; when it arrives the picture is drawn once more.
 *
 * Render on change: `sync` returns true only when the plan (settings, tier, readiness) changed, so the runtime's
 * dirty flag stays the one place that decides to draw; an idle scene still draws no frame and the last composed picture
 * stays on the canvas.
 *
 * Failure: invalid runtime settings are reported once and the last valid ones stay; a chunk that fails to load, a
 * context that cannot render to a half-float target, or a pipeline error is reported once and the scene stays on
 * `off` for the rest of the visit. A shader link or frame readiness failure is the scene's own (it propagates).
 * Lifetime: owned by the visit; `dispose` releases every target, material and geometry the pipeline made.
 *
 * Lookup tables (`view.post.grade.lut`): the `.cube` file under `public/` is fetched once the chunk is ready (its reader
 * ships in the chunk), with the visit's signal, and parsed; up to `LUT_CACHE` parsed tables are kept per page, so a
 * return visit or a switch back draws without a fetch. Until a table arrives the picture is drawn without it, and it
 * arrives with one redraw. A fetch or parse failure is reported once per file per visit and the scene keeps drawing
 * without the table; changing `file` cancels the previous fetch. The first picture waits (bounded, with the chunk)
 * for the table too.
 */
import type * as T from 'three';
import {FrameReadinessError} from '../platform/render/frame-readiness';
import {ProgramLinkError} from '../platform/render/program-validation';
import {
  postDrawsOf,
  postKey,
  postPlan,
  resolvePost,
  type PostMode,
  type PostPlan,
  type PostResolved,
  type PostSettings,
} from '../platform/render/post/settings';
import type {PostPipeline} from '../platform/render/backends/webgl/post';
import type {CubeLut} from '../platform/render/post/lut';
import {LUT_MAX_BYTES} from '../platform/render/post/lut';
import {publicUrl} from '../platform/assets/public-base';

type PostModule = typeof import('../platform/render/backends/webgl/post');

let module: Promise<PostModule> | null = null;
/** The WebGL2 post chunk, requested once per page (a failed request is retried by the next visit). */
export function loadPostModule(): Promise<PostModule> {
  if (!module)
    module = import('../platform/render/backends/webgl/post').catch((error: unknown) => {
      module = null;
      throw error;
    });
  return module;
}

/** Parsed lookup tables kept per page (least recently used dropped first): about 0.4 MiB each at 33³. */
export const LUT_CACHE = 4;
const luts = new Map<string, CubeLut>();
const remember = (file: string, lut: CubeLut) => {
  luts.delete(file);
  luts.set(file, lut);
  while (luts.size > LUT_CACHE) luts.delete(luts.keys().next().value!);
};
/** Fetch a `.cube` file's text from `public/`, refusing a response larger than the reader accepts. */
async function fetchLutText(file: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(publicUrl(file), {signal});
  if (!response.ok) throw Error(`post: ${file}: HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > LUT_MAX_BYTES) throw Error(`post: ${file}: larger than ${LUT_MAX_BYTES} bytes`);
  return response.text();
}

export interface ScenePostStats {
  /** 'idle' (no settings yet), 'loading', 'ready', 'failed'. */
  state: 'idle' | 'loading' | 'ready' | 'failed';
  /** The tier being drawn: `off` until the chunk is ready, or after a failure. */
  mode: PostMode;
  /** The knob's tier. */
  knob: PostMode;
  /** Post draws per rendered frame of the current plan. */
  drawsPerFrame: number;
  /** Bytes in post targets now, and target (re)allocations. */
  targetBytes: number;
  allocations: number;
  /** Frames drawn through post and the post draws they issued. */
  frames: number;
  draws: number;
  /** Reports made (invalid settings, a load failure, an unsupported context, a pipeline error, a table failure). */
  reports: number;
  /** The lookup table: 'none' (not asked for), 'loading', 'ready' or 'failed'; bytes its 3D texture holds. */
  lut: 'none' | 'loading' | 'ready' | 'failed';
  lutBytes: number;
}

export interface ScenePost {
  /** Bring the plan up to date: true when the picture it draws changed (the runtime marks the frame dirty). */
  sync(settings: PostSettings | undefined, knob: PostMode): boolean;
  /** Draw the frame through post: false when the plan is `off` (the caller draws direct). */
  render(scene: T.Object3D, camera: T.Camera): boolean;
  /** Compile the post variants of the scene and the passes (program preparation). No-op unless ready and not `off`. */
  compile(scene: T.Object3D, camera: T.Camera): void;
  /** Resolves once the chunk is ready or failed, or after `ms` (the scene then starts direct and redraws on arrival). */
  settled(ms: number): Promise<void>;
  stats(): ScenePostStats;
  dispose(): void;
}

export interface ScenePostOptions {
  renderer: T.WebGLRenderer;
  /** The visit's backend: only `webgl2` has an implementation (ADR 0078). */
  backend: string;
  signal: AbortSignal;
  /** MSAA samples for the scene target (the `resolution.antialias` knob). */
  samples(): number;
  /** The chunk (default `loadPostModule`; tests pass their own). */
  load?(): Promise<Pick<PostModule, 'createWebGLPost' | 'postUnsupported' | 'parseCubeLut'>>;
  /** Fetch a lookup table's text (default: `fetch` under `public/`; tests pass their own). */
  fetchLut?(file: string, signal: AbortSignal): Promise<string>;
  /** The chunk arrived (or failed): draw again. */
  changed(): void;
  report(error: unknown): void;
}

export function createScenePost(o: ScenePostOptions): ScenePost {
  let state: ScenePostStats['state'] = 'idle',
    pipeline: PostPipeline | null = null,
    resolved: PostResolved | null = null,
    lastSettings: PostSettings | undefined,
    knob: PostMode = 'off',
    plan: PostPlan | null = null,
    key = 'off',
    reports = 0,
    disposed = false,
    parse: PostModule['parseCubeLut'] | null = null;
  // The lookup table: the file asked for, its parsed table once here, the fetch in flight, files that failed.
  let lutFile: string | null = null,
    lut: CubeLut | null = null,
    lutLife: AbortController | null = null,
    lutState: ScenePostStats['lut'] = 'none';
  const lutFailed = new Set<string>();
  let lutArrived: () => void = () => {};
  let lutArrival: Promise<void> = Promise.resolve();
  let arrived: () => void = () => {};
  const arrival = new Promise<void>(resolve => {
    arrived = resolve;
  });
  const report = (error: unknown) => {
    reports++;
    try {
      o.report(error);
    } catch {
      /* Diagnostics cannot strand a frame. */
    }
  };
  const fail = (error: unknown) => {
    state = 'failed';
    const old = pipeline;
    pipeline = null;
    try {
      old?.dispose();
    } catch (cleanup) {
      report(cleanup);
    }
    report(error);
    arrived();
    // Without the chunk there is no table to wait for.
    lutLife?.abort();
    lutLife = null;
    lutArrived();
  };
  const load = () => {
    if (state !== 'idle' || disposed) return;
    state = 'loading';
    if (o.backend !== 'webgl2') {
      fail(Error(`post: no implementation for the ${o.backend} backend yet (ADR 0078); the scene draws without post`));
      return;
    }
    (o.load ?? loadPostModule)().then(
      m => {
        if (disposed || o.signal.aborted) return;
        try {
          const problem = m.postUnsupported(o.renderer);
          if (problem) throw Error(problem);
          pipeline = m.createWebGLPost(o.renderer, {samples: o.samples});
          parse = m.parseCubeLut;
          state = 'ready';
        } catch (error) {
          fail(error);
          return;
        }
        arrived();
        syncLut();
        o.changed();
      },
      error => {
        if (disposed || o.signal.aborted) return;
        fail(error);
        o.changed();
      },
    );
  };
  const settleLut = () => {
    lutLife = null;
    lutArrived();
  };
  /** Start, keep or cancel the table fetch for the current settings. Needs the chunk (the reader is in it). */
  const syncLut = () => {
    const file = resolved?.grade.lut?.file ?? null;
    if (file !== lutFile) {
      lutLife?.abort();
      settleLut();
      lutFile = file;
      lut = null;
      lutState = file ? 'loading' : 'none';
      if (file) {
        const cached = luts.get(file);
        if (cached) {
          remember(file, cached);
          lut = cached;
          lutState = 'ready';
        } else if (lutFailed.has(file)) lutState = 'failed';
        else lutArrival = new Promise<void>(resolve => (lutArrived = resolve));
      }
    }
    if (!file || lut || lutLife || lutState === 'failed' || state !== 'ready' || !parse || disposed) return;
    const life = (lutLife = new AbortController()),
      read = parse,
      abort = () => life.abort();
    o.signal.addEventListener('abort', abort, {once: true});
    (o.fetchLut ?? fetchLutText)(file, life.signal)
      .then(text => read(text, file))
      .then(
        table => {
          if (life.signal.aborted || disposed || lutFile !== file) return;
          remember(file, table);
          lut = table;
          lutState = 'ready';
          settleLut();
          o.changed();
        },
        error => {
          if (life.signal.aborted || disposed || lutFile !== file) return;
          lutFailed.add(file);
          lutState = 'failed';
          settleLut();
          report(error);
        },
      )
      .finally(() => o.signal.removeEventListener('abort', abort));
  };
  const current = (): PostPlan | null => (state === 'ready' ? postPlan(resolved, knob) : null);
  return {
    sync(settings, mode) {
      if (disposed) return false;
      if (settings !== lastSettings) {
        lastSettings = settings;
        if (settings === undefined) resolved = null;
        else
          try {
            resolved = resolvePost(settings, 'ctx.view.post');
          } catch (error) {
            report(error); // The last valid settings stay.
          }
      }
      knob = mode;
      if (resolved) load();
      syncLut();
      const next = current(),
        nextKey = next?.grade.lut && lut ? `${postKey(next)}|lut` : postKey(next);
      plan = next;
      if (nextKey === key) return false;
      key = nextKey;
      return true;
    },
    render(scene, camera) {
      if (disposed || !plan || !pipeline) return false;
      try {
        pipeline.render(scene, camera, plan, lut);
        return true;
      } catch (error) {
        if (isSceneFailure(error)) throw error;
        fail(error);
        plan = null;
        key = 'off';
        return false;
      }
    },
    compile(scene, camera) {
      if (disposed || !plan || !pipeline) return;
      try {
        pipeline.compile(scene, camera, plan, lut);
      } catch (error) {
        if (isSceneFailure(error)) throw error;
        fail(error);
        plan = null;
        key = 'off';
      }
    },
    settled(ms) {
      if (state !== 'loading' && lutState !== 'loading') return Promise.resolve();
      // The chunk first, then the table (its fetch starts when the chunk is ready), within one bound.
      return Promise.race([arrival.then(() => lutArrival), new Promise<void>(resolve => setTimeout(resolve, ms))]);
    },
    stats() {
      const p = pipeline?.stats();
      return {
        state,
        mode: plan?.mode ?? 'off',
        knob,
        drawsPerFrame: postDrawsOf(plan),
        targetBytes: p?.targetBytes ?? 0,
        allocations: p?.allocations ?? 0,
        frames: p?.frames ?? 0,
        draws: p?.draws ?? 0,
        reports,
        lut: lutState,
        lutBytes: p?.lutBytes ?? 0,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      arrived();
      lutLife?.abort();
      settleLut();
      const old = pipeline;
      pipeline = null;
      plan = null;
      old?.dispose();
    },
  };
}

/** A shader link or frame readiness failure belongs to the scene's own failure path, not post's fallback. */
const isSceneFailure = (error: unknown) => error instanceof ProgramLinkError || error instanceof FrameReadinessError;
