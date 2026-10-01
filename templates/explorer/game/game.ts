import { defineGame } from '@engine';
import { camera } from '@kits/camera';
import { character } from '@kits/character';
import { explore } from '@kits/explore';
import { ui } from '@kits/ui';

export default defineGame({
  id: 'explorer', title: 'Garden', version: '0.1.0', firstScene: 'garden',
  kits: [ui(), camera(), character(), explore()],
  strings: {
    en: {
      'game.use.bench': 'Sit on the bench',
      'game.use.lamp': 'Switch the lamp',
      'game.use.crate': 'Open the crate',
      'game.use.to-shed': 'Go into the shed',
      'game.use.to-garden': 'Go out to the garden',
      'game.prompt': '{thing} (E, A or tap)',
      'game.hud.found': 'Found {n} of {total}',
      'game.found-all': 'You found everything!',
    },
  },
});
