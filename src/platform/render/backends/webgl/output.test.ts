import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {applyOutput, outputProfile} from './output';

test("the default output is a fresh WebGLRenderer's own profile (byte-identical pictures)", () => {
  assert.deepEqual(outputProfile({toneMapping: 'none', exposure: 1}), {
    toneMapping: T.NoToneMapping,
    toneMappingExposure: 1,
  });
});

test("each tone-mapping name maps to three's constant; exposure is the renderer exposure", () => {
  const want = {aces: T.ACESFilmicToneMapping, agx: T.AgXToneMapping, neutral: T.NeutralToneMapping} as const;
  for (const [name, constant] of Object.entries(want)) {
    const profile = outputProfile({toneMapping: name as keyof typeof want, exposure: 0.75});
    assert.deepEqual(profile, {toneMapping: constant, toneMappingExposure: 0.75});
  }
  const renderer = {toneMapping: T.NoToneMapping as T.ToneMapping, toneMappingExposure: 1};
  applyOutput(renderer, {toneMapping: 'aces', exposure: 1.4});
  assert.deepEqual(renderer, {toneMapping: T.ACESFilmicToneMapping, toneMappingExposure: 1.4});
});
