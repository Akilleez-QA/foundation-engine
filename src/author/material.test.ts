import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineMaterial, Material, MATERIAL_DEFAULTS, materialKey, validateMaterial } from './material';

test('defineMaterial fills defaults and copies the repeat it was given', () => {
  const repeat: [number, number] = [2, 3];
  const init = defineMaterial({ texture: 'floor-tiles', repeat, roughness: .5 });
  assert.equal(init.type, Material);
  assert.deepEqual(init.value, { ...MATERIAL_DEFAULTS, texture: 'floor-tiles', repeat: [2, 3], roughness: .5 });
  repeat[0] = 9;
  assert.deepEqual(init.value.repeat, [2, 3]);
});

test('invalid material data is refused with the field named', () => {
  const bad: [Partial<Parameters<typeof defineMaterial>[0]>, RegExp][] = [
    [{ texture: 'Floor Tiles' }, /texture/], [{ texture: 'x'.repeat(65) }, /texture/],
    [{ repeat: [0, 1] }, /repeat/], [{ repeat: [1, 2000] }, /repeat/], [{ repeat: [1] as unknown as [number, number] }, /repeat/],
    [{ wrap: 'tile' as 'repeat' }, /wrap/], [{ roughness: 1.5 }, /roughness/], [{ metalness: -0.1 }, /metalness/],
    [{ emissive: 0x1000000 }, /emissive/], [{ emissiveIntensity: 17 }, /emissiveIntensity/], [{ opacity: NaN }, /opacity/],
    [{ transparent: 'yes' as unknown as boolean }, /transparent/],
  ];
  for (const [input, message] of bad) assert.throws(() => defineMaterial(input), message, JSON.stringify(input));
});

test('the material key changes with every drawn field', () => {
  const base = { ...MATERIAL_DEFAULTS, repeat: [1, 1] as [number, number] };
  validateMaterial(base);
  const keys = new Set([materialKey(base), ...([
    { texture: 'a' }, { repeat: [2, 1] }, { wrap: 'mirror' }, { roughness: .2 }, { metalness: .2 }, { emissive: 1 },
    { emissiveIntensity: 2 }, { opacity: .5 }, { transparent: true },
  ] as const).map(change => materialKey({ ...base, ...change } as typeof base))]);
  assert.equal(keys.size, 10);
});
