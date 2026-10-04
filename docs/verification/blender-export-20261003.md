# Blender export consumer — 2026-10-03

## Current state

- **Asset:** checked-in `metre-block.glb`, 2,232 bytes, SHA-256 `fcc71461…823cb`, decoded semantic SHA-256 `2b74ca47…0dd901`, exported by Blender 5.2.1 LTS. Unchanged since the first export.
- **Validator:** `tools/blender-export/verify.mjs` checks provenance hashes, embedded data, size, bounds and pivot, and rejects node transforms, extra material or PBR properties, a top face not using `top-gold`, off-corner vertices and any decoded change from the pinned semantic hash. `node --test tools/blender-export/verify.test.mjs` passes **15/15** on Node 22; the ten newest cases each fail against the previous validator.
- **Browser consumer:** the last local `npm run test:blender-export-browser` pass is recorded below for source `4ff2058` (diagnostic and scene unchanged since). The validator hardening did not change the browser diagnostic, scene or asset and was not rerun in a browser locally; hosted CI repeats the step.
- **Model contract (later change):** the sample's rules now live in `metre-block.contract.json` and run through the general `scripts/asset-verify.mjs`; `verify.mjs` wraps it and still pins the semantic hash. `export.py` now also writes `tool` and `generator` to the receipt, so its source SHA-256 changed to `8e51250a…0bec45d`; a fresh Blender 5.2.1 export reproduced the GLB byte for byte (`fcc71461…823cb`). The 15 tests still pass unchanged. See [asset contracts](asset-contracts-20261003.md).
- **Not verified:** physical devices, cross-version Blender exports, textured/animated art, Blender UI or MCP workflows, and full template gates.

Commit references below that are not on public `main` (`93979e3`, `470fa74`, `5a1c232`, `4ff2058`) are commits on this pull request's branch; they stay reachable from public history only if it is merge-committed. Source SHA-256 values are the durable references. Earlier work on an unpublished local integration candidate is summarized, not cited by commit. The sections below are the chronological record.

## Scope

Original sample and tools were first added on an unpublished local integration candidate, then isolated onto public `main` (see the standalone section below). The reference environment is Linux x86-64, Blender 5.2.1 LTS (`9e2066aef7ef`), Node 26.8.1, npm 12.0.2, and the repository's existing isolated, muted Chromium runner with default software GL at 1280×800. This is an explicit sample workflow, not a new engine API or a Blender/MCP installation.

The GPL-3.0-only original asset has no external artwork or textures. `tools/blender-export/export.py` generates mesh coordinates, two PBR materials and provenance; the existing `defineAsset` / `Model` path owns runtime loading and rendering. The sample deliberately omits animation; the existing mechanics beacon and model recipe remain the animation examples.

## Export and repeatability

Two independent `blender --background --factory-startup --python tools/blender-export/export.py -- --output <path>.glb` processes completed successfully. Neither loaded an existing user project or opened a GUI. One output is the checked-in sample, and the other was a scratch file. `node tools/blender-export/verify.mjs <first>.glb <second>.glb` passed:

| Property | Observed result |
| --- | --- |
| Bytes | 2,232 each |
| SHA-256 | `fcc71461117220b6ac0f5452d00beabb5b419ba1eeb3c09f5d0ea956d18823cb` for both |
| Decoded semantic SHA-256 | `2b74ca47d75e1fde93ab35ad467f0e20374902b116c32b72ab29143fd00dd901` for both |
| Geometry | 12 triangles, 2 material primitives |
| Materials | 2 opaque rough nonmetallic PBR colours |
| Textures | 0; no external buffers/images |
| World bounds | `[-0.5, 0, -0.5]` to `[0.5, 1, 0.5]` |
| Pivot | Base centre, world origin `[0, 0, 0]` |

Blender printed an unused MeshOptimizer-library warning and a `Material.use_nodes` future-deprecation warning. The sample requests neither mesh compression nor Blender 6 behavior; both exports finished and passed decoded validation. This does not establish portability to other Blender versions. Semantic comparison currently covers this static sample's decoded geometry, transforms and material values, not arbitrary animation or texture equivalence.

## Verification performed

