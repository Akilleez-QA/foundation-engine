import {defineGame} from '@engine';
import {ui} from '@kits/ui';

export default defineGame({
  id: 'shared-world',
  title: 'Shared world',
  version: '0.1.0',
  firstScene: 'world',
  kits: [ui()],
  strings: {
    en: {
      'game.session.local': 'Local play. To share this world: npm run host',
      'game.session.connecting': 'Connecting to the host…',
      'game.session.joined': 'You are {player} · {players} in this world',
      'game.session.waiting': 'Joined as {player}, waiting for the world…',
      'game.session.reconnecting': 'Connection lost, reconnecting in {seconds} s',
      'game.session.closed': 'Disconnected ({reason}). Reload to try again',
      'game.painted': 'Painted {n} of {total}',
      'game.hint': 'Move: WASD, arrows or stick · Paint: Space, A or tap',
    },
  },
});
