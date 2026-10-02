# Release notes draft: Foundation Engine 0.2.0

Draft for the GitHub Release and the community announcement. **Not published.**
Tagging, creating the GitHub Release and posting the announcement need the author's
go-ahead after the batch PRs (#42, #45, #46, #47) and the release-preparation PR
merge and CI passes on the exact release commit. The full list with PR numbers is in
the [changelog](../../CHANGELOG.md).

---

## Foundation Engine 0.2.0 — 2026-10-03

The first release since the source went public. Everything new is optional: a game
that does not use a framework is unchanged.

### Highlights

- **Your own textures, materials and sound files.** `defineMaterial` gives a `Shape`
  a texture, repeat and wrap, roughness, metalness, emission and transparency.
  `defineAsset({ type: 'audio' })` files play through `ctx.play(id, { volume, pitch,
  position })`. Recipes: [give a shape a material](../recipes/give-a-shape-a-material.md),
  [play your own sounds](../recipes/play-your-own-sounds.md). (#36, #37)
- **3D audio.** HRTF panning with a voice limit and equal-power fallback, distance
  models with a hard cutoff, a muffle filter and smoothed movement
  ([guide](spatial-audio.md)). (#28)
- **Six genre kits.** Rollback sessions for fighting games, a deterministic turn log
  with undo/redo/replay, a spatial grid for many units, seeded procedural generation,
  tunable jump feel (coyote time, jump buffer) and an audio-clock timeline for rhythm
  games. (#23, #24, #25, #31, #34, #38)
- **Multiplayer hardening.** Reconnect backoff with jitter, shared rate limiting,
  queue deadlines, close reasons, planned drain, a seeded fault harness and an
  overload probe. (#12–#14, #16, #21, #26, #27, #33)
- **Host-side anti-cheat, slice A.** Optional `createIntegrity` validity rules,
  violation scoring, throttle and close, observe mode and a local audit log at the
  authoritative host ([guide](integrity.md)). (#20)
- **Replay and divergence detection.** Record a run, replay it exactly and find the
  first tick where two runs differ. (#17)
- **Input you can trust at 120 Hz+.** A press reaches exactly one fixed tick. (#19)
- **Faster first frames.** Shader programs and critical assets are prepared before a
  scene shows; optional texture/model residency budgets. (#10, #11, #22)
- **Newcomer toolchain.** Node 22.18+ checked up front, a clear message when the test
  browser is missing, Windows-safe scripts, `--game <dir>`, phone testing over Wi-Fi,
  generators that never write clashing bindings, sub-path hosting for GitHub Pages and
  itch.io, `npm run gate:ci`, and a [getting-started guide](getting-started.md).
  (#18, #30, #32, #35, #39, #40)
- **Current toolchain.** three.js 0.186, TypeScript 6 and Vite 8. (#29, #43, #44)

### Upgrading from 0.1.0

- Node.js **22.18 or newer** is now required (`.nvmrc` selects Node 22).
- three.js 0.186 slightly changes `MeshStandardMaterial` shading (multi-scattering
  energy compensation). Engine adapters are re-verified and pinned to r186.
- `tsconfig.json` no longer sets `baseUrl`; the `@engine`, `@kits/*` and `@game/*`
  paths resolve to the same files.
- Template playtest scripts moved into each game folder (`game/playtest/`).
- `play:snap` now forces a real draw when a still scene does not redraw, and reports
  `not measured` instead of a vacuous "within budget". A budget that passed only
  because nothing was drawn can now fail.
- The learn timeline's objectives card stays down once the learner passes the next
  gate after it.

### Known limits

- **Physical devices:** device acceptance (DV-01) is still open. Phone, tablet,
  laptop and desktop evidence is emulated or software-rendered; minimum device
  profiles are not chosen yet.
- **Multiplayer:** verified on loopback/LAN and in process scope only. No WAN,
  power-loss, multi-host or scale certification, and no ready-to-run multiplayer
  session for newcomers yet.
- **Audio:** HRTF localisation, mobile cost and sound-file latency/loudness have not
  been verified by ear or on devices (test browsers are muted).
- **Anti-cheat:** server-side only, with unit and loopback evidence from modelled
  probes; no detection-quality claim. Client-side checks in a browser are a speed
  bump, not a security boundary. Verified runs (slice B) are designed, not built.
- **Determinism:** replay, rollback, turn logs and seeded generation repeat exactly
  for the same build and inputs; floating-point results across browsers, devices and
  CPUs are not guaranteed identical.
- Native Windows tooling is unit-tested but not yet run on Windows hardware.
- Still not here: particles, rigid-body physics and a newcomer-runnable multiplayer
  session (see the README's "Not here yet").

### Security

Private vulnerability reporting is enabled: use **Report a vulnerability** on the
repository's Security tab ([SECURITY.md](../../SECURITY.md)).

### Source

Foundation Engine is GPL-3.0-only. This release is the tagged source tree; third-party
packages and sample assets keep the licenses in `THIRD_PARTY_NOTICES.md`. No npm
package is published.

---

## Discord announcement draft (not posted)

> **Foundation Engine 0.2.0 is out** (source on GitHub, GPL-3.0)
>
> Just in time for community build day:
> • Your own **textures, materials and sound files**, plus **3D audio** (HRTF, distance cutoff, muffle)
> • **Genre kits**: rollback (fighting), turn log with undo/redo, spatial grid, seeded procgen, jump feel, rhythm timeline
> • **Multiplayer hardening** + host-side **anti-cheat** building blocks
> • **Replay + divergence detection**; presses no longer get lost on 120 Hz screens
> • **Easier start**: Node check, browser install hint, Windows-safe scripts, phone testing over Wi-Fi, GitHub Pages/itch.io hosting, a getting-started guide
>
> Everything is optional; pick what your game needs.
>
> Honest limits: real phone/tablet testing is still open, multiplayer is verified on loopback/LAN only, 3D audio hasn't been checked by ear yet, and browser-side anti-cheat is a speed bump, not a wall.
>
> Getting started: <link to docs/guides/getting-started.md>
> Release notes: <link to the GitHub Release>
