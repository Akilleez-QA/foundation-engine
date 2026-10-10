/**
 * platform/render/backends/webgl/post.ts: the WebGL2 post pipeline (GLSL), a lazy chunk (owner `platform.render.post`; ADR 0078).
 *
 * Draws a `PostPlan` (settings.ts) on one world renderer: the scene into a half-float target, an optional bloom chain
 * at half resolution, then one combined pass (bloom, tone map, grade, vignette, sRGB) into the canvas. Hand-written
 * rather than three's EffectComposer and UnrealBloomPass: fewer draws (10 at `full`, 1 at `basic`), fewer targets, and
 * a smaller chunk. The tone mapping is the renderer's own (`renderer.toneMapping` and exposure, set from the scene's
 * output profile): three injects it into the combined pass, which is drawn to the canvas, so `off`, `basic` and `full`
 * map tones identically.
 *
 * Lifetime (STD-REN-33/34): one pipeline per scene visit, owned by the visit and disposed on exit. Targets are
 * allocated on the first draw and reallocated only when the drawing-buffer size or the sample count changes (a resize
 * or a pixel-ratio change), never per frame. Context loss: three forgets its GPU objects and re-creates them on next
 * use; the pipeline keeps its CPU-side objects and needs nothing else. Nothing here runs unless the scene draws.
 *
 * Measurement: the pipeline brackets its work for the bench's page probe (scripts/perf/probe-inject.mjs) through
 * `globalThis.__engineRenderPhase(gl, phase)`: 'scene' (the scene's own draws, into the scene target, still count as
 * scene draws), 'post' (fullscreen passes: `postDraws`), 'end'. The bench and the gate measure production builds, so
 * the bracket is in every build; only the bench's init script defines the hook, so on a player's page it is three
 * property reads per composed frame and nothing else.
 */
import * as T from 'three';
import {bloomSizes, BLOOM_MIPS, postDrawsOf, postTargetBytes, type PostPlan} from '../../post/settings';
import {lutBytes, parseCubeLut, type CubeLut} from '../../post/lut';

/** The `.cube` reader, here so the scene seam loads it with the chunk rather than in every game's first load. */
export {parseCubeLut};

/**
 * What the scene runtime drives. A WebGPU implementation provides the same surface. `lut` is the parsed table of
 * `plan.grade.lut` once it has loaded; without it (still loading, failed, or none asked for) no table is applied.
 */
export interface PostPipeline {
  /** Draw `scene` through `plan` into the canvas. */
  render(scene: T.Object3D, camera: T.Camera, plan: PostPlan, lut?: CubeLut | null): void;
  /** Compile the scene's target variant and the plan's passes before the first draw (STD-REN-37). */
  compile(scene: T.Object3D, camera: T.Camera, plan: PostPlan, lut?: CubeLut | null): void;
  stats(): PostPipelineStats;
  dispose(): void;
}
export interface PostPipelineStats {
  /** Bytes the current targets hold (0 before the first draw). */
  targetBytes: number;
  /** Target (re)allocations: 1 after the first draw, +1 per size or sample change. */
  allocations: number;
  /** Bytes the lookup table's 3D texture holds (0 without one). */
  lutBytes: number;
  width: number;
  height: number;
  samples: number;
  /** Frames drawn through the pipeline and the post draws they issued. */
  frames: number;
  draws: number;
}

/** Why this context cannot run post (null when it can): rendering to a half-float target needs a float colour buffer. */
export function postUnsupported(renderer: Pick<T.WebGLRenderer, 'extensions'>): string | null {
  return renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float')
    ? null
    : 'post: this context cannot render to a half-float target (no EXT_color_buffer_float)';
}

