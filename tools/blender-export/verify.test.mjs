import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {verify} from './verify.mjs';
const source = new URL('./game/public/models/metre-block.glb', import.meta.url);
function variant(change, rehash = true, binaryChange = () => {}) {
  const bytes = readFileSync(source),
    size = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + size));
  change(json);
  let chunk = Buffer.from(JSON.stringify(json));
  chunk = Buffer.concat([chunk, Buffer.alloc((4 - (chunk.length % 4)) % 4, 32)]);
  const head = Buffer.from(bytes.subarray(0, 20)),
    rest = bytes.subarray(20 + size);
  head.writeUInt32LE(20 + chunk.length + rest.length, 8);
  head.writeUInt32LE(chunk.length, 12);
  const result = Buffer.concat([head, chunk, rest]);
  binaryChange(json, result, 20 + chunk.length + 8);
  const dir = mkdtempSync(join(tmpdir(), 'foundation-blender-validator-')),
    file = join(dir, 'sample.glb');
  const manifest = JSON.parse(
    readFileSync(new URL('./game/public/models/metre-block.provenance.json', import.meta.url)),
  );
  if (rehash) manifest.sha256 = createHash('sha256').update(result).digest('hex');
  writeFileSync(file, result);
  writeFileSync(join(dir, 'sample.provenance.json'), JSON.stringify(manifest));
  return {file, close: () => rmSync(dir, {recursive: true, force: true})};
}
test('S1: checked-in Blender sample meets the physical export contract', async () => {
  const report = await verify(fileURLToPath(source));
  assert.equal(report.triangles, 12);
  assert.equal(report.materials, 2);
});
test('a changed artifact cannot retain the previous provenance hash', async () => {
  const v = variant(j => {
    j.asset.generator = 'changed';
  }, false);
  try {
    await assert.rejects(verify(v.file), /asset hash/);
  } finally {
    v.close();
  }
});
test('rehashing a sample with an external buffer does not authorize a fetch', async () => {
  const v = variant(j => {
    j.buffers[0].uri = 'https://invalid.example/not-allowed.bin';
  });
  try {
    await assert.rejects(verify(v.file), /embedded/);
  } finally {
    v.close();
  }
});
test('rehashing a shifted export does not satisfy metre bounds and base pivot', async () => {
  const v = variant(j => {
    j.nodes[j.scenes[j.scene].nodes[0]].translation = [0, 1, 0];
  });
  try {
    await assert.rejects(verify(v.file));
  } finally {
    v.close();
  }
});

test('decoded positions outside the metre bounds fail even with unchanged accessor bounds and a matching hash', async () => {
  const v = variant(
    () => {},
    true,
    (json, bytes, binStart) => {
      const accessor = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
      assert.equal(accessor.componentType, 5126);
      const view = json.bufferViews[accessor.bufferView];
      bytes.writeFloatLE(9, binStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0));
    },
  );
  try {
    await assert.rejects(verify(v.file));
  } finally {
    v.close();
  }
});

// Each case below edits a copy of the GLB and rehashes its provenance, so only the export contract can reject it.
const writeFloat = (json, bytes, binStart, accessorIndex, element, value) => {
  const accessor = json.accessors[accessorIndex];
  assert.equal(accessor.componentType, 5126);
  const view = json.bufferViews[accessor.bufferView];
  bytes.writeFloatLE(value, binStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + element * 4);
};
const rejects = async (change, pattern, binaryChange) => {
  const v = variant(change, true, binaryChange);
  try {
    await assert.rejects(verify(v.file), pattern);
  } finally {
    v.close();
  }
};
for (const [key, value] of [
  ['translation', [0, 0, 0]],
  ['rotation', [0, 0, 0, 1]],
  ['scale', [1, 1, 1]],
  ['matrix', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]],
]) {
  test(`a node ${key} is rejected even when it is the identity`, async () => {
    await rejects(
      j => {
        j.nodes[0][key] = value;
      },
      new RegExp(`must not carry a ${key}`),
    );
  });
}
test('swapped primitive materials are rejected: the box top must use top-gold', async () => {
  await rejects(j => {
    const [a, b] = j.meshes[0].primitives;
    [a.material, b.material] = [b.material, a.material];
  }, /box top uses top-gold/);
});
test('an extra emissive material property is rejected', async () => {
  await rejects(j => {
    j.materials[0].emissiveFactor = [1, 0, 0];
  }, /only the exported properties/);
});
test('a changed doubleSided material property is rejected', async () => {
  await rejects(j => {
    j.materials[1].doubleSided = false;
  }, /exported doubleSided/);
});
test('an extra PBR property is rejected, even at its default value', async () => {
  await rejects(j => {
    j.materials[0].pbrMetallicRoughness.roughnessFactor = 1;
  }, /only the exported PBR properties/);
});
test('a vertex displaced inside the metre bounds is rejected', async () => {
  await rejects(
    () => {},
    /box corners/,
    (json, bytes, binStart) => {
      writeFloat(json, bytes, binStart, json.meshes[0].primitives[0].attributes.POSITION, 0, 0.25);
    },
  );
});
test('a decoded change that keeps every structural rule fails the pinned semantic hash', async () => {
  await rejects(
    () => {},
    /differ from the checked-in export/,
    (json, bytes, binStart) => {
      writeFloat(json, bytes, binStart, json.meshes[0].primitives[0].attributes.NORMAL, 0, 0.5);
    },
  );
});
