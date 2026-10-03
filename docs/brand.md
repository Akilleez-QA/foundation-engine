# Foundation Engine brand

```text
      [##]          FOUNDATION ENGINE
    [======]        =================
  [==][==][==]      BRAND GUIDE
 [############]
```

The mark is the **Plinth**: a stepped base of blue bricks with a gold capstone, the base you build a browser game on. Every mark and letter is original pixel art, drawn as a grid in [`scripts/brand/build.mjs`](../scripts/brand/build.mjs). No font or third-party image is used.

<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/brand/lockup-dark.svg">
    <img alt="Foundation Engine logo: a stepped plinth of blue pixel bricks with a gold capstone, beside the name in pixel letters" src="../assets/brand/lockup-light.svg" width="480">
  </picture>
</p>

## Files

All in [`assets/brand/`](../assets/brand/).

| File | Use |
|---|---|
| `lockup-dark.svg`, `lockup-light.svg` | Mark and name for dark and light backgrounds; the README hero at 480 px (5x) |
| `logo-mark.svg` | The mark alone (16 x 16); its navy outline reads on light and dark |
| `icon.svg`, `icon-16.png` to `icon-512.png` | The mark on a bedrock square, drawn natively at 16 x 16: favicons, avatars, app icons |
| `social-preview.svg`, `social-preview.png` | The 1280 x 640 social preview: the Plinth on a brick floor under a night sky |

Regenerate everything after changing a grid or a colour:

```sh
node scripts/brand/build.mjs           # SVGs and PNGs in assets/brand/
node scripts/brand/build.mjs --ascii   # prints the README banner and the docs header
```

The generator merges same-colour pixels into one SVG path per colour, renders PNGs with resvg at whole-number scales, and fails if a PNG contains any colour outside the palette. `scripts/brand/build.test.mjs` (part of `npm test`) checks contrast, the palette, the mark's symmetry, pixel-exact rendering and that the committed ASCII art matches the generator.

## Palette

Blue leads; gold is the accent. There is no orange. Contrast ratios are against GitHub's light page (`#ffffff`), its dark page (`#0d1117`) and the Bedrock night sky.

| Name | Hex | Role | Light | Dark | Bedrock |
|---|---|---|---|---|---|
| Bedrock | `#141A33` | Night sky, outlines, letters on light | 17.1:1 | n/a | n/a |
| Mortar | `#2B3566` | Brick joints, dusk, floor | 11.6:1 | 1.6:1 | 1.5:1 |
| Deep | `#1B6AA5` | Brick shadow sides | 5.8:1 | 3.3:1 | 3.0:1 |
| Signal | `#2FA8E0` | Lead: brick faces, shadow under FOUNDATION | 2.7:1 | 7.0:1 | 6.4:1 |
| Sky | `#9BDDFA` | Brick highlights | 1.5:1 | 12.7:1 | 11.5:1 |
| Spark | `#FFC93C` | Capstone, shadow under ENGINE, accent text | 1.5:1 | 12.3:1 | 11.2:1 |
| Ochre | `#D9971F` | Capstone shadow | 2.5:1 | 7.6:1 | 6.9:1 |
| Chalk | `#F6F1E7` | Letters on dark, capstone highlight | 1.1:1 | 16.8:1 | 15.2:1 |

The test enforces the rules: letters at 4.5:1 or more (Bedrock on light, Chalk on dark, Chalk and Spark on the night sky), and the mark at 3:1 or more against every background it meets (its Bedrock outline on light; each brick colour on GitHub dark). Mortar is for quiet pattern only. Colour is never the only carrier of information.

## Usage

- **Whole-number scales only** (2x, 3x, 4x...) with nearest-neighbour sampling. Never use smoothing upscalers such as hq2x or xBR; they add colours and blur the grid.
- **Clear space**: the capstone's width (four mark pixels) on every side.
- **Minimum size**: the icon at 16 px; the lockup at 192 px wide (2x).
- **Light and dark**: on a page that follows the viewer's theme, use both lockups:

  ```html
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/lockup-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/brand/lockup-light.svg">
    <img alt="Foundation Engine" src="assets/brand/lockup-light.svg" width="480">
  </picture>
  ```

- **Alt text**: where the logo is the heading, the name, "Foundation Engine"; elsewhere, describe it ("a stepped plinth of blue pixel bricks with a gold capstone").
- **Don't** recolour, rotate, stretch, outline or add effects to the mark, and don't rebuild it as a letter.

## ASCII banners

Plain ASCII, so they survive any monospace font, terminal or chat client. Put them in a code block (```` ```text ```` on GitHub, ```` ``` ```` on Discord desktop). They are decoration: show them after a heading and never let them carry information that is not also in the text. Both come from the same grids as the logo.

The README banner (69 columns):

```text
 88"""" o8""8o 88  88 88o 88 88""8o o8""8o ""88"" "88" o8""8o 88o 88
 88ooo  88  88 88  88 88"888 88  88 88oo88   88    88  88  88 88"888
 88     88  88 88  88 88  88 88  88 88  88   88    88  88  88 88  88
 88      8888   8888  88  88 88888  88  88   88   8888  8888  88  88

           [####]            88"""" 88o 88 o8"""" "88" 88o 88 88""""
        [====][====]         88ooo  88"888 88 ooo  88  88"888 88ooo
     [====][====][====]      88     88  88 88  88  88  88  88 88
  [====][====][====][====]   888888 88  88  88888 8888 88  88 888888
 [#################################################################]
```

The docs header (40 columns); change only the third text line:

```text
      [##]          FOUNDATION ENGINE
    [======]        =================
  [==][==][==]      YOUR LINE HERE
 [############]
```

## History and lookalike check

A first draft used a striped orange letter mark and was withdrawn the same day for resembling another company's logo. The Plinth replaced it. [`scripts/brand/lookalike.mjs`](../scripts/brand/lookalike.mjs) compares a mark's silhouette against the Simple Icons set of about 3,500 brand marks; the [2026-10-03 result](verification/brand-20261003/lookalike.txt) is a sanity check, not a trademark search.

## GitHub settings (for the author)

The social preview is uploaded by hand in the repository settings: `assets/brand/social-preview.png`.

## Licence

The brand assets, the generator and the ASCII banners are original work in this repository, licensed GPL-3.0-only like the rest of it. A separate licence or a use policy for the logo is the author's decision.
