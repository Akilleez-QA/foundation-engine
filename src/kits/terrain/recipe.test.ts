import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTerrainRecipe, terrainRecipeSlices, type TerrainRecipe, type TerrainOperator } from './recipe';
import { createSampledSurface } from './surface';
const recipe: TerrainRecipe = { formatVersion: 1, id: 'recipe', revision: 1, originX: 4, originZ: -2, spacing: 1, cellsX: 2, cellsZ: 2, seed: 7, steps: [
  { operator: 'plane', version: 1, parameters: 'null' }, { operator: 'scale', version: 1, parameters: '2' }, { operator: 'mark', version: 1, parameters: '38' },
] };
const operators: TerrainOperator[] = [
  { id: 'plane', version: 1, reads: [], writes: ['height'], validate: v => v === null, evaluate: p => ({ height: 2 * p.x - 3 * p.z + 5 }) },
  { id: 'scale', version: 1, reads: ['height'], writes: ['height'], validate: v => typeof v === 'number', evaluate: (_p, f, v) => ({ height: f.height! * (v as number) + 1 }) },
  { id: 'mark', version: 1, reads: ['height'], writes: ['material', 'exclusion'], validate: v => typeof v === 'number', evaluate: (_p, f, v) => ({ material: f.height! >= (v as number) ? 9 : 3, exclusion: f.height! >= (v as number) ? 1 : 0 }) },
];
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

test('T2 analytic plane/order oracle and field-based metadata work with creator operators', () => {
  const surface = evaluateTerrainRecipe(recipe, operators);
  assert.deepEqual(surface.mesh().positions.filter((_v, i) => i % 3 === 1), [39, 43, 47, 33, 37, 41, 27, 31, 35]);
  near(surface.sample(4.2, -1.3)!.height, 35.6);
  const n = surface.sample(4.2, -1.3)!.normal;
  near(n.x, -4 / Math.sqrt(53)); near(n.y, 1 / Math.sqrt(53)); near(n.z, 6 / Math.sqrt(53));
  assert.equal(surface.vertex(0, 0).material, 9); assert.equal(surface.vertex(0, 0).excluded, true);
  assert.equal(surface.vertex(2, 2).material, 3); assert.equal(surface.vertex(2, 2).excluded, false);
  const reversed = evaluateTerrainRecipe({ ...recipe, steps: [recipe.steps[1]!, recipe.steps[0]!] }, operators);
  near(reversed.sample(4.2, -1.3)!.height, 17.3);
});

test('T2 unrelated field operators can read only declared fields and preserve omitted fields', () => {
  const definitions: TerrainOperator[] = [
    { id: 'stamp', version: 3, reads: [], writes: ['material'], validate: () => true, evaluate: p => ({ material: p.ix + 1 }) },
    { id: 'exclude', version: 1, reads: ['material'], writes: ['exclusion'], validate: () => true, evaluate: (_p, f) => {
      assert.deepEqual(Object.keys(f), ['material']); assert.equal(f.height, undefined); assert.ok(Object.isFrozen(f));
      return { exclusion: f.material === 2 ? 1 : 0 };
    } },
  ];
  const surface = evaluateTerrainRecipe({ ...recipe, steps: [{ operator: 'stamp', version: 3, parameters: '{}' }, { operator: 'exclude', version: 1, parameters: '{}' }] }, definitions);
  assert.equal(surface.vertex(1, 0).material, 2); assert.equal(surface.vertex(1, 0).excluded, true); assert.equal(surface.vertex(0, 0).y, 0);
});

test('T2 captures input and executable references before callbacks and evaluates one row per slice', () => {
  const steps = recipe.steps.map(step => ({ ...step })), definitions = operators.map(o => ({ ...o, reads: [...o.reads], writes: [...o.writes] }));
  const input = { ...recipe, steps }, work = terrainRecipeSlices(input, definitions);
  input.originX = 100; steps[0]!.operator = 'missing'; definitions[0]!.evaluate = () => ({ height: 999 }); definitions[1]!.reads.length = 0;
  assert.equal(work.next().done, false); assert.equal(work.next().done, false); assert.equal(work.next().done, false);
  const done = work.next(); assert.equal(done.done, true);
  if (done.done) assert.deepEqual(createSampledSurface(done.value).mesh(), evaluateTerrainRecipe(recipe, operators).mesh());
  let calls = 0;
  const counted = [{ ...operators[0]!, evaluate: (p: Parameters<TerrainOperator['evaluate']>[0]) => { calls++; return { height: p.x }; } }];
  const cancelled = terrainRecipeSlices({ ...recipe, steps: [recipe.steps[0]!] }, counted); cancelled.next(); assert.equal(calls, 3);
  cancelled.return(undefined as never); assert.equal(cancelled.next().done, true); assert.equal(calls, 3);
});

test('T2 parameter trees and callback inputs are frozen; failure never returns a partial surface', () => {
  const definition: TerrainOperator = { id: 'frozen', version: 1, reads: ['height'], writes: ['height'], validate: value => {
    assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen((value as { nested: object }).nested)); return true;
  }, evaluate: point => { (point as { x: number }).x = 99; return { height: 1 }; } };
  const input = { ...recipe, steps: [{ operator: 'frozen', version: 1, parameters: '{"nested":{"value":3}}' }] };
  assert.throws(() => evaluateTerrainRecipe(input, [definition]), TypeError);
  assert.throws(() => evaluateTerrainRecipe(recipe, [{ ...operators[0]!, evaluate: () => { throw Error('creator failure'); } }, ...operators.slice(1)]), /creator failure/);
  assert.equal(evaluateTerrainRecipe(recipe, operators).vertex(0, 0).y, 39);
});

