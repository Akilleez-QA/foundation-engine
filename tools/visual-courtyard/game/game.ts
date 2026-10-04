import {defineGame} from '@engine';
import {camera} from '@kits/camera';
import {character} from '@kits/character';
import {three} from '@kits/three';
import {ui} from '@kits/ui';

// A fixture game (tools/visual-courtyard/README.md): the visual-capability trial's courtyard, before (author API) and
// after (@kits/three). It opts into the three.js escape hatch by listing three() here.
export default defineGame({
  id: 'visual-courtyard',
  title: 'Lantern Courtyard',
  version: '0.1.0',
  firstScene: 'courtyard-lit',
  kits: [ui(), camera(), character(), three()],
  strings: {
    en: {
      'game.hud.embers': 'Embers {n} of {total}',
      'game.embers-all': 'Every ember found!',
    },
  },
});
