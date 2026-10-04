# Blender export example

An original one-metre block proves a small authoring path: Blender Python → embedded GLB → existing `defineAsset` / `Model` loader → rendered game. No new asset cache, loader, renderer, editor or MCP service is introduced. Blender is optional: the checked-in GLB runs without it.

The files live in `tools/blender-export/` rather than `game/tools/` because this is a standalone sample game with its own brief, budgets and `GAME.md`, selected explicitly with `GAME_DIR` or `--game`; `game/` is reserved for the author's own game.

The block and generator are GPL-3.0-only project contributions. No downloaded model, image, font, texture, addon or generated external artwork is used. The adjacent provenance JSON records the licence, author, source, tool (`Blender 5.2.1 LTS`), glTF generator, source hash, artifact hash and the intended geometry contract. It is an integrity receipt, not a digital signature or proof of third-party rights.

## Regenerate and check

Install the repository's npm dependencies normally. The recorded export uses Blender **5.2.1 LTS**. Run these commands from the repository root (use the Blender executable's full path if it is not on PATH):

```sh
blender --background --factory-startup --python tools/blender-export/export.py -- --output tools/blender-export/game/public/models/metre-block.glb
node tools/blender-export/verify.mjs tools/blender-export/game/public/models/metre-block.glb
npm run asset:verify -- tools/blender-export/game/public/models/metre-block.glb
node --test tools/blender-export/verify.test.mjs
```

The export command replaces only its explicitly named output and adjacent `.provenance.json`. It clears the factory-startup process's temporary scene; it does not load or save your open Blender project. Never run it in a Blender session holding unsaved work. The script needs no GUI, account, network service or MCP.

To compare two independent exports, choose a scratch directory and export again there, then give both GLB paths to `verify.mjs`. Each must have its adjacent provenance JSON. Semantic comparison covers decoded positions, normals, indices, world transforms and material colours; it does not require Blender version strings or metadata ordering to match. Each export must also match the semantic hash pinned in `verify.mjs` for the checked-in sample. The recorded same-version exports were also byte-identical. Cross-version identity is not guaranteed.

## Contract

- Coordinates are authored directly in metres. Object location/rotation are zero and scale is one; origin is at the base centre.
- Blender Z-up is exported using `export_yup=True`: resulting glTF bounds are `[-0.5, 0, -0.5]` to `[0.5, 1, 0.5]` in Y-up coordinates.
- The cube has 12 triangles, two opaque rough nonmetallic materials, no textures, no animation and no external dependencies. Blue sides and a gold top make the up axis visually inspectable.
- The sample's limits are a [model contract](../../docs/guides/model-contracts.md), `game/public/models/metre-block.contract.json`, checked by the general `npm run asset:verify` (and by `npm run check`, which checks every contracted GLB under a game's `public/models`). `verify.mjs` is that check with this contract, plus a requirement that the contract still pins `EXPECTED_SEMANTIC_SHA256` and the 64 KiB cap, so editing the contract alone cannot loosen the sample.
- The sample contract limits the file to 64 KiB, verifies provenance hashes, embedded data, declared geometry/material constraints and decoded bounds/pivot. It also rejects any node translation, rotation, scale or matrix (transforms are baked into the mesh); any material or PBR property beyond those the exporter writes; a top face that is not the `top-gold` primitive lying wholly at the box top; and any vertex that is not a box corner. The decoded geometry and materials must match the pinned `EXPECTED_SEMANTIC_SHA256`, so editing the GLB and rehashing its provenance together still fails. A deliberate model change regenerates the GLB and provenance and updates that pin in the same commit. It is an acceptance check for this original sample, not a general untrusted-GLB security boundary.
- The exporter deliberately omits compression, modifiers, lights and cameras. The runtime adds the scene camera and lighting. Material node graphs in arbitrary Blender projects are not automatically supported.

The [Blender 5.2 glTF manual](https://docs.blender.org/manual/en/5.2/addons/scene_gltf2.html) explains the format and PBR export conventions. Exact operator options here were inspected and exercised in the installed 5.2.1 exporter; other versions need their own check.

## Run the real consumer

```sh
npm run play -- --game tools/blender-export/game
```

Open the printed address. The blue block should rest on the floor with its gold face upward. Space, gamepad A or tapping the view turns the entity around its base centre. The symmetry means a completed quarter-turn can look identical; the diagnostic asserts the input and scene state separately.

The game uses the existing API:

```ts
// game/block.asset.ts
import { defineAsset } from '@engine';
export default defineAsset({
  id: 'metre-block', type: 'model', url: '/models/metre-block.glb',
  licence: 'GPL-3.0-only', author: 'Foundation Engine contributors',
  source: 'tools/blender-export/export.py',
});
// Inside a scene's entities:
// [Name({ name: 'block' }), Transform(), Model({ asset: 'metre-block' })]
```

To use your own art, put its embedded GLB in your game's `public/models/`, record its actual licence/source and declare it through the same API. Re-author the sample-specific bounds and budgets deliberately; do not relax them just to accept an unexplained scale change. [Load a model](../../docs/recipes/load-a-model.md) covers animation and the runtime ownership contract.

## Automated consumer check

On POSIX shells, from the repository root:

```sh
GAME_DIR=tools/blender-export/game node scripts/generate.mjs
node node_modules/typescript/bin/tsc --noEmit -p tools/blender-export/tsconfig.json
node --import tsx scripts/lint/brief.ts tools/blender-export/game
npm run play:criteria -- --game tools/blender-export/game
GAME_DIR=tools/blender-export/game node -r ./scripts/silent-browser.cjs tools/blender-export/browser.mjs
```

PowerShell: set `$env:GAME_DIR="tools/blender-export/game"` before these commands and omit the leading `GAME_DIR=...`; remove it afterwards with `Remove-Item Env:GAME_DIR`. The default repository lints discover templates and root `game/`, not this tools consumer. The scoped brief command above validates this consumer's brief and its `GAME.md` explicitly.

The browser helper uses the existing isolated/muted browser selection, including `ENGINE_CHROMIUM` if set. Reports and screenshots go to `playtest/blender-export/`. CI runs this scoped typecheck, brief validation and browser diagnostic through `npm run test:blender-export-browser`. The asset tests also run in the existing `npm test` tools glob.

See [recorded evidence](../../docs/verification/blender-export-20261003.md). Automated software-GL evidence does not certify physical devices, Blender UI/MCP operation, animations, texture colour management or production artwork quality.
