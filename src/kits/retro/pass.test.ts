import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type {ThreeSize} from '../three/index';
import {installRetro, sceneRetro, retro, type RetroFrame, type RetroHost, type RetroRenderer} from './index';

function fakeHandle(size: ThreeSize = {width: 1280, height: 720, pixelRatio: 1}) {
  const owned: {dispose(): void}[] = [];
  const calls: string[] = [];
  let override: ((f: RetroFrame) => void) | null = null;
  let resize: ((s: ThreeSize) => void) | undefined;
  let renders = 0;
  let current = size;
  const handle: RetroHost = {
    THREE,
    size: () => current,
    requestRender: () => void renders++,
    onResize: (fn: (s: ThreeSize) => void) => ((resize = fn), () => {}),
    setRenderOverride: (fn: ((f: RetroFrame) => void) | null) => void (override = fn),
    own: <D extends {dispose(): void}>(d: D) => (owned.push(d), d),
  };
  const viewport = new THREE.Vector4(0, 0, size.width, size.height);
  const renderer: RetroRenderer = {
    autoClear: true,
    getPixelRatio: () => current.pixelRatio,
    getViewport: (v: THREE.Vector4) => v.copy(viewport),
    setViewport(x: number | THREE.Vector4, y?: number, w?: number, h?: number) {
      if (typeof x === 'number') viewport.set(x, y!, w!, h!);
      else viewport.copy(x);
      calls.push(`viewport ${viewport.z * current.pixelRatio}x${viewport.w * current.pixelRatio}`);
    },
    copyFramebufferToTexture: (t: THREE.Texture) => {
      const img = t.image as {width: number; height: number};
      calls.push(`copy ${img.width}x${img.height}`);
    },
    render(s: THREE.Scene) {
      calls.push(
        s.children.length === 1 && (s.children[0] as THREE.Mesh).isMesh
          ? `quad${this.autoClear ? '' : ' (no clear)'}`
          : 'scene',
      );
    },
  };
  const frame = {renderer, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), t: 0, dt: 0, calm: false};
  return {
    handle,
    owned,
    calls,
    draw: () => override?.(frame),
    drawWith: (r: RetroRenderer, scene: THREE.Scene) => override?.({renderer: r, scene, camera: frame.camera}),
    hasOverride: () => override !== null,
    resizeTo: (s: ThreeSize) => ((current = s), resize?.(s)),
    renders: () => renders,
  };
}

test('the override renders the scene at low resolution, then one full-screen triangle to the canvas', () => {
  const f = fakeHandle();
  const c = installRetro(f.handle, {width: 320, pixelAspect: 2});
  f.draw();
  assert.deepEqual(f.calls, [
    'viewport 320x360',
    'scene',
    'copy 320x360',
    'viewport 1280x720',
    'quad (no clear)',
    'viewport 1280x720',
  ]);
  assert.equal(c.stats().width, 320);
  assert.equal(c.stats().height, 360);
  f.resizeTo({width: 1000, height: 1000, pixelRatio: 2});
  assert.equal(c.stats().height, 640, 'the low-res size follows the view aspect');
  f.calls.length = 0;
  f.draw();
  assert.deepEqual(
    f.calls.slice(0, 3),
    ['viewport 320x640', 'scene', 'copy 320x640'],
    'device pixels at pixel ratio 2',
  );
  const tiny = fakeHandle({width: 100, height: 50, pixelRatio: 1});
  const t = installRetro(tiny.handle, {width: 320});
  assert.deepEqual([t.stats().width, t.stats().height], [100, 50], 'never larger than the drawing buffer');
});

test('set() rebuilds the palette table only when the palette changes; enable() hands the draw back; everything is owned', () => {
  const f = fakeHandle();
  const c = installRetro(f.handle, {palette: [0, 0xffffff], lutSize: 16});
  const ownedAfterInstall = f.owned.length;
  let disposedLuts = 0;
  const realDispose = THREE.Data3DTexture.prototype.dispose;
  THREE.Data3DTexture.prototype.dispose = function () {
    disposedLuts++;
    realDispose.call(this);
  };
  try {
    c.set({ditherAmount: 0.5});
    assert.equal(disposedLuts, 0, 'same palette: the table is kept');
    for (let i = 0; i < 20; i++) c.set({palette: [0, 0xff0000 + i, 0xffffff]});
    assert.equal(disposedLuts, 20, 'each replaced table is disposed at once');
  } finally {
    THREE.Data3DTexture.prototype.dispose = realDispose;
  }
  assert.equal(f.owned.length, ownedAfterInstall, 'replacements do not grow the owned list');
  c.set({palette: [0, 0xff0000, 0xffffff], width: undefined});
  assert.equal(c.stats().width, 320, 'undefined keeps the current value');
  assert.throws(() => c.set({pallete: [0, 1]} as never), RangeError, 'unknown settings are refused');
  assert.equal(c.stats().bytes, 320 * 180 * 4 + 16 ** 3 * 4 + 16 * 4);
  c.enable(false);
  assert.equal(f.hasOverride(), false);
  c.enable(true);
  assert.equal(f.hasOverride(), true);
  assert.throws(() => c.set({width: 4}), RangeError);
  assert.equal(c.stats().width, 320, 'a refused change keeps the previous look');
  for (const o of f.owned) o.dispose();
});

test('a throw during the draw restores the viewport and clearing', () => {
  const f = fakeHandle();
  installRetro(f.handle, {width: 320});
  const scene = new THREE.Scene();
  let autoClear = true;
  const viewport = new THREE.Vector4(0, 0, 1280, 720);
  const renderer = {
    get autoClear() {
      return autoClear;
    },
    set autoClear(v: boolean) {
      autoClear = v;
    },
    getPixelRatio: () => 1,
    getViewport: (v: THREE.Vector4) => v.copy(viewport),
    setViewport(x: number | THREE.Vector4, y?: number, w?: number, h?: number) {
      if (typeof x === 'number') viewport.set(x, y!, w!, h!);
      else viewport.copy(x);
    },
    copyFramebufferToTexture() {
      throw new Error('context lost');
    },
    render() {},
  };
  assert.throws(() => f.drawWith(renderer, scene), /context lost/);
  assert.deepEqual(viewport.toArray(), [0, 0, 1280, 720]);
  assert.equal(autoClear, true);
});

test('the kit requires three and sceneRetro refuses a malformed look at definition time', () => {
  assert.deepEqual(retro().requires, ['three']);
  assert.throws(() => sceneRetro({levels: 0}), RangeError);
  assert.ok(sceneRetro({width: 256}));
});
