// Real engine composition for the local-lights browser regression (`npm run test:lights-browser`); not shipped by a
// template. Lantern point lights (from the courtyard trial) and one spot over a dark floor, in a scene with fixed light
// slots. Instruments draws, program links and the lights in the drawn scene before the app boots.
import * as T from 'three';
import '../../../src/app/styles.ts';
import {createApp} from '../../../src/core/app.ts';
import {appBus} from '../../../src/core/app-events.ts';
import {appFeatures} from '../../../src/core/settings/app-features.ts';
import {layerModules} from '../../../src/app/layer-modules.ts';
import {compileGame} from '../../../src/author/compile.ts';
import {
  defineBuild,
  defineEnvironment,
  defineGame,
  defineScene,
  defineSystem,
  Name,
  PointLight,
  projectToView,
  sceneLights,
  Shape,
  SpotLight,
  Transform,
} from '../../../src/author/index.ts';

let renders = 0,
  programs = 0,
  rig = {points: 0, spots: 0, lit: 0};
for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
  const link = P.linkProgram;
  P.linkProgram = function (p) {
    programs++;
    return link.call(this, p);
  };
}
const originalAfterRender = T.Scene.prototype.onAfterRender;
T.Scene.prototype.onAfterRender = function (...args) {
  renders++;
  let points = 0,
    spots = 0,
    lit = 0;
  this.traverse(node => {
    if (node.isPointLight) points++;
    if (node.isSpotLight) spots++;
    if ((node.isPointLight || node.isSpotLight) && node.intensity > 0) lit++;
  });
  rig = {points, spots, lit};
  return originalAfterRender.apply(this, args);
};

const brief = defineBuild({
  goal: 'Exercise local lights.',
  genre: 'diagnostic',
  pitch: 'Lanterns that light the floor around them.',
  coreLoop: ['Look', 'Change', 'Leave'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']},
  success: [
    {
      id: 'S1',
      check: 'Local lights light their surroundings without recompiling programs',
      how: 'playtest',
      by: 'scripts/play/lights-check.mjs',
    },
  ],
});
const game = defineGame({id: 'lights-check', version: '0.1.0', title: 'Lights diagnostic', firstScene: 'lamps'});
const night = defineEnvironment({
  background: 0x070b1a,
  ambient: {sky: 0x2b3a6b, ground: 0x1a1008, intensity: 0.25},
  directional: {color: 0x8ea8ff, intensity: 0.1, position: [-6, 12, -4]},
  haze: null,
  points: [],
  pointSize: 1,
});
let context;
const idle = defineSystem({id: 'idle', phase: 'frame', run() {}});
const lantern = (name, x, z, extra = {}) => [
  Name({name}),
  Transform({x, y: 1.5, z}),
  PointLight({color: 0xffa850, intensity: 12, distance: 6, decay: 2, ...extra}),
];
const lamps = defineScene({
  id: 'lamps',
  title: 'Lamps',
  lights: sceneLights({point: 3, spot: 1}),
  view: {camera: {position: [0, 14, 9], target: [0, 0, 0], fov: 55}, background: night.background, environment: night},
  entities: [
    [Name({name: 'floor'}), Transform(), Shape({kind: 'plane', size: [24, 0, 24], color: 0x9a948c})],
    lantern('lantern-a', -5, 3, {essential: true}),
    lantern('lantern-b', 5, -5),
    lantern('lantern-c', -1, -4),
    [
      Name({name: 'spot'}),
      Transform({x: 0, y: 6, z: -4, rx: -Math.PI / 2}),
      SpotLight({color: 0xbfd4ff, intensity: 40, distance: 12, angle: 0.5, penumbra: 0.4}),
    ],
  ],
  systems: [idle],
  enter(ctx) {
    context = ctx;
  },
});
const other = defineScene({
  id: 'other',
  title: 'Other',
  enter(ctx) {
    context = ctx;
  },
});
const compiled = compileGame({brief, game, defs: [lamps, other]});
const app = createApp([...layerModules(game, brief), ...compiled.modules], {
  mode: 'test',
  events: appBus,
  flag: id => appFeatures().enabled(id),
  probes: true,
});
const boot = app.boot();
window.lightsCheck = {
  boot: () => boot.then(() => true),
  snapshot: () => ({
    renders,
    programs,
    rig,
    scene: app.probes.read('world')?.scene ?? null,
    lights: app.services.play.current()?.lights?.() ?? null,
  }),
  /** Page coordinates of a world point on the floor. */
  at: (x, z) => {
    const canvas = document.querySelector('.scene-view canvas');
    const r = canvas.getBoundingClientRect(),
      p = projectToView(context.view, [x, 0, z]);
    return {x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height};
  },
  spawn: name => {
    context.spawn({kind: 'entity', id: name, components: lantern(name, 5, 3)});
  },
  despawn: name => context.world.despawn(context.named(name)),
  dim: (name, intensity) => {
    context.world.get(context.named(name), PointLight).intensity = intensity;
  },
  goto: id => context.scene.goto(id),
};
