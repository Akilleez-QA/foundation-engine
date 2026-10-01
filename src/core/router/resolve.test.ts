import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_REDIRECT_HOPS, redirectProblems, resolveRoute, routesOf, splitQuery, withQuery, type RedirectDef } from './resolve';
import { buildRouteTables, routeTableProblems, type SceneRow } from './scenes';

const scenes: SceneRow[] = [
  { id: 'scene.menu', kind: 'menu', routes: [{ hash: '#scene/menu' }], title: 'Menu' },
  { id: 'scene.level', kind: 'level', routes: [{ hash: '#scene/level' }], title: 'Level' },
  { id: 'scene.bonus', kind: 'level', routes: [{ hash: '#scene/bonus-easy', params: { difficulty: 'easy' } }, { hash: '#scene/bonus-hard', params: { difficulty: 'hard' } }], title: 'Bonus', parent: 'scene.level' },
];
const routes = routesOf(scenes);
const old: RedirectDef = { id: 'redirect.old-level', from: /^#old\/level=(\d+)$/, to: '#scene/level', params: g => ({ n: g[0] }), note: 'test' };

test('an exact route wins and carries its params; the query adds params; a redirect carries its params and its trail', () => {
  assert.deepEqual(resolveRoute('#scene/bonus-hard', routes, [old]), { sceneId: 'scene.bonus', hash: '#scene/bonus-hard', params: { difficulty: 'hard' } });
  assert.deepEqual(resolveRoute('#scene/level?n=3&seed=7', routes, []), { sceneId: 'scene.level', hash: '#scene/level', params: { n: '3', seed: '7' } });
  assert.deepEqual(resolveRoute('#old/level=4', routes, [old]), { sceneId: 'scene.level', hash: '#scene/level', params: { n: '4' }, redirectedFrom: ['#old/level=4'], via: ['redirect.old-level'] });
  assert.equal(resolveRoute('#old/level=4?n=9', routes, [old]).params.n, '9', 'the address query wins over the redirect row');
});

test('query helpers: split and write, keys sorted so one set of params is one address', () => {
  assert.deepEqual(splitQuery('#scene/a?x=1&y=two'), ['#scene/a', { x: '1', y: 'two' }]);
  assert.deepEqual(splitQuery('#scene/a'), ['#scene/a', {}]);
  assert.equal(withQuery('#scene/a', { y: '2', x: '1' }), '#scene/a?x=1&y=2');
  assert.equal(withQuery('#scene/a', {}), '#scene/a');
});

test('chained redirects merge params; $n substitutes groups; unknown hashes fall back to the first scene', () => {
  const rows: RedirectDef[] = [
    { id: 'redirect.a', from: /^#a\/(\w+)$/, to: '#b/$1', params: { from: 'a' }, note: 't' },
    { id: 'redirect.b', from: /^#b\/(\w+)$/, to: '#scene/$1', note: 't' },
  ];
  const r = resolveRoute('#a/level', routes, rows);
  assert.equal(r.sceneId, 'scene.level'); assert.deepEqual(r.params, { from: 'a' }); assert.deepEqual(r.via, ['redirect.a', 'redirect.b']);
  const lost = resolveRoute('#nowhere', routes, rows);
  assert.equal(lost.sceneId, 'scene.menu'); assert.equal(lost.hash, '#scene/menu'); assert.deepEqual(lost.redirectedFrom, ['#nowhere']);
});

test('the hop limit stops a cycle; redirectProblems reports cycles, dead ends, shadows and duplicate claims', () => {
  const cycle: RedirectDef[] = [{ id: 'redirect.x', from: '#x', to: '#y', note: 't' }, { id: 'redirect.y', from: '#y', to: '#x', note: 't' }];
  const r = resolveRoute('#x', routes, cycle);
  assert.equal(r.hash, '#scene/menu'); assert.equal(r.via?.length, MAX_REDIRECT_HOPS);
  const problems = redirectProblems([...routes, { sceneId: 'scene.level', hash: '#scene/menu' }], [...cycle,
    { id: 'redirect.shadow', from: '#scene/level', to: '#scene/menu', note: 't' },
    { id: 'redirect.dead', from: /^#dead$/, to: '#nope', note: 't' }]);
  assert.ok(problems.some(p => /redirect\.x does not reach a route/.test(p)));
  assert.ok(problems.some(p => /redirect\.shadow shadows a live route/.test(p)));
  assert.ok(problems.some(p => /redirect\.dead does not reach a route/.test(p)));
  assert.ok(problems.some(p => /two scenes claim #scene\/menu/.test(p)));
  assert.deepEqual(redirectProblems(routes, [old]), []);
});

test('the registries validate rows: ids, hash routes, parents, notes and stateful patterns', () => {
  assert.deepEqual(routeTableProblems(buildRouteTables(scenes, [old], 'test')), []);
  const bad = buildRouteTables(
    [{ id: 'scene.x', kind: 'level', routes: [{ hash: 'game/x' }], title: 'X', parent: 'scene.gone' }, { ...scenes[0] }],
    [{ id: 'redirect.g', from: /^#g$/g, to: '#scene/menu', note: '' }], 'test');
  const problems = routeTableProblems(bad);
  assert.ok(problems.some(p => /route 'game\/x' is not a hash route/.test(p)));
  assert.ok(problems.some(p => /parent 'scene.gone' does not exist/.test(p)));
  assert.ok(problems.some(p => /has no note/.test(p)));
  assert.ok(problems.some(p => /global \(\/g\) pattern/.test(p)));
});
