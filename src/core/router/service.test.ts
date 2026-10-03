import test from 'node:test';
import assert from 'node:assert/strict';
import {createRouterService} from './service';
import type {HashRouter} from './router';
import type {SceneEntry} from './handover';

const router = {go: () => Promise.resolve(), resolve: () => ({sceneId: 'scene.home'})} as unknown as HashRouter;
const row = (id: string): SceneEntry => ({
  id: id as SceneEntry['id'],
  label: id,
  load: () => null,
  enter: () => ({}) as never,
});

test('the router service keeps the router and the scene rows in the order they were added', () => {
  const s = createRouterService(router);
  assert.equal(s.go, router.go);
  s.scene(row('scene.hall'));
  s.scene(row('scene.shop'));
  assert.deepEqual(
    s.entries().map(e => e.id),
    ['scene.hall', 'scene.shop'],
  );
});

test('a row added twice, or after the shell read the rows, throws', () => {
  const s = createRouterService(router);
  s.scene(row('scene.hall'));
  assert.throws(() => s.scene(row('scene.hall')), /added twice/);
  s.entries();
  assert.throws(() => s.scene(row('scene.shop')), /after the shell read the rows/);
});
