// The KTX2 browser check's page (scripts/play/ktx2-model-check.mjs): one unlit quad textured through
// KHR_texture_basisu, drawn by the engine's model path, plus test-only instrumentation:
// - `?scene=plain` opens a scene with a model that has no KTX2 image (the laziness phase);
// - `?fallback=1` hides every compressed-texture WebGL extension before boot, so the transcoder must fall back to RGBA8;
// - transcoder workers (three's WorkerPool, blob: scripts) are counted, and while a hold is armed each transcode reply is
//   withheld until released, so a cancellation can land after the transcode but before the model attaches (#116);
// - every dispose is remembered by identity, and each parse result's textures are recorded.
import '../../../src/app/styles.ts';
import {createApp} from '../../../src/core/app.ts';
import {appFeatures} from '../../../src/core/settings/app-features.ts';
import {layerModules} from '../../../src/app/layer-modules.ts';
import {compileGame} from '../../../src/author/compile.ts';
import {
  defineBuild,
  defineGame,
  defineScene,
  defineSystem,
  defineAsset,
  Name,
  Transform,
  Model,
} from '../../../src/author/index.ts';
import {BufferGeometry, Material, Texture} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const params = new URLSearchParams(location.search);
const COMPRESSED = /compressed_texture|texture_compression/i;
if (params.has('fallback'))
  for (const ctor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    const get = ctor.prototype.getExtension,
      list = ctor.prototype.getSupportedExtensions;
    ctor.prototype.getExtension = function (name) {
      return COMPRESSED.test(name) ? null : get.call(this, name);
    };
    ctor.prototype.getSupportedExtensions = function () {
      return (list.call(this) ?? []).filter(name => !COMPRESSED.test(name));
    };
  }

const disposed = new WeakSet();
for (const proto of [BufferGeometry.prototype, Material.prototype, Texture.prototype]) {
  const dispose = proto.dispose;
  proto.dispose = function () {
    disposed.add(this);
    return dispose.call(this);
  };
}

// Transcoder workers: KTX2Loader starts them from a blob: script. Count them and hold their replies on request.
const hold = {armed: false, held: []},
  workers = [];
{
  const Native = window.Worker;
  window.Worker = class extends Native {
    constructor(url, options) {
      super(url, options);
      this.__row = String(url).startsWith('blob:') ? {terminated: false} : null;
      if (this.__row) workers.push(this.__row);
    }
    addEventListener(type, listener, options) {
      if (type !== 'message' || !this.__row) return super.addEventListener(type, listener, options);
      return super.addEventListener(
        type,
        event => {
          if (hold.armed && event.data?.type === 'transcode') hold.held.push(() => listener.call(this, event));
          else listener.call(this, event);
        },
        options,
      );
    }
    terminate() {
      if (this.__row) this.__row.terminated = true;
      return super.terminate();
    }
  };
}

