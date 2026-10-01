import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../core/ecs/world';
import type {SceneVisit} from '../core/router/handover';
import {sceneId} from './ids';
import {createSceneEntityInspector} from './entity-inspection';

test('scene entity inspection uses the real visit epoch and refuses ended/replaced ownership', () => {
  for (const end of ['visit', 'activity', 'supersede']) {
    const world = new World(); world.spawn();
    const visitAbort = new AbortController(), activity = new AbortController();
    let current = true;
    const visit: SceneVisit = {epoch: 7, scene: sceneId('sample'), params: {}, player: 'local', signal: visitAbort.signal, current: () => current};
    const inspect = createSceneEntityInspector(world, visit, activity.signal);
    assert.equal(inspect({expectedEpoch: 7}).status, 'ready');
    assert.deepEqual(inspect({expectedEpoch: 6}), {status: 'stale', epoch: 7});
    assert.throws(() => inspect({expectedEpoch: NaN}), RangeError);
    if (end === 'visit') visitAbort.abort();
    if (end === 'activity') activity.abort();
    if (end === 'supersede') current = false;
    assert.deepEqual(inspect({expectedEpoch: 7}), {status: 'unavailable'});
  }
});
