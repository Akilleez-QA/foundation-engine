# Model contracts and `asset:verify` — 2026-10-03

## What changed

- `scripts/asset-verify.mjs` checks any GLB against a per-model `<name>.contract.json`: size bounds and pivot; triangle, vertex, primitive, material, texture, animation and camera limits; file and embedded-image bytes; allowed material and PBR properties, alpha modes and expected material values; node transforms; extensions; optional vertex lattice, face rules and a pinned decoded hash; and the receipt fields `licence`, `author`, `source`, `tool` and `generator`, the receipt's file hash, source hash and generator. Reference: [model contracts](../guides/model-contracts.md).
- `npm run asset:verify -- <glb>` runs it; `npm run check` runs `--all`, which covers every GLB with a contract under root `game/`, `templates/*/game`, `tools/*/game` and the selected `GAME_DIR` `public/models`.
- The metre-block sample's original rules are now its own contract, `tools/blender-export/game/public/models/metre-block.contract.json`. `tools/blender-export/verify.mjs` runs the general check with it and additionally requires the contract to keep the pinned `EXPECTED_SEMANTIC_SHA256` and the 64 KiB cap.
- `tools/blender-export/export.py` now writes `tool` and `generator` into the receipt. Its source SHA-256 is now `8e51250aecb2a989b3483466b5cde22d742480848e86ee1d81755944d0bec45d`.

## Verification performed

Linux x86-64, Node 22 (via `mise exec node@22`), Blender 5.2.1 LTS (`9e2066aef7ef`).

- `blender --background --factory-startup --python tools/blender-export/export.py -- --output tools/blender-export/game/public/models/metre-block.glb`: the regenerated GLB is byte-identical to the checked-in one, SHA-256 `fcc71461117220b6ac0f5452d00beabb5b419ba1eeb3c09f5d0ea956d18823cb`. Only the receipt changed (new `tool`, `generator`, `sourceSha256`).
- `node --test tools/blender-export/verify.test.mjs`: **15/15** pass, with the test file unchanged. Each of the sample's original rejections (identity node transforms, swapped materials, extra material and PBR properties, `doubleSided`, interior vertex, shifted node, decoded out-of-bounds vertex, external buffer, stale hash, changed normal) is still raised, now by the general check under the sample contract.
- `node --test scripts/asset-verify.test.mjs`: **69/69** pass. Each rejection is exercised against a mutated copy of the sample GLB with its receipt rehashed, so only the rule under test can reject it. The mutations cover the file size; a missing receipt; a stale hash; GLB magic, version, length, JSON and BIN chunk type and a truncated BIN chunk; each of the five required receipt fields; a non-text field; an unaccepted licence; a receipt value; a changed or missing hashed source; the generator; a second or external buffer; an external image; compression; an unlisted extension; texture count and bytes (with an embedded PNG); animations; cameras; material count; non-triangle primitives; each of the four node transforms; extra and missing material and PBR properties; alpha mode; renamed material; `doubleSided`; base colour, metallic, roughness and emissive factors; a light; empty geometry; bounds min and max; size range; base pivot height and footprint; centre pivot; missing and displaced pivot node; triangle, vertex and primitive limits; lattice; face plane, material and triangle count; and the semantic hash. Two positive cases pass an unchanged copy and a textured copy within its limits. Contract-schema and command-line refusals are covered too.
- `npm run asset:verify -- tools/blender-export/game/public/models/metre-block.glb`: pass. The mechanics template's `beacon.glb` has no contract, so `--all` lists it as skipped and an explicit run refuses it.
- `npm run check`: PASS, including the new `asset:verify` step. `npm run lint`: pass.

No browser was run for this change: the scene, the GLB and the browser diagnostic are unchanged. CI runs `test:blender-export-browser`.

## Not established

- Texture dimensions, colour space and texture compression; animation clip contents; skinning; visual quality.
- Whether a receipt's licence claim is true: the check confirms the field is present and accepted by the contract, not the rights.
- Untrusted-file safety: decoding uses three.js's `GLTFLoader` in Node with images removed; compressed geometry is refused, not decoded.
- Other Blender versions.

## Re-import checks (follow-up)

The geometry checks now decode with the meshopt decoder, the same `GLTFLoader` setup as `src/platform/assets/models.ts`. New rules:

- `limits.textureSize`: each embedded image's width and height, read from its PNG, JPEG, WebP or KTX2 header. It is required when `limits.textures` is above 0. An image in any other format is refused.
- `nodes` and `clips`: required node names, present both in the GLB and in the re-imported scene, and required animation clips with a duration above zero.
- Draco is refused with the reason (the engine registers only the meshopt decoder). A contract may now allow `EXT_meshopt_compression`. A required `KHR_texture_basisu` is refused, because the stock model loader registers no KTX2 transcoder.

`node --test scripts/asset-verify.test.mjs tools/blender-export/verify.test.mjs`: **92/92** pass on Node 22. The new tests are a texture wider than `textureSize` (a PNG header edited to 4096); a GIF image; a required KTX2 texture; a missing required node; a missing clip; a clip present (passes) and one with a single key (no duration); header parsing for all four formats; and contract refusals. The meshopt test checks that an allowed `EXT_meshopt_compression` declaration decodes through the engine decoder. That model has no compressed buffer views, so a real meshopt round trip still needs an optimised fixture.

