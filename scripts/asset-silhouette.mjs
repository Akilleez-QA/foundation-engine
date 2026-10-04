// scripts/asset-silhouette.mjs: the optional silhouette check of a model contract (scripts/asset-verify.mjs).
//
// A contract that sets `silhouette` names a reference image: the shape the creator wants, seen from one side at gameplay
// size. The check renders the re-imported model's silhouette from the same side, without a GPU, by rasterising its
// triangles orthographically, and compares the two masks by overlap (intersection over union, IoU).
//
// Both masks are normalised the same way before comparison, so the reference's own scale and margins do not matter but
// its proportions do: each is cropped to its shape, scaled to fit `pixels` × `pixels` keeping its aspect ratio, centred
// horizontally and set on the bottom edge (the base pivot).
//
// Views (orthographic): front looks along -Z (x right, y up); side looks along -X from +X (-z right, y up); top looks
// down -Y (x right, -z up).
//
// Owner: asset-verify.mjs calls it; it only reads. Bounds: one pixels × pixels canvas (at most 1024 × 1024) and one
// reference image of at most 4096 × 4096 in memory. Reference images: 8-bit PNG, greyscale or RGB (dark shape on a light
// background) or with alpha (opaque shape on transparency); not interlaced, not indexed.
import {readFileSync} from 'node:fs';
import {crc32, deflateSync, inflateSync} from 'node:zlib';
import {Vector3} from 'three';

export const VIEWS = ['front', 'side', 'top'];
/** Default overlap thresholds per stage: a blockout may still differ in detail; a final model must match closely. */
export const STAGE_THRESHOLD = {blockout: 0.85, final: 0.9};
export const MAX_PIXELS = 1024;
const MAX_REFERENCE = 4096;
const CHANNELS = {0: 1, 2: 3, 4: 2, 6: 4};

/** Decode an 8-bit, non-interlaced greyscale, RGB, greyscale-alpha or RGBA PNG. */
export function decodePng(bytes) {
  if (bytes.length < 33 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a)
    throw Error('reference is not a PNG');
  let at = 8,
    header;
  const idat = [];
  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(at),
      type = bytes.toString('latin1', at + 4, at + 8),
      data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR')
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colour: data[9],
        lace: data[12],
      };
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (!header) throw Error('reference PNG has no IHDR');
  const {width, height, depth, colour, lace} = header;
  const channels = CHANNELS[colour];
  if (depth !== 8 || !channels || lace !== 0)
    throw Error('reference PNG must be 8-bit greyscale, RGB or with alpha, not indexed or interlaced');
  if (!width || !height || width > MAX_REFERENCE || height > MAX_REFERENCE)
    throw Error(`reference PNG must be between 1 and ${MAX_REFERENCE} pixels on each side`);
  const raw = inflateSync(Buffer.concat(idat)),
    stride = width * channels,
    data = Buffer.alloc(stride * height);
  if (raw.length < (stride + 1) * height) throw Error('reference PNG data is truncated');
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)],
      row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
      out = data.subarray(y * stride, (y + 1) * stride),
      prior = y ? data.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0,
        b = prior[x],
        c = x >= channels ? prior[x - channels] : 0;
      let p = 0;
      if (filter === 1) p = a;
      else if (filter === 2) p = b;
      else if (filter === 3) p = (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c),
          pb = Math.abs(a - c),
          pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw Error(`reference PNG uses an unknown row filter ${filter}`);
      out[x] = (row[x] + p) & 0xff;
    }
  }
  return {width, height, channels, data};
}

