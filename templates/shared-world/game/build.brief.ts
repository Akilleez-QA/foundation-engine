// The build brief: the contract this game is built against (AGENTS.md). GAME.md mirrors it at the top.
import { defineBuild } from '@engine';

export default defineBuild({
  goal: 'A starting point for a small shared world: two or more players on one board, over a LAN or loopback host.',
  pitch: 'Walk a capsule around a board and paint cells; open a second tab against npm run host and both players see one world.',
  genre: 'shared-world',
  coreLoop: ['move a cell at a time', 'paint the cell under you', 'watch the other player paint the same board'],
  devices: { targets: ['desktop', 'laptop'], minimum: 'laptop', input: ['keyboard', 'pointer', 'gamepad'] },
  quality: { views: [{ id: 'world-start', scene: 'world', mode: 'near' }] },
  constraints: {
    content: ['Development host only: loopback by default, LAN on request; no accounts, matchmaking, NAT traversal or Internet deployment.'],
  },
  success: [
    { id: 'S1', check: 'moving and painting change the shared world through the same rules locally and on the host', how: 'test', by: 'game/world.test.ts' },
    { id: 'S2', check: 'two browser tabs joined to one local host see each other move and paint', how: 'manual' },
    { id: 'S3', check: 'the world scene stays inside its budgets.json counts on the gate', how: 'gate' },
  ],
});
