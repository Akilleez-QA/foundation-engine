#!/usr/bin/env node
// scripts/brand/build.mjs: the Foundation Engine brand, generated from pixel grids (docs/brand.md).
//
// Every mark and letter is a hand-drawn pixel grid in this file; no font or third-party image is used. Grids become
// SVG paths (one per colour, same-colour runs merged into rectangles, shape-rendering="crispEdges"), and PNGs are
// rendered from those SVGs by resvg at whole-number scales, then checked to contain only palette colours.
//   node scripts/brand/build.mjs           writes assets/brand/ (SVG and PNG)
//   node scripts/brand/build.mjs --ascii   prints the README banner and the docs header
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const OUT = fileURLToPath(new URL('../../assets/brand/', import.meta.url));

/** The brand palette: eight colours, blue-led (docs/brand.md). */
export const PALETTE = {
  bedrock: '#141A33', // night sky, ink and outlines
  mortar: '#2B3566', // joints, dusk, floor bricks
  deep: '#1B6AA5', // brick shadow
  signal: '#2FA8E0', // lead: brick face, the FOUNDATION shadow
  sky: '#9BDDFA', // brick light
  spark: '#FFC93C', // capstone, the ENGINE shadow, accent text
  ochre: '#D9971F', // capstone shadow
  chalk: '#F6F1E7', // text on dark, capstone light
};

/** GitHub's page backgrounds, which the README art must read against. */
export const PAGES = {light: '#ffffff', dark: '#0d1117'};

