import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testScene} from '@engine';
import {hasThree} from '@kits/three';
import game from './game';
import courtyard from './courtyard';
import courtyardLit from './courtyard-lit';
import glow from './glow';

test('both courtyards and the lantern scene start and run headless; the three handle exists only when rendered', async () => {
  for (const scene of [courtyard, courtyardLit, glow]) {
    const t = await testScene(scene, {game});
    t.run(1);
    assert.ok(t.world.count > 0, scene.id);
    assert.equal(hasThree(t.ctx), false, 'testScene has no renderer, so no handle');
    t.dispose();
  }
});
