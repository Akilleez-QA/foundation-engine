/**
 * author/scene-extension.ts: the scene render-extension seam (genre-neutral; the engine's half of an opt-in kit such
 * as `@kits/three`).
 *
 * A kit makes an extension with `sceneExtension(id, open)` and a scene lists it in `defineScene({ extensions })`. When
 * a visit of that scene starts, the scene runtime opens each listed extension once, after its renderer, scene and
 * camera exist and before program preparation, and gives it the visit's drawing objects. The extension's session is
 * then asked every frame to bring its objects up to date (`sync`), may replace the scene's draw (`render`), hears about
 * resizes, and is disposed when the visit ends, before the scene's own tree is released.
 *
 * `@engine` exposes only the opaque `SceneExtension` token: no three.js type crosses the author API (ADR 0078). The
 * drawing context below is for kits, which import this module by path; a game never sees it unless a kit hands it on.
 *
 * Ownership: the extension owns what it creates; the visit owns the extension. The scene runtime keeps render on
 * change: a session's `sync` returns true when its picture changed, `busy` keeps frames running, and `invalidate`
 * asks for a frame from outside one. A session that throws is reported once and closed for the rest of the visit; the
 * scene keeps drawing without it.
 */
import type * as T from 'three';
import type {World, Entity} from '../core/ecs/world';
import type {RenderBackendId} from '../platform/render/render-backend';

/** An extension a scene lists in `defineScene({ extensions })`. Opaque: made by a kit (`sceneThree()`). */
export interface SceneExtension {
  readonly kind: 'scene-extension';
  readonly id: string;
}

/** What an extension draws with, for one visit. */
export interface SceneExtensionContext {
  /** The visit's scene (environment, fog, every drawn entity) and its camera. */
  readonly scene: T.Scene;
  readonly camera: T.PerspectiveCamera;
  /** The visit's renderer, leased from the pool: a fresh renderer per visit, released when the visit ends. */
  readonly renderer: T.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  /** The render backend that runs (only 'webgl2' exists so far). */
  readonly backend: RenderBackendId;
  /** The visit's scene context (`SceneContext`), as a key: a kit finds its session from a system's `ctx` with it. */
  readonly ctx: object;
  /** The visit's world, to read components. */
  readonly world: World;
  /** The kits the game lists in `defineGame({ kits })`, by id. */
  readonly kits: readonly string[];
  /** True in dev and test builds: extensions add their diagnostics there. */
  readonly dev: boolean;
  /** Aborts when the visit ends. */
  readonly signal: AbortSignal;
  /** The visit's time: seconds since it began, and Calm (reduced motion). */
  time(): {t: number; calm: boolean};
  /** The render mask of an entity (`RenderMask`). */
  mask(entity: Entity): number;
  /** Mark the picture changed and ask for a frame (from outside a frame: a load, a timer, an event). */
  invalidate(): void;
  /** Report a problem through the scene's log. */
  report(error: unknown): void;
}

/** One visit's extension. */
export interface SceneExtensionSession {
  /** Bring objects up to date. `dt` > 0 once per frame update, 0 just before a draw. True when the picture changed. */
  sync(dt: number): boolean;
  /** True while the extension animates: the scene keeps drawing frames. */
  busy(): boolean;
  /** Draw the frame instead of the scene's own draw; false to let the scene draw. */
  render?(): boolean;
  /** The drawing buffer changed: CSS size and pixel ratio. */
  resized?(width: number, height: number, pixelRatio: number): void;
  /** Dev and test counters (`engine.extensions()`). */
  stats?(): Record<string, unknown>;
  /** Release everything the extension made. Called once, when the visit ends. */
  dispose(): void;
}

type Open = (context: SceneExtensionContext) => SceneExtensionSession;
const opens = new WeakMap<SceneExtension, Open>();
const ID = /^[a-z][a-z0-9-]*$/;

/** A kit's extension: `id` (kebab-case, unique in a scene) and how to open it for one visit. */
export function sceneExtension(id: string, open: Open): SceneExtension {
  if (!ID.test(id)) throw Error(`scene extension id must be kebab-case: ${JSON.stringify(id)}`);
  if (typeof open !== 'function') throw Error(`scene extension ${id}: open must be a function`);
  const token: SceneExtension = Object.freeze({kind: 'scene-extension', id});
  opens.set(token, open);
  return token;
}

/** True for a token made by `sceneExtension`. */
export const isSceneExtension = (value: unknown): value is SceneExtension =>
  typeof value === 'object' && value !== null && opens.has(value as SceneExtension);

/** Open `extension` for one visit (the scene runtime only). */
export function openSceneExtension(extension: SceneExtension, context: SceneExtensionContext): SceneExtensionSession {
  const open = opens.get(extension);
  if (!open) throw Error(`scene extension ${extension.id}: not made by sceneExtension()`);
  return open(context);
}

/** Validate a scene's `extensions` list: tokens from `sceneExtension`, unique ids. */
export function validateExtensions(scene: string, list: unknown): readonly SceneExtension[] {
  if (!Array.isArray(list)) throw Error(`scene ${scene}: extensions must be a list`);
  const ids = new Set<string>();
  for (const x of list) {
    if (!isSceneExtension(x))
      throw Error(`scene ${scene}: extensions takes what a kit makes (for example sceneThree() from @kits/three)`);
    if (ids.has(x.id)) throw Error(`scene ${scene}: extension ${x.id} is listed twice`);
    ids.add(x.id);
  }
  return Object.freeze([...list]);
}
