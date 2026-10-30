// Real engine composition for the material options browser regression (shading, side, cutout, vertex colours, Material
// on Mesh and Model); not shipped by a template. Instruments draws, programs and three.js disposal before the app boots;
// reads only public author data and probes. The 'before' and 'after' scenes port a corner of a night courtyard (built
// by a creator's agent with the public API) once with only the options that existed before, once with the new ones.
import * as T from 'three';
import '../../../src/app/styles.ts';
import {createApp} from '../../../src/core/app.ts';
import {appBus} from '../../../src/core/app-events.ts';
import {appFeatures} from '../../../src/core/settings/app-features.ts';
import {layerModules} from '../../../src/app/layer-modules.ts';
import {compileGame} from '../../../src/author/compile.ts';
import {
  defineBuild,
  defineGame,
  defineScene,
  defineSystem,
  defineAsset,
  defineEnvironment,
  defineMaterial,
  defineMesh,
  projectToView,
  Material,
  Model,
  Name,
  Transform,
  Shape,
} from '../../../src/author/index.ts';

const disposed = new Set();
for (const Kind of [T.Material, T.Texture]) {
  const original = Kind.prototype.dispose;
  Kind.prototype.dispose = function () {
    disposed.add(this.uuid);
    return original.call(this);
  };
}
let renders = 0,
  programs = 0,
  calls = 0,
  drawn = [];
