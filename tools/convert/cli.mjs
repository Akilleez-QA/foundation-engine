#!/usr/bin/env node
// tools/convert/cli.mjs (`npm run convert -- <kind> <input> <output> [options]`): convert creator-supplied files into
// the formats the engine loads, and write the provenance receipt `npm run check` (lint:provenance) reads.
//
//   npm run convert -- obj   model.obj   game/public/models/model.glb  --author "Sam" --licence CC0-1.0
//   npm run convert -- ply   scan.ply    game/public/models/scan.glb   --author "Sam" --licence CC-BY-4.0 --origin library --source https://…
//   npm run convert -- bvh   walk.bvh    game/public/models/walk.glb   --bone-map map.json --scale 0.01 --author … --licence …
//   npm run convert -- image tiles.pcx   game/public/textures/tiles.png --transparent 0 --author … --licence …
//   npm run convert -- image sprite.raw  out.png --palette game.pal --width 64 --height 64 [--six-bit] --author … --licence …
//   AI origins (--origin agent-blender | ai-generator) also take --model, --human-edits, --prompt or --reference, and
//   for generators --weights-licence and --output-licence, exactly as docs/guides/asset-provenance.md requires.
//
// Owner: the creator's command; this tool reads the input (and the files it names: MTL, textures, palette, bone map)
// and writes the output and its receipt, nothing else. Bounds: --max-bytes (default 256 MiB) per input file, vertex,
// joint, frame and pixel limits in each converter. Failure: a refused input writes nothing; output and receipt are
// written to temporary names and renamed into place. The receipt records what was done, not whether rights are real.
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, renameSync, statSync, writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {basename, dirname, extname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {objToGlb, plyToGlb} from './mesh.mjs';
import {bvhToGlb} from './bvh.mjs';
import {decodeBmp, decodePcx, decodeRaw, imageToPng, readPalette} from './indexed.mjs';
import {recordProblems} from '../../scripts/lib/provenance.ts';

export const VERSION = 1;
const ORIGINS = ['hand', 'library', 'agent-blender', 'ai-generator'];
// Receipt flags are excluded from the recorded generator options.
const RECEIPT = [
  'author',
  'licence',
  'origin',
  'source',
  'model',
  'human-edits',
  'prompt',
  'reference',
  'weights-licence',
  'output-licence',
];
const FLAGS = {
  author: 'text',
  licence: 'text',
  origin: 'text',
  source: 'text',
  model: 'text',
  'human-edits': 'text',
  prompt: 'text',
  reference: 'text',
  'weights-licence': 'text',
  'output-licence': 'text',
  'max-bytes': 'number',
  scale: 'number',
  normals: 'text',
  'bone-map': 'text',
  'root-translation': 'text',
  'keep-end-sites': 'bool',
  clip: 'text',
  palette: 'text',
  'six-bit': 'bool',
  width: 'number',
  height: 'number',
  transparent: 'number',
  rgba: 'bool',
  'no-provenance': 'bool',
  json: 'bool',
};

export function parseArgs(argv) {
  const positional = [],
    flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const name = a.slice(2);
    const type = FLAGS[name];
    if (!type) throw Error(`unknown option --${name}`);
    if (type === 'bool') flags[name] = true;
    else {
      const v = argv[++i];
      if (v === undefined) throw Error(`--${name} needs a value`);
      if (type === 'number') {
        const n = Number(v);
        if (!Number.isFinite(n)) throw Error(`--${name} needs a number`);
        flags[name] = n;
      } else flags[name] = v;
    }
  }
  if (positional.length !== 3) throw Error('usage: convert <obj|ply|bvh|image> <input> <output> [options]');
  return {kind: positional[0], input: positional[1], output: positional[2], flags};
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Run one conversion. Returns {output, receipt, summary}; throws with a message for any refusal. */
export function convert({kind, input, output, flags}, cwd = process.cwd()) {
  const maxBytes = flags['max-bytes'] ?? 256 * 1024 * 1024;
  const read = path => {
    const full = resolve(cwd, path);
    const size = statSync(full).size;
    if (size > maxBytes) throw Error(`${path} is ${size} bytes, above --max-bytes ${maxBytes}`);
    return readFileSync(full);
  };
  if (!flags['no-provenance']) {
    if (!flags.author?.trim() || !flags.licence?.trim())
      throw Error('--author and --licence are required for the provenance receipt (or pass --no-provenance)');
    if (flags.origin && !ORIGINS.includes(flags.origin)) throw Error(`--origin must be one of ${ORIGINS.join(', ')}`);
  }
  const inputBytes = read(input);
  const inputDir = dirname(resolve(cwd, input));
  // Receipts are committed: name inputs relative to the working folder, or by file name alone when outside it, so no
  // machine-specific absolute path is recorded.
  const shown = path => {
    const r = relative(cwd, resolve(cwd, path));
    return r.startsWith('..') || isAbsolute(r) ? basename(path) : r.split(sep).join('/');
  };
  const sources = [{path: shown(input), sha256: sha256(inputBytes)}];
  // Files an OBJ names (MTL, textures) must sit in the input's folder or below it: a downloaded model cannot pull
  // another file of the machine into the output or the receipt.
  const sibling = name => {
    const full = resolve(inputDir, name);
    if (isAbsolute(name) || !(full === inputDir || full.startsWith(inputDir + sep)))
      throw Error(`${name} is outside the input's folder; copy it next to ${basename(input)} to use it`);
    if (!existsSync(full)) return null;
    const bytes = read(relative(cwd, full));
    sources.push({path: shown(full), sha256: sha256(bytes)});
    return bytes;
  };
  const options = {scale: flags.scale ?? 1, normals: flags.normals ?? 'smooth'};
  if (!['smooth', 'none'].includes(options.normals)) throw Error('--normals must be smooth or none');
  let bytes, summary;
  const ext = extname(output).toLowerCase();
  if (kind === 'obj' || kind === 'ply' || kind === 'bvh') {
    if (ext !== '.glb') throw Error(`${kind} converts to .glb`);
    if (kind === 'obj') ({glb: bytes, summary} = objToGlb(inputBytes.toString('utf8'), sibling, options));
    else if (kind === 'ply') ({glb: bytes, summary} = plyToGlb(new Uint8Array(inputBytes), options));
    else {
      let boneMap = null;
      if (flags['bone-map']) {
        const mapBytes = read(flags['bone-map']);
        sources.push({path: shown(flags['bone-map']), sha256: sha256(mapBytes)});
        boneMap = JSON.parse(mapBytes.toString('utf8'));
        if (!boneMap || typeof boneMap !== 'object' || Array.isArray(boneMap))
          throw Error('the bone map must be a JSON object {source: target}');
      }
      ({glb: bytes, summary} = bvhToGlb(inputBytes.toString('utf8'), {
        boneMap,
        scale: options.scale,
        keepEndSites: !!flags['keep-end-sites'],
        rootTranslation: flags['root-translation'] ?? 'all',
        name: flags.clip ?? basename(input, extname(input)),
      }));
    }
  } else if (kind === 'image') {
    if (ext !== '.png') throw Error('image converts to .png');
    const iext = extname(input).toLowerCase();
    let image;
    if (iext === '.pcx') image = decodePcx(new Uint8Array(inputBytes));
    else if (iext === '.bmp') image = decodeBmp(new Uint8Array(inputBytes));
    else {
      if (!flags.palette || flags.width === undefined || flags.height === undefined)
        throw Error('raw index data needs --palette, --width and --height');
      const palBytes = read(flags.palette);
      sources.push({path: shown(flags.palette), sha256: sha256(palBytes)});
      image = decodeRaw(new Uint8Array(inputBytes), {
        width: flags.width,
        height: flags.height,
        palette: readPalette(new Uint8Array(palBytes), {sixBit: !!flags['six-bit']}),
      });
    }
    if (flags.palette && (iext === '.pcx' || iext === '.bmp')) throw Error('--palette applies to raw index data only');
    ({png: bytes, summary} = imageToPng(image, {
      transparent: flags.transparent ?? null,
      output: flags.rgba ? 'rgba' : 'indexed',
    }));
  } else throw Error(`unknown kind ${kind}: obj, ply, bvh or image`);

  const out = resolve(cwd, output);
  const args = Object.entries(flags)
    .filter(([k]) => ![...RECEIPT, 'json', 'no-provenance'].includes(k))
    .map(([k, v]) => (v === true ? `--${k}` : `--${k} ${v}`));
  const receipt = flags['no-provenance']
    ? null
    : {
        origin: flags.origin ?? 'hand',
        author: flags.author,
        licence: flags.licence,
        source: flags.source ?? sources[0].path,
        tool: `foundation tools/convert v${VERSION}`,
        generator: `tools/convert ${kind}${args.length ? ' ' + args.join(' ') : ''}`,
        ...(flags.model ? {model: flags.model} : {}),
        ...(flags['human-edits'] ? {humanEdits: flags['human-edits']} : {}),
        ...(flags.prompt ? {prompt: flags.prompt} : {}),
        ...(flags.reference ? {reference: flags.reference} : {}),
        ...(flags['weights-licence'] ? {weightsLicence: flags['weights-licence']} : {}),
        ...(flags['output-licence'] ? {outputLicence: flags['output-licence']} : {}),
        sourceSha256: sources[0].sha256,
        inputs: sources,
        artifact: basename(out),
        sha256: sha256(bytes),
      };
  // The receipt must pass the same check `npm run check` runs (AI origins need model, prompt or reference, and human
  // edits; generators also need weights and output licences): refuse before writing anything.
  if (receipt) {
    const problems = recordProblems(receipt);
    if (problems.length) throw Error(`the provenance receipt would be incomplete: ${problems.join('; ')}`);
  }
  // Write both files under temporary names, then rename: a failure leaves no half-written output.
  mkdirSync(dirname(out), {recursive: true});
  const receiptPath = join(dirname(out), `${basename(out, extname(out))}.provenance.json`);
  if (receipt && existsSync(receiptPath)) {
    let existing = null;
    try {
      existing = JSON.parse(readFileSync(receiptPath, 'utf8'));
    } catch {
      throw Error(`${receiptPath} exists and is not valid JSON; move it before converting`);
    }
    if (existing.artifact && existing.artifact !== receipt.artifact)
      throw Error(`${receiptPath} belongs to ${existing.artifact}; record this file in assets.provenance.json instead`);
  }
  const tmp = `${out}.tmp-${process.pid}`,
    tmpReceipt = `${receiptPath}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, bytes);
    if (receipt) writeFileSync(tmpReceipt, JSON.stringify(receipt, null, 2) + '\n');
    renameSync(tmp, out);
    if (receipt) renameSync(tmpReceipt, receiptPath);
  } finally {
    rmSync(tmp, {force: true});
    rmSync(tmpReceipt, {force: true});
  }
  return {output: out, receipt: receipt ? receiptPath : null, summary: {...summary, bytes: bytes.length}};
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = convert(args);
    if (args.flags.json) console.log(JSON.stringify(result));
    else {
      console.log(`wrote ${relative(process.cwd(), result.output)} ${JSON.stringify(result.summary)}`);
      if (result.receipt) console.log(`receipt ${relative(process.cwd(), result.receipt)}`);
      else console.log('no provenance receipt written: npm run check will report this file until one exists');
    }
  } catch (error) {
    console.error(`convert: ${error.message}`);
    process.exitCode = 1;
  }
}
