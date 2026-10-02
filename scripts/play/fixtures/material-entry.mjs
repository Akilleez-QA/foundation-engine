// Real engine composition for the Material browser regression; not shipped by a template.
// Instruments three.js disposal and draws before the app boots; reads only public author data and probes.
import * as T from 'three';
import '../../../src/app/styles.ts';
import {createApp} from '../../../src/core/app.ts';
import {appBus} from '../../../src/core/app-events.ts';
import {appFeatures} from '../../../src/core/settings/app-features.ts';
import {layerModules} from '../../../src/app/layer-modules.ts';
import {compileGame} from '../../../src/author/compile.ts';
import {defineBuild,defineGame,defineScene,defineSystem,defineAsset,defineMaterial,Material,Name,Transform,Shape} from '../../../src/author/index.ts';

const disposedTextures = new Set();
const originalDispose = T.Texture.prototype.dispose;
T.Texture.prototype.dispose = function () { disposedTextures.add(this.uuid); return originalDispose.call(this); };
let renders = 0, drawn = [];
const originalAfterRender = T.Scene.prototype.onAfterRender;
T.Scene.prototype.onAfterRender = function (...args) {
  const meshes = [];
  this.traverse(node => {
    if (!node.isMesh) return;
    const m = node.material, map = m.map;
    meshes.push({name: node.name, uuid: m.uuid, type: m.type, color: m.color.getHex(), roughness: m.roughness ?? null, metalness: m.metalness ?? null, emissive: m.emissive?.getHex() ?? null,
      transparent: m.transparent, opacity: m.opacity,
      map: map ? {uuid: map.uuid, source: map.source.uuid, ready: !!map.image?.width, wrapS: map.wrapS, repeat: [map.repeat.x, map.repeat.y], anisotropy: map.anisotropy} : null});
  });
  drawn = meshes; renders++;
  return originalAfterRender.apply(this, args);
};

const brief = defineBuild({goal: 'Exercise authored materials.', genre: 'diagnostic', pitch: 'Textured, lit shapes with shared leases.', coreLoop: ['Look', 'Change', 'Leave'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']}, success: [{id: 'S1', check: 'Textures load once, draw on change and release on exit', how: 'playtest', by: 'scripts/play/material-check.mjs'}]});
const game = defineGame({id: 'material-check', version: '0.1.0', title: 'Material diagnostic', firstScene: 'sample'});
const panel = defineAsset({id: 'panel', type: 'texture', url: '/textures/mechanics/panel.png', width: 32, height: 32, licence: 'CC0-1.0', author: 'Foundation Engine contributors', source: 'templates/mechanics/assets/generate-panel.mjs'});
let context;
// A system keeps the loop ticking so outside edits are seen; frames still draw only when something changed.
const idle = defineSystem({id: 'idle', phase: 'frame', run() {}});
const sample = defineScene({id: 'sample', title: 'Materials', view: {camera: {position: [0, 3, 6], target: [0, .5, 0]}, background: 0x18202a},
  entities: [
    [Name({name: 'plain'}), Transform({x: -2.4, y: .5}), Shape({kind: 'box', color: 0x4f8cff})],
    [Name({name: 'tiled'}), Transform({y: .5}), Shape({kind: 'box', color: 0xffffff}), defineMaterial({texture: 'panel', repeat: [3, 2], roughness: .6, metalness: .2})],
    [Name({name: 'mirrored'}), Transform({x: 2.4, y: .5}), Shape({kind: 'sphere', color: 0xffd27a}), defineMaterial({texture: 'panel', wrap: 'mirror', repeat: [4, 4], emissive: 0x221100, opacity: .8, transparent: true})],
    [Name({name: 'floor'}), Transform({y: -.05}), Shape({kind: 'box', size: [8, .1, 4], color: 0x9fb4c2}), defineMaterial({texture: 'panel', repeat: [8, 4], roughness: .9})],
  ],
  systems: [idle], enter(ctx) { context = ctx; }});
const other = defineScene({id: 'other', title: 'Other', enter(ctx) { context = ctx; }});
const compiled = compileGame({brief, game, defs: [sample, other, panel]});
const app = createApp([...layerModules(game, brief), ...compiled.modules], {mode: 'test', events: appBus, flag: id => appFeatures().enabled(id), probes: true});
const boot = app.boot();
window.materialCheck = {
  boot: () => boot.then(() => true),
  snapshot: () => ({renders, drawn, disposed: [...disposedTextures], scene: app.probes.read('world')?.scene ?? null, assets: app.services.assets.stats()}),
  /** Change one authored field: the next frame draws the new look. */
  /** Animate one textured, transparent surface's opacity (the fields change in place). */
  fade: opacity => { const e = context.named('mirrored'); context.world.get(e, Material).opacity = opacity; context.world.touch(); },
  roughen: () => { const e = context.named('tiled'); context.world.get(e, Material).roughness = 1; context.world.touch(); },
  retexture: () => { const e = context.named('plain'); context.world.add(e, defineMaterial({texture: 'panel'})); context.world.touch(); },
  strip: () => { const e = context.named('tiled'); context.world.remove(e, Material); context.world.touch(); },
  goto: id => context.scene.goto(id),
};
