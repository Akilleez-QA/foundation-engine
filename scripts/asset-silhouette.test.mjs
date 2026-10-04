// The optional silhouette check: PNG masks, orthographic rasterising, normalisation, overlap and the contract rule.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {BoxGeometry, Mesh, MeshBasicMaterial, Scene} from 'three';
import {
  STAGE_THRESHOLD,
  decodePng,
  encodeMaskPng,
  imageMask,
  normaliseMask,
  overlap,
  renderSilhouette,
} from './asset-silhouette.mjs';
import {ROOT, parseContract, verifyModel} from './asset-verify.mjs';

const SAMPLE = join(ROOT, 'tools/blender-export/game/public/models/metre-block.glb');
/** A mask of a w × h filled rectangle on a canvas with a margin. */
const rectangle = (w, h, margin = 5) => {
  const width = w + 2 * margin,
    height = h + 2 * margin,
    inside = new Uint8Array(width * height);
  for (let y = margin; y < margin + h; y++) for (let x = margin; x < margin + w; x++) inside[y * width + x] = 1;
  return {width, height, inside};
};
const filled = mask => mask.inside.reduce((n, v) => n + v, 0) / mask.inside.length;
const box = (x, y, z) => {
  const scene = new Scene();
  scene.add(new Mesh(new BoxGeometry(x, y, z).translate(0, y / 2, 0), new MeshBasicMaterial()));
  return scene;
};
/** The metre-block contract, relaxed to the parts a silhouette test needs, with a reference image beside it. */
const withReference = (dir, mask, silhouette = {}) =>
  parseContract(
    {
      schema: 1,
      units: 'metres',
      up: '+Y',
      size: {min: [0.9, 0.9, 0.9], max: [1.1, 1.1, 1.1]},
      pivot: {at: 'base-centre'},
      limits: {fileBytes: 65536, triangles: 12, vertices: 24, materials: 2, textures: 0, textureBytes: 0},
      materials: {
        properties: ['doubleSided', 'name', 'pbrMetallicRoughness'],
        pbr: ['baseColorFactor', 'metallicFactor'],
      },
      silhouette: {reference: 'reference.png', view: 'front', ...silhouette},
      provenance: {required: ['licence', 'author', 'source', 'tool', 'generator']},
    },
    {dir: writeReference(dir, mask)},
  );
const writeReference = (dir, mask) => {
  writeFileSync(join(dir, 'reference.png'), encodeMaskPng(mask));
  return dir;
};
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'foundation-silhouette-'));
  return {dir, close: () => rmSync(dir, {recursive: true, force: true})};
};

test('mask PNGs round-trip, and filtered greyscale, RGB and RGBA PNGs decode to the same shape', async () => {
  const mask = rectangle(20, 10);
  assert.deepEqual(imageMask(decodePng(encodeMaskPng(mask))), mask);
  for (const [channels, pixel] of [
    [1, v => [v ? 0 : 255]],
    [3, v => (v ? [20, 30, 40] : [250, 250, 250])],
    [4, v => (v ? [200, 0, 0, 255] : [255, 255, 255, 0])],
  ]) {
    const raw = Buffer.from([...mask.inside].flatMap(pixel));
    const png = await sharp(raw, {raw: {width: mask.width, height: mask.height, channels}})
      .png({adaptiveFiltering: true, compressionLevel: 9})
      .toBuffer();
    assert.deepEqual(imageMask(decodePng(png)).inside, mask.inside, `${channels} channels`);
  }
  assert.throws(() => decodePng(Buffer.from('GIF89a and more bytes to pass the length check')), /not a PNG/);
});

test('normalising keeps proportions and ignores the reference scale and margins', () => {
  const a = normaliseMask(rectangle(40, 20, 3), 64),
    b = normaliseMask(rectangle(400, 200, 50), 64);
  assert.equal(overlap(a, b), 1);
  assert.ok(Math.abs(filled(a) - 0.5) < 0.02, 'a 2:1 shape fills half the square canvas');
  assert.equal(overlap(a, normaliseMask(rectangle(20, 40), 64)) < 0.5, true);
});

