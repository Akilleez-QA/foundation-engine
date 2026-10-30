# ADR 0021: All user-facing text is keyed strings

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Strings
- **Related:** [0043 The extension model made true: one folder, folder-local strings, open registries, behaviour bound lazily by id](0043-extension-model.md)

## Context

Literal UI text cannot be localised, reviewed or offered at two reading levels.

## Decision

- `t(key, vars)` is typed by generated key types (`core/i18n/keys.gen.ts`), which require exactly the key's variables.
- Strings are shards in the owning folder (`strings/<area>/<locale>.json`), merged by `scripts/strings.mjs` (ADR 0043).
- Reading levels are key variants: a key and its `@detailed` variant.
- Lint (`literal-ui-text`) ratchets literal text in product code.

## Consequences

- Production builds replace readable keys with compact ids (`scripts/compact-keys.mjs`).
