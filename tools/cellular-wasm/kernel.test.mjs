import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../../src/kits/procgen/cellular-wasm-bytes.ts', import.meta.url), 'utf8');
const byteText = source.match(/new Uint8Array\(\[([\s\S]*?)\]\)/)[1];
const bytes = Uint8Array.from(
  byteText
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
    .map(Number),
);
const module = new WebAssembly.Module(bytes);
function instance(plane = 1) {
  const pages = Math.ceil((65536 + 2 * plane) / 65536);
  const memory = new WebAssembly.Memory({initial: pages, maximum: pages});
  const {exports} = new WebAssembly.Instance(module, {env: {memory}});
  return {memory, kernel: exports.smooth_chunk, base: exports.__heap_base.value};
}
function reference(input, width, height, birth, survive) {
  return input.map((cell, i) => {
    const x = i % width,
      z = Math.floor(i / width);
    let neighbors = 0;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx,
          nz = z + dz;
        neighbors += nx < 0 || nz < 0 || nx >= width || nz >= height ? 1 : input[nz * width + nx];
      }
    return Number(neighbors >= (cell ? survive : birth));
  });
}

test('source/artifact provenance and minimal module ABI', () => {
  const hash = data => createHash('sha256').update(data).digest('hex');
  assert.ok(source.includes(`Source SHA-256: ${hash(readFileSync(new URL('kernel.rs', import.meta.url)))}`));
  assert.ok(source.includes(`Artifact SHA-256: ${hash(bytes)}`));
  assert.deepEqual(WebAssembly.Module.imports(module), [{module: 'env', name: 'memory', kind: 'memory'}]);
  assert.deepEqual(
    WebAssembly.Module.exports(module)
      .map(v => v.name)
      .sort(),
    ['__heap_base', 'smooth_chunk'],
  );
  assert.equal(instance().base, 65536);
  assert.throws(
    () => new WebAssembly.Instance(module, {env: {memory: new WebAssembly.Memory({initial: 1, maximum: 1})}}),
    WebAssembly.LinkError,
  );
});

test('fixed memory matches Moore-8 reference for thresholds, edges and chunk boundaries', () => {
  for (const [width, height] of [
    [1, 1],
    [1, 17],
    [19, 1],
    [7, 9],
    [127, 65],
    [513, 129],
  ]) {
    const plane = width * height;
    const {memory, kernel, base} = instance(plane);
    assert.ok(memory.buffer.byteLength <= 131072 + 2 * plane);
    const input = new Uint8Array(memory.buffer, base, plane);
    const output = new Uint8Array(memory.buffer, base + plane, plane);
    for (let i = 0; i < plane; i++) input[i] = Number((i * 37 + Math.floor(i / 7)) % 11 < 5);
    const thresholds =
      plane < 100
        ? Array.from({length: 100}, (_, i) => [i % 10, Math.floor(i / 10)])
        : [
            [0, 9],
            [4, 4],
            [5, 3],
            [9, 0],
          ];
    for (const [birth, survive] of thresholds) {
      output.fill(255);
      const expected = reference(input, width, height, birth, survive);
      const before = input.slice();
      for (let start = 0; start < plane; start += 4096) {
        const end = Math.min(start + 4096, plane);
        assert.equal(kernel(base, base + plane, width, height, start, end, birth, survive), 0);
        assert.deepEqual(output.subarray(start, end), expected.subarray(start, end));
        if (end < plane) assert.equal(output[end], 255);
      }
      assert.deepEqual(input, before);
      assert.equal(kernel(base, base + plane, width, height, plane, plane, birth, survive), 0);
    }
    assert.throws(() => memory.grow(1), RangeError);
  }
});

test('invalid ranges, overlaps, thresholds and dimensions reject before any write', () => {
  const {memory, kernel, base} = instance(8192);
  const valid = [base, base + 8192, 128, 64, 0, 4096, 4, 4];
  const invalid = [
    [0, 0],
    [1, base],
    [1, base + 1],
    [0, base + 1],
    [0, memory.buffer.byteLength - 1],
    [1, memory.buffer.byteLength - 1],
    [2, 0],
    [3, 0],
    [2, 0xffffffff],
    [3, 0xffffffff],
    [4, 4097],
    [4, -1],
    [5, 4097],
    [5, 8193],
    [6, 10],
    [7, 10],
  ];
  const all = new Uint8Array(memory.buffer);
  all.fill(173);
  const before = all.slice();
  for (const [index, value] of invalid) {
    const args = valid.slice();
    args[index] = value;
    assert.equal(kernel(...args), 1, `argument ${index} = ${value}`);
    assert.deepEqual(all, before);
  }
});
