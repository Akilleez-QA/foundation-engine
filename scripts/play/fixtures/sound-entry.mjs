// Real engine composition for the sound-file browser regression; not shipped by a template.
import '../../../src/app/styles.ts';
import {createApp} from '../../../src/core/app.ts';
import {appBus} from '../../../src/core/app-events.ts';
import {appFeatures} from '../../../src/core/settings/app-features.ts';
import {layerModules} from '../../../src/app/layer-modules.ts';
import {compileGame} from '../../../src/author/compile.ts';
import {defineBuild,defineGame,defineScene,defineAsset,Name,Transform,Shape} from '../../../src/author/index.ts';

const brief = defineBuild({goal: 'Exercise sound files.', genre: 'diagnostic', pitch: 'A scene that preloads and plays its own sounds.', coreLoop: ['Enter', 'Play', 'Leave'],
  devices: {targets: ['desktop'], minimum: 'desktop', input: ['keyboard', 'pointer']}, success: [{id: 'S1', check: 'Sound files load with the scene and never play in tests', how: 'playtest', by: 'scripts/play/sound-check.mjs'}]});
const game = defineGame({id: 'sound-check', version: '0.1.0', title: 'Sound diagnostic', firstScene: 'sample'});
const asset = (id, url) => defineAsset({id, type: 'audio', url, licence: 'CC0-1.0', author: 'Foundation Engine contributors', source: 'templates/mechanics/assets/generate-chime.mjs'});
let context;
const sample = defineScene({id: 'sample', title: 'Sounds', sounds: ['chime', 'missing'], view: {camera: {position: [0, 3, 6], target: [0, 0, 0]}},
  entities: [[Name({name: 'subject'}), Transform(), Shape({kind: 'box'})]], enter(ctx) { context = ctx; }});
const other = defineScene({id: 'other', title: 'Other', enter(ctx) { context = ctx; }});
const compiled = compileGame({brief, game, defs: [sample, other, asset('chime', '/sounds/mechanics/chime.wav'), asset('missing', '/sounds/mechanics/missing.wav')]});
const app = createApp([...layerModules(game, brief), ...compiled.modules], {mode: 'test', events: appBus, flag: id => appFeatures().enabled(id), probes: true});
const boot = app.boot();
window.soundCheck = {
  boot: () => boot.then(() => true),
  audio: () => app.probes.read('audio'),
  scene: () => context?.scene.id ?? null,
  play: (id, options) => { context.play(id, options); },
  voice: id => context.playVoice(id, {wait: 100}),
};
