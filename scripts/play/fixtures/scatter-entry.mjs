// Real engine composition for the instanced scatter browser regression; not shipped by a template. Instruments draws,
// triangles and three.js disposal before the app boots; reads only public author data and the dev scene handle. The
// 'before' and 'after' scenes port a night courtyard from a creator's trial game: before, one entity (one draw) per
// lantern part and no ground cover; after, the same lanterns as three point scatters plus grass and rocks.
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
  defineEnvironment,
  defineMaterial,
  defineMesh,
  defineScatter,
  sceneScatter,
  Name,
  Transform,
  Shape,
} from '../../../src/author/index.ts';

let renders = 0,
  last = {calls: 0, triangles: 0},
  instancedDisposed = 0;
const originalAfterRender = T.Scene.prototype.onAfterRender;
T.Scene.prototype.onAfterRender = function (renderer, ...rest) {
  renders++;
  last = {calls: renderer.info.render.calls, triangles: renderer.info.render.triangles};
  return originalAfterRender.call(this, renderer, ...rest);
};
const originalDispose = T.InstancedMesh.prototype.dispose;
T.InstancedMesh.prototype.dispose = function () {
  instancedDisposed++;
  return originalDispose.call(this);
};
let scene3 = null;
const originalRender = T.WebGLRenderer.prototype.render;
T.WebGLRenderer.prototype.render = function (scene, camera) {
  scene3 = scene;
  return originalRender.call(this, scene, camera);
};
/** A small, order-independent fingerprint of every drawn instance buffer (placement determinism across visits). */
const fingerprint = () => {
  const parts = [];
  scene3?.traverse(o => {
    if (!o.isInstancedMesh) return;
    let h = 0;
    const a = o.instanceMatrix.array;
    for (let i = 0; i < a.length; i++) h = (h * 31 + Math.round(a[i] * 1000)) | 0;
    parts.push(`${o.name}:${o.count}:${h}`);
  });
  return parts.sort().join('|');
};

