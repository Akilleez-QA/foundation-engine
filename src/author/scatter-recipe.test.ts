// The code of docs/recipes/scatter-grass-and-rocks.md, run headless (imports point at the author API's source instead of
// '@engine'). The last test checks that the `recipe:begin`…`recipe:end` block still appears in the recipe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defineMaterial, defineMesh, defineScatter, defineScene, sceneScatter, Scatter, testScene, Transform } from './index';

// recipe:begin
const rock = defineMesh({ positions: [0, .45, 0, .6, 0, 0, 0, 0, .6, -.6, 0, 0, 0, 0, -.6, 0, -.2, 0],
  indices: [0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 1, 4, 5, 1, 2, 5, 2, 3, 5, 3, 4, 5, 4, 1], color: 0x8a847c }).value;
const LANTERNS: [number, number][] = [[-9, -9], [9, -9], [-9, 9], [9, 9]];

export const courtyard = defineScene({
  id: 'courtyard',
  title: 'Courtyard',
  scatter: sceneScatter(),
  entities: [
    // Grass along the inside of the walls: 1,400 cones, one draw, each a little different.
    [Transform(), defineScatter({ shape: { kind: 'cone', size: [.12, .45, .12] }, color: 0x3f7a3c, colorJitter: [.03, .1, .08],
      area: { kind: 'edge', rect: [-11, -11, 11, 11], width: 2.2 }, count: 1400, seed: 3,
      y: .2, scale: [.6, 1.5], ry: 'random', tilt: .25 })],
    // Rocks in a ring around the fountain, flat-shaded through the entity's Material.
    [Transform(), defineScatter({ mesh: rock, area: { kind: 'ring', radius: [3, 6.5] }, count: 60, seed: 4,
      scale: [.4, 1.2], ry: 'random' }), defineMaterial({ shading: 'flat' })],
    // Lantern posts at exact positions; essential, so a lighter quality preset never drops one.
    [Transform({ y: 1.1 }), defineScatter({ shape: { kind: 'cylinder', size: [.14, 2.2, .14] }, color: 0x1c1f26,
      points: LANTERNS, essential: true }), defineMaterial({ metalness: .8, roughness: .4 })],
  ],
});
// recipe:end

test('the recipe scene admits its three scatters with every copy at the reference density', async () => {
  const t = await testScene(courtyard);
  assert.deepEqual(t.scatter.stats, { scatters: 3, instances: 1464, requested: 1464, refused: { scatters: 0, instances: 0, invalid: 0 } });
  const low = await testScene(courtyard, { scatterDensity: 0.35 });
  const counts = [...low.world.query(Scatter)].map(([e]) => low.scatter.placement(e)!.count);
  assert.equal(counts[2], 4, 'essential posts are kept');
  assert.ok(counts[0]! < 600 && counts[1]! < 60);
});

test('the recipe shows this code', () => {
  const recipe = readFileSync(new URL('../../docs/recipes/scatter-grass-and-rocks.md', import.meta.url), 'utf8');
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  for (const block of source.split('// recipe:begin\n').slice(1).map(b => b.split('// recipe:end')[0]!))
    assert.ok(recipe.includes(block), `recipe is missing:\n${block}`);
});
