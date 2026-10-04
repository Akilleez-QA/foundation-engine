import assert from 'node:assert/strict';
import {copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, test} from 'node:test';
import {parseGlb, readAccessor, validate} from './validate.mjs';

const at = path => new URL(path, import.meta.url).pathname;
const MODEL = at('./game/public/models/pose-robot.glb');
const DEFINITION = at('./examples/robot/animations.json');
const scratch = mkdtempSync(join(tmpdir(), 'pose-to-pose-validate-'));
after(() => rmSync(scratch, {recursive: true, force: true}));

/** A copy of the example with its manifest; `edit` may change the glTF JSON, binary chunk or manifest. */
function variant(name, edit) {
  const dir = mkdtempSync(join(scratch, name + '-'));
  const file = join(dir, 'pose-robot.glb');
  const bytes = readFileSync(MODEL);
  const gltf = parseGlb(bytes);
  const manifest = JSON.parse(readFileSync(MODEL.replace(/\.glb$/, '.clips.json'), 'utf8'));
  const bin = Buffer.from(gltf.bin);
  edit?.({json: gltf.json, bin, manifest, gltf: {json: gltf.json, bin}});
  const json = Buffer.from(JSON.stringify(gltf.json));
  const jsonChunk = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const binChunk = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const chunk = (type, data) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  writeFileSync(file, Buffer.concat([header, chunk(0x4e4f534a, jsonChunk), chunk(0x004e4942, binChunk)]));
  writeFileSync(file.replace(/\.glb$/, '.clips.json'), JSON.stringify(manifest));
  return file;
}
const definition = () => JSON.parse(readFileSync(DEFINITION, 'utf8'));
/** Byte offset of element `i` of an accessor inside the binary chunk. */
function elementOffset(json, accessor, i) {
  const acc = json.accessors[accessor],
    view = json.bufferViews[acc.bufferView];
  const size = {SCALAR: 1, VEC3: 3, VEC4: 4}[acc.type] * 4;
  return (view.byteOffset ?? 0) + (acc.byteOffset ?? 0) + i * (view.byteStride ?? size);
}

test('the checked-in robot passes every check, its review gate recorded as off', async () => {
  const report = await validate(MODEL, DEFINITION, {allowUnreviewed: true});
  assert.deepEqual(report.failures, []);
  assert.equal(report.review, 'off');
  assert.equal(report.bones, 24);
  assert.deepEqual(Object.keys(report.clips).sort(), ['walk', 'walk_turn_left', 'walk_turn_right', 'wave']);
  assert.equal(report.clips.walk.measuredDuration, 1.066667);
  assert.equal(report.clips.wave.playback, 'hold');
  for (const foot of report.clips.walk.feet) assert.ok(foot.maxSlide <= 0.04 && foot.plantedFrames >= 8);
});

test('an unreviewed export fails unless the caller accepts it explicitly', async () => {
  const report = await validate(MODEL, DEFINITION);
  assert.equal(report.passed, false);
  assert.match(report.failures.join('\n'), /--no-review/);
});

test('a missing or renamed clip is reported by name', async () => {
  const file = variant('renamed', ({json}) => (json.animations.find(a => a.name === 'wave').name = 'Wave'));
  const report = await validate(file, DEFINITION, {provenance: false});
  assert.match(report.failures.join('\n'), /declared clip wave is missing/);
  assert.match(report.failures.join('\n'), /clip Wave is not declared/);
});

test('NaN keys, a broken loop seam and a wrong duration are each caught', async () => {
  const file = variant('broken', ({json, bin}) => {
    const walk = json.animations.find(a => a.name === 'walk');
    const rotation = walk.channels.find(
      c => c.target.path === 'rotation' && json.nodes[c.target.node].name === 'thigh.L',
    );
    const out = walk.samplers[rotation.sampler].output;
    bin.writeFloatLE(0.5, elementOffset(json, out, json.accessors[out].count - 1)); // last key != first
    const wave = json.animations.find(a => a.name === 'wave');
    bin.writeFloatLE(NaN, elementOffset(json, wave.samplers[0].output, 3));
    const times = json.animations.find(a => a.name === 'walk_turn_left').samplers[0].input;
    bin.writeFloatLE(2, elementOffset(json, times, json.accessors[times].count - 1));
  });
  const failures = (await validate(file, DEFINITION, {provenance: false})).failures.join('\n');
  assert.match(failures, /walk: loop clip has 1 channels whose first and last keys differ/);
  assert.match(failures, /wave: 1 NaN/);
  assert.match(failures, /walk_turn_left: duration 2\.0000 s, definition says 1\.0667 s/);
});

