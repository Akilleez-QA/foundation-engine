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
- **Basis Universal transcoder** (`basis_transcoder.js` and `basis_transcoder.wasm`),
  Apache-2.0, Copyright © Binomial LLC. Vendored in three at
  `examples/jsm/libs/basis/`; three's README there names the licence. A build emits
  both files as hashed assets because three's `KTX2Loader` references them; a page
  fetches them only when a model has a KTX2 texture (added 2026-10-03,
  `src/platform/assets/model-ktx2.ts`). The vendored files carry no version
  header. [Source](https://github.com/BinomialLLC/basis_universal).
- **ktx-parse** and **zstddec**, MIT, Copyright © Don McCurdy, vendored in three
  at `examples/jsm/libs/ktx-parse.module.js` and `examples/jsm/libs/zstddec.module.js`
  and bundled into the same lazily loaded KTX2 chunk as `KTX2Loader`. zstddec embeds
  a WebAssembly build of the **Zstandard** decoder, BSD-3-Clause, Copyright © Meta
  Platforms, Inc. and affiliates. The vendored files carry no licence or version
  header; the licences are those of the upstream repositories:
  [ktx-parse](https://github.com/donmccurdy/KTX-Parse),
  [zstddec](https://github.com/donmccurdy/zstddec),
  [Zstandard](https://github.com/facebook/zstd).
- **Rapier 0.21.0** (`@dimforge/rapier3d-deterministic-compat`, the deterministic
  compat build of the 3D physics bindings, including its WebAssembly module inlined as
  base64), Apache-2.0, Copyright 2020 Dimforge EURL.
  [Source](https://github.com/dimforge/rapier). Only a game that imports the optional
  `@kits/physics` kit contains it, as one lazily loaded chunk (about 4.4 MB) fetched
  when a scene loads physics (added 2026-10-09, `src/kits/physics/loader.ts`, ADR 0121).
  Stock builds and games without the kit do not contain it. The package ships the
  Apache License 2.0 text in its `LICENSE` file and no NOTICE file.
- Vite can generate browser preload helpers, and its Rolldown bundler (Vite 8)
  emits small module-namespace runtime helpers into browser chunks. Keep the
  relevant Vite and Rolldown (MIT) notices when redistributing those helpers;
  Vite's installed `LICENSE.md` and Rolldown's `THIRD-PARTY-LICENSE` also contain
  bundled dependency notices. Lightning CSS minifies the project's own CSS at
  build time; no Lightning CSS code is emitted. Do not infer browser-bundle
  contents from `devDependency` classification alone.

The runtime uses one engine-owned model loader and does not register a Draco
loader. A release with additional decoders or asset providers must extend this
inventory. Preserve the following notices in distributed browser builds that
contain these libraries (including lazily loaded chunks and the transcoder assets).

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

### Rapier license

Copyright 2020 Dimforge EURL. Licensed under the Apache License, Version 2.0. The
package's `LICENSE` file carries the standard Apache License 2.0 terms, as reproduced
in full under the Basis Universal transcoder license below, followed by this
copyright line and the standard application notice. No NOTICE file accompanies the
package. Preserve this notice and the licence text in builds that contain the
physics chunk.

### Basis Universal transcoder license

Copyright © Binomial LLC. Licensed under the Apache License, Version 2.0, whose
terms follow. No NOTICE file accompanies the vendored transcoder.

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS
```

### ktx-parse and zstddec license

```text
MIT License

Copyright (c) Don McCurdy

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

### Zstandard license

```text
BSD License

For Zstandard software

Copyright (c) Meta Platforms, Inc. and affiliates. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

 * Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

 * Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

 * Neither the name Facebook, nor Meta, nor the names of its contributors may
   be used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Locked dependency inventory

The lockfile contains 295 dependency entries. Its declared licenses are 216 MIT,
25 MPL-2.0 (Lightning CSS, resvg-js and their platform binaries), 20 Apache-2.0, 11 ISC,
10 LGPL-3.0-or-later and four combined Apache-2.0/LGPL-3.0-or-later (sharp's prebuilt libvips binaries),
five BlueOak-1.0.0, two BSD-3-Clause, one BSD-2-Clause and one 0BSD. These include transitive tools,
types, and optional platform binaries; the table is not a statement that all
packages ship in a browser build. The original 2026-09-30 audit installed 29 packages on its
host; the separately documented network-host addition followed on 2026-10-01, the model optimiser's 199 entries
on 2026-10-03, and the optional physics kit's one runtime entry (`@dimforge/rapier3d-deterministic-compat`, no
dependencies of its own) on 2026-10-09. Optional binaries for other operating systems were inspected through
lockfile metadata only.

| Package | Pinned version | Declared license | Installation condition |
|---|---|---|---|
| `@colors/colors` | 1.5.0 | MIT | Required by dependency graph |
| `@colors/colors` | 1.6.0 | MIT | Required by dependency graph |
| `@dabh/diagnostics` | 2.0.9 | MIT | Required by dependency graph |
| `@dimforge/rapier3d-compat` | 0.12.0 | Apache-2.0 | Required by dependency graph |
| `@dimforge/rapier3d-deterministic-compat` | 0.21.0 | Apache-2.0 | Runtime dependency; shipped only in builds of games that import `@kits/physics` |
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
  `node_modules/@dimforge/rapier3d-compat/LICENSE`,
  `node_modules/@dimforge/rapier3d-deterministic-compat/LICENSE` and
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

`tools/blender-export/game/public/models/lantern.glb` is also original project content, GPL-3.0-only, generated solely from `tools/blender-export/game/tools/lantern/export.py` (agent-assisted Blender Python by the Foundation Engine contributors) with no external models, textures, scans or downloaded art. It has 148 triangles, two materials and no textures; its receipt records licence, author, source, tool, generator and origin, and `lantern.contract.json` holds its limits. Its silhouette reference, `tools/blender-export/game/tools/lantern/lantern.front.png`, is drawn by the adjacent `reference.mjs` from the design outline and is likewise original GPL-3.0-only content.

## Original template textures

The explorer and showcase templates each ship two textures painted pixel by pixel by a seeded script in the
template, with no downloaded artwork, photographs or image tools. A re-run writes the same bytes. Each
texture's `*.asset.ts` declares the same licence, author and source.

| Files | Origin | License |
|---|---|---|
| `templates/explorer/game/public/textures/explorer/planks.png`, `templates/explorer/game/public/textures/explorer/crate.png` | Locally generated 128×128 plank and crate textures, `templates/explorer/game/tools/generate-textures.mjs` | CC0-1.0 |
| `templates/showcase/game/public/textures/showcase/planks.png`, `templates/showcase/game/public/textures/showcase/crate.png` | Locally generated 128×128 plank and crate textures, `templates/showcase/game/tools/generate-textures.mjs` | CC0-1.0 |

The generators remain project source under the project license; the generated textures are dedicated under
[CC0](https://creativecommons.org/publicdomain/zero/1.0/), like the mechanics fixtures above.

## Original pose-to-pose examples

`tools/pose-to-pose/game/public/models/pose-robot.glb` and `tools/pose-to-pose/game/public/models/pose-bug.glb`
are original project content, GPL-3.0-only, generated by headless Blender from the scripts in
`tools/pose-to-pose/blender/` and the example definitions in `tools/pose-to-pose/examples/` (agent-assisted
Blender Python by the Foundation Engine contributors), with no external models, textures, scans, motion
capture or downloaded art. Each adjacent `*.provenance.json` records the licence, author, Blender and exporter
versions, input hashes and that the key poses were agent-authored with the review gate off. They are fixtures of
the pose-to-pose tool's own test game and are not shipped by any template build.

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