/** A greyscale PNG of a mask: black inside, white outside. */
export function encodeMaskPng({width, height, inside}) {
  const rows = Buffer.alloc((width + 1) * height, 255);
  for (let y = 0; y < height; y++) {
    rows[y * (width + 1)] = 0;
    for (let x = 0; x < width; x++) if (inside[y * width + x]) rows[y * (width + 1) + 1 + x] = 0;
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
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The shape of a decoded reference image: opaque pixels when it has alpha, else dark pixels. */
export function imageMask({width, height, channels, data}) {
  const inside = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const p = data.subarray(i * channels, (i + 1) * channels);
    inside[i] =
      channels === 2 || channels === 4
        ? Number(p[channels - 1] >= 128)
        : Number((channels === 1 ? p[0] : 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) < 128);
  }
  return {width, height, inside};
}

/** Resample a mask's shape into a pixels × pixels canvas: aspect kept, centred, on the bottom edge. */
export function normaliseMask(mask, pixels) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < mask.height; y++)
    for (let x = 0; x < mask.width; x++)
      if (mask.inside[y * mask.width + x]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  const out = new Uint8Array(pixels * pixels);
  if (x1 < 0) return {width: pixels, height: pixels, inside: out};
  const w = x1 - x0 + 1,
    h = y1 - y0 + 1,
    r = pixels / Math.max(w, h),
    left = (pixels - w * r) / 2,
    top = pixels - h * r;
  for (let j = 0; j < pixels; j++)
    for (let i = 0; i < pixels; i++) {
      const x = Math.floor(x0 + (i + 0.5 - left) / r),
        y = Math.floor(y0 + (j + 0.5 - top) / r);
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) out[j * pixels + i] = mask.inside[y * mask.width + x];
    }
  return {width: pixels, height: pixels, inside: out};
}

const project = {
  front: v => [v.x, v.y],
  side: v => [-v.z, v.y],
  top: v => [v.x, -v.z],
};

/** Rasterise a scene's triangles orthographically from a view into a normalised pixels × pixels mask. */
export function renderSilhouette(scene, view, pixels) {
  const triangles = [],
    p = new Vector3();
  scene.updateMatrixWorld(true);
  scene.traverse(o => {
    if (!o.isMesh) return;
    const position = o.geometry.attributes.position,
      index = o.geometry.index,
      count = index ? index.count : position.count,
      point = k =>
        project[view](p.fromBufferAttribute(position, index ? index.getX(k) : k).applyMatrix4(o.matrixWorld));
    for (let k = 0; k + 2 < count; k += 3) triangles.push([point(k), point(k + 1), point(k + 2)]);
  });
  let u0 = Infinity,
    v0 = Infinity,
    u1 = -Infinity,
    v1 = -Infinity;
  for (const t of triangles)
    for (const [u, v] of t) {
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
  const inside = new Uint8Array(pixels * pixels);
  const w = u1 - u0,
    h = v1 - v0;
  if (!(w > 0 || h > 0)) return {width: pixels, height: pixels, inside};
  const s = pixels / Math.max(w, h),
    left = (pixels - w * s) / 2,
    top = pixels - h * s;
  // Pixel space: column i grows with u, row j grows downward from the top of the shape.
  const toPixel = ([u, v]) => [(u - u0) * s + left, (v1 - v) * s + top];
  for (const t of triangles) {
    const [a, b, c] = t.map(toPixel);
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (area === 0) continue;
    const i0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))),
      i1 = Math.min(pixels - 1, Math.ceil(Math.max(a[0], b[0], c[0]))),
      j0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))),
      j1 = Math.min(pixels - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const edge = (p0, p1, x, y) => ((p1[0] - p0[0]) * (y - p0[1]) - (p1[1] - p0[1]) * (x - p0[0])) * Math.sign(area);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = i + 0.5,
          y = j + 0.5;
        if (edge(a, b, x, y) >= 0 && edge(b, c, x, y) >= 0 && edge(c, a, x, y) >= 0) inside[j * pixels + i] = 1;
      }
  }
  return {width: pixels, height: pixels, inside};
}

/** Intersection over union of two same-sized masks; 1 when both are empty. */
export function overlap(a, b) {
  let both = 0,
    either = 0;
  for (let i = 0; i < a.inside.length; i++) {
    both += a.inside[i] & b.inside[i];
    either += a.inside[i] | b.inside[i];
  }
  return either ? both / either : 1;
}

/** Compare a re-imported scene with a reference image. Returns the overlap and both normalised masks. */
export function compareSilhouette(scene, {reference, view, pixels}) {
  const model = renderSilhouette(scene, view, pixels),
    wanted = normaliseMask(imageMask(decodePng(readFileSync(reference))), pixels);
  return {iou: overlap(model, wanted), model, reference: wanted};
}
