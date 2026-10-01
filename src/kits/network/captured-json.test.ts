import test from 'node:test';
import assert from 'node:assert/strict';
import { captureJson } from './captured-json';
const limits = { maxBytes: 65536, maxNodes: 4096, maxDepth: 4096 };
test('canonical command identity orders keys recursively and preserves array order and prototype-named data', () => {
  const a = captureJson('{"z":[{"b":2,"a":1},3],"__proto__":{"x":4},"a":-0}', limits);
  const b = captureJson(' {"a":0,"__proto__":{"x":4},"z":[{"a":1,"b":2},3]} ', limits);
  assert.equal(a.json, b.json);
  assert.equal(a.json, '{"__proto__":{"x":4},"a":0,"z":[{"a":1,"b":2},3]}');
  assert.deepEqual(JSON.parse(a.json), a.value);
  assert.ok(Object.isFrozen(a.value));
  assert.notEqual(captureJson('[1,2]', limits).json, captureJson('[2,1]', limits).json);
});
test('canonical capture defines duplicate keys and escapes without normalizing Unicode', () => {
  assert.equal(captureJson('{"x":1,"x":2}', limits).json, '{"x":2}');
  assert.equal(captureJson('"\\u0061"', limits).json, '"a"');
  assert.notEqual(captureJson('"é"', limits).json, captureJson('"é"', limits).json);
  assert.throws(() => captureJson('1e999', limits));
});
test('canonical and raw byte limits both apply and semantic rejection publishes nothing', () => {
  assert.throws(() => captureJson('1e3', { ...limits, maxBytes: 3 }));
  assert.throws(() => captureJson('    1', { ...limits, maxBytes: 3 }));
  assert.throws(() => captureJson('{"allowed":false}', limits, () => false));
  assert.throws(() => captureJson('null', { ...limits, maxNodes: 0 }));
  assert.equal(captureJson('1e3', { ...limits, maxBytes: 4 }).json, '1000');
});
test('bounded deep input serializes iteratively', () => {
  const json = '['.repeat(2000) + '0' + ']'.repeat(2000);
  assert.equal(captureJson(json, limits).json, json);
});
