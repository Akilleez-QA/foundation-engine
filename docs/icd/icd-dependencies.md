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
2020-12 `inputSchema` and `outputSchema` per tool. The stdio bridge is implemented
by `python3 -B tools/foundation_engine_bridge.py`; run `npm ci` first.

| Tool | Existing TypeScript owner | Input mapping | Successful output |
|---|---|---|---|
| `validate_render_mask` | `src/author/render-mask.ts`, exported by `@engine` | `{mask}` → `validateRenderMask(mask)`; required unsigned 32-bit integer | The same integer. |
| `validate_scene_output` | `src/author/scene-output.ts`, exported by `@engine` | `{output?}` → `validateSceneOutput(output)`; omitted output uses defaults | `{toneMapping, exposure}` with defaults `none`, `1`. |

All input objects reject unknown keys. Exposure is in `(0,16]`; tone mapping is
`none`, `aces`, `agx` or `neutral`. The wire subset excludes JavaScript `undefined`
and nullable property defaults even where the existing validator accepts them.
Validators are synchronous, allocate no retained state and throw on invalid values;
they neither render nor modify scenes, files, saves, input, clocks or settings.
The bridge mirrors Foundation Refrigeration at `4bd3311b31766c00083c582a8c4f99467501df7f`:
UTF-8 JSON-RPC 2.0, one newline-terminated request/response per frame, no batches.
Initialize with `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"foundation-engine-jsonrpc/1"}}`.
`tools/list` describes the pinned inventory; `tools/call` takes exactly `{name, arguments}`.
`ping` is available before initialization. Notifications produce no response.
Successful calls return `{isError:false, structuredContent:<schema output>}`.
Errors use `{jsonrpc:"2.0",id,error:{code,message}}`: -32700 malformed JSON,
-32600 envelope, -32601 method, -32602 arguments/unknown tool, -32603 internal,
-32000 initialization state, -32001 protocol mismatch, -32002 resource bound.
Handshake limits mirror the sibling: 65,536 input bytes, 1,048,576 output bytes,
32 JSON depth, 4,096 nodes, 1,024 string characters, 24 decimal characters,
128 ID characters, safe-integer IDs. Exponents, duplicate keys and nonfinite numbers
are rejected. Oversized or unterminated frames close with exit 2; other errors
allow another request. Execution is sequential; close stdin to stop, no cancellation.
Schema validation precedes native TypeScript execution in a fixed Node subprocess
with a ten-second timeout; failure returns an internal error without child output.
The schema checker supports only the keywords used by this pinned inventory;
future schema vocabulary changes require coordinated checker changes. This is not MCP.
