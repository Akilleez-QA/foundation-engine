// Authored scenes exercise the actual runtime SceneHandle bridge and dev API.
import '../../../src/app/styles.ts';
import {createApp} from '../../../src/core/app.ts';
import {appFeatures} from '../../../src/core/settings/app-features.ts';
import {layerModules} from '../../../src/app/layer-modules.ts';
import {compileGame} from '../../../src/author/compile.ts';
import {defineBuild, defineGame, defineScene, defineSystem} from '../../../src/author/index.ts';
import {createTestApi} from '../../../src/dev/test-api.ts';

const brief = defineBuild({
  goal: 'Attribute synchronous authored system execution.', genre: 'diagnostic', pitch: 'Scene-owned bounded timing.',
  coreLoop: ['Capture', 'Change scene'], devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']},
  success: [{id: 'S1', check: 'System timing follows the actual scene lifetime', how: 'playtest', by: 'scripts/play/system-timing-check.mjs'}],
});
const game = defineGame({id: 'system-timing', version: '0.1.0', title: 'System timing diagnostic', firstScene: 'sample'});
const slow = defineSystem({id: 'timed-work', phase: 'frame', run(ctx) {
  const end = performance.now() + 3;
  while (performance.now() < end) { /* Deliberately measurable synchronous fixture work. */ }
  ctx.state.slowRuns = (ctx.state.slowRuns ?? 0) + 1;
}});
const sibling = defineSystem({id: 'timed-sibling', phase: 'frame', run(ctx) { ctx.state.siblingRuns = (ctx.state.siblingRuns ?? 0) + 1; }});
const sample = defineScene({id: 'sample', title: 'Timed visit', systems: [slow, sibling]});
const other = defineScene({id: 'other', title: 'Replacement visit'});
const compiled = compileGame({brief, game, defs: [sample, other]});
const app = createApp([...layerModules(game, brief), ...compiled.modules], {mode: 'test', flag: id => appFeatures().enabled(id), probes: true});
const booted = app.boot();
window.engine = createTestApi(app, booted);
window.systemTiming = {
  start() { this.previous = app.services.play.current(); this.capture = engine.systemTrace({capacity: 32}); },
  show() { document.querySelector('#metadata').textContent = JSON.stringify(this.capture.exportTrace(), null, 2); },
  dispose() { app.dispose(); },
};
