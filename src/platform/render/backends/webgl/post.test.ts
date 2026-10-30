import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {createWebGLPost, postUnsupported} from './post';
import {postPlan, resolvePost, type PostPlan} from '../../post/settings';
import {cubeLutText, parseCubeLut} from '../../post/lut';

/** A renderer stand-in: records each draw's target and material; no GPU. */
function fakeRenderer(o: {width?: number; height?: number; maxSamples?: number} = {}) {
  const size = {width: o.width ?? 1280, height: o.height ?? 800};
  const draws: {into: string; what: string; autoClear: boolean}[] = [],
    compiled: {into: string; what: string}[] = [];
  let current: T.WebGLRenderTarget | null = null;
  const nameOf = (t: T.WebGLRenderTarget | null) => (t ? `${t.width}x${t.height}` : 'canvas');
  const whatOf = (scene: T.Object3D) =>
    scene instanceof T.Mesh ? `pass:${(scene.material as T.ShaderMaterial).fragmentShader.length}` : 'scene';
  // A WebGLRenderer prototype with only what the pipeline reads and records.
  const renderer: T.WebGLRenderer = Object.assign(Object.create(T.WebGLRenderer.prototype), {
    autoClear: true,
    capabilities: {maxSamples: o.maxSamples ?? 4},
    getContext: () => ({}),
    getDrawingBufferSize: (v: T.Vector2) => v.set(size.width, size.height),
    getRenderTarget: () => current,
    setRenderTarget(t: T.WebGLRenderTarget | null) {
      current = t;
    },
    render(scene: T.Object3D) {
      draws.push({into: nameOf(current), what: whatOf(scene), autoClear: renderer.autoClear});
    },
    compile(scene: T.Object3D) {
      compiled.push({into: nameOf(current), what: whatOf(scene)});
    },
  });
  return {renderer, draws, compiled, size};
}
const plan = (mode: 'basic' | 'full', settings = {}) => postPlan(resolvePost(settings), mode) as PostPlan;
const scene = new T.Scene(),
  camera = new T.PerspectiveCamera();

test('basic draws the scene into its target and one combined pass into the canvas', () => {
  const f = fakeRenderer();
  const post = createWebGLPost(f.renderer, {samples: () => 4});
  post.render(scene, camera, plan('basic', {vignette: {amount: 0.3}}));
  assert.deepEqual(
    f.draws.map(d => [d.into, d.what === 'scene' ? 'scene' : 'pass']),
    [
      ['1280x800', 'scene'],
      ['canvas', 'pass'],
    ],
  );
  assert.equal(f.draws[0]!.autoClear, true, 'the scene target is cleared like the canvas');
  assert.equal(f.draws[1]!.autoClear, false, 'a fullscreen pass needs no clear');
  assert.equal(f.renderer.autoClear, true, 'renderer state restored');
  assert.equal(f.renderer.getRenderTarget(), null);
  const s = post.stats();
  assert.deepEqual([s.frames, s.draws, s.allocations, s.samples], [1, 1, 1, 4]);
  assert.equal(s.targetBytes, 1280 * 800 * (8 + 4 * 12));
  post.dispose();
});

test('full adds a threshold pass, 4 downsamples and 4 additive upsamples at half resolution: 10 post draws', () => {
  const f = fakeRenderer();
  const post = createWebGLPost(f.renderer, {samples: () => 0});
  post.render(scene, camera, plan('full', {bloom: {strength: 1, threshold: 0.8, radius: 0.5}}));
  assert.deepEqual(
    f.draws.map(d => d.into),
    ['1280x800', '640x400', '320x200', '160x100', '80x50', '40x25', '80x50', '160x100', '320x200', '640x400', 'canvas'],
  );
  assert.equal(post.stats().draws, 10);
  post.dispose();
});

