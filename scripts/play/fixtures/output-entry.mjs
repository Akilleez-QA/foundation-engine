// Real engine composition for the scene-output browser regression (`npm run test:output-browser`); not shipped by a
// template. A glowing lantern box (emissive 6, from the courtyard trial) over a lit floor: one scene keeps the default
// output, one opts into ACES tone mapping. Instruments draws before the app boots; reads only author data.
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
  defineMaterial,
  Name,
  Transform,
  Shape,
} from '../../../src/author/index.ts';

let renders = 0,
  output = null;
const originalAfterRender = T.Scene.prototype.onAfterRender;
T.Scene.prototype.onAfterRender = function (renderer, ...args) {
  renders++;
  output = {toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure};
  return originalAfterRender.call(this, renderer, ...args);
};

const brief = defineBuild({
  goal: 'Exercise scene output.',
  genre: 'diagnostic',
  pitch: 'A bright emissive lantern with and without tone mapping.',
  coreLoop: ['Look', 'Change', 'Leave'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']},
  success: [
    {
      id: 'S1',
      check: 'Tone mapping keeps bright emissive light from clipping and changes redraw once',
      how: 'playtest',
      by: 'scripts/play/output-check.mjs',
    },
  ],
});
const game = defineGame({id: 'output-check', version: '0.1.0', title: 'Output diagnostic', firstScene: 'plain'});
let context;
// A frame system keeps the loop ticking so outside edits are seen; frames still draw only when something changed.
const idle = defineSystem({id: 'idle', phase: 'frame', run() {}});
const entities = [
  [
    Name({name: 'lantern'}),
    Transform({y: 0.6}),
    Shape({kind: 'box', size: [1.2, 1.2, 1.2], color: 0xffd28a}),
    defineMaterial({emissive: 0xffb04a, emissiveIntensity: 6, roughness: 0.2}),
  ],
  [Name({name: 'floor'}), Transform({y: -0.05}), Shape({kind: 'box', size: [8, 0.1, 6], color: 0x9a948c})],
];
const view = {camera: {position: [0, 2.2, 5], target: [0, 0.4, 0]}, background: 0x070b1a};
const scene = (id, extra = {}) =>
  defineScene({
    id,
    title: id,
    view: {...view, ...extra},
    entities,
    systems: [idle],
    enter(ctx) {
      context = ctx;
    },
  });
const plain = scene('plain');
const graded = scene('graded', {output: {toneMapping: 'aces', exposure: 0.5}});
const compiled = compileGame({brief, game, defs: [plain, graded]});
const app = createApp([...layerModules(game, brief), ...compiled.modules], {
  mode: 'test',
  events: appBus,
  flag: id => appFeatures().enabled(id),
  probes: true,
});
const boot = app.boot();
window.outputCheck = {
  boot: () => boot.then(() => true),
  snapshot: () => ({
    renders,
    output,
    view: context ? {...context.view.output} : null,
    scene: app.probes.read('world')?.scene ?? null,
    lantern: (() => {
      const canvas = document.querySelector('.scene-view canvas');
      if (!canvas) return null;
      const r = canvas.getBoundingClientRect();
      return {x: r.left + r.width / 2, y: r.top + r.height * 0.5, width: r.width, height: r.height};
    })(),
  }),
  /** Replace the output, as a system would. */
  setOutput: o => {
    context.view.output = {...context.view.output, ...o};
  },
  goto: id => context.scene.goto(id),
};
