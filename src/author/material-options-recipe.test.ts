// The code of docs/recipes/give-a-shape-a-material.md (material options), run headless (imports point at the author
// API's source instead of '@engine'). The last test checks that the `recipe:begin`…`recipe:end` block still appears in
// the recipe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defineMaterial, defineMesh, defineScene, Material, Mesh, Model, Shape, testScene, Transform } from './index';

// recipe:begin
const gem = defineMesh({ color: 0x40281a, positions: [0, .34, 0, .22, 0, 0, 0, 0, .22, -.22, 0, 0, 0, 0, -.22, 0, -.34, 0],
  indices: [0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 1, 4, 5, 1, 2, 5, 2, 3, 5, 3, 4, 5, 4, 1] });
const looks = [
  // A cel-shaded tree: three flat bands of light instead of a smooth gradient.
  [Transform({ y: 2 }), Shape({ kind: 'cone', size: [2, 2.6, 2], color: 0x2f6b3a }), defineMaterial({ shading: 'toon', toonSteps: 3 })],
  // A faceted, glowing gem from your own geometry (a Mesh has no texture coordinates, so no texture).
  [Transform({ y: .9 }), gem, defineMaterial({ shading: 'flat', emissive: 0xff7a1a, emissiveIntensity: 2.5 })],
  // A leaf drawn from both sides, its transparent pixels cut out (no sorting, unlike `transparent`).
  [Transform({ y: .4, rx: 1.1 }), Shape({ kind: 'plane', size: [.9, 0, 1.3] }), defineMaterial({ texture: 'leaf', alphaCutoff: .5, side: 'double' })],
  // A model, cel-shaded and glowing; its own colours and textures are kept.
  [Transform({ x: 3 }), Model({ asset: 'beacon' }), defineMaterial({ shading: 'toon', emissive: 0x2a6bff, emissiveIntensity: 1.2 })],
];
// recipe:end

test('the recipe rows spawn with valid materials on a shape, a mesh and a model', async () => {
  const t = await testScene(defineScene({ id: 'looks', entities: looks }));
  const shaded = [...t.world.query(Material)].map(([e, m]) => ({ shading: m.shading, mesh: t.world.has(e, Mesh), model: t.world.has(e, Model) }));
  assert.deepEqual(shaded, [
    { shading: 'toon', mesh: false, model: false },
    { shading: 'flat', mesh: true, model: false },
    { shading: 'standard', mesh: false, model: false },
    { shading: 'toon', mesh: false, model: true },
  ]);
});

test('the recipe shows this code', () => {
  const recipe = readFileSync(new URL('../../docs/recipes/give-a-shape-a-material.md', import.meta.url), 'utf8');
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  for (const block of source.split('// recipe:begin\n').slice(1).map(b => b.split('// recipe:end')[0]!))
    assert.ok(recipe.includes(block), `recipe is missing:\n${block}`);
});
