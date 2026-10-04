/**
 * author/scene-post.ts: one scene visit's post-processing (owner `platform.render.post`; settings in
 * platform/render/post/settings.ts).
 *
 * A scene asks for post with `view.post` (or later, `ctx.view.post`); the player's `post.mode` knob picks the tier.
 * The drawing code is a lazy chunk (`post/webgl.ts`), requested when the scene prepares (or when settings first
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
import type {PostPipeline} from '../platform/render/post/webgl';

type PostModule = typeof import('../platform/render/post/webgl');

let module: Promise<PostModule> | null = null;
/** The WebGL2 post chunk, requested once per page (a failed request is retried by the next visit). */
export function loadPostModule(): Promise<PostModule> {
  if (!module)
    module = import('../platform/render/post/webgl').catch((error: unknown) => {
      module = null;
      throw error;
    });
  return module;
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
  /** Reports made (invalid settings, a load failure, an unsupported context, a pipeline error). */
  reports: number;
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
  load?(): Promise<PostModule>;
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
    disposed = false;
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
          state = 'ready';
        } catch (error) {
          fail(error);
          return;
        }
        arrived();
        o.changed();
      },
      error => {
        if (disposed || o.signal.aborted) return;
        fail(error);
        o.changed();
      },
    );
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
      const next = current(),
        nextKey = postKey(next);
      plan = next;
      if (nextKey === key) return false;
      key = nextKey;
      return true;
    },
    render(scene, camera) {
      if (disposed || !plan || !pipeline) return false;
      try {
        pipeline.render(scene, camera, plan);
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
        pipeline.compile(scene, camera, plan);
      } catch (error) {
        if (isSceneFailure(error)) throw error;
        fail(error);
        plan = null;
        key = 'off';
      }
    },
    settled(ms) {
      if (state !== 'loading') return Promise.resolve();
      return Promise.race([arrival, new Promise<void>(resolve => setTimeout(resolve, ms))]);
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
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      arrived();
      const old = pipeline;
      pipeline = null;
      plan = null;
      old?.dispose();
    },
  };
}

/** A shader link or frame readiness failure belongs to the scene's own failure path, not post's fallback. */
const isSceneFailure = (error: unknown) => error instanceof ProgramLinkError || error instanceof FrameReadinessError;
