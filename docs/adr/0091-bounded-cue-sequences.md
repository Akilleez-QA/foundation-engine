# ADR 0091: bounded cue sequences as an optional kit

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Optional kits / Scripting
- **Tracking:** linked from the pull request

## Context

Creators need staged moments in which several things happen on separate channels
(camera, sound, actors, world changes), some steps wait for others or for the
player, the whole moment can be skipped, and a save in the middle continues
correctly. Without a shared contract each game re-implements timers and flags, and
the usual failure is a skip or reload that grants a consequence twice or never.
The lesson timeline in the learn kit is lesson-specific; the dialogue kit has no
time; the camera and audio-mixer kits own their own outputs.

## Decision

Add an optional `sequence` kit of pure functions: `defineSequence` validates and
freezes a multi-track cue definition (barriers, holds, effect identities, skip
policy; deadlocking barrier graphs refused); `createSequence` runs it on whole
caller ticks with a per-call transition budget, carrying unprocessed time as
`owed`; one canonical event order (first eligible transition in track order)
makes results independent of the budget. Effects are returned as intents exactly
once per run. `skip` lands `land` effects and drops presentation ones;
`cancel` lands nothing further. Snapshots are plain data validated field by field
against a definition fingerprint and stored through `defineSequenceSection`.

The kit installs no system, scheduler, callback or persistence owner. The
creator's fixed-step system, the camera, audio-mixer and dialogue kits keep their
ownership; composition is demonstrated in tests.

## Consequences

Exactly-once relies on the caller applying returned effects before its next save
and saving the snapshot with their consequences (or keying a claim record by the
effect id); cross-section atomicity is not provided. Definitions have no
branching or conditions; camera splines, curves and freezing of non-participating
entities are not included. Evidence is headless tests; no browser, device or
template integration is claimed.
