import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestSaves, testScene, Transform} from '@engine';
import {hud} from '@kits/ui';
import game from './game';
import play from './play';
import {Hazard, LANE} from './components';

const player = (t: Awaited<ReturnType<typeof testScene>>) => t.world.get(t.ctx.named('player')!, Transform)!;

test('S1: steering right moves the ball right and stops at the lane edge', async () => {
  const t = await testScene(play, {game, seed: 7});
  t.hold('steer', 1);
  t.run(0.3);
  assert.ok(player(t).x > 1.5);
  t.run(3);
  assert.equal(player(t).x, LANE);
});

test('S2: a block that reaches the ball ends the run and shows the game-over banner', async () => {
  const t = await testScene(play, {game, seed: 7});
  for (let i = 0; i < 60 * 30 && t.ctx.state.phase === 'playing'; i++) t.run(1 / 60); // standing still: something hits
  assert.equal(t.ctx.state.phase, 'over');
  t.run(1 / 60);
  assert.match(hud(t.ctx).read().banner ?? '', /^Hit! Score \d+$/);
  assert.equal(hud(t.ctx).read().prompt, 'Press Space, A or tap to play again');
  assert.ok(t.cues.includes('ui.bump'));
  const blocks = [...t.world.query(Hazard)].length;
  t.run(1);
  assert.equal([...t.world.query(Hazard)].length, blocks, 'the world freezes after the hit');
  t.press('restart');
  t.run(1 / 60);
  assert.deepEqual(t.went, ['play'], 'restart re-enters the scene');
});

test('S4: the best score is saved when a run ends and read when the next begins', async () => {
  const t = await testScene(play, {game, seed: 3});
  t.ctx.state.score = 12;
  const tr = t.world.get(t.ctx.spawn((await import('./components')).block), Transform)!;
  tr.x = player(t).x;
  tr.z = player(t).z;
  t.run(1 / 60);
  assert.equal(t.ctx.state.phase, 'over');
  assert.deepEqual(t.ctx.save((await import('./best')).default).get(), {score: 12, runs: 1});
  assert.equal(t.ctx.state.best, 12);
});

test('S4: the best score survives a reload', async () => {
  const saves = createTestSaves(); // storage shared by every store it opens
  const t = await testScene(play, {game, seed: 3, services: {save: saves.store}});
  t.ctx.state.score = 12;
  const tr = t.world.get(t.ctx.spawn((await import('./components')).block), Transform)!;
  tr.x = player(t).x;
  tr.z = player(t).z;
  t.run(1 / 60); // the hit saves the best score
  assert.equal(t.ctx.state.phase, 'over');
  t.dispose();
  const after = await testScene(play, {game, seed: 3, services: {save: saves.reload()}}); // a fresh store, as a reloaded page opens
  assert.equal(after.ctx.state.best, 12, 'the new run reads the saved best');
  assert.deepEqual(after.ctx.save((await import('./best')).default).get(), {score: 12, runs: 1});
  after.dispose();
  saves.dispose();
});

test('the same seed plays the same run', async () => {
  const run = async () => {
    const t = await testScene(play, {game, seed: 42});
    t.hold('steer', -1);
    t.run(8);
    return JSON.stringify([t.ctx.state, player(t)]);
  };
  assert.equal(await run(), await run());
});
