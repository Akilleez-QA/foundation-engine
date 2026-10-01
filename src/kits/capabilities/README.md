# Capabilities

`createCapabilities` validates a prerequisite DAG (maximum 1,024 definitions), records learning evidence separately from possession, and distinguishes eligibility from grants. Earned grants recheck prerequisites and evidence. Tutorial/migration bypasses are explicit privileged caller actions recorded with their event provenance. Store the detached snapshot with an existing save section. A client-side kit does not provide server authorization. Age and assistance settings should not be prerequisite nodes.

`createModifiers` derives finite values from source-owned additions and multipliers. Repeated equip/update replaces a source; removal recomputes from base values, avoiding inverse-operation drift. Sources sort deterministically. Default admission is 256 sources, maximum 64 contributions per source; overflow fails before publication. Persist source definitions, then rebuild on load. This is not an equipment UI or a character-class content tree.

`createActionRuns` adds optional bounded action timing and revision-checked completion/cancellation. Feed it time from the existing scene system; the creator owns every consequence and publication rule. See [action runs](../../../docs/guides/action-runs.md) for identity, expiry, retry and integration limits.

`previewRevocation` and revision-checked `revoke` provide optional respec/removal
inside the existing possession owner. The creator explicitly selects reject or
cascade for dependents, and include or retain for tutorial/migration dependents.
Evidence remains recorded; grant reasons/events remain explicit. Snapshots include
a revision (older valid snapshots without one restore at zero). See
[capability revocation](../../../docs/guides/capability-revocation.md) for policies,
bounds, restore compatibility and multi-owner publication limits.

Modifier contributions are captured by index with one read per primitive field,
without calling supplied array methods or iterators. The existing 64-contribution
limit validates a primitive safe-integer array length. Reentrant source changes
from input getters throw; invalid capture or arithmetic preserves accepted sources.
This does not constrain unrelated side effects in creator code.

The separate pure `progression.ts` module adds optional typed XP balances and
bounded skill allocation candidates with prerequisite checks, shared certificate/
schematic derivation and allocation-only respec refunds. The enclosing world owns
receipts, persistence and coupled equipment/job acceptance. It does not change the
existing capability owner. See [persistent skill allocation](../../../docs/guides/skill-allocation.md)
for the intended contract, strict restore rules and integration limits. The same helpers are
exported through the game barrel and `@foundation-engine/pure/capabilities`.
