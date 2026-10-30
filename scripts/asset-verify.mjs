#!/usr/bin/env node
// scripts/asset-verify.mjs (`npm run asset:verify -- <model.glb> [...]`): checks a GLB against its model contract.
//
// A model contract is a JSON file next to the model, `<name>.contract.json` beside `<name>.glb`, with the provenance
// receipt `<name>.provenance.json`. The contract states what the creator asked for: size bounds and pivot, triangle,
// vertex, material and texture limits, maximum file and texture bytes, the material properties the exporter may
// write, and the provenance fields every asset must record (licence, author, source, tool, generator). The schema and
// every key are documented in docs/guides/model-contracts.md.
//
//   npm run asset:verify -- game/public/models/lantern.glb      one or more models, each with its adjacent contract
//   npm run asset:verify -- --contract other.json model.glb     one model, an explicit contract
//   npm run asset:verify -- --all                               every contracted GLB under each game's public/models
//   add --json for a machine-readable report, and --masks <folder> to write each silhouette check's model and reference
//   masks as PNGs for inspection
//
// `npm run check` runs `--all`: a GLB under a game's public/models with an adjacent contract must pass it; a GLB without
// a contract is listed, not checked; a contract without its GLB fails.
//
// The geometry checks run on a re-import of the exported GLB, decoded the way the engine's model loader decodes it
// (src/platform/assets/models.ts): three.js's GLTFLoader with the meshopt decoder. Draco is refused, because the engine
// registers only the meshopt decoder. KTX2 textures (KHR_texture_basisu) are accepted when the contract lists the
// extension (ENGINE_KTX2: the model loader transcodes them since PR #146), and each KTX2 image must be what the engine's
// KTX2 step accepts (src/platform/assets/model-ktx2.ts): Basis Universal (ETC1S or UASTC), one 2D image. The loader's own admission caps (LOADER below, mirrored from
// validateEmbeddedGlb in models.ts and checked against it by the tests) apply to every model whatever its contract says.
//
// Owner: the creator's contract; this script only reads. Bounds: one GLB, its contract and its receipt in memory at a
// time; file size is checked before the file is read. It is an acceptance check for the creator's own assets, not a
// security boundary for untrusted files: images are measured from their headers and removed before decoding.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Box3, PropertyBinding, Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {MAX_PIXELS, STAGE_THRESHOLD, VIEWS, compareSilhouette, encodeMaskPng} from './asset-silhouette.mjs';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Every contract must require at least these provenance fields. */
export const PROVENANCE_FIELDS = ['licence', 'author', 'source', 'tool', 'generator'];
const AXES = ['x', 'y', 'z'];
const NODE_TRANSFORMS = ['translation', 'rotation', 'scale', 'matrix'];
const DRACO = 'KHR_draco_mesh_compression';
const KTX2 = 'KHR_texture_basisu';
/**
 * Whether the engine's model loader can decode KTX2 textures. True since src/platform/assets/models.ts registers a KTX2
 * transcoder (PR #146, model-ktx2.ts); asset:optimize --ktx2 follows it. A test keeps it in step with the loader.
 */
