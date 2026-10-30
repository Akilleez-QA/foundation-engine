# ADR 0076: engine, creator and agent contract

- **Status:** Accepted
- **Date:** 2026-09-30
- **Area:** Author contract and governance

## Decision

Foundation provides a skeleton of configurable, composable frameworks. The creator
may use, extend, replace or omit them and chooses their game's requirements.
An implementation agent follows that direction. Research and optional examples do not create an obligation to
implement a catalogue of gameplay systems. A framework is assessed by its contract,
quality preservation, bounded cost, maintainability and extension seams.

The build brief is the requirements boundary for the stock authoring workflow. Resolved
briefs carry an output-only contract version and a detached immutable snapshot.
Existing device, input, quality and numerical requirements are validated. Invalid
or missing brief-linked budget caps fail the brief lint instead of bypassing a
comparison. Defaults remain defaults: explicit creator requirements are not silently
clamped to one device tier. The repository's budget-change review still applies
to contributions here; independent creators can adopt a different documented
configuration or workflow. A frozen snapshot protects a resolved declaration
from accidental mutation; a newly constructed snapshot can express changed
requirements. It does not lock the creator's design or provide runtime hot-swapping.

The version identifies the resolved schema; acceptance evidence is separate. Runtime behavior and
budgets do not depend on whether a person or an agent wrote the application;
ADR 0061 remains in force.

This decision amends the standard's universal application scope and its quality
and player-promise wording. Quality floors, progression, loss, reset and merge
semantics are creator decisions. The persistence mechanism preserves valid state
through infrastructure failures; it does not impose permanent progression.
Stock checks remain unchanged unless deliberately revised. Explicit empty modes,
zero permitted repetitions and nonnegative age ranges are valid declarations;
the engine does not invent a minimum target age or a required gameplay mode.

## Enforcement and limits

Runtime owners enforce only their documented admission, lifetime and recovery
contracts. Build tools validate declarations and measured budgets. Experience,
accessibility and physical-device quality require the creator's declared evidence.
Arbitrary synchronous callbacks cannot be preempted by a TypeScript declaration;
work that needs stronger isolation must use an appropriate existing worker or
other explicit execution boundary. Documentation must never promise universal
performance from schema validation alone.

See [CREATOR-CONTRACT.md](../CREATOR-CONTRACT.md), STD-PRI-14 and AGENTS.md for the
responsibility matrix and extension acceptance record. No gameplay implementation
is introduced by this decision.

The additional validation has a startup cost. To preserve existing bundle limits,
standard-controller polling is loaded only when a compatible controller is already
available or connects. The registered action dispatcher remains eager. The lazy
loader shares the application's lifetime, deduplicates installation and contains
load failures; later connection can retry installation. It does not promise that
a browser will refetch a cached failed module URL. There is no second frame loop
or change to controller ownership semantics.