type Phase = 'scene' | 'post' | 'end';
type PhaseHook = (gl: WebGL2RenderingContext, phase: Phase) => void;
const phase = (gl: WebGL2RenderingContext, p: Phase) => {
  const hook = (globalThis as {__engineRenderPhase?: PhaseHook}).__engineRenderPhase;
  if (typeof hook !== 'function') return;
  try {
    hook(gl, p);
  } catch {
    /* Measurement never breaks a frame. */
  }
};

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
// Four bilinear taps one texel apart: a 4x4 box filter, used to step down a level.
const BOX = /* glsl */ `
vec3 box4(sampler2D src, vec2 uv, vec2 texel) {
  vec4 o = texel.xyxy * vec4(-1.0, -1.0, 1.0, 1.0);
  return 0.25 * (texture2D(src, uv + o.xy).rgb + texture2D(src, uv + o.zy).rgb + texture2D(src, uv + o.xw).rgb +
    texture2D(src, uv + o.zw).rgb);
}`;
// The HDR ceiling (opt-in, the CEILING define): a NaN pixel goes black, an infinite channel is clipped, and a pixel brighter
// than the ceiling is scaled down to it with its hue kept. Applied to every tap before it is averaged, so one
// over-range pixel cannot spread into a bright disc.
const CEIL = /* glsl */ `
uniform float ceiling;
vec3 hdrCeiling(vec3 v) {
  if (any(isnan(v))) return vec3(0.0);
  v = max(v, vec3(0.0));
  if (any(isinf(v))) return min(v, vec3(ceiling));
  float peak = max(v.r, max(v.g, v.b));
  return peak > ceiling ? v * (ceiling / peak) : v;
}
#define TAP(src, uv) hdrCeiling(texture2D(src, uv).rgb)`;
const TAP = /* glsl */ `
#ifndef CEILING
#define TAP(src, uv) texture2D(src, uv).rgb
#endif`;
const PREFILTER = /* glsl */ `
uniform sampler2D src;
uniform vec2 texel;
uniform float threshold;
varying vec2 vUv;
#ifdef CEILING
${CEIL}
#endif
${TAP}
vec3 box4t(sampler2D src, vec2 uv, vec2 texel) {
  vec4 o = texel.xyxy * vec4(-1.0, -1.0, 1.0, 1.0);
  return 0.25 * (TAP(src, uv + o.xy) + TAP(src, uv + o.zy) + TAP(src, uv + o.xw) + TAP(src, uv + o.zw));
}
void main() {
  vec3 c = min(box4t(src, vUv, texel), vec3(256.0));
  float b = max(c.r, max(c.g, c.b));
  float knee = max(threshold * 0.5, 1e-4);
  float soft = clamp(b - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  gl_FragColor = vec4(c * (max(soft, b - threshold) / max(b, 1e-4)), 1.0);
}`;
const DOWN = /* glsl */ `
uniform sampler2D src;
uniform vec2 texel;
varying vec2 vUv;
${BOX}
void main() { gl_FragColor = vec4(box4(src, vUv, texel), 1.0); }`;
// A 3x3 tent from the smaller level, added onto the larger one (additive blending) with the spread weight.
const UP = /* glsl */ `
uniform sampler2D src;
uniform vec2 texel;
uniform float weight;
varying vec2 vUv;
void main() {
  vec4 d = texel.xyxy * vec4(1.0, 1.0, -1.0, 0.0);
  vec3 s = texture2D(src, vUv - d.xy).rgb + 2.0 * texture2D(src, vUv - d.wy).rgb + texture2D(src, vUv - d.zy).rgb +
    2.0 * texture2D(src, vUv + d.zw).rgb + 4.0 * texture2D(src, vUv).rgb + 2.0 * texture2D(src, vUv + d.xw).rgb +
    texture2D(src, vUv + d.zy).rgb + 2.0 * texture2D(src, vUv + d.wy).rgb + texture2D(src, vUv + d.xy).rgb;
  gl_FragColor = vec4(s * (weight / 16.0), 1.0);
}`;
// The combined pass, drawn into the canvas: three adds `toneMapping()` (the renderer's mapping and exposure) and
// `linearToOutputTexel()` (the renderer's output colour space) to a ShaderMaterial's prefix there.
const COMBINE = /* glsl */ `
uniform sampler2D scene;
uniform sampler2D bloom;
uniform float strength;
uniform float vignette;
uniform vec3 lift;
uniform vec3 gain;
uniform float saturation;
#ifdef LUT
uniform sampler3D lut;
uniform vec2 lutMap;
uniform float lutStrength;
#endif
varying vec2 vUv;
#ifdef CEILING
${CEIL}
#endif
${TAP}
void main() {
  vec3 c = TAP(scene, vUv);
#ifdef BLOOM
  c += texture2D(bloom, vUv).rgb * strength;
#endif
#ifdef TONE_MAPPING
  c = toneMapping(c);
#endif
  // Grade and vignette on the display-referred (sRGB) picture, where lift and gain read as they do in an editor.
  vec3 g = sRGBTransferOETF(vec4(clamp(c, 0.0, 1.0), 1.0)).rgb;
  g = g * gain + lift * (1.0 - g);
  g = mix(vec3(dot(g, vec3(0.2126, 0.7152, 0.0722))), g, saturation);
#ifdef LUT
  // Lattice centres: 0 maps to the first texel's centre and 1 to the last's (lutMap = [(N - 1) / N, 0.5 / N]).
  vec3 graded = texture(lut, clamp(g, 0.0, 1.0) * lutMap.x + lutMap.y).rgb;
  g = mix(g, graded, lutStrength);
#endif
  g *= 1.0 - vignette * smoothstep(0.35, 1.0, length(vUv - 0.5) * 1.41421356);
  gl_FragColor = vec4(sRGBTransferEOTF(vec4(clamp(g, 0.0, 1.0), 1.0)).rgb, 1.0);
  #include <colorspace_fragment>
}`;

