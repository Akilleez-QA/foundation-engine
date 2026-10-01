# ADR 0044: One action map: keys, pad and pointer resolve to registered actions

- **Status:** Accepted
- **Date:** 2026-09-28
- **Area:** Input
- **Related:** [0047 Reachability is a path; an input press has one owner](0047-input-reach-and-ownership.md)

## Context

Hard-coded key checks cannot be remapped, cannot be listed in help, and silently leave pad players out.

## Decision

- The `inputActions` registry (owned by `platform.input`) holds rows `{id, label, scope: always|global|layer, kind: press|hold|axis, defaults: {keys, pad}, via?, reachability?}`.
- The dispatcher (`InputActions`) resolves keys and pads to actions and never calls feature handlers directly. Consumers subscribe with `onAction`, or drain per frame.
- Shell buttons and quick slots are actions.
- Reachability is a check: every action must be reachable by keyboard and by pad, through a direct binding or a declared `via` path.
- Remapping edits bindings. Help text is generated from the effective bindings.

## Consequences

- The recipe `docs/recipes/add-an-input-action.md`.
- `platform/input/actions.test.ts`.