/** WCAG 2 contrast ratio of two hex colours. */
export function contrast(a, b) {
  const lum = hex => {
    const [r, g, bl] = [1, 3, 5]
      .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ---- Grids ---------------------------------------------------------------------------------------------------------

const grid = (w, h) => Array.from({length: h}, () => Array(w).fill(null));

/** Empty cells touching a filled cell (8-neighbourhood) become 'line', so joints read as mortar. */
function outline(g) {
  const H = g.length,
    W = g[0].length,
    lit = (x, y) => x >= 0 && y >= 0 && x < W && y < H && g[y][x] && g[y][x] !== 'line';
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (g[y][x]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (lit(x + dx, y + dy)) g[y][x] = 'line';
    }
  return g;
}

/**
 * The Plinth, 16 x 16 and symmetric: a gold capstone (4 wide), one brick (8), three bricks (3/4/3, joints at 5 and
 * 10) and the slab (14). Each block has a light top row and a shaded bottom row and right column.
 */
export function plinth() {
  const g = grid(16, 16);
  const block = (xa, ya, xb, yb, [hi, face, lo]) => {
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++) g[y][x] = y === ya ? hi : y === yb || x === xb ? lo : face;
  };
  const BLUE = ['sky', 'signal', 'deep'],
    GOLD = ['chalk', 'spark', 'ochre'];
  block(6, 1, 9, 3, GOLD);
  block(4, 5, 11, 7, BLUE);
  block(2, 9, 4, 11, BLUE);
  block(6, 9, 9, 11, BLUE);
  block(11, 9, 13, 11, BLUE);
  for (let x = 1; x <= 14; x++) {
    g[13][x] = 'sky';
    g[14][x] = 'deep';
  }
  return g;
}
const outlined = () => outline(plinth());

/** The display letters: 2-pixel stems, 1-pixel bars, 7 high. */
export const DISPLAY = {
  F: ['######', '##....', '##....', '#####.', '##....', '##....', '##....'],
  O: ['.####.', '##..##', '##..##', '##..##', '##..##', '##..##', '.####.'],
  U: ['##..##', '##..##', '##..##', '##..##', '##..##', '##..##', '.####.'],
  N: ['##..##', '###.##', '######', '##.###', '##..##', '##..##', '##..##'],
  D: ['#####.', '##..##', '##..##', '##..##', '##..##', '##..##', '#####.'],
  A: ['.####.', '##..##', '##..##', '######', '##..##', '##..##', '##..##'],
  T: ['######', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..'],
  I: ['####', '.##.', '.##.', '.##.', '.##.', '.##.', '####'],
  E: ['######', '##....', '##....', '#####.', '##....', '##....', '######'],
  G: ['.#####', '##....', '##....', '##.###', '##..##', '##..##', '.#####'],
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
};

/** The small letters: 1-pixel strokes, 5 x 7, for taglines. */
export const SMALL = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  '-': ['...', '...', '...', '###', '...', '...', '...'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '*': ['..', '..', '..', '##', '##', '..', '..'],
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
};

/** A line of text as lit cells [{x, y}] and its width. */
export function text(str, font, gap = 1) {
  const cells = [];
  let x = 0;
  for (const ch of str) {
    const glyph = font[ch];
    if (!glyph) throw new Error(`no glyph for ${JSON.stringify(ch)}`);
    glyph.forEach((row, y) =>
      [...row].forEach((c, dx) => {
        if (c === '#') cells.push({x: x + dx, y});
      }),
    );
    x += glyph[0].length + gap;
  }
  return {cells, width: x - gap};
}

/** Copy grid `src` into `dst` at (ox, oy), each cell drawn s x s. */
function stamp(dst, src, ox, oy, s = 1) {
  src.forEach((row, y) =>
    row.forEach((c, x) => {
      if (!c) return;
      for (let dy = 0; dy < s; dy++)
        for (let dx = 0; dx < s; dx++) {
          const yy = oy + y * s + dy,
            xx = ox + x * s + dx;
          if (yy >= 0 && yy < dst.length && xx >= 0 && xx < dst[0].length) dst[yy][xx] = c;
        }
    }),
  );
}

/** FOUNDATION over ENGINE in the display letters: ink, a Signal shadow under FOUNDATION and a Spark one under ENGINE. */
function words(ink) {
  const a = text('FOUNDATION', DISPLAY, 2),
    b = text('ENGINE', DISPLAY, 2),
    g = grid(a.width + 1, 17);
  for (const {x, y} of a.cells) g[y + 1][x + 1] = 'signal';
  for (const {x, y} of a.cells) g[y][x] = ink;
  for (const {x, y} of b.cells) g[y + 10][x + 1] = 'spark';
  for (const {x, y} of b.cells) g[y + 9][x] = ink;
  return g;
}

const INK = {light: 'bedrock', dark: 'chalk'};

/** The lockup: the mark beside FOUNDATION over ENGINE (two 7-high lines 2 apart match the mark's height). */
function lockupGrid(theme) {
  const w = words(INK[theme]),
    g = grid(19 + w[0].length, 17);
  stamp(g, outlined(), 0, 0);
  stamp(g, w, 19, 0);
  return g;
}

/** The icon: the Plinth on a bedrock tile with clipped corners, drawn natively at 16 x 16. */
function iconGrid() {
  const g = plinth();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (!g[y][x]) g[y][x] = 'bedrock';
  for (const [x, y] of [
    [0, 0],
    [15, 0],
    [0, 15],
    [15, 15],
  ])
    g[y][x] = null;
  return g;
}

/** A seeded generator, so the star field is the same on every build. */
function rng(seed) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

/** The 1280 x 640 social preview on a 4-px grid (320 x 160 cells): night sky, dusk, the Plinth on a brick floor. */
function socialGrid() {
  const W = 320,
    H = 160,
    FLOOR = 136,
    g = grid(W, H);
  const BAYER = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];
  for (let y = 0; y < FLOOR; y++)
    for (let x = 0; x < W; x++) {
      const t = Math.max(0, (y - 121) / (FLOOR - 121)); // dusk: an ordered dither towards the horizon
      g[y][x] = t * 16 > BAYER[y % 4][x % 4] + 0.5 ? 'mortar' : 'bedrock';
    }
  const MS = 5,
    MX = 30,
    MY = FLOOR - 15 * MS; // the mark, 5 cells per pixel, its slab on the floor
  const WX = 120,
    WY = 34; // the words, 2 cells per pixel
  const lines = [
    ['TYPESCRIPT + THREE.JS ENGINE', 'chalk', 82],
    ['FOR BROWSER GAMES OF ANY GENRE', 'chalk', 94],
    ['GPL-3.0  *  OPEN SOURCE', 'spark', 111],
  ];
  const w = words('chalk');
  const keepOut = [
    [MX - 6, MY - 10, MX + 16 * MS + 6, FLOOR],
    [WX - 6, WY - 6, WX + w[0].length * 2 + 6, WY + 40],
    [WX - 6, 76, 312, 122],
  ];
  const r = rng(7);
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(r() * W),
      y = Math.floor(r() * 84) + 2,
      kind = r();
    if (keepOut.some(([a, b, c, d]) => x >= a - 3 && x <= c + 3 && y >= b - 3 && y <= d + 3)) continue;
    if (kind < 0.12) {
      g[y][x] = 'chalk';
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        if (g[y + dy]?.[x + dx]) g[y + dy][x + dx] = 'deep';
    } else g[y][x] = kind < 0.5 ? 'chalk' : kind < 0.8 ? 'sky' : 'deep';
  }
  stamp(g, plinth(), MX, MY, MS);
  const sx = MX + 10 * MS + 2,
    sy = MY + MS - 3; // a glint on the capstone
  g[sy][sx] = 'chalk';
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ])
    g[sy + dy][sx + dx] = 'spark';
  for (const [dx, dy] of [
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
  ])
    g[sy + dy][sx + dx] = 'ochre';
  for (let x = 0; x < W; x++) g[FLOOR][x] = 'signal';
  for (let y = FLOOR + 1; y < H; y++) {
    const row = (y - FLOOR - 1) % 6,
      course = Math.floor((y - FLOOR - 1) / 6);
    for (let x = 0; x < W; x++)
      g[y][x] =
        row === 5 || (x + (course % 2) * 10) % 20 === 0 ? 'bedrock' : row === 0 && course === 0 ? 'deep' : 'mortar';
  }
  for (let x = MX + 4; x < MX + 15 * MS + 4; x++) for (let y = FLOOR + 1; y <= FLOOR + 2; y++) g[y][x] = 'bedrock'; // contact shadow
  stamp(g, w, WX, WY, 2);
  for (const [s, c, y] of lines) {
    const t = text(s, SMALL);
    for (const p of t.cells) g[y + p.y][WX + p.x] = c;
  }
  return g;
}

