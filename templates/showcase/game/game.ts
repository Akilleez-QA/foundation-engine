import {defineGame} from '@engine';
import {camera} from '@kits/camera';
import {character} from '@kits/character';
import {explore} from '@kits/explore';
import {ui} from '@kits/ui';

export default defineGame({
  id: 'showcase',
  title: 'Lantern Courtyard',
  version: '0.1.0',
  firstScene: 'courtyard',
  kits: [ui(), camera(), character(), explore()],
  strings: {
    en: {
      'game.prompt': '{thing} (E, A or tap)',
      'game.use.gate': 'Go through the gate',
      'game.use.back': 'Back to the courtyard',
      'game.use.sundial': 'Turn the sundial',
      'game.hud.embers': 'Embers {n} of {total}',
      'game.embers-all': 'Every ember found!',
      'game.hud.look': 'Light: {name}',
      'game.look.golden-hour': 'golden hour',
      'game.look.overcast': 'overcast',
      'game.look.moonlight': 'moonlight',
      'game.look.studio': 'studio',
    },
  },
});
