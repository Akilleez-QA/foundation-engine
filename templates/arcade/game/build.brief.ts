// The build brief: the contract this game is built against (AGENTS.md). GAME.md mirrors it at the top.
import {defineBuild} from '@engine';

export default defineBuild({
  goal: 'A small 3D arcade game with a score, a fail state and an instant restart.',
  pitch: 'Blocks rain down a lane; steer the ball left and right to dodge them for as long as you can.',
  genre: 'arcade',
  coreLoop: [
    'steer to dodge the falling blocks',
    'score a point for every block that passes',
    'get hit, see your score and best',
    'restart at once',
  ],
  devices: {
    targets: ['desktop', 'laptop', 'tablet', 'phone'],
    minimum: 'phone',
    input: ['keyboard', 'pointer', 'touch', 'gamepad'],
  },
  quality: {views: [{id: 'play-start', scene: 'play', mode: 'near'}]},
  success: [
    {
      id: 'S1',
      check: 'steering right moves the ball right and stops at the lane edge',
      how: 'test',
      by: 'game/play.test.ts',
    },
    {
      id: 'S2',
      check: 'a block that reaches the ball ends the run and shows the game-over banner',
      how: 'test',
      by: 'game/play.test.ts',
    },
    {
      id: 'S3',
      check: 'the restart action after game over starts a fresh run with score zero',
      how: 'playtest',
      by: 'game/playtest/restart.json',
    },
    {
      id: 'S4',
      check: 'the best score survives a restart and a reload (save section run.best)',
      how: 'test',
      by: 'game/play.test.ts',
    },
    {id: 'S5', check: 'the play scene stays inside its budgets.json counts on the gate', how: 'gate'},
  ],
});
