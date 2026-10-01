import test from 'node:test';
import assert from 'node:assert/strict';
import { defineAssets, tierAtOrBelow, validateAssetDefs, type AssetDef } from './manifest';

const good = defineAssets([
  {
    id: 'asset.texture.stone-wall',
    kind: 'texture',
    title: 'Stone wall',
    licence: 'CC-BY-4.0',
    provenance: { credit: 'Example Studio', source: { url: 'https://example.com/stone-wall' } },
    variants: [
      { path: 'textures/stone/wall-2048.jpg', format: 'jpg', width: 2048, sha256: 'a'.repeat(64) },
      { path: 'textures/stone/wall-4096.jpg', format: 'jpg', width: 4096 },
    ],
  },
  {
    id: 'asset.model.guide',
    kind: 'model',
    title: 'Space maintenance robot',
    licence: 'CC-BY-4.0',
    provenance: { author: 'Example Author', generatedBy: 'scripts/build-guide.mjs' },
    variants: [{ path: 'models/demo/guide.glb', format: 'glb' }],
  },
]);

test('a well-formed manifest has no problems', () => {
  assert.deepEqual(validateAssetDefs(good), []);
});

test('the gate catches missing licences, bad ids, shared or absolute paths, format and sha mistakes', () => {
  const bad: AssetDef[] = [
    { ...good[0], licence: 'unknown' },
    { ...good[1], id: 'Guide' },
    {
      id: 'asset.texture.rock',
      kind: 'texture',
      title: 'Rock',
      licence: 'CC-BY-4.0',
      provenance: {},
      variants: [
        { path: '/textures/rock.jpg', format: 'png', width: 1024, sha256: 'xyz' },
        { path: 'textures/stone/wall-2048.jpg', format: 'jpg' },
      ],
    },
    { id: 'asset.model.empty', kind: 'texture', title: ' ', licence: 'original', provenance: {}, variants: [] },
  ];
  const problems = validateAssetDefs(bad).map(p => `${p.id}: ${p.problem}`);
  for (const expected of [
    'asset.texture.stone-wall: no licence',
    'Guide: id must be asset.<kind>.<name> in lower case',
    'asset.texture.rock: third-party asset has no author, credit or source',
    "asset.texture.rock: variant path '/textures/rock.jpg' must be relative to public/",
    "asset.texture.rock: variant '/textures/rock.jpg' is not png",
    "asset.texture.rock: variant '/textures/rock.jpg' has a malformed sha256",
    "asset.texture.rock: variant 'textures/stone/wall-2048.jpg' is also claimed by asset.texture.stone-wall",
    "asset.texture.rock: texture variant 'textures/stone/wall-2048.jpg' has no width",
    "asset.model.empty: id segment does not match kind 'texture'",
    'asset.model.empty: no title',
    'asset.model.empty: no variants',
  ])
    assert.ok(problems.includes(expected), `missing: ${expected}\n${problems.join('\n')}`);
  assert.ok(validateAssetDefs([good[0], good[0]]).some(p => p.problem === 'duplicate id'));
});

test('tier order: reference is best, low is worst', () => {
  assert.equal(tierAtOrBelow('low', 'low'), true);
  assert.equal(tierAtOrBelow('high', 'low'), false);
  assert.equal(tierAtOrBelow('low', 'reference'), true);
});

test('documents: an extensionless file is plain text; other extensions still have to match', () => {
  const doc = (path: string, format: AssetDef['variants'][number]['format']): AssetDef => ({
    id: `asset.document.${path.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    kind: 'document',
    title: path,
    licence: 'Apache-2.0',
    provenance: { credit: 'The Draco Authors' },
    variants: [{ path, format }],
  });
  assert.deepEqual(validateAssetDefs([doc('models/draco/LICENSE', 'txt'), doc('notes/README.md', 'md')]), []);
  assert.equal(validateAssetDefs([doc('models/draco/LICENSE', 'md')]).length, 1);
});
