/**
 * platform/render/pool-snapshot.ts: the renderer pool's `utility` role, `pool.snapshot` (
 * ADRs 0016, 0040; STD-REN-3, STD-REN-4).
 *
 * Portraits, photo-booth pictures, costume thumbnails and the lander sprite are drawn here, off screen, instead of on
 * renderers of their own (a photo booth, thumbnails, sprites).
 *
 * Where it draws (D5): into a render target on the WORLD context when one is live (leased or parked), so a snapshot
 * while a scene is open creates no context at all. Otherwise on a small utility context that lingers 8 s after its
 * last snapshot (what the shop photo studio's shared renderer did) and is retired as soon as a world context exists.
 *
 * Why the pixels match the old canvases. The old renderers drew into their own default framebuffer: 4× MSAA, the
 * shaders tone mapping and encoding to sRGB per sample, 8-bit storage, premultiplied alpha. The target here does the
 * same: 4 samples, an 8-bit `RGBA8` store (not `SRGB8_ALPHA8`, which would encode a second time), and it is marked as
 * three's "presented" kind of target (`isXRRenderTarget`, the flag three uses for a target that stands in for the
 * screen) so the shaders apply the renderer's tone mapping and the sRGB output encoding exactly as they do on a canvas.
 * The resolved bytes are read back and un-premultiplied into a 2D canvas, as `drawImage` of a WebGL canvas did.
 *
 * Sharing the world context (ADR 0040): the snapshot has its own three renderer bound to that context (never the
 * scene's renderer or scene); the scene's renderer has its state cache reset afterwards, as pool-stage.ts does between
 * views. The snapshot renderer is let go whenever the world context changes hands, before the pool sweeps it.
 *
 * This module is not in the first-load file: the pool reaches it only through `attachUtility`.
 */
import * as T from 'three';
import {appRenderers, type PoolRenderer, type RendererPool} from './renderer-pool';
import {markPresentedTarget} from './three-internals';
import {anonymousOwner, appLoop} from '../ui/runtime';

type GL = WebGL2RenderingContext;
export interface SnapshotSize {
  width: number;
  height: number;
}
/**
 * Draw one picture: `renderer.render(scene, camera)` draws into `target` (already bound and cleared to transparent).
 * The renderer starts with three's defaults (no tone mapping, exposure 1, sRGB output); set what the picture needs.
 * Do not `setSize`, `setPixelRatio` or `setRenderTarget` on it.
 */
export type SnapshotDraw = (renderer: T.WebGLRenderer, target: T.WebGLRenderTarget) => void;

/** The renderer a snapshot needs (three's WebGLRenderer; a fake in tests). */
export type SnapshotRenderer = PoolRenderer &
  Pick<T.WebGLRenderer, 'setRenderTarget' | 'readRenderTargetPixels' | 'setClearColor' | 'clear'>;

export interface SnapshotOptions {
  /** The utility context (a detached canvas). Throws when WebGL cannot start. */
  createContext?(): {canvas: HTMLCanvasElement; gl: GL};
  createTarget?(size: SnapshotSize): T.WebGLRenderTarget;
  /** Turn the read-back (bottom row first, premultiplied RGBA) into the picture. */
  output?(pixels: Uint8Array, size: SnapshotSize): HTMLCanvasElement | null;
  /** How long the utility context outlives its last snapshot (8 s). */
  lingerMs?: number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(t: unknown): void;
}

export interface Snapshots {
  /** Draw a picture now. Null when WebGL cannot start or the draw failed. */
  canvas(size: SnapshotSize, draw: SnapshotDraw): HTMLCanvasElement | null;
  /** `pool.snapshot`: the same picture as an ImageBitmap. */
  snapshot(size: SnapshotSize, draw: SnapshotDraw): Promise<ImageBitmap>;
  stats(): {snapshots: number; onWorld: number; created: number; contexts: number};
}

/** A render target that stands in for a canvas's default framebuffer (see the header). */
export function presentedTarget(size: SnapshotSize): T.WebGLRenderTarget {
  const target = new T.WebGLRenderTarget(size.width, size.height, {
    samples: 4,
    depthBuffer: true,
    colorSpace: T.SRGBColorSpace,
  });
  target.texture.internalFormat = 'RGBA8';
  // three applies tone mapping and the target's output colour space only for the screen and XR's presented targets.
  markPresentedTarget(target);
  return target;
}

/** Read-back → 2D canvas: rows flipped, alpha un-premultiplied (what `drawImage` of a premultiplied WebGL canvas gives). */
function toCanvas(pixels: Uint8Array, {width, height}: SnapshotSize): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const image = g.createImageData(width, height),
    out = image.data,
    row = width * 4;
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * row,
      to = y * row;
    for (let i = 0; i < row; i += 4) {
      const a = pixels[from + i + 3]!;
      out[to + i + 3] = a;
      if (a === 0) continue;
      const k = 255 / a;
      out[to + i] = Math.min(255, Math.round(pixels[from + i]! * k));
      out[to + i + 1] = Math.min(255, Math.round(pixels[from + i + 1]! * k));
      out[to + i + 2] = Math.min(255, Math.round(pixels[from + i + 2]! * k));
    }
  }
  g.putImageData(image, 0, 0);
  return canvas;
}

