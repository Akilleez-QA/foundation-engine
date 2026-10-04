/**
 * kits/three/handle.ts: `sceneThree()` (the scene's opt-in) and `useThree(ctx)` (the handle), README.md.
 *
 * A scene that lists `sceneThree()` in `defineScene({ extensions })`, in a game that lists `three()` in
 * `defineGame({ kits })`, gets one handle per visit: the scene, its camera, the renderer and canvas, per-frame hooks,
 * a render override and a disposal registry. The engine opens it before program preparation (so `setup` objects are
 * compiled with the scene), closes it when the visit ends, and keeps three promises whatever the game does with it:
 *  - disposal: everything under `root`, everything `own()` registered, and the rest of the scene's tree are disposed
 *    when the visit ends; in dev builds, a geometry, material or texture that was under `root` and then left the tree
 *    without being disposed is reported as a leak;
 *  - budgets: draws, triangles and memory are measured from the real renderer by the bench and play:snap, whatever
 *    made them;
 *  - render on change: `onFrame` hooks keep frames running; anything else must call `requestRender()` after changing
 *    the picture. The engine owns the render target, the drawing-buffer size and the pixel ratio: a hook or override
 *    that leaves them changed is restored after it runs (and reported once in dev builds).
 */
import * as THREE from 'three';
import type {SceneContext} from '../../author';
import {sceneExtension, type SceneExtension, type SceneExtensionContext} from '../../author/scene-extension';
import {disposeOwnedTree} from '../../platform/render/dispose-owned-tree';
import {
  createCustomObjects,
  customObjectsById,
  disposeLightShadows,
  CUSTOM_OBJECT_LIMITS,
  type CustomObject,
} from './custom-object';

