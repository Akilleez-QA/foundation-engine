/**
 * kits/retro/pass.ts: the GPU side of the retro look, installed through `@kits/three`'s render override.
 *
 * Each drawn frame renders the scene to the canvas inside a low-resolution viewport (so tone mapping and output
 * encoding are the engine's own, and the scene pass is the frame's main pass, not an off-screen one), copies that
 * corner into a nearest-filtered texture, then draws one full-screen triangle that applies the ordered dither and
 * quantises to the palette lookup table or to per-channel levels. Cost: one GPU copy of the low-res corner and one
 * extra draw of one triangle; the scene itself is shaded at the low resolution. Everything is owned by the visit.
 */
import type * as THREE from 'three';
import type {ThreeHandle} from '../three/index';
import {
  bayerMatrix,
  buildPaletteLut,
  ditherSize,
  paletteSpread,
  resolveRetroLook,
  retroTargetSize,
  type RetroLook,
  type RetroLookInput,
} from './look';

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
precision highp sampler3D;
uniform sampler2D tScene;
uniform sampler3D tLut;
uniform sampler2D tBayer;
uniform vec2 lowRes;
uniform float ditherN;
uniform float ditherAmount;
uniform float spread;
uniform float levels;
uniform float lutSize;
uniform bool usePalette;
varying vec2 vUv;
void main() {
  // Already tone mapped and display-encoded by the scene pass.
  vec3 s = clamp(texture(tScene, vUv).rgb, 0.0, 1.0);
  float d = 0.0;
  if (ditherN > 0.0) {
    vec2 cell = mod(floor(vUv * lowRes), ditherN);
    d = (texture(tBayer, (cell + 0.5) / ditherN).r * 255.0 + 0.5) / (ditherN * ditherN) - 0.5;
  }
  d *= ditherAmount;
  if (usePalette) {
    vec3 idx = min(vec3(lutSize - 1.0), floor(clamp(s + d * spread, 0.0, 1.0) * (lutSize - 1.0) + 0.5));
    s = texture(tLut, (idx + 0.5) / lutSize).rgb;
  } else {
    float l = levels - 1.0;
    s = clamp(floor(s * l + 0.5 + d) / l, 0.0, 1.0);
  }
  gl_FragColor = vec4(s, 1.0);
}`;

export interface RetroStats {
  readonly width: number;
  readonly height: number;
  /** Bytes of the low-res RGBA8 copy, the LUT and the dither texture (estimates). */
  readonly bytes: number;
}

export interface RetroController {
  /** Change the look (undefined keeps a value; unknown keys throw); rebuilds the LUT only when the palette or its size changed. */
  set(look: {readonly [K in keyof RetroLookInput]?: RetroLookInput[K] | undefined}): void;
  /** Turn the look off (the engine draws normally) or on again. */
  enable(on: boolean): void;
  stats(): RetroStats;
}

/** The renderer calls the look makes. */
export type RetroRenderer = Pick<
  THREE.WebGLRenderer,
  'getPixelRatio' | 'getViewport' | 'setViewport' | 'render' | 'copyFramebufferToTexture' | 'autoClear'
>;
/** What the look draws with each frame (a `ThreeRenderFrame` satisfies it). */
export interface RetroFrame {
  readonly renderer: RetroRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
}
/** The parts of the visit's three.js handle the look uses (a `ThreeHandle` satisfies it). */
export interface RetroHost extends Pick<ThreeHandle, 'THREE' | 'size' | 'requestRender' | 'onResize' | 'own'> {
  setRenderOverride(fn: ((frame: RetroFrame) => void) | null): void;
}

/** Install the retro look on a visit's three.js handle: call it from `sceneThree({ setup })`. */
export function installRetro(three: RetroHost, input: RetroLookInput = {}): RetroController {
  const T = three.THREE;
  let look: RetroLook = resolveRetroLook(input);
  function makeFrameTexture(width: number, height: number): THREE.FramebufferTexture {
    const t = new T.FramebufferTexture(width, height);
    t.minFilter = t.magFilter = T.NearestFilter;
    t.generateMipmaps = false;
    return t;
  }
  let frameTexture: THREE.FramebufferTexture = makeFrameTexture(1, 1);
  // One owner for every replaceable texture: replacements are disposed when replaced, the current ones at visit end.
  three.own({
    dispose: () => {
      frameTexture.dispose();
      lut?.dispose();
      bayer?.dispose();
    },
  });
  let lut: THREE.Data3DTexture | null = null;
  let lutKey = '';
  let bayer: THREE.DataTexture | null = null;
  let bayerN = 0;
  const material = three.own(
    new T.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        tScene: {value: null},
        tLut: {value: null},
        tBayer: {value: null},
        lowRes: {value: new T.Vector2(1, 1)},
        ditherN: {value: 0},
        ditherAmount: {value: 1},
        spread: {value: 1},
        levels: {value: 32},
        lutSize: {value: 32},
        usePalette: {value: false},
      },
    }),
  );
  // One triangle covering the screen.
  const geometry = three.own(new T.BufferGeometry());
  geometry.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quad = new T.Mesh(geometry, material);
  quad.frustumCulled = false;
  const quadScene = new T.Scene();
  quadScene.add(quad);
  const quadCamera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const placeholderLut = () => {
    const t = new T.Data3DTexture(new Uint8Array(4), 1, 1, 1);
    t.needsUpdate = true;
    return t;
  };
  const apply = () => {
    const u = material.uniforms as Record<string, {value: unknown}>;
    // Palette LUT.
    const key = look.palette ? `${look.lutSize}:${look.palette.join(',')}` : '';
    if (key !== lutKey || !lut) {
      lut?.dispose();
      if (look.palette) {
        lut = new T.Data3DTexture(
          buildPaletteLut(look.palette, look.lutSize),
          look.lutSize,
          look.lutSize,
          look.lutSize,
        );
        lut.minFilter = lut.magFilter = T.NearestFilter;
        lut.unpackAlignment = 1;
        lut.needsUpdate = true;
      } else lut = placeholderLut();
      lutKey = key;
    }
    // Dither matrix.
    const n = ditherSize(look.dither);
    if (n !== bayerN) {
      bayer?.dispose();
      bayer = null;
      if (n > 0) {
        const m = bayerMatrix(n as 2 | 4 | 8);
        const data = new Uint8Array(n * n * 4);
        for (let i = 0; i < n * n; i++) data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = m[i]!;
        for (let i = 0; i < n * n; i++) data[i * 4 + 3] = 255;
        bayer = new T.DataTexture(data, n, n);
        bayer.minFilter = bayer.magFilter = T.NearestFilter;
        bayer.needsUpdate = true;
      }
      bayerN = n;
    }
    u.tLut!.value = lut;
    u.tBayer!.value = bayer;
    u.ditherN!.value = n;
    u.ditherAmount!.value = look.ditherAmount;
    u.spread!.value = paletteSpread(look);
    u.levels!.value = look.levels;
    u.lutSize!.value = look.lutSize;
    u.usePalette!.value = look.palette !== null;
    resize();
    three.requestRender();
  };
  let lowW = 1,
    lowH = 1;
  const resize = () => {
    const s = three.size();
    const pixels = {
      w: Math.max(1, Math.floor(s.width * s.pixelRatio)),
      h: Math.max(1, Math.floor(s.height * s.pixelRatio)),
    };
    const t = retroTargetSize(look, pixels.w, pixels.h);
    // The low-res corner must fit inside the drawing buffer.
    lowW = Math.min(t.width, pixels.w);
    lowH = Math.min(t.height, pixels.h);
    if (frameTexture.image.width !== lowW || frameTexture.image.height !== lowH) {
      frameTexture.dispose();
      frameTexture = makeFrameTexture(lowW, lowH);
    }
    material.uniforms.tScene!.value = frameTexture;
    (material.uniforms.lowRes!.value as THREE.Vector2).set(lowW, lowH);
  };
  const full = new T.Vector4();
  const draw = ({renderer, scene, camera}: RetroFrame) => {
    const ratio = renderer.getPixelRatio();
    renderer.getViewport(full);
    const clear = renderer.autoClear;
    try {
      renderer.setViewport(0, 0, lowW / ratio, lowH / ratio);
      renderer.render(scene, camera);
      renderer.copyFramebufferToTexture(frameTexture, origin);
      renderer.setViewport(full);
      renderer.autoClear = false;
      renderer.render(quadScene, quadCamera);
    } finally {
      // A throw anywhere above must not leave the engine drawing into the corner without clearing.
      renderer.setViewport(full);
      renderer.autoClear = clear;
    }
  };
  const origin = new T.Vector2(0, 0);
  three.onResize(resize);
  let enabled = true;
  apply();
  three.setRenderOverride(draw);
  return {
    set(next) {
      if (!next || typeof next !== 'object') throw new TypeError('retro: set takes a look object');
      const known = ['width', 'pixelAspect', 'palette', 'levels', 'dither', 'ditherAmount', 'lutSize'];
      for (const k of Object.keys(next))
        if (!known.includes(k)) throw new RangeError(`retro: unknown look setting ${k}`);
      // `undefined` keeps the current value; `palette: null` switches to levels.
      const merged: Record<string, unknown> = {...look};
      for (const [k, v] of Object.entries(next)) if (v !== undefined) merged[k] = v;
      look = resolveRetroLook(merged as RetroLookInput);
      apply();
    },
    enable(on) {
      if (typeof on !== 'boolean') throw new TypeError('retro: enable takes a boolean');
      if (on === enabled) return;
      enabled = on;
      three.setRenderOverride(on ? draw : null);
      three.requestRender();
    },
    stats() {
      const lutBytes = look.palette ? look.lutSize ** 3 * 4 : 4;
      return Object.freeze({
        width: lowW,
        height: lowH,
        // The RGBA8 copy of the low-res corner, the lookup table and the dither matrix.
        bytes: lowW * lowH * 4 + lutBytes + bayerN * bayerN * 4,
      });
    },
  };
}
