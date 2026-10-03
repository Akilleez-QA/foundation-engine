# Changelog

PR numbers refer to the public repository,
[github.com/Akilleez-QA/foundation-engine](https://github.com/Akilleez-QA/foundation-engine/pulls).
Batch PRs #42, #45, #46 and #47 integrate the PRs listed in their titles onto `main`.
Every new framework below is optional: a game that does not use it is unchanged.

## Unreleased

- **Reload tests and checked playtest scripts.** `createTestSaves()` from `@engine` gives game tests
  in-memory storage shared across `testScene` runs: `reload()` flushes the store as a page's
  `pagehide` does and re-opens it over the same storage (`{ flush: false }` loses pending writes, as a
  crash would). `play:script` gains a `{"reload": true}` step that reloads the real page. Scripts
  are now validated before any server or browser starts (unknown steps, fields and matchers, bad
  arguments: exit 64, one line per problem), by `npm run check` (lint:brief, every
  `game/playtest/*.json`, including scene names) and by `play:criteria`. The format is in the
  [write a playtest script](docs/recipes/write-a-playtest-script.md) recipe. The arcade template
  tests S4 across a reload, headless and in `playtest/best-reload.json`.
- **Accurate orphan import receipts.** Unknown payloads report `orphan-kept` only
  after a successful write or exact stored-byte match. Different existing bytes
  remain untouched and report `orphan-conflict`; storage exceptions report
  `orphan-failed`. Known writes finish before orphan receipts are issued. A
  renamed section's old alias key is no longer exported as an orphan, and an
  alias orphan beside its section in one file reports `orphan-superseded` (not
  written), so files exported after a rename import again. Profile format v2 is
  unchanged; exhaustive import-report consumers must handle the three new
  outcomes. Retain source files for explicit reconciliation or retry.

- **8-bit brand.** An original pixel-art Plinth mark (a stepped base of blue bricks with a gold capstone),
  lockups, icon and social preview in `assets/brand/`, drawn as SVG pixel grids with no fonts; a README hero,
  ASCII page headers, a [documentation index](docs/README.md) and the [brand guide](docs/brand.md).
  `scripts/brand/build.mjs` generates every asset from pixel grids (PNGs through the new development
  dependency `@resvg/resvg-js`, MPL-2.0); `scripts/brand/build.test.mjs` guards contrast and palette.
  Documentation and tooling only; no runtime change.
- **Held touch buttons.** `touchButton(ctx, input, { label })` in `@kits/ui` presses a game input on
  touch, holds a `hold: true` input while the finger stays on it, and releases on lift, cancel,
  slide-off, blur or the visit's end; presses keep the exactly-once fixed-tick delivery. Touch only,
  at least 48 CSS px. `bindPointerControl` gains `leave: 'release'` and `onContact`; `ctx.view.signal`
  aborts when the visit ends. Emulated browser evidence only.
- **`testScene` refuses unknown cue and sound ids.** `ctx.play` / `ctx.playVoice` with an id that is
  neither a built-in cue nor one of the scene's `sounds` now throws in `testScene`, naming the id and
  the built-in cues (a browser only warns in the console). `testScene({ sounds })` adds ids a scene
  plays without listing them. `BUILT_IN_CUES` lists the cue ids; the
  [test a scene](docs/recipes/test-a-scene.md) recipe documents every option and result field, and
  the built-in cue table in the sounds recipe is generated from the cue definitions and checked.
- **`testScene` records `playVoice` options.** `t.voices` lists each voice with a copy of its options
  (gain, rate, variant, wait, at, spatial, filter), checked as the audio output checks them
  (`normalizeCueVoiceOptions`, shared with the real `playVoice`). `t.cues` is unchanged; invalid options now throw in tests, as they do
  in the browser.
- **Deterministic scalar maths (W1-2), optional.** `dmath` from `@engine` gives `sin`,
  `cos`, `atan`, `atan2`, `exp`, `log`, `pow`, `sqrt` and `hypot` results that are the
  same bits in every JavaScript engine. It is built only from correctly rounded
  operations and is within 1 ulp of V8's `Math`. Golden vectors are committed as hex,
  and `npm run test:dmath-browser` compares Chromium with Node. The character,
  locomotion and root-motion kits take `math: 'deterministic'`; the default is
  unchanged. See [deterministic maths](docs/guides/deterministic-math.md).
- **Two players in one world (MP-01, candidate, #61).** `@kits/network` now exports a
  game-facing shared session: `defineSessionRules` (one pure rules file shared by the
  page and the host), `createSession` (join, predict, reconcile, paced reconnect, close
  policy) and the transport-neutral `createSessionHost` (intake, scoped views, frame
  rate limit, integrity in observe mode). `npm run host` runs a game's `session.ts` on a
  development loopback/LAN WebSocket host, and the `shared-world` template plus the
  [recipe](docs/recipes/two-players-one-world.md) put two browser tabs in one world.
  LAN/loopback only: no accounts, matchmaking, NAT traversal or WAN certification.
- **Each game ships only its own static files.** A game keeps its models, textures and
  sounds in `game/public/` (served and built at the same paths); a build no longer
  carries the mechanics template's files. The mechanics fixtures moved to
  `templates/mechanics/game/public/`. `game/public/` is Vite's public folder, so the
  dev server and the build serve the same files the same way; a game without one falls
  back to the root `public/`, which the engine leaves empty. The dev server and the
  build stop on files left in the root `public/` beside a `game/public/`, on a symbolic
  link, and on the names the build writes itself (`index.html`, `LICENSE.txt`,
  `COPYRIGHT.txt`, `THIRD_PARTY_NOTICES.txt`) (W1-5).
  **Migration:** the root `public/models/mechanics/`, `public/textures/mechanics/` and
  `public/sounds/mechanics/` files are gone. A game made from the mechanics template,
  or one that followed the old load-a-model recipe and points at those files, should
  copy `templates/mechanics/game/public/` into its own `game/public/`
  (`cp -r templates/mechanics/game/public game/`) and keep its asset URLs as they are.
- **A home for a game's asset-making scripts.** Build-time Node scripts go in
  `game/tools/`: `lint:layers` lets them import `node:` modules, game code may not
  import them (`game-imports-no-tools`), and neither the build nor the game's
  definitions include them. The mechanics generators moved to
  `templates/mechanics/game/tools/`. New recipe: [where your game's files
  go](docs/recipes/your-game-files.md) (W1-6).
- **The bench no longer measures a scene that has ended.** An active window whose held
  keys drive the scene but that renders no frame is classified `inconclusive`: the gate
  fails it as "perf inconclusive" even when its zeros would pass, and `perf:derive`
  derives no budget for that scene. The keys drive the scene when its `budgets.json` row
  names them (new `activeKeys`) or when they press one of the game's own inputs; an
  active window whose keys press nothing in the game is a still window, like an idle one
  (classification version 3) (W1-4).
- **Particle emitters (FX-01), optional.** `Emitter`/`defineEmitter`/`burst` in the author
  API, drawn in scenes that opt in with `defineScene({ particles: sceneParticles() })`: burst and continuous emitters with lifetime, speed, direction/spread, gravity, drag
  and size/colour/opacity curves, an optional texture asset and additive or normal
  blending. Each emitter is one instanced draw (two triangles per live particle) and
  nothing while idle; simulation is on the fixed step with its own seeded random stream
  (never `ctx.random`, so effects cannot shift a game's random sequence or replays).
  Over-limit one-shot effects are dropped and counted, never fired late. Bounded per emitter (`max`) and per scene (`sceneParticles({ max, emitters })`,
  default 16 emitters and 4,096 particles), with counted drops and reported refusals; a new
  `effects.particles` quality knob thins non-essential emitters on medium and low (not yet
  shown on the Graphics screen). `testScene` steps emitters and exposes their counters.
  [Recipe](docs/recipes/hit-sparks-and-pickups.md), [guide](docs/guides/particles.md),
  `npm run test:particle-browser`. Desktop software-GL evidence only (#63).

## 0.2.0 — 2026-10-03

The first release since the source went public: optional networking hardening and
anti-cheat building blocks, spatial audio and game sound files, textured materials,
six genre kits, and a newcomer toolchain for the community build day. See
[Known limits](#known-limits) before making support claims, and the
[acceptance ledger](docs/guides/upgrade-acceptance-ledger.md) for exact evidence per item.

### Highlights

- **Your own textures, materials and sound files.** `Material`/`defineMaterial` give a
  `Shape` a texture, repeat/wrap, roughness, metalness, emission and transparency;
  `defineAsset({ type: 'audio' })` files play through `ctx.play(id, { volume, pitch,
  position })` (#36, #37).
- **3D audio for shooters (AUD-01).** Per-voice HRTF panning with a voice limit and
  equal-power fallback, inverse/linear/exponential distance models, a hard
  `cutoffDistance`, a smoothed muffle filter and smoothed movement (#28).
- **Six genre kits.** Rollback sessions, a deterministic turn log, a spatial grid,
  seeded procedural generation, tunable jump feel and an audio-clock timeline for
  rhythm games (#23, #24, #25, #31, #34, #38).
- **Multiplayer hardening and host-side anti-cheat.** Reconnect backoff, rate
  limiting, queue deadlines, close reasons, planned drain and an optional command
  integrity layer (SEC-01 slice A) at the authoritative host (#12–#14, #16, #20, #21, #33).
- **Replay and divergence detection (SIM-01).** Record a run, replay it exactly and
  find the first tick where two runs differ (#17).
- **Newcomer toolchain.** Node 22.18+ checked up front, friendly missing-browser
  message, Windows-safe scripts, `--game <dir>`, phone testing over Wi-Fi, fixed
  generators, `npm run gate:ci`, sub-path hosting and a getting-started guide
  (#18, #30, #32, #35, #39).
- **Current toolchain.** three.js 0.186, TypeScript 6 and Vite 8 (#29, #43, #44).

### Input & feel

- A press is now seen by exactly one fixed tick, including on 120 Hz+ displays and
  frames that run no fixed tick (`createPressLatch`, STD-SIM-12); previously a press
  could be lost or counted by several ticks (#19).
- Opt-in `hold: true` author buttons so `ctx.input.held` observes a release (#34).
- Input timestamps in audio time, `ctx.input.pressedAt()` (#31).
- Phone layout for lessons: the board, captions and quiz no longer overlap the
  controls on compact screens; 48 px touch targets and 16 px text (DV-01 work, #9).

### Rendering & assets

- Program preparation: shader programs are prepared and link-validated before a
  scene's first frame, with optional submitted-frame readiness and graceful
  fallback instead of refusing the scene (#10).
- Cooperative dependency preparation: asset loading yields to the frame and the
  critical closure loads first (#11).
- Bounded asset residency (RES-01): optional per-preset texture/model byte budgets,
  pinned ids, LRU eviction of released assets and a pressure hook,
  `defineGame({ residency })` (#22).
- Authored materials: `Material`, `defineMaterial`, `validateMaterial`; textured
  `MeshStandardMaterial` surfaces leased from the shared texture library, anisotropy
  from the quality preset. Shapes without a material are unchanged (#36).
- three.js 0.186 (from 0.183) as a deliberate migration: the version-checked
  private-state adapters are re-verified and pinned to r186, world-matrix reads keep
  r183 results, and upstream shading changes (multi-scattering energy compensation
  for `MeshStandardMaterial`) slightly alter some pictures (#29).

### Audio

- Spatial audio voices (AUD-01): `panning: 'HRTF'` with a per-preset HRTF voice
  limit and diagnostics, `distanceModel` with bounded `refDistance`/`maxDistance`/
  `rolloffFactor`, model-independent `cutoffDistance`, optional low-pass/gain filter
  stage, smoothed position and listener ramps, `defineGame({ audio })` and an
  optional `sound.headphone-3d` setting. The mechanics template's ineffective
  `maxDistance: 60` is now `cutoffDistance: 60` (#28).
- Game sound files: mp3/m4a/ogg/wav through `ctx.play` and `ctx.playVoice`,
  `defineScene({ sounds })` preloading, bounded file, encoded and decoded caches,
  concurrent fetch/decode limits and once-only failure reports; mute, effects
  volume, autoplay unlock and test-browser silence apply unchanged (#37).

### Networking & multiplayer

- Queue age and submit deadlines (NW-06): optional `maxQueuedAgeMs` shedding and
  `submit(command, { deadlineMs })` that expires only before storage starts (#12).
  Follow-up: age shedding no longer consumes the pump budget, fixing a goodput
  collapse found by the overload probe (#33).
- Shared rate and concurrency admission (NW-05): `createRateAdmission` token buckets,
  used by the reference hosts (#13).
- Reconnect pacing (NW-04): `createRetrySchedule` with full-jitter backoff and a retry
  budget (#14); validated remote close reasons and `createClosePolicy`, so a rejected
  login stops after one attempt (#16).
- Planned drain and capped connection lifetime (NW-08): `createConnectionDrain` and
  `createDrainFollower` (#21).
- Seeded fault-schedule harness (NW-09, tools only): `npm run faults:network` replays
  combined link, host, storage and clock faults with per-step invariants (#26).
- Overload and goodput probe (NW-07, tools only): `npm run probe:network` (#27).
- **Anti-cheat, slice A (SEC-01):** optional host-side `createIntegrity` with pure
  validity rules usable inside the authority reducer, decaying violation scores, a
  tick-rate budget, throttle, windowed close (`integrity-violation`), observe mode, a
  bounded local audit log and an `assertDisclosure` test helper; SECURITY.md links
  the [integrity guide](docs/guides/integrity.md) (#20).

### Genre kits

- **Rollback** (`@kits/rollback`, RB-01): `createRollbackSession` for 2–8 peers with a
  prediction window, input delay, resimulation and confirmed-state checksums, plus
  `createRollbackSyncTest` (#25).
- **Turns** (`@kits/turns`, TB-01): deterministic command log with undo, redo,
  preview, replay and durable-authority composition (#24).
- **Spatial grid** (`@kits/spatial`, SC-01): `createSpatialGrid` for neighbour,
  range and interest queries with explicit bounds (#23).
- **Procedural generation** (`@kits/procgen`, GEN-01): integer-only `deriveSeed` in
  core and bounded seeded grid generation jobs on the existing worker host (#38).
- **Jump feel** (locomotion kit, MV-01): frame-rate-independent `createJumpFeel` and
  `jumpSystem` with coyote time, jump buffer, variable height and apex gravity (#34).
- **Rhythm timeline** (AU-01): `createAudioTimeline` uses the audio clock as the
  master timeline, with latency calibration and bounded lookahead scheduling (#31).

### Tooling & DX

- `npm run gate:ci` runs the exact CI workflow steps locally (#18).
- Onboarding: Node.js 22.18+ required and checked with a one-line message (`.nvmrc`,
  `.node-version`); a missing test browser stops with the install command and an
  installed Chrome/Chromium is found per OS; tools start without `npx` or shell
  quoting for native Windows (not yet verified on Windows hardware); `--game <dir>`
  on any shell; `npm run play -- --host` for phone testing on a trusted network;
  a wrong `GAME_DIR` lists the templates (#30).
- Generators: `npm run new -- input` picks bindings free in the boot table;
  `npm run check` runs the boot's input validation; `new-game --force` replaces
  cleanly; `play:snap` forces a real draw and reports `not measured` instead of a
  vacuous "within budget"; template playtests live in each game folder (#39).
- Sub-path hosting: asset files follow the build's public base, so
  `npm run build -- --base ./` works on GitHub Pages or itch.io; new
  `test:subpath-browser` CI step (#35).
- Diagnostics: replay log and divergence detector (SIM-01, `@kits/replay`, dev/test
  `engine.replay`) (#17) and a sustained-session performance recorder (PERF-01,
  dev/test only, nothing leaves the device) (#15).
- TypeScript 6.0 (from 5.9), `baseUrl` dropped (#43). Vite 8 (from 7, Rolldown/Oxc/
  Lightning CSS); first-load JS is about 5–9 KiB smaller per template (#44).
- GitHub Actions updated and major/three-minor dependency upgrades made deliberate
  in Dependabot (#1, #2, #8).

### Docs

- Getting-started guide, cookbook (models, HUD and buttons, collision and picking,
  camera and lighting, sharing a build), a README per template, "Not here yet" in the
  README and a solo-game/build-day workflow in AGENTS.md and the agent skills (#32).
- Guides and recipes for every new framework above (in their PRs).
- Public-repository wording and private-history labels (#6).

### Fixes

- SQLite multi-process test waits for writers to exit before reading back (first
  public CI failure) (#5).
- Load-sensitive tests wait on conditions instead of wall-clock time (terrain S5,
  PERF-01 stall check); no assertion or tolerance changed (#41).
- Learn template: the objectives card no longer returns over later drawings; ui kit
  HUD lines and prompt gain a readability plate; mechanics sky cube no longer blurs
  on phones; `play:script` gains `holdUntil` (#40).
- Mechanics template: `maxDistance: 60` had no audible effect; replaced by
  `cutoffDistance: 60` (#28).

### Known limits

- **Physical devices:** DV-01 is open. Phone, tablet, laptop and desktop evidence is
  emulated or software-rendered; minimum device profiles are not chosen yet. No
  physical-device, thermal or accessibility certification.
- **Multiplayer:** evidence is loopback/LAN and process scope only. No WAN, power-loss,
  multi-host or scale certification, and no newcomer-runnable multiplayer session.
- **Audio:** HRTF localisation quality, mobile CPU cost and sound-file latency and
  loudness are unverified by ear or on devices; test browsers are muted.
- **Anti-cheat:** SEC-01 is server-side only (the authoritative host). Its evidence is
  unit and loopback host tests with modelled probes; it makes no detection-quality or
  real-world cheat-resistance claim. Client-side checks in a browser are not a
  security boundary. Verified runs (slice B) are designed, not built.
- **Determinism:** replay, rollback, turns and procgen are deterministic for the same
  build and inputs; floating-point results across browsers, devices and CPUs are not
  guaranteed identical.
- Native Windows tooling is covered by unit tests, not yet run on Windows hardware.

## 0.1.0 — 2026-10-01 (first public source, untagged)

The source was published as a one-commit export (`c0e73c9`). No package or GitHub
Release was published for this version.

- Genre-neutral TypeScript/three.js runtime, author API, owned lifetimes, input,
  persistence, assets, workers and engineering checks.
- Seven stock starting templates and optional frameworks for terrain, authored
  content, state composition, diagnostics and network authority/prediction.
- GPL-3.0-only engine license and separately documented third-party/asset licenses.
- Contributor, security, governance and release preparation documentation.
