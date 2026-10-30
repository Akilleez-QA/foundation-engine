# Capability removal and respec

The optional `createCapabilities` owner can remove creator-selected possession
without imposing classes, levels, prices, refunds or experience curves. It extends
the same prerequisite/evidence/grant owner used for admission. The creator chooses
whether to use it and supplies every consequence of a changed grant set.

```ts
const plan = capabilities.previewRevocation({
  capabilities: ['authored-foundation'],
  dependents: 'cascade',
  privilegedDependents: 'retain',
});
// Show plan.removed and plan.blocked using the game's own presentation.
// The creator may decline here: previews change no state.
const result = capabilities.revoke(plan.request, plan.revision);
if (result.status === 'revoked') {
  // Reconcile creator-owned derived contributions from the accepted grant set.
}
```

Both policies are required; there is no implicit dependent-removal choice.
`dependents: 'reject'` blocks the entire change if an unselected dependent would be
removed. `cascade` includes those dependents. Selecting the full removal set works
with `reject` too. `privilegedDependents: 'retain'` leaves tutorial and migration
dependents possessed even if their prerequisites are removed, matching their
explicit admission bypass. `include` subjects them to the selected dependent
policy. Either choice still removes a privileged grant explicitly selected in
`capabilities`. An earned dependent of a retained privileged grant remains valid;
its prerequisite is still possessed. These choices are local game semantics, not
network authorization.

A preview returns frozen, detached `request`, sorted `removed` and `blocked` IDs,
and `revision`. `removed` is the proposed closure, including blocked dependents;
a nonempty `blocked` array means nothing can commit. Revocation recomputes the
plan from its request at the expected revision. Pass the preview's captured
request to commit that selection. A revision checks this owner's state; it is
not an opaque authorization token or a binding to another owner's preview.

Revocation reports `revoked`, `blocked`, `unchanged` or `stale`. Unknown IDs,
malformed policies/arrays, duplicate selections and invalid revisions throw
before publication. Known but unowned IDs are a no-op. New evidence, an accepted
grant or successful removal advances the revision once; duplicates and rejected
operations do not. A preview can be abandoned without cancellation work. A stale
commit requires a fresh preview, never an automatic retry of an old selection.
Revision exhaustion rejects new changes before mutation.

The existing snapshot now includes `revision`. Older valid snapshots without it
restore at zero. Restore checks earned grants against the complete final
prerequisite/evidence set, independent of grant-array order. Tutorial/migration
reasons and event provenance remain explicit. Null/falsy snapshots, duplicate
evidence or grants, and incoherent earned grants fail instead of becoming a
fresh owner. Redundant prerequisite/evidence IDs in definitions remain supported
and are normalized after checking the original array length against its bound.
Missing `saved` (`undefined`) still means a new owner. Grant retries
compare captured fields rather than caller property order. Definitions, evidence
and selections use bounded indexed capture; caller array methods/iterators are
not used. Reentrant mutation during getter capture is rejected.

The snapshot remains detached and mutable for the existing save-section adapter.
There is one current grant per capability, with `reason` and `event`; multiple
independent sources of the same possession are not reference-counted. Removal
keeps evidence, allowing the creator to regrant an eligible capability. Persisted
revisions are local conflict markers, not globally unique epochs: do not carry
previews across owner replacement or reload.

## Ownership, bounds and composition

The owner admits at most 1,024 definitions/grants, 1,024 prerequisites per
definition, 4,096 evidence keys per definition and 4,096 recorded evidence keys.
A removal selects at most 1,024 IDs. DAG ordering is computed on creation;
revocation scans the admitted graph once and sorts at most 1,024 result IDs. These
are work/record bounds, not a measured frame-time guarantee. No scheduler, queue,
clock, callback publication or second persistence owner is introduced.

The kit changes only possession. The creator reconciles derived commands,
appearance, recipes and source-owned modifiers after acceptance. If removal must
commit with payment, refunds or inventory, build a candidate using the snapshot,
apply the removal there, and publish one complete creator-owned save envelope
through the existing persistence contract. Sequential mutations of separate
owners are not an atomic transaction. This API supplies no automatic rollback of
those mutations, migration of changed definitions, refund policy or server trust.

`src/kits/capabilities/progression.test.ts` exercises a creator consumer with
modifier reconciliation, denied removal, cascade, restore, explicit privileged
policy and stale preview. It also checks malformed snapshots, frozen capture,
reentry and exhausted revisions. These headless contract tests do not certify a
respec screen, real-device interaction or arbitrary derived-state integration.
