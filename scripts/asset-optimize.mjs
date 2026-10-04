#!/usr/bin/env node
// scripts/asset-optimize.mjs (`npm run asset:optimize -- <in.glb> --out <out.glb>`): the standard optimisation pass.
//
//   1. Before: the input must pass its own model contract (scripts/asset-verify.mjs), so an optimiser never hides a bad
//      export. The output is then held to the contract next to --out (or the input's, or --contract for both). Meshopt
//      quantisation adds a node translation and scale and moves vertices slightly, so an output contract allows
//      EXT_meshopt_compression and KHR_mesh_quantization, allows node transforms, has no pivot node or pinned hash,
//      and states size as a range or with a tolerance (docs/guides/model-contracts.md).
//   2. glTF-Transform (@gltf-transform/cli, MIT) `optimize`, with meshopt geometry compression (the only mesh
//      compression the engine decodes) and the scene structure kept: --join false --flatten false keep named nodes,
//      --instance false --palette false keep meshes and materials as authored, and --simplify false never decimates
//      (make the model at its target polycount instead).
//   3. Textures: WebP by default, resized to the largest size the contract allows. KTX2 (UASTC for normal, occlusion
//      and metal-roughness maps, ETC1S for colour) only with --textures ktx2 and the external `ktx` command
//      (KTX-Software 4.4 or later); without it the pass says so and falls back to WebP. The stock model loader registers
//      no KTX2 transcoder, so asset:verify refuses a required KTX2 texture until the engine does.
//   4. After: the output must pass the output's contract. Only then are the GLB and its receipt written to --out; on
//      any failure nothing at --out changes.
//
// Texture size: --texture-size, else the contract's limits.textureSize, else the --device default (phone 1024, tablet,
// laptop and desktop 2048), else 2048.
//
// Owner: the creator's contract and receipt; this script writes only --out and its receipt. Bounds: one model per run,
// processed in a scratch folder that is removed afterwards. Failure: a one-line message and exit code 1; usage errors
// exit 2.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT, companions, readContract, readGlb, verifyModel} from './asset-verify.mjs';

const PACKAGE = join(ROOT, 'node_modules', '@gltf-transform', 'cli');
export const CLI = join(PACKAGE, 'bin', 'cli.js');
export const CLI_VERSION = existsSync(PACKAGE)
  ? JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8')).version
  : 'not installed';
export const DEVICE_TEXTURE_SIZE = {phone: 1024, tablet: 2048, laptop: 2048, desktop: 2048};
export const KTX_MIN = [4, 4, 0];
const TEXTURES = ['webp', 'ktx2', 'keep'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function parseArgs(argv) {
  const o = {textures: 'webp'};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i],
      value = () => {
        const v = argv[++i];
        if (v === undefined || v.startsWith('--')) throw Error(`${arg} needs a value`);
        return v;
      };
    if (arg === '--out') o.out = value();
    else if (arg === '--contract') o.contract = value();
    else if (arg === '--textures') o.textures = value();
    else if (arg === '--texture-size') o.textureSize = Number(value());
    else if (arg === '--device') o.device = value();
    else if (arg.startsWith('-')) throw Error(`Unknown option: ${arg}`);
    else if (o.input === undefined) o.input = arg;
    else throw Error('One input model per run');
  }
  if (!o.input || !o.out)
    throw Error(
      'Usage: npm run asset:optimize -- <in.glb> --out <out.glb> [--contract <c.json>] [--textures webp|ktx2|keep] [--texture-size N] [--device phone|tablet|laptop|desktop]',
    );
  if (!TEXTURES.includes(o.textures)) throw Error(`--textures must be one of ${TEXTURES.join(', ')}`);
  if (o.textureSize !== undefined && !(Number.isInteger(o.textureSize) && o.textureSize > 0))
    throw Error('--texture-size must be a positive whole number of pixels');
  if (o.device !== undefined && !(o.device in DEVICE_TEXTURE_SIZE))
    throw Error(`--device must be one of ${Object.keys(DEVICE_TEXTURE_SIZE).join(', ')}`);
  if (!/\.glb$/i.test(o.input) || !/\.glb$/i.test(o.out)) throw Error('Input and --out must be .glb files');
  if (resolve(o.input) === resolve(o.out))
    throw Error('--out must differ from the input: keep the export it came from');
  return o;
}

/** The texture size: the flag, else the contract's, else the device default, else 2048. */
export const textureSize = (options, contract) =>
  options.textureSize ??
  (contract.limits.textureSize || undefined) ??
  (options.device ? DEVICE_TEXTURE_SIZE[options.device] : undefined) ??
  2048;

