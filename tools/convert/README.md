# Converters: creator files to engine formats

`npm run convert -- <kind> <input> <output> [options]` turns files a creator already
has into the formats the engine loads (glTF binary for models and animation, PNG for
textures), and writes the provenance receipt `npm run check` reads. It runs offline,
on the creator's machine; nothing is added to the runtime. The engine still ingests
only glTF/GLB for models: these converters feed that pipeline, they do not widen it.

| Kind | Input | Output |
|---|---|---|
| `obj` | Wavefront OBJ (`v`, `vt`, `vn`, `f` with any polygon size and negative indices, `usemtl`), its MTL (`Kd`, `d`/`Tr`, `map_Kd` PNG/JPEG embedded) | `.glb`: one primitive per material, `uint16`/`uint32` indices, smooth normals when the file has none (`--normals none` to skip) |
| `ply` | PLY ascii, binary little- and big-endian; vertex `x y z`, optional `nx ny nz`, `s t`/`u v`, `red green blue [alpha]` (uchar, ushort or float, each scaled by its declared type); `face` lists; other elements skipped | `.glb`: triangles, or points when there are no faces; all-byte colours as normalised bytes, others as floats in `COLOR_0` |
| `bvh` | BVH motion capture (one `ROOT`, any channel order, end sites) | `.glb`: the joint hierarchy as nodes and one animation (linear translation and rotation channels) |
| `image` | PCX (8-bit palette, or 8-bit 3/4-plane), BMP (1/4/8-bit palette incl. RLE8/RLE4, 24/32-bit incl. whole-byte `BI_BITFIELDS` masks), or raw one-byte indices (exactly width × height bytes) with `--palette` (768-byte RGB, `--six-bit` VGA values, JASC-PAL, GIMP `.gpl`) | `.png`: indexed (palette kept, for palette effects) or `--rgba`; `--transparent <index>` makes one entry transparent |

```sh
npm run convert -- obj crate.obj game/public/models/crate.glb --author "Sam Rivera" --licence CC0-1.0
npm run convert -- bvh walk.bvh game/public/models/walk.glb --bone-map rig-map.json --scale 0.01 \
  --root-translation horizontal-none --author "Sam Rivera" --licence CC-BY-4.0 --origin library --source https://…
npm run convert -- image tiles.pcx game/public/textures/tiles.png --transparent 0 --author … --licence …
```

Common options: `--scale <n>` (positions and BVH translations), `--max-bytes <n>`
(per input file, default 256 MiB), `--json` (machine-readable result).

## BVH retargeting

`--bone-map map.json` is `{"SourceJoint": "targetBone", …}`. Mapped joints are
renamed so a three.js `AnimationMixer` binds the clip to a target rig by name.
Every unmapped joint is folded into its mapped descendants: its local rotation and
translation are composed into theirs each frame, so the mapped joints keep exactly
their world-space motion (the tests check this). End sites are dropped unless
`--keep-end-sites`. `--root-translation all | horizontal-none | none` keeps, pins on
the ground plane, or removes the root's translation (for in-place loops; the engine's
root-motion kit can read the motion separately).

Not done: correcting different rest orientations. The clip carries rotations in the
source's joint frames, so the target rig's bones must share the source's rest pose
and axes (as rigs built from the same skeleton, or with identity joint orientations
in a matching T-pose, do). Retarget between different rest poses in a DCC tool, then
convert. Translation units follow `--scale`; BVH is usually centimetres (`0.01`).

## Provenance

Every conversion writes `<output name>.provenance.json` beside the output with the
fields [asset provenance](../../docs/guides/asset-provenance.md) requires: `origin`
(`--origin`, default `hand`), `author` and `licence` (required, or pass
`--no-provenance` to skip the receipt, which `npm run check` will then report;
AI origins also take `--model`, `--human-edits`, `--prompt` or `--reference`, and for
`ai-generator` `--weights-licence` and `--output-licence`; the receipt is checked with
the same rules as `npm run check` before anything is written),
`source` (`--source`, default the input path), `sha256` of the output, `tool`,
`generator` (the kind and options), `sourceSha256`, `inputs` (every file read, with
its hash: OBJ, MTL, textures, palette, bone map) and `artifact`. A receipt beside the
output that belongs to another file is never overwritten; record that one in
`assets.provenance.json`. A receipt is a record of what was converted, not proof of
rights: converting a file does not change its licence.

## Contract

- Owner: the creator's command. The tool reads the input and the files it names,
  and writes only the output and its receipt.
- Bounds: `--max-bytes` per input; 2^24 output vertices (OBJ/PLY); 512 joints,
  10^6 frames and 2^22 joint samples (frames × kept joints) for BVH, with constant
  rotations written as one key; 1,024 indices per PLY list; 32,768 px per side and
  2^26 pixels (images), and a PCX header may not claim more data than its file can
  expand to. Overload is a refusal with the reason, never a partial file.
- Containment: files an OBJ names (MTL, textures) must be inside the input's folder;
  absolute paths and `../` are refused, and only `.png`/`.jpg` texture names are read
  (and must carry PNG/JPEG signatures) so a downloaded model cannot pull another
  file into the output or the receipt.
- Failure: malformed input (short vertex lines, non-finite values, empty vertex
  lists, out-of-range colours, key times that collapse in float32) stops with the
  line, element or field that is wrong; nothing is written. Output and receipt are
  written under temporary names and then renamed; if the second rename fails, the
  receipt's hash no longer matches and `npm run check` reports it.
- Determinism: the same input and options give the same bytes. Rotations use the
  engine's `dmath`; lengths use only correctly rounded operations. PNG bytes depend
  on the zlib build bundled with Node.
- Formats are independent implementations of their public descriptions; no
  third-party converter code is included. Formats reverse-engineered from other
  software are equally welcome as converters when the creator directs, under the same
  rules (one file per format, tests against an oracle or reference cases, provenance).

## Evidence

`tools/convert/convert.test.mjs` (in `npm test`): OBJ triangles equal three.js's
`OBJLoader`; PLY positions equal `PLYLoader` (ascii, both binary byte orders, extra
elements, point clouds); BVH rotations and translations equal `BVHLoader` frame by
frame; folding preserves mapped joints' world positions; PCX, BMP and BMP-RLE8
indices and palettes survive into indexed PNGs; every GLB passes the glTF validator
(when installed) and loads in `GLTFLoader`; a converted file's receipt passes the
provenance check; refusals for malformed input. An independent adversarial review
found ten defects (two silently invalid GLBs, file embedding through `../` texture
paths, PLY colours guessed from values, memory amplification from small BVH and PCX
headers, ignored BMP colour masks, AI-origin receipts failing the provenance check,
float32 key-time collapse and several edge cases); each is fixed with a regression
test. Not claimed: OBJ features beyond the
table (curves, line elements, per-face groups), PLY with other vertex layouts, BVH
files with several roots, PCX/BMP variants outside the table, visual review of real
creator assets.
