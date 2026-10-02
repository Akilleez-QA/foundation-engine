# Third-party notices

Foundation Engine is licensed under **GPL-3.0-only**; see [LICENSE](LICENSE).
Third-party packages retain their own copyrights and licenses. The project license
does not replace those notices. The original generated diagnostic assets listed
below are separately dedicated under **CC0-1.0**.

This inventory was checked against `package-lock.json` and installed package
license files on 2026-10-02. It records pinned versions, not semver ranges.
Update it when the dependency graph or shipped assets change.

## Optional network reference host dependency

Added and checked on 2026-10-01: **ws 8.22.0**, MIT, used by the optional Node
reference host. It is not imported by ordinary player builds or the native browser
WebSocket adapter. [Pinned source](https://github.com/websockets/ws/tree/8.22.0).
Retain `node_modules/ws/LICENSE` when distributing the reference host with this
package. The installed license credits Einar Otto Stangvik (2011), Arnout Kazemier
and contributors (2013), and Luigi Pinca and contributors (2016). No optional native
WebSocket acceleration package is required by this integration.

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
- Vite can generate browser preload helpers. Keep relevant Vite notices when
  redistributing those helpers; its installed `LICENSE.md` also contains bundled
  dependency notices. Do not infer browser-bundle contents from `devDependency`
  classification alone.

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

The lockfile contains 78 dependency entries. Its declared licenses are 73 MIT,
three Apache-2.0, one BSD-3-Clause, and one ISC. These include transitive tools,
types, and optional platform binaries; the table is not a statement that all
packages ship in a browser build. The original 2026-09-30 audit installed 29 packages on its
host; the separately documented network-host addition followed on 2026-10-01. Optional binaries for other operating systems were inspected through
lockfile metadata only.

| Package | Pinned version | Declared license | Installation condition |
|---|---|---|---|
| `@dimforge/rapier3d-compat` | 0.12.0 | Apache-2.0 | Required by dependency graph |
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
| `@napi-rs/lzma-linux-x64-gnu` | 1.5.1 | MIT | Optional |
| `@rollup/rollup-android-arm-eabi` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-android-arm64` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-darwin-arm64` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-darwin-x64` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-freebsd-arm64` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-freebsd-x64` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-linux-arm-gnueabihf` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-linux-arm-musleabihf` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-linux-arm64-gnu` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-linux-arm64-musl` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-linux-loong64-gnu` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-linux-loong64-musl` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-linux-ppc64-gnu` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-linux-ppc64-musl` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-linux-riscv64-gnu` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-linux-riscv64-musl` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-linux-s390x-gnu` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-linux-x64-gnu` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-linux-x64-musl` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-openbsd-x64` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-openharmony-arm64` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-win32-arm64-msvc` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-win32-ia32-msvc` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-win32-x64-gnu` | 4.63.5 | MIT | Optional |
| `@rollup/rollup-win32-x64-msvc` | 4.63.5 | MIT | Optional |
| `@tweenjs/tween.js` | 23.1.3 | MIT | Required by dependency graph |
| `@types/estree` | 1.0.9 | MIT | Required by dependency graph |
| `@types/node` | 22.20.4 | MIT | Required by dependency graph |
| `@types/stats.js` | 0.17.4 | MIT | Required by dependency graph |
| `@types/three` | 0.186.0 | MIT | Required by dependency graph |
| `@types/webxr` | 0.5.24 | MIT | Required by dependency graph |
| `esbuild` | 0.28.2 | MIT | Required by dependency graph |
| `fdir` | 6.5.0 | MIT | Required by dependency graph |
| `fflate` | 0.8.3 | MIT | Required by dependency graph |
| `fsevents` | 2.3.3 | MIT | Optional |
| `meshoptimizer` | 1.1.1 | MIT | Required by dependency graph |
| `nanoid` | 3.3.19 | MIT | Required by dependency graph |
| `picocolors` | 1.1.1 | ISC | Required by dependency graph |
| `picomatch` | 4.0.7 | MIT | Required by dependency graph |
| `playwright-core` | 1.56.1 | Apache-2.0 | Required by dependency graph |
| `postcss` | 8.5.28 | MIT | Required by dependency graph |
| `rollup` | 4.63.5 | MIT | Required by dependency graph |
| `source-map-js` | 1.2.1 | BSD-3-Clause | Required by dependency graph |
| `three` | 0.186.1 | MIT | Required by dependency graph |
| `tinyglobby` | 0.2.17 | MIT | Required by dependency graph |
| `tsx` | 4.23.15 | MIT | Required by dependency graph |
| `typescript` | 6.0.3 | Apache-2.0 | Required by dependency graph |
| `undici-types` | 6.21.0 | MIT | Required by dependency graph |
| `vite` | 7.3.6 | MIT | Required by dependency graph |
| `ws` | 8.22.0 | MIT | Optional reference host; installed by the locked development graph |

Retain each distributed package's license files and copyright notices. Relevant
installed notice paths include:

- `node_modules/three/LICENSE` and `node_modules/meshoptimizer/LICENSE.md`.
- `node_modules/vite/LICENSE.md`, `node_modules/rollup/LICENSE.md`, and
  `node_modules/esbuild/LICENSE.md` (including their bundled notices).
- `node_modules/typescript/LICENSE.txt` and
  `node_modules/@dimforge/rapier3d-compat/LICENSE` (Apache-2.0).
- `node_modules/playwright-core/LICENSE` and `NOTICE` (Apache-2.0).
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
This does not relicense upstream packages, establish ownership, or certify every
embedded binary component. Package metadata is an inventory aid, not a substitute
for preserving the notices accompanying the actual distributed material.

## Original diagnostic assets

`templates/mechanics/assets/README.md` records authorship and CC0-1.0 status for:

| Files | Origin | License |
|---|---|---|
| `public/models/mechanics/beacon.glb` | Locally generated two-link skinned cuboid and pulse clip, `templates/mechanics/assets/generate-fixture.mjs` | CC0-1.0 |
| `public/models/mechanics/sky-{px,nx,py,ny,pz,nz}.png` | Six locally generated 16×16 orientation glyph textures, `templates/mechanics/assets/generate-cube.mjs` | CC0-1.0 |
| `public/textures/mechanics/panel.png` | Locally generated 32×32 riveted panel texture, `templates/mechanics/assets/generate-panel.mjs` | CC0-1.0 |
| `public/sounds/mechanics/chime.wav` | Locally synthesised 0.45 s two-partial chime, `templates/mechanics/assets/generate-chime.mjs` | CC0-1.0 |

These fixtures were generated for Foundation Engine by its contributors, with no
external mesh, texture, photograph, recording, or downloaded art input. Of their
nine files, eight are individually under 3 KiB and the chime is about 20 KiB. The generators remain project source under the
project license; the generated asset dedication is independent. Template
verification screenshots capture locally rendered diagnostic scenes and UI.
See the [CC0 dedication](https://creativecommons.org/publicdomain/zero/1.0/).

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
