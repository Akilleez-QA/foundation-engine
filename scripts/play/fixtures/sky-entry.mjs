// Real engine composition for the gradient-sky browser regression (`npm run test:sky-browser`); not shipped by a
// template. A dusk gradient sky with a pale disc and stars over a floor, exp2 haze in the horizon colour, a near and a far
// crate; and the same view with a plain background. Instruments draws and texture disposal before the app boots.
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
  Shape,
  skyGradientAt,
  Transform,
} from '../../../src/author/index.ts';

let renders = 0,
  draws = 0,
  lastDraws = 0,
  skyTexture = null;
const disposed = new Set();
const dispose = T.Texture.prototype.dispose;
T.Texture.prototype.dispose = function () {
  disposed.add(this.uuid);
  return dispose.call(this);
};
for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype])
  for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const draw = P[f];
    P[f] = function (...a) {
      draws++;
      return draw.apply(this, a);
    };
  }
const before = T.Scene.prototype.onBeforeRender;
T.Scene.prototype.onBeforeRender = function (...args) {
  this.userData.drawsFrom = draws;
  return before.apply(this, args);
};
const after = T.Scene.prototype.onAfterRender;
T.Scene.prototype.onAfterRender = function (...args) {
  renders++;
  lastDraws = draws - (this.userData.drawsFrom ?? draws);
  const sky = this.getObjectByName('environment-sky');
  skyTexture = sky?.visible ? (sky.material.map?.uuid ?? null) : null;
  return after.apply(this, args);
};

const brief = defineBuild({
  goal: 'Exercise the gradient sky.',
  genre: 'diagnostic',
  pitch: 'A dusk sky meeting its haze at the horizon.',
  coreLoop: ['Look', 'Change', 'Leave'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']},
  success: [
    {
      id: 'S1',
      check: 'The sky gradient and haze meet at the horizon in one draw',
      how: 'playtest',
      by: 'scripts/play/sky-check.mjs',
    },
  ],
});
const game = defineGame({id: 'sky-check', version: '0.1.0', title: 'Sky diagnostic', firstScene: 'dusk'});
export const DUSK = {kind: 'gradient', top: 0x1040a0, horizon: 0xf0a060, bottom: 0x302820, exponent: 0.8};
const environment = sky =>
  defineEnvironment({
    background: 0x101820,
    ambient: {sky: 0xffffff, ground: 0x445566, intensity: 1.2},
    directional: {color: 0xffffff, intensity: 1.2, position: [4, 9, 6]},
    haze: sky ? {kind: 'exp2', color: 'sky', density: 0.06} : null,
    points: [],
    pointSize: 2,
    ...(sky
      ? {
          sky: {
            ...DUSK,
            discs: [{direction: [-0.6, 0.35, -1], size: 3, color: 0xfff4e0, glow: 0.4}],
            stars: {count: 200, seed: 7},
          },
        }
      : {}),
  });
let context;
const idle = defineSystem({id: 'idle', phase: 'frame', run() {}});
const view = sky => ({
  camera: {position: [0, 1.6, 0], target: [0, 1.6, -10], fov: 60},
  background: 0x101820,
  environment: environment(sky),
});
const entities = [
  [Name({name: 'floor'}), Transform({z: -40}), Shape({kind: 'plane', size: [200, 0, 120], color: 0x6f6a60})],
  [
    Name({name: 'near'}),
    Transform({x: 2.5, y: 0.6, z: -6}),
    Shape({kind: 'box', size: [1.2, 1.2, 1.2], color: 0x9b6a3c}),
  ],
  [Name({name: 'far'}), Transform({x: -6, y: 4, z: -90}), Shape({kind: 'box', size: [6, 8, 6], color: 0x9b6a3c})],
];
const scene = (id, sky) =>
  defineScene({
    id,
    title: id,
    view: view(sky),
    entities,
    systems: [idle],
    enter(ctx) {
      context = ctx;
    },
  });
const dusk = scene('dusk', true),
  plain = scene('plain', false);
const compiled = compileGame({brief, game, defs: [dusk, plain]});
const app = createApp([...layerModules(game, brief), ...compiled.modules], {
  mode: 'test',
  events: appBus,
  flag: id => appFeatures().enabled(id),
  probes: true,
});
const boot = app.boot();
window.skyCheck = {
  boot: () => boot.then(() => true),
  snapshot: () => ({
    renders,
    lastDraws,
    skyTexture,
    disposed: [...disposed],
    scene: app.probes.read('world')?.scene ?? null,
  }),
  /** Page point at a fraction of the canvas. */
  at: (fx, fy) => {
    const r = document.querySelector('.scene-view canvas').getBoundingClientRect();
    return {x: r.left + fx * r.width, y: r.top + fy * r.height, height: r.height, width: r.width};
  },
  /** The gradient's expected sRGB colour at an elevation (radians). */
  expected: elevation => skyGradientAt(DUSK, elevation).map(Math.round),
  fov: () => context.view.camera.fov,
  aspect: () => context.view.aspect,
  brighten: () => {
    const e = context.view.environment;
    context.view.environment = {...e, ambient: {...e.ambient, intensity: 1.6}};
  },
  recolour: () => {
    const e = context.view.environment;
    context.view.environment = {...e, sky: {...e.sky, top: 0x203060}};
  },
  redraw: () => app.services.play.current()?.redraw?.() ?? false,
  goto: id => context.scene.goto(id),
};
