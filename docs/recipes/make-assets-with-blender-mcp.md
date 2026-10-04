# Recipe: make assets with Blender through MCP

An agent can build a model in a running Blender through the official [Blender Lab MCP server](https://www.blender.org/lab/mcp-server/), look at it, and adjust it with you. That session is interactive and cannot be replayed exactly, so the thing you commit is a **script**: an `export.py` that rebuilds the model from nothing in headless Blender. A [model contract](../guides/model-contracts.md) then checks the result against the size and budget you set before work started.

MCP is optional. The engine, the templates, `npm run check` and CI never start a Blender or an MCP server. Without MCP, you or the agent write `export.py` by hand and the steps from 3 onwards are the same. The [Blender export example](../../tools/blender-export/README.md) and its lantern were made that way.

## 0. Opt in, per user

Registering the server is **your** decision, made for your account on your machine. The repository ships only [`.mcp.json.example`](../../.mcp.json.example); `.mcp.json` is gitignored. Why the repository does not register it for you:

- **It runs arbitrary code.** The server's `execute_blender_code` tool runs any Python the agent writes inside your Blender, with your account's file and network access. Blender Lab's own documentation warns that it runs model-written code "without any guards", and recommends a VM or a machine without sensitive data. Its add-on listens on `localhost:9876` without authentication.
- **It starts without asking in non-interactive sessions.** Interactive Claude Code asks before it starts a server listed in a project's `.mcp.json`. `claude -p`, the Agent SDK and cloud sessions start those servers **without prompting**. A committed `.mcp.json` would therefore start third-party code for every contributor's automation, and a pull request could change the command it runs.
- **The package name is a trap.** The official server is not on PyPI. `uvx blender-mcp` installs a different, community server, which sends telemetry by default.

Review the source yourself before you install anything. Then follow the server's [setup instructions](https://projects.blender.org/lab/blender_mcp), using a pinned release (the research for this recipe used v1.0.3; Blender 5.1 or newer is required). To register the server at user scope, so that it never enters a repository:

```sh
claude mcp add --scope user \
  -e BLENDER_PATH=/usr/bin/blender -e BLENDER_MCP_HOST=localhost -e BLENDER_MCP_PORT=9876 \
  blender -- uv --directory <your clone>/mcp run blender-mcp
claude mcp list                      # check
claude mcp remove blender -s user    # undo
```

If you prefer a project-local file for your own checkout, copy `.mcp.json.example` to `.mcp.json`, set `BLENDER_MCP_DIR` to your reviewed clone, and keep it out of commits. It is gitignored for that reason.

**Gotcha: `--online-mode`.** The official add-on will not open its socket unless Blender's *Allow Online Access* is on, and the only sign is a small red label in the add-on panel. Start Blender with `blender --online-mode` for the sessions where the agent drives it, rather than turning the preference on permanently. Work in a scratch `.blend`, and save your own work first.

## 1. Set size, pivot and budgets first

Before any modelling, agree what the model is for and write its contract next to where the GLB will go, `game/public/models/<name>.contract.json`:

- which success criterion in the brief it serves;
- its real-world size in metres, as a range (`size`) or exact bounds (`bounds`);
- its pivot: `base-centre` for things that stand on the ground, `centre` for things that float or spin;
- its triangle, vertex, material and texture limits, its largest texture size, and maximum file and texture bytes. Derive them from the scene's budget row (`budgets.json`), the brief's weakest device and the other things in that scene, not from the model you hope to get;
- named nodes a system will look up (attachment points, parts) and animation clips, if any;
- the material properties the exporter may write, and the licences you accept.

The [model contracts guide](../guides/model-contracts.md) lists every key. The lantern's contract, [`lantern.contract.json`](../../tools/blender-export/game/public/models/lantern.contract.json), is a small example.

## 2. Build and inspect through MCP

With the server registered and Blender started with `--online-mode`, ask the agent to build the model. **Build it at the target polycount from the start.** Take the triangle budget from step 1 and model to it: primitives with few segments, bevels only where the silhouette needs them. The same applies to AI generators: ask for the target count (a low-poly or quad tier) instead of decimating a dense mesh afterwards. Decimation is a last resort, and `asset:optimize` never does it. **Use quads for anything that will be rigged or deform**, so the edge loops bend cleanly. **Use triangles freely for static props.** The GLB stores triangles either way; this is about the topology you author.

The [blender-asset skill](../../.claude/skills/blender-asset/SKILL.md) is the agent's checklist for this step: plan the parts and their contacts, use one rebuild-from-scratch script, measure after every change, and know the Blender 5.x API changes. Useful habits:

- It writes geometry and materials with `execute_blender_code`, and looks up the Blender API with the server's offline documentation search instead of guessing it.
- It looks after **every** change, with `get_screenshot_of_area_as_image` or `render_thumbnail_to_path`, and reads sizes with `get_object_detail_summary`. An agent that chains several blind operations drifts. Look at the screenshots yourself too.
- Work in metres, with the origin where the contract's pivot says. Use Principled BSDF materials only, and apply or avoid object transforms and modifiers so the coordinates live in the mesh.
- Keep within the contract while you work. If the model cannot fit, change the model or talk to the creator. Do not change the contract quietly.

## 3. Write a reproducible `export.py` and run it headless

Turn the session into a script under the game's tools folder, `game/tools/<name>/export.py`. It builds the model from nothing (or loads a `.blend` you commit next to it), exports a GLB and writes the receipt. Copy the shape of [the lantern's script](../../tools/blender-export/game/tools/lantern/export.py):

