// RES-01 native oracle: the texture library's residency policy against an actual WebGL2 renderer.
// Each method runs in its own browser task; loss and restoration are asynchronous browser events.
import * as T from 'three';
import {createTextureLibrary, keepWidth, textureBytes} from '../../../src/platform/assets/textures.ts';
import {assetIdOfKey} from '../../../src/platform/assets/residency.ts';

const SIZES = {hero: [256, 256], rock: [512, 512], odd: [300, 200]};
const canvas = document.createElement('canvas');
canvas.width = canvas.height = 64;
document.body.append(canvas);
const renderer = new T.WebGLRenderer({canvas, preserveDrawingBuffer: true});
const gl = renderer.getContext();
const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.z = 2;
const scene = new T.Scene();
const events = [];
canvas.addEventListener('webglcontextlost', () => events.push('lost'));
canvas.addEventListener('webglcontextrestored', () => events.push('restored'));
const loseExt = gl.getExtension('WEBGL_lose_context');
const pressure = [];
const library = createTextureLibrary({
  def: id =>
    SIZES[id] && {
      id,
      kind: 'texture',
      title: id,
      licence: 'original',
      provenance: {},
      colorSpace: 'srgb',
      variants: [{path: `${id}.png`, format: 'png', width: SIZES[id][0], height: SIZES[id][1]}],
    },
  loadImage: async (_url, _signal, hint) => {
    const source = document.createElement('canvas');
    source.width = hint.width;
    source.height = hint.height;
    const c = source.getContext('2d');
    c.fillStyle = '#ff0000';
    c.fillRect(0, 0, source.width, source.height);
    return createImageBitmap(source, {
      imageOrientation: 'flipY',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
  },
  residency: {
    warmBytes: 0,
    residentBytes: 8 * 1024 * 1024,
    pinned: key => assetIdOfKey(key) === 'hero',
    onPressure: r => pressure.push(r),
  },
});
let visit = new AbortController();
let held = [];
/** Exact bytes three uploads for an RGBA8 texture with a full mip chain (WebGL2 mipmaps NPOT too). */
const exact = (w, h) => {
  let n = 0;
  for (;;) {
    n += w * h * 4;
    if (w === 1 && h === 1) return n;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
};
const pixel = () => {
  const p = new Uint8Array(4);
  gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
  return [...p];
};
const draw = textures => {
  scene.clear();
  textures.forEach((t, i) => {
    const m = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({map: t}));
    m.position.z = i * 0.01;
    scene.add(m);
  });
  renderer.render(scene, camera);
  const result = {memory: {...renderer.info.memory}, pixel: pixel()};
  // Keep three's own geometries/materials out of the comparison: only library textures stay.
  scene.traverse(o => {
    if (o.isMesh) {
      o.geometry.dispose();
      o.material.dispose();
    }
  });
  scene.clear();
  return result;
};
const snapshot = () => ({
  events: [...events],
  stats: library.stats(),
  pressure: [...pressure],
  memory: {...renderer.info.memory},
  lost: gl.isContextLost(),
});
window.residencyCheck = {
  snapshot,
  async setup() {
    held = await Promise.all(
      Object.keys(SIZES).map(id => library.texture(id, {screenPx: keepWidth(SIZES[id][0]), signal: visit.signal})),
    );
    const drawn = draw(held.map(l => l.value));
    const estimates = held.map(l => {
      const [w, h] = SIZES[l.id];
      return {
        id: l.id,
        width: w,
        height: h,
        estimate: textureBytes(l.value),
        exact: exact(w, h),
        ratio: textureBytes(l.value) / exact(w, h),
      };
    });
    return {
      drawn,
      estimates,
      liveTextures: held.length,
      renderer: (() => {
        const i = gl.getExtension('WEBGL_debug_renderer_info');
        return i ? gl.getParameter(i.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      })(),
    };
  },
  exit() {
    visit.abort();
    visit = new AbortController();
    held = [];
    renderer.render(scene, camera); // an empty frame after the scene's leases are released
    return {
      memory: {...renderer.info.memory},
      stats: library.stats(),
      heroBytes: textureBytes({image: {width: 256, height: 256}}),
    };
  },
  async reacquire() {
    held = [await library.texture('hero', {screenPx: keepWidth(256), signal: visit.signal})];
    return {...draw([held[0].value]), stats: library.stats()};
  },
  lose() {
    loseExt.loseContext();
  },
  restore() {
    if (!events.includes('lost')) throw Error('loss pending');
    loseExt.restoreContext();
  },
  afterRestore() {
    if (!events.includes('restored')) throw Error('restore pending');
    return {...draw([held[0].value]), stats: library.stats()};
  },
  teardown() {
    const texture = held[0]?.value;
    visit.abort();
    held = [];
    library.setResidency({warmBytes: 0});
    const result = {owned: texture ? library.owns(texture) : null, stats: library.stats()};
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    return result;
  },
};
