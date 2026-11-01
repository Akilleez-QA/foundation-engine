# Interface control: external dependencies and consumers

Foundation Engine has no runtime interface to another Akilleez-QA repository.
Cstack, POODO, Endoforge and the other Foundations do not import it, and it imports none of them.
This document records the interfaces it does have and where each pin lives.

## Interfaces

| Counterpart | Direction | Interface | Pinned version | Pin source |
|---|---|---|---|---|
| three.js (`three`) | Engine uses | ES module import for rendering | 0.186.1 (range `^0.186.1`) | `package.json`, `package-lock.json` |
| Wasmoon (`wasmoon`) | Engine uses | Lua runtime in WebAssembly | 1.16.0 | `package.json`, `package-lock.json` |
| Node.js | Tooling runs on | `npm` scripts, `node --test`, `tsx` | `>=22.18`, development line 22 | `package.json` `engines`, `.node-version` |
| Python 3 | Tooling uses | Source manifest generation and drift checking, standard library only | Runner-provided interpreter | `tools/build_manifest.py`, `.github/workflows/manifest.yml` |
| Games and templates | Consume engine | Author API (`defineGame`, kits) selected by `GAME_DIR` or `--game` | Source checkout at a commit or tag | `git rev-parse HEAD`, release tags |
| Browsers | Run built games | Built output from `vite build` | Evidence per browser run | [Acceptance ledger](../guides/upgrade-acceptance-ledger.md) |

## Change control

A change to any pin above goes through `package-lock.json` and `npm ci`, and is listed in [CHANGELOG.md](../../CHANGELOG.md).
Configuration rules are in [configuration management](../configuration/configuration-management.md).

## Not included

- No interface to Cstack ports or adapters.
- No npm publication; `package.json` sets `private: true`.

## Read-only tool contract, version 0.2.0

`schemas/read-only-tools.json` pins `foundation-engine-tools/1`, with Draft
2020-12 `inputSchema` and `outputSchema` per tool. These are static definitions;
no bridge, endpoint, dispatcher or transport error envelope is implemented.

| Tool | Existing TypeScript owner | Input mapping | Successful output |
|---|---|---|---|
| `validate_render_mask` | `src/author/render-mask.ts`, exported by `@engine` | `{mask}` → `validateRenderMask(mask)`; required unsigned 32-bit integer | The same integer. |
| `validate_scene_output` | `src/author/scene-output.ts`, exported by `@engine` | `{output?}` → `validateSceneOutput(output)`; omitted output uses defaults | `{toneMapping, exposure}` with defaults `none`, `1`. |

All input objects reject unknown keys. Exposure is in `(0,16]`; tone mapping is
`none`, `aces`, `agx` or `neutral`. The wire subset excludes JavaScript `undefined`
and nullable property defaults even where the existing validator accepts them.
Validators are synchronous, allocate no retained state and throw on invalid values;
they neither render nor modify scenes, files, saves, input, clocks or settings.
A future bridge must validate inputs before invocation and specify bounded messages,
error receipts, cancellation and recovery. It is planned for the next change.
