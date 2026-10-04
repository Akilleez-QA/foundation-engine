import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {decodePng, encodePng} from './perf/quality-png.mjs';
import {chooseGrid, listFrames, pack, packFrames} from './fx-pack.mjs';

const solid = (w, h, rgba) => {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return {width: w, height: h, data};
};
const COLOURS = [
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [0, 0, 255, 255],
  [255, 255, 0, 255],
  [255, 0, 255, 255],
];

test('fx:pack chooses the squarest grid and refuses more than 16 × 16 frames', () => {
  assert.deepEqual(chooseGrid(1), {cols: 1, rows: 1});
  assert.deepEqual(chooseGrid(4), {cols: 2, rows: 2});
  assert.deepEqual(chooseGrid(5), {cols: 3, rows: 2});
  assert.deepEqual(chooseGrid(256), {cols: 16, rows: 16});
  assert.deepEqual(chooseGrid(13, 13), {cols: 13, rows: 1});
  assert.throws(() => chooseGrid(257), /1 to 256 \(16 × 16\)/);
  assert.throws(() => chooseGrid(40, 2), /need 20 rows; at most 16/);
  assert.throws(() => chooseGrid(4, 17), /--cols must be 1 to 16/);
});

test('fx:pack places frame 0 top left, left to right then down; unused cells stay transparent', () => {
  const {atlas, cols, rows, count} = packFrames(COLOURS.map(c => solid(2, 2, c)));
  assert.deepEqual([cols, rows, count, atlas.width, atlas.height], [3, 2, 5, 6, 4]);
  const at = (x, y) => [...atlas.data.subarray((y * atlas.width + x) * 4, (y * atlas.width + x) * 4 + 4)];
  assert.deepEqual(at(0, 0), COLOURS[0]);
  assert.deepEqual(at(3, 1), COLOURS[1]);
  assert.deepEqual(at(5, 0), COLOURS[2]);
  assert.deepEqual(at(0, 2), COLOURS[3]);
  assert.deepEqual(at(2, 3), COLOURS[4]);
  assert.deepEqual(at(5, 3), [0, 0, 0, 0]);
  assert.throws(() => packFrames([solid(2, 2, COLOURS[0]), solid(3, 2, COLOURS[1])]), /every frame must be 2×2/);
  assert.throws(() => packFrames(Array.from({length: 4}, () => solid(4096, 4, COLOURS[0]))), /at most 4096 per side/);
});

test('fx:pack CLI writes the atlas and a sidecar with grid, fps, hashes and provenance; reads a directory in natural order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fx-pack-'));
  try {
    const frames = join(dir, 'frames');
    mkdirSync(frames);
    // Named so plain string order (1, 10, 2 …) would be wrong.
    const names = ['f1.png', 'f2.png', 'f10.png', 'f11.png'];
    names.forEach((n, i) => writeFileSync(join(frames, n), encodePng(solid(4, 4, COLOURS[i]))));
    assert.deepEqual(
      listFrames([frames]).map(f => f.slice(frames.length + 1)),
      names,
    );
    const out = join(dir, 'out', 'sheet.png');
    const stdout = execFileSync(
      process.execPath,
      ['scripts/fx-pack.mjs', '--out', out, '--fps', '12', '--licence', 'CC0-1.0', '--author', 'Test', frames],
      {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']},
    );
    assert.match(stdout, /4 frames of 4×4 .* \(2×2 grid, 8×8/);
    const sidecar = JSON.parse(readFileSync(join(dir, 'out', 'sheet.json'), 'utf8'));
    assert.equal(sidecar.format, 'foundation-flipbook/1');
    assert.deepEqual([sidecar.cols, sidecar.rows, sidecar.count, sidecar.fps], [2, 2, 4, 12]);
    assert.deepEqual(sidecar.frame, {width: 4, height: 4});
    assert.equal(sidecar.atlas.file, 'sheet.png');
    assert.equal(sidecar.atlas.gpuBytes, 8 * 8 * 4);
    assert.equal(sidecar.atlas.bytes, readFileSync(out).length);
    assert.equal(sidecar.provenance.licence, 'CC0-1.0');
    assert.equal(sidecar.provenance.tool, null);
    assert.equal(sidecar.sources.length, 4);
    assert.match(sidecar.sources[0].sha256, /^[0-9a-f]{64}$/);
    const atlas = decodePng(readFileSync(out));
    assert.deepEqual([...atlas.data.subarray((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 4)], COLOURS[3], 'f11 bottom right');
    assert.throws(() => pack({files: [join(frames, 'f1.png')], out: join(dir, 'x.webp')}), /--out must name a \.png/);
    assert.throws(() => pack({files: [join(frames, 'f1.png')], out, fps: 0}), /--fps must be in \(0, 120\]/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
