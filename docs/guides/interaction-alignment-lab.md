# Planar interaction alignment consumers

The reviewed headless prototype now consumes the optional public `@kits/alignment` candidate. The implementation lives in `src/kits/alignment`; there is no second implementation in the tool. See the [public contract](../../src/kits/alignment/README.md) for inputs, limits, owner lifecycle, failure modes and usage.

Existing frames resolve transforms, navigation produces routes, character motion owns movement policy, and exploration dispatches nearby interactions. The new seam is a target-relative approach proposal followed by exact-ticket acknowledgment. It installs no pose writer, input route, effect callback or scheduler. Creators retain clearance, eligibility, movement and effects.

The public yaw convention now matches `Transform.ry`: positive yaw rotates +Z toward +X. This deliberately replaces the earlier experiment's opposite planar convention. A public test compares the resulting position against the existing frames store and matrix Y rotation. Heading is normalized before composition, including finite extreme inputs; overflow in coordinates or relative distance throws before progress. No cross-runtime bitwise math guarantee is claimed.

`tools/interaction-alignment-lab/alignment.test.ts` has two consumers: console activation and asymmetric socket placement. Each applies proposals through a test-only pose owner, changes its activation/custody state only after acceptance, and leaves runtime movement and inventory unimplemented. Public lifecycle tests under `src/kits/alignment` are discovered by the normal test runner.

Focused evidence: 14 tests across the kit and two consumers, isolated TypeScript checking and changed-file formatting. Tests cover exact/copied/foreign/consumed tickets, target identity/generation/revision, target motion, prepared drift during pause and zero time, eligibility/clearance, timeout and work budgets, snapshots and identity bounds, frames-convention agreement and numeric extremes. The public helper retains the corrected paused-drift behavior.

This is a public API candidate, not runtime playability acceptance. Browser behavior, actual collision sweeps, input comfort, persistence composition, physical devices, performance and complete CI remain unverified. General rotational 3D alignment and durable effect commits are outside this planar helper.
