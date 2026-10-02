// Real engine composition for the particle browser regression (FX-01); not shipped by a template.
// Instruments the renderer's per-draw counts and three.js disposal before the app boots; reads only public author data,
// the dev/test scene handle and the asset library's stats.
import * as T from 'three';
import '../../../src/app/styles.ts';
import {createApp} from '../../../src/core/app.ts';
import {appBus} from '../../../src/core/app-events.ts';
import {appFeatures} from '../../../src/core/settings/app-features.ts';
import {layerModules} from '../../../src/app/layer-modules.ts';
import {compileGame} from '../../../src/author/compile.ts';
import {defineBuild, defineGame, defineScene, defineSystem, defineAsset, defineEmitter, burst, sceneParticles, Emitter, Name, Transform, Shape} from '../../../src/author/index.ts';

let renders = 0, last = {calls: 0, triangles: 0}, disposedGeometries = 0;
// three.js calls Scene.onAfterRender(renderer, ...) at the end of each scene draw, after its draw calls are counted.
const originalAfterRender = T.Scene.prototype.onAfterRender;
T.Scene.prototype.onAfterRender = function (renderer, ...rest) {
  renders++; last = {calls: renderer.info.render.calls, triangles: renderer.info.render.triangles};
  return originalAfterRender.call(this, renderer, ...rest);
};
const originalDispose = T.BufferGeometry.prototype.dispose;
T.BufferGeometry.prototype.dispose = function () { if (this.isInstancedBufferGeometry) disposedGeometries++; return originalDispose.call(this); };

const brief = defineBuild({goal: 'Exercise particle emitters.', genre: 'diagnostic', pitch: 'Bursts, a trail and a textured emitter.', coreLoop: ['Fire', 'Watch', 'Leave'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']}, success: [{id: 'S1', check: 'Emitters cost one draw while live and nothing when idle', how: 'playtest', by: 'scripts/play/particle-check.mjs'}]});
const game = defineGame({id: 'particle-check', version: '0.1.0', title: 'Particle diagnostic', firstScene: 'sample'});
const panel = defineAsset({id: 'panel', type: 'texture', url: '/textures/mechanics/panel.png', width: 32, height: 32, licence: 'CC0-1.0', author: 'Foundation Engine contributors', source: 'templates/mechanics/assets/generate-panel.mjs'});
let context;
// A frame system keeps the loop ticking so outside edits are seen; frames still draw only when something changed.
const idle = defineSystem({id: 'idle', phase: 'frame', run() {}});
// The trail emitter circles while it plays (fixed step: deterministic).
const orbit = defineSystem({id: 'orbit', run(ctx, dt) {
  const e = ctx.named('trail'), em = e && ctx.world.get(e, Emitter), tr = e && ctx.world.get(e, Transform);
  if (!em?.playing) return;
  ctx.state.angle = (ctx.state.angle ?? 0) + dt * 3;
  tr.x = Math.cos(ctx.state.angle) * 1.5; tr.z = Math.sin(ctx.state.angle) * 1.5;
}});
const sample = defineScene({id: 'sample', title: 'Particles', particles: sceneParticles({emitters: 4, max: 512}), view: {camera: {position: [0, 3, 7], target: [0, .8, 0]}, background: 0x10141c},
  entities: [
    [Name({name: 'floor'}), Transform({y: -.05}), Shape({kind: 'box', size: [8, .1, 4], color: 0x46505e})],
    [Name({name: 'sparks'}), Transform({x: -2, y: .5}), defineEmitter({mode: 'burst', count: 48, max: 96, lifetime: [.4, .7], speed: [2, 4.5], spread: Math.PI / 2.5,
      gravity: [0, -9.8, 0], size: [.12, .02], color: [0xfff2a8, 0xff7a1a, 0x802000], opacity: [1, 0]})],
    [Name({name: 'trail'}), Transform({x: 1.5, y: .6}), defineEmitter({mode: 'continuous', rate: 90, max: 128, playing: false, lifetime: [.5, .8], speed: [0, .3],
      spread: Math.PI, size: [.18, .04], color: [0x7ad7ff, 0x2a4cff], opacity: [.9, 0]})],
    [Name({name: 'glow'}), Transform({x: 2.2, y: 1.2}), defineEmitter({mode: 'burst', count: 12, max: 24, lifetime: [.6, .9], speed: [.4, 1], spread: Math.PI,
      size: [.4, .1], color: [0xffffff], opacity: [1, 0], texture: 'panel', blending: 'normal'})],
  ],
  systems: [idle, orbit], enter(ctx) { context = ctx; }});
const other = defineScene({id: 'other', title: 'Other', enter(ctx) { context = ctx; }});
const compiled = compileGame({brief, game, defs: [sample, other, panel]});
const app = createApp([...layerModules(game, brief), ...compiled.modules], {mode: 'test', events: appBus, flag: id => appFeatures().enabled(id), probes: true});
const boot = app.boot();
window.particleCheck = {
  boot: () => boot.then(() => true),
  snapshot: () => ({renders, last, disposedGeometries, chunk: performance.getEntriesByType('resource').filter(r => /scene-particles/.test(r.name)).length, scene: app.probes.read('world')?.scene ?? null,
    particles: app.services.play.current()?.particles?.() ?? null, assets: app.services.assets.stats()}),
  fire: name => burst(context.world, context.named(name)),
  trail: on => { context.world.get(context.named('trail'), Emitter).playing = on; context.world.touch(); },
  goto: id => context.scene.goto(id),
};
