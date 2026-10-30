import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defineScene, Name, testScene, Transform} from '../../author';
import {hud} from '../ui';
import {exploreSystem, Interactable, progress} from './index';

const scene = defineScene({
  id: 'hall',
  title: 'Hall',
  entities: [
    [Name({name: 'player'}), Transform()],
    [Transform({x: 1}), Interactable({id: 'lamp', label: 'Switch the lamp'})],
    [Transform({x: -4}), Interactable({id: 'door', label: 'Go out', to: 'garden', toX: 3, toZ: -3})],
  ],
  systems: [exploreSystem()],
});

test('explore: the nearest thing in reach is prompted and used; the use is saved and announced', async () => {
  const t = await testScene(scene);
  t.run(1 / 60);
  assert.equal(t.ctx.state.near, 'lamp');
  assert.equal(hud(t.ctx).read().prompt, 'Switch the lamp');
  t.press('explore-interact');
  t.run(1 / 60);
  assert.deepEqual(t.cues, ['ui.click']);
  assert.deepEqual(t.ctx.save(progress).get(), {used: ['hall/lamp'], visited: ['hall'], last: ''});
});

test('explore: a door goes to its scene with the arrival point; the next scene places the player there', async () => {
  const t = await testScene(scene);
  const me = t.world.get(t.ctx.named('player')!, Transform)!;
  me.x = -3.5;
  t.run(1 / 60);
  assert.equal(t.ctx.state.near, 'door');
  t.press('explore-interact');
  t.run(1 / 60);
  assert.deepEqual(t.went, ['garden']);
  const next = await testScene(scene, {params: {x: '3', z: '-3'}});
  next.run(1 / 60);
  const p = next.world.get(next.ctx.named('player')!, Transform)!;
  assert.deepEqual([p.x, p.z], [3, -3]);
  assert.equal(next.ctx.state.near, null);
  assert.equal(hud(next.ctx).read().prompt, null);
});
