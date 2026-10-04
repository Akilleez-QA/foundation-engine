// asset:optimize: argument rules, texture size and format choice, and real glTF-Transform runs on the metre-block
// sample, each checked by asset:verify before and after.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {crc32, deflateSync} from 'node:zlib';
import {DEVICE_TEXTURE_SIZE, optimize, optimizeArgs, parseArgs, textureFormat, textureSize} from './asset-optimize.mjs';
import {ROOT, imageSize, packGlb, parseContract, readGlb} from './asset-verify.mjs';

const MODELS = join(ROOT, 'tools/blender-export/game/public/models');
/** An 8×8 RGB checker PNG: not a solid colour, so glTF-Transform keeps it. */
const PNG = (() => {
  const size = 8,
    rows = [];
  for (let y = 0; y < size; y++) {
    rows.push(0);
    for (let x = 0; x < size; x++) rows.push(...((x + y) % 2 ? [230, 200, 40] : [40, 60, 200]));
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8),
      crc = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    head.write(type, 4, 'latin1');
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])));
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
})();
const quiet = {log: () => {}, version: () => null};

/** A contract an optimised metre block can meet: meshopt, quantisation, node transforms and a size range. */
const optimised = (extra = {}) => ({
  schema: 1,
  units: 'metres',
  up: '+Y',
  tolerance: 0.001,
  size: {min: [0.99, 0.99, 0.99], max: [1.01, 1.01, 1.01]},
  pivot: {at: 'base-centre'},
  limits: {fileBytes: 65536, triangles: 12, vertices: 24, materials: 2, textures: 0, textureBytes: 0},
  nodeTransforms: 'allowed',
  extensions: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
  materials: {properties: ['doubleSided', 'name', 'pbrMetallicRoughness'], pbr: ['baseColorFactor', 'metallicFactor']},
  nodes: ['metre-block'],
  provenance: {required: ['licence', 'author', 'source', 'tool', 'generator', 'sha256'], licences: ['GPL-3.0-only']},
  ...extra,
});

/** A scratch folder holding a copy of the sample (with its strict contract and receipt) and an output contract. */
function scratch(outContract = optimised(), change) {
  const dir = mkdtempSync(join(tmpdir(), 'foundation-asset-optimize-test-'));
  const input = join(dir, 'metre-block.glb');
  if (change) {
    const {json, bin} = readGlb(readFileSync(join(MODELS, 'metre-block.glb')));
    const bytes = packGlb(json, change(json, Buffer.from(bin)));
    writeFileSync(input, bytes);
    const receipt = JSON.parse(readFileSync(join(MODELS, 'metre-block.provenance.json'), 'utf8'));
    receipt.sha256 = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(dir, 'metre-block.provenance.json'), JSON.stringify(receipt));
  } else {
    for (const name of ['metre-block.glb', 'metre-block.provenance.json', 'metre-block.contract.json'])
      copyFileSync(join(MODELS, name), join(dir, name));
  }
  if (outContract) writeFileSync(join(dir, 'block.contract.json'), JSON.stringify(outContract));
  return {dir, input, out: join(dir, 'block.glb'), close: () => rmSync(dir, {recursive: true, force: true})};
}

test('arguments: one input, a distinct --out, and known texture modes and devices', () => {
  assert.deepEqual(parseArgs(['a.glb', '--out', 'b.glb']), {textures: 'webp', input: 'a.glb', out: 'b.glb'});
  assert.throws(() => parseArgs(['a.glb']), /Usage/);
  assert.throws(() => parseArgs(['a.glb', '--out', 'a.glb']), /must differ from the input/);
  assert.throws(() => parseArgs(['a.glb', '--out', 'b.glb', '--textures', 'avif']), /--textures must be one of/);
  assert.throws(() => parseArgs(['a.glb', '--out', 'b.glb', '--device', 'watch']), /--device must be one of/);
  assert.throws(() => parseArgs(['a.glb', '--out', 'b.glb', '--texture-size', '0']), /positive whole number/);
  assert.throws(() => parseArgs(['a.gltf', '--out', 'b.glb']), /must be \.glb/);
  assert.throws(
    () => parseArgs(['a.glb', '--out', 'b.glb', '--ktx2']),
    /--ktx2: KTX2 textures are not loadable until the engine adds KTX2 support\. Use the default WebP\./,
  );
});

test('texture size: the flag, then the contract, then the device, then 2048', () => {
  const contract = size => parseContract(optimised({limits: {...optimised().limits, textures: 1, textureSize: size}}));
  assert.equal(textureSize({textureSize: 256, device: 'phone'}, contract(512)), 256);
  assert.equal(textureSize({device: 'phone'}, contract(512)), 512);
  assert.equal(textureSize({device: 'phone'}, parseContract(optimised())), DEVICE_TEXTURE_SIZE.phone);
  assert.equal(textureSize({}, parseContract(optimised())), 2048);
});

test('texture format: WebP by default, KTX2 only with ktx 4.4 or later, else a clear fallback to WebP', () => {
  assert.deepEqual(textureFormat('webp', false), {format: false, note: 'no textures'});
  assert.equal(textureFormat('webp', true).format, 'webp');
  assert.equal(textureFormat('keep', true).format, 'auto');
  assert.equal(textureFormat('ktx2', true, () => [4, 4, 0]).format, 'ktx2');
  assert.equal(textureFormat('ktx2', true, () => [4, 10, 1]).format, 'ktx2');
  const old = textureFormat('ktx2', true, () => [4, 3, 2]);
  assert.equal(old.format, 'webp');
  assert.match(old.note, /KTX-Software 4\.4\.0 or later.*found 4\.3\.2\. Falling back to WebP/);
  assert.match(textureFormat('ktx2', true, () => null).note, /it is not on PATH\. Falling back to WebP/);
});

