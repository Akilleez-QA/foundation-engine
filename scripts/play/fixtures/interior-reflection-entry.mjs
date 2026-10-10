// Real engine composition for the interior-reflection browser regression (`npm run test:interior-reflection-browser`); not
// shipped by a template. A mirror-like metal sphere lit only by its environment: in `interior` it reflects a procedural
// interior (dark walls, one bright light panel behind the camera); in `plain` it reflects nothing. Instruments draws,
// prefilter (PMREM) builds and texture disposal before the app boots.
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
  defineMaterial,
  defineScene,
  defineSystem,
  Name,
  Shape,
  Transform,
} from '../../../src/author/index.ts';

let renders = 0,
  draws = 0,
  lastDraws = 0,
  prefilters = 0,
  environment = null;
const disposed = new Set();
const dispose = T.Texture.prototype.dispose;
T.Texture.prototype.dispose = function () {
  disposed.add(this.uuid);
  return dispose.call(this);
};
const fromEquirectangular = T.PMREMGenerator.prototype.fromEquirectangular;
T.PMREMGenerator.prototype.fromEquirectangular = function (...args) {
  prefilters++;
  return fromEquirectangular.apply(this, args);
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
  environment = this.environment?.uuid ?? null;
  return after.apply(this, args);
};

const brief = defineBuild({
  goal: 'Exercise the procedural interior reflection.',
  genre: 'diagnostic',
  pitch: 'A metal sphere reflecting a dim interior and one light.',
  coreLoop: ['Look', 'Change', 'Leave'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']},
  success: [
    {
      id: 'S1',
      check: 'Metal reflects the authored interior, built once, at no per-frame cost',
      how: 'playtest',
      by: 'scripts/play/interior-reflection-check.mjs',
    },
  ],
});
const game = defineGame({
  id: 'interior-reflection-check',
  version: '0.1.0',
  title: 'Interior reflection',
  firstScene: 'interior',
});
export const INTERIOR = {
  kind: 'interior',
  size: [20, 8, 20],
  eyeHeight: 1.6,
  wall: {color: 0x202020, intensity: 1},
  floor: {color: 0x101010},
  ceiling: {color: 0x080808},
  // Behind the camera at eye height: the sphere's centre (facing the camera) mirrors it.
  lights: [{position: [0, 1.6, 8], radius: 1.5, color: 0xffffff, intensity: 4}],
};
const env = reflection =>
  defineEnvironment({
    background: 0x000000,
    ambient: {sky: 0xffffff, ground: 0xffffff, intensity: 0},
    directional: {color: 0xffffff, intensity: 0, position: [4, 9, 6]},
    haze: null,
    points: [],
    pointSize: 2,
    ...(reflection ? {reflection} : {}),
  });
let context;
const idle = defineSystem({id: 'idle', phase: 'frame', run() {}});
const entities = [
  [
    Name({name: 'mirror'}),
    Transform({x: 0, y: 1.6, z: 0}),
    Shape({kind: 'sphere', size: [2, 2, 2], color: 0xffffff}),
    defineMaterial({metalness: 1, roughness: 0.05}),
  ],
];
const scene = (id, reflection) =>
  defineScene({
    id,
    title: id,
    view: {camera: {position: [0, 1.6, 4], target: [0, 1.6, 0], fov: 50}, background: 0, environment: env(reflection)},
    entities,
    systems: [idle],
    enter(ctx) {
      context = ctx;
    },
  });
const compiled = compileGame({brief, game, defs: [scene('interior', INTERIOR), scene('plain', null)]});
const app = createApp([...layerModules(game, brief), ...compiled.modules], {
  mode: 'test',
  events: appBus,
  flag: id => appFeatures().enabled(id),
  probes: true,
});
const boot = app.boot();
window.interiorCheck = {
  boot: () => boot.then(() => true),
  snapshot: () => ({
    renders,
    lastDraws,
    prefilters,
    environment,
    disposed: [...disposed],
    scene: app.probes.read('world')?.scene ?? null,
  }),
  /** Page point at a fraction of the canvas. */
  at: (fx, fy) => {
    const r = document.querySelector('.scene-view canvas').getBoundingClientRect();
    return {x: r.left + fx * r.width, y: r.top + fy * r.height};
  },
  /** A change that is not the reflection: a fresh environment object with equal interior data. */
  republish: () => {
    const e = context.view.environment;
    context.view.environment = {...e, reflection: structuredClone(e.reflection), pointSize: 3};
  },
  /** An interior change: the light turns red. */
  relight: () => {
    const e = context.view.environment;
    context.view.environment = {
      ...e,
      reflection: {...e.reflection, lights: [{...INTERIOR.lights[0], color: 0xff2000}]},
    };
  },
  redraw: () => app.services.play.current()?.redraw?.() ?? false,
  goto: id => context.scene.goto(id),
};
