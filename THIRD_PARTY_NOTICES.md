# Third-party notices

Foundation Engine is licensed under **GPL-3.0-only**; see [LICENSE](LICENSE).
Third-party packages retain their own copyrights and licenses. The project license
does not replace those notices. The original generated diagnostic assets listed
below are separately dedicated under **CC0-1.0**.

This inventory was checked against `package-lock.json` and installed package
license files on 2026-10-02, and again for the Prettier addition and the model optimiser on 2026-10-03. It records pinned versions, not semver ranges.
Update it when the dependency graph or shipped assets change.

## Optional network reference host dependency

Added and checked on 2026-10-01: **ws 8.22.0**, MIT, used by the optional Node
reference host. It is not imported by ordinary player builds or the native browser
WebSocket adapter. [Pinned source](https://github.com/websockets/ws/tree/8.22.0).
Retain `node_modules/ws/LICENSE` when distributing the reference host with this
package. The installed license credits Einar Otto Stangvik (2011), Arnout Kazemier
and contributors (2013), and Luigi Pinca and contributors (2016). No optional native
WebSocket acceleration package is required by this integration.

## Brand asset generator dependency

Added and checked on 2026-10-03: **@resvg/resvg-js 2.6.2**, MPL-2.0, a development
dependency used only by `scripts/brand/build.mjs` to render the brand PNGs from
their SVG sources. It is not imported by the engine, templates or player builds.
[Pinned source](https://github.com/thx/resvg-js/tree/v2.6.2). MPL-2.0 is compatible
with GPL-3.0-only use here; the rendered images carry no license from the tool.
The brand assets themselves are original work listed in [docs/brand.md](docs/brand.md).

## Code formatter dependency

Added and checked on 2026-10-03: **prettier 3.9.9**, MIT, an exact-pinned
development dependency used only by `npm run format`, `npm run format:check`,
`npm run check` and the after-edit hook to format the project's own source. It is
not imported by the engine, templates or player builds and emits no code into them.
[Pinned source](https://github.com/prettier/prettier/tree/3.9.9). It has no
dependencies of its own in the lockfile; its bundled third-party code is credited in
the installed `node_modules/prettier/LICENSE`, which begins "Copyright © James Long
and contributors".

## Model optimiser dependency

Added and checked on 2026-10-03: **@gltf-transform/cli 4.5.1**, MIT, an exact-pinned
development dependency used only by `npm run asset:optimize` (`scripts/asset-optimize.mjs`) to
compress a game's own models with meshopt and re-encode their textures. It is not imported by the engine,
templates or player builds. [Pinned source](https://github.com/donmccurdy/glTF-Transform/tree/v4.5.1).
It brings 199 lockfile entries, listed in the inventory below, including **sharp 0.35** (Apache-2.0) and its
prebuilt **libvips** binaries (`@img/sharp-libvips-*`, LGPL-3.0-or-later; `@img/sharp-win32-*` and
`@img/sharp-wasm32` combine Apache-2.0, LGPL-3.0-or-later and MIT), **meshoptimizer** (MIT),
**draco3dgltf** (Apache-2.0, installed but never selected: the pass refuses Draco), **gltf-validator** (Apache-2.0)
and five BlueOak-1.0.0 utilities. LGPL-3.0-or-later is compatible with GPL-3.0-only use; these binaries are
run on the developer's machine and are not distributed in player builds. KTX2 output additionally needs the
external `ktx` command from KTX-Software 4.4 or later, which is not a package dependency and is not installed by
`npm ci`. `npm audit` reports a high-severity advisory (GHSA-vfj7-8cjw-p6xm, stack exhaustion from deeply
nested brace patterns) in `braces` through `micromatch`, with no patched version; the pass passes no
user-controlled glob patterns to it, and the dependency is development-only.

## Code distributed in browser builds

- **three 0.186.1**, MIT, Copyright © 2010–2026 three.js authors.
  [Source](https://github.com/mrdoob/three.js/tree/r186).
  This includes the GLTFLoader and SkeletonUtils addons. The build uses the
  package's source-module entry for consistent module identity and tree shaking.
- **meshoptimizer decoder 1.1**, MIT, Copyright (C) 2016–2026 Arseny Kapoulkine.
  The runtime decoder is vendored in three at
  `examples/jsm/libs/meshopt_decoder.module.js`, including its embedded WASM.
  Its header identifies meshoptimizer 1.1. This is distinct from the 1.1.1
  development dependency in the lockfile.
  [Source](https://github.com/zeux/meshoptimizer).
- Vite can generate browser preload helpers, and its Rolldown bundler (Vite 8)
  emits small module-namespace runtime helpers into browser chunks. Keep the
  relevant Vite and Rolldown (MIT) notices when redistributing those helpers;
  Vite's installed `LICENSE.md` and Rolldown's `THIRD-PARTY-LICENSE` also contain
  bundled dependency notices. Lightning CSS minifies the project's own CSS at
  build time; no Lightning CSS code is emitted. Do not infer browser-bundle
  contents from `devDependency` classification alone.

The runtime uses one engine-owned model loader and does not register a Draco
loader. A release with additional decoders or asset providers must extend this
inventory. Preserve the following two MIT notices in distributed browser builds
that contain these libraries (including lazily loaded chunks).

### three license

```text
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### meshoptimizer license

```text
MIT License

Copyright (c) 2016-2026 Arseny Kapoulkine

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Locked dependency inventory

The lockfile contains 294 dependency entries. Its declared licenses are 216 MIT,
25 MPL-2.0 (Lightning CSS, resvg-js and their platform binaries), 19 Apache-2.0, 11 ISC,
10 LGPL-3.0-or-later and four combined Apache-2.0/LGPL-3.0-or-later (sharp's prebuilt libvips binaries),
five BlueOak-1.0.0, two BSD-3-Clause, one BSD-2-Clause and one 0BSD. These include transitive tools,
types, and optional platform binaries; the table is not a statement that all
packages ship in a browser build. The original 2026-09-30 audit installed 29 packages on its
host; the separately documented network-host addition followed on 2026-10-01, and the model optimiser's 199 entries
on 2026-10-03. Optional binaries for other operating systems were inspected through
lockfile metadata only.

| Package | Pinned version | Declared license | Installation condition |
|---|---|---|---|
| `@colors/colors` | 1.5.0 | MIT | Required by dependency graph |
| `@colors/colors` | 1.6.0 | MIT | Required by dependency graph |
| `@dabh/diagnostics` | 2.0.9 | MIT | Required by dependency graph |
| `@dimforge/rapier3d-compat` | 0.12.0 | Apache-2.0 | Required by dependency graph |
| `@donmccurdy/caporal` | 0.0.10 | MIT | Required by dependency graph |
| `@emnapi/runtime` | 1.11.3 | MIT | Optional |
| `@esbuild/aix-ppc64` | 0.28.2 | MIT | Optional |
| `@esbuild/android-arm` | 0.28.2 | MIT | Optional |
| `@esbuild/android-arm64` | 0.28.2 | MIT | Optional |
| `@esbuild/android-x64` | 0.28.2 | MIT | Optional |
| `@esbuild/darwin-arm64` | 0.28.2 | MIT | Optional |
| `@esbuild/darwin-x64` | 0.28.2 | MIT | Optional |
| `@esbuild/freebsd-arm64` | 0.28.2 | MIT | Optional |
| `@esbuild/freebsd-x64` | 0.28.2 | MIT | Optional |
| `@esbuild/linux-arm` | 0.28.2 | MIT | Optional |
| `@esbuild/linux-arm64` | 0.28.2 | MIT | Optional |
| `@esbuild/linux-ia32` | 0.28.2 | MIT | Optional |
| `@esbuild/linux-loong64` | 0.28.2 | MIT | Optional |
| `@esbuild/linux-mips64el` | 0.28.2 | MIT | Optional |
| `@esbuild/linux-ppc64` | 0.28.2 | MIT | Optional |
| `@esbuild/linux-riscv64` | 0.28.2 | MIT | Optional |
| `@esbuild/linux-s390x` | 0.28.2 | MIT | Optional |
| `@esbuild/linux-x64` | 0.28.2 | MIT | Optional |
| `@esbuild/netbsd-arm64` | 0.28.2 | MIT | Optional |
| `@esbuild/netbsd-x64` | 0.28.2 | MIT | Optional |
| `@esbuild/openbsd-arm64` | 0.28.2 | MIT | Optional |
| `@esbuild/openbsd-x64` | 0.28.2 | MIT | Optional |
| `@esbuild/openharmony-arm64` | 0.28.2 | MIT | Optional |
| `@esbuild/sunos-x64` | 0.28.2 | MIT | Optional |
| `@esbuild/win32-arm64` | 0.28.2 | MIT | Optional |
| `@esbuild/win32-ia32` | 0.28.2 | MIT | Optional |
| `@esbuild/win32-x64` | 0.28.2 | MIT | Optional |
| `@gltf-transform/cli` | 4.5.1 | MIT | Development only: model optimiser |
| `@gltf-transform/core` | 4.5.1 | MIT | Required by dependency graph |
| `@gltf-transform/extensions` | 4.5.1 | MIT | Required by dependency graph |
| `@gltf-transform/functions` | 4.5.1 | MIT | Required by dependency graph |
| `@img/colour` | 1.1.0 | MIT | Required by dependency graph |
| `@img/sharp-darwin-arm64` | 0.35.5 | Apache-2.0 | Optional |
| `@img/sharp-darwin-x64` | 0.35.5 | Apache-2.0 | Optional |
| `@img/sharp-freebsd-wasm32` | 0.35.5 | Apache-2.0 | Optional |
| `@img/sharp-libvips-darwin-arm64` | 1.3.4 | LGPL-3.0-or-later | Optional |
| `@img/sharp-libvips-darwin-x64` | 1.3.4 | LGPL-3.0-or-later | Optional |
| `@img/sharp-libvips-linux-arm` | 1.3.4 | LGPL-3.0-or-later | Optional |
| `@img/sharp-libvips-linux-arm64` | 1.3.4 | LGPL-3.0-or-later | Optional |
| `@img/sharp-libvips-linux-ppc64` | 1.3.4 | LGPL-3.0-or-later | Optional |
| `@img/sharp-libvips-linux-riscv64` | 1.3.4 | LGPL-3.0-or-later | Optional |
| `@img/sharp-libvips-linux-s390x` | 1.3.4 | LGPL-3.0-or-later | Optional |
| `@img/sharp-libvips-linux-x64` | 1.3.4 | LGPL-3.0-or-later | Optional |
| `@img/sharp-libvips-linuxmusl-arm64` | 1.3.4 | LGPL-3.0-or-later | Optional |
| `@img/sharp-libvips-linuxmusl-x64` | 1.3.4 | LGPL-3.0-or-later | Optional |
| `@img/sharp-linux-arm` | 0.35.5 | Apache-2.0 | Optional |
| `@img/sharp-linux-arm64` | 0.35.5 | Apache-2.0 | Optional |
| `@img/sharp-linux-ppc64` | 0.35.5 | Apache-2.0 | Optional |
| `@img/sharp-linux-riscv64` | 0.35.5 | Apache-2.0 | Optional |
| `@img/sharp-linux-s390x` | 0.35.5 | Apache-2.0 | Optional |
| `@img/sharp-linux-x64` | 0.35.5 | Apache-2.0 | Optional |
| `@img/sharp-linuxmusl-arm64` | 0.35.5 | Apache-2.0 | Optional |
| `@img/sharp-linuxmusl-x64` | 0.35.5 | Apache-2.0 | Optional |
| `@img/sharp-wasm32` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | Optional |
| `@img/sharp-webcontainers-wasm32` | 0.35.5 | Apache-2.0 | Optional |
| `@img/sharp-win32-arm64` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | Optional |
| `@img/sharp-win32-ia32` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | Optional |
| `@img/sharp-win32-x64` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | Optional |
| `@isaacs/cliui` | 8.0.2 | ISC | Required by dependency graph |
| `@oxc-project/types` | 0.152.0 | MIT | Required by dependency graph |
| `@pkgjs/parseargs` | 0.11.0 | MIT | Optional |
| `@rolldown/binding-android-arm-eabi` | 1.2.12 | MIT | Optional |
| `@rolldown/binding-android-arm64` | 1.2.12 | MIT | Optional |
| `@rolldown/binding-darwin-arm64` | 1.2.12 | MIT | Optional |
| `@rolldown/binding-darwin-x64` | 1.2.12 | MIT | Optional |
| `@rolldown/binding-freebsd-x64` | 1.2.12 | MIT | Optional |
| `@rolldown/binding-linux-arm-gnueabihf` | 1.2.12 | MIT | Optional |
| `@rolldown/binding-linux-arm64-gnu` | 1.2.12 | MIT | Optional |
| `@rolldown/binding-linux-arm64-musl` | 1.2.12 | MIT | Optional |
| `@rolldown/binding-linux-ppc64-gnu` | 1.2.12 | MIT | Optional |
| `@rolldown/binding-linux-s390x-gnu` | 1.2.12 | MIT | Optional |
| `@rolldown/binding-linux-x64-gnu` | 1.2.12 | MIT | Optional |
| `@rolldown/binding-linux-x64-musl` | 1.2.12 | MIT | Optional |
| `@rolldown/binding-openharmony-arm64` | 1.2.12 | MIT | Optional |
| `@rolldown/binding-win32-arm64-msvc` | 1.2.12 | MIT | Optional |
| `@rolldown/binding-win32-x64-msvc` | 1.2.12 | MIT | Optional |
| `@rolldown/pluginutils` | 1.0.1 | MIT | Required by dependency graph |
| `@resvg/resvg-js` | 2.6.2 | MPL-2.0 | Development only: brand asset generator |
| `@resvg/resvg-js-android-arm-eabi` | 2.6.2 | MPL-2.0 | Optional |
| `@resvg/resvg-js-android-arm64` | 2.6.2 | MPL-2.0 | Optional |
| `@resvg/resvg-js-darwin-arm64` | 2.6.2 | MPL-2.0 | Optional |
| `@resvg/resvg-js-darwin-x64` | 2.6.2 | MPL-2.0 | Optional |
| `@resvg/resvg-js-linux-arm-gnueabihf` | 2.6.2 | MPL-2.0 | Optional |
| `@resvg/resvg-js-linux-arm64-gnu` | 2.6.2 | MPL-2.0 | Optional |
| `@resvg/resvg-js-linux-arm64-musl` | 2.6.2 | MPL-2.0 | Optional |
| `@resvg/resvg-js-linux-x64-gnu` | 2.6.2 | MPL-2.0 | Optional |
| `@resvg/resvg-js-linux-x64-musl` | 2.6.2 | MPL-2.0 | Optional |
| `@resvg/resvg-js-win32-arm64-msvc` | 2.6.2 | MPL-2.0 | Optional |
| `@resvg/resvg-js-win32-ia32-msvc` | 2.6.2 | MPL-2.0 | Optional |
| `@resvg/resvg-js-win32-x64-msvc` | 2.6.2 | MPL-2.0 | Optional |
| `@so-ric/colorspace` | 1.1.6 | MIT | Required by dependency graph |
| `@tweenjs/tween.js` | 23.1.3 | MIT | Required by dependency graph |
| `@types/braces` | 3.0.5 | MIT | Required by dependency graph |
| `@types/glob` | 8.1.0 | MIT | Required by dependency graph |
| `@types/lodash` | 4.17.25 | MIT | Required by dependency graph |
| `@types/micromatch` | 4.0.10 | MIT | Required by dependency graph |
| `@types/minimatch` | 5.1.2 | MIT | Required by dependency graph |
| `@types/ndarray` | 1.1.0 | MIT | Required by dependency graph |
| `@types/node` | 22.20.4 | MIT | Required by dependency graph |
| `@types/node` | 20.5.6 | MIT | Required by dependency graph |
| `@types/prompts` | 2.4.9 | MIT | Required by dependency graph |
| `@types/stats.js` | 0.17.4 | MIT | Required by dependency graph |
| `@types/table` | 5.0.0 | MIT | Required by dependency graph |
| `@types/three` | 0.186.0 | MIT | Required by dependency graph |
| `@types/tmp` | 0.2.6 | MIT | Required by dependency graph |
| `@types/triple-beam` | 1.3.5 | MIT | Required by dependency graph |
| `@types/webxr` | 0.5.24 | MIT | Required by dependency graph |
| `@types/wrap-ansi` | 8.0.2 | MIT | Required by dependency graph |
| `ajv` | 6.15.0 | MIT | Required by dependency graph |
| `ansi-escapes` | 7.3.0 | MIT | Required by dependency graph |
| `ansi-regex` | 6.4.0 | MIT | Required by dependency graph |
| `ansi-regex` | 5.0.1 | MIT | Required by dependency graph |
| `ansi-regex` | 5.0.1 | MIT | Required by dependency graph |
| `ansi-regex` | 5.0.1 | MIT | Required by dependency graph |
| `ansi-regex` | 4.1.1 | MIT | Required by dependency graph |
| `ansi-regex` | 5.0.1 | MIT | Required by dependency graph |
| `ansi-styles` | 4.3.0 | MIT | Required by dependency graph |
| `ansi-styles` | 6.2.3 | MIT | Required by dependency graph |
| `ansi-styles` | 6.2.3 | MIT | Required by dependency graph |
| `ansi-styles` | 6.2.3 | MIT | Required by dependency graph |
| `ansi-styles` | 3.2.1 | MIT | Required by dependency graph |
| `ansi-styles` | 6.2.3 | MIT | Required by dependency graph |
| `astral-regex` | 1.0.0 | MIT | Required by dependency graph |
| `async` | 3.2.6 | MIT | Required by dependency graph |
| `balanced-match` | 1.0.2 | MIT | Required by dependency graph |
| `brace-expansion` | 2.1.7 | MIT | Required by dependency graph |
| `braces` | 3.0.3 | MIT | Required by dependency graph |
| `chalk` | 3.0.0 | MIT | Required by dependency graph |
| `cli-cursor` | 5.0.0 | MIT | Required by dependency graph |
| `cli-table3` | 0.6.5 | MIT | Required by dependency graph |
| `cli-truncate` | 4.0.0 | MIT | Required by dependency graph |
| `color` | 5.0.3 | MIT | Required by dependency graph |
| `color-convert` | 2.0.1 | MIT | Required by dependency graph |
| `color-convert` | 3.1.3 | MIT | Required by dependency graph |
| `color-convert` | 1.9.3 | MIT | Required by dependency graph |
| `color-name` | 1.1.4 | MIT | Required by dependency graph |
| `color-name` | 2.1.1 | MIT | Required by dependency graph |
| `color-name` | 2.1.1 | MIT | Required by dependency graph |
| `color-name` | 1.1.3 | MIT | Required by dependency graph |
| `color-string` | 2.1.4 | MIT | Required by dependency graph |
| `colorette` | 2.0.20 | MIT | Required by dependency graph |
| `cross-spawn` | 7.0.6 | MIT | Required by dependency graph |
| `csv-stringify` | 6.8.3 | MIT | Required by dependency graph |
| `cwise-compiler` | 1.1.3 | MIT | Required by dependency graph |
| `detect-libc` | 2.1.2 | Apache-2.0 | Required by dependency graph |
| `draco3dgltf` | 1.5.7 | Apache-2.0 | Required by dependency graph |
| `eastasianwidth` | 0.2.0 | MIT | Required by dependency graph |
| `emoji-regex` | 9.2.2 | MIT | Required by dependency graph |
| `emoji-regex` | 10.6.0 | MIT | Required by dependency graph |
| `emoji-regex` | 8.0.0 | MIT | Required by dependency graph |
| `emoji-regex` | 10.6.0 | MIT | Required by dependency graph |
| `emoji-regex` | 10.6.0 | MIT | Required by dependency graph |
| `emoji-regex` | 7.0.3 | MIT | Required by dependency graph |
| `emoji-regex` | 9.2.2 | MIT | Required by dependency graph |
| `enabled` | 2.0.0 | MIT | Required by dependency graph |
| `environment` | 1.1.0 | MIT | Required by dependency graph |
| `esbuild` | 0.28.2 | MIT | Required by dependency graph |
| `eventemitter3` | 5.0.4 | MIT | Required by dependency graph |
| `fast-deep-equal` | 3.1.3 | MIT | Required by dependency graph |
| `fast-json-stable-stringify` | 2.1.0 | MIT | Required by dependency graph |
| `fdir` | 6.5.0 | MIT | Required by dependency graph |
| `fecha` | 4.2.3 | MIT | Required by dependency graph |
| `fflate` | 0.8.3 | MIT | Required by dependency graph |
| `fill-range` | 7.1.1 | MIT | Required by dependency graph |
| `fn.name` | 1.1.0 | MIT | Required by dependency graph |
| `foreground-child` | 3.3.1 | ISC | Required by dependency graph |
| `fsevents` | 2.3.3 | MIT | Optional |
| `get-east-asian-width` | 1.7.0 | MIT | Required by dependency graph |
| `glob` | 10.5.0 | ISC | Required by dependency graph |
| `gltf-validator` | 2.0.0-dev.3.10 | Apache-2.0 | Required by dependency graph |
| `has-flag` | 4.0.0 | MIT | Required by dependency graph |
| `inherits` | 2.0.4 | ISC | Required by dependency graph |
| `iota-array` | 1.0.0 | MIT | Required by dependency graph |
| `is-buffer` | 1.1.6 | MIT | Required by dependency graph |
| `is-fullwidth-code-point` | 4.0.0 | MIT | Required by dependency graph |
| `is-fullwidth-code-point` | 5.1.0 | MIT | Required by dependency graph |
| `is-fullwidth-code-point` | 3.0.0 | MIT | Required by dependency graph |
| `is-fullwidth-code-point` | 3.0.0 | MIT | Required by dependency graph |
| `is-fullwidth-code-point` | 2.0.0 | MIT | Required by dependency graph |
| `is-number` | 7.0.0 | MIT | Required by dependency graph |
| `is-stream` | 2.0.1 | MIT | Required by dependency graph |
| `isexe` | 2.0.0 | ISC | Required by dependency graph |
| `jackspeak` | 3.4.3 | BlueOak-1.0.0 | Required by dependency graph |
| `json-schema-traverse` | 0.4.1 | MIT | Required by dependency graph |
| `keyframe-resample` | 0.1.0 | BlueOak-1.0.0 | Required by dependency graph |
| `kleur` | 3.0.3 | MIT | Required by dependency graph |
| `ktx-parse` | 1.1.0 | MIT | Required by dependency graph |
| `kuler` | 2.0.0 | MIT | Required by dependency graph |
| `lightningcss` | 1.33.0 | MPL-2.0 | Required by dependency graph |
| `lightningcss-android-arm64` | 1.33.0 | MPL-2.0 | Optional |
| `lightningcss-darwin-arm64` | 1.33.0 | MPL-2.0 | Optional |
| `lightningcss-darwin-x64` | 1.33.0 | MPL-2.0 | Optional |
| `lightningcss-freebsd-x64` | 1.33.0 | MPL-2.0 | Optional |
| `lightningcss-linux-arm-gnueabihf` | 1.33.0 | MPL-2.0 | Optional |
| `lightningcss-linux-arm64-gnu` | 1.33.0 | MPL-2.0 | Optional |
| `lightningcss-linux-arm64-musl` | 1.33.0 | MPL-2.0 | Optional |
| `lightningcss-linux-x64-gnu` | 1.33.0 | MPL-2.0 | Optional |
| `lightningcss-linux-x64-musl` | 1.33.0 | MPL-2.0 | Optional |
| `lightningcss-win32-arm64-msvc` | 1.33.0 | MPL-2.0 | Optional |
| `lightningcss-win32-x64-msvc` | 1.33.0 | MPL-2.0 | Optional |
| `listr2` | 8.3.3 | MIT | Required by dependency graph |
| `lodash` | 4.18.1 | MIT | Required by dependency graph |
| `log-update` | 6.1.0 | MIT | Required by dependency graph |
| `logform` | 2.7.0 | MIT | Required by dependency graph |
| `lru-cache` | 10.4.3 | ISC | Required by dependency graph |
| `meshoptimizer` | 1.1.1 | MIT | Required by dependency graph |
| `meshoptimizer` | 1.2.0 | MIT | Required by dependency graph |
| `micromatch` | 4.0.8 | MIT | Required by dependency graph |
| `mikktspace` | 1.1.1 | MIT | Required by dependency graph |
| `mimic-function` | 5.0.1 | MIT | Required by dependency graph |
| `minimatch` | 9.0.9 | ISC | Required by dependency graph |
| `minipass` | 7.1.3 | BlueOak-1.0.0 | Required by dependency graph |
| `ms` | 2.1.3 | MIT | Required by dependency graph |
| `nanoid` | 3.3.19 | MIT | Required by dependency graph |
| `ndarray` | 1.1.1 | MIT | Required by dependency graph |
| `ndarray-lanczos` | 0.3.0 | MIT | Required by dependency graph |
| `ndarray-ops` | 1.2.2 | MIT | Required by dependency graph |
| `ndarray-pixels` | 5.2.0 | MIT | Required by dependency graph |
| `one-time` | 1.0.0 | MIT | Required by dependency graph |
| `onetime` | 7.0.0 | MIT | Required by dependency graph |
| `package-json-from-dist` | 1.0.1 | BlueOak-1.0.0 | Required by dependency graph |
| `path-key` | 3.1.1 | MIT | Required by dependency graph |
| `path-scurry` | 1.11.1 | BlueOak-1.0.0 | Required by dependency graph |
| `picocolors` | 1.1.1 | ISC | Required by dependency graph |
| `picomatch` | 4.0.7 | MIT | Required by dependency graph |
| `picomatch` | 2.3.2 | MIT | Required by dependency graph |
| `playwright-core` | 1.56.1 | Apache-2.0 | Required by dependency graph |
| `postcss` | 8.5.28 | MIT | Required by dependency graph |
| `prettier` | 3.9.9 | MIT | Development only: code formatter |
| `prompts` | 2.4.2 | MIT | Required by dependency graph |
| `property-graph` | 4.1.0 | MIT | Required by dependency graph |
| `punycode` | 2.3.1 | MIT | Required by dependency graph |
| `readable-stream` | 3.6.2 | MIT | Required by dependency graph |
| `restore-cursor` | 5.1.0 | MIT | Required by dependency graph |
| `rfdc` | 1.4.1 | MIT | Required by dependency graph |
| `rolldown` | 1.2.12 | MIT | Required by dependency graph |
| `safe-buffer` | 5.2.1 | MIT | Required by dependency graph |
| `safe-stable-stringify` | 2.5.0 | MIT | Required by dependency graph |
| `semver` | 7.8.5 | ISC | Required by dependency graph |
| `sharp` | 0.35.5 | Apache-2.0 | Required by dependency graph |
| `shebang-command` | 2.0.0 | MIT | Required by dependency graph |
| `shebang-regex` | 3.0.0 | MIT | Required by dependency graph |
| `signal-exit` | 4.1.0 | ISC | Required by dependency graph |
| `sisteransi` | 1.0.5 | MIT | Required by dependency graph |
| `slice-ansi` | 7.1.2 | MIT | Required by dependency graph |
| `slice-ansi` | 5.0.0 | MIT | Required by dependency graph |
| `slice-ansi` | 2.1.0 | MIT | Required by dependency graph |
| `source-map-js` | 1.2.1 | BSD-3-Clause | Required by dependency graph |
| `stack-trace` | 0.0.10 | MIT | Required by dependency graph |
| `string-width` | 5.1.2 | MIT | Required by dependency graph |
| `string-width` | 7.2.0 | MIT | Required by dependency graph |
| `string-width` | 7.2.0 | MIT | Required by dependency graph |
| `string-width` | 7.2.0 | MIT | Required by dependency graph |
| `string-width` | 4.2.3 | MIT | Required by dependency graph |
| `string-width` | 3.1.0 | MIT | Required by dependency graph |
| `string-width` | 5.1.2 | MIT | Required by dependency graph |
| `string-width-cjs` | 4.2.3 | MIT | Required by dependency graph |
| `string_decoder` | 1.3.0 | MIT | Required by dependency graph |
| `strip-ansi` | 6.0.1 | MIT | Required by dependency graph |
| `strip-ansi` | 6.0.1 | MIT | Required by dependency graph |
| `strip-ansi` | 7.2.0 | MIT | Required by dependency graph |
| `strip-ansi` | 5.2.0 | MIT | Required by dependency graph |
| `strip-ansi` | 6.0.1 | MIT | Required by dependency graph |
| `strip-ansi-cjs` | 6.0.1 | MIT | Required by dependency graph |
| `supports-color` | 7.2.0 | MIT | Required by dependency graph |
| `table` | 5.4.6 | BSD-3-Clause | Required by dependency graph |
| `text-hex` | 1.0.0 | MIT | Required by dependency graph |
| `three` | 0.186.1 | MIT | Required by dependency graph |
| `tinyglobby` | 0.2.17 | MIT | Required by dependency graph |
| `tmp` | 0.2.7 | MIT | Required by dependency graph |
| `to-regex-range` | 5.0.1 | MIT | Required by dependency graph |
| `triple-beam` | 1.4.1 | MIT | Required by dependency graph |
| `tslib` | 2.8.1 | 0BSD | Optional |
| `tsx` | 4.23.15 | MIT | Required by dependency graph |
| `typescript` | 6.0.3 | Apache-2.0 | Required by dependency graph |
| `undici-types` | 6.21.0 | MIT | Required by dependency graph |
| `uniq` | 1.0.1 | MIT | Required by dependency graph |
| `uri-js` | 4.4.1 | BSD-2-Clause | Required by dependency graph |
| `util-deprecate` | 1.0.2 | MIT | Required by dependency graph |
| `vite` | 8.3.2 | MIT | Required by dependency graph |
| `watlas` | 1.0.1 | MIT | Required by dependency graph |
| `which` | 2.0.2 | ISC | Required by dependency graph |
| `winston` | 3.10.0 | MIT | Required by dependency graph |
| `winston-transport` | 4.9.0 | MIT | Required by dependency graph |
| `wrap-ansi` | 9.0.2 | MIT | Required by dependency graph |
| `wrap-ansi` | 9.0.2 | MIT | Required by dependency graph |
| `wrap-ansi` | 8.1.0 | MIT | Required by dependency graph |
| `wrap-ansi-cjs` | 7.0.0 | MIT | Required by dependency graph |
| `ws` | 8.22.0 | MIT | Optional reference host; installed by the locked development graph |

Retain each distributed package's license files and copyright notices. Relevant
installed notice paths include:

- `node_modules/three/LICENSE` and `node_modules/meshoptimizer/LICENSE.md`.
- `node_modules/vite/LICENSE.md`, `node_modules/rolldown/LICENSE` and
  `THIRD-PARTY-LICENSE`, and `node_modules/esbuild/LICENSE.md` (including their
  bundled notices).
- `node_modules/typescript/LICENSE.txt`,
  `node_modules/@dimforge/rapier3d-compat/LICENSE` and
  `node_modules/detect-libc/LICENSE` (Apache-2.0).
- `node_modules/lightningcss/LICENSE` (MPL-2.0, a build-time CSS minifier; its
  native `lightningcss-<platform>` subpackages carry the same license).
- `node_modules/@resvg/resvg-js/LICENSE` (MPL-2.0, the development-only SVG
  renderer for `scripts/brand/build.mjs`; its native `@resvg/resvg-js-<platform>`
  subpackages carry the same license).
- `node_modules/playwright-core/LICENSE` and `NOTICE` (Apache-2.0).
- `node_modules/prettier/LICENSE` (MIT, the development-only code formatter,
  including the notices of the dependencies it bundles).
- `node_modules/source-map-js/LICENSE` (BSD-3-Clause).
- `node_modules/picocolors/LICENSE` (ISC).
- Other installed MIT packages' `LICENSE` or `LICENSE.md` files.

Playwright's NOTICE identifies code derived from Puppeteer, distributed under
Apache-2.0. Chromium is not distributed in this repository; the test harness uses
a separately installed browser. Bundling a browser later requires its own notices.
Some native subpackages have license metadata but no standalone license text in
the installed subpackage. Preserve the corresponding parent package notices and
review the actual binary distribution before shipping native tooling.

The declared license families are compatible with GPLv3 combinations according
to the [GNU compatibility guidance](https://www.gnu.org/licenses/license-compatibility.en.html)
and [Apache's GPL compatibility explanation](https://apache.org/licenses/GPL-compatibility.html).
MPL-2.0 (Lightning CSS, a build tool that is not distributed in browser builds)
is GPL-compatible through its secondary-license provision, as the GNU list notes;
LGPL-3.0-or-later (sharp's libvips binaries, run only by the development-only model optimiser) is
GPLv3-compatible, and BlueOak-1.0.0, 0BSD and BSD-2-Clause are permissive;
the installed `lightningcss` license does not mark it Incompatible With Secondary
Licenses.
This does not relicense upstream packages, establish ownership, or certify every
embedded binary component. Package metadata is an inventory aid, not a substitute
for preserving the notices accompanying the actual distributed material.

## Original diagnostic assets

`templates/mechanics/game/tools/README.md` records authorship and CC0-1.0 status for:

| Files | Origin | License |
|---|---|---|
| `templates/mechanics/game/public/models/mechanics/beacon.glb` | Locally generated two-link skinned cuboid and pulse clip, `templates/mechanics/game/tools/generate-fixture.mjs` | CC0-1.0 |
| `templates/mechanics/game/public/models/mechanics/sky-{px,nx,py,ny,pz,nz}.png` | Six locally generated 16×16 orientation glyph textures, `templates/mechanics/game/tools/generate-cube.mjs` | CC0-1.0 |
| `templates/mechanics/game/public/textures/mechanics/panel.png` | Locally generated 32×32 riveted panel texture, `templates/mechanics/game/tools/generate-panel.mjs` | CC0-1.0 |
| `templates/mechanics/game/public/sounds/mechanics/chime.wav` | Locally synthesised 0.45 s two-partial chime, `templates/mechanics/game/tools/generate-chime.mjs` | CC0-1.0 |

These fixtures were generated for Foundation Engine by its contributors, with no
external mesh, texture, photograph, recording, or downloaded art input. Of their
nine files, eight are individually under 3 KiB and the chime is about 20 KiB. The generators remain project source under the
project license; the generated asset dedication is independent. Template
verification screenshots capture locally rendered diagnostic scenes and UI.
See the [CC0 dedication](https://creativecommons.org/publicdomain/zero/1.0/).

## Original Blender export example

`tools/blender-export/game/public/models/metre-block.glb` is original project content, generated solely from `tools/blender-export/export.py`, with no external art inputs. Both are GPL-3.0-only; this sample does not use the CC0 exception for the earlier mechanics fixtures. Its adjacent provenance JSON records the exporter version and hashes. The model contains 12 triangles, two materials and no textures; see `tools/blender-export/README.md`.

`tools/blender-export/game/public/models/lantern.glb` is also original project content, GPL-3.0-only, generated solely from `tools/blender-export/game/tools/lantern/export.py` (agent-assisted Blender Python by the Foundation Engine contributors) with no external models, textures, scans or downloaded art. It has 148 triangles, two materials and no textures; its receipt records licence, author, source, tool, generator and origin, and `lantern.contract.json` holds its limits.

## Provenance boundaries and release review

[PROVENANCE.md](docs/PROVENANCE.md) describes the initial engine extraction.
Inspection of the current tracked engine and fixture tree found no vendored
external source or art beyond the dependencies and assets inventoried above. Architectural research references and independently
written implementations are not a license to redistribute the researched code
or assets. External research repositories and historical branches are outside
this current-tree inventory.

This review did not establish the full copyright chain for the initial extraction
or every historical contribution, audit all git history, or attest to the source
of every optional native binary and embedded WASM dependency. Maintainers must
confirm rights to the project contributions and retain third-party notices for
the specific source and binary release they distribute. Do not interpret this
file as legal certification or a blanket claim that no third-party material has
ever entered repository history.
