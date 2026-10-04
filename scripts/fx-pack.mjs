#!/usr/bin/env node
// scripts/fx-pack.mjs (`npm run fx:pack -- --out <atlas.png> [options] <frame.png ... | directory>`): packs an image
// sequence into one sprite-sheet atlas for a flipbook particle emitter, plus a JSON sidecar beside it
// (`<atlas>.json`) with the grid (`cols`, `rows`, `count`, `fps`), the frame and atlas sizes, hashes of every input and
// the provenance the creator states.
//
//   npm run fx:pack -- --out game/public/textures/fx/smoke.png --fps 24 --licence CC0-1.0 --author "Me" \
//     --source "Blender render, smoke.blend" --tool blender --generator none renders/smoke/
//
// Options: --fps (default 24; 0 < fps <= 120), --cols (default: the squarest grid that fits), --licence, --author,
// --source, --tool, --generator (provenance; each missing field is written as null and listed as a warning), --json.
// A directory is read as its .png files in natural name order (frame_2 before frame_10); files keep the given order.
//
// Bounds: 1 to 256 frames on a grid of at most 16 × 16 (the emitter's cap), every frame the same size, an atlas of at
// most 4096 × 4096 pixels. Inputs are 8-bit, non-interlaced RGB or RGBA PNGs (the codec in scripts/perf/quality-png.mjs;
// palette, 16-bit and interlaced files are refused: re-export them as RGBA). Frames are placed edge to edge, frame 0 at
// the top left, left to right then down: the order `frames` in defineEmitter reads. No padding: keep each frame's
// border transparent so mipmaps do not bleed between cells. Runs in Node with no network and no image dependency.
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, extname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng, encodePng} from './perf/quality-png.mjs';