test('more than four influences, or too many bones, fail', async () => {
  const file = variant('influences', ({json}) => {
    const prim = json.meshes[0].primitives[0];
    prim.attributes.JOINTS_1 = prim.attributes.JOINTS_0;
    prim.attributes.WEIGHTS_1 = prim.attributes.WEIGHTS_0;
  });
  const def = definition();
  def.skeleton.maxBones = 20;
  const failures = (await validate(file, def, {provenance: false})).failures.join('\n');
  assert.match(failures, /more than four influences/);
  assert.match(failures, /24 bones exceed the declared limit of 20/);
});

test('a stride that the feet do not match is foot sliding', async () => {
  const file = variant('stride', ({manifest}) => {
    const walk = manifest.clips.find(c => c.name === 'walk');
    walk.rootMotion.stride = 1.3;
    walk.rootMotion.clip.keys.at(-1).z = 1.3;
  });
  const def = definition();
  def.clips.walk.rootMotion.stride = 1.3;
  const failures = (await validate(file, def, {provenance: false})).failures.join('\n');
  assert.match(
    failures,
    /walk: foot\.L slides 0\.\d+ m while planted \(tolerance 0\.04 m at stride 1\.3 m per cycle\)/,
  );
});

test('a required moving part that does not move fails the clip brief', async () => {
  const def = definition();
  def.clips.wave.controls.push('thigh.L');
  const failures = (await validate(MODEL, def, {allowUnreviewed: true})).failures.join('\n');
  assert.match(failures, /wave: control bone thigh\.L does not move/);
});

test('a definition edited after export is stale', async () => {
  const dir = mkdtempSync(join(scratch, 'stale-'));
  for (const ext of ['.glb', '.clips.json', '.provenance.json'])
    copyFileSync(MODEL.replace(/\.glb$/, ext), join(dir, 'pose-robot' + ext));
  const def = join(dir, 'animations.json');
  writeFileSync(def, readFileSync(DEFINITION, 'utf8').replace('"seconds": 0.6', '"seconds": 0.6 '));
  const failures = (await validate(join(dir, 'pose-robot.glb'), def, {allowUnreviewed: true})).failures;
  assert.deepEqual(failures, ['animations.json changed after this GLB was exported: regenerate']);
});

test('weights decode as normalised four-influence rows', () => {
  const gltf = parseGlb(readFileSync(MODEL));
  const weights = readAccessor(gltf, gltf.json.meshes[0].primitives[0].attributes.WEIGHTS_0);
  assert.ok(weights.every(w => w.length === 4 && Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 2e-3));
});

test('a bone that shares its name with another node is ambiguous for name lookups', async () => {
  const file = variant('duplicate', ({json}) => (json.nodes.find(n => n.mesh !== undefined).name = 'hand.R'));
  const failures = (await validate(file, DEFINITION, {provenance: false})).failures.join('\n');
  assert.match(failures, /node name hand\.R is used by 2 nodes; bones need unique names/);
});

test('the manifest root motion is a valid @kits/animation RootClip that travels one stride per cycle', async () => {
  const {createRootMotion} = await import('../../src/kits/animation/root-motion.ts');
  const manifest = JSON.parse(readFileSync(MODEL.replace(/\.glb$/, '.clips.json'), 'utf8'));
  for (const clip of manifest.clips.filter(c => c.rootMotion)) {
    const motion = createRootMotion(clip.rootMotion.clip, true);
    let distance = 0;
    for (let i = 1; i <= 64; i++) {
      const d = motion.advance((i * clip.duration) / 32);
      distance += Math.hypot(d.x, d.z);
    }
    assert.ok(Math.abs(distance - 2 * clip.rootMotion.stride) < 1e-3, `${clip.name} travels ${distance} in two cycles`);
  }
});
