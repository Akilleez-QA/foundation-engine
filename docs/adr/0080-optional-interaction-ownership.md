# ADR 0080: optional assignment, itinerary and alignment ownership

- Status: Accepted for this implementation; integration is gated by full CI.
- Date: 2026-10-09
- Discussion: [#196](https://github.com/Akilleez-QA/foundation-engine/issues/196)
- Area: Optional kits and acceptance tooling

## Context

Reusable interactions need three independent capabilities: scarce-capacity claims, editable ordered intent, and a fresh spatial handoff before an effect. Navigation, character motion, save sections and inventory already own execution, movement, durable data and goods. Adding a second execution owner would obscure cancellation and effect authority.

## Decision

Expose pure optional helpers through @kits/assignments, @kits/itinerary and @kits/alignment. No empty registration, mandatory system, clock, network authority, persistence format or gameplay policy is installed. Creators may use, replace, extend or omit each helper independently.

Assignments owns transient weighted occupancy with configured actor/target/claim/capacity/retry limits. Exact local tokens govern claims and release; failed transfers preserve the old claim. Itinerary owns bounded ordered data, revision conflicts and an active completion ticket. Neighbor edits preserve the attempt; replacement, invalidation and restoration revoke it. Alignment owns one bounded approach attempt and one prepare/acknowledge ticket, using fresh creator-supplied pose, clearance, eligibility and time observations. Its yaw convention follows engine transforms.

The creator owns adapters and effects: cancelling a ticket does not cancel external work automatically; accepting one does not commit inventory or rewards. Compose the existing cancellation and durable transaction owners. Every delayed result must still validate the relevant live authority before publishing. Saves retain itinerary data, never process-local tickets.

Development-only acceptance reporting requires predeclared cases and minimum sample counts. Missing or empty evidence fails. Identity labels identify what a runner claims to have checked, not an authenticated oracle. The helper introduces no runtime dependency.

## Alternatives and consequences

A universal job/interaction manager could centralize execution but would prescribe scheduling, arrival and gameplay choices. Registration wrappers without resources or systems add setup without ownership value. Independent helpers keep those choices explicit at the cost of creator adapter work.

These mechanisms are bounded by configured counts, lengths and intervals, not measured wall-clock deadlines. Alignment is planar and uses platform math; it is not collision detection or cross-runtime bitwise deterministic simulation. Save composition does not prove durable external effects. Browser playability, physical-device performance and concrete game designs require separate acceptance.

## Evidence

Prerequisite reviews and focused tests are in #189–#195. The integration candidate retains both distinct lab consumers per mechanism, real navigation-owner cancellation, fresh-store itinerary reload, numerical boundary tests and acceptance CLI negative cases. Combined hosted CI is required before merge; earlier branch success does not certify the combined candidate.
