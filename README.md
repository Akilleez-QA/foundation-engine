<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/lockup-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/brand/lockup-light.svg">
    <img alt="Foundation Engine" src="assets/brand/lockup-light.svg" width="480">
  </picture>
</h1>

[![CI](https://img.shields.io/github/actions/workflow/status/Akilleez-QA/foundation-engine/ci.yml?branch=main)](https://github.com/Akilleez-QA/foundation-engine/actions/workflows/ci.yml?query=branch%3Amain)
[![GPL-3.0-only](https://img.shields.io/static/v1?label=license&message=GPL-3.0-only&color=blue)](LICENSE)
[![Node.js >= 22.18](https://img.shields.io/static/v1?label=node&message=%3E%3D22.18&color=brightgreen)](package.json)

A layered TypeScript and three.js engine for browser games of any genre, with explicit engineering contracts, automated checks and application-specific acceptance requirements.

## Choose your starting point

- **[Make a game](docs/guides/getting-started.md)**: clone, run the arcade template, change its player colour, check it and build a static site. Git, Node.js 22.18+ and npm are required; an AI account is optional.
- **[Contribute to the engine](CONTRIBUTING.md)**: reproduce a problem, find the relevant contract and submit a focused change. Keep your own game on its own branch.
- **[Explore the templates](#templates)** or [browse task recipes](docs/recipes/README.md). Foundation is distributed as source and tooling, not an npm library or visual editor.

Try the arcade example without creating a game: after cloning and running `npm ci`, run `npm run play -- --game templates/arcade/game`. Steer with the arrow keys and press Space after a collision to restart. This runs locally; no hosted demo is required.

## What's new in 0.2.0

- **Your own textures, materials and sound files**: `defineMaterial` for textured, physically based shapes; `defineAsset({ type: 'audio' })` files through `ctx.play` with volume, pitch and position.
- **3D audio**: HRTF panning, distance models with a hard cutoff, a muffle filter and smoothed movement.
- **Genre kits**: rollback sessions, a deterministic turn log, a spatial grid, seeded procedural generation, tunable jump feel and an audio-clock timeline for rhythm games.
- **Multiplayer hardening**: reconnect backoff, rate limiting, queue deadlines, planned drain, and optional host-side command integrity (anti-cheat, slice A).
- **Replay and divergence detection**, a sustained-session performance recorder, and presses that reach exactly one fixed tick on high-refresh displays.
- **Newcomer toolchain**: Node 22.18+ check, friendly missing-browser message, Windows-safe scripts, `--game <dir>`, phone testing over Wi-Fi, sub-path hosting, `npm run gate:ci`; three.js 0.186, TypeScript 6 and Vite 8.

Every new framework is optional. See the [changelog](CHANGELOG.md#020--2026-10-03) for the full list with PR numbers and its known limits: physical-device acceptance is still open, multiplayer evidence is loopback/LAN only, and spatial audio has not been verified by ear.

- **Author API** (`@engine`): `defineGame`, `defineScene`, `defineEntity`, `defineComponent`, `defineSystem` (fixed-step or per frame), `defineInput` (buttons and axes over keys, pointer, touch and gamepad), `defineSaveSection` (with migrations), `defineAsset`, `defineMode`, and the build brief `defineBuild`. A game is scenes; a scene is a small ECS world driven by systems.
- **Kernel**: modules boot in fixed phases (discover, register, patch, freeze, validate, install, start). Open sets live in validated, frozen registries. A typed event bus, typed services and read-on-demand probes connect systems.
- **Runtime**: one frame loop that renders on change; activities with owned lifetimes; a hash router (`#scene/<id>?key=value`) with navigation epochs, lazy scene chunks and a scene shell (loading and failure cards).
- **Persistence**: one save store with typed sections, per-player scope, migrations, quarantine, and generated export, import and reset.
- **Platform**: a renderer pool with quality presets, an input action map with reachability checks, a layer stack, the one audio output (silent under test), a worker host, and asset leases.
- **Kits** (optional, chosen per game): genre patterns built on the author API: [the kit catalog](docs/kits/README.md). The engine runs with none. See [docs/ROADMAP.md](docs/ROADMAP.md) for what may come.
- **Tooling**:
  - `npm run gate`: typecheck, lint ratchets, tests, the bundle check, and a muted Playwright bench with per-scene budgets;
  - a budget ratchet (raises need a `Perf-Budget:` trailer);
  - a picture guard (identical, near or reviewed);
  - a production deploy guard;
  - a genericity check that keeps genre vocabulary out of the core.

## Engine boundary

Foundation Engine is malleable infrastructure for independently authored games. Creators can select, configure, extend, replace or omit its frameworks and choose their own game constraints and workflow. Its core owns lifetimes, scheduling, rendering, assets, input, persistence and tooling; it does not prescribe a world, story, economy, progression system or learning curriculum.

Optional kits provide reusable domain patterns. They are not required engine dependencies or a mandate to reproduce another game's feature set. Templates are small diagnostic consumers and starting points, not a game being developed in this repository. Research is evidence for engineering decisions, not an implementation backlog by itself. For engine contributions, we record a reusable contract, ownership, limits and integration evidence. Independent games can adopt or adapt this stock workflow.

The [creator contract](docs/CREATOR-CONTRACT.md) separates engine guarantees, creator choices and agent implementation responsibilities, including runtime checks versus measured and manual evidence.

## Templates

A game lives outside the engine, in `game/` (or any folder named by `GAME_DIR`). Without one, the engine builds `templates/blank/game`. Start a game with `npm run new-game -- --template <name>`:

| Template | What | Kits |
|---|---|---|
| [`blank`](templates/blank/README.md) | one scene, one entity, one input | none |
| [`arcade`](templates/arcade/README.md) | a lane dodger: score, fail state, instant restart, best score saved | ui |
| [`explorer`](templates/explorer/README.md) | two scenes to move around in, things to use, doors between them | ui, camera, character, explore |
| [`learn`](templates/learn/README.md) | a lesson: a chalkboard with a teacher's and a classmate's lines as captions, a sim to turn, a quiz ([learn mode](docs/guides/learn-mode.md)) | ui, camera, concept-explorer, learn (and chalkboard) |
| [`terrain`](templates/terrain/README.md) | canonical surface, contact, finite detail levels and coherent revisions | terrain, character |
| [`expedition`](templates/expedition/README.md) | guided routes, persistent completion and bounded production | navigation, objectives, inventory and supporting kits |
| [`mechanics`](templates/mechanics/README.md) | ownership, attachments, local transactions and action results | frames, vehicles, control and supporting kits |
| [`showcase`](templates/showcase/README.md) | a lantern-lit night courtyard and a daylight garden: how good the author API can look | ui, camera, character, explore |
| [`shared-world`](templates/shared-world/README.md) | two or more players on one board through a local `npm run host` ([recipe](docs/recipes/two-players-one-world.md)) | ui (and `@kits/network`) |

Each template's README lists what is in it, its controls and what to change first. Each template passes the gate on its own: `GAME_DIR=templates/<name>/game npm run gate`.

## Start

Requires Git, Node.js 22.18 or newer (CI uses Node.js 22; `.nvmrc` and `.node-version` select Node 22 for nvm, fnm and similar tools) and npm. The scripts load TypeScript with Node's built-in type stripping, which Node 22 enables from 22.18; older versions stop with a one-line message. This repository is the engine source and tooling; it is not currently published as an npm library. [Getting started](docs/guides/getting-started.md) explains every step.

```sh
git clone https://github.com/Akilleez-QA/foundation-engine.git
cd foundation-engine
npm ci
npx --no-install playwright-core install chromium     # needed for automated browser checks
npm run new-game -- --template arcade --id my-game --title "My game"
git switch -c my-game && git add game GAME.md && git commit -m "Start my game"
npm run play          # open the printed URL; stop with Ctrl+C before the next command
# Make the first edit described in Getting started, then:
npm run check         # types, lints, the brief, the affected tests
npm run play:snap     # screenshots and a probe in playtest/latest/
npm run build         # dist/: a static site to share (`-- --base ./` to host it in any folder)
```

Without a `game/` folder, every command builds `templates/blank/game`. `npm run dev` starts the same dev server as `npm run play`, which also prints your first scene's address (`PORT=5174 npm run play` if 5173 is taken). The [cookbook](docs/recipes/README.md) covers models, HUD and buttons, collision and picking, camera and lighting, and sharing a build. With a coding agent, see [working with your agent](docs/guides/working-with-your-agent.md).

A clean committed checkout can select zero tests with `npm run check`; read its test summary. The [first-game guide](docs/guides/getting-started.md#6-check-it) includes an explicit arcade test command. For engine contributions, follow [CONTRIBUTING.md](CONTRIBUTING.md) for scoped checks and integration evidence.

On Linux, Playwright's Chromium may also need system libraries: `npx playwright-core install-deps chromium` (needs root).

The bench, `play:snap` and the gate drive Chromium through `playwright-core`. They use `ENGINE_CHROMIUM` if it is set (any Chrome or Chromium executable or wrapper script), then Playwright's installed Chromium, then an installed Chrome or Chromium in its usual folder for the OS (Linux: the real `/usr/lib/chromium/chromium` and similar binaries before `/usr/bin` launchers, because distribution launchers apply the user's own flag files; macOS: `/Applications`; Windows: Program Files and the user's AppData). `ENGINE_CHROMIUM_SYSTEM=0` skips installed browsers. With no browser they stop with one line naming the install command. When the bench runs as root (for example in a container), it adds `--no-sandbox`. It always adds `--mute-audio`. Only `npm run play` and `npm run dev` watch files for changes; `play:snap`, `play:script`, `play:criteria` and the browser checks start no file watcher (the checks through `ENGINE_WATCH=0`, set by `scripts/silent-browser.cjs`), and the bench and gate serve a finished build, so none of them uses the machine's inotify watches.

### Choosing a game on any shell

Without a `game/` folder the blank template runs. `--game <dir>` selects another game for `npm run play`, `play:snap`, `play:criteria`, `check` and `gate`, for example `npm run play -- --game templates/arcade/game`. Setting `GAME_DIR` works too: `GAME_DIR=templates/arcade/game npm run dev` (bash, zsh, WSL), `$env:GAME_DIR="templates/arcade/game"; npm run dev` (PowerShell) or `set GAME_DIR=templates/arcade/game&& npm run dev` (cmd.exe). A folder without a `game.ts` stops with a list of the template folders. The `test:*-browser` scripts are written for CI's bash; on Windows run them from WSL or Git Bash.

### Test on your phone over Wi-Fi

`npm run play -- --host` (or `npm run dev -- --host`) also listens on your local network and prints a `Network:` URL; open it on a phone on the same Wi-Fi. By default both listen on 127.0.0.1 only. With `--host`, anyone on that network can reach the dev server, its source files and the test API while it runs: use it on a network you trust (not public Wi-Fi), and stop it with Ctrl+C when done. `ENGINE_HOST=1` does the same as `--host`; `--host <address>` binds one address. A phone in the browser is still not device acceptance; see the [device experience policy](docs/policy/DEVICE-EXPERIENCE.md).

## Not here yet (and workarounds)

The current state as of 0.2.0 (October 2026). Textures and materials ([recipe](docs/recipes/give-a-shape-a-material.md)) and your own sound files ([recipe](docs/recipes/play-your-own-sounds.md)) are supported. After 0.2.0, optional particle emitters (hit sparks, pickups, trails, smoke: one draw per emitter; [recipe](docs/recipes/hit-sparks-and-pickups.md), [guide](docs/guides/particles.md)) are supported too, with desktop software-GL evidence only (FX-01 in the acceptance ledger), as are opt-in tone mapping and exposure per scene and point and spot lights in fixed per-scene slots ([scene look](docs/guides/scene-look.md), VIS-01 and VIS-02). These are still missing:

| Not here yet | What exists today | Workaround |
|---|---|---|
| Rigid-body physics | Overlap tests in systems; the character kit's kinematic movement with `Walls` and `Solid` blocking | Write simple motion in a fixed-step system (velocity, gravity, stop at the ground); [collision and picking](docs/recipes/collision-and-picking.md) |
| Internet multiplayer (WAN hosting, accounts, matchmaking, NAT traversal) | A LAN/loopback shared session: shared rules in `@kits/network`, a development `npm run host` and the `shared-world` template ([two players in one world](docs/recipes/two-players-one-world.md)); the network kit's admission, views, authority and prediction contracts underneath | Play on one machine or a trusted local network; a public deployment needs your own server, TLS, identity and hardening |

Each template passes the gate on its own: `npm run gate -- --game templates/<name>/game` (any shell; `GAME_DIR=templates/<name>/game npm run gate` also works in POSIX shells).

## Read next

- [Documentation index](docs/README.md): every guide by route.
- [Getting started](docs/guides/getting-started.md): from a clone to a shared build, by hand or with an agent; then the [cookbook](docs/recipes/README.md).
- [docs/GOALS.md](docs/GOALS.md): defined engine outcomes, acceptance criteria and scope.
- [Capability map](docs/guides/composition-framework-status.md): existing optional frameworks and remaining work.
- [Upgrade acceptance ledger](docs/guides/upgrade-acceptance-ledger.md): integrated revisions, verification boundaries and unresolved requirements.
- [Framework upgrade record](docs/guides/framework-upgrade-status.md): implemented contracts and representative consumers.
- [Complete scoped views](docs/guides/network-views.md): creator-selected disclosure, bounded application credit, replacement and lifecycle recovery; see the acceptance ledger for integration status.
- [Durable authority](docs/guides/durable-authority.md) and [prediction](docs/guides/prediction.md): optional contracts integrated in PR #123 in the private development history at `b6fb4a3`, after clean native acceptance and all seven gates, and included in public `main` since `c0e73c9`. Physical-device acceptance remains open.
- [Optional network admission](docs/guides/network-admission.md): intake, browser transport and the loopback diagnostic; replication and durability remain separate.
- [AGENTS.md](AGENTS.md): how work is done here: building your own game, and for engine contributions worktrees, the gate and releases.
- [docs/STANDARD.md](docs/STANDARD.md): the twelve laws and every clause.
- [Device experience policy](docs/policy/DEVICE-EXPERIENCE.md): separate phone, tablet, laptop and desktop UI/UX and quality/performance acceptance.
- [docs/APPLICATION.md](docs/APPLICATION.md): the template for applying the standard to your game.
- [docs/recipes/](docs/recipes/README.md): the cookbook (models, HUD and buttons, collision and picking, camera and lighting, sharing a build) and the building blocks (a scene, an entity and component, a system, an input action, a save section, a budget, a kit or a template), plus giving a shape a material, playing your own sound files, hosting a build under a sub-path and two players in one world.
- [docs/adr/](docs/adr/README.md): the decisions behind the design.
- [docs/policy/KID-SAFE.md](docs/policy/KID-SAFE.md): an opt-in stricter player-protection profile.
- [docs/PROVENANCE.md](docs/PROVENANCE.md): where this engine came from.

## Layout

```
src/core/       L0 kernel: modules, registries, events, save, settings, router, activities, ECS world, clock, i18n
src/platform/   L1 render, input, UI shell, audio, assets, workers, perf schema (no game nouns)
src/domain/     L2 maths and fixed-step simulation hosts (no DOM, no three.js)
src/author/     the author API (`@engine`): definitions, the compiler to engine modules, the scene runtime, testScene
src/kits/       optional genre kits on the author API (`@kits/<name>`); core, platform and author never import them
src/features/   L3 engine-level features and packs, discovered by folder
src/app/        L4 composition root: the game (`@game`) plus the core and platform modules
src/dev/        the test API (dev and test builds only)
templates/      starting games (`templates/<name>/game`), each with its brief, budgets and GAME.md
perf/           budget loader, baselines and quality views
scripts/        lint, perf, gate, play, deploy guard
tools/          optional authoring workbenches and diagnostic consumers
```

## Release history

This public source line begins with a clean history. Earlier commit and pull-request
identifiers in verification records refer to the private development archive; those
links require maintainer access and are not public review evidence. Included reports
retain their stated scope. Mobile layout and physical-device acceptance are still
in progress; see the acceptance ledger before making support claims.

## Licence

Copyright © 2026 Akilleez-QA and contributors. Engine code is licensed under **GPL-3.0-only**; see [LICENSE](LICENSE). Third-party packages and designated assets retain the licenses recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

See [GOVERNANCE.md](GOVERNANCE.md), [SUPPORT.md](SUPPORT.md) and [CHANGELOG.md](CHANGELOG.md).

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and contribution guidance, [SECURITY.md](SECURITY.md) for vulnerability reporting, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for participation expectations. Repository visibility and publication are separate release steps.

```text
 88"""" o8""8o 88  88 88o 88 88""8o o8""8o ""88"" "88" o8""8o 88o 88
 88ooo  88  88 88  88 88"888 88  88 88oo88   88    88  88  88 88"888
 88     88  88 88  88 88  88 88  88 88  88   88    88  88  88 88  88
 88      8888   8888  88  88 88888  88  88   88   8888  8888  88  88

           [####]            88"""" 88o 88 o8"""" "88" 88o 88 88""""
        [====][====]         88ooo  88"888 88 ooo  88  88"888 88ooo
     [====][====][====]      88     88  88 88  88  88  88  88 88
  [====][====][====][====]   888888 88  88  88888 8888 88  88 888888
 [#################################################################]
```

Brand assets, palette and copy-paste banners: [docs/brand.md](docs/brand.md).