- `node --test tools/blender-export/verify.test.mjs`: **4/4 pass**, no skips. Covers the real sample plus mismatched artifact hash, an external buffer even with a matching hash, and shifted geometry even with a matching hash. The last two establish that a matching provenance receipt alone cannot satisfy the physical asset contract.
- `GAME_DIR=tools/blender-export/game node scripts/generate.mjs`, followed by `node node_modules/typescript/bin/tsc --noEmit -p tools/blender-export/tsconfig.json`: pass.
- Layer, genericity and architecture lints: pass. The layer command's default scope does not include this tools consumer; its public imports were also inspected and its own TypeScript configuration checked.
- `GAME_DIR=tools/blender-export/game node -r ./scripts/silent-browser.cjs tools/blender-export/browser.mjs` with the existing Chromium executable selected: pass. The stock loader fetched `/models/metre-block.glb` once with HTTP 200; scene status reached `ready`; a real Space press changed turn count 0→1 and Transform rotation readback 0→π/2. No console or page errors.
- Inspected the actual rendered screenshot: blue sides, gold top, block resting on the floor with the expected base pivot and framing. A quarter-turn of this symmetric object is visually indistinguishable at rest; the rotation assertion is separate evidence, not a visual distinction claim.

The browser script emits `playtest/blender-export/report.json`, `loaded.png` and `turned.png` for review. These generated artifacts remain outside Git. All browser, server and Blender processes from this verification were closed. No public write, deployment or shared dependency directory mutation occurred.

## Remaining limits

No full CI/template gate, physical device, production/subpath build of this specific consumer, artist-authored textured model, animation/rig, Blender interactive workflow, MCP tool or cross-version exporter compatibility was tested. A bounded static sample is the completed slice; these are distinct potential future acceptance cases. The verifier is sample-specific and not an arbitrary untrusted asset security checker.

Reproduction, ownership and constraints: [Blender export example](../../tools/blender-export/README.md). The broader onboarding subpath receipt covers its separate arcade consumer; it does not silently extend this asset's evidence.

## Independent review correction

Review of an earlier unpublished revision found that the original bounds check used Three's default cached geometry bounds, which GLTFLoader can derive from accessor metadata. It therefore did not independently establish the decoded-vertex bounds claimed above. The validator now requests precise world-space bounds from actual vertices. A regression mutates a binary vertex to x=9, retains the accessor min/max and updates the provenance hash; it reproduces the old false acceptance and is rejected after the fix. Original sample bounds and both export hashes remain unchanged.

The browser diagnostic now uses the existing `diagnosticReport` owner: a browser-close exception cannot skip server cleanup or report writing, and any scenario/cleanup failure clears a previous pass. Test fixture URLs use `fileURLToPath` for paths containing escaped characters and Windows drive conventions.

`node --test tools/blender-export/verify.test.mjs scripts/play/diagnostic-report.test.mjs` passes **9/9** (five asset tests and four existing cleanup-owner tests). The new decoded-position regression was separately run against the old non-precise expression and failed with the expected missing rejection, then passed with the corrected expression. This supersedes the original four-test-only count and the stronger original decoded-bound claim.

The consumer browser command was rerun on the corrected (unpublished) candidate source: PASS, no scenario or cleanup failures, model ready, exactly one HTTP-200 model response and rotation 0→π/2. Browser and server closed normally. This is the final source-level browser evidence; the subsequent receipt-only commit does not change the diagnostic.

## Standalone public-main branch validation

This example was isolated onto public `origin/main` at `2fb6e6918e1a5e647260854daa4c8f4b871e1b47`, independently confirmed against the remote head. Only the three asset commits were transplanted; the sole conflict was resolved by adding only the asset diagnostic's ignore entry. No broader candidate changes or new runtime dependencies were included.

At standalone source head `93979e3a4f13ea17075b4eb3b35e514633fd8023`, own-checkout `npm ci --no-audit --no-fund`, the nine focused tests, the sample GLB validator, scoped consumer TypeScript check and all repository lints passed. The browser command above was then run on that head: PASS, `failures: []`, one successful model response, ready state and actual rotation readback 0→π/2. Its screenshot was inspected: blue block, gold top and base resting on the floor. Browser and server closed normally. This establishes consumer compatibility with this public-main base, superseding the earlier candidate-only runtime boundary; it is still not complete CI or physical-device acceptance.

Validated source hashes (SHA-256):

- Browser diagnostic: `1c028b849042410d9a16d017d53a9c38d337875b71c53b54ac0207cfd7fe2816`.
- Consumer scene: `430c11fafc04446207095d6d70594496f490918da09b8fa749eb2e77f612df44`.
- Model: `fcc71461117220b6ac0f5452d00beabb5b419ba1eeb3c09f5d0ea956d18823cb`.

The following receipt-only commit does not change those sources. No remote write was performed during this validation.

## Interactive-entry and brief review correction