test('T2 unknown versions, malformed payloads, undeclared writes and invalid outputs reject', () => {
  const single = { ...recipe, steps: [recipe.steps[0]!] };
  for (const parameters of ['{bad', '1e999', '[[[0]]]', '"€€€€"', '[1,2,3]']) {
    assert.throws(() => terrainRecipeSlices({ ...single, steps: [{ ...single.steps[0]!, parameters }] }, operators, { maxParameterBytes: 12, maxParameterDepth: 1, maxParameterNodes: 3 }));
  }
  for (const input of [{ ...single, formatVersion: 2 }, { ...single, seed: -1 }, { ...single, cellsX: 257 }, { ...single, originX: 1e20 }, { ...single, steps: [{ ...single.steps[0]!, version: 8 }] }, { ...single, steps: Array(65).fill(single.steps[0]) }]) assert.throws(() => terrainRecipeSlices(input as TerrainRecipe, operators));
  assert.throws(() => terrainRecipeSlices(single, [operators[0]!, operators[0]!]));
  assert.throws(() => terrainRecipeSlices(single, [{ ...operators[0]!, validate: () => false }]));
  for (const output of [Promise.resolve({ height: 1 }), new Date(), { height: NaN }, { height: 1e40 }, { material: 1 }, { unknown: 1 }, { [Symbol('field')]: 1 }]) assert.throws(() => evaluateTerrainRecipe(single, [{ ...operators[0]!, evaluate: () => output as ReturnType<TerrainOperator['evaluate']> }]));
  for (const output of [{ material: 1.5 }, { exclusion: 2 }]) assert.throws(() => evaluateTerrainRecipe(single, [{ ...operators[0]!, writes: ['material', 'exclusion'], evaluate: () => output as ReturnType<TerrainOperator['evaluate']> }]));
});

test('T2 final-sample Float32 rounding preserves double precision between ordered operators', () => {
  const defs: TerrainOperator[] = [
    { id: 'large', version: 1, reads: [], writes: ['height'], validate: () => true, evaluate: () => ({ height: 16777217 }) },
    { id: 'subtract', version: 1, reads: ['height'], writes: ['height'], validate: () => true, evaluate: (_p, f) => ({ height: f.height! - 16777216 }) },
  ];
  const surface = evaluateTerrainRecipe({ ...recipe, steps: defs.map(d => ({ operator: d.id, version: d.version, parameters: 'null' })) }, defs);
  assert.equal(surface.vertex(0, 0).y, 1);
});


test('T2 validators must return true synchronously and cannot change later captured definitions or steps', () => {
  const single = { ...recipe, steps: [recipe.steps[0]!] };
  for (const result of [Promise.resolve(true), 'yes', 1, {}, false, undefined]) {
    const validate = (() => result) as unknown as TerrainOperator['validate'];
    assert.throws(() => terrainRecipeSlices(single, [{ ...operators[0]!, validate }]), /rejected parameters/);
  }
  const definitions = operators.map(operator => ({ ...operator, reads: [...operator.reads], writes: [...operator.writes] }));
  const steps = recipe.steps.map(step => ({ ...step }));
  definitions[0]!.validate = () => {
    definitions[1]!.validate = () => false;
    definitions[1]!.evaluate = () => ({ height: 999 });
    definitions[1]!.reads.length = 0;
    definitions[1]!.writes.length = 0;
    steps[1]!.parameters = '99';
    steps[1]!.operator = 'missing';
    return true;
  };
  const surface = evaluateTerrainRecipe({ ...recipe, steps }, definitions);
  assert.deepEqual(surface.mesh().positions.filter((_v, i) => i % 3 === 1), [39, 43, 47, 33, 37, 41, 27, 31, 35]);
});


test('T2 caller array methods and iterators cannot bypass bounded detached snapshots', () => {
  const poison = <T>(array: T[]): T[] => {
    Object.defineProperty(array, 'map', { value: () => { throw Error('caller map executed'); } });
    Object.defineProperty(array, 'some', { value: () => { throw Error('caller some executed'); } });
    Object.defineProperty(array, Symbol.iterator, { value: () => { throw Error('caller iterator executed'); } });
    return array;
  };
  const reads = poison(['height'] as ('height' | 'material')[]);
  Object.defineProperty(reads, '0', { get() { reads.push('material'); return 'height'; } });
  const writes = poison(['height'] as ('height' | 'material')[]);
  Object.defineProperty(writes, '0', { get() { writes.push('material'); return 'height'; } });
  let calls = 0;
  const operator: TerrainOperator = { id: 'bounded', version: 1, reads, writes, validate: () => true,
    evaluate: (_p, f) => { calls++; assert.deepEqual(Object.keys(f), ['height']); return { height: f.height! + 1 }; } };
  const definitions = poison([operator]);
  Object.defineProperty(definitions, '0', { get() { definitions.push(operator); return operator; } });
  const step = { operator: 'bounded', version: 1, parameters: 'null' }, steps = poison([step]);
  Object.defineProperty(steps, '0', { get() { steps.push(step); return step; } });
  let stepReads = 0;
  const input = { ...recipe, get steps() { stepReads++; return steps; } };
  const surface = evaluateTerrainRecipe(input, definitions);
  assert.equal(stepReads, 1); assert.equal(calls, 9); assert.equal(surface.vertex(0, 0).y, 1);
  assert.equal(definitions.length, 2); assert.equal(steps.length, 2); assert.equal(reads.length, 2); assert.equal(writes.length, 2);
});
