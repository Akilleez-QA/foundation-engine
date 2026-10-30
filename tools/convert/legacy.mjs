// tools/convert/legacy.mjs: the `npm run convert` kinds for legacy game formats (see README "Legacy formats").
// Each returns {bytes, ext, summary, meta}: the output bytes, the extension the output must have, a short summary and
// optional sidecar metadata (frame rectangles, registration points, loop points) written next to the output.
import {readArchive, extractMember} from './archive.mjs';
import {decodeFrameSet, decodePlanarScreen, readVgaPalette} from './sprites.mjs';
import {decodeTim, decodeVag} from './psx.mjs';
import {readMovie, decodeCastBitmap} from './director.mjs';
import {decodeMovieFrame} from './cinepak.mjs';
import {imageToPng, readPalette} from './indexed.mjs';
import {encodeRgba} from './png.mjs';

export const LEGACY_KINDS = ['archive', 'frames', 'planar', 'tim', 'vag', 'director', 'cinepak'];

const png = (image, flags) => {
  if (image.rgba) return encodeRgba(image.width, image.height, image.rgba);
  return imageToPng(image, {transparent: flags.transparent ?? null, output: flags.rgba ? 'rgba' : 'indexed'}).png;
};
const int = (v, name) => {
  if (!Number.isInteger(v) || v < 0) throw Error(`--${name} needs a non-negative integer`);
  return v;
};

/** List the members of a container kind (archive, director). */
export function listLegacy(kind, bytes) {
  if (kind === 'archive') {
    const a = readArchive(bytes);
    return {layout: a.layout, members: a.members.map(({name, size, method}) => ({name, size, method}))};
  }
  if (kind === 'director') {
    const m = readMovie(bytes);
    return {
      members: m.members
        .filter(x => x.kind)
        .map(x => ({
          number: x.number,
          kind: x.kind === 1 ? 'bitmap' : x.kind,
          ...(x.kind === 1 ? {width: x.width, height: x.height, depth: x.depth} : {}),
        })),
    };
  }
  throw Error(`--list applies to archive and director`);
}

/** Convert one legacy input. `readPaletteFile(path)` reads (and records) a palette file. */
export function convertLegacy(kind, bytes, flags, readPaletteFile) {
  switch (kind) {
    case 'archive': {
      if (!flags.member) throw Error('archive needs --member <name> (or --list)');
      const out = extractMember(bytes, readArchive(bytes), flags.member, {maxBytes: flags['max-bytes'] ?? 1 << 28});
      return {bytes: Buffer.from(out), ext: null, summary: {member: flags.member, bytes: out.length}};
    }
    case 'frames': {
      if (!flags.palette) throw Error('frames needs --palette (with --six-bit for a 6-bit VGA palette file)');
      const p = readPaletteFile(flags.palette);
      const palette = flags['six-bit'] ? readVgaPalette(p) : readPalette(p);
      const {image, meta} = decodeFrameSet(bytes, palette);
      return {
        bytes: png(image, flags),
        ext: '.png',
        summary: {width: image.width, height: image.height, frames: meta.frames.length},
        meta,
      };
    }
    case 'planar': {
      const image = decodePlanarScreen(bytes);
      return {bytes: png(image, flags), ext: '.png', summary: {width: 320, height: 200, colours: image.palette.length}};
    }
    case 'tim': {
      const {image, meta} = decodeTim(bytes, {
        clutRow: flags['clut-row'] === undefined ? 0 : int(flags['clut-row'], 'clut-row'),
        opaque: !!flags.opaque,
      });
      return {
        bytes: png(image, flags),
        ext: '.png',
        summary: {width: image.width, height: image.height, mode: meta.mode},
        meta,
      };
    }
    case 'vag': {
      const {wav, meta} = decodeVag(bytes, {rate: flags.rate, prediction: flags.prediction ?? 'rounded'});
      return {bytes: wav, ext: '.wav', summary: {samples: meta.samples, sampleRate: meta.sampleRate}, meta};
    }
    case 'director': {
      if (flags.member === undefined) throw Error('director needs --member <cast number> (or --list)');
      const number = int(Number(flags.member), 'member');
      let palette = null;
      if (flags.palette) {
        const p = readPaletteFile(flags.palette);
        palette = flags['six-bit'] ? readVgaPalette(p) : readPalette(p);
      }
      const {image, meta} = decodeCastBitmap(readMovie(bytes), number, {palette});
      return {
        bytes: png(image, flags),
        ext: '.png',
        summary: {width: image.width, height: image.height, palette: meta.palette},
        meta,
      };
    }
    case 'cinepak': {
      const {image, meta} = decodeMovieFrame(bytes, flags.frame === undefined ? 0 : int(flags.frame, 'frame'));
      return {
        bytes: encodeRgba(image.width, image.height, image.rgba),
        ext: '.png',
        summary: {width: image.width, height: image.height, ...meta},
        meta,
      };
    }
  }
  throw Error(`unknown legacy kind ${kind}`);
}
