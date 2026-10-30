// Authored scenes exercise the actual runtime SceneHandle bridge and dev API.
import '../../../src/app/styles.ts';
import {createApp} from '../../../src/core/app.ts';
import {appFeatures} from '../../../src/core/settings/app-features.ts';
import {layerModules} from '../../../src/app/layer-modules.ts';
import {compileGame} from '../../../src/author/compile.ts';
import {defineBuild, defineGame, defineScene, defineComponent, Transform} from '../../../src/author/index.ts';
import {createTestApi} from '../../../src/dev/test-api.ts';

const Tag = defineComponent('inspection-tag', {value: 7});
const brief = defineBuild({
  goal: 'Inspect unnamed entity metadata without reading values.',
  genre: 'diagnostic',
  pitch: 'Bounded scene-owned tool access.',
  coreLoop: ['Inspect', 'Change scene'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']},
  success: [
    {
      id: 'S1',
      check: 'Old visit metadata cannot inspect a replacement',
      how: 'playtest',
      by: 'scripts/play/entity-inspect-check.mjs',
    },
  ],
});
const game = defineGame({
  id: 'entity-inspect',
  version: '0.1.0',
  title: 'Entity metadata diagnostic',
  firstScene: 'sample',
});
const enter = ctx => {
  const id = ctx.world.spawn(Transform(), Tag());
  Object.defineProperty(ctx.world.get(id, Tag), 'value', {
    get() {
      throw Error('inspection must not read component values');
    },
  });
};
const sample = defineScene({id: 'sample', title: 'First visit', enter});
const other = defineScene({id: 'other', title: 'Replacement visit', enter});
const compiled = compileGame({brief, game, defs: [sample, other]});
const app = createApp([...layerModules(game, brief), ...compiled.modules], {
  mode: 'test',
  flag: id => appFeatures().enabled(id),
  probes: true,
});
const booted = app.boot();
window.engine = createTestApi(app, booted);
let previous;
window.entityInspect = {
  keepHandle() {
    previous = app.services.play.current();
  },
  previous: epoch => previous?.entities?.({expectedEpoch: epoch}),
  dispose() {
    app.dispose();
  },
  show(page) {
    document.querySelector('#metadata').textContent = JSON.stringify(page, null, 2);
  },
};