// ---- SVG -----------------------------------------------------------------------------------------------------------

/** One path per colour: same-colour horizontal runs, and identical runs in consecutive rows merged into rectangles. */
export function paths(g, colours = {...PALETTE, line: PALETTE.bedrock}) {
  const rects = [],
    open = new Map();
  g.forEach((row, y) => {
    const next = new Map();
    for (let x = 0; x < row.length;) {
      const c = row[x];
      if (!c) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < row.length && row[x + w] === c) w++;
      const key = `${x},${w},${c}`,
        r = open.get(key) ?? {x, y, w, h: 0, c};
      if (!open.has(key)) rects.push(r);
      r.h++;
      next.set(key, r);
      x += w;
    }
    open.clear();
    for (const [k, r] of next) open.set(k, r);
  });
  const by = {};
  for (const {x, y, w, h, c} of rects) (by[c] ??= []).push(`M${x} ${y}h${w}v${h}h-${w}z`);
  return Object.entries(by)
    .map(([c, d]) => `<path fill="${colours[c] ?? c}" d="${d.join('')}"/>`)
    .join('\n');
}

const NOTE = 'Foundation Engine brand asset, generated by scripts/brand/build.mjs; see docs/brand.md.';
export function svg(g, {scale, title, desc, background}) {
  const W = g[0].length,
    H = g.length;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * scale}" height="${H * scale}" shape-rendering="crispEdges" role="img" aria-labelledby="t d">
