# ADR 0036: Feature anatomy: an eager manifest, a lazy body, discovered by folder; shared baselines are sharded

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Structure
- **Related:** [0043 The extension model made true: one folder, folder-local strings, open registries, behaviour bound lazily by id](0043-extension-model.md)

## Context

A hand-kept list of features is a merge conflict for every addition, and code imported eagerly from a feature folder grows first load.

## Decision

- A feature folder has one eager file, `index.ts`: the manifest. It default-exports the module and holds its registry rows. Everything else is reachable only through `import()`.
- `scripts/lint/manifests.mjs` checks the manifest's static closure.
- Discovery is `import.meta.glob('../{features,packs}/*/index.ts', {eager: true})` in `app/modules.ts`, plus short lists of core, platform, domain and kit modules (`app/layer-modules.ts`).
- Boot order comes from `requires`, then layer, then id, never from list position.
- Baselines are sharded: `perf/baseline/<scene>.json` and `lint-baseline/<rule>/<folder>.json`.

## Consequences

- Adding a feature edits no shared file.
- `src/app/registries.test.ts` boots the discovered set in node.
