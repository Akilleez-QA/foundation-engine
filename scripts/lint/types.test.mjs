import test from 'node:test';
import assert from 'node:assert/strict';
import {check, folderOf, scan} from './types.mjs';

const rules = text => scan(text).map(f => `${f.rule}:${f.line}${f.escaped ? ':escaped' : ''}`);

test('lint:types: explicit any is found in every type position', () => {
  assert.deepEqual(rules('let a: any;\nconst b = c as any;\nconst d = <any>e;\nlet f: any[];\nlet g: Map<string, any>;\nfunction h(x: any) {}'),
    ['explicit-any:1', 'explicit-any:2', 'explicit-any:3', 'explicit-any:4', 'explicit-any:5', 'explicit-any:6']);
});

test('lint:types: comments, strings and identifiers named any are not types', () => {
  assert.deepEqual(rules('// any: any\nconst any = 1;\nconst s = "as any";\nconst t = { any: true };\nconst u = t.any;'), []);
});

test('lint:types: double casts through unknown are found, single casts are not', () => {
  assert.deepEqual(rules('const a = b as unknown as C;\nconst d = (e as unknown) as F;\nconst g = <H><unknown>i;\nconst j = k as unknown;\nconst l = m as N;'),
    ['unknown-cast:1', 'unknown-cast:2', 'unknown-cast:3']);
});

test('lint:types: an escape needs the marker and a written reason, on the line or the line above', () => {
  assert.deepEqual(rules('// lint:allow-unknown-cast three.js keeps this field private\nconst a = b as unknown as C;\nconst d = e as unknown as F; // lint:allow-unknown-cast DOM interop\n\nconst g = h as unknown as I; // lint:allow-unknown-cast\n\nlet j: any; // lint:allow-unknown-cast wrong marker\n\nlet k: any; // lint:allow-any a declared external shape'),
    ['unknown-cast:2:escaped', 'unknown-cast:3:escaped', 'unknown-cast:5', 'explicit-any:7', 'explicit-any:9:escaped']);
});

test('lint:types: test files ratchet per folder; other files are strict', () => {
  assert.equal(folderOf('src/platform/render/a.test.ts'), 'src/platform');
  assert.equal(folderOf('scripts/perf/a.test.ts'), 'scripts');
});

test('lint:types: the engine sources pass', () => {
  assert.deepEqual(check().failures, []);
});