test('the optimize call keeps named nodes, meshes and materials and never decimates', () => {
  const args = optimizeArgs('in.glb', 'out.glb', {format: 'webp', size: 1024}).join(' ');
  for (const flag of [
    '--compress meshopt',
    '--texture-compress webp',
    '--texture-size 1024',
    '--join false',
    '--flatten false',
    '--instance false',
    '--palette false',
    '--simplify false',
  ])
    assert.ok(args.includes(flag), flag);
});

test('the sample passes before, is meshopt-compressed, and the re-import passes after', async () => {
  const s = scratch();
  try {
    const result = await optimize({input: s.input, out: s.out, textures: 'webp'}, quiet);
    assert.equal(result.before.triangles, 12);
    assert.equal(result.after.triangles, 12);
    assert.equal(result.after.vertices, result.before.vertices);
    const {json} = readGlb(readFileSync(s.out));
    assert.ok(json.extensionsRequired.includes('EXT_meshopt_compression'));
    assert.ok(
      json.bufferViews.some(v => v.extensions?.EXT_meshopt_compression),
      'compressed buffer views',
    );
    const receipt = JSON.parse(readFileSync(join(s.dir, 'block.provenance.json'), 'utf8'));
    assert.equal(receipt.generator, json.asset.generator);
    assert.match(receipt.generator, /^glTF-Transform/);
    assert.equal(receipt.optimizedFrom.generator, 'Khronos glTF Blender I/O v5.2.40');
    assert.match(receipt.optimizer, /--compress meshopt .*--simplify false/);
    assert.equal(receipt.licence, 'GPL-3.0-only');
  } finally {
    s.close();
  }
});

test('an output that fails its contract leaves --out unwritten', async () => {
  const s = scratch(optimised({nodeTransforms: 'forbidden'}));
  try {
    await assert.rejects(
      optimize({input: s.input, out: s.out, textures: 'webp'}, quiet),
      /after: the optimised model fails its contract: node metre-block must not carry a translation/,
    );
    assert.equal(existsSync(s.out), false);
    assert.equal(existsSync(join(s.dir, 'block.provenance.json')), false);
  } finally {
    s.close();
  }
});

test('an input that fails its own contract is not optimised', async () => {
  const s = scratch(optimised(), (json, bin) => {
    json.materials[0].doubleSided = false;
    return bin;
  });
  // The scratch copy has no adjacent strict contract; give it the sample's.
  copyFileSync(join(MODELS, 'metre-block.contract.json'), join(s.dir, 'metre-block.contract.json'));
  try {
    await assert.rejects(
      optimize({input: s.input, out: s.out, textures: 'webp'}, quiet),
      /before: the input fails its contract: .*doubleSided/,
    );
    assert.equal(existsSync(s.out), false);
  } finally {
    s.close();
  }
});

test('a model without a contract is refused', async () => {
  const s = scratch(null);
  rmSync(join(s.dir, 'metre-block.contract.json'));
  try {
    await assert.rejects(optimize({input: s.input, out: s.out, textures: 'webp'}, quiet), /no contract: write/);
  } finally {
    s.close();
  }
});

test('textures are re-encoded as WebP within the contract textureSize', async () => {
  const textured = (json, bin) => {
    const offset = bin.length;
    json.bufferViews.push({buffer: 0, byteOffset: offset, byteLength: PNG.length});
    json.buffers[0].byteLength = offset + PNG.length;
    json.images = [{bufferView: json.bufferViews.length - 1, mimeType: 'image/png'}];
    json.textures = [{source: 0}];
    json.materials[0].pbrMetallicRoughness.baseColorTexture = {index: 0};
    return Buffer.concat([bin, PNG]);
  };
  const before = optimised({
    limits: {...optimised().limits, textures: 1, textureBytes: 4096, textureSize: 4},
    extensions: [],
    nodeTransforms: 'forbidden',
    materials: {
      properties: ['doubleSided', 'name', 'pbrMetallicRoughness'],
      pbr: ['baseColorFactor', 'metallicFactor', 'baseColorTexture'],
    },
  });
  // The export may carry a larger texture; the optimiser resizes it to the output contract's textureSize.
  before.limits.textureSize = 8;
  const after = {
    ...before,
    limits: {...before.limits, textureSize: 4},
    nodeTransforms: 'allowed',
    extensions: ['EXT_meshopt_compression', 'KHR_mesh_quantization', 'EXT_texture_webp'],
  };
  const s = scratch(after, textured);
  writeFileSync(join(s.dir, 'metre-block.contract.json'), JSON.stringify(before));
  try {
    const result = await optimize({input: s.input, out: s.out, textures: 'webp'}, quiet);
    assert.equal(result.textureSize, 4);
    const {json, bin} = readGlb(readFileSync(s.out));
    assert.equal(json.images[0].mimeType, 'image/webp');
    const view = json.bufferViews[json.images[0].bufferView];
    assert.deepEqual(imageSize(bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)), {
      width: 4,
      height: 4,
    });
    assert.equal(result.after.textures, 1);
  } finally {
    s.close();
  }
});