// Parse results: the textures each parse produced (with their GPU format and level bytes), per cycle label.
const parsed = [];
let label = 'initial';
{
  const parseAsync = GLTFLoader.prototype.parseAsync;
  GLTFLoader.prototype.parseAsync = async function (...args) {
    const at = label,
      result = await parseAsync.apply(this, args),
      textures = new Set(),
      resources = new Set();
    result.scene.traverse(node => {
      if (node.geometry) resources.add(node.geometry);
      for (const material of [node.material ?? []].flat()) {
        resources.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    for (const texture of textures) resources.add(texture);
    parsed.push({label: at, textures: [...textures], resources: [...resources]});
    return result;
  };
}
const describe = texture => ({
  compressed: texture.isCompressedTexture === true,
  format: texture.format,
  type: texture.type,
  width: texture.image?.width ?? 0,
  height: texture.image?.height ?? 0,
  levels: texture.mipmaps?.length ?? 0,
  bytes: (texture.mipmaps ?? []).reduce((n, level) => n + (level.data?.byteLength ?? 0), 0),
});

const brief = defineBuild({
  goal: 'Draw a KTX2-textured model through the engine model path.',
  genre: 'diagnostic',
  pitch: 'KTX2 model textures.',
  coreLoop: ['Load', 'Draw', 'Dispose'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']},
  success: [
    {
      id: 'S1',
      check: 'A KTX2 model draws, counts compressed bytes and disposes cleanly.',
      how: 'playtest',
      by: 'scripts/play/ktx2-model-check.mjs',
    },
  ],
});
const firstScene = params.get('scene') === 'plain' ? 'plain' : 'sample';
const game = defineGame({id: 'ktx2-model', version: '0.1.0', title: 'KTX2 model', firstScene});
const assets = ['quad', 'quad-b', 'plain'].map(id =>
  defineAsset({
    id,
    type: 'model',
    url: `/__ktx2/${id}.glb`,
    licence: 'CC0-1.0',
    author: 'Foundation Engine contributors',
    source: id === 'plain' ? 'templates/mechanics/game/tools/generate-fixture.mjs' : 'src/testing/ktx2-fixture.ts',
  }),
);
let ctx,
  accepted = null,
  candidate = null;
// A frame system keeps the scene on continuous frames, so a spawn or despawn is synced without other input.
const tick = defineSystem({id: 'ktx2-tick', phase: 'frame', run() {}});
const view = {camera: {position: [0, 0, 2.2], target: [0, 0, 0], fov: 50}, background: 0x101820};
const sample = defineScene({
  id: 'sample',
  title: 'KTX2 quad',
  view,
  systems: [tick],
  enter(context) {
    ctx = context;
    accepted = ctx.world.spawn(Name({name: 'quad'}), Transform({scale: 2}), Model({asset: 'quad', playing: false}));
  },
  exit() {
    accepted = candidate = null;
  },
});
const plain = defineScene({
  id: 'plain',
  title: 'No KTX2',
  view: {...view, camera: {position: [0, 0.8, 3], target: [0, 0.6, 0], fov: 50}},
  enter(context) {
    ctx = context;
    accepted = ctx.world.spawn(Name({name: 'beacon'}), Transform(), Model({asset: 'plain', playing: false}));
  },
  exit() {
    accepted = null;
  },
});
const compiled = compileGame({brief, game, defs: [sample, plain, tick, ...assets]});
const app = createApp([...layerModules(game, brief), ...compiled.modules], {
  mode: 'test',
  flag: id => appFeatures().enabled(id),
  probes: true,
});
const booted = app.boot();
let models;
const status = e => (e === null || !ctx ? null : ctx.modelState(e).status);
window.ktx2Check = {
  booted: false,
  state: () => ({
    accepted: status(accepted),
    candidate: status(candidate),
    models: models?.stats() ?? null,
    workers: {created: workers.length, live: workers.filter(w => !w.terminated).length},
    held: hold.held.length,
  }),
  /** The first texture of the first parse labelled `at`, described. */
  texture(at = 'initial') {
    const row = parsed.find(p => p.label === at);
    return row?.textures[0] ? describe(row.textures[0]) : null;
  },
  /** How many of the resources the parses labelled `at` produced were disposed, by identity. */
  released(at) {
    const rows = parsed.filter(p => p.label === at),
      all = rows.flatMap(p => p.resources),
      textures = rows.flatMap(p => p.textures);
    return {
      parses: rows.length,
      resources: all.length,
      released: all.filter(r => disposed.has(r)).length,
      textures: textures.length,
      compressed: textures.filter(t => t.isCompressedTexture).length,
    };
  },
  arm(at) {
    label = at;
    hold.armed = true;
  },
  release() {
    hold.armed = false;
    for (const deliver of hold.held.splice(0)) deliver();
  },
  spawnCandidate() {
    candidate = ctx.world.spawn(Name({name: 'candidate'}), Transform({x: 3}), Model({asset: 'quad-b', playing: false}));
    ctx.world.touch();
  },
  cancelCandidate() {
    ctx.world.despawn(candidate);
    candidate = null;
    ctx.world.touch();
  },
  dispose() {
    app.dispose();
  },
};
await booted;
models = app.services.models;
window.ktx2Check.booted = true;
