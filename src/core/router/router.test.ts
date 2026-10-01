import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRouteTables, type SceneRow } from './scenes';
import { createHashRouter, type RouterWindow } from './router';
import type { RedirectDef } from './resolve';

const scenes: SceneRow[] = [
  { id: 'scene.menu', kind: 'menu', routes: [{ hash: '#scene/menu' }], title: 'Menu' },
  { id: 'scene.level', kind: 'level', routes: [{ hash: '#scene/level' }], title: 'Level' },
  { id: 'scene.bonus', kind: 'level', routes: [{ hash: '#scene/bonus-easy', params: { difficulty: 'easy' } }, { hash: '#scene/bonus-hard', params: { difficulty: 'hard' } }], title: 'Bonus' },
];
const redirects: RedirectDef[] = [
  { id: 'redirect.old-level', from: /^#old\/level=(\d+)$/, to: '#scene/level', params: g => ({ n: g[0] }), note: 't' },
  { id: 'redirect.unknown', from: /^#scene\//, to: '#scene/menu', address: 'keep', note: 't' },
];

/** A window whose hash assignment queues a hashchange (as a browser does) and records every address write. */
function fakeWindow(hash = '') {
  const writes: string[] = [];
  let onHash: (() => void) | null = null;
  const queued: (() => void)[] = [];
  const win: RouterWindow & { flush(): void; writes: string[] } = {
    writes,
    location: {
      get hash() { return hash; },
      set hash(h: string) { writes.push('assign ' + h); if (h !== hash) { hash = h; queued.push(() => onHash?.()); } },
    },
    history: { replaceState(_d: unknown, _u: string, url?: string | URL | null) { writes.push('replace ' + String(url)); hash = String(url); } },
    addEventListener(_t, fn) { onHash = fn; },
    flush() { while (queued.length) queued.shift()!(); },
  };
  return win;
}

test('go writes the scene address; fixed params pick a route; other params travel in the query', () => {
  const win = fakeWindow('#scene/menu'), router = createHashRouter(buildRouteTables(scenes, redirects, 'test'), win);
  const seen: unknown[] = [];
  router.listen(() => { const { resolved } = router.arrive(); seen.push([resolved.sceneId, resolved.params]); });
  assert.equal(router.href('scene.bonus', { difficulty: 'hard' }), '#scene/bonus-hard');
  assert.equal(router.href('scene.bonus'), '#scene/bonus-easy');
  assert.equal(router.href('scene.bonus', { difficulty: 'hard', seed: '4' }), '#scene/bonus-hard?seed=4');
  assert.equal(router.href('scene.level', { n: '3' }), '#scene/level?n=3');
  void router.go('scene.level', { params: { n: '3' } }); win.flush();
  void router.go('scene.bonus', { params: { difficulty: 'hard' } }); win.flush();
  assert.deepEqual(win.writes, ['assign #scene/level?n=3', 'assign #scene/bonus-hard']);
  assert.deepEqual(seen, [['scene.level', { n: '3' }], ['scene.bonus', { difficulty: 'hard' }]]);
});

test('the same address: ignore by default, re-enter on request (restart); replace rewrites the entry and runs the listeners now', () => {
  const win = fakeWindow('#scene/menu'), router = createHashRouter(buildRouteTables(scenes, redirects, 'test'), win);
  let runs = 0;
  router.listen(() => { runs++; router.arrive(); });
  void router.go('scene.menu'); win.flush();
  assert.equal(runs, 0, 'assigning the same hash does nothing');
  void router.go('scene.menu', { again: 'reenter' });
  assert.equal(runs, 1);
  void router.go('scene.level', { replace: true });
  assert.equal(runs, 2); assert.deepEqual(win.writes, ['replace #scene/level'], 'the same address was never written');
});

test('arrive() applies a rewriting redirect with replaceState, keeping the query; a keep row leaves the address', () => {
  const win = fakeWindow('#scene/menu'), router = createHashRouter(buildRouteTables(scenes, redirects, 'test'), win);
  const seen: unknown[] = [];
  router.listen(() => { const { resolved } = router.arrive(); seen.push([win.location.hash, resolved.sceneId, resolved.params]); });
  router.follow('#old/level=4?seed=2'); win.flush();
  router.follow('#scene/nope'); win.flush();
  assert.deepEqual(seen, [['#scene/level?seed=2', 'scene.level', { n: '4', seed: '2' }], ['#scene/nope', 'scene.menu', {}]]);
  assert.deepEqual(win.writes, ['assign #old/level=4?seed=2', 'replace #scene/level?seed=2', 'assign #scene/nope']);
});

test('reenter runs the route listeners once at the current address and writes nothing', async () => {
  const win = fakeWindow('#scene/level'), router = createHashRouter(buildRouteTables(scenes, redirects, 'test'), win);
  const seen: unknown[] = [];
  router.listen(() => seen.push(router.arrive().resolved.sceneId));
  await router.reenter('player-changed');
  assert.deepEqual(seen, ['scene.level']);
  assert.deepEqual(win.writes, [], 'the address is not written');
});

test('configured fallback uses canonical route and fixed params without replacing valid links or redirects', () => {
  const tables = buildRouteTables(scenes, redirects, 'test'), win = fakeWindow('');
  const router = createHashRouter(tables, win, 'scene.bonus');
  for (const hash of ['', '#', '#missing?ignored=1']) {
    assert.equal(router.resolve(hash).sceneId, 'scene.bonus');
    assert.equal(router.resolve(hash).hash, '#scene/bonus-easy');
    assert.deepEqual(router.resolve(hash).params, { difficulty: 'easy' });
  }
  assert.equal(router.resolve('#scene/level?n=3').sceneId, 'scene.level');
  assert.deepEqual(router.resolve('#old/level=4?seed=2').params, { n: '4', seed: '2' });
  router.arrive();
  assert.deepEqual(win.writes, [], 'fallback does not force an address rewrite');
  assert.equal(createHashRouter(tables, win).resolve().sceneId, 'scene.menu', 'omitting fallback preserves low-level behavior');
  assert.throws(() => createHashRouter(tables, win, 'scene.absent'));
});