export const ENGINE_KTX2 = true;
export const KTX2_UNSUPPORTED = 'KTX2 textures are not loadable until the engine adds KTX2 support';
const MIB = 1024 * 1024;
/** The model loader's admission caps (src/platform/assets/models.ts: maxFileBytes default and validateEmbeddedGlb). */
export const LOADER = {
  fileBytes: 32 * MIB,
  accessors: 4096,
  accessorCount: 1048576,
  scalars: 16777216,
  nodes: 4096,
  skins: 128,
  animations: 128,
  influences: 4,
};
const COMPONENTS = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16};
const PIVOTS = ['base-centre', 'centre', 'any'];
const ALPHA_MODES = ['OPAQUE', 'MASK', 'BLEND'];
const MATERIAL_TEXTURE_KEYS = ['normalTexture', 'occlusionTexture', 'emissiveTexture'];
const PBR_TEXTURE_KEYS = ['baseColorTexture', 'metallicRoughnessTexture'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const show = p => relative(ROOT, p).split(sep).join('/') || p;

// ---------------------------------------------------------------------------------------------------------------------
// The contract: a closed schema, so a misspelt key is an error rather than a silently missing check.

const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = v => Number.isInteger(v) && v >= 0;
const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const isStrings = v => Array.isArray(v) && v.every(s => typeof s === 'string' && s.length > 0);
const closed = (value, where, allowed) => {
  if (!isObject(value)) throw Error(`contract ${where} must be an object`);
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw Error(`contract ${where} has unknown key "${key}" (allowed: ${allowed.join(', ')})`);
};
const need = (ok, message) => {
  if (!ok) throw Error(`contract ${message}`);
};

/**
 * Validate a parsed contract and fill its defaults. Throws a one-line Error naming the first problem. `dir` is the
 * contract's folder, which a silhouette reference path is relative to.
 */
export function parseContract(raw, {dir = process.cwd()} = {}) {
  closed(raw, 'root', [
    '$comment',
    'schema',
    'units',
    'up',
    'tolerance',
    'bounds',
    'size',
    'pivot',
    'limits',
    'nodeTransforms',
    'extensions',
    'materials',
    'lattice',
    'faces',
    'semanticSha256',
    'nodes',
    'clips',
    'silhouette',
    'skin',
    'provenance',
  ]);
  need(raw.schema === 1, 'schema must be 1');
  need(raw.units === 'metres', 'units must be "metres" (glTF units are metres)');
  need(raw.up === '+Y', 'up must be "+Y" (glTF is Y-up; export with export_yup=True)');
  const tolerance = raw.tolerance ?? 1e-6;
  need(Number.isFinite(tolerance) && tolerance >= 0 && tolerance < 1, 'tolerance must be a number in [0, 1)');
  need(raw.bounds !== undefined || raw.size !== undefined, 'needs bounds, size or both');
  for (const key of ['bounds', 'size'])
    if (raw[key] !== undefined) {
      closed(raw[key], key, ['min', 'max']);
      need(isVec3(raw[key].min) && isVec3(raw[key].max), `${key}.min and ${key}.max must be [x, y, z] numbers`);
      need(
        raw[key].min.every((v, i) => v <= raw[key].max[i]),
        `${key}.min must not exceed ${key}.max on any axis`,
      );
    }
  if (raw.size)
    need(
      raw.size.min.every(v => v >= 0),
      'size.min must not be negative',
    );
  closed(raw.pivot, 'pivot', ['at', 'node', 'tolerance']);
  need(PIVOTS.includes(raw.pivot.at), `pivot.at must be one of ${PIVOTS.join(', ')}`);
  need(raw.pivot.node === undefined || typeof raw.pivot.node === 'string', 'pivot.node must be a node name');
  const pivotTolerance = raw.pivot.tolerance ?? tolerance;
  need(Number.isFinite(pivotTolerance) && pivotTolerance >= 0, 'pivot.tolerance must be a non-negative number');
  const required = ['fileBytes', 'triangles', 'vertices', 'materials', 'textures', 'textureBytes'];
  closed(raw.limits, 'limits', [...required, 'primitives', 'animations', 'cameras', 'textureSize']);
  for (const key of required) need(isCount(raw.limits[key]), `limits.${key} must be a whole number`);
  for (const key of ['primitives', 'animations', 'cameras', 'textureSize'])
    need(raw.limits[key] === undefined || isCount(raw.limits[key]), `limits.${key} must be a whole number`);
  need(raw.limits.fileBytes > 0, 'limits.fileBytes must be positive');
  need(
    raw.limits.textures === 0 || raw.limits.textureSize > 0,
    'limits.textureSize (the largest width or height in pixels) is required when textures are allowed',
  );
  for (const key of ['nodes', 'clips'])
    need(
      raw[key] === undefined || (isStrings(raw[key]) && new Set(raw[key]).size === raw[key].length),
      `${key} must be a list of distinct names`,
    );
  need(
    (raw.clips?.length ?? 0) <= (raw.limits.animations ?? 0),
    'limits.animations must be at least the number of required clips',
  );
  if (raw.skin !== undefined) {
    closed(raw.skin, 'skin', ['joints', 'influences', 'root']);
    need(isCount(raw.skin.joints) && raw.skin.joints > 0, 'skin.joints must be a positive whole number');
    need(
      Number.isInteger(raw.skin.influences) && raw.skin.influences >= 1 && raw.skin.influences <= 4,
      'skin.influences must be 1 to 4 (one JOINTS_0/WEIGHTS_0 set)',
    );
    need(raw.skin.root === undefined || typeof raw.skin.root === 'string', 'skin.root must be a node name');
  }
  need(
    raw.nodeTransforms === undefined || ['allowed', 'forbidden'].includes(raw.nodeTransforms),
    'nodeTransforms must be "allowed" or "forbidden"',
  );
  need(raw.extensions === undefined || isStrings(raw.extensions), 'extensions must be a list of extension names');
  for (const name of raw.extensions ?? [])
    need(name !== DRACO, `extensions cannot allow ${DRACO}: the engine registers only the meshopt decoder`);
  for (const name of raw.extensions ?? [])
    need(ENGINE_KTX2 || name !== KTX2, `extensions cannot allow ${KTX2}: ${KTX2_UNSUPPORTED}`);
  const m = raw.materials;
  closed(m, 'materials', ['properties', 'pbr', 'required', 'requiredPbr', 'alphaModes', 'expected']);
  need(isStrings(m.properties) && m.properties.includes('name'), 'materials.properties must list "name" and others');
  need(isStrings(m.pbr), 'materials.pbr must list the allowed pbrMetallicRoughness keys');
  for (const key of ['required', 'requiredPbr'])
    need(m[key] === undefined || isStrings(m[key]), `materials.${key} must be a list of property names`);
  for (const key of m.required ?? []) need(m.properties.includes(key), `materials.required "${key}" is not allowed`);
  for (const key of m.requiredPbr ?? []) need(m.pbr.includes(key), `materials.requiredPbr "${key}" is not allowed`);
  need(
    m.alphaModes === undefined || (isStrings(m.alphaModes) && m.alphaModes.every(a => ALPHA_MODES.includes(a))),
    `materials.alphaModes must be some of ${ALPHA_MODES.join(', ')}`,
  );
  if (m.expected !== undefined) {
    need(Array.isArray(m.expected) && m.expected.length > 0, 'materials.expected must be a non-empty list');
    for (const [i, e] of m.expected.entries()) {
      closed(e, `materials.expected[${i}]`, [
        'name',
        'baseColorFactor',
        'metallicFactor',
        'roughnessFactor',
        'emissiveFactor',
        'doubleSided',
      ]);
      need(typeof e.name === 'string' && e.name.length > 0, `materials.expected[${i}].name is required`);
      need(
        e.baseColorFactor === undefined || (Array.isArray(e.baseColorFactor) && e.baseColorFactor.length === 4),
        `materials.expected[${i}].baseColorFactor must be [r, g, b, a]`,
      );
      need(
        e.emissiveFactor === undefined || isVec3(e.emissiveFactor),
        `materials.expected[${i}].emissiveFactor must be [r, g, b]`,
      );
    }
    need(new Set(m.expected.map(e => e.name)).size === m.expected.length, 'materials.expected names must be unique');
    need(m.expected.length <= raw.limits.materials, 'materials.expected lists more materials than limits.materials');
  }
  if (raw.lattice !== undefined) {
    closed(raw.lattice, 'lattice', ['name', 'x', 'y', 'z']);
    need(typeof raw.lattice.name === 'string', 'lattice.name must describe the allowed vertex positions');
    for (const axis of AXES)
      need(
        Array.isArray(raw.lattice[axis]) && raw.lattice[axis].length > 0 && raw.lattice[axis].every(Number.isFinite),
        `lattice.${axis} must list the allowed coordinates`,
      );
  }
  if (raw.faces !== undefined) {
    need(Array.isArray(raw.faces), 'faces must be a list');
    for (const [i, f] of raw.faces.entries()) {
      closed(f, `faces[${i}]`, ['name', 'axis', 'at', 'material', 'triangles']);
      need(typeof f.name === 'string' && AXES.includes(f.axis), `faces[${i}] needs a name and an axis x, y or z`);
      need(Number.isFinite(f.at) && typeof f.material === 'string', `faces[${i}] needs at and material`);
      need(f.triangles === undefined || isCount(f.triangles), `faces[${i}].triangles must be a whole number`);
    }
  }
  need(
    raw.semanticSha256 === undefined || /^[0-9a-f]{64}$/.test(raw.semanticSha256),
    'semanticSha256 must be a lowercase SHA-256 hex digest',
  );
  let silhouette;
  if (raw.silhouette !== undefined) {
    const sil = raw.silhouette;
    closed(sil, 'silhouette', ['reference', 'view', 'pixels', 'stage', 'threshold']);
    need(typeof sil.reference === 'string' && /\.png$/i.test(sil.reference), 'silhouette.reference must name a .png');
    need(VIEWS.includes(sil.view), `silhouette.view must be one of ${VIEWS.join(', ')}`);
    const pixels = sil.pixels ?? 128,
      stage = sil.stage ?? 'final';
    need(
      Number.isInteger(pixels) && pixels >= 16 && pixels <= MAX_PIXELS,
      `silhouette.pixels must be a whole number from 16 to ${MAX_PIXELS}`,
    );
    need(stage in STAGE_THRESHOLD, `silhouette.stage must be one of ${Object.keys(STAGE_THRESHOLD).join(', ')}`);
    need(
      sil.threshold === undefined || (Number.isFinite(sil.threshold) && sil.threshold > 0 && sil.threshold <= 1),
      'silhouette.threshold must be a number above 0 and at most 1',
    );
    silhouette = {
      reference: resolve(dir, sil.reference),
      name: sil.reference,
      view: sil.view,
      pixels,
      stage,
      threshold: sil.threshold ?? STAGE_THRESHOLD[stage],
    };
  }
  closed(raw.provenance, 'provenance', ['required', 'licences', 'equals']);
  need(isStrings(raw.provenance.required), 'provenance.required must list field names');
  for (const field of PROVENANCE_FIELDS)
    need(raw.provenance.required.includes(field), `provenance.required must include "${field}"`);
  need(
    raw.provenance.licences === undefined || (isStrings(raw.provenance.licences) && raw.provenance.licences.length),
    'provenance.licences must list the accepted licence identifiers',
  );
  need(raw.provenance.equals === undefined || isObject(raw.provenance.equals), 'provenance.equals must be an object');
  return {
    ...raw,
    tolerance,
    pivot: {...raw.pivot, tolerance: pivotTolerance},
    limits: {animations: 0, cameras: 0, ...raw.limits},
    nodeTransforms: raw.nodeTransforms ?? 'allowed',
    extensions: raw.extensions ?? [],
    materials: {required: [], requiredPbr: [], alphaModes: ['OPAQUE'], ...m},
    faces: raw.faces ?? [],
    nodes: raw.nodes ?? [],
    clips: raw.clips ?? [],
    silhouette,
  };
}

/** The adjacent files of a model: `<name>.contract.json` and `<name>.provenance.json`. */
export const companions = file => {
  assert.ok(/\.glb$/i.test(file), `${show(file)}: a model contract applies to a .glb file`);
  const stem = file.replace(/\.glb$/i, '');
  return {contract: `${stem}.contract.json`, provenance: `${stem}.provenance.json`};
};

export const readContract = path => {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw Error(`${show(path)}: cannot read the contract: ${error.message}`);
  }
  try {
    return parseContract(raw, {dir: dirname(resolve(path))});
  } catch (error) {
    throw Error(`${show(path)}: ${error.message}`);
  }
};