<title id="t">${title}</title>
<!-- ${NOTE} -->
<desc id="d">${desc}</desc>
${background ? `<rect width="${W}" height="${H}" fill="${PALETTE[background]}"/>\n` : ''}${paths(g)}
</svg>
`;
}

// ---- ASCII ---------------------------------------------------------------------------------------------------------

/** Display letters as ASCII, two pixel rows per text row: '8' both lit, '"' top only, 'o' bottom only. */
export function asciiWord(word) {
  const t = text(word, DISPLAY),
    g = Array.from({length: 8}, () => Array(t.width).fill(false));
  for (const {x, y} of t.cells) {
    g[y][x] = true;
    if (y === 6) g[7][x] = true;
  } // the base row doubled, letters sit on the line
  const rows = [];
  for (let y = 0; y < 8; y += 2)
    rows.push(g[y].map((v, x) => (v && g[y + 1][x] ? '8' : v ? '"' : g[y + 1][x] ? 'o' : ' ')).join(''));
  return rows;
}

/** The Plinth in ASCII, one row per tier: the capstone, then courses of two, three and four bricks. */
const TIERS = ['[####]', '[====][====]', '[====][====][====]', '[====][====][====][====]'];

/** The README banner (69 columns): FOUNDATION, then a stepped Plinth beside ENGINE, on a slab. */
export function asciiBanner() {
  const top = asciiWord('FOUNDATION'),
    bottom = asciiWord('ENGINE'),
    w = top[0].length,
    pw = w - bottom[0].length - 2;
  const tiers = TIERS.map(t => (' '.repeat(Math.floor((pw - t.length) / 2)) + t).padEnd(pw));
  const lines = [...top, '', ...bottom.map((r, i) => tiers[i] + '  ' + r), '[' + '#'.repeat(w - 2) + ']'];
  return lines.map(l => (' ' + l).trimEnd()).join('\n');
}

/** The docs page header (at most 40 columns): the small Plinth and the name; `motto` is the page's line. */
export function asciiHeader(motto) {
  return [
    '      [##]          FOUNDATION ENGINE',
    '    [======]        =================',
    `  [==][==][==]      ${motto}`,
    ' [############]',
  ].join('\n');
}

/** The docs pages that carry the header, and their lines. */
export const HEADERS = {
  'docs/README.md': 'DOCS: SELECT A ROUTE',
  'docs/guides/getting-started.md': 'STAGE 1: FIRST GAME',
  'CONTRIBUTING.md': 'PLAYER 2 HAS JOINED',
  'docs/brand.md': 'BRAND GUIDE',
};

// ---- Build ---------------------------------------------------------------------------------------------------------

export const ASSETS = {
  'logo-mark.svg': () => [
    outlined(),
    {
      scale: 8,
      title: 'Foundation Engine logo',
      desc: 'A stepped plinth of blue pixel bricks with a gold capstone; its navy outline reads on light and dark backgrounds.',
    },
  ],
  'lockup-light.svg': () => [
    lockupGrid('light'),
    {
      scale: 5,
      title: 'Foundation Engine',
      desc: 'The Foundation Engine logo: a stepped plinth of blue pixel bricks with a gold capstone beside the words FOUNDATION ENGINE in pixel letters, for light backgrounds.',
    },
  ],
  'lockup-dark.svg': () => [
    lockupGrid('dark'),
    {
      scale: 5,
      title: 'Foundation Engine',
      desc: 'The Foundation Engine logo: a stepped plinth of blue pixel bricks with a gold capstone beside the words FOUNDATION ENGINE in pixel letters, for dark backgrounds.',
    },
  ],
  'icon.svg': () => [
    iconGrid(),
    {scale: 8, title: 'Foundation Engine icon', desc: 'The plinth logo on a dark navy square.'},
  ],
  'social-preview.svg': () => [
    socialGrid(),
    {
      scale: 4,
      title: 'Foundation Engine',
      desc: 'A night sky over a brick floor. The plinth logo stands on the floor beside FOUNDATION ENGINE and the lines TYPESCRIPT + THREE.JS ENGINE, FOR BROWSER GAMES OF ANY GENRE, GPL-3.0, OPEN SOURCE.',
    },
  ],
};
/** PNGs rendered from the SVGs: [file, source, width]. Every width is a whole multiple of the grid. */
export const PNGS = [
  ['social-preview.png', 'social-preview.svg', 1280],
  ...[16, 32, 64, 128, 256, 512].map(s => [`icon-${s}.png`, 'icon.svg', s]),
];

/** Render an SVG to PNG at `width`, and fail if any pixel is not a palette colour (or transparent). */
export async function png(svgText, width) {
  const {Resvg} = await import('@resvg/resvg-js');
  const img = new Resvg(svgText, {fitTo: {mode: 'width', value: width}, shapeRendering: 0}).render();
  const allowed = new Set(Object.values(PALETTE).map(h => h.toLowerCase()));
  const p = img.pixels;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] === 0) continue;
    const hex = '#' + [p[i], p[i + 1], p[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('');
    if (p[i + 3] !== 255 || !allowed.has(hex))
      throw new Error(
        `off-palette pixel ${hex}/${p[i + 3]} at ${(i / 4) % img.width},${Math.floor(i / 4 / img.width)}`,
      );
  }
  return img.asPng();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--ascii')) {
    console.log(asciiBanner() + '\n\n' + asciiHeader('YOUR LINE HERE'));
  } else {
    mkdirSync(OUT, {recursive: true});
    const texts = {};
    for (const [name, make] of Object.entries(ASSETS)) {
      const [g, opts] = make();
      texts[name] = svg(g, opts);
      writeFileSync(join(OUT, name), texts[name]);
      console.log(`wrote assets/brand/${name}`);
    }
    for (const [name, src, width] of PNGS) {
      writeFileSync(join(OUT, name), await png(texts[src], width));
      console.log(`wrote assets/brand/${name}`);
    }
  }
}