- clear the factory scene, build the mesh with `bmesh`, and append Principled BSDF materials;
- export with `bpy.ops.export_scene.gltf(export_format='GLB', use_selection=True, export_yup=True, export_apply=False, export_animations=False, export_cameras=False, export_lights=False)`;
- write `<name>.provenance.json` with `licence`, `author`, `source` (the script's repository path), `sourceSha256`, `tool` (`f'Blender {bpy.app.version_string}'`), `generator` (the GLB's `asset.generator`) and `sha256`.

Run it in a fresh, headless Blender that loads no user settings or add-ons:

```sh
blender --background --factory-startup --python game/tools/<name>/export.py -- --output game/public/models/<name>.glb
```

`--factory-startup` makes the export independent of your Blender preferences and of the MCP add-on. Run it twice to a scratch path and compare: with the same Blender version, the lantern's exports were byte-identical.

## 4. Check it against the contract, then optimise

```sh
npm run asset:verify -- game/public/models/<name>.glb
```

The check re-imports the GLB the way the engine's model loader does, then compares it with the contract. A failure names the rule and the numbers, for example `212 triangles, over the contract's 200`. Fix the model and export again. Never raise a contract number just to make the check pass. `npm run check` runs the same check for every contracted GLB.

For a model with textures, or one large enough for compression to matter, export to `game/tools/<name>/out/<name>.glb` with its strict contract next to it. Then optimise into the public folder:

```sh
npm run asset:optimize -- game/tools/<name>/out/<name>.glb --out game/public/models/<name>.glb
```

The pass checks the export against its own contract before it starts. It then applies meshopt compression and turns textures into WebP at the contract's texture size, keeping named nodes, meshes and materials. It never decimates. Before writing anything, it checks the result against the contract next to `--out`. For a phone target, `--ktx2` writes KTX2 textures instead, which stay compressed on the GPU (the engine's model loader transcodes them; it needs KTX-Software's `ktx` 4.4 or later and `KHR_texture_basisu` in the contract). See [model contracts](../guides/model-contracts.md#optimise) for what an optimised model's contract allows. A small untextured prop such as the lantern does not need this step.

## 5. Put it in the game

The GLB is already in `game/public/models/`, so it is served as `/models/<name>.glb`. Declare it with the receipt's licence, author and source, and show it with a `Model`, as in [load a model](load-a-model.md):

```ts
// game/lantern.asset.ts
import { defineAsset } from '@engine';
export default defineAsset({
  id: 'lantern', type: 'model', url: '/models/lantern.glb',
  licence: 'GPL-3.0-only', author: 'Foundation Engine contributors',
  source: 'game/tools/lantern/export.py',
});
// In a scene's entities: [Name({ name: 'lantern' }), Transform(), Model({ asset: 'lantern' })]
```

## 6. Check and look against the budgets

```sh
npm run check
npm run play:snap -- --scene <scene>     # add --mobile when phones are targets
```

Look at the screenshots yourself first. Then compare the probe's draws and triangles with the scene's budget row. If it is over budget, recover in the [fix-budget](../../.claude/skills/fix-budget/SKILL.md) order (simplify, instance, bake, LOD) and measure again. Raise a budget only with the creator's agreement and a `Perf-Budget:` trailer.

## Licence and provenance

Every asset records its **true** licence, author and source, in three records: the receipt (`<name>.provenance.json`), its `defineAsset`, and, for anything not made in this repository, [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) or the game's own notices and credits. Use the licence the asset actually carries. Never use the game's licence for an asset that came from elsewhere. A receipt shows integrity; it is not proof of rights.

| Origin | Licence | What to do |
|---|---|---|
| Built in your session or script | Your choice; in this repository GPL-3.0-only | `author` is the creator. Note in the receipt that it was agent-assisted. Copyright in AI-assisted output varies by jurisdiction. |
| [Poly Haven](https://polyhaven.com) | CC0 | No credit is required, but record the asset's page URL as `source`, and credit Poly Haven as a courtesy. |
| [Sketchfab](https://sketchfab.com) | Varies per model: CC-BY, CC-BY-SA, CC-BY-NC, CC-BY-ND, CC0, and the store's Standard and Editorial licences | Read each model's licence. CC-BY needs credit where the asset appears; CC-BY-SA also passes its terms on. **Review NC (non-commercial), ND (no derivatives, so even converting or decimating it may be a problem) and Editorial (not for games) models before use, and do not commit them to a public repository without that review.** Store licences do not allow redistributing the source file. |
| [Poly Pizza](https://poly.pizza) | Mostly CC-BY, some CC0 | Copy the attribution exactly into `author`, the notices and the game's credits. |
| AI generators (Hyper3D Rodin, Hunyuan3D, Tripo and others) | The provider's terms and your plan decide | Read the terms before you generate. Your prompts and images go to the provider. Record the service, plan and date in the receipt's `tool`. Keep these services off by default, and never use them in a kid-safe game without the creator's agreement. |

A contract's `provenance.licences` can list only the licences the creator accepts, so `asset:verify` refuses anything else.

## Why not UE5 for now

Unreal Engine 5 is not recommended for this workflow at present:

- **Size and account.** The Linux editor is a download of roughly 25 GB (43 GB unpacked). It needs an Epic account and acceptance of the EULA, which the author must do personally.
- **Hardware.** Epic recommends 32 GB of RAM and 8 GB or more of VRAM on Linux. Epic targets Ubuntu and RHEL, and documents neither Wayland nor Hyprland.
- **Its MCP is experimental.** Epic's MCP is an experimental plugin, available only from 5.8. It has no authentication, and its documentation lists no asset-export tools. The community servers are stale, unlicensed, or default to cloud backends.
- **An extra hop.** UE glTF export maps materials only partly, and its output still needs the same glTF checks. Blender already writes browser-ready glTF directly, with a reproducible headless export.
- **Licence friction.** Epic sample content is covered by the UE EULA, and Fab assets carry per-asset terms. Neither can be relicensed in a public GPL repository without review.

Revisit this only if a creator requirement needs Unreal-specific authoring and the machine meets the VRAM guidance. Even then, keep the Unreal project and its `.mcp.json` outside this repository, and send its exports through the same contract and licence checks.

## Limits

- MCP sessions are not reproducible. Only the committed script and its receipt are evidence.
- `asset:verify` checks the numbers in the contract and the model loader's own caps. It does not check visual quality, colour space, animation contents beyond clip names and durations, or whether a licence claim is true ([model contracts](../guides/model-contracts.md#owner-bounds-and-limits)).
- The official server was not installed or run for this recipe, and no server is part of the gate or CI. The headless export and validation steps were run with Blender 5.2.1 LTS. Other Blender versions need their own check.
- Steps 5 and 6 were run in a scratch game made from the blank template. The lantern was declared with the snippet above and placed beside the cube. `npm run play:snap` showed it standing on the floor with its glowing chimney, with no page errors, 4 draws and 162 triangles. That is browser emulation with software GL, not a physical device.
