# ADR 0073: binding-derived action descriptions

- **Status:** Accepted
- **Date:** 2026-09-30
- **Area:** Input and Author API

## Decision

The input dispatcher exposes a targeted immutable action description from its current
registry and effective overrides. The description contains the label key, keyboard
chords, standard controller tokens and whether the action matches current dispatch
scope. Unknown identifiers return null. Explicit description can inspect hidden
rows without changing generated help's exclusion of those rows.

The Author API exposes this through `ctx.input.describe(localId)` for declared press
actions. Axes require a separate two-sided presentation contract and return null in
this slice. Headless tests can declare inputs and inject the existing input service
to exercise remaps and layers; defaults alone do not simulate modal ownership.

Descriptions are snapshots. No per-frame polling, DOM writes, second override store
or device detector is introduced. Formatting and translation remain in presentation;
label keys are resolved through the existing catalog. No touch instructions or
hardware-family glyph claims are inferred from controller tokens.

`inContext` intentionally describes declared-scope filtering only; explicit scoped
handler subscriptions may route an action outside this metadata filter. A handler, device, gameplay
precondition, editable focus or full navigation path may still prevent activation.
Production Controls persistence is not currently integrated and is not implied by
this API. Its diagnostic consumer verifies in-session remapping against the actual
compiled scene and dispatcher, including exclusion under a reading layer.

## Verification

Focused tests cover frozen snapshots, partial and empty overrides, hidden and unknown
rows, context changes and author-local ID mapping. Browser evidence executes the
shown remapped key and controller input, rejects the old inputs, and checks modal
coverage/restoration. Physical controllers and cross-platform glyph conventions
remain separate acceptance work. See [action hints](../guides/action-hints.md).

The browser diagnostic is manually invoked; the gate and CI do not automatically run
this script. Outputs default to `playtest/action-hints/`. Its successful runs are
recorded evidence, while the focused tests provide automated regression coverage.
