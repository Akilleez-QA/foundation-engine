import { defineGame } from '@engine';
import { ui } from '@kits/ui';

export default defineGame({
  id: 'arcade', title: 'Dodge', version: '0.1.0', firstScene: 'play',
  kits: [ui()],
  strings: {
    en: {
      'game.hud.score': 'Score {n}',
      'game.hud.best': 'Best {n}',
      'game.over': 'Hit! Score {n}',
      'game.restart-hint': 'Press Space, A or tap to play again',
      'game.steer-hint': 'Steer with ← →, A D, the stick, or drag',
    },
  },
});
