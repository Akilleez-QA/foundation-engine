# Blender export consumer — 2026-10-03

## Scope

Original sample and tools added on engine baseline `1be7ba7c7d61e11126d0f6959d68155b67a987fd`. The reference environment is Linux x86-64, Blender 5.2.1 LTS (`9e2066aef7ef`), Node 26.8.1, npm 12.0.2, and the repository's existing isolated, muted Chromium runner with default software GL at 1280×800. This is an explicit sample workflow, not a new engine API or a Blender/MCP installation.

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
