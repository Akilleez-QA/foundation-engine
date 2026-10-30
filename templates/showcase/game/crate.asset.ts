// A texture the game ships, painted by tools/generate-textures.mjs into public/textures/showcase/.
import {defineAsset} from '@engine';

export default defineAsset({
  id: 'crate',
  type: 'texture',
  url: '/textures/showcase/crate.png',
  width: 128,
  height: 128,
  licence: 'CC0-1.0',
  author: 'Foundation Engine contributors',
  source: 'templates/showcase/game/tools/generate-textures.mjs',
});