export interface ThreeFrame {
  /** Seconds since the visit began; this frame's step (0 in a hook before a draw); Calm (reduced motion). */
  readonly t: number;
  readonly dt: number;
  readonly calm: boolean;
}
/** What a render override draws with. It must leave the render target at null (the canvas). */
export interface ThreeRenderFrame extends ThreeFrame {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
}
export interface ThreeSize {
  /** CSS pixels of the view and the renderer's pixel ratio. */
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

/** One visit's three.js handle (`useThree(ctx)`). @unstable: tracks the engine's three version (README.md). */
export interface ThreeHandle {
  /** The three.js namespace, the engine's own copy. */
  readonly THREE: typeof THREE;
  /** The visit's scene (environment, fog, every drawn entity). Add your objects under `root`. */
  readonly scene: THREE.Scene;
  /** A group in the scene the kit owns: disposed with everything under it when the visit ends. */
  readonly root: THREE.Group;
  /** The live camera (the engine moves it from `ctx.view.camera` before each draw). */
  readonly camera: THREE.PerspectiveCamera;
  /** The visit's renderer, leased from the pool (a fresh one per visit). */
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  /** Aborts when the visit ends. */
  readonly signal: AbortSignal;
  size(): ThreeSize;
  /** Mark the picture changed and ask for a frame. Call it after changing anything outside a hook. */
  requestRender(): void;
  /** Each frame, in the frame phase. While any is registered, the scene draws every frame. Returns an unsubscribe. */
  onFrame(fn: (frame: ThreeFrame) => void): () => void;
  /** Just before each draw (only frames that draw). Returns an unsubscribe. */
  onBeforeRender(fn: (frame: ThreeFrame) => void): () => void;
  /** After the view's size or pixel ratio changed (resize an EffectComposer here). Returns an unsubscribe. */
  onResize(fn: (size: ThreeSize) => void): () => void;
  /** Draw frames yourself (an EffectComposer, several passes); null gives the draw back to the engine. */
  setRenderOverride(fn: ((frame: ThreeRenderFrame) => void) | null): void;
  /** Dispose `resource` when the visit ends (a composer, controls, a render target, a mixer's clips...). */
  own<D extends {dispose(): void}>(resource: D): D;
}

export interface SceneThreeOptions {
  /** Custom objects entities may show with `ThreeObject({ use })`. */
  objects?: readonly CustomObject[];
  /** At most this many custom objects at once (default 16, at most 256). */
  max?: number;
  /** Turn the renderer's shadow maps on for this scene, before program preparation ('pcf-soft' with true). */
  shadows?: boolean | 'pcf' | 'pcf-soft' | 'vsm';
  /** Once per visit, before program preparation: build objects, set hooks, set a render override. */
  setup?(three: ThreeHandle): void;
}

const handles = new WeakMap<object, ThreeHandle>();

/** True when this scene visit has a three handle (a rendered scene with `sceneThree()`; never in `testScene`). */
export const hasThree = (ctx: SceneContext): boolean => handles.has(ctx);

/** The visit's three handle. Throws in a scene without `sceneThree()`, before the visit opens, and in `testScene`. */
export function useThree(ctx: SceneContext): ThreeHandle {
  const h = handles.get(ctx);
  if (!h)
    throw Error(
      '@kits/three: no three handle for this scene: list sceneThree() in defineScene({ extensions }) and three() in defineGame({ kits }); headless testScene has no renderer (check hasThree(ctx))',
    );
  return h;
}

const SHADOW_TYPES = {pcf: THREE.PCFShadowMap, 'pcf-soft': THREE.PCFSoftShadowMap, vsm: THREE.VSMShadowMap} as const;

/** The scene's opt-in to `@kits/three`. */
export function sceneThree(options: SceneThreeOptions = {}): SceneExtension {
  const max = options.max ?? CUSTOM_OBJECT_LIMITS.perScene;
  if (!Number.isInteger(max) || max < 0 || max > CUSTOM_OBJECT_LIMITS.perSceneCap)
    throw Error(`sceneThree: max must be an integer from 0 to ${CUSTOM_OBJECT_LIMITS.perSceneCap}`);
  if (options.shadows !== undefined && typeof options.shadows !== 'boolean' && !(options.shadows in SHADOW_TYPES))
    throw Error("sceneThree: shadows is true, false, 'pcf', 'pcf-soft' or 'vsm'");
  const objects = [...(options.objects ?? [])];
  customObjectsById(objects); // A data error at definition time; each visit makes its own manager.
  return sceneExtension('three', x => openThree(x, {...options, objects, max}));
}

function openThree(x: SceneExtensionContext, options: SceneThreeOptions & {objects: CustomObject[]; max: number}) {
  if (!x.kits.includes('three'))
    throw Error(
      '@kits/three: the game does not list three() in defineGame({ kits }); only a game that opts in may use the escape hatch',
    );
  const {renderer, scene, camera} = x;
  const root = new THREE.Group();
  root.name = 'kits.three';
  scene.add(root);
  if (options.shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = SHADOW_TYPES[options.shadows === true ? 'pcf-soft' : options.shadows];
  }
  const frameHooks = new Set<(f: ThreeFrame) => void>(),
    drawHooks = new Set<(f: ThreeFrame) => void>(),
    resizeHooks = new Set<(s: ThreeSize) => void>(),
    owned: {dispose(): void}[] = [],
    warned = new Set<string>();
  let override: ((f: ThreeRenderFrame) => void) | null = null,
    pending = false,
    closed = false,
    lastDt = 0,
    size: ThreeSize = {width: 1, height: 1, pixelRatio: renderer.getPixelRatio()};
  const report = (key: string, error: unknown) => {
    if (warned.has(key)) return;
    warned.add(key);
    x.report(error);
  };
  const subscribe = <F>(set: Set<F>, fn: F) => {
    if (typeof fn !== 'function') throw Error('@kits/three: a hook must be a function');
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  };
  // The engine owns the render target, the drawing-buffer size and the pixel ratio: restore them after game code.
  const before = new THREE.Vector2(),
    after = new THREE.Vector2();
  const guarded = (what: string, run: () => void) => {
    const target = renderer.getRenderTarget(),
      ratio = renderer.getPixelRatio();
    renderer.getSize(before);
    try {
      run();
    } finally {
      const changed: string[] = [];
      if (renderer.getRenderTarget() !== target) {
        renderer.setRenderTarget(target);
        changed.push('render target');
      }
      if (renderer.getPixelRatio() !== ratio) {
        renderer.setPixelRatio(ratio);
        changed.push('pixel ratio');
      }
      renderer.getSize(after);
      if (!after.equals(before)) {
        renderer.setSize(before.x, before.y, false);
        changed.push('size');
      }
      if (changed.length && x.dev)
        report(
          `guard:${what}:${changed.join()}`,
          Error(
            `@kits/three: ${what} left the renderer's ${changed.join(', ')} changed; the engine owns them and restored them (use onResize for sizes)`,
          ),
        );
    }
  };
  const call = <A>(what: string, set: Set<(a: A) => void>, arg: A) => {
    for (const fn of [...set])
      try {
        guarded(what, () => fn(arg));
      } catch (error) {
        set.delete(fn);
        report(`hook:${what}`, error);
      }
  };
  const frame = (dt: number): ThreeFrame => ({...x.time(), dt});
  // Dev leak watch: resources seen under `root` that left the tree undisposed by the end of the visit.
  const seen = x.dev ? new Map<THREE.EventDispatcher<{dispose: object}>, string>() : null;
  const watch = () => {
    if (!seen) return;
    root.traverse(o => {
      const mesh = o as Partial<THREE.Mesh>;
      const resources: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
      if (mesh.geometry) resources.push(mesh.geometry);
      for (const m of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) {
        resources.push(m);
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) resources.push(v);
      }
      for (const r of resources)
        if (!seen.has(r)) {
          seen.set(r, `${r.constructor.name} ${(r as {name?: string}).name || ''}`.trim());
          r.addEventListener('dispose', () => seen.delete(r));
        }
    });
  };
  const objects = createCustomObjects({
    world: x.world,
    root,
    objects: options.objects,
    max: options.max,
    backend: x.backend,
    mask: x.mask,
    report: error => x.report(error),
  });
  const handle: ThreeHandle = {
    THREE,
    scene,
    root,
    camera,
    renderer,
    canvas: x.canvas,
    signal: x.signal,
    size: () => size,
    requestRender() {
      if (closed) return;
      pending = true;
      x.invalidate();
    },
    onFrame(fn) {
      const off = subscribe(frameHooks, fn);
      x.invalidate(); // a frame now, so the scene switches to running frames
      return off;
    },
    onBeforeRender: fn => subscribe(drawHooks, fn),
    onResize: fn => subscribe(resizeHooks, fn),
    setRenderOverride(fn) {
      if (fn !== null && typeof fn !== 'function') throw Error('@kits/three: a render override must be a function');
      override = fn;
      handle.requestRender();
    },
    own(resource) {
      if (!resource || typeof resource.dispose !== 'function')
        throw Error('@kits/three: own() takes something with a dispose() method');
      if (closed) {
        resource.dispose();
        return resource;
      }
      owned.push(resource);
      return resource;
    },
  };
  handles.set(x.ctx, handle);
  try {
    if (options.setup) guarded('setup', () => options.setup!(handle));
  } catch (error) {
    x.report(error);
  }
  return {
    busy: () => frameHooks.size > 0 || objects.busy(),
    sync(dt: number) {
      let changed = objects.sync(dt, x.time());
      if (dt > 0) {
        lastDt = dt;
        if (frameHooks.size) {
          call('onFrame', frameHooks, frame(dt));
          changed = true;
        }
      }
      if (pending) {
        pending = false;
        changed = true;
      }
      return changed;
    },
    render() {
      call('onBeforeRender', drawHooks, frame(0));
      watch();
      const draw = override;
      if (!draw) return false;
      guarded('the render override', () => draw({...frame(lastDt), renderer, scene, camera}));
      return true;
    },
    resized(width: number, height: number, pixelRatio: number) {
      size = {width, height, pixelRatio};
      call('onResize', resizeHooks, size);
    },
    stats: () => ({
      ...objects.stats(),
      hooks: {frame: frameHooks.size, beforeRender: drawHooks.size, resize: resizeHooks.size},
      override: override !== null,
      owned: owned.length,
      shadows: renderer.shadowMap.enabled,
    }),
    dispose() {
      if (closed) return;
      closed = true;
      handles.delete(x.ctx);
      frameHooks.clear();
      drawHooks.clear();
      resizeHooks.clear();
      override = null;
      const errors: unknown[] = [];
      for (const step of [
        () => objects.dispose(),
        ...owned.reverse().map(r => () => r.dispose()),
        () => {
          root.removeFromParent();
          disposeLightShadows(root);
          disposeOwnedTree(root);
        },
        // Shadow maps the game turned on for the scene's own lights (the environment's sun): the engine never makes
        // them, so it would not release them.
        () => disposeLightShadows(scene),
      ])
        try {
          step();
        } catch (error) {
          errors.push(error);
        }
      // Still in the scene: the engine disposes it with the scene's tree next. Only what left the tree is a leak.
      if (seen?.size)
        scene.traverse(o => {
          const mesh = o as Partial<THREE.Mesh>;
          if (mesh.geometry) seen.delete(mesh.geometry);
          for (const m of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) {
            seen.delete(m);
            for (const v of Object.values(m)) if (v instanceof THREE.Texture) seen.delete(v);
          }
        });
      if (seen?.size)
        x.report(
          Error(
            `@kits/three: ${seen.size} resource(s) left the scene undisposed (${[...new Set(seen.values())].slice(0, 5).join(', ')}): own() what you detach, or dispose it`,
          ),
        );
      if (errors.length) throw new AggregateError(errors, '@kits/three: cleanup failed');
    },
  };
}