/** The installed `ktx` version as [major, minor, patch], or null when the command is missing or unreadable. */
export function ktxVersion(run = spawnSync) {
  const r = run('ktx', ['--version'], {encoding: 'utf8'});
  if (r.error || r.status !== 0) return null;
  const m = /v?(\d+)\.(\d+)\.(\d+)/.exec(`${r.stdout}${r.stderr}`);
  return m ? m.slice(1, 4).map(Number) : null;
}
const atLeast = (v, min) => {
  for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] > min[i];
  return true;
};

/** The texture format to request, with the reason for any fallback. */
export function textureFormat(requested, hasTextures, version = ktxVersion) {
  if (!hasTextures) return {format: false, note: 'no textures'};
  if (requested === 'keep') return {format: 'auto', note: 'textures re-encoded in their own format'};
  if (requested === 'webp') return {format: 'webp', note: 'WebP'};
  const v = version();
  if (v && atLeast(v, KTX_MIN)) return {format: 'ktx2', note: `KTX2 with ktx ${v.join('.')}`};
  return {
    format: 'webp',
    note: `KTX2 needs the ktx command from KTX-Software ${KTX_MIN.join('.')} or later (https://github.com/KhronosGroup/KTX-Software/releases); ${v ? `found ${v.join('.')}` : 'it is not on PATH'}. Falling back to WebP.`,
  };
}

/** The glTF-Transform optimize arguments for a model. */
export function optimizeArgs(input, output, {format, size}) {
  return [
    'optimize',
    input,
    output,
    '--compress',
    'meshopt',
    '--texture-compress',
    String(format),
    '--texture-size',
    String(size),
    '--join',
    'false',
    '--flatten',
    'false',
    '--instance',
    'false',
    '--palette',
    'false',
    '--simplify',
    'false',
  ];
}

/** Optimise one model. Returns the before and after reports; throws on any failure, leaving --out untouched. */
export async function optimize(options, {log = console.log, version = ktxVersion, root = ROOT} = {}) {
  const input = resolve(options.input),
    out = resolve(options.out);
  // --contract applies to both sides. Otherwise the input keeps its own (often stricter) contract, and the output's
  // contract is the one next to --out, falling back to the input's.
  const beforePath = options.contract ?? companions(input).contract;
  const afterPath = options.contract ?? [companions(out).contract, beforePath].find(p => existsSync(p));
  for (const path of [beforePath, afterPath])
    if (!existsSync(path)) throw Error(`no contract: write ${path} (docs/guides/model-contracts.md)`);
  const contract = readContract(afterPath);
  let before;
  try {
    before = await verifyModel(input, readContract(beforePath), {root});
  } catch (error) {
    throw Error(`before: the input fails its contract: ${error.message.split('\n')[0]}`);
  }
  const {json} = readGlb(readFileSync(input));
  const texture = textureFormat(options.textures, (json.images?.length ?? 0) > 0, version);
  const size = textureSize(options, contract);
  log(`asset:optimize: textures ${texture.note}; texture size ${size} px; meshopt geometry`);
  const scratch = mkdtempSync(join(tmpdir(), 'foundation-asset-optimize-'));
  try {
    const temp = join(scratch, basename(out));
    const args = optimizeArgs(input, temp, {format: texture.format, size});
    const r = spawnSync(process.execPath, [CLI, ...args], {encoding: 'utf8'});
    if (r.status !== 0)
      throw Error(
        `glTF-Transform failed: ${(r.stderr || r.stdout || r.error?.message || '').trim().split('\n').pop()}`,
      );
    const bytes = readFileSync(temp),
      receipt = JSON.parse(readFileSync(companions(input).provenance, 'utf8'));
    const generated = readGlb(bytes).json.asset?.generator;
    const next = {
      ...receipt,
      artifact: basename(out),
      sha256: digest(bytes),
      generator: generated,
      optimizedFrom: {artifact: basename(input), sha256: receipt.sha256, generator: receipt.generator},
      optimizer: `@gltf-transform/cli ${CLI_VERSION} ${args.filter(a => a !== input && a !== temp).join(' ')}`,
    };
    writeFileSync(companions(temp).provenance, JSON.stringify(next, null, 2) + '\n');
    let after;
    try {
      after = await verifyModel(temp, contract, {root});
    } catch (error) {
      throw Error(`after: the optimised model fails its contract: ${error.message.split('\n')[0]}`);
    }
    mkdirSync(dirname(out), {recursive: true});
    copyFileSync(temp, out);
    copyFileSync(companions(temp).provenance, companions(out).provenance);
    return {before, after: {...after, file: out}, contract: afterPath, textures: texture.note, textureSize: size};
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  try {
    const {before, after} = await optimize(options);
    const line = r =>
      `${r.triangles} triangles, ${r.vertices} vertices, ${r.materials} materials, ${r.textures} textures (${r.textureBytes} bytes), ${r.bytes} bytes`;
    console.log(`before ${line(before)}\nafter  ${line(after)}\nok   wrote ${options.out} and its receipt`);
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  }
}