test('targets are allocated once and reallocated only when the size or the samples change', () => {
  const f = fakeRenderer();
  let samples = 4;
  const post = createWebGLPost(f.renderer, {samples: () => samples});
  const p = plan('full');
  for (let i = 0; i < 5; i++) post.render(scene, camera, p);
  assert.equal(post.stats().allocations, 1, 'no per-frame allocation');
  f.size.width = 640;
  post.render(scene, camera, p);
  assert.equal(post.stats().allocations, 2, 'a resize reallocates once');
  assert.equal(post.stats().width, 640);
  samples = 0;
  post.render(scene, camera, p);
  post.render(scene, camera, p);
  assert.equal(post.stats().allocations, 3, 'antialias off reallocates once');
  assert.equal(post.stats().samples, 0);
  samples = 16;
  post.render(scene, camera, p);
  assert.equal(post.stats().samples, 4, 'capped by the context');
  post.dispose();
});

test('compile prepares the scene for its target and every pass of the plan', () => {
  const f = fakeRenderer();
  const post = createWebGLPost(f.renderer, {samples: () => 0});
  post.compile(scene, camera, plan('full'));
  assert.deepEqual(
    f.compiled.map(c => [c.into, c.what === 'scene' ? 'scene' : 'pass']),
    [
      ['1280x800', 'scene'],
      ['1280x800', 'pass'],
      ['1280x800', 'pass'],
      ['1280x800', 'pass'],
      ['canvas', 'pass'],
    ],
  );
  assert.equal(f.draws.length, 0, 'compiling draws nothing');
  post.dispose();
});

test('dispose releases every target, material and the geometry, once; a disposed pipeline refuses to draw', () => {
  const f = fakeRenderer();
  const disposed: string[] = [];
  const restore = [T.WebGLRenderTarget, T.ShaderMaterial, T.BufferGeometry].map(C => {
    const original = C.prototype.dispose;
    C.prototype.dispose = function (this: {dispose(): void}) {
      disposed.push(C.name);
      return original.call(this);
    };
    return () => {
      C.prototype.dispose = original;
    };
  });
  try {
    const post = createWebGLPost(f.renderer, {samples: () => 0});
    post.render(scene, camera, plan('full'));
    post.dispose();
    post.dispose();
    const count = (name: string) => disposed.filter(d => d === name).length;
    assert.equal(count('WebGLRenderTarget'), 6, 'the scene target and 5 bloom mips');
    assert.equal(count('ShaderMaterial'), 5);
    assert.equal(count('BufferGeometry'), 1);
    assert.throws(() => post.render(scene, camera, plan('basic')), /disposed/);
  } finally {
    for (const r of restore) r();
  }
});

test('an error inside a pass restores the renderer state; the measurement hook brackets scene and post draws', () => {
  const f = fakeRenderer();
  const phases: string[] = [];
  const g = globalThis as {__engineRenderPhase?: (gl: unknown, phase: string) => void};
  g.__engineRenderPhase = (_gl, phase) => phases.push(phase);
  try {
    const post = createWebGLPost(f.renderer, {samples: () => 0});
    post.render(scene, camera, plan('basic'));
    assert.deepEqual(phases, ['scene', 'post', 'end']);
    const render = f.renderer.render.bind(f.renderer);
    let calls = 0;
    f.renderer.render = (s: T.Object3D, c: T.Camera) => {
      if (++calls === 2) throw Error('pass failed');
      render(s, c);
    };
    assert.throws(() => post.render(scene, camera, plan('basic')), /pass failed/);
    assert.equal(f.renderer.getRenderTarget(), null);
    assert.equal(f.renderer.autoClear, true);
    assert.deepEqual(phases.slice(3), ['scene', 'post', 'end'], 'the bracket closes on failure');
    post.dispose();
  } finally {
    delete g.__engineRenderPhase;
  }
});

test('a context without a float colour buffer is refused with a reason', () => {
  const has = (names: string[]) =>
    ({extensions: {has: (n: string) => names.includes(n)}}) as Pick<T.WebGLRenderer, 'extensions'>;
  assert.equal(postUnsupported(has(['EXT_color_buffer_float'])), null);
  assert.equal(postUnsupported(has(['EXT_color_buffer_half_float'])), null);
  assert.match(postUnsupported(has([]))!, /half-float/);
});