// ---------------------------------------------------------------------------------------------------------------------
// The GLB container.

/** Split a binary glTF into its JSON and BIN chunks, checking the header and chunk layout. */
export function readGlb(bytes) {
  assert.ok(bytes.length >= 20, 'not a GLB: shorter than its header');
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'not a GLB: wrong magic (export glTF Binary .glb)');
  assert.equal(bytes.readUInt32LE(4), 2, 'GLB version must be 2');
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'GLB length header disagrees with the file size');
  const length = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, 'the first GLB chunk must be JSON');
  assert.ok(20 + length <= bytes.length, 'GLB JSON chunk overruns the file');
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  let bin = null;
  const next = 20 + length;
  if (next < bytes.length) {
    assert.ok(next + 8 <= bytes.length, 'GLB BIN chunk header is truncated');
    assert.equal(bytes.readUInt32LE(next + 4), 0x004e4942, 'the second GLB chunk must be BIN');
    const binLength = bytes.readUInt32LE(next);
    assert.ok(next + 8 + binLength <= bytes.length, 'GLB BIN chunk overruns the file');
    bin = bytes.subarray(next + 8, next + 8 + binLength);
  }
  return {json, bin};
}

/** Re-pack a GLB with new JSON and the same BIN chunk. */
export const packGlb = (json, bin) => {
  let chunk = Buffer.from(JSON.stringify(json));
  chunk = Buffer.concat([chunk, Buffer.alloc((4 - (chunk.length % 4)) % 4, 32)]);
  const parts = [Buffer.alloc(20), chunk];
  if (bin) {
    const padded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]),
      head = Buffer.alloc(8);
    head.writeUInt32LE(padded.length, 0);
    head.writeUInt32LE(0x004e4942, 4);
    parts.push(head, padded);
  }
  const out = Buffer.concat(parts);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(chunk.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  return out;
};

