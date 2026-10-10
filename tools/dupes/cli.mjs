#!/usr/bin/env node
// tools/dupes/cli.mjs (`npm run dupes -- [paths…] [options]`): report duplicate and near-duplicate files.
//
//   npm run dupes                                   the active game's public/ folder (its shipped assets)
//   npm run dupes -- --game templates/mechanics/game
//   npm run dupes -- src tools                      any folders or files
//   npm run dupes -- game/public --against ../other-project/assets   only matches that cross the two trees
//   options: --json, --no-near, --fail-on exact|near, --image-distance <0..15>, --text-similarity <0..1>,
//            --max-files <n>, --max-bytes <n>, --min-bytes <n>
//
// Owner: the caller; the scan only reads (tools/dupes/scan.mjs). Exit status: 0 report written, 1 --fail-on found a
// match, 2 wrong arguments, 3 the scan itself failed (for example more files than --max-files). A report lists
// candidates for a person to judge: identical bytes may be deliberate (a shared licence file), and a near match is
// an estimate.
import {existsSync} from 'node:fs';
import {basename, isAbsolute, join, relative, resolve} from 'node:path';
import {DEFAULTS, scan} from './scan.mjs';

class UsageError extends Error {}

export function parse(argv) {
  const o = {paths: [], against: null, json: false, near: true, failOn: null, game: null, options: {}};
  const num = (name, v, lo, hi) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new UsageError(`--${name} needs a number in [${lo}, ${hi}]`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${a} needs a value`);
      return v;
    };
    if (a === '--json') o.json = true;
    else if (a === '--no-near') o.near = false;
    else if (a === '--against') o.against = value();
    else if (a === '--game') o.game = value();
    else if (a === '--fail-on') {
      o.failOn = value();
      if (!['exact', 'near'].includes(o.failOn)) throw new UsageError('--fail-on must be exact or near');
    } else if (a === '--image-distance') o.options.imageDistance = num('image-distance', value(), 0, 15);
    else if (a === '--text-similarity') o.options.textSimilarity = num('text-similarity', value(), 0, 1);
    else if (a === '--max-files') o.options.maxFiles = num('max-files', value(), 1, 10_000_000);
    else if (a === '--max-bytes') o.options.maxBytes = num('max-bytes', value(), 1, 2 ** 40);
    else if (a === '--min-bytes') o.options.minBytes = num('min-bytes', value(), 0, 2 ** 40);
    else if (a.startsWith('--')) throw new UsageError(`unknown option ${a}`);
    else o.paths.push(a);
  }
  if (o.failOn === 'near' && !o.near) throw new UsageError('--fail-on near needs the near comparison (drop --no-near)');
  if (o.game && o.paths.length) throw new UsageError('--game selects the folder to scan; give either --game or paths');
  return o;
}

const kb = n =>
  n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / (1 << 20)).toFixed(1)} MiB`;

export async function run(argv, cwd = process.cwd()) {
  const o = parse(argv);
  let paths = o.paths;
  if (paths.length === 0) {
    const {gameDir, ROOT} = await import('../../scripts/lib/game-dir.mjs');
    // --game is relative to the working folder, or to the repository root when that is where it exists.
    let game = gameDir();
    if (o.game)
      game = isAbsolute(o.game) || existsSync(resolve(cwd, o.game)) ? resolve(cwd, o.game) : resolve(ROOT, o.game);
    if (o.game && !existsSync(game)) throw new UsageError(`--game ${o.game} does not exist`);
    paths = [join(game, 'public')];
    if (!existsSync(paths[0]))
      return {report: null, text: `no public/ folder in ${relative(cwd, game) || '.'}: nothing to scan`, status: 0};
  }
  for (const p of [...paths, ...(o.against ? [o.against] : [])])
    if (!existsSync(resolve(cwd, p))) throw new UsageError(`${p} does not exist`);
  let roots;
  if (o.against) {
    if (paths.length !== 1) throw new UsageError('--against compares exactly one path with one other');
    roots = [
      {root: resolve(cwd, paths[0]), label: 'a'},
      {root: resolve(cwd, o.against), label: 'b'},
    ];
  } else roots = paths.map((p, i) => ({root: resolve(cwd, p), label: i < 26 ? String.fromCharCode(97 + i) : `p${i}`}));
  // With several paths and no --against, matches inside and across all of them count.
  const report = scan(roots, {...o.options, near: o.near, crossOnly: !!o.against});
  const legend = Object.fromEntries(roots.map(r => [r.label, relative(cwd, r.root) || '.']));
  report.roots = legend;
  const near = report.geometry.length + report.image.length + report.text.length;
  const status =
    (o.failOn === 'exact' && report.exact.length) || (o.failOn === 'near' && (report.exact.length || near)) ? 1 : 0;
  if (o.json) return {report, text: JSON.stringify(report, null, 2), status};
  const lines = [];
  const show = id => {
    const at = id.indexOf(':');
    const label = id.slice(0, at),
      rel = id.slice(at + 1);
    return rel ? `${legend[label]}/${rel}` : legend[label] || basename(roots.find(r => r.label === label).root);
  };
  lines.push(
    `scanned ${report.files} files (${kb(report.bytes)}) in ${Object.values(legend).join(', ')}${o.against ? ' (matches across the two only)' : ''}`,
  );
  const wasted = report.exact.reduce((n, g) => n + g.wasted, 0);
  lines.push(`exact duplicates: ${report.exact.length} group(s), ${kb(wasted)} repeated`);
  for (const g of report.exact)
    lines.push(`  ${kb(g.bytes)} blob ${g.blob.slice(0, 12)}: ${g.members.map(show).join(', ')}`);
  if (o.near) {
    lines.push(`same mesh data (GLB): ${report.geometry.length} group(s)`);
    for (const g of report.geometry) lines.push(`  ${g.members.map(show).join(', ')}`);
    lines.push(
      `similar images (PNG, linked within ${o.options.imageDistance ?? DEFAULTS.imageDistance}/128 bits): ${report.image.length} group(s)`,
    );
    for (const g of report.image)
      lines.push(
        `  ${g.maxDistance === null ? 'large group' : `farthest pair ${g.maxDistance}/128`}: ${g.members.map(show).join(', ')}`,
      );
    lines.push(
      `similar text (linked at ≥ ${o.options.textSimilarity ?? DEFAULTS.textSimilarity} estimated): ${report.text.length} group(s)`,
    );
    for (const g of report.text)
      lines.push(
        `  ${g.minSimilarity === null ? 'large group' : `least similar pair ${g.minSimilarity}`}: ${g.members.map(show).join(', ')}`,
      );
  }
  if (report.skipped.length)
    lines.push(`skipped or partly compared: ${report.skipped.length} (use --json for reasons)`);
  return {report, text: lines.join('\n'), status};
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    const {text, status} = await run(process.argv.slice(2));
    console.log(text);
    process.exitCode = status;
  } catch (error) {
    console.error(`dupes: ${error.message}`);
    process.exitCode = error instanceof UsageError ? 2 : 3;
  }
}
