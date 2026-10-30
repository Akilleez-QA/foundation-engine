#!/usr/bin/env node
// scripts/brand/lookalike.mjs: a lookalike SANITY CHECK for brand marks (docs/brand.md). Not a trademark search.
//
// Each candidate SVG is rendered, thresholded to a black-on-white silhouette (and also rotated 90 degrees) and
// reduced to a 64-bit difference hash. That hash is compared with every mark in Simple Icons (CC0 SVG data). The
// nearest five are printed with their Hamming distances out of 64; a nearest mark at 10 or less is flagged for a
// person to look at. A silhouette hash ignores colour and pattern, and the corpus is not a trademark register: a
// clean result does not clear a mark. Follow up with a reverse image search and the WIPO Global Brand Database.
//
// Its tools are deliberately not in package.json. Install them once outside the repository and point at them:
//   npm i --prefix /tmp/lookalike sharp@0.35.5 simple-icons@16.33.0
//   LOOKALIKE_DEPS=/tmp/lookalike node scripts/brand/lookalike.mjs [candidate.svg ...]
// Without arguments it checks assets/brand/logo-mark.svg and assets/brand/icon.svg. Corpus hashes are cached in
// the deps folder, so later runs take seconds.
import {createRequire} from 'node:module';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEPS = process.env.LOOKALIKE_DEPS;
if (!DEPS) {
  console.error('Set LOOKALIKE_DEPS to a folder with sharp and simple-icons installed (see the header of this file).');
  process.exit(2);
}
const fromDeps = createRequire(join(DEPS, 'package.json'));
const sharp = fromDeps('sharp'),
  icons = fromDeps('simple-icons');
const siVersion = JSON.parse(readFileSync(join(DEPS, 'node_modules/simple-icons/package.json'), 'utf8')).version;
const {Resvg} = createRequire(import.meta.url)('@resvg/resvg-js');

const N = 9;
async function dhash(png) {
  const p = await sharp(png)
    .flatten({background: '#fff'})
    .grayscale()
    .resize(N, N - 1, {fit: 'contain', background: '#fff'})
    .raw()
    .toBuffer();
  let s = '';
  for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++) s += p[y * N + x] < p[y * N + x + 1] ? '1' : '0';
  return s;
}
const hamming = (a, b) => [...a].reduce((n, c, i) => n + (c !== b[i]), 0);

const cache = join(DEPS, `simple-icons-${siVersion}-dhash.json`);
let corpus;
if (existsSync(cache)) corpus = JSON.parse(readFileSync(cache, 'utf8'));
else {
  corpus = [];
  for (const icon of Object.values(icons))
    if (icon?.svg)
      corpus.push([icon.title, await dhash(new Resvg(icon.svg, {fitTo: {mode: 'width', value: 64}}).render().asPng())]);
  writeFileSync(cache, JSON.stringify(corpus));
}

async function silhouette(file, rotate) {
  const png = new Resvg(readFileSync(file, 'utf8'), {fitTo: {mode: 'width', value: 64}, background: '#ffffff'})
    .render()
    .asPng();
  let img = sharp(png).flatten({background: '#fff'}).grayscale().threshold(250);
  if (rotate) img = img.rotate(rotate, {background: '#fff'});
  return img.png().toBuffer();
}

const files = process.argv.slice(2);
const candidates = files.length
  ? files
  : ['assets/brand/logo-mark.svg', 'assets/brand/icon.svg'].map(f => join(ROOT, f));
console.log(`Lookalike sanity check (not a trademark search), ${new Date().toISOString().slice(0, 10)}`);
console.log(
  `dHash 64 bits of a thresholded silhouette vs Simple Icons ${siVersion} (${corpus.length} marks); flag at 10 or less.`,
);
for (const file of candidates)
  for (const rotate of [0, 90]) {
    const h = await dhash(await silhouette(file, rotate));
    const rows = corpus.map(([title, ch]) => [hamming(h, ch), title]).sort((a, b) => a[0] - b[0]);
    const name = file.replace(ROOT, '') + (rotate ? ' (rotated 90)' : '');
    console.log(
      `${name}: ${rows
        .slice(0, 5)
        .map(([d, t]) => `${t} ${d}`)
        .join(', ')}${rows[0][0] <= 10 ? '  FLAG: review by eye' : ''}`,
    );
  }
