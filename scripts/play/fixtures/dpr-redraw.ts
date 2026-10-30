/** Stock static author scene and renderer lease; observes successful native calls only. */
import '../../../src/app/styles';
import {Vector2} from 'three';
import {createApp} from '../../../src/core/app';
import {appFeatures} from '../../../src/core/settings/app-features';
import {layerModules} from '../../../src/app/layer-modules';
import {compileGame} from '../../../src/author/compile';
import {defineBuild, defineGame, defineScene, Name, Shape, Transform, type SceneContext} from '../../../src/author';
import {createTestApi} from '../../../src/dev/test-api';
import {appRenderers} from '../../../src/platform/render/renderer-pool';
let ctx: SceneContext | undefined,
  renders = 0;
let readBuffer = () => ({width: 0, height: 0, ratio: 0});
const pool = appRenderers(),
  originalLease = pool.lease.bind(pool);
pool.lease = request => {
  const surface = originalLease(request);
  if (surface && request.role === 'world') {
    const renderer = surface.renderer,
      render = renderer.render.bind(renderer);
    renderer.render = (scene, camera) => {
      render(scene, camera);
      if (scene.getObjectByName('static-subject')) renders++;
    };
    readBuffer = () => {
      const size = renderer.getDrawingBufferSize(new Vector2());
      return {width: size.x, height: size.y, ratio: renderer.getPixelRatio()};
    };
  }
  return surface;
};
const scene = defineScene({
  id: 'dpr-redraw',
  title: 'DPR redraw evidence',
  view: {camera: {position: [0, 2, 5], target: [0, 0, 0]}},
  entities: [[Name({name: 'static-subject'}), Transform(), Shape({color: 0x22aaff})]],
  enter(context) {
    ctx = context;
  },
  exit() {
    ctx = undefined;
  },
});
const game = defineGame({
  id: 'dpr-redraw-browser',
  title: 'DPR redraw evidence',
  version: '0.1.0',
  firstScene: scene.id,
});
const brief = defineBuild({
  goal: 'Verify DPR-only redraw of a static scene.',
  pitch: 'Static scene quality changes.',
  genre: 'diagnostic',
  coreLoop: ['inspect', 'resize'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']},
  success: [
    {
      id: 'S1',
      check: 'One redraw after ratio change without scene mutation.',
      how: 'test',
      by: 'scripts/play/dpr-redraw-check.mjs',
    },
  ],
});
const compiled = compileGame({brief, game, defs: [scene]});
const app = createApp([...layerModules(game, brief), ...compiled.modules], {
  mode: 'test',
  flag: id => appFeatures().enabled(id),
  probes: true,
});
const booted = app.boot(),
  engine = createTestApi(app, booted);
Object.assign(window, {
  engine,
  dprFixture: {
    change() {
      app.services.quality.setKnob('resolution.scale', 0.5);
    },
    read() {
      return {
        ready: !!ctx,
        renders,
        buffer: readBuffer(),
        epoch: engine.state().scene?.epoch,
        world: ctx && {
          version: ctx.world.version,
          transforms: [...ctx.world.query(Transform)].map(([id, tr]) => ({id, ...tr})),
          state: structuredClone(ctx.state),
        },
        css: ctx && {
          width: document.querySelector('canvas')?.clientWidth,
          height: document.querySelector('canvas')?.clientHeight,
        },
      };
    },
    dispose() {
      pool.lease = originalLease;
      app.dispose();
    },
  },
});
await booted;