/** A copy without images and texture references: geometry decodes in Node, where no image decoder exists. */
const withoutTextures = json => {
  if (!json.images && !json.textures && !json.samplers) return null;
  const copy = structuredClone(json);
  delete copy.images;
  delete copy.textures;
  delete copy.samplers;
  for (const m of copy.materials ?? []) {
    for (const key of MATERIAL_TEXTURE_KEYS) delete m[key];
    for (const key of PBR_TEXTURE_KEYS) delete m.pbrMetallicRoughness?.[key];
    delete m.extensions;
  }
  return copy;
};

/** Width and height from a PNG, JPEG, WebP or KTX2 header, or null for anything else. */
export function imageSize(b) {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('latin1', 12, 16) === 'IHDR')
    return {width: b.readUInt32BE(16), height: b.readUInt32BE(20)};
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    // JPEG: walk the markers to the first start-of-frame (SOF0..SOF15 except DHT, JPG and DAC).
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return {width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5)};
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  }
  if (b.length >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const kind = b.toString('latin1', 12, 16);
    if (kind === 'VP8 ') return {width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff};
    if (kind === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return {width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1};
    }
    if (kind === 'VP8X') return {width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1};
    return null;
  }
  const KTX2_MAGIC = '«KTX 20»\r\n\x1a\n';
  if (b.length >= 40 && b.toString('latin1', 0, 12) === KTX2_MAGIC)
    return {
      width: b.readUInt32LE(20),
      height: Math.max(1, b.readUInt32LE(24)),
      ktx2: {
        vkFormat: b.readUInt32LE(12),
        depth: b.readUInt32LE(28),
        layers: b.readUInt32LE(32),
        faces: b.readUInt32LE(36),
      },
    };
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The check.

const sameNumbers = (actual, expected, tolerance) =>
  Array.isArray(actual) &&
  actual.length === expected.length &&
  actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);

/**
 * Check one GLB against a contract. Throws an AssertionError naming the first breach; returns a report on success.
 * `provenance` defaults to the adjacent receipt; `root` resolves the receipt's `source` path for its sourceSha256.
 */
/** A VEC4 accessor as rows of numbers; normalised unsigned integers become 0..1. */
function vec4s(json, bin, index) {
  const a = json.accessors[index],
    view = json.bufferViews[a.bufferView];
  const reader = {5126: [4, 'readFloatLE', 1], 5121: [1, 'readUInt8', 255], 5123: [2, 'readUInt16LE', 65535]}[
    a.componentType
  ];
  assert.ok(reader && a.type === 'VEC4' && !a.sparse, `accessor ${index} is not a supported VEC4 layout`);
  const [size, read, max] = reader,
    stride = view.byteStride ?? size * 4,
    base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return Array.from({length: a.count}, (_, i) =>
    [0, 1, 2, 3].map(k => {
      const value = bin[read](base + i * stride + k * size);
      return a.normalized ? value / max : value;
    }),
  );
}

