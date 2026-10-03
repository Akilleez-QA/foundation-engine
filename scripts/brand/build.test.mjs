// Brand checks (docs/brand.md): contrast, palette, the mark's geometry, exact rendering and the committed ASCII art.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {PALETTE, PAGES, contrast, plinth, svg, png, asciiBanner, asciiHeader, HEADERS} from './build.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = f => readFileSync(ROOT + f, 'utf8');

test('contrast: letters read at 4.5:1 on GitHub light and dark and on the night sky', () => {
  assert.ok(contrast(PALETTE.bedrock, PAGES.light) >= 4.5, 'bedrock ink on light');
  assert.ok(contrast(PALETTE.chalk, PAGES.dark) >= 4.5, 'chalk ink on dark');
  for (const c of ['chalk', 'spark']) assert.ok(contrast(PALETTE[c], PALETTE.bedrock) >= 4.5, `${c} text on bedrock`);
});

test('contrast: the mark reads at 3:1 against every background it meets', () => {
  assert.ok(contrast(PALETTE.bedrock, PAGES.light) >= 3, 'the light outline on white');
  for (const c of ['sky', 'signal', 'deep', 'spark', 'ochre', 'chalk']) assert.ok(contrast(PALETTE[c], PAGES.dark) >= 3, `${c} on GitHub dark`);
  for (const c of ['sky', 'signal', 'spark', 'chalk']) assert.ok(contrast(PALETTE[c], PALETTE.bedrock) >= 3, `${c} on the bedrock sky`);
});

test('palette: eight colours, blue-led, none orange or red', () => {
  assert.equal(Object.keys(PALETTE).length, 8);
  for (const [name, hex] of Object.entries(PALETTE)) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, sat = max ? d / max : 0;
    if (d === 0 || sat < 0.5) continue;
    const hue = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    assert.ok(!(hue < 35 || hue > 330), `${name} ${hex} is orange or red (hue ${hue.toFixed(0)})`);
  }
});

test('the Plinth is symmetric and stepped, and not a letter', () => {
  const g = plinth();
  for (const row of g) assert.deepEqual(row.map(Boolean), [...row].reverse().map(Boolean), 'mirror-symmetric silhouette');
  const width = y => g[y].filter(Boolean).length;
  assert.deepEqual([1, 5, 9, 13].map(width), [4, 8, 10, 14], 'capstone 4, brick 8, three bricks (10 + 2 joints), slab 14');
});

test('rendering is pixel-exact: every icon pixel is its grid colour', async () => {
  const g = plinth();
  const {Resvg} = await import('@resvg/resvg-js');
  const img = new Resvg(svg(g, {scale: 1, title: 't', desc: 'd'}), {fitTo: {mode: 'width', value: 32}}).render();
  const p = img.pixels;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const i = (y * 32 + x) * 4, c = g[y >> 1][x >> 1];
    if (!c) { assert.equal(p[i + 3], 0, `transparent at ${x},${y}`); continue; }
    const hex = '#' + [p[i], p[i + 1], p[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    assert.equal(hex, PALETTE[c], `pixel ${x},${y}`);
  }
  await assert.doesNotReject(png(svg(g, {scale: 1, title: 't', desc: 'd'}), 64), 'png() accepts on-palette output');
});

test('ASCII art: plain ASCII, short lines, and the committed copies match the generator', () => {
  const banner = asciiBanner();
  for (const line of banner.split('\n')) {
    assert.ok(line.length <= 70, `banner line over 70 columns: ${line.length}`);
    assert.match(line, /^[\x20-\x7e]*$/);
  }
  assert.ok(read('README.md').includes('```text\n' + banner + '\n```'), 'README.md carries the generated banner');
  assert.ok(read('docs/brand.md').includes(banner), 'docs/brand.md carries the generated banner');
  for (const [file, motto] of Object.entries(HEADERS)) {
    const header = asciiHeader(motto);
    for (const line of header.split('\n')) assert.ok(line.length <= 40, `${file}: header line over 40 columns`);
    assert.ok(read(file).includes('```text\n' + header + '\n```'), `${file} carries the generated header`);
  }
});
