import {defineGame} from '@engine';
import {terrain} from '@kits/terrain';
import {character} from '@kits/character';
import {camera} from '@kits/camera';

export default defineGame({
  id: 'terrain',
  title: 'Terrain yard',
  version: '0.1.0',
  firstScene: 'yard',
  kits: [terrain(), character(), camera()],
  strings: {en: {'terrain.revise': 'Revise terrain'}},
});
