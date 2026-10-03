/** The feature-flag contract test, plus explain() and checks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeatures, featureOverridesSection, featureProblems, type FeatureDef } from './features';
import { must } from '../../testing/must';

const defs: FeatureDef[] = [
  { id: 'dev.test-api', stage: 'dev', default: true, description: 'window.engine' },
  { id: 'ui.minimap', stage: 'stable', default: false, description: 'mini map', detect: () => true },
  { id: 'ui.minimap-labels', stage: 'beta', default: false, description: 'mini map labels', requires: ['ui.minimap'] },
];

test('feature flags: url > override > detected > default; dev-only flags stay off in production', () => {
  const prod = createFeatures(defs, { dev: false, url: 'https://game.test/?flags=ui.minimap-labels', overrides: {} });
  assert.equal(prod.enabled('dev.test-api'), false);
  assert.equal(prod.enabled('ui.minimap'), true);
  assert.equal(prod.enabled('ui.minimap-labels'), true);
  const off = createFeatures(defs, { dev: true, url: 'https://game.test/?flags=-ui.minimap,ui.minimap-labels', overrides: {} });
  assert.equal(off.enabled('ui.minimap-labels'), false, 'requires ui.minimap');
});

test('explain() names each source; overrides beat detection; unknown ids are off', () => {
  const f = createFeatures(defs, { dev: false, url: 'https://game.test/', overrides: { 'ui.minimap': false, constructor: true } });
  assert.deepEqual(f.explain(), [
    { id: 'dev.test-api', on: false, source: 'dev-only' },
    { id: 'ui.minimap', on: false, source: 'override' },
    { id: 'ui.minimap-labels', on: false, source: 'default' },
  ]);
  assert.equal(f.enabled('constructor'), false);
  assert.equal(createFeatures(defs, { dev: false, url: 'https://game.test/?flags=dev.test-api', overrides: {} }).enabled('dev.test-api'), false, 'the URL cannot turn a dev flag on in production');
  assert.equal(createFeatures(defs, { dev: true, url: 'https://game.test/?flags=-dev.test-api', overrides: {} }).enabled('dev.test-api'), false, 'in DEV the URL can turn it off');
  assert.deepEqual(featureProblems(defs), []);
  assert.match(must(featureProblems([{ ...must(defs[2], 'the third flag'), requires: ['nope'] }])[0], 'a problem'), /requires unknown flag nope/);
  assert.deepEqual(featureOverridesSection.parse({ a: true, b: 'yes' }), { a: true });
});

test('negative detection overrides a true default; URL then device overrides win', () => {
  const rows: FeatureDef[] = [{ id: 'demo', stage: 'stable', default: true, description: 'demo', detect: () => false }];
  const read = (url: string, overrides = {}) => createFeatures(rows, { dev: false, url, overrides });
  assert.deepEqual(read('/').explain(), [{ id: 'demo', on: false, source: 'detected' }]);
  assert.equal(read('/', { demo: true }).enabled('demo'), true);
  assert.equal(read('/?flags=-demo', { demo: true }).enabled('demo'), false);
});

test('production refuses dev flags from every source, including URL and device overrides', () => {
  for (const url of ['/', '/?flags=dev.test-api']) for (const overrides of [{}, { 'dev.test-api': true }] as Record<string, boolean>[]) {
    const f = createFeatures(defs, { dev: false, url, overrides });
    assert.equal(f.enabled('dev.test-api'), false);
  }
});

test('cyclic requirements are reported and fail closed; shared dependencies are legal', () => {
  const row = (id: string, requires: string[] = []): FeatureDef => ({ id, requires, stage: 'stable', default: true, description: id });
  const cyclic = [row('a', ['b']), row('b', ['a'])];
  assert.match(featureProblems(cyclic).join('\n'), /cyclic/);
  const flags = createFeatures(cyclic, { dev: true, url: '/', overrides: {} });
  assert.equal(flags.enabled('a'), false);
  assert.equal(flags.enabled('b'), false);
  const diamond = [row('a', ['b', 'c']), row('b', ['d']), row('c', ['d']), row('d')];
  assert.deepEqual(featureProblems(diamond), []);
  assert.equal(createFeatures(diamond, { dev: true, url: '/', overrides: {} }).enabled('a'), true);
});