export async function verifyModel(file, contract, {provenance = companions(file).provenance, root = ROOT, masks} = {}) {
  const c = contract;
  const size = statSync(file).size;
  assert.ok(size <= LOADER.fileBytes, `file is ${size} bytes, over the model loader's ${LOADER.fileBytes}`);
  assert.ok(size <= c.limits.fileBytes, `file is ${size} bytes, over the contract's ${c.limits.fileBytes}`);
  const bytes = readFileSync(file);

  // Provenance: the receipt names the asset's true origin and matches these exact bytes.
  assert.ok(existsSync(provenance), `missing provenance receipt ${show(provenance)}`);
  const manifest = JSON.parse(readFileSync(provenance, 'utf8'));
  assert.equal(
    manifest.sha256,
    digest(bytes),
    'asset hash disagrees with provenance: re-export or rewrite the receipt',
  );
  for (const field of c.provenance.required) {
    const value = manifest[field];
    assert.ok(
      value !== undefined && value !== null && value !== '',
      `provenance lacks the required field "${field}" (the contract requires ${c.provenance.required.join(', ')})`,
    );
  }
  for (const field of PROVENANCE_FIELDS)
    assert.equal(typeof manifest[field], 'string', `provenance field "${field}" must be text`);
  if (c.provenance.licences)
    assert.ok(
      c.provenance.licences.includes(manifest.licence),
      `licence ${manifest.licence} is not one the contract accepts (${c.provenance.licences.join(', ')})`,
    );
  for (const [key, value] of Object.entries(c.provenance.equals ?? {}))
    assert.deepEqual(manifest[key], value, `provenance ${key} must equal the contract's value`);
  if (manifest.sourceSha256 !== undefined) {
    const source = isAbsolute(manifest.source) ? manifest.source : join(root, manifest.source);
    assert.ok(existsSync(source), `provenance sourceSha256 is set but its source ${manifest.source} does not exist`);
    assert.equal(manifest.sourceSha256, digest(readFileSync(source)), 'export source changed: regenerate');
  }

  // Container and declarations.
  const {json, bin} = readGlb(bytes);
  assert.equal(
    manifest.generator,
    json.asset?.generator,
    'provenance generator must equal the GLB asset.generator that wrote it',
  );
  // A meshopt fallback buffer holds no data (the decoder writes into it), so it is not a second real buffer.
  const fallback = buffer =>
    ['EXT_meshopt_compression', 'KHR_meshopt_compression'].some(e => buffer.extensions?.[e]?.fallback === true);
  const real = (json.buffers ?? []).filter(b => !fallback(b));
  assert.ok(real.length <= 1, 'one embedded buffer at most');
  for (const buffer of json.buffers ?? []) assert.ok(!buffer.uri, 'buffer must be embedded (no uri)');
  assert.ok(!real.length || bin, 'the declared buffer needs the GLB BIN chunk');
  for (const image of json.images ?? [])
    assert.ok(!image.uri && image.bufferView !== undefined, 'image must be embedded in the GLB (bufferView, no uri)');
  // The model loader's admission caps, whatever the contract allows.
  const accessors = json.accessors ?? [];
  assert.ok(
    accessors.length <= LOADER.accessors,
    `${accessors.length} accessors, over the model loader's ${LOADER.accessors}`,
  );
  let scalars = 0;
  for (const [i, accessor] of accessors.entries()) {
    const width = COMPONENTS[accessor.type];
    assert.ok(width, `accessor ${i} has an unknown type ${accessor.type}`);
    assert.ok(
      Number.isSafeInteger(accessor.count) && accessor.count >= 0 && accessor.count <= LOADER.accessorCount,
      `accessor ${i} has ${accessor.count} elements, over the model loader's ${LOADER.accessorCount}`,
    );
    scalars += accessor.count * width;
  }
  assert.ok(scalars <= LOADER.scalars, `${scalars} decoded accessor values, over the model loader's ${LOADER.scalars}`);
  for (const [key, cap] of [
    ['nodes', LOADER.nodes],
    ['skins', LOADER.skins],
    ['animations', LOADER.animations],
  ])
    assert.ok((json[key]?.length ?? 0) <= cap, `${json[key]?.length} ${key}, over the model loader's ${cap}`);
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives)
      for (const name of Object.keys(primitive.attributes ?? {}))
        assert.ok(
          !/^(JOINTS|WEIGHTS)_[1-9]\d*$/.test(name),
          `mesh ${mesh.name} has ${name}: at most ${LOADER.influences} bone influences per vertex (JOINTS_0 and WEIGHTS_0)`,
        );
  if (!ENGINE_KTX2)
    assert.ok(
      ![...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])].includes(KTX2) &&
        !(json.textures ?? []).some(t => t.extensions?.[KTX2]) &&
        !(json.images ?? []).some(image => image.mimeType === 'image/ktx2'),
      `${KTX2_UNSUPPORTED}: use PNG, JPEG or WebP textures`,
    );
  for (const name of [...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])]) {
    assert.ok(
      name !== DRACO,
      `${DRACO}: Draco is not accepted, the engine registers only the meshopt decoder; export uncompressed or with meshopt`,
    );
    assert.ok(
      c.extensions.includes(name),
      `extension ${name} is not one the contract allows (${c.extensions.join(', ') || 'none'})`,
    );
  }
  const textures = json.textures?.length ?? 0;
  assert.ok(textures <= c.limits.textures, `${textures} textures, over the contract's ${c.limits.textures}`);
  const textureBytes = (json.images ?? []).reduce(
    (n, image) => n + (json.bufferViews[image.bufferView].byteLength ?? 0),
    0,
  );
  assert.ok(
    textureBytes <= c.limits.textureBytes,
    `${textureBytes} bytes of embedded images, over the contract's ${c.limits.textureBytes}`,
  );
  const largest = c.limits.textureSize ?? 0;
  for (const [i, image] of (json.images ?? []).entries()) {
    const view = json.bufferViews[image.bufferView];
    const size = imageSize(bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
    assert.ok(size, `image ${i} (${image.mimeType ?? 'no mimeType'}) is not a PNG, JPEG, WebP or KTX2 image`);
    if (size.ktx2) {
      assert.ok(
        (json.extensionsUsed ?? []).includes(KTX2),
        `image ${i} is KTX2, so the GLB must declare ${KTX2} (the engine transcodes only images a texture names through it)`,
      );
      assert.equal(size.ktx2.vkFormat, 0, `image ${i}: a KTX2 image must be Basis Universal (ETC1S or UASTC)`);
      assert.ok(
        size.ktx2.depth === 0 && size.ktx2.layers === 0 && size.ktx2.faces === 1,
        `image ${i}: a KTX2 image must be one 2D texture (no depth, layers or cube faces)`,
      );
    }
    assert.ok(
      size.width <= largest && size.height <= largest,
      `image ${i} is ${size.width}×${size.height}, over the contract's textureSize ${largest}`,
    );
  }
  const animations = json.animations?.length ?? 0;
  assert.ok(animations <= c.limits.animations, `${animations} animations, over the contract's ${c.limits.animations}`);
  const cameras = json.cameras?.length ?? 0;
  assert.ok(cameras <= c.limits.cameras, `${cameras} cameras, over the contract's ${c.limits.cameras}`);
  const materials = json.materials ?? [];
  assert.ok(
    materials.length <= c.limits.materials,
    `${materials.length} materials, over the contract's ${c.limits.materials}`,
  );
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives) assert.equal(primitive.mode ?? 4, 4, 'triangle primitives only');
  if (c.skin) {
    // Skins: joint count, a single influence set, and every joint under the named root.
    const parent = new Map();
    (json.nodes ?? []).forEach((n, i) => (n.children ?? []).forEach(child => parent.set(child, i)));
    const root = c.skin.root === undefined ? -1 : (json.nodes ?? []).findIndex(n => n.name === c.skin.root);
    assert.ok(c.skin.root === undefined || root >= 0, `the skin root ${c.skin.root} is missing`);
    for (const skin of json.skins ?? []) {
      assert.ok(
        skin.joints.length <= c.skin.joints,
        `a skin has ${skin.joints.length} joints, over the contract's ${c.skin.joints}`,
      );
      if (root >= 0)
        for (const joint of skin.joints) {
          let k = joint;
          while (k !== undefined && k !== root) k = parent.get(k);
          assert.ok(k === root, `joint ${json.nodes[joint].name} is not under the skin root ${c.skin.root}`);
        }
    }
    // A second influence set (JOINTS_1/WEIGHTS_1) is already refused by the loader caps above.
    for (const [m, mesh] of (json.meshes ?? []).entries())
      for (const primitive of mesh.primitives) {
        const a = primitive.attributes;
        if (a.WEIGHTS_0 === undefined) continue;
        // Raw accessor values: the loader renormalises weights, so the re-import cannot show a bad sum.
        const skin = json.skins?.[(json.nodes ?? []).find(n => n.mesh === m)?.skin];
        const weights = vec4s(json, bin, a.WEIGHTS_0),
          joints = vec4s(json, bin, a.JOINTS_0);
        weights.forEach((w, v) => {
          assert.ok(
            w.every(x => Number.isFinite(x) && x >= 0),
            `mesh ${mesh.name} vertex ${v}: weights must be finite and not negative`,
          );
          const used = w.filter(x => x > 1e-6).length,
            sum = w.reduce((n, x) => n + x, 0);
          assert.ok(
            used <= c.skin.influences,
            `mesh ${mesh.name} vertex ${v}: ${used} influences, over ${c.skin.influences}`,
          );
          assert.ok(Math.abs(sum - 1) <= 2e-3, `mesh ${mesh.name} vertex ${v}: weights sum to ${round(sum)}, not 1`);
          assert.ok(
            w.every((x, k) => x <= 1e-6 || joints[v][k] < (skin?.joints.length ?? 0)),
            `mesh ${mesh.name} vertex ${v}: a joint index outside its skin`,
          );
        });
      }
  }
  if (c.nodeTransforms === 'forbidden')
    for (const node of json.nodes ?? [])
      for (const key of NODE_TRANSFORMS)
        assert.equal(
          node[key],
          undefined,
          `node ${node.name} must not carry a ${key}: transforms are baked into mesh coordinates`,
        );

  // Materials: only the properties the exporter writes and the contract allows.
  const m = c.materials;
  for (const material of materials) {
    const keys = Object.keys(material);
    for (const key of keys)
      assert.ok(
        m.properties.includes(key),
        `material ${material.name} has only the exported properties the contract allows; ${key} is not (${m.properties.join(', ')})`,
      );
    for (const key of m.required)
      assert.ok(keys.includes(key), `material ${material.name} lacks the required property ${key}`);
    const pbr = material.pbrMetallicRoughness ?? {};
    for (const key of Object.keys(pbr))
      assert.ok(
        m.pbr.includes(key),
        `material ${material.name} has only the exported PBR properties the contract allows; ${key} is not (${m.pbr.join(', ') || 'none'})`,
      );
    for (const key of m.requiredPbr)
      assert.ok(key in pbr, `material ${material.name} lacks the required PBR property ${key}`);
    assert.ok(
      m.alphaModes.includes(material.alphaMode ?? 'OPAQUE'),
      `material ${material.name} alphaMode ${material.alphaMode ?? 'OPAQUE'} is not one of ${m.alphaModes.join(', ')}`,
    );
  }
  if (m.expected) {
    assert.deepEqual(
      materials.map(x => x.name).sort(),
      m.expected.map(x => x.name).sort(),
      'the materials are exactly the ones the contract expects',
    );
    for (const e of m.expected) {
      const material = materials.find(x => x.name === e.name),
        pbr = material.pbrMetallicRoughness ?? {};
      if (e.doubleSided !== undefined)
        assert.equal(
          material.doubleSided ?? false,
          e.doubleSided,
          `material ${e.name} keeps the exported doubleSided value`,
        );
      if (e.baseColorFactor)
        assert.ok(
          sameNumbers(pbr.baseColorFactor ?? [1, 1, 1, 1], e.baseColorFactor, c.tolerance),
          `material ${e.name} baseColorFactor differs from the contract`,
        );
      if (e.metallicFactor !== undefined)
        assert.ok(
          Math.abs((pbr.metallicFactor ?? 1) - e.metallicFactor) <= c.tolerance,
          `material ${e.name} metallicFactor differs from the contract`,
        );
      if (e.roughnessFactor !== undefined)
        assert.ok(
          Math.abs((pbr.roughnessFactor ?? 1) - e.roughnessFactor) <= c.tolerance,
          `material ${e.name} roughnessFactor differs from the contract`,
        );
      if (e.emissiveFactor)
        assert.ok(
          sameNumbers(material.emissiveFactor ?? [0, 0, 0], e.emissiveFactor, c.tolerance),
          `material ${e.name} emissiveFactor differs from the contract`,
        );
    }
  }

  // Decoded geometry: what the engine's loader will actually build.
  const stripped = withoutTextures(json),
    decode = stripped ? packGlb(stripped, bin) : bytes;
  await MeshoptDecoder.ready;
  const asset = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(decode.buffer.slice(decode.byteOffset, decode.byteOffset + decode.byteLength), '');
  try {
    asset.scene.updateMatrixWorld(true);
    let lights = 0;
    asset.scene.traverse(o => {
      if (o.isLight) lights++;
    });
    assert.equal(lights, 0, 'the model carries a light: the scene owns lighting');
    const bounds = new Box3().setFromObject(asset.scene, true);
    assert.ok(!bounds.isEmpty(), 'the model has no geometry');
    const min = bounds.min.toArray(),
      max = bounds.max.toArray(),
      extent = max.map((v, i) => v - min[i]);
    const near = (a, b, t = c.tolerance) => Math.abs(a - b) <= t;
    if (c.bounds) {
      assert.ok(
        sameNumbers(min, c.bounds.min, c.tolerance),
        `decoded bounds min ${fmt(min)} differ from the contract's ${fmt(c.bounds.min)}`,
      );
      assert.ok(
        sameNumbers(max, c.bounds.max, c.tolerance),
        `decoded bounds max ${fmt(max)} differ from the contract's ${fmt(c.bounds.max)}`,
      );
    }
    if (c.size)
      for (const [i, axis] of AXES.entries())
        assert.ok(
          extent[i] >= c.size.min[i] - c.tolerance && extent[i] <= c.size.max[i] + c.tolerance,
          `size ${axis} is ${round(extent[i])} m, outside the contract's ${c.size.min[i]} to ${c.size.max[i]} m`,
        );
    const centre = min.map((v, i) => (v + max[i]) / 2),
      pt = c.pivot.tolerance;
    if (c.pivot.at === 'base-centre') {
      assert.ok(near(min[1], 0, pt), `base pivot: the model's lowest point is y=${round(min[1])}, not 0`);
      assert.ok(
        near(centre[0], 0, pt) && near(centre[2], 0, pt),
        `base pivot: the footprint centre is x=${round(centre[0])} z=${round(centre[2])}, not 0 0`,
      );
    } else if (c.pivot.at === 'centre')
      assert.ok(
        centre.every(v => near(v, 0, pt)),
        `centre pivot: the bounds centre is ${fmt(centre)}, not the origin`,
      );
    if (c.pivot.node !== undefined) {
      const root = asset.scene.getObjectByName(c.pivot.node);
      assert.ok(root, `the pivot node ${c.pivot.node} is missing`);
      assert.ok(
        root
          .getWorldPosition(new Vector3())
          .toArray()
          .every(v => near(v, 0, pt)),
        `base pivot: node ${c.pivot.node} is not at the origin`,
      );
    }

    for (const name of c.nodes)
      assert.ok(
        (json.nodes ?? []).some(n => n.name === name) &&
          asset.scene.getObjectByName(PropertyBinding.sanitizeNodeName(name)),
        `the required node ${name} is missing`,
      );
    const clipNames = asset.animations.map(a => a.name);
    for (const name of c.clips) {
      const clip = asset.animations.find(a => a.name === name);
      assert.ok(clip, `the required clip ${name} is missing (clips: ${clipNames.join(', ') || 'none'})`);
      assert.ok(clip.duration > 0, `the required clip ${name} has no duration`);
    }

    const geometry = [];
    let triangles = 0,
      vertices = 0;
    asset.scene.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry,
        material = o.material;
      assert.ok(!Array.isArray(material), 'one material per primitive');
      triangles += (g.index?.count ?? g.attributes.position.count) / 3;
      vertices += g.attributes.position.count;
      geometry.push({
        matrix: o.matrixWorld.toArray(),
        positions: Array.from(g.attributes.position.array),
        normals: g.attributes.normal ? Array.from(g.attributes.normal.array) : null,
        indices: g.index ? Array.from(g.index.array) : null,
        material: {
          name: material.name,
          colour: material.color.toArray(),
          metalness: material.metalness,
          roughness: material.roughness,
        },
      });
    });
    assert.ok(triangles <= c.limits.triangles, `${triangles} triangles, over the contract's ${c.limits.triangles}`);
    assert.ok(vertices <= c.limits.vertices, `${vertices} vertices, over the contract's ${c.limits.vertices}`);
    if (c.limits.primitives !== undefined)
      assert.ok(
        geometry.length <= c.limits.primitives,
        `${geometry.length} primitives, over the contract's ${c.limits.primitives}`,
      );
    if (c.lattice) {
      const allowed = AXES.map(axis => c.lattice[axis]);
      for (const g of geometry)
        assert.ok(
          g.positions.every((v, i) => allowed[i % 3].some(a => near(v, a))),
          `${g.material.name} vertices lie on ${c.lattice.name}`,
        );
    }
    for (const face of c.faces) {
      const axis = AXES.indexOf(face.axis);
      const on = geometry.filter(g => g.positions.every((v, i) => i % 3 !== axis || near(v, face.at)));
      assert.equal(on.length, 1, `exactly one primitive is ${face.name}`);
      assert.equal(on[0].material.name, face.material, `${face.name} uses ${face.material}`);
      if (face.triangles !== undefined)
        assert.equal(
          (on[0].indices?.length ?? on[0].positions.length / 3) / 3,
          face.triangles,
          `${face.name} is ${face.triangles} triangles`,
        );
    }
    let silhouette;
    if (c.silhouette) {
      const sil = c.silhouette;
      assert.ok(existsSync(sil.reference), `the silhouette reference ${sil.name} does not exist`);
      const result = compareSilhouette(asset.scene, sil);
      silhouette = {
        view: sil.view,
        pixels: sil.pixels,
        stage: sil.stage,
        threshold: sil.threshold,
        iou: round(result.iou),
      };
      if (masks) {
        const stem = join(masks, `${basename(file, '.glb')}.${sil.view}`);
        writeFileSync(`${stem}.model.png`, encodeMaskPng(result.model));
        writeFileSync(`${stem}.reference.png`, encodeMaskPng(result.reference));
      }
      assert.ok(
        result.iou >= sil.threshold,
        `silhouette overlap ${result.iou.toFixed(3)} with ${sil.name} (${sil.view}, ${sil.pixels} px) is below the ${sil.stage} threshold ${sil.threshold}`,
      );
    }
    const semanticSha256 = digest(JSON.stringify(geometry));
    if (c.semanticSha256)
      assert.equal(
        semanticSha256,
        c.semanticSha256,
        'decoded geometry or materials differ from the checked-in export (the contract pins its semanticSha256)',
      );
    return {
      file: show(file),
      bytes: bytes.length,
      triangles,
      vertices,
      primitives: geometry.length,
      materials: materials.length,
      textures,
      textureBytes,
      animations,
      clips: clipNames,
      silhouette,
      bounds: [min, max],
      size: extent.map(round),
      sha256: digest(bytes),
      semanticSha256,
      licence: manifest.licence,
      author: manifest.author,
      source: manifest.source,
      tool: manifest.tool,
      generator: manifest.generator,
    };
  } finally {
    asset.scene.traverse(n => {
      if (n.isMesh) {
        n.geometry.dispose();
        n.material.dispose();
      }
    });
  }
}
const round = v => Math.round(v * 1e6) / 1e6;
const fmt = v => `[${v.map(round).join(', ')}]`;

