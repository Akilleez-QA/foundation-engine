# Operation-boundary acceptance

This candidate tests existing framework composition at commit, pause, save and
retirement boundaries. It adds no game mechanic or new authority owner.

| Scenario | Production owners exercised | Evidence |
|---|---|---|
| Two reservations sharing stock, commit one/cancel another, retry and reload | Inventory ledger, production owner, industry candidate | `src/kits/resources/reservation-boundaries.test.ts` |
| Transfer, checkpoint before a deferred effect, restore and compare continuation | Inventory receipts and real SaveStore/MemoryBackend | `src/kits/inventory/continuation.test.ts` |
| Pause after one simulation event, render 120 frames, then resume | FrameLoop, GameClock, animation marker track | `src/kits/animation/pause-boundary.test.ts` |
| Supersede a ready terrain candidate; cancel/close with late preparation completion | Terrain generation owner and real chunk builder | `src/kits/terrain/generation-boundary.test.ts` |

The save test deliberately supplies a small creator-owned adapter. Pending
authoritative effects share one versioned save envelope with inventory and receipts.
The adapter validates that a transfer has either a pending effect or its applied
receipt, and uses an owner signal and pinned player to reject stale callbacks.
The inventory kit does not automatically persist arbitrary external effects or
cancel every application callback. Failed durable writes report session state;
retry restores durable storage while the prior disk checkpoint stays coherent.

The pause test drives production frame logic manually. It proves this wiring
does not repeat presentation markers or simulation authority across pause; it
does not give markers permission to award items or certify arbitrary consumers.
Frame diagnostics are collected and asserted empty, including after resume.

Terrain tests prove candidate publication exclusion, retained admission until
late work settles, and exactly-once release callbacks. The view adapter is a test
fixture: real GPU disposal and atomic render/contact/navigation publication are
not established by these headless checks.

These regression cases found no production defect in the exercised paths.
Independent review found and repaired test-fixture gaps: missing inventory could
be mistaken for fresh empty state, and exceptions from a frame error reporter
could be swallowed. Both now have explicit failure oracles.

## Related experiment

[Shared navigation field experiment](../../tools/navigation-field-lab/README.md)
measures reuse with the existing search as reference. It remains a headless tool,
not an installed kit, and its integer-cost and ownership limitations are explicit.

## Candidate verification — 2026-10-08

Base `e7e42706`; branch `test/consistency-boundaries`.
`npm run check` passed: 16 new tests across five files, typecheck, changed-file
formatting and the focused layer/type/brief/budget/provenance/docs checks.
Adjacent resource, inventory, animation and terrain suites were also exercised by
their implementers. Separate agents reviewed the other authors' tests and the
navigation experiment. Their findings were addressed before the final focused run.

The prototype's checked-in benchmark identifies source hashes and raw samples;
the hashes still matched after repository formatting. No upstream implementation
was copied. No rendering or game content changed. Hosted CI is pending and remains
the integration requirement; this evidence is not a release or device acceptance.