export const PACK_LIMITS = Object.freeze({grid: 16, frames: 256, atlasSide: 4096, fps: 120});
export const PROVENANCE_FIELDS = ['licence', 'author', 'source', 'tool', 'generator'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const natural = new Intl.Collator('en', {numeric: true, sensitivity: 'base'});

/** The grid for `count` frames: `cols` given, or the squarest that fits. Throws past the 16 × 16 cap. */
export function chooseGrid(count, cols) {
  if (!Number.isInteger(count) || count < 1 || count > PACK_LIMITS.frames)
    throw Error(`fx:pack: ${count} frames; a sheet holds 1 to ${PACK_LIMITS.frames} (16 × 16): split or drop frames`);
  const c = cols ?? Math.ceil(Math.sqrt(count));
  if (!Number.isInteger(c) || c < 1 || c > PACK_LIMITS.grid)
    throw Error(`fx:pack: --cols must be 1 to ${PACK_LIMITS.grid}`);
  const rows = Math.ceil(count / c);
  if (rows > PACK_LIMITS.grid)
    throw Error(
      `fx:pack: ${count} frames in ${c} columns need ${rows} rows; at most ${PACK_LIMITS.grid} (raise --cols)`,
    );
  return {cols: c, rows};
}

/**
 * Packs decoded RGBA frames ({width, height, data}) into one atlas. Pure: returns the atlas image and the grid.
 */
export function packFrames(frames, {cols} = {}) {
  const grid = chooseGrid(frames.length, cols);
  const first = frames[0],
    {width, height} = first;
  for (const [i, f] of frames.entries())
    if (f.width !== width || f.height !== height)
      throw Error(`fx:pack: frame ${i} is ${f.width}×${f.height}; every frame must be ${width}×${height}`);
  const aw = width * grid.cols,
    ah = height * grid.rows;
  if (aw > PACK_LIMITS.atlasSide || ah > PACK_LIMITS.atlasSide)
    throw Error(
      `fx:pack: the atlas would be ${aw}×${ah}; at most ${PACK_LIMITS.atlasSide} per side: use smaller frames`,
    );
  const data = Buffer.alloc(aw * ah * 4); // unused cells stay transparent
  frames.forEach((f, i) => {
    const x0 = (i % grid.cols) * width,
      y0 = Math.floor(i / grid.cols) * height;
    for (let y = 0; y < height; y++)
      Buffer.from(f.data.buffer, f.data.byteOffset + y * width * 4, width * 4).copy(data, ((y0 + y) * aw + x0) * 4);
  });
  return {atlas: {width: aw, height: ah, data}, ...grid, count: frames.length, frame: {width, height}};
}

/** The input files: each argument a PNG, or a directory of PNGs in natural name order. */
export function listFrames(inputs) {
  const files = [];
  for (const input of inputs) {
    if (statSync(input).isDirectory())
      files.push(
        ...readdirSync(input)
          .filter(name => extname(name).toLowerCase() === '.png')
          .sort(natural.compare)
          .map(name => join(input, name)),
      );
    else files.push(input);
  }
  return files;
}

/** Packs `files` into `out` and writes the sidecar; returns the sidecar object. */
export function pack({files, out, fps = 24, cols, provenance = {}, cwd = process.cwd()}) {
  if (!(typeof fps === 'number' && fps > 0 && fps <= PACK_LIMITS.fps))
    throw Error(`fx:pack: --fps must be in (0, ${PACK_LIMITS.fps}]`);
  if (!out || extname(out).toLowerCase() !== '.png') throw Error('fx:pack: --out must name a .png file');
  if (!files.length) throw Error('fx:pack: no frames given');
  chooseGrid(files.length, cols); // refuse before reading anything
  const sources = [],
    frames = files.map(file => {
      const bytes = readFileSync(file);
      sources.push({file: relative(cwd, resolve(file)), sha256: sha256(bytes)});
      try {
        return decodePng(bytes);
      } catch (error) {
        throw Error(`fx:pack: ${file}: ${error.message}`);
      }
    });
  const packed = packFrames(frames, {cols});
  const png = encodePng(packed.atlas);
  mkdirSync(dirname(resolve(out)), {recursive: true});
  writeFileSync(out, png);
  const receipt = Object.fromEntries(PROVENANCE_FIELDS.map(k => [k, provenance[k]?.trim() || null]));
  const sidecar = {
    format: 'foundation-flipbook/1',
    cols: packed.cols,
    rows: packed.rows,
    count: packed.count,
    fps,
    frame: packed.frame,
    atlas: {
      file: basename(out),
      width: packed.atlas.width,
      height: packed.atlas.height,
      bytes: png.length,
      gpuBytes: packed.atlas.width * packed.atlas.height * 4,
      sha256: sha256(png),
    },
    provenance: receipt,
    sources,
  };
  writeFileSync(out.replace(/\.png$/i, '.json'), `${JSON.stringify(sidecar, null, 2)}\n`);
  return sidecar;
}

function parse(argv) {
  const o = {inputs: [], provenance: {}, json: false};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw Error(`fx:pack: ${a} needs a value`);
      return v;
    };
    if (a === '--out') o.out = value();
    else if (a === '--fps') o.fps = Number(value());
    else if (a === '--cols') o.cols = Number(value());
    else if (a === '--json') o.json = true;
    else if (PROVENANCE_FIELDS.includes(a.slice(2)) && a.startsWith('--')) o.provenance[a.slice(2)] = value();
    else if (a.startsWith('--')) throw Error(`fx:pack: unknown option ${a}`);
    else o.inputs.push(a);
  }
  return o;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const o = parse(process.argv.slice(2));
    if (!o.out || !o.inputs.length)
      throw Error(
        'usage: npm run fx:pack -- --out <atlas.png> [--fps 24] [--cols N] [--licence …] <frames.png… | dir>',
      );
    const sidecar = pack({
      files: listFrames(o.inputs),
      out: o.out,
      fps: o.fps ?? 24,
      cols: o.cols,
      provenance: o.provenance,
    });
    const missing = PROVENANCE_FIELDS.filter(k => sidecar.provenance[k] === null);
    if (o.json) console.log(JSON.stringify(sidecar, null, 2));
    else
      console.log(
        `fx:pack: ${sidecar.count} frames of ${sidecar.frame.width}×${sidecar.frame.height} -> ${o.out} ` +
          `(${sidecar.cols}×${sidecar.rows} grid, ${sidecar.atlas.width}×${sidecar.atlas.height}, ${sidecar.atlas.bytes} bytes, ` +
          `${sidecar.atlas.gpuBytes} bytes on the GPU before mipmaps) and ${o.out.replace(/\.png$/i, '.json')}`,
      );
    if (missing.length)
      console.warn(`fx:pack: warning: no provenance for ${missing.join(', ')} (pass --${missing[0]} …)`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
