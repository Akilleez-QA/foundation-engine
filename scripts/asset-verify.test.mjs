// Every rejection of the model-contract check, each against a mutated copy of the metre-block GLB. Each copy's
// provenance receipt is rehashed, so only the rule under test can reject it.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  ENGINE_KTX2,
  LOADER,
  PROVENANCE_FIELDS,
  ROOT,
  discover,
  gameFolders,
  imageSize,
  packGlb,
  parseArgs,
  parseContract,
  readGlb,
  verifyFile,
  verifyModel,
} from './asset-verify.mjs';
import {editKtx2, quadrantKtx2} from '../src/testing/ktx2-fixture.ts';

const SAMPLE = join(ROOT, 'tools/blender-export/game/public/models/metre-block.glb');
const RECEIPT = JSON.parse(readFileSync(SAMPLE.replace(/\.glb$/, '.provenance.json'), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
// A 1×1 PNG, enough to stand for an embedded texture.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const baseContract = () => ({
  schema: 1,
  units: 'metres',
  up: '+Y',
  bounds: {min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5]},
  pivot: {at: 'base-centre', node: 'metre-block'},
  limits: {fileBytes: 65536, triangles: 12, vertices: 24, primitives: 2, materials: 2, textures: 0, textureBytes: 0},
  nodeTransforms: 'forbidden',
  materials: {
    properties: ['doubleSided', 'name', 'pbrMetallicRoughness', 'emissiveFactor', 'alphaMode'],
    required: ['name', 'doubleSided'],
    pbr: ['baseColorFactor', 'metallicFactor', 'roughnessFactor', 'baseColorTexture'],
    requiredPbr: ['baseColorFactor', 'metallicFactor'],
    alphaModes: ['OPAQUE'],
    expected: [
      {name: 'body-blue', baseColorFactor: [0.04, 0.35, 0.8, 1], metallicFactor: 0, roughnessFactor: 1},
      {name: 'top-gold', baseColorFactor: [0.9, 0.5, 0.03, 1], doubleSided: true, emissiveFactor: [0, 0, 0]},
    ],
  },
  lattice: {name: 'box corners', x: [-0.5, 0.5], y: [0, 1], z: [-0.5, 0.5]},
  faces: [{name: 'the box top', axis: 'y', at: 1, material: 'top-gold', triangles: 2}],
  semanticSha256: '2b74ca47d75e1fde93ab35ad467f0e20374902b116c32b72ab29143fd00dd901',
  provenance: {
    required: [...PROVENANCE_FIELDS, 'sha256'],
    licences: ['GPL-3.0-only'],
    equals: {units: 'metres'},
  },
});
const contract = (change = () => {}) => {
  const raw = baseContract();
  change(raw);
  return parseContract(raw);
};

