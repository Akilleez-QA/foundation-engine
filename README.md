# Foundation Engine

A layered TypeScript and three.js engine for browser games of any genre, with explicit engineering contracts, automated checks and application-specific acceptance requirements.

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
| `blank` | one scene, one entity, one input | none |
| `arcade` | a lane dodger: score, fail state, instant restart, best score saved | ui |
| `explorer` | two scenes to move around in, things to use, doors between them | ui, camera, character, explore |
| `learn` | a lesson: a chalkboard with a teacher's and a classmate's lines as captions, a sim to turn, a quiz ([learn mode](docs/guides/learn-mode.md)) | ui, camera, concept-explorer, learn (and chalkboard) |
| `terrain` | canonical surface, contact, finite detail levels and coherent revisions | terrain, character |
| `expedition` | guided routes, persistent completion and bounded production | navigation, objectives, inventory and supporting kits |
| `mechanics` | ownership, attachments, local transactions and action results | frames, vehicles, control and supporting kits |

Each template passes the gate on its own: `GAME_DIR=templates/<name>/game npm run gate`.

## Start

Requires Node.js 22 or later and npm. This repository is the engine source and tooling; it is not currently published as an npm library.

```
npm ci
npm run dev          # http://127.0.0.1:5173/ (the blank template, or your game/)
npm test
npm run gate         # the full integration gate (needs Chromium; see below)
```

The bench and gate drive Chromium through `playwright-core`. They use `ENGINE_CHROMIUM` if it is set, then Playwright's installed Chromium, then `/usr/bin/chromium`. When the bench runs as root (for example in a container), it adds `--no-sandbox`. It always adds `--mute-audio`.

## Read next

- [docs/GOALS.md](docs/GOALS.md): defined engine outcomes, acceptance criteria and scope.
- [Capability map](docs/guides/composition-framework-status.md): existing optional frameworks and remaining work.
- [Upgrade acceptance ledger](docs/guides/upgrade-acceptance-ledger.md): integrated revisions, verification boundaries and unresolved requirements.
- [Framework upgrade record](docs/guides/framework-upgrade-status.md): implemented contracts and representative consumers.
- [Complete scoped views](docs/guides/network-views.md): creator-selected disclosure, bounded application credit, replacement and lifecycle recovery; see the acceptance ledger for integration status.
- [Durable authority](docs/guides/durable-authority.md) and [prediction](docs/guides/prediction.md): optional contracts integrated in PR #123 in the private development history at `b6fb4a3`, after clean native acceptance and all seven gates. Physical-device acceptance remains open; this private integration is not a public release.
- [Optional network admission](docs/guides/network-admission.md): intake, browser transport and the loopback diagnostic; replication and durability remain separate.
- [AGENTS.md](AGENTS.md): how work is done here (worktrees, the gate, releases).
- [docs/STANDARD.md](docs/STANDARD.md): the twelve laws and every clause.
- [Device experience policy](docs/policy/DEVICE-EXPERIENCE.md): separate phone, tablet, laptop and desktop UI/UX and quality/performance acceptance.
- [docs/APPLICATION.md](docs/APPLICATION.md): the template for applying the standard to your game.
- [docs/recipes/](docs/recipes/): add a scene, an entity and component, a system, an input action, a save section, a budget, a kit or a template.
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
