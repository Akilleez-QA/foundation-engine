import {defineGame} from '@engine';
import {camera} from '@kits/camera';
import {conceptExplorer} from '@kits/concept-explorer';
import {learn} from '@kits/learn';
import {ui} from '@kits/ui';
import strings from './strings.en.json';

export default defineGame({
  id: 'day-and-night',
  title: 'Day and night',
  version: '0.1.0',
  firstScene: 'day-night',
  kits: [ui(), camera(), conceptExplorer(), learn()],
  strings: {en: strings},
});