/** Write a mutated copy of the sample GLB and its rehashed receipt to a scratch folder. */
function fixture({json: jsonChange, bin: binChange, bytes: bytesChange, receipt: receiptChange} = {}) {
  const {json, bin} = readGlb(readFileSync(SAMPLE));
  let b = Buffer.from(bin);
  jsonChange?.(json);
  b = binChange?.(json, b) ?? b;
  let bytes = packGlb(json, b);
  bytes = bytesChange?.(bytes) ?? bytes;
  const receipt = {...structuredClone(RECEIPT), sha256: digest(bytes)};
  receiptChange?.(receipt);
  const dir = mkdtempSync(join(tmpdir(), 'foundation-asset-verify-')),
    file = join(dir, 'model.glb');
  writeFileSync(file, bytes);
  writeFileSync(join(dir, 'model.provenance.json'), JSON.stringify(receipt));
  return {file, dir, close: () => rmSync(dir, {recursive: true, force: true})};
}
const writeFloat = (json, bin, accessor, element, value) => {
  const a = json.accessors[accessor],
    view = json.bufferViews[a.bufferView];
  bin.writeFloatLE(value, (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + element * 4);
  return bin;
};
const position = (json, primitive = 0) => json.meshes[0].primitives[primitive].attributes.POSITION;
/** Embed the PNG as a base-colour texture of the first material. */
const textured = (json, bin) => {
  const offset = bin.length;
  json.bufferViews.push({buffer: 0, byteOffset: offset, byteLength: PNG.length});
  json.buffers[0].byteLength = offset + PNG.length;
  json.images = [{bufferView: json.bufferViews.length - 1, mimeType: 'image/png'}];
  json.textures = [{source: 0}];
  json.materials[0].pbrMetallicRoughness.baseColorTexture = {index: 0};
  return Buffer.concat([bin, PNG]);
};
const duplicatePrimitive = json => {
  json.meshes[0].primitives.push({...json.meshes[0].primitives[0]});
};
async function rejects(options, pattern, change) {
  const f = fixture(options);
  try {
    await assert.rejects(verifyModel(f.file, contract(change)), pattern);
  } finally {
    f.close();
  }
}

test('the unchanged sample passes a general contract, and a textured copy passes within its texture limits', async () => {
  const plain = fixture();
  const withTexture = fixture({bin: textured});
  try {
    const report = await verifyModel(plain.file, contract());
    assert.equal(report.triangles, 12);
    assert.equal(report.vertices, 24);
    assert.deepEqual(report.size, [1, 1, 1]);
    const texturedReport = await verifyModel(
      withTexture.file,
      contract(c => {
        c.limits.textures = 1;
        c.limits.textureBytes = PNG.length;
        c.limits.textureSize = 1;
      }),
    );
    assert.equal(texturedReport.textures, 1);
    assert.equal(texturedReport.textureBytes, PNG.length);
    assert.equal(texturedReport.semanticSha256, report.semanticSha256);
  } finally {
    plain.close();
    withTexture.close();
  }
});

test('a size range and a base-centre pivot accept a model without exact bounds', async () => {
  const f = fixture();
  try {
    const c = contract(raw => {
      delete raw.bounds;
      raw.size = {min: [0.9, 0.9, 0.9], max: [1.1, 1.1, 1.1]};
    });
    assert.equal((await verifyModel(f.file, c)).bytes > 0, true);
  } finally {
    f.close();
  }
});

// File and container.
test('a file over the contract size is rejected before it is read', () =>
  rejects({}, /over the contract's 1000/, c => (c.limits.fileBytes = 1000)));
test('a missing receipt file is rejected', async () => {
  const f = fixture();
  rmSync(join(f.dir, 'model.provenance.json'));
  try {
    await assert.rejects(verifyModel(f.file, contract()), /missing provenance receipt/);
  } finally {
    f.close();
  }
});
test('bytes that differ from the receipt hash are rejected', () =>
  rejects(
    {json: j => (j.asset.copyright = 'changed'), receipt: r => (r.sha256 = RECEIPT.sha256)},
    /asset hash disagrees/,
  ));
test('a wrong GLB magic is rejected', () => rejects({bytes: b => (b.writeUInt32LE(0x12345678, 0), b)}, /wrong magic/));
test('a GLB version other than 2 is rejected', () => rejects({bytes: b => (b.writeUInt32LE(1, 4), b)}, /version/));
test('a GLB length header that disagrees with the file is rejected', () =>
  rejects({bytes: b => Buffer.concat([b, Buffer.alloc(4)])}, /length header/));
test('a first chunk that is not JSON is rejected', () =>
  rejects({bytes: b => (b.writeUInt32LE(0x004e4942, 16), b)}, /first GLB chunk must be JSON/));
test('a second chunk that is not BIN is rejected', () =>
  rejects(
    {
      bytes: b => {
        b.writeUInt32LE(0x4e4f534a, 20 + b.readUInt32LE(12) + 4);
        return b;
      },
    },
    /second GLB chunk must be BIN/,
  ));
test('a truncated BIN chunk is rejected', () =>
  rejects(
    {
      bytes: b => {
        b.writeUInt32LE(b.readUInt32LE(20 + b.readUInt32LE(12)) + 64, 20 + b.readUInt32LE(12));
        return b;
      },
    },
    /BIN chunk overruns/,
  ));

// Provenance.
for (const field of PROVENANCE_FIELDS)
  test(`a receipt without "${field}" is rejected`, () =>
    rejects({receipt: r => delete r[field]}, new RegExp(`lacks the required field "${field}"`)));
test('a provenance field that is not text is rejected', () =>
  rejects({receipt: r => (r.author = 42)}, /"author" must be text/));
test('a licence the contract does not accept is rejected', () =>
  rejects({receipt: r => (r.licence = 'CC-BY-NC-4.0')}, /licence CC-BY-NC-4.0 is not one the contract accepts/));
test('a receipt value that differs from the contract is rejected', () =>
  rejects({receipt: r => (r.units = 'centimetres')}, /provenance units must equal/));
test('a changed export source is rejected', () =>
  rejects({receipt: r => (r.sourceSha256 = '0'.repeat(64))}, /export source changed/));
test('a hashed source that does not exist is rejected', () =>
  rejects({receipt: r => (r.source = 'nowhere/export.py')}, /does not exist/));
test('a generator that differs from the GLB asset.generator is rejected', () =>
  rejects({json: j => (j.asset.generator = 'Some other exporter')}, /provenance generator/));

// Declarations.
test('a second buffer is rejected', () => rejects({json: j => j.buffers.push({byteLength: 4})}, /one embedded buffer/));
test('an external buffer is rejected', () =>
  rejects({json: j => (j.buffers[0].uri = 'https://invalid.example/model.bin')}, /buffer must be embedded/));
test('an external image is rejected', () =>
  rejects({json: j => (j.images = [{uri: 'colour.png'}])}, /image must be embedded/));
test('Draco geometry is rejected: the engine registers only the meshopt decoder', () =>
  rejects(
    {json: j => (j.extensionsUsed = ['KHR_draco_mesh_compression'])},
    /Draco is not accepted, the engine registers only the meshopt decoder/,
    c => (c.extensions = []),
  ));
test('an extension the contract does not allow is rejected', () =>
  rejects({json: j => (j.extensionsUsed = ['KHR_materials_emissive_strength'])}, /extension .* is not one the/));
test('more textures than the contract allows are rejected', () =>
  rejects({bin: textured}, /1 textures, over the contract's 0/, c => (c.limits.textureBytes = 1e6)));
test('more texture bytes than the contract allows are rejected', () =>
  rejects({bin: textured}, /bytes of embedded images, over the contract's 10/, c => {
    c.limits.textures = 1;
    c.limits.textureBytes = 10;
    c.limits.textureSize = 1;
  }));
test('an animation the contract does not allow is rejected', () =>
  rejects({json: j => (j.animations = [{channels: [], samplers: []}])}, /1 animations, over the contract's 0/));
test('a camera is rejected', () =>
  rejects(
    {json: j => (j.cameras = [{type: 'perspective', perspective: {yfov: 1, znear: 0.1}}])},
    /1 cameras, over the contract's 0/,
  ));
test('more materials than the contract allows are rejected', () =>
  rejects({json: j => j.materials.push({name: 'extra'})}, /3 materials, over the contract's 2/));
test('a primitive that is not triangles is rejected', () =>
  rejects({json: j => (j.meshes[0].primitives[0].mode = 1)}, /triangle primitives only/));
for (const [key, value] of [
  ['translation', [0, 0, 0]],
  ['rotation', [0, 0, 0, 1]],
  ['scale', [1, 1, 1]],
  ['matrix', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]],
])
  test(`a node ${key} is rejected when the contract forbids node transforms`, () =>
    rejects({json: j => (j.nodes[0][key] = value)}, new RegExp(`must not carry a ${key}`)));

// Materials.
test('a material property the contract does not allow is rejected', () =>
  rejects({json: j => (j.materials[0].alphaCutoff = 0.5)}, /only the exported properties.*alphaCutoff/));
test('a material without a required property is rejected', () =>
  rejects({json: j => delete j.materials[0].doubleSided}, /lacks the required property doubleSided/));
test('a PBR property the contract does not allow is rejected', () =>
  rejects(
    {json: j => (j.materials[0].pbrMetallicRoughness.metallicRoughnessTexture = {index: 0})},
    /only the exported PBR properties.*metallicRoughnessTexture/,
  ));
test('a material without a required PBR property is rejected', () =>
  rejects(
    {json: j => delete j.materials[0].pbrMetallicRoughness.metallicFactor},
    /lacks the required PBR property metallicFactor/,
  ));
test('an alpha mode the contract does not allow is rejected', () =>
  rejects({json: j => (j.materials[0].alphaMode = 'BLEND')}, /alphaMode BLEND is not one of OPAQUE/));
test('a renamed material is rejected', () =>
  rejects({json: j => (j.materials[0].name = 'body-red')}, /exactly the ones the contract expects/));
test('a changed doubleSided value is rejected', () =>
  rejects({json: j => (j.materials[1].doubleSided = false)}, /keeps the exported doubleSided value/));
test('a changed base colour is rejected', () =>
  rejects(
    {json: j => (j.materials[0].pbrMetallicRoughness.baseColorFactor = [1, 0, 0, 1])},
    /baseColorFactor differs/,
  ));
test('a changed metallic factor is rejected', () =>
  rejects({json: j => (j.materials[0].pbrMetallicRoughness.metallicFactor = 0.5)}, /metallicFactor differs/));
test('a changed roughness factor is rejected', () =>
  rejects({json: j => (j.materials[0].pbrMetallicRoughness.roughnessFactor = 0.5)}, /roughnessFactor differs/));
test('a changed emissive factor is rejected', () =>
  rejects({json: j => (j.materials[1].emissiveFactor = [1, 0, 0])}, /emissiveFactor differs/));

// Re-import: texture dimensions, compression the engine cannot decode, named nodes and clips.
const withTextures = c => {
  c.limits.textures = 1;
  c.limits.textureBytes = 1e6;
  c.limits.textureSize = 1;
};
test('a texture wider than the contract textureSize is rejected', () =>
  rejects(
    {
      bin: (j, b) => {
        const out = textured(j, b);
        out.writeUInt32BE(4096, out.length - PNG.length + 16);
        return out;
      },
    },
    /image 0 is 4096×1, over the contract's textureSize 1/,
    withTextures,
  ));
test('an image that is not PNG, JPEG, WebP or KTX2 is rejected', () =>
  rejects(
    {
      bin: (j, b) => {
        const out = textured(j, b);
        out.write('GIF89a', out.length - PNG.length, 'latin1');
        return out;
      },
    },
    /image 0 \(image\/png\) is not a PNG, JPEG, WebP or KTX2 image/,
    withTextures,
  ));
/** Embed a KTX2 image as a base-colour texture through KHR_texture_basisu (required, no fallback source). */
const ktx2Textured =
  (image = Buffer.from(quadrantKtx2(8))) =>
  (json, bin) => {
    const offset = bin.length;
    json.bufferViews.push({buffer: 0, byteOffset: offset, byteLength: image.length});
    json.buffers[0].byteLength = offset + image.length;
    json.images = [{bufferView: json.bufferViews.length - 1, mimeType: 'image/ktx2'}];
    json.textures = [{extensions: {KHR_texture_basisu: {source: 0}}}];
    json.materials[0].pbrMetallicRoughness.baseColorTexture = {index: 0};
    json.extensionsUsed = ['KHR_texture_basisu'];
    json.extensionsRequired = ['KHR_texture_basisu'];
    return Buffer.concat([bin, image]);
  };
const allowKtx2 = c => {
  withTextures(c);
  c.limits.textureSize = 8;
  c.extensions = ['KHR_texture_basisu'];
};
test('a required KTX2 texture passes when the contract lists KHR_texture_basisu: the engine transcodes it', async () => {
  assert.equal(ENGINE_KTX2, true);
  const f = fixture({bin: ktx2Textured()});
  try {
    const report = await verifyModel(f.file, contract(allowKtx2));
    assert.equal(report.triangles, 12);
  } finally {
    f.close();
  }
});
test('a KTX2 texture the contract does not list is rejected', () =>
  rejects({bin: ktx2Textured()}, /extension KHR_texture_basisu is not one the contract allows/, c => {
    allowKtx2(c);
    c.extensions = [];
  }));
test('a KTX2 image the engine cannot transcode is rejected', async () => {
  const image = Buffer.from(quadrantKtx2(8));
  await rejects({bin: ktx2Textured(Buffer.from(editKtx2(image, {12: 37})))}, /must be Basis Universal/, allowKtx2);
  await rejects({bin: ktx2Textured(Buffer.from(editKtx2(image, {36: 6})))}, /must be one 2D texture/, allowKtx2);
});

// The model loader's admission caps (src/platform/assets/models.ts), whatever the contract allows.
test('the loader caps mirror src/platform/assets/models.ts', () => {
  const source = readFileSync(join(ROOT, 'src/platform/assets/models.ts'), 'utf8');
  assert.match(source, /maxFileBytes \?\? 32 \* MIB/);
  assert.equal(LOADER.fileBytes, 32 * 1024 * 1024);
  assert.match(source, new RegExp(`accessors\\?\\.length \\?\\? 0\\) > ${LOADER.accessors}\\)`));
  assert.match(source, new RegExp(`accessor\\.count > ${LOADER.accessorCount}`));
  assert.match(source, new RegExp(`\\(scalars \\+= accessor\\.count \\* width\\) > ${LOADER.scalars}`));
  assert.match(source, new RegExp(`nodes\\?\\.length \\?\\? 0\\) > ${LOADER.nodes}`));
  assert.match(source, new RegExp(`skins\\?\\.length \\?\\? 0\\) > ${LOADER.skins}`));
  assert.match(source, new RegExp(`animations\\?\\.length \\?\\? 0\\) > ${LOADER.animations}`));
  assert.equal(ENGINE_KTX2, /setKTX2Loader/.test(source), 'ENGINE_KTX2 follows the model loader');
});
test('a file over the model loader cap is rejected even when the contract allows it', async () => {
  const f = fixture();
  try {
    writeFileSync(f.file, Buffer.alloc(LOADER.fileBytes + 4));
    await assert.rejects(
      verifyModel(
        f.file,
        contract(c => (c.limits.fileBytes = 2 * LOADER.fileBytes)),
      ),
      /over the model loader's 33554432/,
    );
  } finally {
    f.close();
  }
});
const unused = (count, type = 'SCALAR') => ({componentType: 5126, count, type});
test('more accessors than the model loader allows are rejected', () =>
  rejects(
    {json: j => j.accessors.push(...Array.from({length: LOADER.accessors}, () => unused(0)))},
    /4102 accessors, over the model loader's 4096/,
    c => (c.limits.fileBytes = 1e6),
  ));
test('an accessor with more elements than the model loader allows is rejected', () =>
  rejects(
    {json: j => j.accessors.push(unused(LOADER.accessorCount + 1))},
    /elements, over the model loader's 1048576/,
  ));
test('more decoded accessor values than the model loader allows are rejected', () =>
  rejects(
    {json: j => j.accessors.push(...Array.from({length: 5}, () => unused(LOADER.accessorCount, 'VEC4')))},
    /decoded accessor values, over the model loader's 16777216/,
  ));
test('an accessor with an unknown type is rejected', () =>
  rejects({json: j => j.accessors.push(unused(1, 'VEC5'))}, /unknown type VEC5/));
for (const [key, cap, row] of [
  ['nodes', LOADER.nodes, () => ({name: 'spare'})],
  ['skins', LOADER.skins, () => ({joints: [0]})],
  ['animations', LOADER.animations, () => ({channels: [], samplers: []})],
])
  test(`more ${key} than the model loader allows are rejected`, () =>
    rejects(
      {json: j => (j[key] = [...(j[key] ?? []), ...Array.from({length: cap + 1}, row)])},
      new RegExp(`${key}, over the model loader's ${cap}`),
      c => (c.limits.fileBytes = 1e6),
    ));
test('more than four bone influences per vertex are rejected', () =>
  rejects(
    {json: j => (j.meshes[0].primitives[0].attributes.JOINTS_1 = 0)},
    /has JOINTS_1: at most 4 bone influences per vertex/,
  ));
test('a meshopt extension the contract allows is decoded with the engine decoder', async () => {
  const f = fixture({json: j => (j.extensionsUsed = ['EXT_meshopt_compression'])});
  try {
    const report = await verifyModel(
      f.file,
      contract(c => (c.extensions = ['EXT_meshopt_compression'])),
    );
    assert.equal(report.triangles, 12);
  } finally {
    f.close();
  }
});
test('a missing required node is rejected', () =>
  rejects({}, /the required node handle is missing/, c => (c.nodes = ['metre-block', 'handle'])));
test('a missing required animation clip is rejected', () =>
  rejects({}, /the required clip idle is missing \(clips: none\)/, c => {
    c.limits.animations = 1;
    c.clips = ['idle'];
  }));
test('a required clip present in the model passes, and one without duration is rejected', async () => {
  const clip = (j, b, times) => {
    // A one-key or two-key translation track on the model node; the node transform rule is relaxed for it.
    const offset = b.length,
      data = Buffer.alloc(times.length * 4 + times.length * 12);
    times.forEach((t, i) => data.writeFloatLE(t, i * 4));
    j.bufferViews.push(
      {buffer: 0, byteOffset: offset, byteLength: times.length * 4},
      {buffer: 0, byteOffset: offset + times.length * 4, byteLength: times.length * 12},
    );
    j.accessors.push(
      {
        bufferView: j.bufferViews.length - 2,
        componentType: 5126,
        count: times.length,
        type: 'SCALAR',
        min: [Math.min(...times)],
        max: [Math.max(...times)],
      },
      {bufferView: j.bufferViews.length - 1, componentType: 5126, count: times.length, type: 'VEC3'},
    );
    j.animations = [
      {
        name: 'idle',
        samplers: [{input: j.accessors.length - 2, output: j.accessors.length - 1}],
        channels: [{sampler: 0, target: {node: 0, path: 'translation'}}],
      },
    ];
    j.buffers[0].byteLength = offset + data.length;
    return Buffer.concat([b, data]);
  };
  const withClip = c => {
    c.limits.animations = 1;
    c.clips = ['idle'];
  };
  const good = fixture({bin: (j, b) => clip(j, b, [0, 1])});
  try {
    assert.deepEqual((await verifyModel(good.file, contract(withClip))).clips, ['idle']);
  } finally {
    good.close();
  }
  await rejects({bin: (j, b) => clip(j, b, [0])}, /the required clip idle has no duration/, withClip);
});
test('image headers give width and height for PNG, JPEG, WebP and KTX2', () => {
  assert.deepEqual(imageSize(PNG), {width: 1, height: 1});
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 32, 0, 64, 3, 0, 0, 0]);
  assert.deepEqual(imageSize(jpeg), {width: 64, height: 32});
  const vp8l = Buffer.alloc(30);
  vp8l.write('RIFF', 0, 'latin1');
  vp8l.write('WEBPVP8L', 8, 'latin1');
  vp8l.writeUInt32LE((128 - 1) | ((256 - 1) << 14), 21);
  assert.deepEqual(imageSize(vp8l), {width: 128, height: 256});
  const ktx2 = Buffer.alloc(40);
  ktx2.write('\u00abKTX 20\u00bb\r\n\x1a\n', 0, 'latin1');
  ktx2.writeUInt32LE(512, 20);
  ktx2.writeUInt32LE(256, 24);
  ktx2.writeUInt32LE(1, 36);
  assert.deepEqual(imageSize(ktx2), {
    width: 512,
    height: 256,
    ktx2: {vkFormat: 0, depth: 0, layers: 0, faces: 1},
  });
  assert.equal(imageSize(Buffer.from('GIF89a')), null);
});

// Decoded geometry.
test('a light in the model is rejected even when its extension is allowed', () =>
  rejects(
    {
      json: j => {
        j.extensionsUsed = ['KHR_lights_punctual'];
        j.extensions = {KHR_lights_punctual: {lights: [{type: 'point'}]}};
        j.nodes.push({name: 'lamp', extensions: {KHR_lights_punctual: {light: 0}}});
        j.scenes[0].nodes.push(j.nodes.length - 1);
      },
    },
    /carries a light/,
    c => (c.extensions = ['KHR_lights_punctual']),
  ));
test('a model without geometry is rejected', () => rejects({json: j => delete j.nodes[0].mesh}, /no geometry/));
test('decoded bounds below the contract minimum are rejected', () =>
  rejects({bin: (j, b) => writeFloat(j, b, position(j), 0, -0.7)}, /bounds min/));
test('decoded bounds above the contract maximum are rejected', () =>
  rejects({bin: (j, b) => writeFloat(j, b, position(j), 0, 0.7)}, /bounds max/));
test('a size outside the contract range is rejected', () =>
  rejects({bin: (j, b) => writeFloat(j, b, position(j), 0, 0.7)}, /size x is 1.2 m, outside/, c => {
    delete c.bounds;
    c.size = {min: [0.9, 0.9, 0.9], max: [1.1, 1.1, 1.1]};
  }));
const loose = c => {
  delete c.bounds;
  delete c.lattice;
  delete c.semanticSha256;
  c.size = {min: [0, 0, 0], max: [2, 2, 2]};
};
test('a model below its base pivot is rejected', () =>
  rejects({bin: (j, b) => writeFloat(j, b, position(j), 1, -0.1)}, /lowest point is y=-0.1/, loose));
test('a model off-centre over its base pivot is rejected', () =>
  rejects({bin: (j, b) => writeFloat(j, b, position(j), 0, 0.7)}, /footprint centre is x=0.1/, loose));
test('a centre pivot is rejected for a model resting on its base', () =>
  rejects({}, /centre pivot: the bounds centre/, c => (c.pivot.at = 'centre')));
test('a missing pivot node is rejected', () =>
  rejects({json: j => (j.nodes[0].name = j.meshes[0].name = 'renamed')}, /pivot node metre-block is missing/));
test('a pivot node away from the origin is rejected', () =>
  rejects(
    {
      json: j => {
        j.nodes.push({name: 'holder', translation: [0.3, 0, 0], children: [0]});
        j.scenes[0].nodes = [j.nodes.length - 1];
      },
    },
    /node metre-block is not at the origin/,
    c => {
      loose(c);
      c.pivot.at = 'any';
      c.nodeTransforms = 'allowed';
    },
  ));
test('more triangles than the contract allows are rejected', () =>
  rejects({json: duplicatePrimitive}, /22 triangles, over the contract's 12/, c => (c.limits.materials = 3)));
test('more vertices than the contract allows are rejected', () =>
  rejects({json: duplicatePrimitive}, /44 vertices, over the contract's 24/, c => (c.limits.triangles = 100)));
test('more primitives than the contract allows are rejected', () =>
  rejects({json: duplicatePrimitive}, /3 primitives, over the contract's 2/, c => {
    c.limits.triangles = 100;
    c.limits.vertices = 100;
  }));
test('a vertex off the declared lattice is rejected', () =>
  rejects({bin: (j, b) => writeFloat(j, b, position(j), 0, 0.25)}, /vertices lie on box corners/));
test('a face primitive that no longer lies on its plane is rejected', () =>
  rejects({bin: (j, b) => writeFloat(j, b, position(j, 1), 1, 0.99)}, /exactly one primitive is the box top/, c => {
    delete c.lattice;
  }));
test('a face primitive with the wrong material is rejected', () =>
  rejects(
    {
      json: j => {
        const [a, b] = j.meshes[0].primitives;
        [a.material, b.material] = [b.material, a.material];
      },
    },
    /the box top uses top-gold/,
  ));
test('a face primitive with a different triangle count is rejected', () =>
  rejects({json: j => (j.accessors[j.meshes[0].primitives[1].indices].count = 3)}, /the box top is 2 triangles/));
test('a decoded change that keeps every structural rule fails the pinned semantic hash', () =>
  rejects(
    {bin: (j, b) => writeFloat(j, b, j.meshes[0].primitives[0].attributes.NORMAL, 0, 0.5)},
    /differ from the checked-in export/,
  ));

// The contract itself and the command line.
test('a contract with an unknown key, a missing provenance field or Draco is refused; KTX2 may be listed', () => {
  assert.throws(() => contract(c => (c.limit = {})), /unknown key "limit"/);
  assert.throws(() => contract(c => (c.provenance.required = ['licence'])), /must include "author"/);
  assert.throws(() => contract(c => (c.extensions = ['KHR_draco_mesh_compression'])), /only the meshopt decoder/);
  assert.equal(contract(c => (c.extensions = ['KHR_texture_basisu'])).extensions[0], 'KHR_texture_basisu');
  assert.equal(contract(c => (c.extensions = ['EXT_meshopt_compression'])).extensions[0], 'EXT_meshopt_compression');
  assert.throws(() => contract(c => (c.limits.textures = 1)), /textureSize .* is required when textures are allowed/);
  assert.throws(() => contract(c => (c.clips = ['idle'])), /limits.animations must be at least/);
  assert.throws(() => contract(c => (c.nodes = ['a', 'a'])), /nodes must be a list of distinct names/);
  assert.throws(() => contract(c => (c.up = '+Z')), /up must be "\+Y"/);
  assert.throws(() => contract(c => delete c.bounds && delete c.size), /needs bounds, size or both/);
  assert.throws(() => contract(c => (c.limits.triangles = -1)), /limits.triangles/);
});
test('a model without a contract is refused, and discovery finds contracted, uncontracted and orphaned files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'foundation-asset-games-'));
  try {
    const models = join(root, 'templates', 'demo', 'game', 'public', 'models');
    mkdirSync(join(models, 'props'), {recursive: true});
    writeFileSync(join(root, 'templates', 'demo', 'game', 'game.ts'), '');
    for (const name of ['a.glb', 'a.contract.json', 'props/b.glb', 'c.contract.json'])
      writeFileSync(join(models, name), '');
    const games = gameFolders(root, undefined);
    assert.deepEqual(games, [join(root, 'templates', 'demo', 'game')]);
    const found = discover(games);
    assert.deepEqual(found.contracted, [join(models, 'a.glb')]);
    assert.deepEqual(found.uncontracted, [join(models, 'props', 'b.glb')]);
    assert.deepEqual(found.orphans, [join(models, 'c.contract.json')]);
    await assert.rejects(verifyFile(join(models, 'props', 'b.glb')), /has no contract: write/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
test('the command line takes model files or --all, and --contract with one model', () => {
  assert.deepEqual(parseArgs(['a.glb']), {files: ['a.glb'], all: false, json: false, contract: undefined});
  assert.equal(parseArgs(['--all', '--json']).all, true);
  assert.throws(() => parseArgs([]), /Usage/);
  assert.throws(() => parseArgs(['--all', 'a.glb']), /not both/);
  assert.throws(() => parseArgs(['--contract', 'c.json', 'a.glb', 'b.glb']), /exactly one model/);
  assert.throws(() => parseArgs(['--fast']), /Unknown option/);
});

// Skin limits, against mutated copies of the pose-to-pose robot (a skinned, animated original model).
const ROBOT = join(ROOT, 'tools/pose-to-pose/game/public/models/pose-robot.glb');
const robotContract = (change = () => {}) => {
  const raw = JSON.parse(readFileSync(ROBOT.replace(/\.glb$/, '.contract.json'), 'utf8'));
  change(raw);
  return parseContract(raw);
};
async function robotRejects({json: jsonChange, bin: binChange} = {}, pattern, change) {
  const {json, bin} = readGlb(readFileSync(ROBOT));
  let b = Buffer.from(bin);
  jsonChange?.(json);
  b = binChange?.(json, b) ?? b;
  const bytes = packGlb(json, b);
  const receipt = JSON.parse(readFileSync(ROBOT.replace(/\.glb$/, '.provenance.json'), 'utf8'));
  const dir = mkdtempSync(join(tmpdir(), 'foundation-asset-verify-skin-')),
    file = join(dir, 'model.glb');
  writeFileSync(file, bytes);
  writeFileSync(join(dir, 'model.provenance.json'), JSON.stringify({...receipt, sha256: digest(bytes)}));
  try {
    await assert.rejects(verifyModel(file, robotContract(change)), pattern);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}
test('a skinned model within its skin limits passes', async () => {
  const report = await verifyFile(ROBOT);
  assert.deepEqual(report.clips.toSorted(), ['walk', 'walk_turn_left', 'walk_turn_right', 'wave']);
});
test('a skin with more joints than the contract allows is rejected', () =>
  robotRejects({}, /24 joints, over the contract's 20/, c => (c.skin.joints = 20)));
test('a second influence set (more than four influences) is rejected', () =>
  robotRejects(
    {
      json: j => {
        const a = j.meshes[0].primitives[0].attributes;
        a.JOINTS_1 = a.JOINTS_0;
        a.WEIGHTS_1 = a.WEIGHTS_0;
      },
    },
    /has JOINTS_1: at most 4 bone influences/,
  ));
test('more influences per vertex than the contract allows are rejected', () =>
  robotRejects({}, /influences, over 1/, c => (c.skin.influences = 1)));
test('weights that do not sum to one are rejected', () =>
  robotRejects(
    {
      bin: (json, bin) => {
        const a = json.accessors[json.meshes[0].primitives[0].attributes.WEIGHTS_0],
          view = json.bufferViews[a.bufferView];
        assert.equal(a.componentType, 5126, 'float weights');
        bin.writeFloatLE(0.5, (view.byteOffset ?? 0) + (a.byteOffset ?? 0));
        bin.writeFloatLE(0, (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + 4);
        bin.writeFloatLE(0, (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + 8);
        bin.writeFloatLE(0, (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + 12);
        return bin;
      },
    },
    /weights sum to 0\.5, not 1/,
  ));
test('a skin root that is missing, or that does not hold every joint, is rejected', async () => {
  await robotRejects({}, /skin root hips is missing/, c => (c.skin.root = 'hips'));
  await robotRejects({}, /is not under the skin root spine/, c => (c.skin.root = 'spine'));
});
test('a skin contract allows one to four influences', () =>
  assert.throws(() => robotContract(c => (c.skin.influences = 5)), /skin\.influences must be 1 to 4/));