/** The defines and uniforms of each fullscreen pass drawn, in order. */
function passes(f: ReturnType<typeof fakeRenderer>) {
  const seen: {defines: Record<string, unknown>; uniforms: Record<string, T.IUniform>}[] = [];
  const render = f.renderer.render.bind(f.renderer);
  f.renderer.render = (s: T.Object3D, c: T.Camera) => {
    if (s instanceof T.Mesh) {
      const m = s.material as T.ShaderMaterial;
      seen.push({defines: {...m.defines}, uniforms: m.uniforms});
    }
    render(s, c);
  };
  return seen;
}

test('a lookup table draws in the same combined pass: one 3D texture per table, released when no longer asked for', () => {
  const f = fakeRenderer();
  const seen = passes(f);
  const post = createWebGLPost(f.renderer, {samples: () => 0});
  const lut = parseCubeLut(cubeLutText((r, g, b) => [b, g, r], {size: 5}));
  const withLut = plan('basic', {grade: {lut: {file: 'luts/a.cube', strength: 0.75}}});
  post.render(scene, camera, withLut, null);
  assert.equal(seen.at(-1)!.defines.LUT, undefined, 'not loaded yet: no table');
  post.render(scene, camera, withLut, lut);
  const u = seen.at(-1)!.uniforms;
  assert.equal(seen.at(-1)!.defines.LUT, 1);
  assert.equal(post.stats().draws, 2, 'still one post draw per frame');
  const texture = u.lut!.value as T.Data3DTexture;
  assert.ok(texture instanceof T.Data3DTexture);
  assert.deepEqual([texture.image.width, texture.image.depth, texture.type], [5, 5, T.HalfFloatType]);
  assert.equal(u.lutStrength!.value, 0.75);
  assert.deepEqual((u.lutMap!.value as T.Vector2).toArray(), [4 / 5, 0.5 / 5]);
  assert.equal(post.stats().lutBytes, 5 ** 3 * 8);
  let disposed = 0;
  texture.addEventListener('dispose', () => disposed++);
  post.render(scene, camera, withLut, lut);
  assert.equal(seen.at(-1)!.uniforms.lut!.value, texture, 'the same table keeps its texture');
  post.render(scene, camera, plan('basic'), lut);
  assert.equal(seen.at(-1)!.defines.LUT, undefined, 'the plan no longer asks for it');
  assert.equal(disposed, 1);
  assert.equal(post.stats().lutBytes, 0);
  post.render(scene, camera, withLut, lut);
  const again = seen.at(-1)!.uniforms.lut!.value as T.Data3DTexture;
  let disposedAgain = 0;
  again.addEventListener('dispose', () => disposedAgain++);
  post.dispose();
  assert.equal(disposedAgain, 1, 'dispose releases the table texture');
});

test('the HDR ceiling switches the threshold and combined passes to their clamped variants', () => {
  const f = fakeRenderer();
  const seen = passes(f);
  const post = createWebGLPost(f.renderer, {samples: () => 0});
  post.render(scene, camera, plan('full', {ceiling: 24}));
  assert.equal(seen.length, 10);
  assert.equal(seen[0]!.defines.CEILING, 1, 'the threshold pass clamps each tap');
  assert.equal(seen[0]!.uniforms.ceiling!.value, 24);
  assert.deepEqual(seen.at(-1)!.defines, {BLOOM: 1, CEILING: 1});
  assert.equal(seen.at(-1)!.uniforms.ceiling!.value, 24);
  post.render(scene, camera, plan('full'));
  assert.equal(seen[10]!.defines.CEILING, undefined, 'without a ceiling the passes are unchanged');
  assert.deepEqual(seen.at(-1)!.defines, {BLOOM: 1});
  post.dispose();
});