/** Check one GLB against its adjacent contract (or an explicit one). */
export async function verifyFile(file, {contract, masks} = {}) {
  const path = contract ?? companions(file).contract;
  assert.ok(existsSync(path), `${show(file)} has no contract: write ${show(path)} (docs/guides/model-contracts.md)`);
  return verifyModel(file, readContract(path), {masks});
}

// ---------------------------------------------------------------------------------------------------------------------
// Discovery: every game folder's public/models.

/** Game folders in a repository: root game/, templates/<name>/game, labs/<name>/game and tools/<name>/game (and an extra one). */
export function gameFolders(root = ROOT, extra = process.env.GAME_DIR) {
  const out = new Set();
  const add = dir => {
    if (existsSync(join(dir, 'game.ts'))) out.add(resolve(dir));
  };
  add(join(root, 'game'));
  for (const parent of ['templates', 'labs', 'tools']) {
    const dir = join(root, parent);
    if (existsSync(dir)) for (const name of readdirSync(dir).sort()) add(join(dir, name, 'game'));
  }
  if (extra) add(isAbsolute(extra) ? extra : join(root, extra));
  return [...out];
}

/** Every GLB and contract under the games' public/models: contracted, uncontracted and orphaned contracts. */
export function discover(games = gameFolders()) {
  const contracted = [],
    uncontracted = [],
    orphans = [];
  for (const game of games) {
    const models = join(game, 'public', 'models');
    if (!existsSync(models)) continue;
    const files = readdirSync(models, {recursive: true})
      .map(f => join(models, String(f)))
      .filter(f => statSync(f).isFile())
      .sort();
    for (const f of files) {
      if (/\.glb$/i.test(f)) (existsSync(companions(f).contract) ? contracted : uncontracted).push(f);
      else if (f.endsWith('.contract.json') && !existsSync(f.replace(/\.contract\.json$/, '.glb'))) orphans.push(f);
    }
  }
  return {contracted, uncontracted, orphans};
}

