// Real engine composition for the creator-shadows browser regression (`npm run test:shadows-browser`); not shipped by
// a template. A crate and a lantern post on a floor under a shadow-casting sun, plus a lantern point light that asks
// for a shadow; the same layout without shadows for comparison. Instruments draws before the app boots: draws issued
// while a framebuffer is bound are shadow-map (off-screen) draws.
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
  sceneShadows,
  Shadow,
  Shape,
  Transform,
} from '../../../src/author/index.ts';

let renders = 0,
  offscreen = 0,
  lastOffscreen = 0,
  shadowLights = 0,
  inRender = 0;
const bound = new WeakMap();
for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
  const bind = P.bindFramebuffer;
  P.bindFramebuffer = function (target, fb) {
    bound.set(this, !!fb);
    return bind.call(this, target, fb);
  };
  for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const draw = P[f];
    P[f] = function (...a) {
      if (bound.get(this)) {
        offscreen++;
        inRender++;
      }
      return draw.apply(this, a);
    };
  }
}
const before = T.Scene.prototype.onBeforeRender;
T.Scene.prototype.onBeforeRender = function (...args) {
  inRender = 0;
  return before.apply(this, args);
};
const after = T.Scene.prototype.onAfterRender;
T.Scene.prototype.onAfterRender = function (...args) {
  renders++;
  lastOffscreen = inRender;
  let casting = 0;
  this.traverse(n => {
    if (n.isLight && n.castShadow) casting++;
  });
  shadowLights = casting;
  return after.apply(this, args);
};

const brief = defineBuild({
  goal: 'Exercise creator shadows.',
  genre: 'diagnostic',
  pitch: 'A crate and a lamp post casting shadows.',
  coreLoop: ['Look', 'Move', 'Leave'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']},
  success: [
    {
      id: 'S1',
      check: 'Opted-in objects cast shadows that redraw only on change',
      how: 'playtest',
      by: 'scripts/play/shadows-check.mjs',
    },
  ],
});
const game = defineGame({id: 'shadows-check', version: '0.1.0', title: 'Shadows diagnostic', firstScene: 'lit'});
const env = shadow =>
  defineEnvironment({
    background: 0x101820,
    ambient: {sky: 0xc8d8ff, ground: 0x404040, intensity: 0.8},
    directional: {color: 0xfff1d6, intensity: 2.5, position: [-6, 12, -4], ...(shadow ? {shadow: {extent: 8}} : {})},
    haze: null,
    points: [],
    pointSize: 1,
  });
let context;
const idle = defineSystem({id: 'idle', phase: 'frame', run() {}});
const layout = [
  [Name({name: 'floor'}), Transform(), Shape({kind: 'plane', size: [16, 0, 16], color: 0xb8b2a8})],
  [Name({name: 'crate'}), Transform({y: 0.6}), Shape({kind: 'box', size: [1.2, 1.2, 1.2], color: 0x9b6a3c})],
  [
    Name({name: 'post'}),
    Transform({x: -3, y: 1.1, z: 2}),
    Shape({kind: 'cylinder', size: [0.15, 2.2, 0.15], color: 0x22252c}),
  ],
  // Grass that should not darken the floor: a per-entity override of the scene default.
  [
    Name({name: 'tuft'}),
    Transform({x: 3, y: 0.3, z: -2}),
    Shape({kind: 'cone', size: [0.6, 0.6, 0.6], color: 0x2f6b3a}),
    Shadow({cast: false}),
  ],
  [
    Name({name: 'lantern'}),
    Transform({x: -3, y: 2.4, z: 2}),
    PointLight({color: 0xffa850, intensity: 12, distance: 8, shadow: true}),
  ],
];
const view = shadow => ({
  camera: {position: [0, 9, 8], target: [0, 0, 0], fov: 50},
  background: 0x101820,
  environment: env(shadow),
});
const scene = (id, shaded) =>
  defineScene({
    id,
    title: id,
    lights: sceneLights({point: 2}),
    ...(shaded ? {shadows: sceneShadows()} : {}),
    view: view(shaded),
    entities: layout,
    systems: [idle],
    enter(ctx) {
      context = ctx;
    },
  });
const lit = scene('lit', true),
  flat = scene('flat', false);
const compiled = compileGame({brief, game, defs: [lit, flat]});
const app = createApp([...layerModules(game, brief), ...compiled.modules], {
  mode: 'test',
  events: appBus,
  flag: id => appFeatures().enabled(id),
  probes: true,
});
const boot = app.boot();
window.shadowsCheck = {
  boot: () => boot.then(() => true),
  snapshot: () => ({
    renders,
    offscreen,
    lastOffscreen,
    shadowLights,
    scene: app.probes.read('world')?.scene ?? null,
    lights: app.services.play.current()?.lights?.() ?? null,
  }),
  at: (x, z) => {
    const canvas = document.querySelector('.scene-view canvas');
    const r = canvas.getBoundingClientRect(),
      p = projectToView(context.view, [x, 0, z]);
    return {x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height};
  },
  redraw: () => app.services.play.current()?.redraw?.() ?? false,
  move: (name, x) => {
    const tr = context.world.get(context.named(name), Transform);
    tr.x = x;
    context.world.touch();
  },
  goto: id => context.scene.goto(id),
};
