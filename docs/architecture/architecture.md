# Architecture

Foundation Engine composes independently authored browser games from a typed
kernel, platform services, an author API and optional kits. This overview describes
the source baseline; [STANDARD.md](../STANDARD.md) remains the detailed contract.
The [creator contract](../CREATOR-CONTRACT.md) distinguishes reusable infrastructure
from the mechanics, content and acceptance criteria chosen by a game author.

## Context and boundaries

A game imports `@engine` and selected `@kits/<name>` entry points. Templates are
small consumers; they do not define a universal game design. The application root
composes the selected game with core and platform modules. The development test API
is an inspection surface for development and test builds, not a production API.

| Component | Source | Responsibility |
|---|---|---|
| Kernel | `src/core/` | Module boot, registries, events, services, saves, routing, activities and world ownership. |
| Platform | `src/platform/` | Rendering, input, UI shell, audio, assets and workers. |
| Domain | `src/domain/` | Pure math and fixed-step simulation facilities. |
| Author API | `src/author/` | Definitions, compilation to modules, scene runtime and author testing helpers. |
| Optional kits | `src/kits/` | Creator-selected patterns built on public author contracts. |
| Features and composition | `src/features/`, `src/app/` | Discovered engine features and application assembly. |
| Verification tooling | `scripts/`, `perf/`, `src/dev/` | Static checks, test inspection, budgets and browser harnesses. |

Dependencies point down the declared layers; ports provide explicit upward needs.
Core, platform and author code do not acquire mandatory kit dependencies. See
[ADR 0031](../adr/0031-layers-kits-packs-ports.md).

## Data flow and ownership

Definitions enter module discovery and registration. Ordered patches complete
content before registries freeze; validation precedes installation and startup.
The module kernel owns this sequence rather than leaving consumers to coordinate
initialization. See [boot phases](../adr/0003-module-system-boot-phases.md) and
[typed registries](../adr/0005-registries-and-typed-content.md).

Registered input resolves to actions. Activity-owned systems read actions and
advance state under the shared loop and game clock. Rendering responds to changes;
covered activities follow the coverage policy. Renderer resources have explicit
ownership and shared lifetimes. See the [activity loop](../adr/0015-activity-loop-render-on-demand.md),
[game clock](../adr/0033-game-clock-driver.md),
[action map](../adr/0044-one-action-map.md) and
[renderer ownership](../adr/0016-renderer-pool-resource-ownership.md).

Routing resolves a registered scene, loads its chunk and activates the current
request. Saves flow through typed sections and migrations in one store. Assets
flow through a manifest and shared cache. Their owning services handle recovery
rather than each game creating parallel stores or caches. See
[scene routing](../adr/0022-scene-router-lazy-loading.md),
[sectioned saves](../adr/0007-save-store-sections.md) and
[asset cache](../adr/0023-asset-manifest-and-cache.md).

## Decisions and evidence

The [ADR index](../adr/README.md) records accepted, reserved and superseded decisions;
consult status there before relying on a historical record. The generated
[capability inventory](../capabilities.md) identifies available exports, kits and
tooling. The [acceptance ledger](../guides/upgrade-acceptance-ledger.md) records
implementation and verification boundaries.

Configured resource limits, overload behavior, cancellation and recovery belong to
the owning framework contract. This overview does not introduce another scheduler,
cache or persistence owner. Passing static checks or Node tests does not establish
browser behavior, sustained hardware performance or supported-device acceptance.