const describe = m => ({
  uuid: m.uuid,
  type: m.type,
  emissive: m.emissive?.getHex() ?? null,
  emissiveIntensity: m.emissiveIntensity ?? null,
  flatShading: !!m.flatShading,
  side: m.side,
  alphaTest: m.alphaTest,
  vertexColors: m.vertexColors,
  transparent: m.transparent,
  map: m.map?.uuid ?? null,
  gradient: m.gradientMap ? {uuid: m.gradientMap.uuid, steps: m.gradientMap.image.width} : null,
  shared: !!m.userData?.shared,
});
const originalAfterRender = T.Scene.prototype.onAfterRender;
T.Scene.prototype.onAfterRender = function (renderer, ...rest) {
  const meshes = [];
  this.traverse(node => {
    if (!node.isMesh || node.isInstancedMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    // Entity meshes hang off the scene; a model's parts sit under its instance root.
    meshes.push({name: node.name, model: node.parent !== this, materials: materials.map(describe)});
  });
  drawn = meshes;
  renders++;
  programs = renderer.info.programs?.length ?? 0;
  calls = renderer.info.render.calls;
  return originalAfterRender.call(this, renderer, ...rest);
};

const brief = defineBuild({
  goal: 'Exercise material options.',
  genre: 'diagnostic',
  pitch: 'Toon, flat, matte, double-sided and cut-out surfaces on shapes, meshes and models.',
  coreLoop: ['Look', 'Change', 'Leave'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']},
  success: [
    {
      id: 'S1',
      check: 'Material options draw as declared, swap class once and release on exit',
      how: 'playtest',
      by: 'scripts/play/material-options-check.mjs',
    },
  ],
});
const game = defineGame({
  id: 'material-options-check',
  version: '0.1.0',
  title: 'Material options diagnostic',
  firstScene: 'options',
});
const asset = (id, url, size) =>
  defineAsset({
    id,
    type: 'texture',
    url,
    width: size,
    height: size,
    licence: 'CC0-1.0',
    author: 'Foundation Engine contributors',
    source: 'scripts/play/material-options-check.mjs (generated in memory)',
  });
const halves = asset('halves', '/textures/check/halves.png', 32);
const leaf = asset('leaf', '/textures/check/leaf.png', 64);
const beacon = defineAsset({
  id: 'lab-beacon',
  type: 'model',
  url: '/models/mechanics/beacon.glb',
  licence: 'CC0-1.0',
  author: 'Foundation Engine contributors',
  source: 'templates/mechanics/game/tools/generate-fixture.mjs',
});

/** An octahedron gem, `r` across, optionally with a colour per vertex. */
const gem = (r, h, colors, color = 0xffffff) =>
  defineMesh({
    color,
    positions: [0, h, 0, r, 0, 0, 0, 0, r, -r, 0, 0, 0, 0, -r, 0, -h, 0],
    indices: [0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 1, 4, 5, 1, 2, 5, 2, 3, 5, 3, 4, 5, 4, 1],
    ...(colors ? {colors} : {}),
  });
const ROCK = [0.42, 0.4, 0.38, 0.55, 0.52, 0.48, 0.3, 0.29, 0.28, 0.5, 0.47, 0.42, 0.36, 0.35, 0.33, 0.25, 0.24, 0.23];

let context;
const idle = defineSystem({id: 'idle', phase: 'frame', run() {}});
const enter = ctx => {
  context = ctx;
};

const BACK = -1.5,
  FRONT = 1.8;
// Only a key light, no ambient: toon bands show as flat steps (ambient light is smooth under every shading).
const keyOnly = defineEnvironment({
  background: 0x18202a,
  ambient: {sky: 0xffffff, ground: 0xffffff, intensity: 0},
  directional: {color: 0xffffff, intensity: 2.5, position: [-8, 3, 1]},
  haze: {color: 0x18202a, near: 100, far: 200},
  points: [],
  pointSize: 1,
});
const options = defineScene({
  id: 'options',
  title: 'Options',
  view: {camera: {position: [0, 6, 7], target: [0, 0, 0]}, background: 0x18202a, environment: keyOnly},
  entities: [
    [
      Name({name: 'smooth'}),
      Transform({x: -4.4, z: BACK}),
      Shape({kind: 'sphere', size: [1.6, 1.6, 1.6], color: 0xffffff}),
    ],
    [
      Name({name: 'toon'}),
      Transform({x: -2.2, z: BACK}),
      Shape({kind: 'sphere', size: [1.6, 1.6, 1.6], color: 0xffffff}),
      defineMaterial({shading: 'toon', toonSteps: 3}),
    ],
    [Name({name: 'gem-plain'}), Transform({x: 0, z: BACK}), gem(0.8, 1.1, null, 0x303030)],
    [
      Name({name: 'gem'}),
      Transform({x: 2.2, z: BACK}),
      gem(0.8, 1.1, null, 0x303030),
      defineMaterial({shading: 'flat', emissive: 0xff6a10, emissiveIntensity: 2}),
    ],
    [Name({name: 'beacon'}), Transform({x: 4.4, y: 0.2, z: BACK, scale: 2}), Model({asset: 'lab-beacon'})],
    [
      Name({name: 'back-single'}),
      Transform({x: -4, y: 0.5, z: FRONT, rx: Math.PI}),
      Shape({kind: 'plane', size: [1.4, 0, 1.4], color: 0x7ad06a}),
      defineMaterial({}),
    ],
    [
      Name({name: 'back-double'}),
      Transform({x: -2, y: 0.5, z: FRONT, rx: Math.PI}),
      Shape({kind: 'plane', size: [1.4, 0, 1.4], color: 0x7ad06a}),
      defineMaterial({side: 'double'}),
    ],
    [
      Name({name: 'cutout'}),
      Transform({x: 0, y: 0.5, z: FRONT}),
      Shape({kind: 'plane', size: [1.6, 0, 1.6], color: 0xffffff}),
      defineMaterial({texture: 'halves', wrap: 'clamp', alphaCutoff: 0.5, roughness: 1}),
    ],
    [
      Name({name: 'rock'}),
      Transform({x: 2, y: 0.3, z: FRONT}),
      gem(0.7, 0.5, ROCK),
      defineMaterial({shading: 'flat', roughness: 0.95}),
    ],
    [
      Name({name: 'beacon-glow'}),
      Transform({x: 4, y: 0.2, z: FRONT, scale: 2}),
      Model({asset: 'lab-beacon'}),
      defineMaterial({shading: 'toon', emissive: 0x00ff66, emissiveIntensity: 1.5}),
    ],
  ],
  systems: [idle],
  enter,
});

// ---- The courtyard corner, ported from a creator's trial game (before: only the options that existed).
const dusk = defineEnvironment({
  background: 0x070b1a,
  ambient: {sky: 0x4a5a8b, ground: 0x2a1c10, intensity: 1.1},
  directional: {color: 0xc8d4ff, intensity: 1.8, position: [-6, 12, 6]},
  haze: {color: 0x0a1024, near: 12, far: 34},
  points: [],
  pointSize: 2,
});
const WARM = 0xffb04a;
const corner = after => {
  const tree = (x, z, s) => [
    [
      Transform({x, y: 0.7 * s, z}),
      Shape({kind: 'cylinder', size: [0.35 * s, 1.4 * s, 0.35 * s], color: 0x6b4630}),
      ...(after ? [defineMaterial({shading: 'matte'})] : []),
    ],
    [
      Transform({x, y: 2.2 * s, z}),
      Shape({kind: 'cone', size: [2.2 * s, 2.6 * s, 2.2 * s], color: 0x2f6b3a}),
      ...(after ? [defineMaterial({shading: 'toon', toonSteps: 3})] : []),
    ],
    [
      Transform({x, y: 3.3 * s, z}),
      Shape({kind: 'cone', size: [1.6 * s, 2 * s, 1.6 * s], color: 0x3b8048}),
      ...(after ? [defineMaterial({shading: 'toon', toonSteps: 3})] : []),
    ],
  ];
  const lantern = (x, z) => [
    [
      Transform({x, y: 1.1, z}),
      Shape({kind: 'cylinder', size: [0.14, 2.2, 0.14], color: 0x1c1f26}),
      defineMaterial({metalness: 0.8, roughness: 0.4}),
    ],
    [
      Transform({x, y: 2.45, z}),
      Shape({kind: 'box', size: [0.42, 0.5, 0.42], color: 0xffd28a}),
      defineMaterial({emissive: WARM, emissiveIntensity: 2, roughness: 0.2}),
    ],
    [
      Transform({x, y: 2.8, z}),
      Shape({kind: 'cone', size: [0.6, 0.3, 0.6], color: 0x1c1f26}),
      defineMaterial({metalness: 0.8, roughness: 0.4, ...(after ? {shading: 'flat'} : {})}),
    ],
  ];
  // Collectible embers: before, spheres (a custom Mesh ignored Material, so a gem could not glow); after, glowing gems.
  const ember = (x, z) =>
    after
      ? [
          Transform({x, y: 0.9, z}),
          gem(0.22, 0.34, null, 0x40281a),
          defineMaterial({shading: 'flat', emissive: 0xff7a1a, emissiveIntensity: 2.5, roughness: 0.3}),
        ]
      : [
          Transform({x, y: 0.9, z}),
          Shape({kind: 'sphere', size: [0.32, 0.32, 0.32], color: 0xfff0c0}),
          defineMaterial({emissive: 0xff7a1a, emissiveIntensity: 2.5}),
        ];
  // Fern fronds: before, the leaf texture needs a sorted transparent quad that vanishes from behind; after, a cut-out
  // drawn from both sides with no sorting.
  const frond = (x, z, ry, tilt) => [
    Transform({x, y: 0.35, z, ry, rx: tilt}),
    Shape({kind: 'plane', size: [0.9, 0, 1.3], color: 0xffffff}),
    defineMaterial(after ? {texture: 'leaf', alphaCutoff: 0.5, side: 'double'} : {texture: 'leaf', transparent: true}),
  ];
  const fern = (x, z) => [0, 1.3, 2.6, 3.9, 5.2].map((ry, i) => frond(x, z, ry, i % 2 ? 1.1 : -1.1));
  const rock = (x, z, s) =>
    after
      ? [Transform({x, y: 0.2 * s, z, scale: s}), gem(0.6, 0.45, ROCK), defineMaterial({shading: 'flat', roughness: 1})]
      : [Transform({x, y: 0.2 * s, z, scale: s}), gem(0.6, 0.45, ROCK)];
  return [
    [
      Transform(),
      Shape({kind: 'plane', size: [14, 0, 14], color: 0x5a564f}),
      defineMaterial({roughness: 0.9, ...(after ? {shading: 'matte'} : {})}),
    ],
    [
      Transform({y: 1.6, z: -5}),
      Shape({kind: 'box', size: [14, 3.2, 0.6], color: 0x8a7a6e}),
      defineMaterial({roughness: 0.95}),
    ],
    ...tree(-3.6, -2.6, 1),
    ...tree(3.4, -3, 1.1),
    ...lantern(-1.2, -1.2),
    ...lantern(1.6, 1.4),
    ember(-0.4, 1.2),
    ember(0.9, -0.6),
    ember(2.6, 0.4),
    ...fern(-2.6, 1.4),
    ...fern(3.6, 1.8),
    rock(-1.6, 2.6, 1.2),
    rock(1.2, 3.2, 0.8),
    [
      Transform({x: -0.4, y: 0.7, z: 0.2}),
      Shape({kind: 'capsule', size: [0.6, 1.2, 0.6], color: 0x2f6fb3}),
      defineMaterial(after ? {shading: 'toon', toonSteps: 4} : {roughness: 0.6}),
    ],
    [
      Transform({x: 4.6, y: 0.3, z: -0.6, scale: 1.6}),
      Model({asset: 'lab-beacon'}),
      ...(after ? [defineMaterial({shading: 'toon', emissive: 0x2a6bff, emissiveIntensity: 1.2})] : []),
    ],
  ];
};
const look = id =>
  defineScene({
    id,
    title: id,
    view: {camera: {position: [0, 6.5, 9], target: [0, 0.8, 0], fov: 50}, background: 0x070b1a, environment: dusk},
    entities: corner(id === 'after'),
    systems: [idle],
    enter,
  });
const other = defineScene({id: 'other', title: 'Other', enter});

const compiled = compileGame({
  brief,
  game,
  defs: [options, look('before'), look('after'), other, halves, leaf, beacon],
});
const app = createApp([...layerModules(game, brief), ...compiled.modules], {
  mode: 'test',
  events: appBus,
  flag: id => appFeatures().enabled(id),
  probes: true,
});
const boot = app.boot();
const positions = {
  smooth: [-4.4, 0, BACK],
  toon: [-2.2, 0, BACK],
  'gem-plain': [0, 0.15, BACK],
  gem: [2.2, 0.15, BACK],
  'back-single': [-4, 0.5, FRONT],
  'back-double': [-2, 0.5, FRONT],
  'cutout-left': [-0.4, 0.5, FRONT],
  'cutout-right': [0.4, 0.5, FRONT],
};
window.materialOptions = {
  boot: () => boot.then(() => true),
  snapshot: () => ({
    renders,
    programs,
    calls,
    drawn,
    disposed: [...disposed],
    scene: app.probes.read('world')?.scene ?? null,
  }),
  /** Where a named probe point appears, in normalised device coordinates. */
  project: name => projectToView(context.view, positions[name]),
  /** Give the toon sphere another shading class. */
  shade: shading => {
    const e = context.named('toon');
    context.world.get(e, Material).shading = shading;
    context.world.touch();
  },
  goto: id => context.scene.goto(id),
};
