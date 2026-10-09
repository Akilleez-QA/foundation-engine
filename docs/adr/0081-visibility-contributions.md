# ADR 0081: source-owned visibility contributions

- Status: Accepted for this candidate; integration requires review and full CI.
- Date: 2026-10-09
- Discussion: [#198](https://github.com/Akilleez-QA/foundation-engine/issues/198)
- Area: Optional kits

## Context

Overlapping creator-supplied coverage must survive the independent retirement of one source. Some consumers also retain exploration after coverage ends. Spatial interest owns entity ranking and hysteresis, navigation owns route calculation, UI owns presentation, and network projections own disclosure. None owns this distinction between current cell coverage and explored history.

## Decision

Add a pure optional `@kits/visibility` helper with one owner per observer/team. It accepts bounded integer-cell contributions, tracks overlapping sources, atomically replaces copied contributions, and uses exact source/calculation identities to refuse stale work. It preserves exploration separately and drains bounded coalesced current changes. No global registry, system, scheduler or registration is installed.

Creators supply cell geometry, relationships, occlusion, source lifetime and disclosure policy. Tickets are local capabilities, not serialized authority. Worker cancellation and persistence remain with existing owners. Counts, array lengths, memory products and output batches have explicit limits; these do not establish wall-clock deadlines.

## Alternatives and consequences

Putting this into spatial interest would couple entity-ranking policy to cell history. Putting it in UI would make state depend on presentation. A complete fog renderer or line-of-sight framework would prescribe geometry and disclosure policy. A small owner keeps those decisions replaceable at the cost of explicit creator adapters.

Two headless consumers establish distinct policies: sensor exploration and current facility service coverage. They are not integrated game features or device acceptance. The helper allocates on admitted replacement and result creation; it makes no allocation-free simulation claim. Dirty draining has one consumer and is a coalesced state feed, not a replay log. Public source is independently authored.

## Evidence

Focused lifetime, atomic-refusal, overlap and dirty-drain regressions plus a 600-command independent set-union/history model. Hosted full CI remains required before integration. No geometry correctness, browser, disclosure security, persistence, sustained timing or physical-device result is implied.