const pass = (fragmentShader: string, uniforms: Record<string, T.IUniform>, extra: T.ShaderMaterialParameters = {}) =>
  new T.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    blending: T.NoBlending,
    ...extra,
  });

/** A target the pipeline draws into: linear, half-float, clamped, never mipmapped. */
const target = (w: number, h: number, depth: boolean, samples: number) => {
  const t = new T.WebGLRenderTarget(w, h, {
    type: T.HalfFloatType,
    format: T.RGBAFormat,
    minFilter: T.LinearFilter,
    magFilter: T.LinearFilter,
    depthBuffer: depth,
    stencilBuffer: false,
    generateMipmaps: false,
    samples,
  });
  t.texture.colorSpace = T.LinearSRGBColorSpace;
  return t;
};

/**
 * One visit's pipeline on `renderer`. `samples` is read per draw (the `resolution.antialias` knob: 4 when on, 0 off,
 * capped by the context), so a change reallocates once.
 */
export function createWebGLPost(renderer: T.WebGLRenderer, options: {samples(): number}): PostPipeline {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const prefilterUniforms = () => ({
    src: {value: null},
    texel: {value: new T.Vector2()},
    threshold: {value: 1},
    ceiling: {value: 65504},
  });
  const down = pass(DOWN, {src: {value: null}, texel: {value: new T.Vector2()}});
  const up = pass(
    UP,
    {src: {value: null}, texel: {value: new T.Vector2()}, weight: {value: 1}},
    {blending: T.CustomBlending, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendEquation: T.AddEquation},
  );
  const combineUniforms = () => ({
    scene: {value: null},
    bloom: {value: null},
    strength: {value: 0},
    vignette: {value: 0},
    lift: {value: new T.Vector3()},
    gain: {value: new T.Vector3(1, 1, 1)},
    saturation: {value: 1},
    ceiling: {value: 65504},
    lut: {value: null},
    lutMap: {value: new T.Vector2(1, 0)},
    lutStrength: {value: 0},
  });
  const materials: T.ShaderMaterial[] = [];
  const variants = new Map<string, T.ShaderMaterial>();
  /**
   * The threshold and combined passes, one material per define set, made on first use and kept for the visit (at
   * most 2 threshold and 8 combined variants; each is one program). `bloom`, `lut` and `ceiling` are the defines.
   */
  const variant = (kind: 'prefilter' | 'combine', bloom: boolean, lut: boolean, ceiling: boolean) => {
    const key = `${kind}:${+bloom}${+lut}${+ceiling}`;
    let m = variants.get(key);
    if (!m) {
      const defines: Record<string, number> = {};
      if (bloom) defines.BLOOM = 1;
      if (lut) defines.LUT = 1;
      if (ceiling) defines.CEILING = 1;
      m =
        kind === 'prefilter'
          ? pass(PREFILTER, prefilterUniforms(), {defines})
          : pass(COMBINE, combineUniforms(), {defines});
      variants.set(key, m);
      materials.push(m);
    }
    return m;
  };
  variant('prefilter', false, false, false);
  materials.push(down, up);
  variant('combine', false, false, false);
  variant('combine', true, false, false);
  const quad = new T.Mesh(geometry, materials[0]);
  quad.frustumCulled = false;
  const camera = new T.Camera();
  const gl = renderer.getContext() as WebGL2RenderingContext;
  let scene: T.WebGLRenderTarget | null = null,
    mips: T.WebGLRenderTarget[] = [],
    size = {width: 0, height: 0, samples: -1, bloom: false},
    allocations = 0,
    frames = 0,
    draws = 0,
    disposed = false;
  const size2 = new T.Vector2();
  let lutTexture: T.Data3DTexture | null = null,
    lutSource: CubeLut | null = null;
  /** The table's 3D texture: made once per table, released when the plan stops asking for it or the table changes. */
  const ensureLut = (plan: PostPlan, lut: CubeLut | null | undefined): T.Data3DTexture | null => {
    const want = plan.grade.lut && lut ? lut : null;
    if (want === lutSource) return lutTexture;
    lutTexture?.dispose();
    lutTexture = null;
    lutSource = want;
    if (!want) return null;
    const n = want.size,
      count = n * n * n,
      half = new Uint16Array(count * 4),
      one = T.DataUtils.toHalfFloat(1);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 3; c++)
        half[i * 4 + c] = T.DataUtils.toHalfFloat(Math.max(-65504, Math.min(65504, want.data[i * 3 + c]!)));
      half[i * 4 + 3] = one;
    }
    const t = new T.Data3DTexture(half, n, n, n);
    t.format = T.RGBAFormat;
    t.type = T.HalfFloatType;
    t.minFilter = T.LinearFilter;
    t.magFilter = T.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = T.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.unpackAlignment = 1;
    t.colorSpace = T.NoColorSpace;
    t.needsUpdate = true;
    lutTexture = t;
    return t;
  };

  const release = () => {
    scene?.dispose();
    scene = null;
    for (const m of mips) m.dispose();
    mips = [];
  };
  /** Targets for the current drawing buffer; reallocated only when its size, the samples or the bloom need change. */
  const ensure = (plan: PostPlan) => {
    renderer.getDrawingBufferSize(size2);
    const width = Math.max(1, size2.x),
      height = Math.max(1, size2.y),
      samples = Math.max(0, Math.min(options.samples(), renderer.capabilities.maxSamples)),
      bloom = !!plan.bloom;
    if (scene && size.width === width && size.height === height && size.samples === samples && size.bloom === bloom)
      return;
    if (!scene || size.width !== width || size.height !== height || size.samples !== samples) {
      scene?.dispose();
      scene = target(width, height, true, samples);
    }
    if (bloom !== mips.length > 0 || size.width !== width || size.height !== height) {
      for (const m of mips) m.dispose();
      mips = bloom ? bloomSizes(width, height).map(([w, h]) => target(w, h, false, 0)) : [];
    }
    size = {width, height, samples, bloom};
    allocations++;
  };
  const draw = (material: T.ShaderMaterial, into: T.WebGLRenderTarget | null) => {
    quad.material = material;
    renderer.setRenderTarget(into);
    renderer.render(quad, camera);
  };
  const texel = (m: T.ShaderMaterial, t: T.WebGLRenderTarget) =>
    (m.uniforms.texel!.value as T.Vector2).set(1 / t.width, 1 / t.height);
  const configure = (plan: PostPlan, lut: CubeLut | null | undefined) => {
    const table = ensureLut(plan, lut),
      ceiling = plan.ceiling !== null,
      c = variant('combine', !!plan.bloom, !!table, ceiling),
      prefilter = variant('prefilter', false, false, ceiling),
      u = c.uniforms;
    u.ceiling!.value = plan.ceiling ?? 65504;
    prefilter.uniforms.ceiling!.value = plan.ceiling ?? 65504;
    if (table && plan.grade.lut) {
      const n = table.image.width;
      u.lut!.value = table;
      (u.lutMap!.value as T.Vector2).set((n - 1) / n, 0.5 / n);
      u.lutStrength!.value = plan.grade.lut.strength;
    } else u.lut!.value = null;
    u.scene!.value = scene!.texture;
    u.vignette!.value = plan.vignette.amount;
    (u.lift!.value as T.Vector3).set(...plan.grade.lift);
    (u.gain!.value as T.Vector3).set(...plan.grade.gain);
    u.saturation!.value = plan.grade.saturation;
    if (plan.bloom) {
      // Normalised by the spread weights' sum, so `strength` means the same at every radius.
      const weight = 0.25 + 0.75 * plan.bloom.radius;
      let total = 0;
      for (let i = 0; i < BLOOM_MIPS; i++) total += weight ** i;
      u.bloom!.value = mips[0]!.texture;
      u.strength!.value = plan.bloom.strength / total;
      prefilter.uniforms.threshold!.value = plan.bloom.threshold;
      up.uniforms.weight!.value = weight;
    }
    return {combined: c, prefilter};
  };
  const guarded = (body: () => void) => {
    const before = renderer.getRenderTarget(),
      autoClear = renderer.autoClear;
    try {
      body();
    } finally {
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(before);
    }
  };

  return {
    render(three, view, plan, lut) {
      if (disposed) throw Error('post: pipeline disposed');
      ensure(plan);
      const {combined, prefilter} = configure(plan, lut),
        sceneTarget = scene!;
      guarded(() => {
        renderer.setRenderTarget(sceneTarget);
        phase(gl, 'scene');
        try {
          renderer.render(three, view);
          phase(gl, 'post');
          renderer.autoClear = false;
          if (plan.bloom) {
            prefilter.uniforms.src!.value = sceneTarget.texture;
            texel(prefilter, sceneTarget);
            draw(prefilter, mips[0]!);
            for (let i = 1; i < mips.length; i++) {
              down.uniforms.src!.value = mips[i - 1]!.texture;
              texel(down, mips[i - 1]!);
              draw(down, mips[i]!);
            }
            for (let i = mips.length - 2; i >= 0; i--) {
              up.uniforms.src!.value = mips[i + 1]!.texture;
              texel(up, mips[i + 1]!);
              draw(up, mips[i]!);
            }
          }
          draw(combined, null);
        } finally {
          phase(gl, 'end');
        }
      });
      frames++;
      draws += postDrawsOf(plan);
    },
    compile(three, view, plan, lut) {
      if (disposed) throw Error('post: pipeline disposed');
      ensure(plan);
      const {combined, prefilter} = configure(plan, lut);
      guarded(() => {
        // Programs depend on the target: the scene into a linear target has no tone mapping; the combined pass does.
        renderer.setRenderTarget(scene);
        renderer.compile(three, view);
        if (plan.bloom)
          for (const m of [prefilter, down, up]) {
            quad.material = m;
            renderer.compile(quad, camera);
          }
        renderer.setRenderTarget(null);
        quad.material = combined;
        renderer.compile(quad, camera);
      });
    },
    stats: () => ({
      targetBytes: scene ? postTargetBytes(size.bloom, size.width, size.height, size.samples) : 0,
      allocations,
      lutBytes: lutSource ? lutBytes(lutSource.size) : 0,
      width: size.width,
      height: size.height,
      samples: Math.max(0, size.samples),
      frames,
      draws,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      const table = () => {
        lutTexture?.dispose();
        lutTexture = null;
        lutSource = null;
      };
      for (const step of [release, table, () => geometry.dispose(), ...materials.map(m => () => m.dispose())])
        try {
          step();
        } catch (error) {
          errors.push(error);
        }
      if (errors.length) throw new AggregateError(errors, 'post: cleanup failed');
    },
  };
}