Subsequent independent review found two gaps that the direct browser helper did not cover: the documented `npm run play -- --game tools/blender-export/game` entry needed a missing `budgets.json`, and S1's `by` path did not resolve to a named criterion test. Added the budget document and matching `GAME.md`; S1 now points to `verify.test.mjs` relative to the consumer root and selects its actual `S1` test. The initial browser state now explicitly requires zero turns and rotation before pressing Space.

The draw/triangle caps follow this fixture's geometry: two material primitives plus one floor draw; twelve model triangles plus two floor triangles. The 1024 KiB first-load and 64 MiB heap caps are the stock desktop brief defaults, not new measured performance claims. Texture allocation from this sample is zero. No existing template cap was changed. The browser diagnostic now forces real redraws and checks the scene's draw/triangle limits; first-load bytes, heap and other gate dimensions remain separate acceptance.

Node 22.23.3 checks pass: **15/15** focused asset/cleanup/CI-parser tests; explicit `scripts/lint/brief.ts tools/blender-export/game`; and `npm run play:criteria -- --game tools/blender-export/game` executes exactly one S1 test and reports PASS. The actual documented `npm run play` entry was started on an ephemeral loopback port, printed its `#scene/main` URL, and its owned process group was stopped. A first capture attempt timed out because its Python text reader buffered output; a binary-pipe capture then verified the printed URL. This was a harness observation, not a game startup failure.

Default repository lints alone do not discover this tools consumer. The new `test:blender-export-browser` npm/CI step explicitly runs its TypeScript check, brief validation and browser consumer. Required CI is now wired for this slice; a full remote CI result is still pending.

The complete new npm/CI command passed on Node 22.23.3 at clean source `5a1c232fae239f79d5b069e0c299cad89a40e744`. Consumer typecheck and scoped brief lint passed; the browser recorded zero→one turns, zero→π/2 rotation, one HTTP-200 model response and no scenario/cleanup failures. Across three requested redraws it measured exactly **3 draws and 14 triangles per rendered frame**, matching the structural limits. The screenshot was inspected again. Browser diagnostic SHA-256: `d9492d94bc54262392331c8d02441711489026020d1b65ace044629eb313d495`.

The first new count-window attempt at `470fa74` omitted the existing GL probe injection, so fallback counters incorrectly read zero despite rendered frames. That count evidence was rejected. The corrected command injects the shared probe before navigation and asserts the exact expected positive counts, preventing absent instrumentation from passing. No production code or quality setting changed. The measured dev heap and short frame sample are informational, not first-load, sustained-performance or physical-device acceptance. All test browser/server processes closed.

Final review moved page/console error evaluation after both browser and server cleanup attempts, before the terminal report is written. An error delivered during close can no longer retain a passing result. The nine asset/cleanup tests pass on Node 22.23.3 after this source correction; a new browser run is pending, so the preceding browser receipt remains scoped to `5a1c232`.

The pending rerun above is now complete: the full `npm run test:blender-export-browser` command passes on exact source `4ff205885f4ec3dc5416e402e04993141837b990` with Node 22.23.3. Typecheck and scoped brief lint pass; zero→one turn and zero→π/2 rotation, one model response, three rendered frames at exactly 3 draws/14 triangles, `errors: []` and `failures: []` after cleanup. Browser and server are closed. Subsequent edits update only this receipt.

## Validator hardening review correction

Review found that the validator still accepted rehashed edits that kept the bounds: identity node transforms, swapped primitive materials, extra material properties and an interior vertex moved inside the bounds. `verify.mjs` now rejects node `translation`/`rotation`/`scale`/`matrix`, requires each material to carry exactly the exported keys (`doubleSided: true`, `name`, `pbrMetallicRoughness` with only `baseColorFactor` and `metallicFactor: 0`), requires exactly one primitive lying wholly at y=1 and using `top-gold` with two triangles, requires every vertex to be a box corner, and pins the decoded semantic SHA-256 `2b74ca47d75e1fde93ab35ad467f0e20374902b116c32b72ab29143fd00dd901`.

Ten new negative tests each mutate a copy of the GLB and recompute its provenance hash: four identity node transforms, swapped materials, an emissive factor, `doubleSided: false`, an explicit default `roughnessFactor`, an interior vertex at x=0.25 and a changed normal that passes every structural rule. With the previous `verify.mjs` all ten mutations were accepted (each test failed even with the error-message match removed); with the fix all 15 tests pass on Node 22. The checked-in GLB still validates; asset, provenance, browser diagnostic and scene are unchanged. No browser was run for this correction.