export function createSnapshots(pool: RendererPool, o: SnapshotOptions = {}): Snapshots {
  // Snapshots read pixels back synchronously, so they need a WebGL2 context of their own (render-backend.ts).
  const createContext =
    o.createContext ??
    (() => {
      const canvas = document.createElement('canvas');
      // No MSAA or depth on the default framebuffer: every snapshot draws into its own multisampled target.
      const gl = canvas.getContext('webgl2', {
        alpha: true,
        depth: false,
        stencil: false,
        antialias: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: 'default',
      });
      if (!gl) throw Error('WebGL2 unavailable');
      return {canvas, gl};
    });
  const createTarget = o.createTarget ?? presentedTarget;
  const output = o.output ?? toCanvas;
  const lingerMs = o.lingerMs ?? 8000;
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? (t => clearTimeout(t as ReturnType<typeof setTimeout>));
  const counts = {snapshots: 0, onWorld: 0, created: 0};
  const lost = (gl: GL) => access.backend.isLost(gl);

  /** The snapshot renderer and the context it is bound to. */
  let borrowed: {gl: GL; renderer: SnapshotRenderer} | null = null;
  let utility: {canvas: HTMLCanvasElement; gl: GL} | null = null,
    linger: unknown;

  const drop = () => {
    const b = borrowed;
    borrowed = null;
    if (b)
      try {
        b.renderer.dispose();
      } catch {
        /* lost */
      }
  };
  const retireUtility = () => {
    clearTimer(linger);
    linger = undefined;
    const u = utility;
    if (!u) return;
    if (borrowed?.gl === u.gl) drop();
    utility = null;
    access.stats.contexts = Math.max(0, access.stats.contexts - 1);
    if (!lost(u.gl)) access.backend.lose(u.gl);
  };
  const access = pool.attachUtility({
    worldChanged() {
      // Let go of the world context before it changes hands; a world is about to exist, so the utility goes too.
      if (borrowed && borrowed.gl !== utility?.gl) drop();
      retireUtility();
    },
  });
  const make = access.make as (canvas: HTMLCanvasElement, gl: GL) => SnapshotRenderer;

  /** The renderer to draw with, and the scene renderer to resync afterwards. */
  const borrow = (): {r: SnapshotRenderer; leased: PoolRenderer | null} | null => {
    const world = access.world();
    if (world && !world.lost && !lost(world.gl)) {
      retireUtility();
      if (borrowed?.gl !== world.gl) {
        drop();
        borrowed = {gl: world.gl, renderer: make(world.canvas, world.gl)};
      }
      counts.onWorld++;
      return {r: borrowed.renderer, leased: world.leased ? (world.renderer ?? null) : null};
    }
    if (utility && lost(utility.gl)) retireUtility();
    if (!utility) {
      utility = createContext();
      counts.created++;
      access.stats.created++;
      access.stats.contexts++;
    }
    clearTimer(linger);
    linger = setTimer(retireUtility, lingerMs);
    if (borrowed?.gl !== utility.gl) {
      drop();
      borrowed = {gl: utility.gl, renderer: make(utility.canvas, utility.gl)};
    }
    return {r: borrowed.renderer, leased: null};
  };

  const canvas = (size: SnapshotSize, draw: SnapshotDraw): HTMLCanvasElement | null => {
    let got: ReturnType<typeof borrow>;
    try {
      got = borrow();
    } catch {
      return null;
    }
    if (!got) return null;
    const {r, leased} = got;
    const x = r as T.WebGLRenderer;
    let target: T.WebGLRenderTarget | null = null;
    try {
      // Another renderer (the scene's) drew on this context since: start from known GL state and three's defaults.
      r.resetState();
      x.toneMapping = T.NoToneMapping;
      x.toneMappingExposure = 1;
      x.outputColorSpace = T.SRGBColorSpace;
      if (x.shadowMap) x.shadowMap.enabled = false;
      x.localClippingEnabled = false;
      x.autoClear = true;
      target = createTarget(size);
      r.setRenderTarget(target);
      r.setClearColor(0x000000, 0);
      r.clear();
      draw(x, target);
      const pixels = new Uint8Array(size.width * size.height * 4);
      r.readRenderTargetPixels(target, 0, 0, size.width, size.height, pixels);
      counts.snapshots++;
      return output(pixels, size);
    } catch {
      return null;
    } finally {
      try {
        r.setRenderTarget(null);
        target?.dispose();
        r.resetState();
      } catch {
        /* lost */
      }
      // The scene's renderer cached GL state this renderer changed: resync it (and its viewport and scissor).
      if (leased)
        try {
          leased.resetState();
          (leased as Partial<T.WebGLRenderer>).setRenderTarget?.(null);
        } catch {
          /* lost */
        }
    }
  };

  return {
    canvas,
    snapshot(size, draw) {
      const c = canvas(size, draw);
      return c ? createImageBitmap(c) : Promise.reject(Error('The picture could not be drawn (WebGL unavailable).'));
    },
    stats: () => ({...counts, contexts: utility ? 1 : 0}),
  };
}

let installed: Snapshots | null = null;
/** The app's snapshots, on the app's renderer pool. */
export function appSnapshots(): Snapshots {
  return (installed ??= createSnapshots(appRenderers()));
}
/** Draw a picture now on the app's pool (`pool.snapshot`, synchronous form). Null when WebGL cannot start. */
export function snapshotCanvas(size: SnapshotSize, draw: SnapshotDraw): HTMLCanvasElement | null {
  return appSnapshots().canvas(size, draw);
}

/**
 * The snapshot queue's pacing: `fn` runs in the next frame of the app's frame loop (a batch of pictures is drawn one
 * per frame, so a long batch never holds a frame up). Returns a cancel.
 */
export function nextSnapshotFrame(fn: () => void): () => void {
  const t = appLoop().add({
    owner: anonymousOwner('pool-snapshot-queue'),
    mode: 'continuous',
    whenCovered: 'run',
    update() {
      t.remove();
      fn();
    },
  });
  return () => t.remove();
}
