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
| `extensions` | no | glTF extensions the GLB may use; default none. List `EXT_meshopt_compression` (and `KHR_mesh_quantization`, `EXT_texture_webp`) for an optimised model. Draco (`KHR_draco_mesh_compression`) can never be listed: the engine registers only the meshopt decoder. List `KHR_texture_basisu` for KTX2 textures (the engine transcodes them since PR #146); each KTX2 image must be Basis Universal (ETC1S or UASTC) and one 2D image, as the engine requires. |
| `materials` | yes | `properties`: the material keys allowed (must include `name`). `pbr`: the `pbrMetallicRoughness` keys allowed. Optional: `required`, `requiredPbr` (keys that must be present), `alphaModes` (default `["OPAQUE"]`), `expected` (the exact set of materials by name, each with optional `baseColorFactor`, `metallicFactor`, `roughnessFactor`, `emissiveFactor`, `doubleSided`). |
| `lattice` | no | `{name, x, y, z}`: every vertex coordinate must be one of the listed values per axis (for block-built geometry). |
| `faces` | no | `[{name, axis, at, material, triangles?}]`: exactly one primitive lies wholly on the plane `axis = at`, uses `material` and has `triangles` triangles. |
| `nodes` | no | Node names that must exist in the GLB and in the re-imported scene: attachment points, sockets, parts a system looks up by name. |
| `clips` | no | Animation clip names that must exist and have a duration above zero. `limits.animations` must be at least their number. |
| `semanticSha256` | no | Pins the decoded positions, normals, indices, world matrices and material factors. Any geometry change, however small, fails; a deliberate change re-exports and updates the pin in the same commit. |
| `provenance` | yes | `required`: receipt fields that must be present and non-empty; it must include `licence`, `author`, `source`, `tool` and `generator`. Optional: `licences` (the accepted licence identifiers) and `equals` (receipt values that must match exactly). |

Rules that need no contract key: the GLB header and chunks must be well formed; there is at most one buffer and it is the GLB's own BIN chunk (no `uri`); images are embedded (`bufferView`, no `uri`); primitives are triangles; the model carries no light; the receipt's `sha256` matches the file; the receipt's `generator` equals the GLB's `asset.generator`; when the receipt has `sourceSha256`, its `source` file exists in the repository and matches it.

## Re-import

The geometry rules do not trust the exporter's report or the accessor metadata. They run on a re-import of the GLB: three.js's `GLTFLoader` with the meshopt decoder, the same parser the engine's model loader uses (`src/platform/assets/models.ts`). Triangles, vertices, bounds, size, pivot, named nodes and clips are read from what that re-import builds. Image dimensions come from each embedded image's header (PNG, JPEG, WebP or KTX2); the images are then removed, because Node has no image decoder (nor, for KTX2, a transcoder: the check reads the KTX2 header only).

### Texture format for phone targets

WebP (`EXT_texture_webp`) makes the download smaller; the GPU still holds RGBA8. KTX2 (`KHR_texture_basisu`) also keeps
the texture compressed on the GPU, which is what limits art on phones. The engine loads KTX2 model textures lazily
([guide](compressed-textures.md)), so an optimiser may write KTX2 instead of WebP when the brief targets phones: UASTC
for normal, occlusion and metal-roughness maps, ETC1S for colour, sides a multiple of 4, and `KHR_texture_basisu` in the
contract's `extensions`. `npm run asset:optimize` has its own owner; switching its texture step to KTX2 for phone
targets is that tool's change, enabled by this capability rather than made by it. Keep WebP for desktop-only builds if
the transcoder download (0.6 MB, fetched once) matters more than GPU memory.

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
- **Not checked:** texture colour spaces and pixel contents; animation clip contents beyond names and duration; skinning; visual quality; whether the receipt's licence claim is true. Images are counted, sized in bytes and measured from their headers, but not decoded. It is an acceptance check for the creator's own assets, not a security boundary for untrusted files.
