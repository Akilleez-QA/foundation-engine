# ADR 0111: cast binding, branching and event arbitration for sequences

- **Status:** Proposed
- **Date:** 2026-10-09
- **Area:** Optional kits / Scripting
- **Tracking:** builds on the cue sequence kit (ADR 0091, pull request #249)

## Context

Scripted scenes take over some of what their actors do (where they stand, which clip
plays) but not everything. The rest of the world must pause without stopping anyone
mid-action. Scenes branch on a player's choice, and several world triggers must not
fire on top of a running scene. Without contracts, each game re-implements these
pieces, and skip and branch paths drift apart.

## Decision

Extend the optional sequence kit with three pure helpers:

- **Cast:** roles with per-role driven channels and required/optional binding. The
  helper answers ownership (`drives`) and participation (`gate`), holds busy entities
  until they settle, and returns released channels.
- **Graph:** sequence definitions joined at held branch cues. A choice cancels the rest
  of the node and starts the chosen node as a new run with a per-step session, which
  keeps exactly-once ids distinct. Skip follows defaults and lands only the effects the branch cue depends on; parallel
  cues are abandoned. Reaching the step bound ends the graph (`limited`). Snapshots are
  validated.
- **Arbiter:** one claim at a time, priority by declaration order, per-source
  cooldowns, refusal of stale releases, and a bounded number of offers per tick.

None installs a system, scheduler or persistence owner.

## Consequences

Systems must consult `drives` and `gate`; the helper cannot stop code that ignores it.
The cast is not persisted. Branches live only at held cues, with no conditions inside
definitions. Arbitration does not decide what counts as a safe point. Evidence is
headless tests; no browser or device acceptance.