// ---------------------------------------------------------------------------------------------------------------------
// Command line.

export function parseArgs(argv) {
  const files = [];
  let all = false,
    json = false,
    contract,
    masks;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--all') all = true;
    else if (arg === '--json') json = true;
    else if (arg === '--contract') {
      contract = argv[++i];
      if (!contract || contract.startsWith('-')) throw Error('--contract needs a file');
    } else if (arg === '--masks') {
      masks = argv[++i];
      if (!masks || masks.startsWith('-')) throw Error('--masks needs a folder');
    } else if (arg.startsWith('-')) throw Error(`Unknown option: ${arg}`);
    else files.push(arg);
  }
  if (!all && !files.length)
    throw Error('Usage: npm run asset:verify -- <model.glb> [...] | --all [--json] [--masks <folder>]');
  if (all && files.length) throw Error('Choose --all or model files, not both');
  if (contract && files.length !== 1) throw Error('--contract applies to exactly one model file');
  return {files, all, json, contract, masks};
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const {all, json, contract, masks} = options;
  if (masks) mkdirSync(masks, {recursive: true});
  const found = all ? discover() : {contracted: options.files.map(f => resolve(f)), uncontracted: [], orphans: []};
  const results = [];
  for (const file of found.contracted) {
    try {
      results.push({file: show(file), ok: true, report: await verifyFile(file, {contract, masks})});
    } catch (error) {
      results.push({file: show(file), ok: false, error: error.message.split('\n')[0]});
    }
  }
  for (const orphan of found.orphans)
    results.push({file: show(orphan), ok: false, error: 'contract without its .glb next to it'});
  const failed = results.filter(r => !r.ok);
  if (json)
    console.log(JSON.stringify({passed: !failed.length, results, uncontracted: found.uncontracted.map(show)}, null, 2));
  else {
    for (const r of results)
      console.log(
        r.ok
          ? `ok   ${r.file}: ${r.report.triangles} triangles, ${r.report.vertices} vertices, ${r.report.materials} materials, ${r.report.textures} textures, ${r.report.bytes} bytes, size ${fmt(r.report.size)} m, ${r.report.licence}`
          : `FAIL ${r.file}: ${r.error}`,
      );
    for (const f of found.uncontracted) console.log(`skip ${show(f)}: no ${basename(companions(f).contract)}`);
    if (all && !results.length) console.log('asset:verify: no contracted models under any game public/models');
  }
  return failed.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
