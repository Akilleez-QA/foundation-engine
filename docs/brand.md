# Foundation Engine brand

```text
      [##]          FOUNDATION ENGINE
    [======]        =================
  [==][==][==]      BRAND GUIDE
 [############]
```

The mark is the **Plinth**: a stepped base of blue bricks with a gold capstone. It says what Foundation is, the base you build a browser game on. Everything is original pixel art drawn as SVG rectangles with `shape-rendering="crispEdges"`; no fonts or third-party images are used.

## Files

| File | Use |
|---|---|
| `assets/brand/lockup-dark.svg` | Mark and name on dark backgrounds (README dark theme) |
| `assets/brand/lockup-light.svg` | Mark and name on light backgrounds |
| `assets/brand/logo-mark.svg` | The mark alone; its navy outline reads on light and dark |
| `assets/brand/icon.svg` | 16 × 16 grid icon on a bedrock square: favicons, avatars |
| `assets/brand/social-preview.png` | 1280 × 640 GitHub social preview (SVG source beside it) |

Scale pixel art by whole numbers only (2×, 3×, 4×…) with nearest-neighbour sampling. Never use smoothing upscalers such as hq2x or xBR on the mark; they add colours and blur the grid.

## Palette

Blue leads; gold is the accent. There is no orange.

| Name | Hex | Role |
|---|---|---|
| Bedrock | `#141A33` | Night background, outlines, letters on light |
| Mortar | `#2B3566` | Brick joints, quiet pattern |
| Deep | `#1B6AA5` | Brick shadow sides |
| Signal | `#2FA8E0` | Lead colour: brick faces, shadow under FOUNDATION |
| Sky | `#9BDDFA` | Brick top highlights |
| Spark | `#FFC93C` | Capstone, shadow under ENGINE, accent text |
| Ochre | `#D9971F` | Capstone shadow |
| Chalk | `#F6F1E7` | Letters on dark, capstone highlight |

Letters use Bedrock on light pages and Chalk on dark pages for full contrast; colours are never the only way information is conveyed.

## Usage

- Keep clear space around the mark equal to the capstone's width.
- Minimum size: the icon at 16 px, the lockup at 240 px wide.
- Don't recolour, rotate, stretch, outline or add effects to the mark, and don't rebuild it as a letter.

## ASCII banners

Plain ASCII, so they survive any monospace font, terminal or chat client. Put them in a code block (```` ```text ```` on GitHub, ```` ``` ```` on Discord). They are decoration: show them after a heading and never let them carry information that is not also in the text.

Docs header (40 columns):

```text
      [##]          FOUNDATION ENGINE
    [======]        =================
  [==][==][==]      YOUR LINE HERE
 [############]
```

The README banner (69 columns) is at the end of the [README](../README.md).

## History

A first draft used a striped orange letter mark and was withdrawn the same day for resembling another company's logo. The Plinth replaced it; it was compared against about 3,500 brand marks from Simple Icons as a sanity check (not a trademark search).

## Licence

The brand assets are part of this repository and licensed GPL-3.0-only like the rest of it. A separate licence for the logo is the author's decision.
