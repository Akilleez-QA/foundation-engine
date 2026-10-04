# Model contracts

A model contract states, before a model is made, what the creator asked for: its size and pivot, its triangle, vertex, material and texture budget, its file and texture bytes, the material properties the exporter may write and the provenance every asset must record. `npm run asset:verify` checks a GLB against it.

```sh
npm run asset:verify -- game/public/models/lantern.glb     # one or more models
npm run asset:verify -- --contract my.contract.json m.glb  # one model, an explicit contract
npm run asset:verify -- --all                              # every contracted GLB under each game's public/models
```

`npm run check` runs `--all`. It discovers root `game/`, `templates/<name>/game`, `tools/<name>/game` and the selected `GAME_DIR`. Any GLB under a game's `public/models/` that has a contract next to it must pass. A GLB without one is listed as skipped, not checked. A contract whose GLB is missing fails.

## Files

Three files sit side by side:

| File | Written by | Holds |
|---|---|---|
| `<name>.glb` | the exporter | the model: binary glTF with everything embedded |
| `<name>.provenance.json` | the export script | the receipt: licence, author, source, tool, generator, the GLB's SHA-256 and, for a checked-in script, the script's SHA-256 |
| `<name>.contract.json` | the creator (or the agent, from the creator's numbers) | the limits below |

Write the contract **before** making the model, from the brief: which success criterion the model serves, its real-world size, its pivot and its share of the scene's budget row. A contract is a ceiling. Do not raise a number to accept a model; simplify the model, or ask the creator. Raising a scene budget follows the brief's rules (`Perf-Budget:` trailer, creator's agreement).

## Schema (version 1)

Every key is checked; an unknown key is an error, so a misspelt limit cannot silently drop a check.

| Key | Required | Meaning |
|---|---|---|
| `schema` | yes | `1` |
| `units`, `up` | yes | `"metres"` and `"+Y"`: glTF's units and axis. Export from Blender with `export_yup=True`. |
| `tolerance` | no | Comparison tolerance in metres and factors; default `1e-6`. |
| `bounds` | one of `bounds` / `size` | `{min: [x, y, z], max: [x, y, z]}`: the exact decoded world bounds. |
| `size` | one of `bounds` / `size` | `{min: [x, y, z], max: [x, y, z]}`: the allowed range of the decoded extents (width, height, depth). |
| `pivot` | yes | `{at, node?, tolerance?}`. `at` is `"base-centre"` (lowest point at y = 0, footprint centred on x = z = 0), `"centre"` (bounds centred on the origin) or `"any"`. `node` names a node that must sit at the world origin. |
| `limits` | yes | Whole numbers: `fileBytes`, `triangles`, `vertices`, `materials`, `textures`, `textureBytes` (required); `textureSize` (the largest width or height of any embedded image, in pixels; required when `textures` is above 0); `primitives`, `animations` (default 0), `cameras` (default 0). Vertices and triangles are counted from the re-imported geometry. |
| `nodeTransforms` | no | `"forbidden"` rejects any node `translation`, `rotation`, `scale` or `matrix`, even an identity: transforms must be baked into the mesh. Default `"allowed"`. |
| `extensions` | no | glTF extensions the GLB may use; default none. List `EXT_meshopt_compression` (and `KHR_mesh_quantization`, `EXT_texture_webp`) for an optimised model. Draco (`KHR_draco_mesh_compression`) can never be listed: the engine registers only the meshopt decoder. KTX2 (`KHR_texture_basisu`) can never be listed either, and a KTX2 extension, texture source or `image/ktx2` image anywhere in the model is refused: KTX2 textures are not loadable until the engine adds KTX2 support (the switch is `ENGINE_KTX2` in `scripts/asset-verify.mjs`). |
| `materials` | yes | `properties`: the material keys allowed (must include `name`). `pbr`: the `pbrMetallicRoughness` keys allowed. Optional: `required`, `requiredPbr` (keys that must be present), `alphaModes` (default `["OPAQUE"]`), `expected` (the exact set of materials by name, each with optional `baseColorFactor`, `metallicFactor`, `roughnessFactor`, `emissiveFactor`, `doubleSided`). |
| `lattice` | no | `{name, x, y, z}`: every vertex coordinate must be one of the listed values per axis (for block-built geometry). |
| `faces` | no | `[{name, axis, at, material, triangles?}]`: exactly one primitive lies wholly on the plane `axis = at`, uses `material` and has `triangles` triangles. |
| `nodes` | no | Node names that must exist in the GLB and in the re-imported scene: attachment points, sockets, parts a system looks up by name. |
| `clips` | no | Animation clip names that must exist and have a duration above zero. `limits.animations` must be at least their number. |
| `silhouette` | no | Opt-in shape check against a reference image: `{reference, view, pixels?, stage?, threshold?}`. See [silhouette](#silhouette). |
| `semanticSha256` | no | Pins the decoded positions, normals, indices, world matrices and material factors. Any geometry change, however small, fails; a deliberate change re-exports and updates the pin in the same commit. |
| `provenance` | yes | `required`: receipt fields that must be present and non-empty; it must include `licence`, `author`, `source`, `tool` and `generator`. Optional: `licences` (the accepted licence identifiers) and `equals` (receipt values that must match exactly). |

Rules that need no contract key: the model loader's own admission caps from `src/platform/assets/models.ts`, which no contract can raise (a file of at most 32 MiB; at most 4,096 accessors, each of at most 1,048,576 elements and 16,777,216 decoded values in all; at most 4,096 nodes, 128 skins and 128 animations; and at most four bone influences per vertex, so `JOINTS_0`/`WEIGHTS_0` only); the GLB header and chunks must be well formed; there is at most one buffer and it is the GLB's own BIN chunk (no `uri`); images are embedded (`bufferView`, no `uri`); primitives are triangles; the model carries no light; the receipt's `sha256` matches the file; the receipt's `generator` equals the GLB's `asset.generator`; when the receipt has `sourceSha256`, its `source` file exists in the repository and matches it.

## Re-import

The geometry rules do not trust the exporter's report or the accessor metadata. They run on a re-import of the GLB: three.js's `GLTFLoader` with the meshopt decoder, the same parser the engine's model loader uses (`src/platform/assets/models.ts`). Triangles, vertices, bounds, size, pivot, named nodes and clips are read from what that re-import builds. Image dimensions come from each embedded image's header (PNG, JPEG, WebP or KTX2); the images are then removed, because Node has no image decoder.

## Optimise

```sh
npm run asset:optimize -- game/tools/lantern/out/lantern.glb --out game/public/models/lantern.glb
```

`asset:optimize` runs [glTF-Transform](https://gltf-transform.dev/) (`@gltf-transform/cli`, a development dependency) `optimize` on one model:

1. **Before:** the input must pass its own contract (the `.contract.json` next to it), so the optimiser never hides a bad export.
2. **Optimise:** meshopt geometry compression, the only mesh compression the engine decodes. `--join false --flatten false` keep named nodes; `--instance false --palette false` keep meshes and materials as authored; `--simplify false` never decimates, so make the model at its target polycount instead.
3. **Textures:** WebP by default (`EXT_texture_webp`, which the engine's `GLTFLoader` decodes), resized to `--texture-size`, else the output contract's `limits.textureSize`, else the `--device` default (phone 1024; tablet, laptop and desktop 2048), else 2048. `--textures keep` re-encodes in the original format. `--ktx2` is refused for now with the message *KTX2 textures are not loadable until the engine adds KTX2 support*. Once the engine registers a KTX2 transcoder and `ENGINE_KTX2` is switched on, it will use UASTC for normal, occlusion and metal-roughness maps and ETC1S for colour. That needs the external `ktx` command from [KTX-Software](https://github.com/KhronosGroup/KTX-Software/releases) 4.4 or later; without it, the pass says so and falls back to WebP.
4. **After:** the output must pass the contract next to `--out` (else the input's; `--contract` sets one for both). Only then are the GLB and its receipt written. On any failure nothing at `--out` changes.

The output receipt keeps the input's licence, author, source and tool. It records the new `sha256` and `generator` (`glTF-Transform v…`), plus `optimizedFrom` (the input's hash and generator) and `optimizer` (the exact arguments).

Meshopt quantisation stores positions as integers with a node translation and scale to restore them, and it moves vertices by up to about a thousandth of the model's size. A contract for an optimised model therefore lists `EXT_meshopt_compression` and `KHR_mesh_quantization` (plus `EXT_texture_webp` when textured) in `extensions`. It sets `nodeTransforms` to `"allowed"`, has no `pivot.node` and no `semanticSha256`, and states `size` as a range or with a `tolerance` such as `0.001`. Keep the strict contract on the unoptimised export.

## Silhouette

Numbers alone do not say whether a model looks like what the creator asked for. The optional `silhouette` key compares the model's outline with a reference image, the measured check that the community recommends instead of "looks fine":

```json
"silhouette": {"reference": "../../tools/lantern/lantern.front.png", "view": "front", "pixels": 128, "stage": "final"}
```

| Key | Meaning |
|---|---|
| `reference` | A PNG, relative to the contract: a dark shape on a light background, or an opaque shape on transparency. 8-bit greyscale, RGB or with alpha; not indexed or interlaced; at most 4096 px a side. Keep it outside `public/` (for example in `game/tools/<name>/`), so it does not ship. |
| `view` | `front` (looking along -Z: x right, y up), `side` (from +X: -z right, y up) or `top` (from above: x right, -z up). |
| `pixels` | The comparison size, 16 to 1024; default 128. Use the size the model has on screen in play, so detail too small to see does not count. |
| `stage` | `blockout` (default threshold 0.85) or `final` (0.90; the default). |
| `threshold` | Overrides the stage's threshold: the minimum overlap, intersection over union, from 0 to 1. |

The check renders the re-imported model's silhouette without a GPU, by rasterising its triangles orthographically from the view. It crops both masks to their shapes, scales each to fit `pixels` × `pixels` keeping its aspect ratio, centres it horizontally on the bottom edge, and measures the overlap. The reference's own scale and margins therefore do not matter, but its proportions do. `npm run asset:verify -- --masks <folder> <model.glb>` writes both masks as PNGs, so you can look at the difference.

It needs a reference the creator agrees with: a concept drawing, an orthographic sketch or a photo traced to a silhouette. It measures the outline only, not colour, depth or detail inside the outline. A rotated or mirrored reference fails.

## Provenance fields

| Field | Meaning |
|---|---|
| `licence` | The asset's true licence, as an SPDX identifier where one exists (`GPL-3.0-only`, `CC0-1.0`, `CC-BY-4.0`). Never the game's licence when the asset came from elsewhere. |
| `author` | Who made it. For a downloaded asset, the original author as its licence asks to be credited. |
| `source` | Where it came from: the repository path of the export script, or the URL of the downloaded asset. |
| `tool` | What made it: `Blender 5.2.1 LTS`, or a named generator service and plan for AI-generated geometry. |
| `generator` | The glTF writer recorded in the GLB's `asset.generator`, such as `Khronos glTF Blender I/O v5.2.40`. |

The same licence, author and source go in the game's `defineAsset`; a third-party asset is also listed in [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) or the game's own notices. A receipt is an integrity record, not proof of rights.

## Example

```json
{
  "schema": 1,
  "units": "metres",
  "up": "+Y",
  "size": {"min": [0.15, 0.3, 0.15], "max": [0.25, 0.45, 0.25]},
  "pivot": {"at": "base-centre"},
  "limits": {"fileBytes": 32768, "triangles": 300, "vertices": 600, "materials": 2, "textures": 0, "textureBytes": 0},
  "nodeTransforms": "forbidden",
  "materials": {
    "properties": ["name", "doubleSided", "pbrMetallicRoughness", "emissiveFactor"],
    "pbr": ["baseColorFactor", "metallicFactor", "roughnessFactor"]
  },
  "provenance": {
    "required": ["licence", "author", "source", "tool", "generator", "sha256"],
    "licences": ["GPL-3.0-only", "CC0-1.0"]
  }
}
```

The strict sample contract is [`metre-block.contract.json`](../../tools/blender-export/game/public/models/metre-block.contract.json): exact bounds, exact materials, box-corner vertices, a gold top and a pinned semantic hash.

## Owner, bounds and limits

- **Owner:** the creator owns each contract; `scripts/asset-verify.mjs` only reads. `npm run check` is its only automatic caller. It is not a runtime check: the engine's loader has its own admission rules ([model readiness](model-readiness.md)).
- **Bounds:** one GLB, its contract and receipt in memory at a time. The file size is checked against `fileBytes` before the file is read. No network access; external URIs are refused, never fetched.
- **Failure:** the first breach stops that model with one line naming the rule and the numbers; other models are still checked. Exit code 1 on any failure, 2 on a usage error.
- **Silhouette bounds:** one canvas of at most 1024 × 1024 and one reference of at most 4096 × 4096 in memory per check.
- **Not checked:** texture colour spaces and pixel contents; animation clip contents beyond names and duration; skinning; visual quality; whether the receipt's licence claim is true. Images are counted, sized in bytes and measured from their headers, but not decoded. It is an acceptance check for the creator's own assets, not a security boundary for untrusted files.
