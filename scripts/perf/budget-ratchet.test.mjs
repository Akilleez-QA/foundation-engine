import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkRatchet, findRaises, flattenBudgets, parseTrailers} from './budget-ratchet.mjs';

const data = (draws, extra = {}) => ({app: {firstLoadJsKiB: 500, appReadyMs: {desktop: 4000}}, scenes: {main: {route: '#main', budget: {draws, textureMiB: 16, ports: {low: {draws: 10}}, ...extra}}}});

test('budget keys cover app, scene and port numbers, and nothing else', () => {
  assert.deepEqual([...flattenBudgets(data(40)).keys()].sort(), ['app.appReadyMs.desktop', 'app.firstLoadJsKiB', 'main.draws', 'main.ports.low.draws', 'main.textureMiB']);
});

test('lowering, adding a scene or a metric is not a raise; a larger number or a dropped metric is', () => {
  assert.deepEqual(findRaises(data(40), data(30)), []);
  assert.deepEqual(findRaises(data(40), {...data(40), scenes: {...data(40).scenes, hall: {budget: {draws: 99}}}}), []);
  assert.deepEqual(findRaises(data(40), data(41)), [{key: 'main.draws', old: 40, now: 41}]);
  const dropped = data(40); delete dropped.scenes.main.budget.textureMiB;
  assert.deepEqual(findRaises(data(40), dropped), [{key: 'main.textureMiB', old: 16, now: null}]);
  assert.deepEqual(findRaises(data(40), {...data(40), scenes: {}}), [], 'removing a whole scene removes its budget with it');
});

test('a committed raise passes only with a trailer naming its key and new value', () => {
  const ok = checkRatchet({before: data(40), committed: data(44), working: data(44), trailerLines: ['main.draws 40 -> 44: the new fountain adds 4 draws']});
  assert.equal(ok.ok, true, ok.failures.join('; '));
  const wrong = checkRatchet({before: data(40), committed: data(44), working: data(44), trailerLines: ['main.draws 40 -> 43: stale value']});
  assert.equal(wrong.ok, false);
  assert.match(wrong.failures[0], /main\.draws rose 40 -> 44 without a matching/);
  assert.equal(checkRatchet({before: data(40), committed: data(44), working: data(44), trailerLines: []}).ok, false);
});

test('an uncommitted raise always fails; malformed trailers are reported', () => {
  const r = checkRatchet({before: data(40), committed: data(40), working: data(45), trailerLines: ['main.draws 40 -> 45: reason']});
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /not committed/);
  assert.deepEqual(parseTrailers(['nonsense']).problems.length, 1);
  assert.deepEqual(parseTrailers(['app.firstLoadJsKiB 500 -> 520: three upgrade']).trailers, [{key: 'app.firstLoadJsKiB', old: 500, now: 520, reason: 'three upgrade'}]);
});

test('ratchet: a template\'s budgets carry the template name, so two games never share a trailer key', async () => {
  const {prefixed, prefixOf, findRaises} = await import('./budget-ratchet.mjs');
  assert.equal(prefixOf('templates/arcade/game/budgets.json'), 'arcade/');
  assert.equal(prefixOf('game/budgets.json'), '');
  const before = prefixed({app: {firstLoadJsKiB: 700}, scenes: {main: {budget: {draws: 10}}}}, 'arcade/');
  const after = prefixed({app: {firstLoadJsKiB: 720}, scenes: {main: {budget: {draws: 9}}}}, 'arcade/');
  assert.deepEqual(findRaises(before, after).map(r => r.key), ['arcade/app.firstLoadJsKiB']);
});
