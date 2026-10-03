import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {validateRenderMask} from './render-mask';
test('independent camera masks keep shared entity visibility intact', () => {
  const actor = new T.Object3D(),
    first = new T.Camera(),
    second = new T.Camera();
  actor.layers.mask = validateRenderMask(2);
  first.layers.mask = validateRenderMask(1);
  second.layers.mask = validateRenderMask(3);
  assert.equal(first.layers.test(actor.layers), false);
  assert.equal(second.layers.test(actor.layers), true);
  assert.equal(actor.visible, true);
  assert.equal(validateRenderMask(0xffffffff), 0xffffffff);
  for (const invalid of [-1, 0.5, NaN, Infinity, 0x100000000]) assert.throws(() => validateRenderMask(invalid));
});
