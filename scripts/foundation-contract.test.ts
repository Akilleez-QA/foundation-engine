import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateRenderMask} from '../src/author/render-mask';
import {OUTPUT_DEFAULTS, OUTPUT_LIMITS, TONE_MAPPINGS, validateSceneOutput} from '../src/author/scene-output';

const contract = JSON.parse(readFileSync(new URL('../schemas/read-only-tools.json', import.meta.url), 'utf8'));

test('read-only tool pins match existing TypeScript validators', () => {
  assert.equal(contract.schema, 'foundation-engine-tools/1');
  assert.equal(contract.version, JSON.parse(readFileSync('package.json', 'utf8')).version);
  assert.deepEqual(
    contract.tools.map((tool: {name: string}) => tool.name),
    ['validate_render_mask', 'validate_scene_output'],
  );
  const [mask, output] = contract.tools;
  for (const tool of contract.tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.inputSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(tool.outputSchema.$schema, tool.inputSchema.$schema);
  }
  const bounds = mask.inputSchema.properties.mask;
  assert.deepEqual(mask.outputSchema, {$schema: mask.inputSchema.$schema, ...bounds});
  for (const value of [bounds.minimum, bounds.maximum]) assert.equal(validateRenderMask(value), value);
  for (const value of [-1, bounds.maximum + 1, 0.5, NaN]) assert.throws(() => validateRenderMask(value));
  const properties = output.inputSchema.properties.output.properties;
  assert.deepEqual(properties, output.outputSchema.properties);
  assert.deepEqual(properties.toneMapping.enum, TONE_MAPPINGS);
  assert.equal(properties.exposure.exclusiveMinimum, OUTPUT_LIMITS.exposure.above);
  assert.equal(properties.exposure.maximum, OUTPUT_LIMITS.exposure.max);
  const input = Object.freeze({toneMapping: 'aces', exposure: 2});
  assert.deepEqual(validateSceneOutput(input), input);
  assert.deepEqual(validateSceneOutput(undefined), OUTPUT_DEFAULTS);
  assert.deepEqual(validateSceneOutput({}), OUTPUT_DEFAULTS);
  assert.throws(() => validateSceneOutput({exposure: 0}));
  assert.throws(() => validateSceneOutput({exposure: 17}));
  assert.throws(() => validateSceneOutput({toneMapping: 'unknown'}));
  assert.throws(() => validateSceneOutput({extra: true}));
});
