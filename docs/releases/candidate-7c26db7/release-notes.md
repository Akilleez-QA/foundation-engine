# Release notes draft: Foundation Engine 0.3.0 (proposed)

**Status: prepared, not released.** The version number 0.3.0 and the date are proposed; the author decides
both. No tag, GitHub release, package or deployment exists for this candidate. The candidate is
`7c26db7efa5634d1e32b2c18a1a2e63451157f89` on `main` (the merge of #121, after #108); its evidence is in the [candidate bundle](README.md). The full list with PR links is
the [changelog](../../../CHANGELOG.md#030--proposed-author-decides).

Everything below happened after [v0.2.0](https://github.com/Akilleez-QA/foundation-engine/releases/tag/v0.2.0)
(tag `071e3c2`, PR #49). Every new framework is optional: a game that does not use it is unchanged.
Before upgrading a 0.2.0 game, read the [upgrade guide](upgrade.md); several checks are stricter now.

---

## Foundation Engine 0.3.0 (proposed)

### Make a game

- **A concrete first-game path.** The README and [getting started](../../guides/getting-started.md) take
  you from clone to a running arcade game, one edit, a check and a static build. Stale claims were
  corrected (#68, #109). A coding agent has its own reading path (#89).
- **Friendlier tooling.** A busy `play` or `host` port prints a one-line hint instead of a stack trace
  (#110). Non-interactive dev servers (`play:snap`, scripts, browser checks) no longer start a file
  watcher (#112). npm 12 installs quietly: reviewed install scripts are recorded in `allowScripts`
  (#111). Test-output parsing works on Node 23 and newer, and CI now also tests Node 26 (#108).
- **Game code is linted.** `npm run lint:game` refuses `Math.random()` and literal UI text in game
  code, with the file, line and fix for each finding (#90). This can fail a game that passed on 0.2.0.
- **Stricter types.** No explicit `any` (#99), and `noUncheckedIndexedAccess`, `noImplicitOverride` and
  `noImplicitReturns` are on across the engine, scripts and templates (#103, #105–#107, #114), and
  `verbatimModuleSyntax` keeps type-only imports marked (#120), and `exactOptionalPropertyTypes` is on (#121).
- **Prettier formatting.** `npm run format`; `npm run lint` and `check` include `format:check` (#101).

### Test your game

- **Reload tests.** `createTestSaves()` lets a game test reload its saves headlessly, and playtest
  scripts gain a `{"reload": true}` step. Playtest scripts are now validated before a browser starts
  (#94).
- **`testScene` reference.** Every option and result is documented; an unknown cue or sound id now
  fails the test instead of passing silently (#91). `t.voices` records `playVoice` options (#57).
- **Visit order.** A visit's `enter()` now runs before any of its systems step (#92).
- **Focused checks that select tests.** `npm run check -- --base origin/main` selects tests for
  committed changes, and `-- --all` runs the canonical full suite. Bad refs and unknown options fail
  loudly (#67).

### Input, feel and movement

- **Held touch buttons.** `touchButton(ctx, input, { label })` in `@kits/ui` gives touch players a held
  control, for example a variable-height jump (#57). Emulated evidence only.
- **Moving platforms (MV-02).** Ride, leave with the platform's velocity, and one-way catch, on the
  fixed step, in the locomotion kit (#53).
- **Input history and saveable random state (INPUT-01, RNG-01).** Frame-exact "pressed in the last N
  frames", motion sequences and a random state you can save and restore for rollback and replays (#52).

### Worlds, saves and content

- **Large edited worlds (GEN-02).** A bounded IndexedDB chunk store keeps a player's edits to any region
  across reloads; unedited regions cost nothing (#56). The recipe's save acknowledgement was fixed so
  edits made while a save is pending stay dirty (#95).
- **Accurate save import receipts.** An import that meets different existing bytes reports
  `orphan-conflict`; a storage error reports `orphan-failed` (#77). Exhaustive consumers of the import
  result must handle the new outcomes.
- **Strings and dialogue (TB-02).** `select`, `selectordinal`, a locale fallback chain, and dialogue
  variables, visit counts and conditions (#50).
- **Per-game static files.** Each game ships only its own `game/public/`; asset scripts live in
  `game/tools/` (#59). The mechanics template's files moved; see the upgrade guide.
- **A reproducible Blender export example.** An original one-metre block with scale, pivot and material
  checks (#74).

### Look and sound

- **Particle emitters (FX-01).** Burst and continuous emitters, one instanced draw each, bounded per
  emitter and per scene, with their own seeded random stream (#63). Desktop software-GL evidence only.
- **Music on the audio clock (AU-02).** Exact start, stop, seek and loops for rhythm games (#54).
- **Spatial-audio kit (AUD-02).** Virtual sources, ranking, cutoffs and budgeted occlusion for busy
  scenes (#55). Not verified by ear (test browsers are muted).
- **Static scenes redraw after a resolution-only quality change** (#83).
- **Smaller production runtime.** three's GLSL ships without comments (#100), and test-only classes stay
  out of the production scene runtime (#102).
- **Render backend seam.** The renderer pool now sits behind a backend interface; WebGL2 is still the
  only backend (#118). ADR 0078 records the decision to let a creator choose a backend later (#113).

### Play together

- **Two players in one world (MP-01).** A game-facing shared session, `npm run host` and the
  `shared-world` template put two browser tabs in one world on loopback or LAN (#61). The host CLI's
  start-up crash is fixed (#70). A fresh session baseline after a host restart and a client-only drop
  is asserted (#97).
- **Interest sets (SC-02).** Per-observer relevancy sets feeding scoped views (#51).

### Replays and determinism

- **Creator-chosen replay digest (SIM-02).** Exclude cosmetic state from the replay digest and get
  the first differing entity and component on a divergence (#58).
- **Deterministic scalar maths (W1-2).** Opt-in `dmath` gives the same bits in every JavaScript engine;
  the character kit takes `math: 'deterministic'` (#60).

### Evidence and contribution

- **Creator-journey and recovery evidence.** The explorer journey now covers save refusal and retry,
  interrupted scene changes and disposal (#72, #98); visible save refusal and durable retry (#76);
  repeated model cancellation, including after decode (#78, #116, #119); retained save migration
  fixtures (#79); a retained first-public-source consumer (#81) and a retained v0.2.0 baseline (#96);
  first-use observations on development and production builds (#73, #104); the bench restarts ended
  visits (#75) and keeps Playwright's selector engine out of the measured heap (#115).
- **Contributing.** Reproducible contributor setup (#80), contribution rules for systems and patterns
  (#69), entry points for questions, triage and conduct (#88), the creator-readiness goal (#71) and
  reconciled status records (#117). CI shards the template gates under one aggregate `check` (#82).
- **Brand.** An original 8-bit Plinth mark, icons and social preview (#93).

### Known limits

- **Physical devices:** nothing in this candidate was checked on a physical phone, tablet, laptop or
  desktop. CI is headless Chromium with software rendering; phone and tablet rows are emulated at
  best. See the [support matrix](support-matrix.md).
- **Multiplayer:** loopback and in-process only in CI; LAN between two machines and WAN are unverified.
  No accounts, matchmaking or NAT traversal.
- **Audio:** spatial audio, music timing and sound files are not verified by ear.
- **Determinism:** `dmath` is bit-identical across engines; plain `Math` results are not guaranteed
  identical across browsers or CPUs.
- **Newcomers:** onboarding evidence comes from simulated agent trials, not a human newcomer.
- **Windows and macOS:** CI runs on Linux only.

### Source

GPL-3.0-only. Third-party packages and sample assets keep the licences in
[THIRD_PARTY_NOTICES.md](../../../THIRD_PARTY_NOTICES.md). No npm package is published.