test('views project along the documented axes', () => {
  const scene = box(2, 1, 0.5);
  assert.ok(Math.abs(filled(renderSilhouette(scene, 'front', 64)) - 0.5) < 0.03, 'front: 2 wide, 1 high');
  assert.ok(Math.abs(filled(renderSilhouette(scene, 'side', 64)) - 0.5) < 0.03, 'side: 0.5 deep, 1 high');
  assert.ok(Math.abs(filled(renderSilhouette(scene, 'top', 64)) - 0.25) < 0.03, 'top: 2 wide, 0.5 deep');
  const side = renderSilhouette(scene, 'side', 64);
  assert.equal(side.inside[63 * 64 + 32], 1, 'the shape sits on the bottom edge');
  assert.equal(side.inside[0 * 64 + 2], 0, 'and is centred horizontally');
});

test('a model matching its reference passes and reports the overlap; --masks writes both masks', async () => {
  const s = scratch();
  try {
    const report = await verifyModel(SAMPLE, withReference(s.dir, rectangle(50, 50)), {masks: s.dir});
    assert.ok(report.silhouette.iou > 0.99);
    assert.equal(report.silhouette.threshold, STAGE_THRESHOLD.final);
    assert.ok(existsSync(join(s.dir, 'metre-block.front.model.png')));
    assert.ok(existsSync(join(s.dir, 'metre-block.front.reference.png')));
  } finally {
    s.close();
  }
});

test('a model whose proportions differ from the reference is rejected', async () => {
  const s = scratch();
  try {
    await assert.rejects(
      verifyModel(SAMPLE, withReference(s.dir, rectangle(25, 50))),
      /silhouette overlap 0\.5\d\d with reference\.png \(front, 128 px\) is below the final threshold 0\.9/,
    );
  } finally {
    s.close();
  }
});

test('the stage sets the default threshold: 0.85 at blockout, 0.90 when final', async () => {
  const s = scratch();
  try {
    // A reference 15% taller than wide: overlap about 0.87 with the cube.
    const reference = rectangle(100, 115);
    const blockout = await verifyModel(SAMPLE, withReference(s.dir, reference, {stage: 'blockout'}));
    assert.ok(blockout.silhouette.iou > 0.85 && blockout.silhouette.iou < 0.9, String(blockout.silhouette.iou));
    await assert.rejects(verifyModel(SAMPLE, withReference(s.dir, reference)), /below the final threshold 0\.9/);
    await assert.rejects(
      verifyModel(SAMPLE, withReference(s.dir, reference, {stage: 'blockout', threshold: 0.95})),
      /below the blockout threshold 0\.95/,
    );
  } finally {
    s.close();
  }
});

test('a missing reference is rejected, and the silhouette contract keys are checked', async () => {
  const s = scratch();
  try {
    const c = withReference(s.dir, rectangle(10, 10));
    rmSync(join(s.dir, 'reference.png'));
    await assert.rejects(verifyModel(SAMPLE, c), /the silhouette reference reference\.png does not exist/);
    const bad = silhouette => () => withReference(s.dir, rectangle(10, 10), silhouette);
    assert.throws(bad({view: 'back'}), /silhouette.view must be one of front, side, top/);
    assert.throws(bad({pixels: 4}), /silhouette.pixels must be a whole number from 16 to 1024/);
    assert.throws(bad({stage: 'draft'}), /silhouette.stage must be one of blockout, final/);
    assert.throws(bad({threshold: 1.5}), /silhouette.threshold must be a number above 0 and at most 1/);
    assert.throws(bad({reference: 'reference.jpg'}), /silhouette.reference must name a .png/);
    assert.throws(bad({iou: 0.9}), /unknown key "iou"/);
  } finally {
    s.close();
  }
});
