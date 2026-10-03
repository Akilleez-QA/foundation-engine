// A scene whose systems record any step that runs before the visit's enter(): first entry, re-entry and restart.
import '../../../src/app/styles.ts';
import {createApp} from '../../../src/core/app.ts';
import {appFeatures} from '../../../src/core/settings/app-features.ts';
import {layerModules} from '../../../src/app/layer-modules.ts';
import {compileGame} from '../../../src/author/compile.ts';
import {defineBuild, defineGame, defineScene, defineSystem} from '../../../src/author/index.ts';
import {createTestApi} from '../../../src/dev/test-api.ts';

const brief = defineBuild({
  goal: 'Check that no scene system steps before the visit enters.', genre: 'diagnostic', pitch: 'Scene entry order.',
  coreLoop: ['Enter', 'Re-enter'], devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']},
  success: [{id: 'S1', check: 'Systems step only after enter() on every visit', how: 'playtest', by: 'scripts/play/scene-entry-order-check.mjs'}],
});
const game = defineGame({id: 'scene-entry-order', version: '0.1.0', title: 'Scene entry order diagnostic', firstScene: 'level'});
const log = window.entryOrder = {enters: [], early: [], restart: false};
const watch = phase => defineSystem({id: `watch-${phase}`, phase, run(ctx) {
  if (ctx.state.entered !== true) log.early.push({phase, params: {...ctx.scene.params}});
  else ctx.state[`${phase}Steps`] = (ctx.state[`${phase}Steps`] ?? 0) + 1;
  if (phase === 'fixed' && log.restart && ctx.state.entered === true) { log.restart = false; ctx.scene.restart(); }
}});
const level = defineScene({id: 'level', title: 'Level', systems: [watch('fixed'), watch('frame')],
  enter(ctx) { ctx.state.entered = true; log.enters.push({...ctx.scene.params}); }});
const other = defineScene({id: 'other', title: 'Other'});
const compiled = compileGame({brief, game, defs: [level, other]});
const app = createApp([...layerModules(game, brief), ...compiled.modules], {mode: 'test', flag: id => appFeatures().enabled(id), probes: true});
const booted = app.boot();
window.engine = createTestApi(app, booted);