const brief = defineBuild({
  goal: 'Exercise instanced scatter.',
  genre: 'diagnostic',
  pitch: 'Grass, rocks and lantern posts as one draw each.',
  coreLoop: ['Look', 'Change', 'Leave'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']},
  success: [
    {
      id: 'S1',
      check: 'Scatters cost one draw each, honest triangles, thin by preset and release on exit',
      how: 'playtest',
      by: 'scripts/play/scatter-check.mjs',
    },
  ],
});
const game = defineGame({id: 'scatter-check', version: '0.1.0', title: 'Scatter diagnostic', firstScene: 'yard'});

const ROCK = [0.42, 0.4, 0.38, 0.55, 0.52, 0.48, 0.3, 0.29, 0.28, 0.5, 0.47, 0.42, 0.36, 0.35, 0.33, 0.25, 0.24, 0.23];
const rock = defineMesh({
  positions: [0, 0.45, 0, 0.6, 0, 0, 0, 0, 0.6, -0.6, 0, 0, 0, 0, -0.6, 0, -0.2, 0],
  indices: [0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 1, 4, 5, 1, 2, 5, 2, 3, 5, 3, 4, 5, 4, 1],
  colors: ROCK,
}).value;
const LANTERNS = [
  [-9, -9],
  [9, -9],
  [-9, 9],
  [9, 9],
  [-3.5, -3.5],
  [3.5, 3.5],
  [3.5, -3.5],
  [-3.5, 3.5],
];

let context;
const idle = defineSystem({id: 'idle', phase: 'frame', run() {}});
const enter = ctx => {
  context = ctx;
};
const yard = defineScene({
  id: 'yard',
  title: 'Yard',
  scatter: sceneScatter({max: 8, instances: 4000}),
  view: {camera: {position: [0, 14, 16], target: [0, 0, 0]}, background: 0x18202a},
  entities: [
    [Name({name: 'plain'}), Transform({y: 0.5}), Shape({kind: 'box', color: 0x4f8cff})],
    [
      Name({name: 'grass'}),
      Transform(),
      defineScatter({
        shape: {kind: 'cone', size: [0.12, 0.45, 0.12]},
        color: 0x3f7a3c,
        colorJitter: [0.03, 0.1, 0.08],
        area: {kind: 'edge', rect: [-11, -11, 11, 11], width: 2.2},
        count: 1400,
        seed: 3,
        y: 0.2,
        scale: [0.6, 1.5],
        ry: 'random',
        tilt: 0.25,
      }),
    ],
    [
      Name({name: 'rocks'}),
      Transform(),
      defineScatter({
        mesh: rock,
        area: {kind: 'ring', radius: [4, 8]},
        count: 60,
        seed: 4,
        scale: [0.5, 1.4],
        ry: 'random',
      }),
      defineMaterial({shading: 'flat', roughness: 0.95}),
    ],
    [
      Name({name: 'posts'}),
      Transform({y: 1.1}),
      defineScatter({
        shape: {kind: 'cylinder', size: [0.14, 2.2, 0.14]},
        color: 0x1c1f26,
        points: LANTERNS,
        essential: true,
      }),
    ],
  ],
  systems: [idle],
  enter,
});

// ---- The courtyard from the trial game: lanterns, then ground cover.
const night = defineEnvironment({
  background: 0x070b1a,
  ambient: {sky: 0x4a5a8b, ground: 0x2a1c10, intensity: 1.1},
  directional: {color: 0xc8d4ff, intensity: 1.6, position: [-6, 12, 6]},
  haze: {color: 0x0a1024, near: 14, far: 40},
  points: [],
  pointSize: 2,
});
const WARM = 0xffb04a;
const SIZE = 11;
const wall = (x, z, w, d) => [
  Transform({x, y: 1.6, z}),
  Shape({kind: 'box', size: [w, 3.2, d], color: 0x8a7a6e}),
  defineMaterial({roughness: 0.95}),
];
const ground = [
  [
    Transform(),
    Shape({kind: 'plane', size: [2 * SIZE, 0, 2 * SIZE], color: 0x5a564f}),
    defineMaterial({roughness: 0.9}),
  ],
  wall(0, -SIZE, 2 * SIZE, 0.6),
  wall(-SIZE, 0, 0.6, 2 * SIZE),
  wall(SIZE, 0, 0.6, 2 * SIZE),
  [
    Transform({y: 0.3}),
    Shape({kind: 'cylinder', size: [4.2, 0.6, 4.2], color: 0x8d8a86}),
    defineMaterial({roughness: 0.9}),
  ],
];
const lanternParts = [
  {y: 1.1, shape: {kind: 'cylinder', size: [0.14, 2.2, 0.14]}, color: 0x1c1f26, look: {metalness: 0.8, roughness: 0.4}},
  {
    y: 2.45,
    shape: {kind: 'box', size: [0.42, 0.5, 0.42]},
    color: 0xffd28a,
    look: {emissive: WARM, emissiveIntensity: 2},
  },
  {y: 2.8, shape: {kind: 'cone', size: [0.6, 0.3, 0.6]}, color: 0x1c1f26, look: {metalness: 0.8, roughness: 0.4}},
];
const before = defineScene({
  id: 'before',
  title: 'Before',
  view: {camera: {position: [0, 12, 15], target: [0, 0, 0], fov: 50}, background: 0x070b1a, environment: night},
  entities: [
    ...ground,
    ...LANTERNS.flatMap(([x, z]) =>
      lanternParts.map(p => [
        Transform({x, y: p.y, z}),
        Shape({kind: p.shape.kind, size: p.shape.size, color: p.color}),
        defineMaterial(p.look),
      ]),
    ),
  ],
  systems: [idle],
  enter,
});
const after = defineScene({
  id: 'after',
  title: 'After',
  scatter: sceneScatter(),
  view: {camera: {position: [0, 12, 15], target: [0, 0, 0], fov: 50}, background: 0x070b1a, environment: night},
  entities: [
    ...ground,
    ...lanternParts.map((p, i) => [
      Name({name: `lantern-${i}`}),
      Transform({y: p.y}),
      defineScatter({shape: p.shape, color: p.color, points: LANTERNS, essential: true}),
      defineMaterial(p.look),
    ]),
    [
      Name({name: 'grass'}),
      Transform(),
      defineScatter({
        shape: {kind: 'cone', size: [0.12, 0.45, 0.12]},
        color: 0x3f7a3c,
        colorJitter: [0.03, 0.12, 0.1],
        area: {kind: 'edge', rect: [-SIZE + 0.3, -SIZE + 0.3, SIZE - 0.3, SIZE - 0.3], width: 2.2},
        count: 1400,
        seed: 3,
        y: 0.2,
        scale: [0.6, 1.5],
        ry: 'random',
        tilt: 0.25,
      }),
      defineMaterial({shading: 'toon', toonSteps: 3}),
    ],
    [
      Name({name: 'rocks'}),
      Transform(),
      defineScatter({
        mesh: rock,
        area: {kind: 'ring', radius: [3, 6.5]},
        count: 60,
        seed: 4,
        scale: [0.4, 1.2],
        ry: 'random',
        tilt: 0.3,
      }),
      defineMaterial({shading: 'flat', roughness: 1}),
    ],
  ],
  systems: [idle],
  enter,
});
const other = defineScene({id: 'other', title: 'Other', enter});

const compiled = compileGame({brief, game, defs: [yard, before, after, other]});
const app = createApp([...layerModules(game, brief), ...compiled.modules], {
  mode: 'test',
  events: appBus,
  flag: id => appFeatures().enabled(id),
  probes: true,
});
const boot = app.boot();
window.scatterCheck = {
  boot: () => boot.then(() => true),
  snapshot: () => ({
    renders,
    last,
    instancedDisposed,
    scene: app.probes.read('world')?.scene ?? null,
    scatter: app.services.play.current()?.scatter?.() ?? null,
    fingerprint: fingerprint(),
  }),
  /** Move the grass scatter's origin (no rebuild expected). */
  shift: x => {
    const e = context.named('grass');
    context.world.get(e, Transform).x = x;
    context.world.touch();
  },
  goto: id => context.scene.goto(id),
};
