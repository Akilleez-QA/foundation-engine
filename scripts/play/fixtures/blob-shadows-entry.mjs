// Real engine composition for the blob-shadow browser regression (`npm run test:blob-shadows-browser`); not shipped by
// a template. Capsules on a wide floor under a sun whose shadow box (extent 6) covers only the middle: two capsules
// inside it, five beyond it, and a scene cap of four blobs. The twin scene is the same layout without blob shadows,
// so the difference in draws and triangles is the blobs' own cost. Instruments draws, triangles and disposal before
// the app boots; reads only public author data and the dev scene handle.
import * as T from 'three';
import '../../../src/app/styles.ts';
import {createApp} from '../../../src/core/app.ts';
import {appBus} from '../../../src/core/app-events.ts';
import {appFeatures} from '../../../src/core/settings/app-features.ts';
import {layerModules} from '../../../src/app/layer-modules.ts';
import {compileGame} from '../../../src/author/compile.ts';
import {
  BlobShadow,
  defineBuild,
  defineEnvironment,
  defineGame,
  defineScene,
  defineSystem,
  Name,
  sceneBlobShadows,
  sceneShadows,
  Shape,
  Transform,
} from '../../../src/author/index.ts';

let renders = 0,
  last = {calls: 0, triangles: 0},
  blobMesh = null,
  casters = 0,
  blobDisposed = 0;
const originalAfterRender = T.Scene.prototype.onAfterRender;
T.Scene.prototype.onAfterRender = function (renderer, ...rest) {
  renders++;
  last = {calls: renderer.info.render.calls, triangles: renderer.info.render.triangles};
  let found = null,
    casting = 0;
  this.traverse(o => {
    if (o.isMesh && o.castShadow) casting++;
    if (o.isInstancedMesh && o.name === 'blob-shadows') found = o;
  });
  blobMesh = found;
  casters = casting;
  return originalAfterRender.call(this, renderer, ...rest);
};
const originalDispose = T.InstancedMesh.prototype.dispose;
T.InstancedMesh.prototype.dispose = function () {
  if (this.name === 'blob-shadows') blobDisposed++;
  return originalDispose.call(this);
};

const brief = defineBuild({
  goal: 'Exercise blob shadows.',
  genre: 'diagnostic',
  pitch: 'Soft ground ellipses where the sun shadow does not reach.',
  coreLoop: ['Look', 'Move', 'Leave'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']},
  success: [
    {
      id: 'S1',
      check: 'Blob shadows cost one draw, stand in only beyond real shadows, upload only on change and release on exit',
      how: 'playtest',
      by: 'scripts/play/blob-shadows-check.mjs',
    },
  ],
});
const game = defineGame({
  id: 'blob-shadows-check',
  version: '0.1.0',
  title: 'Blob shadows diagnostic',
  firstScene: 'blobs',
});
const env = defineEnvironment({
  background: 0x18202a,
  ambient: {sky: 0xc8d8ff, ground: 0x404040, intensity: 0.9},
  directional: {color: 0xfff1d6, intensity: 2.2, position: [-6, 12, -4], shadow: {extent: 6}},
  haze: {color: 0x18202a, near: 25, far: 70},
  points: [],
  pointSize: 1,
});
const capsule = (name, x, z) => [
  Name({name}),
  Transform({x, y: 0.9, z}),
  Shape({kind: 'capsule', size: [0.6, 1.8, 0.6], color: 0x9b6a3c}),
  BlobShadow({width: 0.9, depth: 0.7, opacity: 0.6}),
];
const layout = [
  [Name({name: 'floor'}), Transform(), Shape({kind: 'plane', size: [40, 0, 40], color: 0xb8b2a8})],
  // Inside the sun's box: real shadows, no blobs.
  capsule('in-a', -1, 0),
  capsule('in-b', 1, 1),
  // Beyond it: blobs (five, over the cap of four: the farthest from the camera is dropped).
  capsule('far-a', 10, 0),
  capsule('far-b', -10, 0),
  capsule('far-c', 12, 3),
  capsule('far-d', -13, -6),
  capsule('far-e', 15, -12),
];
let context;
const idle = defineSystem({id: 'idle', phase: 'frame', run() {}});
const scene = (id, blobs) =>
  defineScene({
    id,
    title: id,
    shadows: sceneShadows(),
    ...(blobs ? {blobShadows: sceneBlobShadows({max: 4})} : {}),
    view: {camera: {position: [0, 12, 18], target: [0, 0, 0], fov: 55}, background: 0x18202a, environment: env},
    // The twin draws the same bodies; its BlobShadow components are stripped so nothing is reported there.
    entities: blobs ? layout : layout.map(row => row.filter(init => init.type !== BlobShadow)),
    systems: [idle],
    enter(ctx) {
      context = ctx;
    },
  });
const blobs = scene('blobs', true),
  twin = scene('twin', false);
const compiled = compileGame({brief, game, defs: [blobs, twin]});
const app = createApp([...layerModules(game, brief), ...compiled.modules], {
  mode: 'test',
  events: appBus,
  flag: id => appFeatures().enabled(id),
  probes: true,
});
const boot = app.boot();
window.blobShadowsCheck = {
  boot: () => boot.then(() => true),
  snapshot: () => ({
    renders,
    last,
    casters,
    blobDisposed,
    blobMesh: blobMesh ? {count: blobMesh.count, castShadow: blobMesh.castShadow, visible: blobMesh.visible} : null,
    scene: app.probes.read('world')?.scene ?? null,
    blobs: app.services.play.current()?.blobShadows?.() ?? null,
  }),
  redraw: () => app.services.play.current()?.redraw?.() ?? false,
  move: (name, x) => {
    context.world.get(context.named(name), Transform).x = x;
    context.world.touch();
  },
  shadowQuality: value => app.services.quality.setKnob('shadows.quality', value),
  goto: id => context.scene.goto(id),
};
