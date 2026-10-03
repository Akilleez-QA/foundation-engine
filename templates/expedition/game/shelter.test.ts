import test from 'node:test';
import assert from 'node:assert/strict';
import {testScene, Shape, Transform} from '@engine';
import shelter from './shelter';
import {preparationBudget} from './shared-preparation';

test('lazy shelter body is ready before headless preparation and entry, and exits release its owner', async () => {
  assert.equal(shelter.id, 'shelter');
  assert.deepEqual(shelter.view?.camera, {position: [0, 7, 8], target: [0, 0, 0], fov: 50});
  assert.equal(shelter.view?.background, 0x18324b);
  assert.equal(shelter.entities, undefined);
  assert.equal(shelter.systems, undefined);
  const baseline = {...preparationBudget.stats};
  const scene = await testScene(shelter);
  try {
    const floor = scene.ctx.named('floor')!;
    const player = scene.ctx.named('player')!;
    assert.ok(floor !== undefined && player !== undefined);
    assert.equal(scene.world.get(floor, Transform)?.y, -0.1);
    assert.equal(scene.world.get(player, Transform)?.y, 0.6);
    assert.equal(scene.world.get(player, Shape)?.kind, 'capsule');
    assert.equal((scene.ctx.state.shelter as {contactReady: boolean}).contactReady, true);
    assert.equal(scene.ctx.state.shelterToken, undefined, 'entry consumes prepared ownership');
    scene.press('expedition-next');
    scene.run(1 / 60);
    assert.deepEqual(scene.went, ['field']);
  } finally {
    shelter.exit?.(scene.ctx);
  }
  assert.equal(preparationBudget.stats.owners, baseline.owners);
  assert.equal(preparationBudget.stats.reservedBytes, baseline.reservedBytes);
  shelter.exit?.(scene.ctx);
  assert.equal(preparationBudget.stats.owners, baseline.owners);
});

test('lazy shelter preparation respects an already cancelled visit before acquiring resources', async () => {
  const owner = new AbortController();
  owner.abort();
  const baseline = {...preparationBudget.stats};
  await assert.rejects(
    shelter.prepare!(
      {
        state: {},
        text: key => key,
        service: () => {
          throw Error('unexpected service acquisition');
        },
      },
      owner.signal,
    ),
    {name: 'AbortError'},
  );
  assert.equal(preparationBudget.stats.owners, baseline.owners);
  assert.equal(preparationBudget.stats.reservedBytes, baseline.reservedBytes);
});
