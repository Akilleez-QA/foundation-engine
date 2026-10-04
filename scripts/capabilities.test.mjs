import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FEATURES, buildManifest, staleFiles} from './capabilities.mjs';

const manifest = buildManifest();
const feature = id => manifest.features.find(f => f.id === id);

test('the manifest reads shipped features from the code', () => {
  for (const id of ['VIS-01', 'VIS-02', 'VIS-03', 'VIS-04', 'VIS-05', 'VIS-06', 'FX-01', 'GEN-02', 'MP-01', 'KTX2'])
    assert.equal(feature(id)?.shipped, true, `${id} shipped`);
  assert.ok(manifest.engine.values.includes('PointLight'));
  assert.ok(manifest.engine.types.includes('BuildBrief'), 'type exports are listed apart from values');
  assert.ok(!manifest.engine.values.includes('BuildBrief'));
  assert.ok(manifest.kits.find(k => k.name === 'network')?.exports.includes('createSession'));
  assert.ok(manifest.scripts.includes('check'));
  assert.ok(manifest.templates.includes('showcase'));
});

test('a feature whose evidence is absent is not shipped', () => {
  // VIS-09 is the @kits/three kit; this assertion moves with it when the kit lands.
  if (!manifest.kits.some(k => k.name === 'three')) assert.equal(feature('VIS-09')?.shipped, false);
  const post = manifest.knobs.find(k => k.id === 'post.mode');
  assert.ok(post, 'post.mode is a registered knob');
  assert.equal(feature('POST-01')?.shipped, post.readBy.length > 0);
});

test('every feature row names evidence, and IDs are unique', () => {
  assert.equal(new Set(FEATURES.map(f => f.id)).size, FEATURES.length);
  for (const f of FEATURES) assert.ok(f.evidence.length > 0, f.id);
});

test('docs/capabilities.json and docs/capabilities.md match the code', async () => {
  assert.deepEqual(await staleFiles(), [], 'run npm run capabilities');
});
