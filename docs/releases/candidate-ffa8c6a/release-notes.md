# Release notes draft: Foundation Engine 0.3.0 (proposed)

**Status: prepared, not released.** The version number 0.3.0 and the date are proposed; the author decides
both. No tag, GitHub release, package or deployment exists for this candidate. The candidate is
`ffa8c6afb8858db1b85ac9906f5f86662ba7f872` on `main` (the merge of #174); its evidence is in the [candidate bundle](README.md). The full list with
PR links is the [changelog](../../../CHANGELOG.md#030--proposed-author-decides).

Everything below happened after [v0.2.0](https://github.com/Akilleez-QA/foundation-engine/releases/tag/v0.2.0)
(tag `071e3c2`, PR #49), up to and including #174. It replaces the earlier draft for candidate
[`7c26db7`](../candidate-7c26db7/release-notes.md), which stopped at #121. Every new framework is optional: a
game that does not use it is unchanged. Before upgrading a 0.2.0 game, read the [upgrade guide](upgrade.md):
several checks are stricter, and phones now start on a lighter quality preset.

---

## Foundation Engine 0.3.0 (proposed)

### Make it look good

Each of these is opt-in per scene; a scene that asks for none of them draws exactly as before.

- **Tone mapping and exposure (VIS-01, #124).** `view.output` with ACES, AgX or neutral and an exposure;
  changeable at run time with one redraw.
- **Point and spot lights (VIS-02, #138).** `PointLight` and `SpotLight` in fixed per-scene slots
  (`sceneLights()`), so spawning a light never recompiles shaders. Overflow is refused deterministically,
  essential lights first. A non-essential light the device tier has no slot for is reported once at info
  (#172).
- **Shadows (VIS-03, #148).** `sceneShadows()` for the sun, lamps and shapes; maps redraw only when a caster
  or light changes. Shadow cost is budgeted: `shadowPasses` (map renders per frame) and `shadowCasters`
  (their draws) are gated counts (#158, #167).
- **Gradient sky and haze (VIS-05, #150).** A CPU-generated gradient sky with discs and stars, and
  exponential haze that can take the horizon colour.
- **Materials (VIS-04, #127).** Matte, flat and toon shading, double-sided, alpha cut-out and vertex colours;
  `Material` on `Mesh` and `Model`.
- **Instanced scatter (VIS-06, #144).** Many copies of a `Shape` or `Mesh` as one draw: seeded placement in a
  rect, ring or edge, per-copy jitter, a density knob, bounded per scene.
- **Post-processing (VIS-07, #161).** `view.post` bloom, vignette and grade at the player's `post.mode` tier:
  a half-resolution bloom chain on `reference`/`high`, one combined pass on `medium`, nothing on `low`. Post
  passes are counted apart as `postDraws`.
- **Full three.js when you ask for it: `@kits/three` (VIS-09, #136).** A game that lists the kit may import
  three and its addons; the engine disposes everything on exit. Unstable across three.js upgrades: the game
  owns that code. `lint:game` flags removed three APIs (#132).
- **KTX2 model textures (#146).** Basis Universal textures in GLBs stay compressed on the GPU; the transcoder
  loads only for a model that needs it.
- **Showcase template and art direction (#128, #139, #159, #166, #154).** `npm run new-game -- --template
  showcase` builds a night courtyard (eight lanterns as real point lights, a shadowed key light, gradient sky,
  moss scatter, bloom) and a day garden from the author API alone. The [art-direction recipe](../../recipes/art-direction.md)
  and skill walk through palette, lighting ratios, haze, framing, phone framing, baked forms and a look
  checklist, each code block an excerpt of the template. The explorer template got the same pass.

### Assets

- **Model contracts (#126, #131, #147).** `npm run asset:verify` checks a GLB against its adjacent
  `<name>.contract.json`: size and pivot, triangle, vertex, material and texture limits, bytes, named nodes and
  clips, the loader's own caps, and an optional silhouette overlap against a reference picture.
- **Optimisation (#135).** `npm run asset:optimize` on glTF-Transform: meshopt geometry, WebP or KTX2
  textures resized to the contract, names kept, the contract checked before and after.
- **Blender (#129, #134, #145).** A headless-Blender lantern example with its contract and receipt, a
  [Blender-through-MCP recipe](../../recipes/make-assets-with-blender-mcp.md) with an opt-in config example
  (nothing installed), and an agent skill for building an asset with measurements as the evidence.
- **Provenance and AI disclosure (DX-03, #137).** Every file under a game's `public/` can carry a provenance
  record (origin, author, licence, hashes and, for AI origins, tool, model and human edits). `lint:provenance`
  warns by default and fails only when the brief sets `assets: { provenance: 'required' }`. `npm run
  disclosure` drafts store AI-disclosure text from the records.

### Animation

- **Pose-to-pose pipeline (#142, #149, #151, #152, #153).** `tools/pose-to-pose/`: headless Blender 5.2
  rigging (humanoid or rigid parts), key poses posed and approved by a person, in-betweens, loops as chained
  key-pose segments, export and validation. A robot and a six-legged creature are worked examples. The exports
  play in the stock loader with root motion and clip markers (browser check in CI). Key poses can come from a
  reference clip through a take ledger with per-pose approval.

### Effects

- **Flipbook particles (FX-01a, #141).** Sprite-sheet animation on an emitter (over life, loop, random
  start), still one draw per emitter; `npm run fx:pack` packs a PNG sequence into an atlas with provenance.
- **Effect lifecycle tests (#143).** A recipe with five named tests (cancelled windup, single impact,
  stacking, owner despawn, pooled trails) and `testScene` `particles.sample`.
- **Calm stops decorative motion (#171).** With Calm on, non-essential emitters add nothing and live
  particles hold still and fade; essential ones still show, held still. The random stream is unchanged.

### Devices and quality tiers

- **Phones start on a lighter preset (ADR 0079, #155, #164).** When the brief does not declare
  `quality.tier`, a first run on a constrained mobile GPU starts on `low` or `medium`, and a capable mobile
  GPU on `high` at most, never `reference`. Desktops, iPhone-class devices, gates and benches are unchanged.
  A declared tier, a saved choice and a player's pick still win. Before, every template started every device
  on `reference`.
- **Phone checks at the phone tier (#169, #172).** `play:snap --mobile` and CI's phone smoke run at `medium`,
  the phone default; `--quality <preset>` pins another.

### Tooling and checks

- **Capability manifest (#156, #157, #162).** `npm run capabilities` writes `docs/capabilities.json` and
  `.md` from the code. `lint:docs-claims` fails a page that says a shipped feature is missing. Agents are
  pointed at it as the source of truth.
- **The gate runs your playtests (#165).** `npm run play:playtests` runs every `playtest/*.json` and every
  `how: 'playtest'` criterion; `npm run gate` fails when one fails.
- **`play:snap` counts (#168, #169).** A `counts:` line per view: draws, postDraws, triangles, shadowCasters,
  shadowPasses and textureMiB against the budget. `--calm` checks that motion and emitters stop.
- **Budgets (#167, #170, #173, #174).** `perf:derive` copies zero-tolerance counts exactly; the scene
  generator writes every ceiling; `lint:budgets` ratchets a new game against the template it started from and
  reads `Perf-Budget:` lines anywhere in a message; the bench no longer counts the previous scene's last frame
  after a scene change. Inflated rows were lowered.
- **Smaller fixes.** `format:check` prints `npm run format` when it fails (#174); the fix-budget skill counts
  draws first (#130); a lazy model chunk frees 24 kB of the runtime chunk without raising the 500 kB limit
  (#160); onboarding fixes from the previous candidate's trials (#140, #125).

### Integrity and merge practice

- **Certified main.** Merges are serialized: a PR merges only when it is up to date with `main`, CI is green
  on that exact head, and `main`'s latest CI has completed green (GOVERNANCE.md, AGENTS.md, #174). Main CI
  completed green on every merge from #170 to the candidate.
- **Flakes found and fixed.** The two-tab session check waited exactly the host's idle timeout; it now derives
  its deadline from the host's limits (#163). The arcade restart playtest waits for the restarted run (#133).
  The spatial-audio cost test is robust to machine load (#122).
- **Acceptance by simulated trials.** Three fresh-agent builds from the docs (forest, neon arena, island) were
  run twice; the author judged the second round's look good enough. These are simulated agent trials on
  software GL, not human or device evidence.

Everything from the earlier draft (#50–#121) still applies: a concrete first-game path, stricter types and
game lints, Prettier, reload tests, held touch buttons, moving platforms, input history, large edited worlds,
particles, music on the audio clock, spatial audio, two players in one world on LAN, interest sets, replay
digests and deterministic maths. See the [earlier draft](../candidate-7c26db7/release-notes.md) and the
changelog.

### Known limits

- **Physical devices:** nothing in this candidate was checked on a physical phone, tablet, laptop or desktop.
  CI is headless Chromium with software rendering (SwiftShader); phone and tablet rows are emulated at best.
  Tier detection for real GPUs is unit-tested against reported strings only. See the
  [support matrix](support-matrix.md).
- **Look:** the eight look browser checks (`test:output-browser`, `test:lights-browser`,
  `test:shadows-browser`, `test:sky-browser`, `test:material-options-browser`, `test:scatter-browser`,
  `test:post-browser`, `test:three-kit-browser`) are run locally by their PRs, not in CI; CI runs their unit
  tests and the template gates, which bench the showcase and explorer scenes that use these features. Software-GL frame times are not
  device performance. The look was judged by the author on screenshots of simulated builds.
- **Multiplayer:** loopback and in-process only in CI; LAN between two machines and WAN are unverified. The
  session client has no host-liveness check yet, so how fast a client notices a silent network loss is
  bounded only by the host's idle timeout (open decision for the author).
- **Audio:** not verified by ear (test browsers are muted).
- **Newcomers:** onboarding evidence comes from simulated agent trials, not a human newcomer.
- **Windows and macOS:** CI runs on Linux only.

### Source

GPL-3.0-only. Third-party packages and sample assets keep the licences in
[THIRD_PARTY_NOTICES.md](../../../THIRD_PARTY_NOTICES.md). No npm package is published.
